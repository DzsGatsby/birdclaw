import { z } from "zod";

export const PERIOD_DIGEST_COVERAGE_VERSION = 1 as const;
export const DEFAULT_COVERAGE_BATCH_SIZE = 80;
export const DEFAULT_COVERAGE_BATCH_CHARS = 60_000;

export const PeriodDigestCoverageDispositionSchema = z.enum([
	"substantive",
	"supporting",
	"duplicate",
	"low_signal",
	"context_only",
	"unreadable",
]);

export type PeriodDigestCoverageDisposition = z.infer<
	typeof PeriodDigestCoverageDispositionSchema
>;

export interface PeriodDigestCoverageInputTweet {
	id: string;
	url: string;
	author: string;
	name: string;
	createdAt: string;
	text: string;
	specialFollow?: boolean;
	replyTo?: PeriodDigestCoverageEmbeddedTweet | null;
	quotedTweet?: PeriodDigestCoverageEmbeddedTweet | null;
	retweetedTweet?: PeriodDigestCoverageEmbeddedTweet | null;
	article?: {
		title: string;
		previewText?: string;
		url: string;
	} | null;
	links?: Array<{
		url: string;
		title?: string;
		description?: string | null;
		siteName?: string | null;
	}>;
	media?: Array<{
		type: string;
		altText?: string;
	}>;
}

export interface PeriodDigestCoverageEmbeddedTweet {
	id: string;
	author: string;
	name: string;
	createdAt: string;
	text: string;
	article?: PeriodDigestCoverageInputTweet["article"];
	links?: PeriodDigestCoverageInputTweet["links"];
	media?: PeriodDigestCoverageInputTweet["media"];
}

export interface PeriodDigestCoverageBatch {
	index: number;
	tweets: PeriodDigestCoverageInputTweet[];
	serializedChars: number;
}

const RawCoverageItemSchema = z
	.object({
		tweetId: z.string().min(1),
		disposition: PeriodDigestCoverageDispositionSchema,
		importance: z.enum(["high", "medium", "low"]),
		topic: z.string().trim().min(1).max(120),
		note: z.string().trim().min(1).max(320),
		duplicateOf: z.string().min(1).optional(),
	})
	.strict();

export const PeriodDigestCoverageBatchOutputSchema = z
	.object({
		batchSummary: z.string().trim().min(1).max(1_200),
		items: z.array(RawCoverageItemSchema),
	})
	.strict();

export type PeriodDigestCoverageItem = z.infer<typeof RawCoverageItemSchema> & {
	author: string;
	name: string;
	url: string;
	createdAt: string;
	specialFollow: boolean;
};

export interface PeriodDigestCoverageBatchResult {
	index: number;
	batchSummary: string;
	items: PeriodDigestCoverageItem[];
}

export interface PeriodDigestCoverage {
	version: typeof PERIOD_DIGEST_COVERAGE_VERSION;
	expected: number;
	processed: number;
	complete: boolean;
	sourceTruncated: boolean;
	missingTweetIds: string[];
	cited: number;
	dispositions: Record<PeriodDigestCoverageDisposition, number>;
	batches: Array<{
		index: number;
		processed: number;
		summary: string;
	}>;
	items: PeriodDigestCoverageItem[];
}

function normalizeTweetId(value: string) {
	return value.trim().replace(/^tweet[_:]/i, "");
}

function visibleTweetContent(tweet: PeriodDigestCoverageInputTweet) {
	return [
		tweet.text,
		tweet.article?.title,
		tweet.article?.previewText,
		...(tweet.links ?? []).flatMap((link) => [
			link.title,
			link.description ?? undefined,
		]),
		...(tweet.media ?? []).map((media) => media.altText),
		tweet.replyTo?.text,
		tweet.quotedTweet?.text,
		tweet.retweetedTweet?.text,
	]
		.filter((value): value is string => Boolean(value?.trim()))
		.join(" ")
		.trim();
}

export function createPeriodDigestCoverageBatches(
	tweets: PeriodDigestCoverageInputTweet[],
	{
		maxItems = DEFAULT_COVERAGE_BATCH_SIZE,
		maxChars = DEFAULT_COVERAGE_BATCH_CHARS,
	}: { maxItems?: number; maxChars?: number } = {},
) {
	const boundedItems = Math.max(1, Math.floor(maxItems));
	const boundedChars = Math.max(1, Math.floor(maxChars));
	const batches: PeriodDigestCoverageBatch[] = [];
	let current: PeriodDigestCoverageInputTweet[] = [];
	let currentChars = 2;
	const flush = () => {
		if (current.length === 0) return;
		batches.push({
			index: batches.length,
			tweets: current,
			serializedChars: currentChars,
		});
		current = [];
		currentChars = 2;
	};
	for (const tweet of tweets) {
		const itemChars =
			JSON.stringify(tweet).length + (current.length > 0 ? 1 : 0);
		if (
			current.length > 0 &&
			(current.length >= boundedItems ||
				currentChars + itemChars > boundedChars)
		) {
			flush();
		}
		current.push(tweet);
		currentChars += itemChars;
		if (itemChars > boundedChars) flush();
	}
	flush();
	return batches;
}

export function buildPeriodDigestCoveragePrompt({
	batch,
	totalBatches,
	language,
}: {
	batch: PeriodDigestCoverageBatch;
	totalBatches: number;
	language?: string;
}) {
	return `This is coverage batch ${String(batch.index + 1)} of ${String(totalBatches)} for a private timeline digest.

Read every tweet object, including its reply, quote, retweet, article, expanded links, and media alt text. Classify every top-level tweet exactly once. Do not omit, merge, add, or rename tweet ids.

Disposition rules:
- substantive: a distinct claim, event, argument, or useful update worth considering in the final report.
- supporting: evidence or detail that strengthens another substantive item.
- duplicate: materially repeats another tweet; duplicateOf must name a tweet id from this batch.
- low_signal: little information beyond reaction, promotion, greeting, or noise.
- context_only: useful mainly to interpret a reply, quote, or conversation.
- unreadable: the supplied object contains no readable text, article/link description, quote/retweet text, or media alt text. Never use unreadable when any readable content is present.

First output one short sentence summarizing this batch. Then output a blank line, a line containing only three hyphens, and one compact JSON object with this exact shape:
{"batchSummary":string,"items":[{"tweetId":string,"disposition":"substantive"|"supporting"|"duplicate"|"low_signal"|"context_only"|"unreadable","importance":"high"|"medium"|"low","topic":string,"note":string,"duplicateOf"?:string}]}

Keep each note concrete and under 45 words. ${language ? `Write batchSummary, topic, and note in ${language}. Preserve ids, handles, and URLs exactly.` : ""}

Tweets:
${JSON.stringify(batch.tweets)}`;
}

export function validatePeriodDigestCoverageBatch(
	batch: PeriodDigestCoverageBatch,
	value: unknown,
): PeriodDigestCoverageBatchResult {
	const parsed = PeriodDigestCoverageBatchOutputSchema.parse(value);
	const expectedById = new Map(
		batch.tweets.map((tweet) => [normalizeTweetId(tweet.id), tweet]),
	);
	const returnedIds = new Set<string>();
	for (const item of parsed.items) {
		const tweetId = normalizeTweetId(item.tweetId);
		if (!expectedById.has(tweetId)) {
			throw new Error(`Coverage batch returned unknown tweet id ${tweetId}`);
		}
		if (returnedIds.has(tweetId)) {
			throw new Error(`Coverage batch returned duplicate tweet id ${tweetId}`);
		}
		returnedIds.add(tweetId);
		const tweet = expectedById.get(tweetId)!;
		if (item.disposition === "unreadable" && visibleTweetContent(tweet)) {
			throw new Error(
				`Coverage batch marked readable tweet ${tweetId} unreadable`,
			);
		}
		if (item.disposition === "duplicate") {
			const duplicateOf = item.duplicateOf
				? normalizeTweetId(item.duplicateOf)
				: "";
			if (
				!duplicateOf ||
				duplicateOf === tweetId ||
				!expectedById.has(duplicateOf)
			) {
				throw new Error(
					`Coverage batch returned invalid duplicateOf for ${tweetId}`,
				);
			}
		}
	}
	const missing = batch.tweets
		.map((tweet) => tweet.id)
		.filter((tweetId) => !returnedIds.has(normalizeTweetId(tweetId)));
	if (missing.length > 0) {
		throw new Error(
			`Coverage batch omitted ${String(missing.length)} tweet ids`,
		);
	}
	const itemsById = new Map(
		parsed.items.map((item) => [normalizeTweetId(item.tweetId), item]),
	);
	return {
		index: batch.index,
		batchSummary: parsed.batchSummary,
		items: batch.tweets.map((tweet) => {
			const item = itemsById.get(normalizeTweetId(tweet.id))!;
			return {
				...item,
				tweetId: tweet.id,
				...(item.duplicateOf
					? {
							duplicateOf:
								expectedById.get(normalizeTweetId(item.duplicateOf))?.id ??
								normalizeTweetId(item.duplicateOf),
						}
					: {}),
				author: tweet.author,
				name: tweet.name,
				url: tweet.url,
				createdAt: tweet.createdAt,
				specialFollow: Boolean(tweet.specialFollow),
			};
		}),
	};
}

export function createLocalPeriodDigestCoverageBatchResult(
	batch: PeriodDigestCoverageBatch,
) {
	if (batch.tweets.length !== 1) {
		throw new Error("Local coverage fallback requires exactly one tweet");
	}
	const tweet = batch.tweets[0]!;
	const content = visibleTweetContent(tweet);
	return validatePeriodDigestCoverageBatch(batch, {
		batchSummary:
			"Preserved one source item locally after repeated structured-output validation failures.",
		items: [
			{
				tweetId: tweet.id,
				disposition: content ? "substantive" : "unreadable",
				importance: tweet.specialFollow ? "high" : "medium",
				topic: content
					? "Locally preserved source item"
					: "Unreadable source item",
				note:
					content.slice(0, 320) || "No readable source content was supplied.",
			},
		],
	});
}

export function assemblePeriodDigestCoverage({
	tweets,
	batchResults,
	sourceTruncated,
	citedTweetIds = [],
}: {
	tweets: PeriodDigestCoverageInputTweet[];
	batchResults: PeriodDigestCoverageBatchResult[];
	sourceTruncated: boolean;
	citedTweetIds?: string[];
}): PeriodDigestCoverage {
	const expectedIds = tweets.map((tweet) => tweet.id);
	const itemById = new Map(
		batchResults
			.flatMap((batch) => batch.items)
			.map((item) => [item.tweetId, item]),
	);
	const items = expectedIds.flatMap((tweetId) => {
		const item = itemById.get(tweetId);
		return item ? [item] : [];
	});
	const missingTweetIds = expectedIds.filter(
		(tweetId) => !itemById.has(tweetId),
	);
	const dispositions: PeriodDigestCoverage["dispositions"] = {
		substantive: 0,
		supporting: 0,
		duplicate: 0,
		low_signal: 0,
		context_only: 0,
		unreadable: 0,
	};
	for (const item of items) dispositions[item.disposition] += 1;
	const citedSet = new Set(citedTweetIds.map(normalizeTweetId));
	return {
		version: PERIOD_DIGEST_COVERAGE_VERSION,
		expected: expectedIds.length,
		processed: items.length,
		complete: !sourceTruncated && missingTweetIds.length === 0,
		sourceTruncated,
		missingTweetIds,
		cited: expectedIds.filter((tweetId) =>
			citedSet.has(normalizeTweetId(tweetId)),
		).length,
		dispositions,
		batches: [...batchResults]
			.sort((left, right) => left.index - right.index)
			.map((batch) => ({
				index: batch.index,
				processed: batch.items.length,
				summary: batch.batchSummary,
			})),
		items,
	};
}
