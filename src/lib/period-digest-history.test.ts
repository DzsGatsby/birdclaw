// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetBirdclawPathsForTests } from "./config";
import { getNativeDb, resetDatabaseForTests } from "./db";
import {
	claimIntradayDigestSlot,
	claimPeriodDigestDate,
	completePeriodDigestHistory,
	failPeriodDigestHistory,
	getPeriodDigestHistory,
	initializePeriodDigestHistoryContext,
	latestCompletedIntradaySlotKey,
	listPeriodDigestHistory,
	localWindowForDateKey,
	localWindowForIntradaySlotKey,
	nextIntradaySlotKey,
	previousIntradaySlotKey,
	updatePeriodDigestHistoryCoverage,
} from "./period-digest-history";
import type { PeriodDigestCoverage } from "./period-digest-coverage";
import type { PeriodDigestRunResult } from "./period-digest";

let temporaryHome = "";
let originalTimezone: string | undefined;

function resultForDate(date: string): PeriodDigestRunResult {
	const window = localWindowForDateKey(date);
	return {
		context: {
			window: { label: date, ...window },
			includeDms: false,
			includeFeed: true,
			twitterScope: "home",
			counts: {
				home: 4,
				mentions: 1,
				authored: 0,
				likes: 0,
				bookmarks: 0,
				dms: 0,
				links: 2,
				feed: 1,
			},
			tweets: [],
			dms: [],
			links: [],
			feedItems: [
				{
					id: "tiger:flash:history",
					source: "tiger",
					externalId: "history",
					kind: "flash",
					title: "Saved editorial item",
					summary: "",
					url: "https://www.laohu8.com/news/breaking?onlyImportant=true",
					publisher: "Tiger News",
					publishedAt: window.since,
					market: "all",
					language: "zh-CN",
					symbols: [],
					imageUrl: null,
					isImportant: true,
					updatedAt: window.since,
				},
			],
			hash: `hash-${date}`,
		},
		digest: {
			title: `Digest ${date}`,
			summary: "Saved once and restored without model usage.",
			keyTopics: [],
			notableLinks: [],
			people: [],
			actionItems: [],
			sourceTweetIds: [],
		},
		markdown: `# Digest ${date}\n\nSaved report.`,
		provider: "openai",
		model: "gpt-5.5",
		reasoningEffort: "medium",
		serviceTier: "priority",
		cached: false,
		updatedAt: new Date().toISOString(),
	};
}

beforeEach(() => {
	temporaryHome = mkdtempSync(
		path.join(os.tmpdir(), "birdclaw-daily-history-"),
	);
	originalTimezone = process.env.TZ;
	process.env.BIRDCLAW_HOME = temporaryHome;
	resetBirdclawPathsForTests();
	resetDatabaseForTests();
});

afterEach(() => {
	resetDatabaseForTests();
	resetBirdclawPathsForTests();
	delete process.env.BIRDCLAW_HOME;
	if (originalTimezone === undefined) delete process.env.TZ;
	else process.env.TZ = originalTimezone;
	rmSync(temporaryHome, { recursive: true, force: true });
});

describe("daily period digest history", () => {
	it("preserves real counts and verified batch progress after model failure", () => {
		const claim = claimPeriodDigestDate("2026-09-12");
		if (!claim.claimed) throw new Error("Expected claim");
		const context = resultForDate("2026-09-12").context;
		expect(
			initializePeriodDigestHistoryContext(claim.id, claim.claimToken, context),
		).toBe(true);
		const coverage: PeriodDigestCoverage = {
			version: 1,
			expected: 4,
			processed: 2,
			complete: false,
			sourceTruncated: false,
			missingTweetIds: ["3", "4"],
			cited: 0,
			dispositions: {
				substantive: 1,
				supporting: 1,
				duplicate: 0,
				low_signal: 0,
				context_only: 0,
				unreadable: 0,
			},
			batches: [{ index: 0, processed: 2, summary: "first batch" }],
			items: [],
		};
		expect(
			updatePeriodDigestHistoryCoverage(claim.id, claim.claimToken, coverage),
		).toBe(true);
		failPeriodDigestHistory(
			claim.id,
			claim.claimToken,
			new Error("DeepSeek request failed: 402 Insufficient Balance"),
		);
		expect(listPeriodDigestHistory()[0]).toMatchObject({
			status: "failed",
			counts: { home: 4, links: 2, feed: 1 },
			coverage: { expected: 4, processed: 2, complete: false },
			summary: "DeepSeek request failed: 402 Insufficient Balance",
		});
	});

	it("claims one generator per day and restores a completed report", () => {
		const first = claimPeriodDigestDate("2026-07-31");
		expect(first.claimed).toBe(true);
		const duplicate = claimPeriodDigestDate("2026-07-31");
		expect(duplicate).toMatchObject({
			claimed: false,
			id: first.id,
			status: "pending",
		});
		if (!first.claimed) throw new Error("Expected the first claim to win");
		expect(
			completePeriodDigestHistory(
				first.id,
				first.claimToken,
				resultForDate("2026-07-31"),
			),
		).toBe(true);

		const detail = getPeriodDigestHistory(first.id);
		expect(detail?.metadata).toMatchObject({
			date: "2026-07-31",
			status: "ready",
			title: "Digest 2026-07-31",
			provider: "openai",
		});
		expect(detail?.result).toMatchObject({
			markdown: "# Digest 2026-07-31\n\nSaved report.",
			cached: true,
			context: {
				includeFeed: true,
				twitterScope: "home",
				feedItems: [{ id: "tiger:flash:history" }],
			},
		});
		expect(listPeriodDigestHistory()).toHaveLength(1);
	});

	it("restores Home scope independently from the Feed toggle", () => {
		const claim = claimPeriodDigestDate("2026-07-28");
		if (!claim.claimed) throw new Error("Expected claim");
		const result = resultForDate("2026-07-28");
		result.context.includeFeed = false;
		result.context.feedItems = [];
		result.context.counts.feed = 0;
		expect(
			completePeriodDigestHistory(claim.id, claim.claimToken, result),
		).toBe(true);
		expect(getPeriodDigestHistory(claim.id)?.result.context).toMatchObject({
			includeFeed: false,
			twitterScope: "home",
		});
	});

	it("prevents a stale worker from overwriting a reclaimed attempt", () => {
		const first = claimPeriodDigestDate("2026-07-30");
		if (!first.claimed) throw new Error("Expected the first claim to win");
		getNativeDb()
			.prepare("update period_digest_history set updated_at = ? where id = ?")
			.run("2020-01-01T00:00:00.000Z", first.id);
		const second = claimPeriodDigestDate("2026-07-30");
		if (!second.claimed)
			throw new Error("Expected a stale claim to be reclaimed");
		expect(second.claimToken).not.toBe(first.claimToken);
		expect(
			completePeriodDigestHistory(
				first.id,
				first.claimToken,
				resultForDate("2026-07-30"),
			),
		).toBe(false);
		expect(failPeriodDigestHistory(first.id, first.claimToken, "late")).toBe(
			false,
		);
		expect(
			completePeriodDigestHistory(
				second.id,
				second.claimToken,
				resultForDate("2026-07-30"),
			),
		).toBe(true);
	});

	it("never persists a provider key from a generation error", () => {
		const claim = claimPeriodDigestDate("2026-07-29");
		if (!claim.claimed) throw new Error("Expected claim");
		failPeriodDigestHistory(
			claim.id,
			claim.claimToken,
			new Error("provider rejected sk-example-private-value-9876"),
		);
		const [failed] = listPeriodDigestHistory();
		expect(failed?.error).toBe("provider rejected sk-exam...9876");
		expect(failed?.error).not.toContain("sk-example-private-value-9876");
	});

	it("uses local calendar boundaries across a daylight-saving transition", () => {
		process.env.TZ = "America/New_York";
		const springForward = localWindowForDateKey("2026-03-08");
		expect(
			new Date(springForward.until).getTime() -
				new Date(springForward.since).getTime(),
		).toBe(23 * 60 * 60_000);
	});

	it("stores intraday windows beside daily history without mixing the lists", () => {
		process.env.TZ = "Asia/Shanghai";
		const daily = claimPeriodDigestDate("2026-08-17");
		const intraday = claimIntradayDigestSlot("2026-08-18@16");
		if (!daily.claimed || !intraday.claimed) {
			throw new Error("Expected both history claims");
		}
		expect(
			completePeriodDigestHistory(
				daily.id,
				daily.claimToken,
				resultForDate("2026-08-17"),
			),
		).toBe(true);
		expect(
			completePeriodDigestHistory(
				intraday.id,
				intraday.claimToken,
				resultForDate("2026-08-18"),
			),
		).toBe(true);

		expect(listPeriodDigestHistory()).toHaveLength(1);
		expect(listPeriodDigestHistory({ kind: "intraday" })).toEqual([
			expect.objectContaining({
				archiveKey: "2026-08-18@16",
				date: "2026-08-18",
				kind: "intraday",
				slotLabel: "08:00–16:00",
				status: "ready",
			}),
		]);
		expect(getPeriodDigestHistory(intraday.id)?.result.context.window).toEqual({
			label: "2026-08-18 · 08:00–16:00",
			...localWindowForIntradaySlotKey("2026-08-18@16"),
		});
	});

	it("resolves completed slots and advances across local midnight", () => {
		process.env.TZ = "Asia/Shanghai";
		expect(
			latestCompletedIntradaySlotKey(new Date("2026-08-18T21:43:00+08:00")),
		).toBe("2026-08-18@16");
		expect(
			latestCompletedIntradaySlotKey(new Date("2026-08-19T00:01:00+08:00")),
		).toBe("2026-08-18@24");
		expect(nextIntradaySlotKey("2026-08-18@16")).toBe("2026-08-18@24");
		expect(nextIntradaySlotKey("2026-08-18@24")).toBe("2026-08-19@08");
		expect(previousIntradaySlotKey("2026-08-19@08")).toBe("2026-08-18@24");
		const window = localWindowForIntradaySlotKey("2026-08-18@24");
		expect(
			new Date(window.until).getTime() - new Date(window.since).getTime(),
		).toBe(8 * 60 * 60_000);
	});
});
