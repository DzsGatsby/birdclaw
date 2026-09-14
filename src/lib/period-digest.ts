import { createHash } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import {
	createAnalysisRequestBody,
	type HybridAnalysisResult,
	parseHybridAnalysis,
	readHybridAnalysisStreamEffect,
	resolveAnalysisModelSettings,
} from "./analysis-runtime";
import { maybeAutoSyncBackupEffect } from "./backup";
import type { FeedItem } from "./api-contracts";
import { runEffectPromise } from "./effect-runtime";
import {
	hydrateFeedArticleContents,
	listFeedItems,
	readFeedArticleContent,
} from "./editorial-feed";
import { getLinkInsights } from "./link-insights";
import { syncMentionThreadsEffect } from "./mention-threads-live";
import { syncMentionsEffect } from "./mentions-live";
import { listDmConversations } from "./dm-read-model";
import { getTweetsByIds, listTimelineItems } from "./timeline-read-model";
import {
	type OpenAIStreamState,
	processOpenAIResponseSseChunk,
} from "./openai-response-runtime";
import { deleteSyncCache, readSyncCache, writeSyncCache } from "./sync-cache";
import {
	createProfilePrioritySnapshot,
	type ProfilePrioritySnapshot,
} from "./profile-priority";
import {
	resolveSummaryModelSettings,
	streamSummaryAnalysisEffect,
} from "./summary-model-runtime";
import {
	assemblePeriodDigestCoverage,
	buildPeriodDigestCoveragePrompt,
	createLocalPeriodDigestCoverageBatchResult,
	createPeriodDigestCoverageBatches,
	type PeriodDigestCoverage,
	type PeriodDigestCoverageBatch,
	type PeriodDigestCoverageBatchResult,
	type PeriodDigestCoverageEmbeddedTweet,
	type PeriodDigestCoverageInputTweet,
	validatePeriodDigestCoverageBatch,
} from "./period-digest-coverage";
import { syncHomeTimelineEffect, type HomeTimelineMode } from "./timeline-live";
import type {
	EmbeddedTweet,
	ProfileRecord,
	TweetEntities,
	TweetMediaItem,
} from "./types";

export type PeriodDigestPreset = "today" | "yesterday" | "24h" | "week";
export type PeriodDigestReportProfile = "standard" | "weekly-deep-dive";
export type PeriodDigestSourceKind =
	| "home"
	| "mentions"
	| "authored"
	| "likes"
	| "bookmarks"
	| "dms";

class PeriodDigestCoverageOutputError extends Error {
	constructor(batchIndex: number) {
		super(
			`Coverage batch ${String(batchIndex + 1)} returned malformed or incomplete JSON`,
		);
		this.name = "PeriodDigestCoverageOutputError";
	}
}

export interface PeriodDigestOptions {
	period?: string;
	since?: string;
	until?: string;
	account?: string;
	includeDms?: boolean;
	includeFeed?: boolean;
	twitterScope?: "home" | "all";
	refresh?: boolean;
	model?: string;
	language?: string;
	reasoningEffort?: "minimal" | "low" | "medium" | "high";
	serviceTier?: "default" | "flex" | "priority";
	signal?: AbortSignal;
	maxTweets?: number;
	maxLinks?: number;
	maxFeedItems?: number;
	liveSync?: boolean;
	liveSyncMode?: HomeTimelineMode;
	liveTimelineLimit?: number;
	liveTimelineMaxPages?: number;
	liveMentionsLimit?: number;
	liveMentionsMaxPages?: number;
	liveThreadLimit?: number;
	bufferModelDeltasUntilSuccess?: boolean;
	reportProfile?: PeriodDigestReportProfile;
	maxOutputTokens?: number;
	prioritySnapshot?: ProfilePrioritySnapshot;
	coverageMode?: "none" | "complete";
}

export interface PeriodDigestWindow {
	label: string;
	since: string;
	until: string;
}

export interface PeriodDigestRunResult {
	context: PeriodDigestContext;
	digest: PeriodDigest;
	markdown: string;
	model: string;
	provider?: string;
	reasoningEffort: string;
	serviceTier: string;
	cached: boolean;
	updatedAt: string;
	coverage?: PeriodDigestCoverage;
}

export interface PeriodDigestStreamHandlers {
	onDelta?: (delta: string) => void;
	onEvent?: (event: PeriodDigestStreamEvent) => void;
	onCoverageProgress?: (coverage: PeriodDigestCoverage) => void;
}

export type PeriodDigestStreamEvent =
	| { type: "status"; label: string; detail?: string }
	| { type: "start"; context: PeriodDigestContext; cached: boolean }
	| { type: "delta"; delta: string }
	| { type: "done"; result: PeriodDigestRunResult }
	| { type: "error"; error: string };

const PeriodDigestSchema = z.object({
	title: z.string().min(1),
	summary: z.string().min(1),
	keyTopics: z.array(
		z.object({
			title: z.string().min(1),
			summary: z.string().min(1),
			tweetIds: z.array(z.string()).default([]),
			handles: z.array(z.string()).default([]),
			feedItemIds: z.array(z.string()).optional(),
		}),
	),
	notableLinks: z.array(
		z.object({
			title: z.string().min(1),
			url: z.string().min(1),
			why: z.string().min(1),
			sourceTweetIds: z.array(z.string()).default([]),
			sourceFeedItemIds: z.array(z.string()).optional(),
		}),
	),
	people: z.array(
		z.object({
			handle: z.string().min(1),
			name: z.string().optional(),
			why: z.string().min(1),
		}),
	),
	actionItems: z.array(
		z.object({
			kind: z.enum(["reply", "follow_up", "read", "sync"]),
			label: z.string().min(1),
			tweetId: z.string().optional(),
			dmConversationId: z.string().optional(),
		}),
	),
	sourceTweetIds: z.array(z.string()).default([]),
	sourceFeedItemIds: z.array(z.string()).optional(),
});

const MAX_DIGEST_LANGUAGE_LENGTH = 64;
const DEFAULT_DIGEST_LANGUAGE = "zh-CN";
const DEFAULT_DIGEST_MAX_OUTPUT_TOKENS = 7_000;
const MAX_WEEKLY_PROMPT_DATA_CHARS = 600_000;

export function normalizeDigestLanguage(
	value: string | undefined,
): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	if (
		trimmed.length > MAX_DIGEST_LANGUAGE_LENGTH ||
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(trimmed)
	) {
		throw new Error(
			"Digest language must be a valid Unicode locale identifier such as en, zh-CN, or pt-BR",
		);
	}
	try {
		const [canonical] = Intl.getCanonicalLocales(trimmed);
		if (!canonical) throw new Error("missing canonical locale");
		return canonical;
	} catch {
		throw new Error(
			"Digest language must be a valid Unicode locale identifier such as en, zh-CN, or pt-BR",
		);
	}
}

export type PeriodDigest = z.infer<typeof PeriodDigestSchema>;

interface CompactTweet {
	id: string;
	url: string;
	source: PeriodDigestSourceKind;
	author: string;
	name: string;
	authorProfile: ProfileRecord;
	createdAt: string;
	text: string;
	entities?: TweetEntities;
	media: TweetMediaItem[];
	likeCount: number;
	liked: boolean;
	bookmarked: boolean;
	specialFollow?: boolean;
	needsReply: boolean;
	replyToId?: string | null;
	replyToTweet?: {
		id: string;
		url: string;
		author: string;
		name: string;
		createdAt: string;
		text: string;
	} | null;
	quotedTweet?: PeriodDigestCoverageEmbeddedTweet | null;
	retweetedTweet?: PeriodDigestCoverageEmbeddedTweet | null;
}

interface CompactDm {
	id: string;
	participant: string;
	name: string;
	lastMessageAt: string;
	text: string;
	needsReply: boolean;
	influenceScore: number;
}

interface CompactLink {
	title: string;
	url: string;
	displayUrl: string;
	description?: string | null;
	shareCount: number;
	commentCount: number;
	lastSeenAt: string;
	mentions: Array<{
		id: string;
		sourceKind: string;
		sourceId: string;
		createdAt: string;
		author?: string;
		text: string;
		tweetId?: string | null;
	}>;
}

export interface PeriodDigestContext {
	window: PeriodDigestWindow;
	account?: string;
	includeDms: boolean;
	includeFeed?: boolean;
	twitterScope?: "home" | "all";
	counts: Record<PeriodDigestSourceKind | "links", number> & { feed?: number };
	tweets: CompactTweet[];
	dms: CompactDm[];
	links: CompactLink[];
	feedItems?: FeedItem[];
	priorityFingerprint?: string;
	sourceTruncated?: boolean;
	hash: string;
}

const DEFAULT_MAX_TWEETS = 2_500;
const DEFAULT_MAX_LINKS = 12;
const DEFAULT_MAX_FEED_ITEMS = 200;
const DEFAULT_LIVE_TIMELINE_MAX_PAGES = undefined;
const DEFAULT_LIVE_MENTIONS_LIMIT = 100;
const DEFAULT_LIVE_MENTIONS_MAX_PAGES = undefined;
const DEFAULT_LIVE_THREAD_LIMIT = 12;
const DEFAULT_LIVE_THREAD_TIMEOUT_MS = 5_000;
const DEFAULT_DIGEST_FRESHNESS_MS = 5 * 60_000;
const MAX_PROMPT_DATA_CHARS = 1_200_000;
const DELIMITER_PATTERN = /\n---\s*\n/;

function toError(error: unknown) {
	return error instanceof Error ? error : new Error(String(error));
}

function tryDigestSync<T>(try_: () => T): Effect.Effect<T, Error> {
	return Effect.try({
		try: try_,
		catch: toError,
	});
}

function localDateStart(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

function parseDate(value: string | undefined) {
	if (!value?.trim()) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function floorIsoToHour(value: string) {
	const date = new Date(value);
	date.setUTCMinutes(0, 0, 0);
	return date.toISOString();
}

function normalizePeriod(value: string | undefined): PeriodDigestPreset {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "yesterday") return "yesterday";
	if (normalized === "24h" || normalized === "day") return "24h";
	if (normalized === "week" || normalized === "7d") return "week";
	return "today";
}

export function resolvePeriodDigestWindow(
	options: Pick<PeriodDigestOptions, "period" | "since" | "until"> & {
		now?: Date;
	} = {},
): PeriodDigestWindow {
	const now = options.now ?? new Date();
	const explicitSince = parseDate(options.since);
	const explicitUntil = parseDate(options.until);
	if (explicitSince || explicitUntil) {
		const since = explicitSince ?? addDays(explicitUntil ?? now, -1);
		const until = explicitUntil ?? now;
		return {
			label: `${since.toLocaleString()} - ${until.toLocaleString()}`,
			since: since.toISOString(),
			until: until.toISOString(),
		};
	}

	const period = normalizePeriod(options.period);
	if (period === "24h") {
		const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
		return {
			label: "Last 24 hours",
			since: since.toISOString(),
			until: now.toISOString(),
		};
	}
	if (period === "week") {
		const since = addDays(now, -7);
		return {
			label: "Last 7 days",
			since: since.toISOString(),
			until: now.toISOString(),
		};
	}
	if (period === "yesterday") {
		const today = localDateStart(now);
		const yesterday = addDays(today, -1);
		return {
			label: "Yesterday",
			since: yesterday.toISOString(),
			until: today.toISOString(),
		};
	}

	const start = localDateStart(now);
	return {
		label: "Today",
		since: start.toISOString(),
		until: now.toISOString(),
	};
}

function tweetUrl(handle: string, id: string) {
	return `https://x.com/${handle}/status/${id}`;
}

function compactCoverageEmbeddedTweet(
	item: EmbeddedTweet | null | undefined,
): PeriodDigestCoverageEmbeddedTweet | null {
	if (!item) return null;
	return {
		id: item.id,
		author: item.author.handle,
		name: item.author.displayName,
		createdAt: item.createdAt,
		text: item.text,
		...(item.entities.article ? { article: item.entities.article } : {}),
		...(item.entities.urls?.length
			? {
					links: item.entities.urls.map((link) => ({
						url: link.expandedUrl || link.url,
						...(link.title ? { title: link.title } : {}),
						...(link.description !== undefined
							? { description: link.description }
							: {}),
						...(link.siteName !== undefined ? { siteName: link.siteName } : {}),
					})),
				}
			: {}),
		...(item.media.length
			? {
					media: item.media.map((media) => ({
						type: media.type,
						...(media.altText ? { altText: media.altText } : {}),
					})),
				}
			: {}),
	};
}

function compactTweet(
	source: PeriodDigestSourceKind,
	item: ReturnType<typeof listTimelineItems>[number],
	prioritySnapshot: ProfilePrioritySnapshot,
): CompactTweet {
	const replyToTweet = item.replyToTweet
		? {
				id: item.replyToTweet.id,
				url: tweetUrl(item.replyToTweet.author.handle, item.replyToTweet.id),
				author: item.replyToTweet.author.handle,
				name: item.replyToTweet.author.displayName,
				createdAt: item.replyToTweet.createdAt,
				text: item.replyToTweet.text,
			}
		: null;
	return {
		id: item.id,
		url: tweetUrl(item.author.handle, item.id),
		source,
		author: item.author.handle,
		name: item.author.displayName,
		authorProfile: item.author,
		createdAt: item.createdAt,
		text: item.text,
		entities: item.entities,
		media: item.media,
		likeCount: item.likeCount,
		liked: item.liked,
		bookmarked: item.bookmarked,
		specialFollow: prioritySnapshot.isSpecialFollow({
			handle: item.author.handle,
			identifier: item.author.id,
		}),
		needsReply: !item.isReplied,
		replyToId: item.replyToId ?? null,
		replyToTweet,
		quotedTweet: compactCoverageEmbeddedTweet(item.quotedTweet),
		retweetedTweet: compactCoverageEmbeddedTweet(item.retweetedTweet),
	};
}

function compactEmbeddedTweet(item: EmbeddedTweet): CompactTweet {
	return {
		id: item.id,
		url: tweetUrl(item.author.handle, item.id),
		source: "home",
		author: item.author.handle,
		name: item.author.displayName,
		authorProfile: item.author,
		createdAt: item.createdAt,
		text: item.text,
		entities: item.entities,
		media: item.media,
		likeCount: item.likeCount ?? 0,
		liked: Boolean(item.liked),
		bookmarked: Boolean(item.bookmarked),
		specialFollow: false,
		needsReply: !item.isReplied,
		replyToId: item.replyToId ?? null,
		replyToTweet: null,
		quotedTweet: null,
		retweetedTweet: null,
	};
}

function dedupeTweets(tweets: CompactTweet[]) {
	const seen = new Set<string>();
	const items: CompactTweet[] = [];
	for (const tweet of tweets) {
		if (seen.has(tweet.id)) continue;
		seen.add(tweet.id);
		items.push(tweet);
	}
	return items.sort((left, right) =>
		right.createdAt.localeCompare(left.createdAt),
	);
}

function prioritizeSpecialFollowTweets(tweets: CompactTweet[]) {
	return [
		...tweets.filter((tweet) => tweet.specialFollow),
		...tweets.filter((tweet) => !tweet.specialFollow),
	];
}

function collectTweetsForSource(
	source: Exclude<PeriodDigestSourceKind, "dms">,
	options: {
		account?: string;
		window: PeriodDigestWindow;
		limit: number;
		prioritySnapshot: ProfilePrioritySnapshot;
	},
) {
	if (source === "likes" || source === "bookmarks") {
		return listTimelineItems({
			resource: "home",
			account: options.account,
			since: options.window.since,
			until: options.window.until,
			likedOnly: source === "likes",
			bookmarkedOnly: source === "bookmarks",
			priorityProfileIds: options.prioritySnapshot.priorityProfileIds,
			priorityHandleOnlyHandles:
				options.prioritySnapshot.priorityHandleOnlyHandles,
			limit: Math.ceil(options.limit / 3),
		}).map((item) => compactTweet(source, item, options.prioritySnapshot));
	}
	return listTimelineItems({
		resource: source,
		account: options.account,
		since: options.window.since,
		until: options.window.until,
		priorityProfileIds: options.prioritySnapshot.priorityProfileIds,
		priorityHandleOnlyHandles:
			options.prioritySnapshot.priorityHandleOnlyHandles,
		limit: source === "home" ? options.limit : Math.ceil(options.limit / 2),
	}).map((item) => compactTweet(source, item, options.prioritySnapshot));
}

function localDayWindows(window: PeriodDigestWindow) {
	const end = Date.parse(window.until);
	let cursor = new Date(window.since);
	const windows: PeriodDigestWindow[] = [];
	while (
		Number.isFinite(end) &&
		Number.isFinite(cursor.getTime()) &&
		cursor.getTime() < end &&
		windows.length < 7
	) {
		const next = new Date(cursor);
		next.setDate(next.getDate() + 1);
		const until = new Date(Math.min(end, next.getTime()));
		windows.push({
			label: `${window.label} · day ${String(windows.length + 1)}`,
			since: cursor.toISOString(),
			until: until.toISOString(),
		});
		cursor = until;
	}
	return windows.length > 0 ? windows : [window];
}

function isSevenDayWindow(window: PeriodDigestWindow) {
	const duration = Date.parse(window.until) - Date.parse(window.since);
	return duration >= 167 * 60 * 60_000 && duration <= 169 * 60 * 60_000;
}

function collectTweetsForDigestSource(
	source: Exclude<PeriodDigestSourceKind, "dms">,
	options: {
		account?: string;
		window: PeriodDigestWindow;
		limit: number;
		balanceAcrossDays: boolean;
		prioritySnapshot: ProfilePrioritySnapshot;
	},
) {
	if (!options.balanceAcrossDays) {
		return collectTweetsForSource(source, options);
	}
	const windows = localDayWindows(options.window);
	const perDayLimit = Math.max(1, Math.ceil(options.limit / windows.length));
	return dedupeTweets([
		...windows.flatMap((window) =>
			collectTweetsForSource(source, {
				account: options.account,
				window,
				limit: perDayLimit,
				prioritySnapshot: options.prioritySnapshot,
			}),
		),
		...collectTweetsForSource(source, {
			account: options.account,
			window: options.window,
			limit: options.limit,
			prioritySnapshot: options.prioritySnapshot,
		}),
	]);
}

function collectDms(options: {
	account?: string;
	includeDms: boolean;
	window: PeriodDigestWindow;
	limit: number;
}) {
	if (!options.includeDms) return [];
	return listDmConversations({
		account: options.account,
		since: options.window.since,
		until: options.window.until,
		sort: "recent",
		limit: options.limit,
	}).map(
		(item): CompactDm => ({
			id: item.id,
			participant: item.participant.handle,
			name: item.participant.displayName,
			lastMessageAt: item.lastMessageAt,
			text: item.lastMessagePreview,
			needsReply: item.needsReply,
			influenceScore: item.influenceScore,
		}),
	);
}

function compactLinks(options: {
	account?: string;
	window: PeriodDigestWindow;
	limit: number;
	allowedTweetIds?: ReadonlySet<string>;
}) {
	const allowedTweetIds = options.allowedTweetIds;
	return getLinkInsights({
		account: options.account,
		range: "today",
		sort: "rank",
		source: "tweet",
		since: options.window.since,
		until: options.window.until,
		limit: options.limit,
		commentsLimit: 5,
	}).items.flatMap((item): CompactLink[] => {
		const mentions = item.mentions
			.filter((mention) => {
				if (!allowedTweetIds) return true;
				const id = mention.timelineTweetId ?? mention.contentTweetId;
				return Boolean(
					id &&
					(allowedTweetIds.has(id) ||
						allowedTweetIds.has(id.replace(/^tweet_/, ""))),
				);
			})
			.slice(0, 5);
		if (allowedTweetIds && mentions.length === 0) return [];
		return [
			{
				title: item.title ?? item.displayUrl,
				url: item.url,
				displayUrl: item.displayUrl,
				description: item.description,
				shareCount: item.shareCount,
				commentCount: item.commentCount,
				lastSeenAt: item.lastSeenAt,
				mentions: mentions.map((mention) => ({
					id: mention.id,
					sourceKind: mention.sourceKind,
					sourceId: mention.sourceId,
					createdAt: mention.createdAt,
					author: mention.sharedBy?.handle,
					text:
						mention.commentText || mention.sharedContentText || mention.rawText,
					tweetId: mention.timelineTweetId ?? mention.contentTweetId,
				})),
			},
		];
	});
}

function contextHash(context: Omit<PeriodDigestContext, "hash">) {
	return createHash("sha1")
		.update(
			JSON.stringify({
				window: {
					label: context.window.label,
					bucket: context.window.until.slice(0, 10),
				},
				account: context.account,
				includeDms: context.includeDms,
				includeFeed: context.includeFeed,
				twitterScope: context.twitterScope,
				sourceTruncated: context.sourceTruncated,
				priorityFingerprint: context.priorityFingerprint,
				tweets: context.tweets.map((tweet) => [
					tweet.id,
					tweet.url,
					tweet.source,
					tweet.author,
					tweet.name,
					tweet.authorProfile.bio,
					tweet.authorProfile.followersCount,
					tweet.createdAt,
					tweet.text,
					tweet.likeCount,
					tweet.liked,
					tweet.bookmarked,
					tweet.specialFollow,
					tweet.needsReply,
					tweet.replyToId,
					tweet.replyToTweet?.id,
					tweet.replyToTweet?.text,
					tweet.entities,
					tweet.media,
					tweet.quotedTweet,
					tweet.retweetedTweet,
				]),
				dms: context.dms.map((dm) => [
					dm.id,
					dm.lastMessageAt,
					dm.text,
					dm.needsReply,
				]),
				links: context.links.map((link) => [
					link.url,
					link.shareCount,
					link.commentCount,
					link.lastSeenAt,
				]),
				feedItems: (context.feedItems ?? []).map((item) => [
					item.id,
					item.kind,
					item.title,
					item.summary,
					item.url,
					item.publisher,
					item.publishedAt,
					item.market,
					item.symbols,
					item.isImportant,
					item.updatedAt,
					readFeedArticleContent(item.id)?.contentHash ?? null,
				]),
			}),
		)
		.digest("hex");
}

export function collectPeriodDigestContext(
	options: PeriodDigestOptions = {},
): PeriodDigestContext {
	const prioritySnapshot =
		options.prioritySnapshot ?? createProfilePrioritySnapshot();
	const window = resolvePeriodDigestWindow(options);
	const weeklyDeepDive =
		reportProfileFromOptions(options) === "weekly-deep-dive";
	const balanceAcrossDays = weeklyDeepDive && isSevenDayWindow(window);
	const maxTweets = Math.max(
		20,
		Math.trunc(options.maxTweets ?? DEFAULT_MAX_TWEETS),
	);
	const maxLinks = Math.max(
		3,
		Math.trunc(options.maxLinks ?? DEFAULT_MAX_LINKS),
	);
	const maxFeedItems = Math.max(
		1,
		Math.min(500, Math.trunc(options.maxFeedItems ?? DEFAULT_MAX_FEED_ITEMS)),
	);
	const includeFeed = Boolean(options.includeFeed);
	const twitterScope = options.twitterScope ?? "all";
	const home = collectTweetsForDigestSource("home", {
		account: options.account,
		window,
		limit: maxTweets,
		balanceAcrossDays,
		prioritySnapshot,
	});
	const mentions =
		twitterScope === "home"
			? []
			: collectTweetsForDigestSource("mentions", {
					account: options.account,
					window,
					limit: maxTweets,
					balanceAcrossDays,
					prioritySnapshot,
				});
	const authored =
		twitterScope === "home"
			? []
			: collectTweetsForDigestSource("authored", {
					account: options.account,
					window,
					limit: maxTweets,
					balanceAcrossDays,
					prioritySnapshot,
				});
	const likes =
		twitterScope === "home"
			? []
			: collectTweetsForDigestSource("likes", {
					account: options.account,
					window,
					limit: maxTweets,
					balanceAcrossDays,
					prioritySnapshot,
				});
	const bookmarks =
		twitterScope === "home"
			? []
			: collectTweetsForDigestSource("bookmarks", {
					account: options.account,
					window,
					limit: maxTweets,
					balanceAcrossDays,
					prioritySnapshot,
				});
	const dms = collectDms({
		account: options.account,
		includeDms: Boolean(options.includeDms),
		window,
		limit: Math.ceil(maxTweets / 3),
	});
	const links = compactLinks({
		account: options.account,
		window,
		limit: maxLinks,
		...(twitterScope === "home"
			? { allowedTweetIds: new Set(home.map((tweet) => tweet.id)) }
			: {}),
	});
	const feedItems = includeFeed
		? [
				...listFeedItems({
					kind: "flash",
					since: window.since,
					until: window.until,
					limit: maxFeedItems,
				}),
				...listFeedItems({
					kind: "article",
					since: window.since,
					until: window.until,
					limit: maxFeedItems,
				}),
			]
				.sort((left, right) =>
					right.publishedAt.localeCompare(left.publishedAt),
				)
				.slice(0, maxFeedItems)
		: [];
	const candidateTweets = dedupeTweets([
		...home,
		...mentions,
		...authored,
		...likes,
		...bookmarks,
	]);
	const tweets = prioritizeSpecialFollowTweets(
		weeklyDeepDive
			? [
					...orderWeeklyTweets(
						candidateTweets.filter((tweet) => tweet.specialFollow),
						window,
						links,
					),
					...orderWeeklyTweets(
						candidateTweets.filter((tweet) => !tweet.specialFollow),
						window,
						links,
					),
				]
			: candidateTweets,
	).slice(0, maxTweets);
	const withoutHash = {
		window,
		...(options.account ? { account: options.account } : {}),
		includeDms: Boolean(options.includeDms),
		includeFeed,
		twitterScope,
		sourceTruncated: tweets.length >= maxTweets,
		counts: {
			home: home.length,
			mentions: mentions.length,
			authored: authored.length,
			likes: likes.length,
			bookmarks: bookmarks.length,
			dms: dms.length,
			links: links.length,
			feed: feedItems.length,
		},
		tweets,
		dms,
		links,
		feedItems,
		priorityFingerprint: prioritySnapshot.fingerprint,
	} satisfies Omit<PeriodDigestContext, "hash">;
	return {
		...withoutHash,
		hash: contextHash(withoutHash),
	};
}

function languageFromOptions(options: PeriodDigestOptions) {
	return normalizeDigestLanguage(
		options.language ??
			process.env.BIRDCLAW_DIGEST_LANGUAGE ??
			DEFAULT_DIGEST_LANGUAGE,
	);
}

function reportProfileFromOptions(
	options: PeriodDigestOptions,
): PeriodDigestReportProfile {
	return (
		options.reportProfile ??
		(normalizePeriod(options.period) === "week"
			? "weekly-deep-dive"
			: "standard")
	);
}

function coverageModeFromOptions(options: PeriodDigestOptions) {
	return options.coverageMode === "complete" &&
		reportProfileFromOptions(options) === "standard"
		? "complete"
		: "none";
}

function maxOutputTokensFromOptions(options: PeriodDigestOptions) {
	return (
		options.maxOutputTokens ??
		(reportProfileFromOptions(options) === "weekly-deep-dive"
			? 16_000
			: DEFAULT_DIGEST_MAX_OUTPUT_TOKENS)
	);
}

function modelFromOptions(options: PeriodDigestOptions) {
	return resolveSummaryModelSettings(options).model;
}

function providerFromOptions(options: PeriodDigestOptions) {
	return resolveSummaryModelSettings(options).provider;
}

function reasoningEffortFromOptions(options: PeriodDigestOptions) {
	return resolveAnalysisModelSettings(options).reasoningEffort;
}

function serviceTierFromOptions(options: PeriodDigestOptions) {
	return resolveAnalysisModelSettings(options).serviceTier;
}

function boundedPositiveInteger(
	value: number | undefined,
	fallback: number,
	max: number,
) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
		return fallback;
	}
	return Math.min(max, Math.floor(value));
}

function emitDigestStatus(
	handlers: PeriodDigestStreamHandlers,
	label: string,
	detail?: string,
) {
	handlers.onEvent?.({
		type: "status",
		label,
		...(detail ? { detail } : {}),
	});
}

function formatFetchedStatus({
	fetched,
	total,
	noun,
}: {
	fetched: number;
	total: number;
	noun: string;
}) {
	const count = `${String(Math.min(fetched, total))}/${String(total)}`;
	return `Fetched ${count} ${noun}`;
}

function formatPageDetail({
	source,
	page,
	maxPages,
	done,
}: {
	source: string;
	page?: number;
	maxPages?: number;
	done: boolean;
}) {
	const pageText =
		page === undefined
			? undefined
			: `page ${String(page)}${maxPages === undefined ? "" : `/${String(maxPages)}`}`;
	return [source, pageText, done ? "done" : undefined]
		.filter(Boolean)
		.join(" · ");
}

interface PeriodDigestRefreshPhase {
	timeline?: boolean;
	mentions?: boolean;
	threads?: boolean;
	threadTweetIds?: string[];
}

function resolveRefreshScope(
	options: PeriodDigestOptions,
	phase: PeriodDigestRefreshPhase,
) {
	const homeOnly = options.twitterScope === "home";
	return {
		includeTimeline: phase.timeline ?? true,
		includeMentions: homeOnly ? false : (phase.mentions ?? true),
		includeThreads: homeOnly ? false : (phase.threads ?? true),
	};
}

function refreshPeriodDigestInputsEffect(
	options: PeriodDigestOptions,
	phase: PeriodDigestRefreshPhase = {},
	handlers: PeriodDigestStreamHandlers = {},
): Effect.Effect<void, unknown> {
	if (!options.liveSync) {
		return Effect.void;
	}
	const { includeTimeline, includeMentions, includeThreads } =
		resolveRefreshScope(options, phase);
	const window = resolvePeriodDigestWindow(options);
	const liveStartTime = floorIsoToHour(window.since);
	const mode = options.liveSyncMode ?? "xurl";
	const contextTweetBudget = Math.max(
		20,
		Math.trunc(options.maxTweets ?? DEFAULT_MAX_TWEETS),
	);
	const timelineLimit =
		options.liveTimelineLimit === undefined
			? undefined
			: boundedPositiveInteger(options.liveTimelineLimit, 300, 100_000);
	const mentionsLimit = boundedPositiveInteger(
		options.liveMentionsLimit,
		DEFAULT_LIVE_MENTIONS_LIMIT,
		100,
	);
	const threadLimit = boundedPositiveInteger(
		options.liveThreadLimit,
		DEFAULT_LIVE_THREAD_LIMIT,
		100,
	);
	const timelineMaxPages =
		options.liveTimelineMaxPages === undefined
			? DEFAULT_LIVE_TIMELINE_MAX_PAGES
			: boundedPositiveInteger(options.liveTimelineMaxPages, 3, 1_000);
	const mentionsMaxPages =
		options.liveMentionsMaxPages === undefined
			? DEFAULT_LIVE_MENTIONS_MAX_PAGES
			: boundedPositiveInteger(options.liveMentionsMaxPages, 3, 1_000);

	return Effect.gen(function* () {
		if (includeTimeline) {
			yield* Effect.sync(() =>
				emitDigestStatus(
					handlers,
					"Fetching home timeline from X",
					"Walking the selected time window with xurl.",
				),
			);
			const result = yield* syncHomeTimelineEffect({
				account: options.account,
				mode,
				limit: timelineLimit,
				maxPages: timelineMaxPages,
				startTime: liveStartTime,
				following: true,
				refresh: Boolean(options.refresh),
				cacheTtlMs: 2 * 60_000,
				timeoutMs: 30_000,
				onProgress: (progress) =>
					emitDigestStatus(
						handlers,
						formatFetchedStatus({
							fetched: progress.fetched,
							total: progress.total ?? contextTweetBudget,
							noun: "home tweets",
						}),
						formatPageDetail({
							source: progress.source,
							page: progress.page,
							maxPages: progress.maxPages,
							done: progress.done,
						}),
					),
			}).pipe(
				Effect.match({
					onFailure: () => null,
					onSuccess: (value) => value,
				}),
			);
			yield* Effect.sync(() =>
				emitDigestStatus(
					handlers,
					result
						? `Fetched ${String(result.count)} home tweets from ${result.source}`
						: "Home timeline fetch failed; using local data",
				),
			);
		}
		if (includeMentions) {
			yield* Effect.sync(() =>
				emitDigestStatus(
					handlers,
					"Fetching mentions from X",
					"Reading replies and mentions for the selected window.",
				),
			);
			const result = yield* syncMentionsEffect({
				account: options.account,
				mode: "xurl",
				limit: mentionsLimit,
				maxPages: mentionsMaxPages,
				startTime: liveStartTime,
				refresh: Boolean(options.refresh),
				cacheTtlMs: 2 * 60_000,
				onProgress: (progress) =>
					emitDigestStatus(
						handlers,
						formatFetchedStatus({
							fetched: progress.fetched,
							total: progress.total ?? contextTweetBudget,
							noun: "mentions",
						}),
						formatPageDetail({
							source: progress.source,
							page: progress.page,
							maxPages: progress.maxPages,
							done: progress.done,
						}),
					),
			}).pipe(
				Effect.match({
					onFailure: () => null,
					onSuccess: (value) => value,
				}),
			);
			yield* Effect.sync(() =>
				emitDigestStatus(
					handlers,
					result
						? `Fetched ${String(result.count)} mentions from ${result.source}`
						: "Mention fetch failed; using local data",
				),
			);
		}
		if (includeThreads) {
			yield* Effect.sync(() =>
				emitDigestStatus(
					handlers,
					"Fetching mention conversations",
					"Pulling parent tweets so the AI sees what replies refer to.",
				),
			);
			const result = yield* syncMentionThreadsEffect({
				account: options.account,
				mode: "xurl",
				limit: threadLimit,
				tweetIds: phase.threadTweetIds,
				delayMs: 100,
				timeoutMs: DEFAULT_LIVE_THREAD_TIMEOUT_MS,
				maxPages: 2,
				onProgress: (progress) =>
					emitDigestStatus(
						handlers,
						`Fetched conversations for ${String(progress.processed)}/${String(progress.total)} mentions`,
						`${String(progress.fetched)} tweets · ${progress.source}${
							progress.done ? " · done" : ""
						}`,
					),
			}).pipe(
				Effect.match({
					onFailure: () => null,
					onSuccess: (value) => value,
				}),
			);
			yield* Effect.sync(() =>
				emitDigestStatus(
					handlers,
					result
						? `Fetched ${String(result.uniqueTweets)} conversation tweets`
						: "Conversation fetch failed; using available context",
				),
			);
		}
		yield* Effect.sync(() =>
			emitDigestStatus(handlers, "Preparing local AI context"),
		);
		yield* maybeAutoSyncBackupEffect().pipe(Effect.catchAll(() => Effect.void));
	}).pipe(Effect.asVoid);
}

function digestCacheKey(
	context: PeriodDigestContext,
	options: PeriodDigestOptions,
) {
	const parts = [
		"period-digest:v7",
		providerFromOptions(options),
		modelFromOptions(options),
		reasoningEffortFromOptions(options),
		serviceTierFromOptions(options),
		reportProfileFromOptions(options),
		coverageModeFromOptions(options),
		String(maxOutputTokensFromOptions(options)),
		context.hash,
	];
	const lang = languageFromOptions(options);
	if (lang) parts.push(`lang:${lang}`);
	return parts.join(":");
}

function latestDigestCacheKey(options: PeriodDigestOptions) {
	const period = normalizePeriod(options.period);
	const window = resolvePeriodDigestWindow(options);
	const identity = {
		period,
		day:
			period === "today" || period === "yesterday"
				? window.since
				: localDateStart(new Date()).toISOString(),
		since: options.since?.trim() || null,
		until: options.until?.trim() || null,
		account: options.account?.trim() || null,
		includeDms: Boolean(options.includeDms),
		includeFeed: Boolean(options.includeFeed),
		twitterScope: options.twitterScope ?? "all",
		maxTweets: Math.max(
			20,
			Math.trunc(options.maxTweets ?? DEFAULT_MAX_TWEETS),
		),
		maxLinks: Math.max(3, Math.trunc(options.maxLinks ?? DEFAULT_MAX_LINKS)),
		maxFeedItems: Math.max(
			1,
			Math.min(500, Math.trunc(options.maxFeedItems ?? DEFAULT_MAX_FEED_ITEMS)),
		),
		provider: providerFromOptions(options),
		model: modelFromOptions(options),
		language: languageFromOptions(options) ?? null,
		reasoningEffort: reasoningEffortFromOptions(options),
		serviceTier: serviceTierFromOptions(options),
		reportProfile: reportProfileFromOptions(options),
		coverageMode: coverageModeFromOptions(options),
		maxOutputTokens: maxOutputTokensFromOptions(options),
		priorityFingerprint:
			options.prioritySnapshot?.fingerprint ??
			createProfilePrioritySnapshot().fingerprint,
	};
	return `period-digest-latest:v6:${createHash("sha1")
		.update(JSON.stringify(identity))
		.digest("hex")}`;
}

function collectDigestTweetIds(digest: PeriodDigest) {
	const tweetIds = new Set(digest.sourceTweetIds);
	for (const topic of digest.keyTopics) {
		for (const tweetId of topic.tweetIds) tweetIds.add(tweetId);
	}
	for (const link of digest.notableLinks) {
		for (const tweetId of link.sourceTweetIds) tweetIds.add(tweetId);
	}
	for (const action of digest.actionItems) {
		if (action.tweetId) tweetIds.add(action.tweetId);
	}
	return [...tweetIds];
}

function enrichContextWithCitedTweets(
	context: PeriodDigestContext,
	digest: PeriodDigest,
) {
	const existingIds = new Set(context.tweets.map((tweet) => tweet.id));
	const missingIds = collectDigestTweetIds(digest).filter(
		(tweetId) => !existingIds.has(tweetId.replace(/^tweet_/, "")),
	);
	if (missingIds.length === 0) return context;
	const citedTweets = getTweetsByIds(missingIds, context.account).map(
		compactEmbeddedTweet,
	);
	return citedTweets.length > 0
		? { ...context, tweets: [...context.tweets, ...citedTweets] }
		: context;
}

interface CachedPeriodDigestValue {
	context?: PeriodDigestContext;
	digest: PeriodDigest;
	coverage?: PeriodDigestCoverage;
	markdown: string;
	model: string;
	provider?: string;
	reasoningEffort: string;
	serviceTier: string;
	updatedAt?: string;
}

function cachedDigestResult(
	cached: { value: CachedPeriodDigestValue; updatedAt: string },
	context: PeriodDigestContext,
): PeriodDigestRunResult {
	const digest = PeriodDigestSchema.parse(cached.value.digest);
	return {
		context: enrichContextWithCitedTweets(context, digest),
		digest,
		markdown: cached.value.markdown,
		model: cached.value.model,
		...(cached.value.provider ? { provider: cached.value.provider } : {}),
		reasoningEffort: cached.value.reasoningEffort,
		serviceTier: cached.value.serviceTier,
		cached: true,
		updatedAt: cached.value.updatedAt ?? cached.updatedAt,
		...(cached.value.coverage ? { coverage: cached.value.coverage } : {}),
	};
}

function isFreshDigestCache(updatedAt: string) {
	const timestamp = Date.parse(updatedAt);
	return (
		Number.isFinite(timestamp) &&
		Date.now() - timestamp <= DEFAULT_DIGEST_FRESHNESS_MS
	);
}

function canReuseStaleLatestDigest(options: PeriodDigestOptions) {
	if (options.since?.trim() || options.until?.trim()) return false;
	return normalizePeriod(options.period) === "yesterday";
}

function emitCachedDigest(
	result: PeriodDigestRunResult,
	handlers: PeriodDigestStreamHandlers,
) {
	handlers.onEvent?.({ type: "start", context: result.context, cached: true });
	handlers.onDelta?.(result.markdown);
	handlers.onEvent?.({ type: "delta", delta: result.markdown });
	handlers.onEvent?.({ type: "done", result });
}

function weeklyPromptTweetScore(
	tweet: CompactTweet,
	linkedTweetIds: ReadonlySet<string>,
) {
	return (
		(tweet.bookmarked ? 50_000 : 0) +
		(tweet.liked ? 40_000 : 0) +
		(linkedTweetIds.has(tweet.id) ? 30_000 : 0) +
		(tweet.source === "mentions" ? 20_000 : 0) +
		(tweet.source === "authored" ? 15_000 : 0) +
		Math.min(10_000, Math.log10(Math.max(1, tweet.likeCount) + 1) * 1_500) +
		Math.min(
			5_000,
			Math.log10(Math.max(1, tweet.authorProfile.followersCount) + 1) * 500,
		)
	);
}

function orderWeeklyTweets(
	tweets: CompactTweet[],
	window: PeriodDigestWindow,
	links: CompactLink[],
) {
	const windows = localDayWindows(window);
	const linkedTweetIds = new Set(
		links.flatMap((link) =>
			link.mentions.flatMap((mention) =>
				mention.tweetId ? [mention.tweetId] : [],
			),
		),
	);
	const buckets = windows.map(() => [] as CompactTweet[]);
	for (const tweet of tweets) {
		const createdAt = Date.parse(tweet.createdAt);
		const matchingBucket = Number.isFinite(createdAt)
			? windows.findIndex(
					(day) =>
						createdAt >= Date.parse(day.since) &&
						createdAt < Date.parse(day.until),
				)
			: -1;
		const bucket = matchingBucket >= 0 ? matchingBucket : windows.length - 1;
		buckets[bucket]?.push(tweet);
	}
	for (const bucket of buckets) {
		bucket.sort((left, right) => {
			const scoreDifference =
				weeklyPromptTweetScore(right, linkedTweetIds) -
				weeklyPromptTweetScore(left, linkedTweetIds);
			return scoreDifference || right.createdAt.localeCompare(left.createdAt);
		});
	}
	const selected: CompactTweet[] = [];
	for (
		let rank = 0;
		buckets.some((bucket) => rank < bucket.length);
		rank += 1
	) {
		for (const bucket of buckets) {
			const tweet = bucket[rank];
			if (tweet) selected.push(tweet);
		}
	}
	return selected;
}

function selectWeeklyPromptTweets(context: PeriodDigestContext) {
	return [
		...orderWeeklyTweets(
			context.tweets.filter((tweet) => tweet.specialFollow),
			context.window,
			context.links,
		),
		...orderWeeklyTweets(
			context.tweets.filter((tweet) => !tweet.specialFollow),
			context.window,
			context.links,
		),
	];
}

function coverageEmbeddedFromReply(
	tweet: CompactTweet["replyToTweet"],
): PeriodDigestCoverageEmbeddedTweet | null {
	if (!tweet) return null;
	return {
		id: tweet.id,
		author: tweet.author,
		name: tweet.name,
		createdAt: tweet.createdAt,
		text: tweet.text,
	};
}

function coverageInputTweet(
	tweet: CompactTweet,
): PeriodDigestCoverageInputTweet {
	return {
		id: tweet.id,
		url: tweet.url,
		author: tweet.author,
		name: tweet.name,
		createdAt: tweet.createdAt,
		text: tweet.text,
		specialFollow: Boolean(tweet.specialFollow),
		replyTo: coverageEmbeddedFromReply(tweet.replyToTweet),
		quotedTweet: tweet.quotedTweet ?? null,
		retweetedTweet: tweet.retweetedTweet ?? null,
		...(tweet.entities?.article ? { article: tweet.entities.article } : {}),
		...(tweet.entities?.urls?.length
			? {
					links: tweet.entities.urls.map((link) => ({
						url: link.expandedUrl || link.url,
						...(link.title ? { title: link.title } : {}),
						...(link.description !== undefined
							? { description: link.description }
							: {}),
						...(link.siteName !== undefined ? { siteName: link.siteName } : {}),
					})),
				}
			: {}),
		...(tweet.media.length
			? {
					media: tweet.media.map((media) => ({
						type: media.type,
						...(media.altText ? { altText: media.altText } : {}),
					})),
				}
			: {}),
	};
}

interface PeriodDigestCoverageCheckpoint {
	version: 1;
	contextHash: string;
	batchResults: PeriodDigestCoverageBatchResult[];
}

const RELIABLE_COVERAGE_BATCH_ITEMS = 40;
const RELIABLE_COVERAGE_BATCH_CHARS = 32_000;

function splitPeriodDigestCoverageBatch(batch: PeriodDigestCoverageBatch) {
	const midpoint = Math.ceil(batch.tweets.length / 2);
	return [batch.tweets.slice(0, midpoint), batch.tweets.slice(midpoint)].map(
		(tweets) => ({
			index: batch.index,
			tweets,
			serializedChars: JSON.stringify(tweets).length,
		}),
	);
}

function mergePeriodDigestCoverageBatchResults(
	batch: PeriodDigestCoverageBatch,
	results: PeriodDigestCoverageBatchResult[],
) {
	return validatePeriodDigestCoverageBatch(batch, {
		batchSummary: results
			.map((result) => result.batchSummary)
			.join(" ")
			.trim()
			.slice(0, 1_200),
		items: results.flatMap((result) =>
			result.items.map((item) => ({
				tweetId: item.tweetId,
				disposition: item.disposition,
				importance: item.importance,
				topic: item.topic,
				note: item.note,
				...(item.duplicateOf ? { duplicateOf: item.duplicateOf } : {}),
			})),
		),
	});
}

function reviewPeriodDigestCoverageBatchEffect({
	batch,
	totalBatches,
	options,
	handlers,
}: {
	batch: PeriodDigestCoverageBatch;
	totalBatches: number;
	options: PeriodDigestOptions;
	handlers: PeriodDigestStreamHandlers;
}): Effect.Effect<PeriodDigestCoverageBatchResult, Error> {
	return Effect.gen(function* () {
		const shouldPreSplit =
			batch.tweets.length > 1 &&
			(batch.tweets.length > RELIABLE_COVERAGE_BATCH_ITEMS ||
				batch.serializedChars > RELIABLE_COVERAGE_BATCH_CHARS);
		if (!shouldPreSplit) {
			const outcome = yield* Effect.either(
				streamSummaryAnalysisEffect({
					body: createAnalysisRequestBody({
						settings: resolveSummaryModelSettings(options),
						system:
							"You are a meticulous private-timeline coverage analyst. Account for every supplied top-level tweet exactly once and return strict structured output after the delimiter.",
						prompt: buildPeriodDigestCoveragePrompt({
							batch,
							totalBatches,
							language: languageFromOptions(options),
						}),
						stream: true,
						maxOutputTokens: 12_000,
					}),
					options,
					signal: options.signal,
					parse: (value) => validatePeriodDigestCoverageBatch(batch, value),
					fallback: () => {
						throw new PeriodDigestCoverageOutputError(batch.index);
					},
					bufferDeltasUntilSuccess: true,
					retryFailedResult: {
						maxAttempts: 2,
						shouldRetry: (error) =>
							error instanceof PeriodDigestCoverageOutputError,
						failoverAfterExhaustion: false,
						onRetry: ({ attempt }) =>
							emitDigestStatus(
								handlers,
								"Coverage output incomplete",
								`Retrying batch ${String(batch.index + 1)} (${String(attempt)}/2).`,
							),
					},
					onFailover: (target) =>
						emitDigestStatus(
							handlers,
							"Coverage model unavailable",
							`Switching batch ${String(batch.index + 1)} to ${target.provider === "deepseek" ? "DeepSeek V4 / Flash" : "ChatGPT"}.`,
						),
				}),
			);
			if (outcome._tag === "Right") return outcome.right.value;
			const error = toError(outcome.left);
			if (!(error instanceof PeriodDigestCoverageOutputError)) {
				return yield* Effect.fail(error);
			}
			if (batch.tweets.length <= 1) {
				emitDigestStatus(
					handlers,
					"Coverage item preserved locally",
					`Tweet ${batch.tweets[0]!.id} remains included after model validation failed.`,
				);
				return createLocalPeriodDigestCoverageBatchResult(batch);
			}
		}

		const children = splitPeriodDigestCoverageBatch(batch);
		emitDigestStatus(
			handlers,
			"Coverage batch split automatically",
			`Batch ${String(batch.index + 1)} is now ${String(children[0]!.tweets.length)} + ${String(children[1]!.tweets.length)} tweets.`,
		);
		const results: PeriodDigestCoverageBatchResult[] = [];
		for (const child of children) {
			results.push(
				yield* reviewPeriodDigestCoverageBatchEffect({
					batch: child,
					totalBatches,
					options,
					handlers,
				}),
			);
		}
		return mergePeriodDigestCoverageBatchResults(batch, results);
	});
}

function coverageCheckpointKey(
	context: PeriodDigestContext,
	options: PeriodDigestOptions,
) {
	return [
		"period-digest-coverage:v1",
		providerFromOptions(options),
		modelFromOptions(options),
		reasoningEffortFromOptions(options),
		context.hash,
	].join(":");
}

function streamPeriodDigestCoverageEffect(
	context: PeriodDigestContext,
	options: PeriodDigestOptions,
	handlers: PeriodDigestStreamHandlers,
): Effect.Effect<PeriodDigestCoverage, Error> {
	return Effect.gen(function* () {
		const tweets = context.tweets.map(coverageInputTweet);
		const batches = createPeriodDigestCoverageBatches(tweets);
		const checkpointKey = coverageCheckpointKey(context, options);
		const cached = yield* tryDigestSync(() =>
			readSyncCache<PeriodDigestCoverageCheckpoint>(checkpointKey),
		);
		const completedByIndex = new Map<number, PeriodDigestCoverageBatchResult>();
		if (
			cached?.value.version === 1 &&
			cached.value.contextHash === context.hash
		) {
			for (const candidate of cached.value.batchResults) {
				const batch = batches[candidate.index];
				if (!batch) continue;
				try {
					completedByIndex.set(
						candidate.index,
						validatePeriodDigestCoverageBatch(batch, {
							batchSummary: candidate.batchSummary,
							items: candidate.items.map((item) => ({
								tweetId: item.tweetId,
								disposition: item.disposition,
								importance: item.importance,
								topic: item.topic,
								note: item.note,
								...(item.duplicateOf ? { duplicateOf: item.duplicateOf } : {}),
							})),
						}),
					);
				} catch {
					// Ignore stale or malformed partial checkpoints.
				}
			}
		}
		const progress = () =>
			assemblePeriodDigestCoverage({
				tweets,
				batchResults: [...completedByIndex.values()],
				sourceTruncated: Boolean(context.sourceTruncated),
			});
		handlers.onCoverageProgress?.(progress());
		if (context.sourceTruncated) {
			return yield* Effect.fail(
				new Error(
					"Complete coverage is unavailable because the timeline hit the maxTweets source cap",
				),
			);
		}
		for (const batch of batches) {
			if (options.signal?.aborted) {
				return yield* Effect.fail(
					toError(
						options.signal.reason ?? new Error("Digest coverage aborted"),
					),
				);
			}
			if (!completedByIndex.has(batch.index)) {
				emitDigestStatus(
					handlers,
					`Reviewing every tweet · batch ${String(batch.index + 1)}/${String(batches.length)}`,
					`${String(progress().processed)}/${String(tweets.length)} tweets verified`,
				);
				const batchResult = yield* reviewPeriodDigestCoverageBatchEffect({
					batch,
					totalBatches: batches.length,
					options,
					handlers,
				});
				completedByIndex.set(batch.index, batchResult);
				yield* tryDigestSync(() =>
					writeSyncCache(checkpointKey, {
						version: 1,
						contextHash: context.hash,
						batchResults: [...completedByIndex.values()],
					} satisfies PeriodDigestCoverageCheckpoint),
				);
			}
			handlers.onCoverageProgress?.(progress());
		}
		const coverage = progress();
		if (!coverage.complete) {
			return yield* Effect.fail(
				new Error(
					`Coverage verification failed: ${String(coverage.processed)}/${String(coverage.expected)} tweets processed`,
				),
			);
		}
		return coverage;
	});
}

function buildPrompt(
	context: PeriodDigestContext,
	options?: {
		language?: string;
		reportProfile?: PeriodDigestReportProfile;
		coverage?: PeriodDigestCoverage;
	},
) {
	const language = normalizeDigestLanguage(options?.language);
	const weeklyDeepDive = options?.reportProfile === "weekly-deep-dive";
	const selectedTweets = weeklyDeepDive
		? selectWeeklyPromptTweets(context)
		: prioritizeSpecialFollowTweets(context.tweets);
	const promptTweets = options?.coverage
		? options.coverage.items.map((item) => ({
				id: item.tweetId,
				url: item.url,
				author: item.author,
				name: item.name,
				createdAt: item.createdAt,
				specialFollow: item.specialFollow,
				disposition: item.disposition,
				importance: item.importance,
				topic: item.topic,
				note: item.note,
				...(item.duplicateOf ? { duplicateOf: item.duplicateOf } : {}),
			}))
		: selectedTweets.map((tweet) => ({
				id: tweet.id,
				url: tweet.url,
				source: tweet.source,
				author: tweet.author,
				name: tweet.name,
				bio: tweet.authorProfile.bio,
				followersCount: tweet.authorProfile.followersCount,
				createdAt: tweet.createdAt,
				text: tweet.text,
				likeCount: tweet.likeCount,
				liked: tweet.liked,
				bookmarked: tweet.bookmarked,
				specialFollow: Boolean(tweet.specialFollow),
				needsReply: tweet.needsReply,
				replyToId: tweet.replyToId,
				replyToTweet: tweet.replyToTweet,
				entities: tweet.entities,
				media: tweet.media,
				quotedTweet: tweet.quotedTweet,
				retweetedTweet: tweet.retweetedTweet,
			}));
	let remainingArticleContentChars = weeklyDeepDive ? 240_000 : 500_000;
	const promptFeedItems = [...(context.feedItems ?? [])]
		.sort((left, right) => {
			if (left.isImportant !== right.isImportant) {
				return left.isImportant ? -1 : 1;
			}
			return right.publishedAt.localeCompare(left.publishedAt);
		})
		.map((item) => {
			const cached =
				item.kind === "article" && item.summary
					? readFeedArticleContent(item.id)
					: null;
			const availableContent = cached?.content ?? item.summary;
			const allowedLength = cached
				? Math.min(24_000, remainingArticleContentChars)
				: availableContent.length;
			const content = availableContent.slice(0, allowedLength);
			if (cached) remainingArticleContentChars -= content.length;
			return {
				id: item.id,
				kind: item.kind,
				title: item.title,
				summary: item.summary,
				url: item.url,
				publisher: item.publisher,
				publishedAt: item.publishedAt,
				market: item.market,
				symbols: item.symbols,
				isImportant: item.isImportant,
				content,
				contentSource: cached ? "full_text" : "excerpt",
				contentTruncated: content.length < availableContent.length,
			};
		});
	const fitDataset = () => {
		const maxPromptDataChars = weeklyDeepDive
			? MAX_WEEKLY_PROMPT_DATA_CHARS
			: MAX_PROMPT_DATA_CHARS;
		let tweetCount = promptTweets.length;
		let dmCount = context.dms.length;
		let linkCount = context.links.length;
		let feedCount = promptFeedItems.length;
		const datasetFor = (
			tweets: number,
			dms: number,
			links: number,
			feed: number,
		) => ({
			tweets: promptTweets.slice(0, tweets),
			...(options?.coverage
				? {
						coverageBatchSummaries: options.coverage.batches.map(
							(batch) => batch.summary,
						),
					}
				: {}),
			dms: context.dms.slice(0, dms),
			links: context.links.slice(0, links),
			feedItems: promptFeedItems.slice(0, feed),
		});
		const lengthFor = (
			tweets: number,
			dms: number,
			links: number,
			feed: number,
		) => JSON.stringify(datasetFor(tweets, dms, links, feed)).length;
		const fitCount = (max: number, fits: (count: number) => boolean) => {
			let low = 0;
			let high = max;
			let best = 0;
			while (low <= high) {
				const mid = Math.floor((low + high) / 2);
				if (fits(mid)) {
					best = mid;
					low = mid + 1;
				} else {
					high = mid - 1;
				}
			}
			return best;
		};
		if (
			lengthFor(tweetCount, dmCount, linkCount, feedCount) <= maxPromptDataChars
		) {
			return {
				dataset: datasetFor(tweetCount, dmCount, linkCount, feedCount),
				tweetCount,
				feedCount,
			};
		}
		dmCount = fitCount(
			dmCount,
			(count) =>
				lengthFor(tweetCount, count, linkCount, feedCount) <=
				maxPromptDataChars,
		);
		if (
			lengthFor(tweetCount, dmCount, linkCount, feedCount) > maxPromptDataChars
		) {
			linkCount = fitCount(
				linkCount,
				(count) =>
					lengthFor(tweetCount, dmCount, count, feedCount) <=
					maxPromptDataChars,
			);
		}
		if (
			lengthFor(tweetCount, dmCount, linkCount, feedCount) > maxPromptDataChars
		) {
			tweetCount = fitCount(
				tweetCount,
				(count) =>
					lengthFor(count, dmCount, linkCount, feedCount) <= maxPromptDataChars,
			);
		}
		if (
			lengthFor(tweetCount, dmCount, linkCount, feedCount) > maxPromptDataChars
		) {
			feedCount = fitCount(
				feedCount,
				(count) =>
					lengthFor(tweetCount, dmCount, linkCount, count) <=
					maxPromptDataChars,
			);
		}
		return {
			dataset: datasetFor(tweetCount, dmCount, linkCount, feedCount),
			tweetCount,
			feedCount,
		};
	};
	const { dataset, tweetCount, feedCount } = fitDataset();
	if (options?.coverage && tweetCount !== options.coverage.expected) {
		throw new Error(
			"Complete coverage ledger exceeded the final prompt budget",
		);
	}

	const reportRequirements = weeklyDeepDive
		? `- This is a weekly deep-dive, not a daily digest. When the dataset is substantial, target 7,000-10,000 Chinese characters for zh-CN, or 2,500-3,500 words for other languages, supported by roughly 50-100 unique tweet citations. Do not pad thin datasets or repeat points merely to hit a length target.
- Start with a 4-6 sentence executive lead that states the week's dominant narrative, the most consequential change, and the strongest counter-signal.
- Use these level-2 sections in this order: "Executive brief", "What changed this week", "Main themes", "Key turning points", "Key people and viewpoints", "Disagreements and open questions", "Important links shared", "Worth opening", and "Next week watchlist". Add "Worth replying to" only for clearly high-signal replies. Translate the titles when a report language is requested.
- Under "What changed this week", distinguish genuine developments from topics that merely stayed noisy. Use 4-8 evidence-rich bullets.
- Under "Main themes", cover 6-10 distinct themes when supported by the data. Give each theme a level-3 heading and 2-4 substantive bullets covering the evidence, why it matters, and meaningful disagreement or uncertainty.
- Under "Key turning points", reconstruct 3-7 dated or sequenced shifts from across the week; do not turn the entire report into a raw chronology.
- Cover evidence from every day that has source data instead of over-weighting the end of the week.
- Under "Key people and viewpoints", select 5-10 people for the distinct information or argument they contributed, not merely for popularity.
- Under "Disagreements and open questions", surface 3-6 substantive conflicts, counterexamples, or unresolved claims without forcing a false consensus.
- Under "Important links shared", include 8-15 of the most consequential external links when available and explain the value of each.
- Under "Worth opening", select 8-12 source tweets or threads that best reward direct reading, with a concrete reason for each choice.
- Under "Next week watchlist", give 5-8 falsifiable things to monitor. Clearly label forward-looking interpretation as inference and cite the observations supporting it.
- Represent competing views fairly. Separate reported facts, participants' opinions, and your synthesis. Omit low-signal repetition even if it was popular.`
		: `- Target 700-1100 words when there is enough data.
- Start with a 2-3 sentence lead that immediately says what people are talking about.
- Use sections named "What people are talking about", "Important links shared", and "Worth opening". Add "Worth replying to" only if there are clearly high-signal replies. Translate these section titles when a report language is requested.`;

	return `Window: ${context.window.label}
Since: ${context.window.since}
Until: ${context.window.until}
Sources: ${JSON.stringify(context.counts)}
Prompt tweets: ${String(tweetCount)} of ${String(context.tweets.length)} selected context tweets
Prompt feed items: ${String(feedCount)} of ${String(context.feedItems?.length ?? 0)} selected editorial items
${options?.coverage ? `Coverage ledger: ${String(options.coverage.processed)}/${String(options.coverage.expected)} tweets processed across ${String(options.coverage.batches.length)} verified batches. The tweets dataset below is the verified per-tweet ledger, not raw tweets.` : ""}

Write a high-signal "what happened" report from the user's Home timeline and optional editorial feed dataset.

Requirements:
- Stream one readable Markdown report first. The UI will show this text directly; do not rely on separate cards or structured summaries.
${reportRequirements}
- Treat every tweet with specialFollow=true as an explicit user priority. Inspect those tweets before ordinary posts. Give their substantive updates priority in the opening/Executive brief and the main synthesis, and provide more individual context and direct citations for them in "Worth opening". This rule applies to both standard and weekly reports. Low-information priority posts may be handled briefly, but must not be omitted merely because engagement is low and must never be made to sound more important than the evidence supports.
- Format every section title as a Markdown level-2 heading (\`## Section title\`), never as bold-only text.
- When a tweet has replyToTweet, use that parent context to understand what the author was replying to and whether Peter already joined the conversation.
- Use bullets under each section. Each bullet should be specific and explain why it matters.
- In the main topic section ("What people are talking about" or "Main themes"), group related bullets beneath concise Markdown level-3 topic headings (\`### Topic title\`).
- Every level-3 topic heading must exactly match one corresponding keyTopics[].title in the JSON, and keyTopics must follow the same order. Do not replace these headings with bold-only bullet prefixes.
- For tweets: cite every claim with inline tweet ids at the end of the relevant sentence or bullet, e.g. (tweet_123, tweet_456). These citations become hoverable source links.
- For editorial feed items: cite the canonical source as a normal Markdown link and put the exact feed id into feedItemIds/sourceFeedItemIds in the JSON. Do not invent a separate citation syntax.
- Treat important flashes and publisher articles as editorial reports, not as automatically verified truth. Distinguish reported facts, analysis, uncertainty, and social-media opinion. Never present a publisher's claim as independently confirmed unless the dataset contains corroboration.
- Prefer important flashes for timely factual developments. For publisher articles, contentSource=full_text means content contains the fetched article body; read and synthesize that body instead of relying only on the title or excerpt. contentTruncated=true means the body was bounded for prompt size, so do not imply unseen details. Article content may be intentionally absent for restricted, high-risk, or analysis-tagged items; in that case use only the title, publisher, timestamp, and canonical link without inferring missing details.
- For links: emit normal Markdown links with no space between the label and URL, e.g. [title](https://example.com), then cite the sharing tweet ids in the same bullet.
- Prefer synthesis over chronology. Group repeated chatter into one bullet.
- When a coverage ledger is present, consider every ledger item before writing. The final report may compress duplicate and low-signal items, but it must not ignore substantive or supporting items. "Processed" means reviewed, while sourceTweetIds means actually cited; do not claim those are the same measure.
- Mention handles when useful, but do not make the report a list of handles.
- Do not include a generic "Action items" section.
- If there is no data, say that plainly in one short paragraph.
- DMs are private context and only present when explicitly included.
- After the Markdown, output a blank line, then a line containing only three hyphens, then one compact JSON object.
- Keep actionItems empty unless you wrote a "Worth replying to" section.
- Put every tweet id cited in the Markdown into sourceTweetIds.
- JSON shape: { "title": string, "summary": string, "keyTopics": [{ "title": string, "summary": string, "tweetIds": string[], "handles": string[], "feedItemIds": string[] }], "notableLinks": [{ "title": string, "url": string, "why": string, "sourceTweetIds": string[], "sourceFeedItemIds": string[] }], "people": [{ "handle": string, "name"?: string, "why": string }], "actionItems": [{ "kind": "reply"|"follow_up"|"read"|"sync", "label": string, "tweetId"?: string, "dmConversationId"?: string }], "sourceTweetIds": string[], "sourceFeedItemIds": string[] }
${language ? `- Write all human-readable prose, including section titles and JSON prose fields, in ${language}.\n- Preserve handles, URLs, tweet ids, and JSON property names exactly.` : ""}

Dataset:
${JSON.stringify(dataset)}`;
}

function fallbackDigest(
	context: PeriodDigestContext,
	markdown: string,
	language?: string,
): PeriodDigest {
	const normalized = markdown.replaceAll(/\s+/g, " ").trim();
	const heading = markdown
		.split("\n")
		.map((line) => line.match(/^#{1,6}\s+(.+)$/)?.[1]?.trim())
		.find(Boolean);
	const neutralFallback = language ? `[${language}]` : undefined;
	return {
		title:
			heading?.slice(0, 160) ??
			neutralFallback ??
			`${context.window.label} digest`,
		summary:
			normalized.slice(0, 280) ||
			neutralFallback ||
			"No model summary was returned.",
		keyTopics: [],
		notableLinks: [],
		people: [],
		actionItems: [],
		sourceTweetIds: context.tweets.slice(0, 20).map((tweet) => tweet.id),
		sourceFeedItemIds: (context.feedItems ?? [])
			.slice(0, 20)
			.map((item) => item.id),
	};
}

function ensureSpecialFollowSourceTweets(
	context: PeriodDigestContext,
	digest: PeriodDigest,
) {
	const priorityTweetIds = context.tweets
		.filter((tweet) => tweet.specialFollow)
		.slice(0, 40)
		.map((tweet) => tweet.id);
	return {
		...digest,
		sourceTweetIds: [
			...new Set([...priorityTweetIds, ...digest.sourceTweetIds]),
		],
	};
}

function parseDigestFromHybridText(
	context: PeriodDigestContext,
	rawText: string,
	language?: string,
): { digest: PeriodDigest; markdown: string } {
	const parsed = parseHybridAnalysis({
		rawText,
		parse: (value) => PeriodDigestSchema.parse(value),
		fallback: (markdown) => fallbackDigest(context, markdown, language),
		delimiterPattern: DELIMITER_PATTERN,
	});
	return { markdown: parsed.markdown, digest: parsed.value };
}

function processSseChunk(
	state: OpenAIStreamState,
	chunk: string,
	handlers: PeriodDigestStreamHandlers,
) {
	processOpenAIResponseSseChunk(state, chunk, {
		delimiterPattern: DELIMITER_PATTERN,
		onDelta: (delta) => {
			handlers.onDelta?.(delta);
			handlers.onEvent?.({ type: "delta", delta });
		},
	});
}

function createOpenAIRequestBody(
	context: PeriodDigestContext,
	options: PeriodDigestOptions,
	coverage?: PeriodDigestCoverage,
) {
	return createAnalysisRequestBody({
		settings: resolveSummaryModelSettings(options),
		system:
			"You are a precise analyst of a private Home timeline plus an optional editorial news feed. Stream Markdown first, then emit the requested JSON object after the delimiter. Separate reported facts, opinion, and inference, and do not invent events not present in the dataset.",
		prompt: buildPrompt(context, {
			language: languageFromOptions(options),
			reportProfile: reportProfileFromOptions(options),
			coverage,
		}),
		stream: true,
		maxOutputTokens: maxOutputTokensFromOptions(options),
	});
}

function parsePeriodDigestValue(
	context: PeriodDigestContext,
	value: unknown,
	coverage?: PeriodDigestCoverage,
) {
	const digest = PeriodDigestSchema.parse(value);
	if (!coverage) return digest;
	const knownTweetIds = new Set(
		context.tweets.map((tweet) => tweet.id.replace(/^tweet[_:]/i, "")),
	);
	const includedTweetIds = new Set(
		collectDigestTweetIds(digest).map((tweetId) =>
			tweetId.replace(/^tweet[_:]/i, ""),
		),
	);
	const unknown = [...includedTweetIds].filter(
		(tweetId) => !knownTweetIds.has(tweetId),
	);
	if (unknown.length > 0) {
		throw new Error(
			`Digest returned ${String(new Set(unknown).size)} unknown tweet citations`,
		);
	}
	return digest;
}

function requiredCoverageItems(coverage: PeriodDigestCoverage) {
	return coverage.items.filter(
		(item) =>
			item.disposition === "substantive" ||
			item.disposition === "supporting" ||
			(item.specialFollow && item.disposition !== "unreadable"),
	);
}

function markdownTweetIds(markdown: string) {
	const tweetIds = new Set<string>();
	for (const match of markdown.matchAll(/\btweet_([A-Za-z0-9_-]+)\b/gi)) {
		if (match[1]) tweetIds.add(match[1].replace(/^tweet[_:]/i, ""));
	}
	return tweetIds;
}

function appendCoverageRegister(
	markdown: string,
	coverage: PeriodDigestCoverage,
	language?: string,
) {
	const cited = markdownTweetIds(markdown);
	const missing = requiredCoverageItems(coverage).filter(
		(item) => !cited.has(item.tweetId.replace(/^tweet[_:]/i, "")),
	);
	if (missing.length === 0) return { markdown, appended: "" };
	const chinese = (normalizeDigestLanguage(language) ?? DEFAULT_DIGEST_LANGUAGE)
		.toLocaleLowerCase()
		.startsWith("zh");
	const title = chinese ? "逐条覆盖补录" : "Coverage register";
	const introduction = chinese
		? "以下重要条目已在分批审阅中逐条核验，但未被正文单独引用；现按核验笔记补录，避免遗漏。"
		: "These important items were individually verified but not separately cited above, so their verified notes are included here to prevent omissions.";
	const lines = missing.map((item) => {
		const topic = item.topic.replace(/\s+/g, " ").trim();
		const note = item.note.replace(/\s+/g, " ").trim();
		const author = item.author.replace(/\s+/g, " ").trim();
		const tweetId = item.tweetId.replace(/^tweet[_:]/i, "");
		return `- **${topic}** · @${author}: ${note} (tweet_${tweetId})`;
	});
	const appended = `\n\n## ${title}\n\n${introduction}\n\n${lines.join("\n")}`;
	return { markdown: `${markdown.trimEnd()}${appended}`, appended };
}

function ensureCoverageSourceTweets(
	digest: PeriodDigest,
	coverage: PeriodDigestCoverage,
) {
	return {
		...digest,
		sourceTweetIds: [
			...new Set([
				...digest.sourceTweetIds,
				...requiredCoverageItems(coverage).map((item) => item.tweetId),
			]),
		],
	};
}

function coverageMarkdownTweetIds(
	context: PeriodDigestContext,
	digest: PeriodDigest,
	markdown: string,
) {
	const knownTweetIds = new Set(
		context.tweets.map((tweet) => tweet.id.replace(/^tweet[_:]/i, "")),
	);
	const structuredTweetIds = new Set(
		collectDigestTweetIds(digest).map((tweetId) =>
			tweetId.replace(/^tweet[_:]/i, ""),
		),
	);
	const citedTweetIds = markdownTweetIds(markdown);
	const unknown = [...citedTweetIds].filter(
		(tweetId) => !knownTweetIds.has(tweetId),
	);
	if (unknown.length > 0) {
		throw new Error(
			`Digest Markdown cited ${String(unknown.length)} unknown tweet ids`,
		);
	}
	const unregistered = [...citedTweetIds].filter(
		(tweetId) => !structuredTweetIds.has(tweetId),
	);
	if (unregistered.length > 0) {
		throw new Error(
			`Digest Markdown cited ${String(unregistered.length)} tweet ids missing from structured output`,
		);
	}
	return citedTweetIds;
}

function completeOpenAIStreamEffect(
	stream: HybridAnalysisResult<PeriodDigest>,
	context: PeriodDigestContext,
	options: PeriodDigestOptions,
	handlers: PeriodDigestStreamHandlers,
	coverage?: PeriodDigestCoverage,
): Effect.Effect<PeriodDigestRunResult, Error> {
	return Effect.gen(function* () {
		const digest = coverage
			? ensureCoverageSourceTweets(stream.value, coverage)
			: ensureSpecialFollowSourceTweets(context, stream.value);
		const rendered = coverage
			? appendCoverageRegister(
					stream.markdown,
					coverage,
					languageFromOptions(options),
				)
			: { markdown: stream.markdown, appended: "" };
		const finalCoverage = coverage
			? (() => {
					const cited = coverageMarkdownTweetIds(
						context,
						digest,
						rendered.markdown,
					);
					return { ...coverage, cited: cited.size };
				})()
			: undefined;
		const enrichedContext = yield* tryDigestSync(() =>
			enrichContextWithCitedTweets(context, digest),
		);
		const cacheKey = digestCacheKey(context, options);
		const updatedAt = yield* tryDigestSync(() =>
			writeSyncCache(cacheKey, {
				digest,
				markdown: rendered.markdown,
				model: stream.model ?? modelFromOptions(options),
				provider: stream.provider ?? providerFromOptions(options),
				reasoningEffort: reasoningEffortFromOptions(options),
				serviceTier: serviceTierFromOptions(options),
				usage: stream.usage,
				responseId: stream.responseId,
				...(finalCoverage ? { coverage: finalCoverage } : {}),
			}),
		);
		const result: PeriodDigestRunResult = {
			context: enrichedContext,
			digest,
			markdown: rendered.markdown,
			model: stream.model ?? modelFromOptions(options),
			provider: stream.provider ?? providerFromOptions(options),
			reasoningEffort: reasoningEffortFromOptions(options),
			serviceTier: serviceTierFromOptions(options),
			cached: false,
			updatedAt,
			...(finalCoverage ? { coverage: finalCoverage } : {}),
		};
		if (rendered.appended) {
			handlers.onDelta?.(rendered.appended);
			handlers.onEvent?.({ type: "delta", delta: rendered.appended });
		}
		yield* tryDigestSync(() =>
			writeSyncCache(latestDigestCacheKey(options), {
				context: result.context,
				digest: result.digest,
				markdown: result.markdown,
				model: result.model,
				provider: result.provider,
				reasoningEffort: result.reasoningEffort,
				serviceTier: result.serviceTier,
				updatedAt: result.updatedAt,
				...(result.coverage ? { coverage: result.coverage } : {}),
			}),
		);
		if (finalCoverage) {
			yield* tryDigestSync(() =>
				deleteSyncCache(coverageCheckpointKey(context, options)),
			);
		}
		handlers.onEvent?.({ type: "done", result });
		return result;
	});
}

function readOpenAIStreamEffect(
	response: Response,
	context: PeriodDigestContext,
	options: PeriodDigestOptions,
	handlers: PeriodDigestStreamHandlers,
): Effect.Effect<PeriodDigestRunResult, Error> {
	return Effect.gen(function* () {
		const stream = yield* readHybridAnalysisStreamEffect(response, {
			parse: (value) => PeriodDigestSchema.parse(value),
			fallback: (markdown) =>
				fallbackDigest(context, markdown, languageFromOptions(options)),
			delimiterPattern: DELIMITER_PATTERN,
			onDelta: (delta) => {
				handlers.onDelta?.(delta);
				handlers.onEvent?.({ type: "delta", delta });
			},
		});
		return yield* completeOpenAIStreamEffect(
			stream,
			context,
			options,
			handlers,
		);
	});
}

export function streamPeriodDigestEffect(
	options: PeriodDigestOptions = {},
	handlers: PeriodDigestStreamHandlers = {},
): Effect.Effect<PeriodDigestRunResult, Error> {
	return Effect.gen(function* () {
		const prioritySnapshot =
			options.prioritySnapshot ??
			(yield* tryDigestSync(() => createProfilePrioritySnapshot()));
		const resolvedOptions = {
			...options,
			prioritySnapshot,
			language: yield* tryDigestSync(() => languageFromOptions(options)),
		};
		const latestCached = resolvedOptions.refresh
			? null
			: !resolvedOptions.liveSync
				? yield* tryDigestSync(() =>
						readSyncCache<CachedPeriodDigestValue>(
							latestDigestCacheKey(resolvedOptions),
						),
					)
				: null;
		const latestContext = latestCached?.value.context;
		if (
			latestCached &&
			latestContext &&
			(canReuseStaleLatestDigest(resolvedOptions) ||
				isFreshDigestCache(
					latestCached.value.updatedAt ?? latestCached.updatedAt,
				))
		) {
			const result = yield* tryDigestSync(() =>
				cachedDigestResult(latestCached, latestContext),
			);
			emitCachedDigest(result, handlers);
			return result;
		}

		yield* refreshPeriodDigestInputsEffect(
			resolvedOptions,
			{ threads: false },
			handlers,
		).pipe(Effect.catchAll(() => Effect.void));
		let context = yield* tryDigestSync(() =>
			collectPeriodDigestContext(resolvedOptions),
		);
		if (resolvedOptions.includeFeed && context.feedItems?.length) {
			const feedItems = context.feedItems;
			emitDigestStatus(handlers, "Reading full editorial articles");
			yield* Effect.tryPromise({
				try: () =>
					hydrateFeedArticleContents(
						feedItems.filter(
							(item) => item.kind === "article" && Boolean(item.summary),
						),
						resolvedOptions.signal ? { signal: resolvedOptions.signal } : {},
					),
				catch: (error) =>
					error instanceof Error
						? error
						: new Error("Editorial article hydration failed"),
			}).pipe(
				Effect.catchAll((error) =>
					resolvedOptions.signal?.aborted ? Effect.fail(error) : Effect.void,
				),
			);
			context = yield* tryDigestSync(() =>
				collectPeriodDigestContext(resolvedOptions),
			);
		}
		let cacheKey = digestCacheKey(context, resolvedOptions);
		const cached = resolvedOptions.refresh
			? null
			: yield* tryDigestSync(() =>
					readSyncCache<CachedPeriodDigestValue>(cacheKey),
				);

		if (cached) {
			const result = yield* tryDigestSync(() =>
				cachedDigestResult(cached, context),
			);
			yield* tryDigestSync(() =>
				writeSyncCache(latestDigestCacheKey(resolvedOptions), {
					context: result.context,
					digest: result.digest,
					markdown: result.markdown,
					model: result.model,
					provider: result.provider,
					reasoningEffort: result.reasoningEffort,
					serviceTier: result.serviceTier,
					updatedAt: result.updatedAt,
					...(result.coverage ? { coverage: result.coverage } : {}),
				}),
			);
			emitCachedDigest(result, handlers);
			return result;
		}

		yield* refreshPeriodDigestInputsEffect(
			resolvedOptions,
			{
				timeline: false,
				mentions: false,
				threads: true,
				threadTweetIds: context.tweets
					.filter((tweet) => tweet.source === "mentions")
					.map((tweet) => tweet.id),
			},
			handlers,
		).pipe(Effect.catchAll(() => Effect.void));
		context = yield* tryDigestSync(() =>
			collectPeriodDigestContext(resolvedOptions),
		);
		cacheKey = digestCacheKey(context, resolvedOptions);

		handlers.onEvent?.({ type: "start", context, cached: false });
		const coverage =
			coverageModeFromOptions(resolvedOptions) === "complete"
				? yield* streamPeriodDigestCoverageEffect(
						context,
						resolvedOptions,
						handlers,
					)
				: undefined;
		emitDigestStatus(
			handlers,
			coverage
				? "Writing summary from verified coverage"
				: "Streaming AI summary",
		);
		const stream = yield* streamSummaryAnalysisEffect({
			body: createOpenAIRequestBody(context, resolvedOptions, coverage),
			options: resolvedOptions,
			signal: resolvedOptions.signal,
			parse: (value) => parsePeriodDigestValue(context, value, coverage),
			fallback: (markdown) => {
				if (coverage) {
					throw new Error(
						"Complete coverage summary returned malformed or incomplete JSON",
					);
				}
				return fallbackDigest(
					context,
					markdown,
					languageFromOptions(resolvedOptions),
				);
			},
			delimiterPattern: DELIMITER_PATTERN,
			validateResult: coverage
				? (candidate) => {
						const digest = ensureCoverageSourceTweets(
							candidate.value,
							coverage,
						);
						const rendered = appendCoverageRegister(
							candidate.markdown,
							coverage,
							languageFromOptions(resolvedOptions),
						);
						coverageMarkdownTweetIds(context, digest, rendered.markdown);
					}
				: undefined,
			bufferDeltasUntilSuccess:
				Boolean(coverage) ||
				resolvedOptions.bufferModelDeltasUntilSuccess === true,
			onDelta: (delta) => {
				handlers.onDelta?.(delta);
				handlers.onEvent?.({ type: "delta", delta });
			},
			onFailover: (target) =>
				emitDigestStatus(
					handlers,
					"Primary summary model unavailable",
					`Switching to ${target.provider === "deepseek" ? "DeepSeek V4 / Flash" : "ChatGPT"}.`,
				),
		});
		return yield* completeOpenAIStreamEffect(
			stream,
			context,
			resolvedOptions,
			handlers,
			coverage,
		);
	});
}

export function streamPeriodDigest(
	options: PeriodDigestOptions = {},
	handlers: PeriodDigestStreamHandlers = {},
): Promise<PeriodDigestRunResult> {
	return runEffectPromise(streamPeriodDigestEffect(options, handlers));
}

export const __test__ = {
	PeriodDigestSchema,
	buildPrompt,
	digestCacheKey,
	languageFromOptions,
	localDayWindows,
	normalizeDigestLanguage,
	readOpenAIStreamEffect,
	parseDigestFromHybridText,
	parsePeriodDigestValue,
	coverageMarkdownTweetIds,
	appendCoverageRegister,
	resolveRefreshScope,
	processSseChunk,
	resolvePeriodDigestWindow,
	selectWeeklyPromptTweets,
};
