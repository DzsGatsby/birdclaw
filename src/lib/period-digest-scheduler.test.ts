// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBirdclawPathsForTests } from "./config";
import { getNativeDb, resetDatabaseForTests } from "./db";
import { __test__ } from "./period-digest-scheduler";

let temporaryHome = "";

beforeEach(() => {
	temporaryHome = mkdtempSync(path.join(os.tmpdir(), "birdclaw-scheduler-"));
	process.env.BIRDCLAW_HOME = temporaryHome;
	resetBirdclawPathsForTests();
	resetDatabaseForTests();
});

afterEach(() => {
	vi.useRealTimers();
	resetDatabaseForTests();
	resetBirdclawPathsForTests();
	delete process.env.BIRDCLAW_HOME;
	rmSync(temporaryHome, { recursive: true, force: true });
});

describe("daily digest scheduler", () => {
	it("backs off repeated failures and cools down terminal provider errors", () => {
		expect(__test__.retryDelayMs(1, new Error("temporary 503"))).toBe(
			5 * 60_000,
		);
		expect(__test__.retryDelayMs(2, new Error("temporary 503"))).toBe(
			10 * 60_000,
		);
		expect(__test__.retryDelayMs(99, new Error("temporary 503"))).toBe(
			60 * 60_000,
		);
		expect(
			__test__.retryDelayMs(
				1,
				new Error("DeepSeek request failed: 402 Insufficient Balance"),
			),
		).toBe(6 * 60 * 60_000);
	});

	it("starts with yesterday only on a fresh archive", () => {
		expect(__test__.startupDigestDates(new Date(2026, 7, 1, 8))).toEqual([
			"2026-07-31",
		]);
	});

	it("fills bounded gaps after the first saved daily report", () => {
		const db = getNativeDb({ seedDemoData: false });
		const insert = db.prepare(
			`insert into period_digest_history (
			 id, digest_date, timezone, status, started_at, finished_at,
			 created_at, updated_at
			) values (?, ?, 'Asia/Shanghai', 'ready', ?, ?, ?, ?)`,
		);
		for (const date of ["2026-07-28", "2026-07-30"]) {
			const timestamp = `${date}T16:00:00.000Z`;
			insert.run(
				`history-${date}`,
				date,
				timestamp,
				timestamp,
				timestamp,
				timestamp,
			);
		}
		expect(__test__.startupDigestDates(new Date(2026, 7, 1, 8))).toEqual([
			"2026-07-29",
			"2026-07-31",
		]);
	});

	it("requeues a pending report so a crashed worker can be reclaimed", () => {
		const db = getNativeDb({ seedDemoData: false });
		db.prepare(
			`insert into period_digest_history (
			 id, digest_date, timezone, status, started_at, created_at, updated_at
			) values (?, ?, 'Asia/Shanghai', 'pending', ?, ?, ?)`,
		).run(
			"stale-pending",
			"2026-07-31",
			"2020-01-01T00:00:00.000Z",
			"2020-01-01T00:00:00.000Z",
			"2020-01-01T00:00:00.000Z",
		);

		expect(__test__.startupDigestDates(new Date(2026, 7, 1, 8))).toEqual([
			"2026-07-31",
		]);
	});

	it("recomputes every missed date after a multi-day sleep", () => {
		const db = getNativeDb({ seedDemoData: false });
		db.prepare(
			`insert into period_digest_history (
			 id, digest_date, timezone, status, started_at, finished_at,
			 created_at, updated_at
			) values (?, ?, 'Asia/Shanghai', 'ready', ?, ?, ?, ?)`,
		).run(
			"history-2026-07-28",
			"2026-07-28",
			"2026-07-28T16:00:00.000Z",
			"2026-07-28T16:00:00.000Z",
			"2026-07-28T16:00:00.000Z",
			"2026-07-28T16:00:00.000Z",
		);

		expect(__test__.startupDigestDates(new Date(2026, 7, 2, 8))).toEqual([
			"2026-07-29",
			"2026-07-30",
			"2026-07-31",
			"2026-08-01",
		]);
	});

	it("keeps an independent retry timer for every failed date", () => {
		vi.useFakeTimers();
		const scheduler = new __test__.DailyDigestScheduler({
			archive: vi.fn(),
			ensurePdf: vi.fn(),
		});
		const internal = scheduler as unknown as {
			retryTimers: Map<string, ReturnType<typeof setTimeout>>;
			scheduleRetry: (date: string) => void;
		};
		internal.scheduleRetry("2026-07-30");
		internal.scheduleRetry("2026-07-31");
		expect([...internal.retryTimers.keys()]).toEqual([
			"2026-07-30",
			"2026-07-31",
		]);
		scheduler.stop();
	});

	it("recomputes the delay to the next local midnight", () => {
		expect(__test__.nextLocalMidnightDelay(new Date(2026, 7, 1, 23, 30))).toBe(
			30 * 60_000,
		);
	});
});
