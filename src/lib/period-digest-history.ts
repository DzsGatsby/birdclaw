import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { getBirdclawPaths } from "./config";
import { getNativeDb, getReadDb } from "./db";
import {
	streamPeriodDigest,
	type PeriodDigestContext,
	type PeriodDigestRunResult,
} from "./period-digest";
import type { PeriodDigestCoverage } from "./period-digest-coverage";
import { redactProviderError } from "./openai-response-runtime";
import type { Database } from "./sqlite";

export type PeriodDigestHistoryStatus = "pending" | "ready" | "failed";

export interface PeriodDigestHistoryMetadata {
	id: string;
	kind: "daily" | "intraday";
	date: string;
	endDate: string;
	archiveKey: string;
	slotLabel?: string;
	timezone: string;
	status: PeriodDigestHistoryStatus;
	title: string;
	summary: string;
	counts: PeriodDigestRunResult["context"]["counts"];
	provider?: string;
	model?: string;
	attemptCount: number;
	error?: string;
	createdAt: string;
	updatedAt: string;
	finishedAt?: string;
	pdfAvailable: boolean;
	coverage?: Pick<
		PeriodDigestCoverage,
		| "version"
		| "expected"
		| "processed"
		| "complete"
		| "sourceTruncated"
		| "missingTweetIds"
		| "cited"
		| "dispositions"
	>;
}

export interface PeriodDigestHistoryDetail {
	metadata: PeriodDigestHistoryMetadata;
	result: PeriodDigestRunResult;
}

interface PeriodDigestHistoryRow extends Record<string, unknown> {
	id: string;
	digest_date: string;
	timezone: string;
	status: string;
	claim_token: string;
	attempt_count: number;
	window_since: string;
	window_until: string;
	include_dms: number;
	include_feed: number;
	twitter_scope: string;
	provider: string;
	model: string;
	reasoning_effort: string;
	service_tier: string;
	context_hash: string;
	counts_json: string;
	coverage_json: string;
	digest_json: string;
	markdown: string;
	tweets_json: string;
	dms_json: string;
	links_json: string;
	feed_json: string;
	error: string | null;
	started_at: string;
	finished_at: string | null;
	created_at: string;
	updated_at: string;
}

const EMPTY_COUNTS: PeriodDigestRunResult["context"]["counts"] = {
	home: 0,
	mentions: 0,
	authored: 0,
	likes: 0,
	bookmarks: 0,
	dms: 0,
	links: 0,
	feed: 0,
};
const CLAIM_STALE_MS = 30 * 60_000;

function parseJson<T>(value: string, fallback: T): T {
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

function statusFromRow(value: string): PeriodDigestHistoryStatus {
	return value === "ready" || value === "failed" ? value : "pending";
}

export function dailyDigestPdfPath(date: string) {
	return path.join(
		getBirdclawPaths().rootDir,
		"reports",
		"daily",
		`BirdClaw-${date}-digest.pdf`,
	);
}

export function intradayDigestPdfPath(slotKey: string) {
	return path.join(
		getBirdclawPaths().rootDir,
		"reports",
		"intraday",
		`BirdClaw-${slotKey.replace("@", "-")}-intraday-digest.pdf`,
	);
}

const INTRADAY_SLOT_PATTERN = /^(\d{4}-\d{2}-\d{2})@(08|16|24)$/;

export function parseIntradaySlotKey(slotKey: string) {
	const match = INTRADAY_SLOT_PATTERN.exec(slotKey);
	if (!match?.[1] || !match[2]) return null;
	const date = match[1];
	const endHour = Number(match[2]);
	return {
		date,
		endHour,
		slotLabel: `${String(endHour - 8).padStart(2, "0")}:00–${String(endHour).padStart(2, "0")}:00`,
	};
}

function metadataFromRow(
	row: PeriodDigestHistoryRow,
): PeriodDigestHistoryMetadata {
	const intraday = parseIntradaySlotKey(row.digest_date);
	const digest = parseJson<PeriodDigestRunResult["digest"] | null>(
		row.digest_json,
		null,
	);
	const coverage = parseJson<PeriodDigestCoverage | null>(
		row.coverage_json ?? "{}",
		null,
	);
	return {
		id: row.id,
		kind: intraday ? "intraday" : "daily",
		date: intraday?.date ?? row.digest_date,
		endDate: intraday?.date ?? row.digest_date,
		archiveKey: row.digest_date,
		...(intraday ? { slotLabel: intraday.slotLabel } : {}),
		timezone: row.timezone,
		status: statusFromRow(row.status),
		title:
			digest?.title ??
			(intraday
				? `Intraday overview · ${intraday.date} · ${intraday.slotLabel}`
				: `Daily digest · ${row.digest_date}`),
		summary:
			digest?.summary ??
			(row.status === "failed"
				? row.error || "Generation failed."
				: "Generation in progress…"),
		counts: {
			...EMPTY_COUNTS,
			...parseJson(row.counts_json, {}),
		},
		...(row.provider ? { provider: row.provider } : {}),
		...(row.model ? { model: row.model } : {}),
		attemptCount: Number(row.attempt_count),
		...(row.error ? { error: row.error } : {}),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		...(row.finished_at ? { finishedAt: row.finished_at } : {}),
		pdfAvailable:
			row.status === "ready" &&
			existsSync(
				intraday
					? intradayDigestPdfPath(row.digest_date)
					: dailyDigestPdfPath(row.digest_date),
			),
		...(coverage?.version === 1
			? {
					coverage: {
						version: coverage.version,
						expected: coverage.expected,
						processed: coverage.processed,
						complete: coverage.complete,
						sourceTruncated: coverage.sourceTruncated,
						missingTweetIds: coverage.missingTweetIds,
						cited: coverage.cited,
						dispositions: coverage.dispositions,
					},
				}
			: {}),
	};
}

function detailFromRow(
	row: PeriodDigestHistoryRow,
): PeriodDigestHistoryDetail | null {
	if (row.status !== "ready") return null;
	const digest = parseJson<PeriodDigestRunResult["digest"] | null>(
		row.digest_json,
		null,
	);
	if (!digest) return null;
	const metadata = metadataFromRow(row);
	const coverage = parseJson<PeriodDigestCoverage | null>(
		row.coverage_json ?? "{}",
		null,
	);
	return {
		metadata,
		result: {
			context: {
				window: {
					label:
						metadata.kind === "intraday"
							? `${metadata.date} · ${metadata.slotLabel ?? "Intraday"}`
							: row.digest_date,
					since: row.window_since,
					until: row.window_until,
				},
				includeDms: Boolean(row.include_dms),
				includeFeed: Boolean(row.include_feed),
				twitterScope: row.twitter_scope === "home" ? "home" : "all",
				counts: metadata.counts,
				tweets: parseJson(row.tweets_json, []),
				dms: parseJson(row.dms_json, []),
				links: parseJson(row.links_json, []),
				feedItems: parseJson(row.feed_json, []),
				hash: row.context_hash,
				...(metadata.coverage
					? { sourceTruncated: metadata.coverage.sourceTruncated }
					: {}),
			},
			digest,
			markdown: row.markdown,
			model: row.model,
			...(row.provider ? { provider: row.provider } : {}),
			reasoningEffort: row.reasoning_effort,
			serviceTier: row.service_tier,
			cached: true,
			updatedAt: row.finished_at ?? row.updated_at,
			...(coverage?.version === 1 ? { coverage } : {}),
		},
	};
}

function rowById(id: string, db: Database) {
	return db
		.prepare("select * from period_digest_history where id = ?")
		.get(id) as PeriodDigestHistoryRow | undefined;
}

export function listPeriodDigestHistory(
	options: { limit?: number; kind?: "daily" | "intraday" } = {},
	db = getReadDb(),
) {
	const limit = Math.max(1, Math.min(366, Math.trunc(options.limit ?? 90)));
	const kind = options.kind ?? "daily";
	const rows = db
		.prepare(
			`select * from period_digest_history
			 where digest_date ${kind === "intraday" ? "like" : "not like"} '%@%'
			 order by digest_date desc limit ?`,
		)
		.all(limit) as PeriodDigestHistoryRow[];
	return rows.map(metadataFromRow);
}

export function getPeriodDigestHistory(id: string, db = getReadDb()) {
	const row = rowById(id, db);
	return row ? detailFromRow(row) : null;
}

export function localDateKey(date = new Date()) {
	const year = String(date.getFullYear()).padStart(4, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function previousLocalDateKey(date = new Date()) {
	const previous = new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate() - 1,
	);
	return localDateKey(previous);
}

export function localWindowForDateKey(dateKey: string) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
	if (!match) throw new Error("Daily digest date must use YYYY-MM-DD");
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const since = new Date(year, month - 1, day);
	if (
		since.getFullYear() !== year ||
		since.getMonth() !== month - 1 ||
		since.getDate() !== day
	) {
		throw new Error("Daily digest date is invalid");
	}
	const until = new Date(year, month - 1, day + 1);
	return { since: since.toISOString(), until: until.toISOString() };
}

export function localWindowForIntradaySlotKey(slotKey: string) {
	const slot = parseIntradaySlotKey(slotKey);
	if (!slot) {
		throw new Error("Intraday digest slot must use YYYY-MM-DD@(08|16|24)");
	}
	const dayWindow = localWindowForDateKey(slot.date);
	const dayStart = new Date(dayWindow.since);
	const since = new Date(
		dayStart.getFullYear(),
		dayStart.getMonth(),
		dayStart.getDate(),
		slot.endHour - 8,
	);
	const until = new Date(
		dayStart.getFullYear(),
		dayStart.getMonth(),
		dayStart.getDate(),
		slot.endHour,
	);
	return { since: since.toISOString(), until: until.toISOString() };
}

export function latestCompletedIntradaySlotKey(now = new Date()) {
	const boundaryHour = Math.floor(now.getHours() / 8) * 8;
	if (boundaryHour === 0) {
		const previous = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate() - 1,
		);
		return `${localDateKey(previous)}@24`;
	}
	return `${localDateKey(now)}@${String(boundaryHour).padStart(2, "0")}`;
}

export function nextIntradaySlotKey(slotKey: string) {
	const window = localWindowForIntradaySlotKey(slotKey);
	const nextBoundary = new Date(window.until);
	nextBoundary.setHours(nextBoundary.getHours() + 8);
	const hour = nextBoundary.getHours();
	if (hour === 0) {
		const previous = new Date(
			nextBoundary.getFullYear(),
			nextBoundary.getMonth(),
			nextBoundary.getDate() - 1,
		);
		return `${localDateKey(previous)}@24`;
	}
	return `${localDateKey(nextBoundary)}@${String(hour).padStart(2, "0")}`;
}

export function previousIntradaySlotKey(slotKey: string) {
	const window = localWindowForIntradaySlotKey(slotKey);
	const boundary = new Date(window.since);
	const hour = boundary.getHours();
	if (hour === 0) {
		const previous = new Date(
			boundary.getFullYear(),
			boundary.getMonth(),
			boundary.getDate() - 1,
		);
		return `${localDateKey(previous)}@24`;
	}
	return `${localDateKey(boundary)}@${String(hour).padStart(2, "0")}`;
}

function compactContext(result: PeriodDigestRunResult) {
	const referencedIds = new Set([
		...result.digest.sourceTweetIds,
		...result.digest.keyTopics.flatMap((topic) => topic.tweetIds),
		...result.digest.notableLinks.flatMap((link) => link.sourceTweetIds),
		...result.digest.actionItems.flatMap((item) =>
			item.tweetId ? [item.tweetId] : [],
		),
	]);
	for (const citation of result.markdown.matchAll(/[（(]([^()（）]+)[）)]/g)) {
		for (const token of (citation[1] ?? "").split(/[\s,，、;；]+/)) {
			const id = token.trim().replace(/^tweet[_:]/i, "");
			if (id) referencedIds.add(id);
		}
	}
	const tweets = result.context.tweets.filter((tweet) =>
		[...referencedIds].some(
			(id) => id === tweet.id || id.replace(/^tweet[_:]/i, "") === tweet.id,
		),
	);
	return {
		tweets,
		dms: result.context.dms,
		links: result.context.links,
		feedItems: result.context.feedItems ?? [],
	};
}

function claimPeriodDigestWindow(
	archiveKey: string,
	{ since, until }: { since: string; until: string },
	db = getNativeDb(),
) {
	const now = new Date().toISOString();
	const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
	return db.transaction(() => {
		const claimToken = randomUUID();
		const existing = db
			.prepare("select * from period_digest_history where digest_date = ?")
			.get(archiveKey) as PeriodDigestHistoryRow | undefined;
		if (
			existing?.status === "ready" ||
			(existing?.status === "pending" && existing.updated_at > staleBefore)
		) {
			return {
				claimed: false as const,
				id: existing.id,
				status: existing.status,
			};
		}
		if (existing) {
			const timezone =
				Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
			db.prepare(
				`update period_digest_history
				 set status = 'pending', claim_token = ?, attempt_count = attempt_count + 1,
				     timezone = ?, window_since = ?, window_until = ?, error = null,
				     started_at = ?, finished_at = null, updated_at = ?
				 where id = ?`,
			).run(claimToken, timezone, since, until, now, now, existing.id);
			return {
				claimed: true as const,
				id: existing.id,
				claimToken,
				status: "pending",
			};
		}
		const id = randomUUID();
		db.prepare(
			`insert into period_digest_history (
			 id, digest_date, timezone, status, claim_token, attempt_count, window_since,
			 window_until, started_at, created_at, updated_at
			) values (?, ?, ?, 'pending', ?, 1, ?, ?, ?, ?, ?)`,
		).run(
			id,
			archiveKey,
			Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
			claimToken,
			since,
			until,
			now,
			now,
			now,
		);
		return { claimed: true as const, id, claimToken, status: "pending" };
	})();
}

export function claimPeriodDigestDate(date: string, db = getNativeDb()) {
	return claimPeriodDigestWindow(date, localWindowForDateKey(date), db);
}

export function claimIntradayDigestSlot(slotKey: string, db = getNativeDb()) {
	return claimPeriodDigestWindow(
		slotKey,
		localWindowForIntradaySlotKey(slotKey),
		db,
	);
}

export function initializePeriodDigestHistoryContext(
	id: string,
	claimToken: string,
	context: PeriodDigestContext,
	db = getNativeDb(),
) {
	const now = new Date().toISOString();
	return (
		db
			.prepare(
				`update period_digest_history set
				 include_dms = ?, include_feed = ?, twitter_scope = ?, counts_json = ?,
				 coverage_json = case when context_hash = ? then coverage_json else '{}' end,
				 context_hash = ?, updated_at = ?
				 where id = ? and claim_token = ? and status = 'pending'`,
			)
			.run(
				context.includeDms ? 1 : 0,
				context.includeFeed ? 1 : 0,
				context.twitterScope === "home" ? "home" : "all",
				JSON.stringify(context.counts),
				context.hash,
				context.hash,
				now,
				id,
				claimToken,
			).changes > 0
	);
}

export function updatePeriodDigestHistoryCoverage(
	id: string,
	claimToken: string,
	coverage: PeriodDigestCoverage,
	db = getNativeDb(),
) {
	const now = new Date().toISOString();
	return (
		db
			.prepare(
				`update period_digest_history
				 set coverage_json = ?, updated_at = ?
				 where id = ? and claim_token = ? and status = 'pending'`,
			)
			.run(JSON.stringify(coverage), now, id, claimToken).changes > 0
	);
}

export function completePeriodDigestHistory(
	id: string,
	claimToken: string,
	result: PeriodDigestRunResult,
	db = getNativeDb(),
) {
	const compact = compactContext(result);
	const now = new Date().toISOString();
	const changed = db
		.prepare(
			`update period_digest_history set
				 status = 'ready', include_dms = ?, include_feed = ?, twitter_scope = ?, provider = ?, model = ?,
			 reasoning_effort = ?, service_tier = ?, context_hash = ?,
				 counts_json = ?, coverage_json = ?, digest_json = ?, markdown = ?, tweets_json = ?,
			 dms_json = ?, links_json = ?, feed_json = ?, error = null, finished_at = ?, updated_at = ?
			 where id = ? and claim_token = ? and status = 'pending'`,
		)
		.run(
			result.context.includeDms ? 1 : 0,
			result.context.includeFeed ? 1 : 0,
			result.context.twitterScope === "home" ? "home" : "all",
			result.provider ?? "",
			result.model,
			result.reasoningEffort,
			result.serviceTier,
			result.context.hash,
			JSON.stringify(result.context.counts),
			JSON.stringify(result.coverage ?? {}),
			JSON.stringify(result.digest),
			result.markdown,
			JSON.stringify(compact.tweets),
			JSON.stringify(compact.dms),
			JSON.stringify(compact.links),
			JSON.stringify(compact.feedItems),
			now,
			now,
			id,
			claimToken,
		).changes;
	return changed > 0;
}

export function failPeriodDigestHistory(
	id: string,
	claimToken: string,
	error: unknown,
	db = getNativeDb(),
) {
	const now = new Date().toISOString();
	const message = redactProviderError(
		error instanceof Error ? error.message : String(error),
	).slice(0, 2_000);
	return (
		db
			.prepare(
				`update period_digest_history
				 set status = 'failed', error = ?, finished_at = ?, updated_at = ?
				 where id = ? and claim_token = ? and status = 'pending'`,
			)
			.run(message, now, now, id, claimToken).changes > 0
	);
}

export async function archivePeriodDigestDate(
	date: string,
	{ signal }: { signal?: AbortSignal } = {},
) {
	const claim = claimPeriodDigestDate(date);
	if (!claim.claimed) {
		return { generated: false as const, id: claim.id, status: claim.status };
	}
	const window = localWindowForDateKey(date);
	try {
		const result = await streamPeriodDigest(
			{
				period: "yesterday",
				since: window.since,
				until: window.until,
				includeDms: false,
				includeFeed: true,
				twitterScope: "home",
				refresh: false,
				maxTweets: 5_000,
				maxLinks: 25,
				liveSync: false,
				signal,
				bufferModelDeltasUntilSuccess: true,
				coverageMode: "complete",
			},
			{
				onEvent: (event) => {
					if (event.type === "start") {
						initializePeriodDigestHistoryContext(
							claim.id,
							claim.claimToken,
							event.context,
						);
					}
				},
				onCoverageProgress: (coverage) =>
					updatePeriodDigestHistoryCoverage(
						claim.id,
						claim.claimToken,
						coverage,
					),
			},
		);
		const completed = completePeriodDigestHistory(
			claim.id,
			claim.claimToken,
			result,
		);
		if (!completed) {
			return { generated: false as const, id: claim.id, status: "superseded" };
		}
		return { generated: true as const, id: claim.id, status: "ready" as const };
	} catch (error) {
		failPeriodDigestHistory(claim.id, claim.claimToken, error);
		throw error;
	}
}

export async function archiveIntradayDigestSlot(
	slotKey: string,
	{ signal }: { signal?: AbortSignal } = {},
) {
	const claim = claimIntradayDigestSlot(slotKey);
	if (!claim.claimed) {
		return { generated: false as const, id: claim.id, status: claim.status };
	}
	const window = localWindowForIntradaySlotKey(slotKey);
	try {
		const result = await streamPeriodDigest({
			period: "today",
			since: window.since,
			until: window.until,
			includeDms: false,
			includeFeed: true,
			twitterScope: "home",
			refresh: false,
			maxTweets: 5_000,
			maxLinks: 25,
			liveSync: false,
			signal,
			bufferModelDeltasUntilSuccess: true,
		});
		const completed = completePeriodDigestHistory(
			claim.id,
			claim.claimToken,
			result,
		);
		if (!completed) {
			return { generated: false as const, id: claim.id, status: "superseded" };
		}
		return { generated: true as const, id: claim.id, status: "ready" as const };
	} catch (error) {
		failPeriodDigestHistory(claim.id, claim.claimToken, error);
		throw error;
	}
}

export const __test__ = {
	compactContext,
	detailFromRow,
	metadataFromRow,
};
