import path from "node:path";
import { getBirdclawPaths } from "./config";
import { ensureWeeklyDigestPdf } from "./daily-digest-pdf";
import { digestRetryDelayMs } from "./digest-retry";
import { redactProviderError } from "./openai-response-runtime";
import {
	acquireScheduledJobLock,
	appendScheduledJobAudit,
	startScheduledJobRun,
} from "./scheduled-job";
import {
	archiveWeeklyDigest,
	CURRENT_WEEKLY_DIGEST_FORMAT_VERSION,
	listWeeklyDigestHistory,
	localWeekStartKey,
	previousCompletedWeekStartKey,
} from "./weekly-digest-history";

const LOCK_STALE_MS = 2 * 60 * 60_000;
const MAX_BACKFILL_WEEKS = 12;

interface WeeklyDigestSchedulerDependencies {
	archive: typeof archiveWeeklyDigest;
	ensurePdf: typeof ensureWeeklyDigestPdf;
}

let activeManager: WeeklyDigestScheduler | undefined;

function nextLocalMidnightDelay(now = new Date()) {
	const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	return Math.max(1_000, next.getTime() - now.getTime());
}

function dateFromKey(value: string) {
	const [year, month, day] = value.split("-").map(Number);
	return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12);
}

export function startupDigestWeeks(now = new Date()) {
	const previousWeekKey = previousCompletedWeekStartKey(now);
	const items = listWeeklyDigestHistory({ limit: 260 });
	if (items.length === 0) return [previousWeekKey];
	const previousWeek = dateFromKey(previousWeekKey);
	const cap = new Date(
		previousWeek.getFullYear(),
		previousWeek.getMonth(),
		previousWeek.getDate() - (MAX_BACKFILL_WEEKS - 1) * 7,
		12,
	);
	const oldest = items.reduce(
		(current, item) => (item.date < current ? item.date : current),
		items[0]?.date ?? previousWeekKey,
	);
	const oldestDate = dateFromKey(oldest);
	const start = oldestDate > cap ? oldestDate : cap;
	const complete = new Set(
		items
			.filter(
				(item) =>
					item.status === "ready" &&
					item.formatVersion >= CURRENT_WEEKLY_DIGEST_FORMAT_VERSION,
			)
			.map((item) => item.date),
	);
	const missing: string[] = [];
	for (
		let cursor = start;
		cursor <= previousWeek;
		cursor = new Date(
			cursor.getFullYear(),
			cursor.getMonth(),
			cursor.getDate() + 7,
			12,
		)
	) {
		const key = localWeekStartKey(cursor);
		if (!complete.has(key)) missing.push(key);
	}
	return missing;
}

class WeeklyDigestScheduler {
	private midnightTimer: ReturnType<typeof setTimeout> | undefined;
	private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private stopped = false;
	private inFlight: Promise<void> | undefined;
	private pendingWeeks = new Set<string>();
	private activeAbort: AbortController | undefined;

	constructor(
		private readonly dependencies: WeeklyDigestSchedulerDependencies = {
			archive: archiveWeeklyDigest,
			ensurePdf: ensureWeeklyDigestPdf,
		},
	) {}

	start() {
		this.scheduleMidnight();
		for (const weekStart of startupDigestWeeks()) this.queue(weekStart);
	}

	stop() {
		this.stopped = true;
		if (this.midnightTimer) clearTimeout(this.midnightTimer);
		for (const timer of this.retryTimers.values()) clearTimeout(timer);
		this.retryTimers.clear();
		this.activeAbort?.abort(new Error("Weekly digest scheduler stopped"));
		this.activeAbort = undefined;
		this.midnightTimer = undefined;
	}

	private scheduleMidnight() {
		if (this.stopped) return;
		this.midnightTimer = setTimeout(() => {
			this.scheduleMidnight();
			for (const weekStart of startupDigestWeeks()) this.queue(weekStart);
		}, nextLocalMidnightDelay());
		this.midnightTimer.unref?.();
	}

	private scheduleRetry(weekStart: string, error?: unknown) {
		if (this.stopped || this.retryTimers.has(weekStart)) return;
		const attemptCount =
			listWeeklyDigestHistory({ limit: 260 }).find(
				(item) => item.date === weekStart,
			)?.attemptCount ?? 1;
		const timer = setTimeout(
			() => {
				this.retryTimers.delete(weekStart);
				this.queue(weekStart);
			},
			digestRetryDelayMs(attemptCount, error),
		);
		this.retryTimers.set(weekStart, timer);
		timer.unref?.();
	}

	private queue(weekStart: string) {
		if (this.stopped) return;
		this.pendingWeeks.add(weekStart);
		this.drain();
	}

	private drain() {
		if (this.stopped || this.inFlight) return;
		const weekStart = this.pendingWeeks.values().next().value as
			| string
			| undefined;
		if (!weekStart) return;
		this.pendingWeeks.delete(weekStart);
		this.inFlight = this.run(weekStart)
			.catch((error) => this.scheduleRetry(weekStart, error))
			.finally(() => {
				this.inFlight = undefined;
				this.drain();
			});
	}

	private async run(weekStart: string) {
		const { rootDir } = getBirdclawPaths();
		const lockPath = path.join(
			rootDir,
			"locks",
			"period-digest-generation.lock",
		);
		const auditPath = path.join(rootDir, "logs", "weekly-digest.jsonl");
		const release = await acquireScheduledJobLock(lockPath, LOCK_STALE_MS);
		if (!release) {
			this.scheduleRetry(weekStart);
			return;
		}
		const job = startScheduledJobRun();
		const abort = new AbortController();
		this.activeAbort = abort;
		try {
			const outcome = await this.dependencies.archive(weekStart, {
				signal: abort.signal,
			});
			let pdf: "ready" | "deferred" = "deferred";
			if (outcome.status === "ready") {
				try {
					await this.dependencies.ensurePdf({ id: outcome.id });
					pdf = "ready";
				} catch {
					// The attachment endpoint retries PDF rendering without model usage.
				}
			}
			await appendScheduledJobAudit(auditPath, {
				job: "weekly-period-digest",
				weekStart,
				outcome,
				pdf,
				...job.finish(),
			});
			if (outcome.status === "pending") this.scheduleRetry(weekStart);
		} catch (error) {
			await appendScheduledJobAudit(auditPath, {
				job: "weekly-period-digest",
				weekStart,
				status: "failed",
				error: redactProviderError(
					error instanceof Error ? error.message : String(error),
				),
				...job.finish(),
			});
			this.scheduleRetry(weekStart, error);
		} finally {
			if (this.activeAbort === abort) this.activeAbort = undefined;
			await release();
		}
	}
}

export function startWeeklyDigestScheduler() {
	if (activeManager) return activeManager;
	activeManager = new WeeklyDigestScheduler();
	activeManager.start();
	return activeManager;
}

export function stopWeeklyDigestScheduler() {
	activeManager?.stop();
	activeManager = undefined;
}

export const __test__ = {
	WeeklyDigestScheduler,
	nextLocalMidnightDelay,
	startupDigestWeeks,
};
