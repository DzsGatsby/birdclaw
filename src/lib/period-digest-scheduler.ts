import path from "node:path";
import { getBirdclawPaths } from "./config";
import { ensureDailyDigestPdf } from "./daily-digest-pdf";
import { digestRetryDelayMs } from "./digest-retry";
import {
	archivePeriodDigestDate,
	listPeriodDigestHistory,
	localDateKey,
	previousLocalDateKey,
} from "./period-digest-history";
import { redactProviderError } from "./openai-response-runtime";
import {
	acquireScheduledJobLock,
	appendScheduledJobAudit,
	startScheduledJobRun,
} from "./scheduled-job";

const LOCK_STALE_MS = 2 * 60 * 60_000;

interface DailyDigestSchedulerDependencies {
	archive: typeof archivePeriodDigestDate;
	ensurePdf: typeof ensureDailyDigestPdf;
}

let activeManager: DailyDigestScheduler | undefined;

function nextLocalMidnightDelay(now = new Date()) {
	const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	return Math.max(1_000, next.getTime() - now.getTime());
}

function dateFromKey(value: string) {
	const [year, month, day] = value.split("-").map(Number);
	return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12);
}

function startupDigestDates(now = new Date()) {
	const yesterdayKey = previousLocalDateKey(now);
	const items = listPeriodDigestHistory({ limit: 366 });
	if (items.length === 0) return [yesterdayKey];
	const yesterday = dateFromKey(yesterdayKey);
	const cap = new Date(
		yesterday.getFullYear(),
		yesterday.getMonth(),
		yesterday.getDate() - 30,
		12,
	);
	const oldest = items.reduce(
		(current, item) => (item.date < current ? item.date : current),
		items[0]?.date ?? yesterdayKey,
	);
	const oldestDate = dateFromKey(oldest);
	const start = oldestDate > cap ? oldestDate : cap;
	const complete = new Set(
		items.filter((item) => item.status === "ready").map((item) => item.date),
	);
	const missing: string[] = [];
	for (
		let cursor = start;
		cursor <= yesterday;
		cursor = new Date(
			cursor.getFullYear(),
			cursor.getMonth(),
			cursor.getDate() + 1,
			12,
		)
	) {
		const key = localDateKey(cursor);
		if (!complete.has(key)) missing.push(key);
	}
	return missing;
}

class DailyDigestScheduler {
	private midnightTimer: ReturnType<typeof setTimeout> | undefined;
	private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private stopped = false;
	private inFlight: Promise<void> | undefined;
	private pendingDates = new Set<string>();
	private activeAbort: AbortController | undefined;

	constructor(
		private readonly dependencies: DailyDigestSchedulerDependencies = {
			archive: archivePeriodDigestDate,
			ensurePdf: ensureDailyDigestPdf,
		},
	) {}

	start() {
		this.scheduleMidnight();
		for (const date of startupDigestDates()) this.queueDate(date);
	}

	stop() {
		this.stopped = true;
		if (this.midnightTimer) clearTimeout(this.midnightTimer);
		for (const timer of this.retryTimers.values()) clearTimeout(timer);
		this.retryTimers.clear();
		this.activeAbort?.abort(new Error("Daily digest scheduler stopped"));
		this.activeAbort = undefined;
		this.midnightTimer = undefined;
	}

	private scheduleMidnight() {
		if (this.stopped) return;
		this.midnightTimer = setTimeout(() => {
			this.scheduleMidnight();
			for (const date of startupDigestDates()) this.queueDate(date);
		}, nextLocalMidnightDelay());
		this.midnightTimer.unref?.();
	}

	private scheduleRetry(date: string, error?: unknown) {
		if (this.stopped || this.retryTimers.has(date)) return;
		const attemptCount =
			listPeriodDigestHistory({ limit: 366 }).find(
				(item) => item.archiveKey === date,
			)?.attemptCount ?? 1;
		const timer = setTimeout(
			() => {
				this.retryTimers.delete(date);
				this.queueDate(date);
			},
			digestRetryDelayMs(attemptCount, error),
		);
		this.retryTimers.set(date, timer);
		timer.unref?.();
	}

	queueDate(date: string) {
		if (this.stopped) return;
		this.pendingDates.add(date);
		this.drain();
	}

	private drain() {
		if (this.stopped || this.inFlight) return;
		const date = this.pendingDates.values().next().value as string | undefined;
		if (!date) return;
		this.pendingDates.delete(date);
		this.inFlight = this.run(date)
			.catch((error) => this.scheduleRetry(date, error))
			.finally(() => {
				this.inFlight = undefined;
				this.drain();
			});
	}

	private async run(date: string) {
		const { rootDir } = getBirdclawPaths();
		const lockPath = path.join(
			rootDir,
			"locks",
			"period-digest-generation.lock",
		);
		const auditPath = path.join(rootDir, "logs", "daily-digest.jsonl");
		const release = await acquireScheduledJobLock(lockPath, LOCK_STALE_MS);
		if (!release) {
			this.scheduleRetry(date);
			return;
		}
		const job = startScheduledJobRun();
		const abort = new AbortController();
		this.activeAbort = abort;
		try {
			const outcome = await this.dependencies.archive(date, {
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
				job: "daily-period-digest",
				date,
				outcome,
				pdf,
				...job.finish(),
			});
			if (outcome.status === "pending") this.scheduleRetry(date);
		} catch (error) {
			await appendScheduledJobAudit(auditPath, {
				job: "daily-period-digest",
				date,
				status: "failed",
				error: redactProviderError(
					error instanceof Error ? error.message : String(error),
				),
				...job.finish(),
			});
			this.scheduleRetry(date, error);
		} finally {
			if (this.activeAbort === abort) this.activeAbort = undefined;
			await release();
		}
	}
}

export function startPeriodDigestScheduler() {
	if (activeManager) return activeManager;
	activeManager = new DailyDigestScheduler();
	activeManager.start();
	return activeManager;
}

export function stopPeriodDigestScheduler() {
	activeManager?.stop();
	activeManager = undefined;
}

export function queuePeriodDigestDate(date: string) {
	if (!activeManager) {
		activeManager = new DailyDigestScheduler();
		activeManager.start();
	}
	activeManager.queueDate(date);
}

export const __test__ = {
	DailyDigestScheduler,
	nextLocalMidnightDelay,
	retryDelayMs: digestRetryDelayMs,
	startupDigestDates,
};
