import {
	act,
	cleanup,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeriodDigestRunResult } from "#/lib/period-digest";
import { validateTodaySearch } from "#/lib/route-search";
import type { TweetMediaItem } from "#/lib/types";
import { ndjsonResponse } from "#/test/ndjson";
import { renderWithQueryClient as render } from "#/test/render";
import { TodayRouteView as TodayRoute } from "./today";

const { fetchTweetScoresMock } = vi.hoisted(() => ({
	fetchTweetScoresMock: vi.fn(),
}));

vi.mock("#/lib/tweet-score-client", () => ({
	fetchTweetScores: fetchTweetScoresMock,
}));

const authorProfile = {
	id: "profile_alice",
	handle: "alice",
	displayName: "Alice",
	bio: "Builds useful things.",
	followersCount: 1200,
	followingCount: 200,
	avatarHue: 42,
	createdAt: "2020-01-01T00:00:00.000Z",
};

const hydratedAuthorProfile = {
	...authorProfile,
	displayName: "Alice Fresh",
	avatarUrl: "https://pbs.twimg.com/profile_images/alice/avatar.jpg",
};

function referenceTimestamp(value: string) {
	const date = new Date(value);
	return `${date.toLocaleDateString("sv-SE")} ${date.toLocaleTimeString(
		"sv-SE",
		{
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
		},
	)}`;
}

function digestResult(
	label: string,
	markdown: string,
	includeDms = false,
): PeriodDigestRunResult {
	return {
		context: {
			window: {
				label,
				since: "2026-05-16T00:00:00.000Z",
				until: "2026-05-16T12:00:00.000Z",
			},
			includeDms,
			counts: {
				home: 3,
				mentions: 2,
				authored: 1,
				likes: 1,
				bookmarks: 1,
				dms: includeDms ? 1 : 0,
				links: 4,
			},
			tweets: [
				{
					id: "tweet_1",
					url: "https://x.com/alice/status/tweet_1",
					source: "mentions",
					author: "alice",
					name: "Alice",
					authorProfile,
					createdAt: "2026-05-16T10:00:00.000Z",
					text: "Peter should see this.",
					media: [] as TweetMediaItem[],
					entities: {
						urls: [
							{
								url: "https://t.co/original",
								expandedUrl: "https://x.com/alice/status/tweet_1",
								displayUrl: "x.com/alice/status/tweet_1",
								start: 0,
								end: 0,
							},
							{
								url: "https://t.co/reference",
								expandedUrl: "https://example.com/reference",
								displayUrl: "example.com/reference",
								start: 0,
								end: 0,
							},
						],
					},
					likeCount: 12,
					liked: false,
					bookmarked: false,
					needsReply: true,
				},
			],
			dms: [],
			links: [],
			hash: label,
		},
		digest: {
			title: label,
			summary: `${label} summary`,
			keyTopics: [
				{
					title: "Useful signal",
					summary: "Alice shared something worth a reply.",
					tweetIds: ["tweet_1"],
					handles: ["@alice"],
				},
			],
			notableLinks: [
				{
					title: "Example",
					url: "https://example.com",
					why: "Worth reading.",
					sourceTweetIds: ["tweet_1"],
				},
				{
					title: "Unsafe",
					url: "javascript:alert(1)",
					why: "Should render as inert text.",
					sourceTweetIds: ["tweet_1"],
				},
			],
			people: [
				{ handle: "alice", name: "Alice", why: "Shared useful signal." },
			],
			actionItems: [
				{ kind: "reply", label: "Reply to Alice", tweetId: "tweet_1" },
			],
			sourceTweetIds: ["tweet_1"],
		},
		markdown,
		model: "gpt-5.5",
		reasoningEffort: "medium",
		serviceTier: "priority",
		cached: false,
		updatedAt: "2026-05-16T12:00:00.000Z",
	};
}

function generateSummary() {
	fireEvent.click(screen.getByRole("button", { name: "Generate summary" }));
}

describe("today route", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		fetchTweetScoresMock.mockReset();
		fetchTweetScoresMock.mockResolvedValue([
			{
				tweetId: "tweet_1",
				score: 8,
				label: "高信息价值",
				dimensions: {
					informationDelta: 4,
					clearThesis: 2,
					explainedMechanism: 1,
					verifiability: 1,
					clearBoundaries: 0,
				},
				sentiment: "positive",
				assets: ["股票"],
				reason: "有新信息。",
				explanation: "这是通俗解释。",
				updatedAt: "2026-08-12T08:00:00.000Z",
				cached: false,
			},
		]);
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("generates only on demand and reloads when controls change", async () => {
		const urls: URL[] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input));
			urls.push(url);
			if (url.pathname === "/api/profile-hydrate") {
				return new Response(
					JSON.stringify({
						ok: true,
						results: [
							{
								handle: "alice",
								status: "hit",
								source: "bird",
								profile: hydratedAuthorProfile,
							},
						],
					}),
					{ headers: { "content-type": "application/json" } },
				);
			}
			const period = url.searchParams.get("period") ?? "today";
			const includeDms = url.searchParams.get("includeDms") === "true";
			const label = period === "week" ? "Last 7 days" : "Today";
			const markdown = includeDms
				? "# With DMs\n\n## What people are talking about\n\n- Ask @alice about tweet_1"
				: `# ${label}\n\n## What people are talking about\n\n- Ask @alice about tweet_1`;
			return ndjsonResponse([
				{ type: "delta", delta: `${markdown}\n` },
				{ type: "done", result: digestResult(label, markdown, includeDms) },
			]);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(<TodayRoute />);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(
			screen.getByText(
				"No summary yet. Choose a period, then generate only when you need it.",
			),
		).toBeInTheDocument();
		generateSummary();

		expect(
			await screen.findByRole("heading", { name: "Today", level: 1 }),
		).toBeInTheDocument();
		expect(
			urls.some((url) => url.searchParams.get("includeFeed") === "true"),
		).toBe(true);
		expect(
			screen.getByRole("heading", {
				name: "What people are talking about",
				level: 2,
			}),
		).toBeInTheDocument();
		expect(screen.queryByText("Today summary")).toBeNull();
		expect(screen.queryByRole("heading", { name: "Key topics" })).toBeNull();
		const topicHeading = screen.getByRole("heading", {
			name: "Useful signal",
			level: 3,
		});
		expect(topicHeading).toBeInTheDocument();
		expect(
			screen.queryByText("Alice shared something worth a reply."),
		).toBeNull();
		expect(screen.queryByText(/Action items/i)).toBeNull();
		expect(screen.queryByText("# Today")).not.toBeInTheDocument();
		const aliceLink = screen.getByRole("link", { name: "@alice" });
		expect(
			topicHeading.compareDocumentPosition(aliceLink) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(aliceLink).toHaveAttribute("href", "/authors/alice");
		expect(screen.getByRole("link", { name: "tweet_1" })).toHaveAttribute(
			"href",
			"https://x.com/alice/status/tweet_1",
		);
		expect(
			screen.getByText("3 home · 2 mentions · 4 links"),
		).toBeInTheDocument();
		const todayButton = screen.getByRole("button", { name: "Today" });
		expect(todayButton).toHaveClass("!bg-[var(--accent)]");
		expect(todayButton).toHaveClass("!text-[var(--accent-text)]");
		await waitFor(() =>
			expect(urls.some((url) => url.pathname === "/api/profile-hydrate")).toBe(
				true,
			),
		);
		fireEvent.pointerEnter(aliceLink.parentElement as Element);
		await screen.findByText("Alice Fresh");
		expect(screen.getByRole("img", { name: "Alice Fresh" })).toHaveAttribute(
			"src",
			expect.stringContaining("/api/avatar?profileId=profile_alice&v="),
		);

		fireEvent.click(screen.getByLabelText("Feed"));
		expect(
			urls.filter((url) => url.pathname === "/api/period-digest"),
		).toHaveLength(1);
		generateSummary();
		await waitFor(() =>
			expect(
				urls.some((url) => url.searchParams.get("includeFeed") === "false"),
			).toBe(true),
		);

		fireEvent.click(screen.getByRole("button", { name: "Week" }));
		generateSummary();
		expect(
			await screen.findByRole("heading", { name: "Last 7 days", level: 1 }),
		).toBeInTheDocument();

		fireEvent.click(screen.getByLabelText("DMs"));
		generateSummary();
		expect(
			await screen.findByRole("heading", { name: "With DMs", level: 1 }),
		).toBeInTheDocument();
		expect(
			screen.getByText("3 home · 2 mentions · 4 links · 1 DMs"),
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
		await waitFor(() =>
			expect(
				urls.some((url) => url.searchParams.get("refresh") === "true"),
			).toBe(true),
		);
		expect(
			urls.some(
				(url) =>
					url.searchParams.get("period") === "week" &&
					url.searchParams.get("includeDms") === "true" &&
					url.searchParams.get("liveSync") === "false",
			),
		).toBe(true);
	});

	it("collapses the coverage register on screen while preserving it for print", async () => {
		const markdown = [
			"# Today",
			"",
			"## 今日重点",
			"",
			"- 正文重点",
			"",
			"## 逐条覆盖补录",
			"",
			"以下重要条目已核验，但未被正文单独引用。",
			"",
			"- @alice 的补录内容 tweet_1",
		].join("\n");
		const result = digestResult("Today", markdown);
		result.coverage = {
			version: 1,
			expected: 3,
			processed: 3,
			complete: true,
			sourceTruncated: false,
			missingTweetIds: [],
			cited: 2,
			dispositions: {
				substantive: 2,
				supporting: 0,
				duplicate: 0,
				low_signal: 1,
				context_only: 0,
				unreadable: 0,
			},
			batches: [],
			items: [],
		};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input), "http://localhost");
				if (url.pathname === "/api/profile-hydrate") {
					return Response.json({ ok: true, results: [] });
				}
				return ndjsonResponse([{ type: "done", result }]);
			}),
		);

		render(<TodayRoute />);
		generateSummary();

		const coverageSummary = await screen.findByText(
			"已审阅 3/3 条 · 重要内容 2 条 · 缺漏 0",
		);
		const details = coverageSummary.closest("details");
		const screenDigest = details?.parentElement;
		const printDigest = document.querySelector(".today-print-only");
		expect(screenDigest).toHaveClass("today-screen-only");
		expect(printDigest).not.toBeNull();
		expect(details).not.toBeNull();
		expect(details).not.toHaveAttribute("open");
		expect(coverageSummary).toBeInTheDocument();
		expect(
			within(printDigest as HTMLElement).getByRole("heading", {
				name: "逐条覆盖补录",
				level: 2,
			}),
		).toBeInTheDocument();
		expect(
			within(printDigest as HTMLElement).getByRole("link", { name: "@alice" }),
		).toBeInTheDocument();
		expect(
			within(printDigest as HTMLElement).getByRole("link", { name: "tweet_1" }),
		).toBeInTheDocument();

		fireEvent.click(within(details as HTMLElement).getByText("逐条覆盖补录"));
		expect(details).toHaveAttribute("open");
	});

	it("runs a digest only after explicit generation for a valid custom range", async () => {
		const digestUrls: URL[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				if (url.pathname === "/api/profile-hydrate") {
					return new Response(JSON.stringify({ ok: true, results: [] }), {
						headers: { "content-type": "application/json" },
					});
				}
				digestUrls.push(url);
				const markdown = "# Today\n\nDone.";
				return ndjsonResponse([
					{ type: "done", result: digestResult("Today", markdown) },
				]);
			}),
		);

		render(<TodayRoute />);
		expect(digestUrls).toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: "Custom" }));
		expect(
			screen.getByRole("group", { name: "Custom date range" }),
		).toBeVisible();

		const sinceLocal = "2026-07-10T09:15";
		const untilLocal = "2026-07-10T11:45";
		fireEvent.change(screen.getByLabelText("From"), {
			target: { value: untilLocal },
		});
		fireEvent.change(screen.getByLabelText("To"), {
			target: { value: sinceLocal },
		});
		expect(screen.getByText("From must be earlier than To.")).toBeVisible();
		expect(
			screen.getByRole("button", { name: "Apply custom range" }),
		).toBeDisabled();

		fireEvent.change(screen.getByLabelText("From"), {
			target: { value: sinceLocal },
		});
		fireEvent.change(screen.getByLabelText("To"), {
			target: { value: untilLocal },
		});
		expect(digestUrls).toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: "Apply custom range" }));
		expect(digestUrls).toHaveLength(0);
		generateSummary();

		await waitFor(() => expect(digestUrls).toHaveLength(1));
		const customUrl = digestUrls[0];
		expect(customUrl?.searchParams.get("period")).toBe("custom");
		expect(customUrl?.searchParams.get("since")).toBe(
			new Date(sinceLocal).toISOString(),
		);
		expect(customUrl?.searchParams.get("until")).toBe(
			new Date(untilLocal).toISOString(),
		);

		fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
		await waitFor(() => expect(digestUrls).toHaveLength(2));
		expect(digestUrls[1]?.searchParams.get("since")).toBe(
			customUrl?.searchParams.get("since"),
		);
		expect(digestUrls[1]?.searchParams.get("until")).toBe(
			customUrl?.searchParams.get("until"),
		);

		fireEvent.click(screen.getByRole("button", { name: "Today" }));
		expect(digestUrls).toHaveLength(2);
		generateSummary();
		await waitFor(() => expect(digestUrls).toHaveLength(3));
		expect(digestUrls[2]?.searchParams.has("since")).toBe(false);
		expect(digestUrls[2]?.searchParams.has("until")).toBe(false);
	});

	it("closes a restored custom picker when navigation returns to Today", () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				const markdown = "# Today\n\nDone.";
				return ndjsonResponse([
					{ type: "done", result: digestResult("Today", markdown) },
				]);
			}),
		);
		const onSearchChange = vi.fn();
		const customSearch = validateTodaySearch({
			period: "custom",
			since: "2026-07-10T09:15:00.000Z",
			until: "2026-07-10T11:45:00.000Z",
		});
		const { rerender } = render(
			<TodayRoute searchState={customSearch} onSearchChange={onSearchChange} />,
		);
		expect(
			screen.getByRole("group", { name: "Custom date range" }),
		).toBeVisible();

		rerender(
			<TodayRoute
				searchState={validateTodaySearch({ period: "today" })}
				onSearchChange={onSearchChange}
			/>,
		);
		expect(
			screen.queryByRole("group", { name: "Custom date range" }),
		).toBeNull();
		expect(screen.getByRole("button", { name: "Today" })).toHaveClass(
			"!bg-[var(--accent)]",
		);
	});

	it("keeps structured topic headings when the model markdown is flat", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				if (url.pathname === "/api/profile-hydrate") {
					return new Response(JSON.stringify({ ok: true, results: [] }), {
						headers: { "content-type": "application/json" },
					});
				}
				const markdown =
					"**What people are talking about**\n\n- Alice shared a useful signal (tweet_1).";
				return ndjsonResponse([
					{ type: "delta", delta: markdown },
					{ type: "done", result: digestResult("Today", markdown) },
				]);
			}),
		);

		render(<TodayRoute />);
		generateSummary();

		expect(
			await screen.findByRole("heading", {
				name: "Useful signal",
				level: 3,
			}),
		).toBeInTheDocument();
		expect(
			screen.queryByText("Alice shared something worth a reply."),
		).toBeNull();
	});

	it("places every structured topic before its matching discussion bullet", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				if (url.pathname === "/api/profile-hydrate") {
					return new Response(JSON.stringify({ ok: true, results: [] }), {
						headers: { "content-type": "application/json" },
					});
				}
				const markdown = [
					"## What people are talking about",
					"",
					...Array.from(
						{ length: 6 },
						(_, index) =>
							`- Discussion ${String(index + 1)} (tweet_${String(index + 1)}).`,
					),
				].join("\n\n");
				const result = digestResult("Today", markdown);
				result.digest.keyTopics = Array.from({ length: 6 }, (_, index) => ({
					title: `Topic ${String(index + 1)}`,
					summary: `Summary ${String(index + 1)}`,
					tweetIds: [`tweet_${String(index + 1)}`],
					handles: ["@alice"],
				}));
				return ndjsonResponse([
					{ type: "delta", delta: markdown },
					{ type: "done", result },
				]);
			}),
		);

		render(<TodayRoute />);
		generateSummary();

		expect(
			await screen.findByRole("heading", { name: "Topic 1", level: 3 }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "Topic 6", level: 3 }),
		).toBeInTheDocument();
		expect(screen.queryByRole("heading", { name: "Key topics" })).toBeNull();
	});

	it("does not duplicate a topic heading already present in the report", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				if (url.pathname === "/api/profile-hydrate") {
					return new Response(JSON.stringify({ ok: true, results: [] }), {
						headers: { "content-type": "application/json" },
					});
				}
				const markdown =
					"## What people are talking about\n\n### Useful signal\n\n- Alice shared a useful signal (tweet_1).";
				return ndjsonResponse([
					{ type: "delta", delta: markdown },
					{ type: "done", result: digestResult("Today", markdown) },
				]);
			}),
		);

		render(<TodayRoute />);
		generateSummary();

		expect(
			await screen.findAllByRole("heading", {
				name: "Useful signal",
				level: 3,
			}),
		).toHaveLength(1);
	});

	it("exports a completed digest through the browser PDF flow", async () => {
		document.title = "birdclaw";
		const printMock = vi.spyOn(window, "print").mockImplementation(() => {
			expect(document.title).toBe("BirdClaw Today digest");
			window.dispatchEvent(new Event("afterprint"));
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				if (url.pathname === "/api/profile-hydrate") {
					return new Response(JSON.stringify({ ok: true, results: [] }), {
						headers: { "content-type": "application/json" },
					});
				}
				const markdown = "# Today\n\nDone.";
				return ndjsonResponse([
					{ type: "delta", delta: markdown },
					{ type: "done", result: digestResult("Today", markdown) },
				]);
			}),
		);

		render(<TodayRoute />);
		generateSummary();

		await screen.findByRole("heading", { name: "Today", level: 1 });
		const exportButton = screen.getByRole("button", { name: "Export PDF" });
		expect(exportButton).toBeEnabled();

		fireEvent.click(exportButton);

		expect(printMock).toHaveBeenCalledTimes(1);
		expect(document.title).toBe("birdclaw");
	});

	it("exports the cached digest context as a reference collection without rerunning the digest", async () => {
		document.title = "birdclaw";
		const digestRequests: URL[] = [];
		const printMock = vi.spyOn(window, "print").mockImplementation(() => {
			try {
				expect(document.title).toBe("BirdClaw Today reference collection");
				expect(document.body.dataset.todayPrintMode).toBe("reference");
				const referencePdf = screen.getByTestId("today-reference-pdf");
				const referenceText = referencePdf.textContent ?? "";
				const printedScores = referencePdf.querySelectorAll(
					".today-reference-score",
				);
				expect(printedScores).toHaveLength(1);
				expect(printedScores[0]).toHaveTextContent(/^8$/);
				expect(referenceText).not.toContain("评分依据");
				expect(referenceText).not.toContain("判断理由");
				expect(referenceText).not.toContain("通俗解释");
				const mediaGrid = referencePdf.querySelector(
					".today-reference-media-grid",
				);
				expect(mediaGrid).not.toBeNull();
				expect(mediaGrid).toHaveAttribute("data-reference-media-count", "3");
				expect(
					referencePdf.querySelectorAll(".today-reference-media"),
				).toHaveLength(1);
				for (const image of within(referencePdf).getAllByRole("img", {
					name: "第一张推文图片",
				})) {
					expect(image).toHaveAttribute(
						"src",
						"https://pbs.twimg.com/media/one.jpg",
					);
				}
				for (const image of within(referencePdf).getAllByRole("img", {
					name: "第二张推文图片",
				})) {
					expect(image).toHaveAttribute(
						"src",
						"https://pbs.twimg.com/media/two.jpg",
					);
				}
				for (const image of within(referencePdf).getAllByRole("img", {
					name: "推文视频封面 3",
				})) {
					expect(image).toHaveAttribute(
						"src",
						"https://pbs.twimg.com/media/video-cover.jpg",
					);
				}
				for (const image of within(referencePdf).getAllByRole("img")) {
					expect(image).toHaveAttribute("loading", "eager");
				}
				expect(
					within(referencePdf).getByRole("heading", {
						name: "BirdClaw Today 参考内容合集",
						level: 1,
					}),
				).toBeInTheDocument();
				expect(
					within(referencePdf).getByText(
						"Opening summary shown on the webpage.",
					),
				).toBeInTheDocument();
				expect(
					within(referencePdf).queryByText(
						"Structured summary must not replace the webpage.",
					),
				).toBeNull();
				expect(
					within(referencePdf).getAllByText("Useful signal"),
				).not.toHaveLength(0);
				expect(
					within(referencePdf).getByRole("heading", {
						name: "热议主题",
						level: 2,
					}),
				).toBeInTheDocument();
				expect(
					within(referencePdf).getByText(
						/Markdown summary starts here and continues exactly as shown\./,
					),
				).toBeInTheDocument();
				expect(
					within(referencePdf).getByText(
						/A second paragraph remains under the same webpage topic\./,
					),
				).toBeInTheDocument();
				expect(referenceText).toContain(
					"An uncited webpage paragraph remains in the collection.",
				);
				expect(referenceText).toContain(
					"This deliberately long topic heading stays complete in the printed table of contents without being shortened",
				);
				expect(
					within(referencePdf).queryByText(
						"Alice shared something worth a reply.",
					),
				).toBeNull();
				expect(within(referencePdf).getAllByText("S01")).not.toHaveLength(0);
				expect(
					within(referencePdf).getAllByText("Alice (@alice)"),
				).not.toHaveLength(0);
				expect(
					within(referencePdf).getByRole("heading", {
						name: "来源矩阵",
						level: 2,
					}),
				).toBeInTheDocument();
				expect(
					within(referencePdf).getByRole("heading", {
						name: "来源索引",
						level: 2,
					}),
				).toBeInTheDocument();
				expect(
					within(referencePdf).getAllByRole("columnheader", {
						name: "来源编号",
					}),
				).not.toHaveLength(0);
				expect(
					within(referencePdf).getAllByRole("columnheader", {
						name: "作者 / 账号 ID",
					}),
				).not.toHaveLength(0);
				expect(
					within(referencePdf).getByRole("link", { name: "S01 所在页" }),
				).toHaveAttribute("href", "#reference-source-S01");
				expect(within(referencePdf).getByText("tweet_1")).toBeInTheDocument();
				expect(
					within(referencePdf).getAllByText(
						referenceTimestamp("2026-05-16T10:00:00.000Z"),
					),
				).not.toHaveLength(0);
				expect(referenceText).toContain(
					`回复上下文：@bob · ${referenceTimestamp(
						"2026-05-16T09:42:00.000Z",
					)}`,
				);
				expect(
					within(referencePdf).getByRole("columnheader", {
						name: "发帖时间",
					}),
				).toBeInTheDocument();
				expect(within(referencePdf).queryByText(/12 likes|12 赞/)).toBeNull();
				expect(
					within(referencePdf).queryByText(
						"https://x.com/alice/status/tweet_1",
					),
				).toBeNull();
				expect(
					within(referencePdf).queryByText("x.com/alice/status/tweet_1"),
				).toBeNull();
				expect(
					within(referencePdf).queryByText(/example\.com\/reference/),
				).toBeNull();
				expect(referenceText).not.toMatch(
					/\b(Home|Mention|Authored|Liked|Bookmark)\b/,
				);
				expect(referenceText).not.toContain("3 home · 2 mentions · 4 links");
				expect(referenceText).not.toContain("8:00 PM");
				expect(
					within(referencePdf).getByRole("heading", {
						name: "Feed 编辑来源",
						level: 2,
					}),
				).toBeInTheDocument();
				expect(
					within(referencePdf).getByText("Important feed source"),
				).toBeInTheDocument();
				expect(
					within(referencePdf).getByRole("link", { name: "查看发布方原文" }),
				).toHaveAttribute(
					"href",
					"https://www.laohu8.com/news/breaking?onlyImportant=true",
				);
				expect(referenceText).toContain("BirdClaw 已独立核实");
			} finally {
				window.dispatchEvent(new Event("afterprint"));
			}
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				if (url.pathname === "/api/profile-hydrate") {
					return new Response(JSON.stringify({ ok: true, results: [] }), {
						headers: { "content-type": "application/json" },
					});
				}
				digestRequests.push(url);
				const markdown = [
					"# Today",
					"",
					"Opening summary shown on the webpage.",
					"",
					"**大家在聊什么**",
					"",
					"### Useful signal",
					"",
					"- An uncited webpage paragraph remains in the collection.",
					"- Markdown summary starts here",
					"  and continues exactly as shown.",
					"  (tweet_1)",
					"- A second paragraph remains under the same webpage topic. (tweet_1)",
					"",
					"### This deliberately long topic heading stays complete in the printed table of contents without being shortened",
					"",
					"- The full heading is part of the webpage content. (tweet_1)",
				].join("\n");
				const result = digestResult("Today", markdown);
				result.digest.summary =
					"Structured summary must not replace the webpage.";
				result.digest.sourceFeedItemIds = ["tiger:flash:pdf"];
				result.context.includeFeed = true;
				result.context.twitterScope = "home";
				result.context.counts.feed = 1;
				result.context.feedItems = [
					{
						id: "tiger:flash:pdf",
						source: "tiger",
						externalId: "pdf",
						kind: "flash",
						title: "Important feed source",
						summary: "A short editorial summary.",
						url: "https://www.laohu8.com/news/breaking?onlyImportant=true",
						publisher: "Tiger News",
						publishedAt: "2026-05-16T09:00:00.000Z",
						market: "all",
						language: "zh-CN",
						symbols: [],
						imageUrl: null,
						isImportant: true,
						updatedAt: "2026-05-16T09:00:01.000Z",
					},
				];
				Object.assign(result.context.tweets[0]!, {
					replyToTweet: {
						id: "tweet_parent",
						url: "https://x.com/bob/status/tweet_parent",
						author: "bob",
						name: "Bob",
						createdAt: "2026-05-16T09:42:00.000Z",
						text: "Parent tweet context.",
					},
				});
				result.context.tweets[0]!.media = [
					{
						url: "https://pbs.twimg.com/media/one.jpg",
						type: "image",
						altText: "第一张推文图片",
						width: 1600,
						height: 900,
					},
					{
						url: "https://pbs.twimg.com/media/two.jpg",
						type: "image",
						altText: "第二张推文图片",
						width: 900,
						height: 1600,
					},
					{
						url: "https://video.twimg.com/ext_tw_video/demo.mp4",
						thumbnailUrl: "https://pbs.twimg.com/media/video-cover.jpg",
						type: "video",
						width: 1280,
						height: 720,
					},
				];
				return ndjsonResponse([
					{ type: "delta", delta: markdown },
					{ type: "done", result },
				]);
			}),
		);

		render(<TodayRoute />);
		generateSummary();

		await screen.findByRole("heading", { name: "Today", level: 1 });
		expect(digestRequests).toHaveLength(1);
		const referenceButton = screen.getByRole("button", {
			name: "导出完整 PDF",
		});
		expect(referenceButton).toBeEnabled();

		fireEvent.click(referenceButton);

		await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
		expect(fetchTweetScoresMock).toHaveBeenCalledTimes(1);
		expect(digestRequests).toHaveLength(1);
		expect(document.title).toBe("birdclaw");
		expect(document.body.dataset.todayPrintMode).toBeUndefined();
	});

	it("describes a Feed-off reference PDF as Home-only", async () => {
		fetchTweetScoresMock.mockRejectedValueOnce(new Error("评分服务不可用"));
		const scoreWarning = vi.spyOn(console, "warn").mockImplementation(() => {});
		const printMock = vi.spyOn(window, "print").mockImplementation(() => {
			try {
				const referencePdf = screen.getByTestId("today-reference-pdf");
				expect(referencePdf).toHaveTextContent("引用原文（Home）");
				expect(referencePdf).not.toHaveTextContent("Home + Feed");
				expect(referencePdf).not.toHaveTextContent("Feed 编辑来源");
			} finally {
				window.dispatchEvent(new Event("afterprint"));
			}
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				if (url.pathname === "/api/profile-hydrate") {
					return new Response(JSON.stringify({ ok: true, results: [] }), {
						headers: { "content-type": "application/json" },
					});
				}
				const markdown = "# Today\n\nHome-only summary. (tweet_1)";
				const result = digestResult("Today", markdown);
				result.context.includeFeed = false;
				result.context.twitterScope = "home";
				result.context.counts.feed = 0;
				result.context.feedItems = [];
				return ndjsonResponse([
					{ type: "delta", delta: markdown },
					{ type: "done", result },
				]);
			}),
		);

		render(<TodayRoute />);
		generateSummary();
		await screen.findByRole("heading", { name: "Today", level: 1 });
		fireEvent.click(screen.getByRole("button", { name: "导出完整 PDF" }));
		await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
		expect(scoreWarning).toHaveBeenCalledWith(
			"Reference PDF score lookup failed; exporting without scores",
			expect.any(Error),
		);
	});

	it("renders generated citations as source links without coloring the prose", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				if (url.pathname === "/api/profile-hydrate") {
					return new Response(JSON.stringify({ ok: true, results: [] }), {
						headers: { "content-type": "application/json" },
					});
				}
				const markdown =
					"# Today\n\n## What people are talking about\n\n- Alice says memory pricing should stay firm (tweet_1).";
				return ndjsonResponse([
					{ type: "delta", delta: markdown },
					{ type: "done", result: digestResult("Today", markdown) },
				]);
			}),
		);

		render(<TodayRoute />);
		generateSummary();

		await screen.findByRole("heading", { name: "Today", level: 1 });
		expect(
			screen.queryByRole("link", {
				name: "Alice says memory pricing should stay firm",
			}),
		).toBeNull();
		expect(
			screen.getByText(/Alice says memory pricing should stay firm/),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "source" })).toHaveAttribute(
			"href",
			"https://x.com/alice/status/tweet_1",
		);
		expect(screen.queryByText(/tweet_1/)).toBeNull();
	});

	it("renders generated markdown title links without the accent color", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				if (url.pathname === "/api/profile-hydrate") {
					return new Response(JSON.stringify({ ok: true, results: [] }), {
						headers: { "content-type": "application/json" },
					});
				}
				const markdown =
					"# Today\n\n## Important links shared\n\n- [bboczeng 的存储周期长文](https://x.com/bboczeng/status/2071506694723736039)：围绕美光财报、苹果涨价、存储上涨可持续性展开。";
				return ndjsonResponse([
					{ type: "delta", delta: markdown },
					{ type: "done", result: digestResult("Today", markdown) },
				]);
			}),
		);

		render(<TodayRoute />);
		generateSummary();

		await screen.findByRole("heading", { name: "Today", level: 1 });
		const titleLink = screen.getByRole("link", {
			name: "bboczeng 的存储周期长文",
		});
		expect(titleLink).toHaveAttribute(
			"href",
			"https://x.com/bboczeng/status/2071506694723736039",
		);
		expect(titleLink).toHaveClass("text-[var(--ink)]");
		expect(titleLink).not.toHaveClass("text-[var(--accent)]");
	});

	it("shows request errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							ok: false,
							message:
								"Remote API access requires BIRDCLAW_ALLOW_REMOTE_WEB=1 for a trusted private proxy, or BIRDCLAW_WEB_TOKEN for tokened access",
						}),
						{
							headers: { "content-type": "application/json" },
							status: 403,
						},
					),
			),
		);

		render(<TodayRoute />);
		generateSummary();

		expect(
			await screen.findByText(
				"Digest request failed (403): Remote API access requires BIRDCLAW_ALLOW_REMOTE_WEB=1 for a trusted private proxy, or BIRDCLAW_WEB_TOKEN for tokened access",
			),
		).toBeInTheDocument();
	});

	it("restores a saved daily report without starting a model stream", async () => {
		const saved = digestResult(
			"2026-07-31",
			"# July 31\n\n## What people are talking about\n\n- Restored report (tweet_1)",
		);
		const metadata = {
			id: "history_1",
			date: "2026-07-31",
			timezone: "Asia/Shanghai",
			status: "ready" as const,
			title: "July 31",
			summary: "Saved daily report",
			counts: saved.context.counts,
			provider: "openai",
			model: "gpt-5.5",
			attemptCount: 1,
			createdAt: saved.updatedAt,
			updatedAt: saved.updatedAt,
			finishedAt: saved.updatedAt,
			pdfAvailable: true,
		};
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input), "http://localhost");
			if (url.pathname === "/api/profile-hydrate") {
				return Response.json({ ok: true, results: [] });
			}
			if (url.pathname === "/api/period-digest-history") {
				return url.searchParams.has("id")
					? Response.json({ item: { metadata, result: saved } })
					: Response.json({ items: [metadata] });
			}
			throw new Error(`Unexpected request: ${url.pathname}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(
			<TodayRoute
				searchState={validateTodaySearch({ run: "history_1" })}
				onSearchChange={vi.fn()}
			/>,
		);

		expect(
			await screen.findByText("Restored from daily history · 0 token"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "July 31", level: 1 }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Download 2026-07-31 PDF" }),
		).toHaveAttribute("href", "/api/period-digest-history?id=history_1&pdf=1");
		expect(
			fetchMock.mock.calls.some(
				([input]) =>
					new URL(String(input), "http://localhost").pathname ===
					"/api/period-digest",
			),
		).toBe(false);
	});

	it("restores a saved weekly report without starting a model stream", async () => {
		const saved = digestResult(
			"2026-07-20 – 2026-07-26",
			"# July 20–26\n\n## What people are talking about\n\n- Restored weekly report (tweet_1)",
		);
		const metadata = {
			id: "weekly_history_1",
			kind: "weekly" as const,
			date: "2026-07-20",
			endDate: "2026-07-26",
			timezone: "Asia/Shanghai",
			status: "ready" as const,
			title: "July 20–26",
			summary: "Saved weekly report",
			counts: saved.context.counts,
			provider: "openai",
			model: "gpt-5.5",
			attemptCount: 1,
			createdAt: saved.updatedAt,
			updatedAt: saved.updatedAt,
			finishedAt: saved.updatedAt,
			pdfAvailable: true,
		};
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input), "http://localhost");
			if (url.pathname === "/api/profile-hydrate") {
				return Response.json({ ok: true, results: [] });
			}
			if (url.pathname === "/api/weekly-digest-history") {
				return url.searchParams.has("id")
					? Response.json({ item: { metadata, result: saved } })
					: Response.json({ items: [metadata] });
			}
			throw new Error(`Unexpected request: ${url.pathname}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(
			<TodayRoute
				searchState={validateTodaySearch({
					run: "weekly_history_1",
					archive: "weekly",
				})}
				onSearchChange={vi.fn()}
			/>,
		);

		expect(
			await screen.findByText("Restored from weekly history · 0 token"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "July 20–26", level: 1 }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Download 2026-07-20 PDF" }),
		).toHaveAttribute(
			"href",
			"/api/weekly-digest-history?id=weekly_history_1&pdf=1",
		);
		expect(
			fetchMock.mock.calls.some(
				([input]) =>
					new URL(String(input), "http://localhost").pathname ===
					"/api/period-digest",
			),
		).toBe(false);
	});

	it("restores an 8-hour intraday overview without starting a model stream", async () => {
		const printMock = vi.spyOn(window, "print").mockImplementation(() => {
			window.dispatchEvent(new Event("afterprint"));
		});
		const saved = digestResult(
			"2026-08-18 · 08:00–16:00",
			"# Intraday overview\n\n## What people are talking about\n\n- Restored window (tweet_1)",
		);
		const metadata = {
			id: "intraday_history_1",
			kind: "intraday" as const,
			date: "2026-08-18",
			endDate: "2026-08-18",
			archiveKey: "2026-08-18@16",
			slotLabel: "08:00–16:00",
			timezone: "Asia/Shanghai",
			status: "ready" as const,
			title: "Intraday overview",
			summary: "Saved 8-hour report",
			counts: saved.context.counts,
			provider: "openai",
			model: "gpt-5.5",
			attemptCount: 1,
			createdAt: saved.updatedAt,
			updatedAt: saved.updatedAt,
			finishedAt: saved.updatedAt,
			pdfAvailable: false,
		};
		const requestedHistoryKinds: Array<string | null> = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input), "http://localhost");
			if (url.pathname === "/api/profile-hydrate") {
				return Response.json({ ok: true, results: [] });
			}
			if (url.pathname === "/api/period-digest-history") {
				if (url.searchParams.has("id")) {
					return Response.json({ item: { metadata, result: saved } });
				}
				requestedHistoryKinds.push(url.searchParams.get("kind"));
				return Response.json({ items: [metadata] });
			}
			throw new Error(`Unexpected request: ${url.pathname}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(
			<TodayRoute
				searchState={validateTodaySearch({
					run: "intraday_history_1",
					archive: "intraday",
				})}
				onSearchChange={vi.fn()}
			/>,
		);

		expect(
			await screen.findByText("Restored from intraday history · 0 token"),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "Intraday overview", level: 1 }),
		).toBeInTheDocument();
		expect(screen.getAllByText(/08:00–16:00/).length).toBeGreaterThan(0);
		expect(requestedHistoryKinds).toContain("intraday");
		expect(
			screen.getByRole("link", {
				name: "Download 2026-08-18@16 PDF",
			}),
		).toHaveAttribute(
			"href",
			"/api/period-digest-history?id=intraday_history_1&pdf=1",
		);
		expect(
			fetchMock.mock.calls.some(
				([input]) =>
					new URL(String(input), "http://localhost").pathname ===
					"/api/period-digest",
			),
		).toBe(false);

		fireEvent.click(screen.getByRole("button", { name: "导出完整 PDF" }));

		await waitFor(() => expect(printMock).toHaveBeenCalledTimes(1));
		expect(fetchTweetScoresMock).not.toHaveBeenCalled();
		expect(
			fetchMock.mock.calls.some(([input]) => {
				const pathname = new URL(String(input), "http://localhost").pathname;
				return (
					pathname === "/api/period-digest" || pathname === "/api/tweet-scores"
				);
			}),
		).toBe(false);
	});

	it("clears daily rows while a delayed weekly archive is loading", async () => {
		const live = digestResult("Today", "# Today\n\nFresh digest.");
		const dailyMetadata = {
			id: "daily_stale",
			kind: "daily" as const,
			date: "2026-07-31",
			endDate: "2026-07-31",
			timezone: "Asia/Shanghai",
			status: "ready" as const,
			title: "Stale daily archive row",
			summary: "Must disappear during the archive switch.",
			counts: live.context.counts,
			provider: "openai",
			model: "gpt-5.5",
			attemptCount: 1,
			createdAt: live.updatedAt,
			updatedAt: live.updatedAt,
			finishedAt: live.updatedAt,
			pdfAvailable: false,
		};
		const weeklyMetadata = {
			...dailyMetadata,
			id: "weekly_fresh",
			kind: "weekly" as const,
			date: "2026-07-20",
			endDate: "2026-07-26",
			title: "Fresh weekly archive row",
			summary: "Loaded from the weekly endpoint.",
		};
		let resolveWeekly: ((response: Response) => void) | undefined;
		const weeklyResponse = new Promise<Response>((resolve) => {
			resolveWeekly = resolve;
		});
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input), "http://localhost");
			if (url.pathname === "/api/period-digest-history") {
				return Response.json({ items: [dailyMetadata] });
			}
			if (url.pathname === "/api/weekly-digest-history") {
				return weeklyResponse;
			}
			if (url.pathname === "/api/profile-hydrate") {
				return Response.json({ ok: true, results: [] });
			}
			if (url.pathname === "/api/period-digest") {
				return ndjsonResponse([{ type: "done", result: live }]);
			}
			throw new Error(`Unexpected request: ${url.pathname}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		function HistoryHarness() {
			const [search, setSearch] = useState(() => validateTodaySearch({}));
			return (
				<TodayRoute
					searchState={search}
					onSearchChange={(next) => setSearch(next)}
				/>
			);
		}

		render(<HistoryHarness />);
		expect(
			await screen.findByText("Stale daily archive row"),
		).toBeInTheDocument();
		fireEvent.click(
			screen.getAllByRole("button", { name: /^weekly$/i })[0] as HTMLElement,
		);
		expect(screen.queryByText("Stale daily archive row")).toBeNull();

		await act(async () => {
			resolveWeekly?.(Response.json({ items: [weeklyMetadata] }));
			await weeklyResponse;
		});
		expect(
			await screen.findByText("Fresh weekly archive row"),
		).toBeInTheDocument();
		expect(screen.queryByText("Stale daily archive row")).toBeNull();
	});

	it("shows an actionable message when the digest connection drops", async () => {
		const fetchMock = vi.fn(async () => {
			throw new TypeError("network error");
		});
		vi.stubGlobal("fetch", fetchMock);

		render(<TodayRoute />);
		generateSummary();

		expect(
			await screen.findByText(
				"Digest connection was interrupted while starting digest. Retry to continue.",
			),
		).toBeInTheDocument();
		expect(screen.getByText("Digest failed")).toBeInTheDocument();
		expect(
			screen.getByText("No digest was generated. Retry to start a new run."),
		).toBeInTheDocument();
		expect(
			screen.queryByText("Waiting for the first tokens..."),
		).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
	});

	it("shows fetch status before the first markdown token", async () => {
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		const encoder = new TextEncoder();
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				if (url.pathname === "/api/profile-hydrate") {
					return new Response(JSON.stringify({ ok: true, results: [] }), {
						headers: { "content-type": "application/json" },
					});
				}
				return new Response(
					new ReadableStream<Uint8Array>({
						start(streamController) {
							controller = streamController;
							streamController.enqueue(
								encoder.encode(
									`${JSON.stringify({
										type: "status",
										label: "Fetching home timeline from X",
									})}\n`,
								),
							);
						},
					}),
					{ headers: { "content-type": "application/x-ndjson" } },
				);
			}),
		);

		render(<TodayRoute />);
		generateSummary();

		expect(
			await screen.findAllByText("Fetching home timeline from X"),
		).not.toHaveLength(0);

		const markdown = "# Today\n\nDone.";
		await act(async () => {
			controller?.enqueue(
				encoder.encode(
					[
						JSON.stringify({ type: "delta", delta: markdown }),
						JSON.stringify({
							type: "done",
							result: digestResult("Today", markdown),
						}),
						"",
					].join("\n"),
				),
			);
			controller?.close();
		});

		expect(
			await screen.findByRole("heading", { name: "Today", level: 1 }),
		).toBeInTheDocument();
	});

	it("shows streamed error events", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				ndjsonResponse([{ type: "error", error: "model failed" }]),
			),
		);

		render(<TodayRoute />);
		generateSummary();

		expect(await screen.findByText("model failed")).toBeInTheDocument();
	});

	it("turns exhausted OpenAI transient failures into actionable copy", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				ndjsonResponse([
					{
						type: "error",
						error:
							"OpenAI request failed: 503 Service temporarily unavailable (after 3 attempts)",
					},
				]),
			),
		);

		render(<TodayRoute />);
		generateSummary();

		expect(
			await screen.findByText(
				"AI service is temporarily unavailable. BirdClaw retried automatically; retry again in a moment.",
			),
		).toBeInTheDocument();
		expect(
			screen.queryByText(/Service temporarily unavailable/),
		).not.toBeInTheDocument();
	});

	it("does not claim an automatic retry when the server forbids one", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				ndjsonResponse([
					{
						type: "error",
						error: "OpenAI request failed: 503 do not retry",
					},
				]),
			),
		);

		render(<TodayRoute />);
		generateSummary();

		expect(
			await screen.findByText(
				"AI service is temporarily unavailable. Retry again in a moment.",
			),
		).toBeInTheDocument();
		expect(
			screen.queryByText(/retried automatically/i),
		).not.toBeInTheDocument();
	});
});
