import { describe, expect, it } from "vitest";
import {
	assemblePeriodDigestCoverage,
	buildPeriodDigestCoveragePrompt,
	createLocalPeriodDigestCoverageBatchResult,
	createPeriodDigestCoverageBatches,
	type PeriodDigestCoverageBatch,
	type PeriodDigestCoverageInputTweet,
	validatePeriodDigestCoverageBatch,
} from "./period-digest-coverage";

function tweet(
	id: string,
	text = `tweet ${id}`,
): PeriodDigestCoverageInputTweet {
	return {
		id,
		url: `https://x.com/test/status/${id}`,
		author: "test",
		name: "Test",
		createdAt: "2026-09-13T00:00:00.000Z",
		text,
	};
}

function output(batch: PeriodDigestCoverageBatch) {
	return {
		batchSummary: `batch ${String(batch.index)}`,
		items: batch.tweets.map((item) => ({
			tweetId: item.id,
			disposition: "substantive" as const,
			importance: "medium" as const,
			topic: "topic",
			note: "useful update",
		})),
	};
}

describe("period digest coverage", () => {
	it("includes links, media alt text, quote, and retweet context in batch input", () => {
		const rich = {
			...tweet("1", "top level"),
			links: [
				{
					url: "https://example.com/full",
					title: "Expanded title",
					description: "Expanded description",
				},
			],
			media: [{ type: "image", altText: "chart trends upward" }],
			quotedTweet: {
				id: "quoted",
				author: "quoted_author",
				name: "Quoted",
				createdAt: "2026-09-12T00:00:00.000Z",
				text: "quoted body",
			},
			retweetedTweet: {
				id: "retweeted",
				author: "retweeted_author",
				name: "Retweeted",
				createdAt: "2026-09-11T00:00:00.000Z",
				text: "retweeted body",
			},
		};
		const [batch] = createPeriodDigestCoverageBatches([rich]);
		const prompt = buildPeriodDigestCoveragePrompt({
			batch: batch!,
			totalBatches: 1,
			language: "zh-CN",
		});
		expect(prompt).toContain("Expanded description");
		expect(prompt).toContain("chart trends upward");
		expect(prompt).toContain("quoted body");
		expect(prompt).toContain("retweeted body");
	});

	it("creates deterministic item and character bounded batches", () => {
		const tweets = [tweet("1"), tweet("2"), tweet("3"), tweet("4")];
		expect(
			createPeriodDigestCoverageBatches(tweets, {
				maxItems: 2,
				maxChars: 10_000,
			}).map((batch) => batch.tweets.map((item) => item.id)),
		).toEqual([
			["1", "2"],
			["3", "4"],
		]);
		const long = tweet("long", "x".repeat(1_000));
		expect(
			createPeriodDigestCoverageBatches([tweet("1"), long, tweet("2")], {
				maxItems: 80,
				maxChars: 400,
			}).map((batch) => batch.tweets.map((item) => item.id)),
		).toEqual([["1"], ["long"], ["2"]]);
	});

	it("rejects missing, duplicate, unknown, and false unreadable ids", () => {
		const [batch] = createPeriodDigestCoverageBatches([tweet("1"), tweet("2")]);
		expect(() =>
			validatePeriodDigestCoverageBatch(batch!, {
				...output(batch!),
				items: output(batch!).items.slice(0, 1),
			}),
		).toThrow(/omitted 1/);
		expect(() =>
			validatePeriodDigestCoverageBatch(batch!, {
				...output(batch!),
				items: [...output(batch!).items, output(batch!).items[0]],
			}),
		).toThrow(/duplicate tweet id/);
		expect(() =>
			validatePeriodDigestCoverageBatch(batch!, {
				...output(batch!),
				items: [
					...output(batch!).items,
					{
						tweetId: "3",
						disposition: "low_signal",
						importance: "low",
						topic: "other",
						note: "noise",
					},
				],
			}),
		).toThrow(/unknown tweet id 3/);
		expect(() =>
			validatePeriodDigestCoverageBatch(batch!, {
				...output(batch!),
				items: output(batch!).items.map((item, index) =>
					index === 0 ? { ...item, disposition: "unreadable" } : item,
				),
			}),
		).toThrow(/marked readable tweet 1 unreadable/);
	});

	it("restores input ordering and reports explicit incomplete coverage", () => {
		const tweets = [tweet("1"), tweet("2"), tweet("3")];
		const [first, second] = createPeriodDigestCoverageBatches(tweets, {
			maxItems: 2,
		});
		const firstResult = validatePeriodDigestCoverageBatch(first!, {
			...output(first!),
			items: [...output(first!).items].reverse(),
		});
		const partial = assemblePeriodDigestCoverage({
			tweets,
			batchResults: [firstResult],
			sourceTruncated: true,
		});
		expect(firstResult.items.map((item) => item.tweetId)).toEqual(["1", "2"]);
		expect(partial).toMatchObject({
			expected: 3,
			processed: 2,
			complete: false,
			sourceTruncated: true,
			missingTweetIds: ["3"],
		});
		const complete = assemblePeriodDigestCoverage({
			tweets,
			batchResults: [
				firstResult,
				validatePeriodDigestCoverageBatch(second!, output(second!)),
			],
			sourceTruncated: false,
			citedTweetIds: ["tweet_2"],
		});
		expect(complete).toMatchObject({
			expected: 3,
			processed: 3,
			complete: true,
			cited: 1,
		});
	});

	it("preserves an irreducible single tweet locally without inventing content", () => {
		const [readable] = createPeriodDigestCoverageBatches([
			{ ...tweet("1", "Exact source text"), specialFollow: true },
		]);
		const readableResult = createLocalPeriodDigestCoverageBatchResult(
			readable!,
		);
		expect(readableResult.items[0]).toMatchObject({
			tweetId: "1",
			disposition: "substantive",
			importance: "high",
			note: "Exact source text",
		});

		const [unreadable] = createPeriodDigestCoverageBatches([tweet("2", "")]);
		const unreadableResult = createLocalPeriodDigestCoverageBatchResult(
			unreadable!,
		);
		expect(unreadableResult.items[0]).toMatchObject({
			tweetId: "2",
			disposition: "unreadable",
			note: "No readable source content was supplied.",
		});
	});
});
