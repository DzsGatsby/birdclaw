// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBirdclawPathsForTests } from "#/lib/config";
import { resetDatabaseForTests } from "#/lib/db";
import {
	claimPeriodDigestDate,
	completePeriodDigestHistory,
	localWindowForDateKey,
} from "#/lib/period-digest-history";
import type { PeriodDigestRunResult } from "#/lib/period-digest";
import { queuePeriodDigestDate } from "#/lib/period-digest-scheduler";
import { getRouteHandler } from "#/test/route-handlers";
import { Route } from "./period-digest-history";

vi.mock("#/lib/period-digest-scheduler", () => ({
	queuePeriodDigestDate: vi.fn(),
}));

const GET = getRouteHandler(Route, "GET");
const POST = getRouteHandler(Route, "POST");
let temporaryHome = "";

beforeEach(() => {
	vi.mocked(queuePeriodDigestDate).mockClear();
	temporaryHome = mkdtempSync(path.join(os.tmpdir(), "birdclaw-history-api-"));
	process.env.BIRDCLAW_HOME = temporaryHome;
	resetBirdclawPathsForTests();
	resetDatabaseForTests();
});

afterEach(() => {
	resetDatabaseForTests();
	resetBirdclawPathsForTests();
	delete process.env.BIRDCLAW_HOME;
	rmSync(temporaryHome, { recursive: true, force: true });
});

function saveHistory() {
	const date = "2026-07-31";
	const claim = claimPeriodDigestDate(date);
	if (!claim.claimed) throw new Error("Expected claim");
	const window = localWindowForDateKey(date);
	const result: PeriodDigestRunResult = {
		context: {
			window: { label: date, ...window },
			includeDms: false,
			counts: {
				home: 1,
				mentions: 0,
				authored: 0,
				likes: 0,
				bookmarks: 0,
				dms: 0,
				links: 0,
			},
			tweets: [],
			dms: [],
			links: [],
			hash: "history-api-hash",
		},
		digest: {
			title: "July 31 report",
			summary: "Saved automatically.",
			keyTopics: [],
			notableLinks: [],
			people: [],
			actionItems: [],
			sourceTweetIds: [],
		},
		markdown: "# July 31 report",
		provider: "openai",
		model: "gpt-5.5",
		reasoningEffort: "medium",
		serviceTier: "priority",
		cached: false,
		updatedAt: "2026-08-01T00:01:00.000Z",
	};
	completePeriodDigestHistory(claim.id, claim.claimToken, result);
	return claim.id;
}

describe("daily digest history API", () => {
	it("lists metadata and restores the saved result", async () => {
		const id = saveHistory();
		const listResponse = await GET({
			request: new Request("http://localhost/api/period-digest-history"),
		});
		expect(listResponse.status).toBe(200);
		expect(await listResponse.json()).toMatchObject({
			items: [
				{
					id,
					date: "2026-07-31",
					status: "ready",
					title: "July 31 report",
					pdfAvailable: false,
				},
			],
		});

		const detailResponse = await GET({
			request: new Request(
				`http://localhost/api/period-digest-history?id=${id}`,
			),
		});
		expect(detailResponse.status).toBe(200);
		expect(await detailResponse.json()).toMatchObject({
			item: {
				metadata: { id, status: "ready" },
				result: {
					markdown: "# July 31 report",
					cached: true,
					provider: "openai",
				},
			},
		});
	});

	it("returns 404 for missing history", async () => {
		const response = await GET({
			request: new Request(
				"http://localhost/api/period-digest-history?id=missing",
			),
		});
		expect(response.status).toBe(404);
	});

	it("queues an exact valid date for retry", async () => {
		const response = await POST({
			request: new Request("http://localhost/api/period-digest-history", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action: "retry", date: "2026-09-12" }),
			}),
		});

		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({
			ok: true,
			date: "2026-09-12",
			status: "queued",
		});
		expect(queuePeriodDigestDate).toHaveBeenCalledOnce();
		expect(queuePeriodDigestDate).toHaveBeenCalledWith("2026-09-12");
	});

	it("rejects an impossible retry date", async () => {
		const response = await POST({
			request: new Request("http://localhost/api/period-digest-history", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action: "retry", date: "2026-02-31" }),
			}),
		});

		expect(response.status).toBe(400);
		expect(queuePeriodDigestDate).not.toHaveBeenCalled();
	});
});
