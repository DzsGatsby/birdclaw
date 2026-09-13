import path from "node:path";
import { getBirdclawPaths } from "./config";
import { digestRetryDelayMs } from "./digest-retry";
import {
	archiveIntradayDigestSlot,
	latestCompletedIntradaySlotKey,
	listPeriodDigestHistory,
	nextIntradaySlotKey,
	previousIntradaySlotKey,
} from "./period-digest-history";
import { redactProviderError } from "./openai-response-runtime";
import {
	acquireScheduledJobLock,
	appendScheduledJobAudit,
	startScheduledJobRun,
} from "./scheduled-job";

const LOCK_STALE_MS = 2 * 60 * 60_000;
const MAX_CATCH_UP_SLOTS = 3;

interface IntradayDigestSchedulerDependencies {
	archive: typeof archiveIntradayDigestSlot;
}

let activeManager: IntradayDigestScheduler | undefined;

export function nextIntradayBoundaryDelay(now = new Date()) {
	const nextHour = (Math.floor(now.getHours() / 8) + 1) * 8;
	const next = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
		nextHour,
	);
	return Math.max(1_000, next.getTime() - now.getTime());
}

export function startupIntradaySlots(now = new Date()) {
	const latest = latestCompletedIntradaySlotKey(now);
	const items = listPeriodDigestHistory({
		kind: "intraday",
		limit: 366,
	});
	if (items.length === 0) return [latest];
	let catchUpStart = latest;
	for (let index = 1; index < MAX_CATCH_UP_SLOTS; index += 1) {
		catchUpStart = previousIntradaySlotKey(catchUpStart);
	}

	const queued = new Set(
		items
			.filter(
				(item) => item.status !== "ready" && item.archiveKey >= catchUpStart,
			)
			.slice(0, MAX_CATCH_UP_SLOTS)
			.map((item) => item.archiveKey),
	);
	let cursor = items[0]?.archiveKey;
	if (cursor && cursor < catchUpStart) {
		cursor = previousIntradaySlotKey(catchUpStart);
	}
	let remaining = MAX_CATCH_UP_SLOTS;
	while (cursor && cursor < latest && remaining > 0) {
		cursor = nextIntradaySlotKey(cursor);
		queued.add(cursor);
		remaining -= 1;
	}
	return [...queued].sort();
}

class IntradayDigestScheduler {
	private boundaryTimer: ReturnType<typeof setTimeout> | undefined;
	private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private stopped = false;
	private inFlight: Promise<void> | undefined;
	private pendingSlots = new Set<string>();
	private activeAbort: AbortController | undefined;

	constructor(
		private readonly dependencies: IntradayDigestSchedulerDependencies = {
			archive: archiveIntradayDigestSlot,
		},
	) {}

	start() {
		this.scheduleBoundary();
		for (const slotKey of startupIntradaySlots()) this.queue(slotKey);
	}

	stop() {
		this.stopped = true;
		if (this.boundaryTimer) clearTimeout(this.boundaryTimer);
		for (const timer of this.retryTimers.values()) clearTimeout(timer);
		this.retryTimers.clear();
		this.activeAbort?.abort(new Error("Intraday digest scheduler stopped"));
		this.activeAbort = undefined;
		this.boundaryTimer = undefined;
	}

	private scheduleBoundary() {
		if (this.stopped) return;
		this.boundaryTimer = setTimeout(() => {
			this.scheduleBoundary();
			for (const slotKey of startupIntradaySlots()) this.queue(slotKey);
		}, nextIntradayBoundaryDelay());
		this.boundaryTimer.unref?.();
	}

	private scheduleRetry(slotKey: string, error?: unknown) {
		if (this.stopped || this.retryTimers.has(slotKey)) return;
		const attemptCount =
			listPeriodDigestHistory({ kind: "intraday", limit: 366 }).find(
				(item) => item.archiveKey === slotKey,
			)?.attemptCount ?? 1;
		const timer = setTimeout(
			() => {
				this.retryTimers.delete(slotKey);
				this.queue(slotKey);
			},
			digestRetryDelayMs(attemptCount, error),
		);
		this.retryTimers.set(slotKey, timer);
		timer.unref?.();
	}

	private queue(slotKey: string) {
		if (this.stopped) return;
		this.pendingSlots.add(slotKey);
		this.drain();
	}

	private drain() {
		if (this.stopped || this.inFlight) return;
		const slotKey = this.pendingSlots.values().next().value as
			| string
			| undefined;
		if (!slotKey) return;
		this.pendingSlots.delete(slotKey);
		this.inFlight = this.run(slotKey)
			.catch((error) => this.scheduleRetry(slotKey, error))
			.finally(() => {
				this.inFlight = undefined;
				this.drain();
			});
	}

	private async run(slotKey: string) {
		const { rootDir } = getBirdclawPaths();
		const lockPath = path.join(
			rootDir,
			"locks",
			"period-digest-generation.lock",
		);
		const auditPath = path.join(rootDir, "logs", "intraday-digest.jsonl");
		const release = await acquireScheduledJobLock(lockPath, LOCK_STALE_MS);
		if (!release) {
			this.scheduleRetry(slotKey);
			return;
		}
		const job = startScheduledJobRun();
		const abort = new AbortController();
		this.activeAbort = abort;
		try {
			const outcome = await this.dependencies.archive(slotKey, {
				signal: abort.signal,
			});
			await appendScheduledJobAudit(auditPath, {
				job: "intraday-period-digest",
				slotKey,
				outcome,
				...job.finish(),
			});
			if (outcome.status === "pending") this.scheduleRetry(slotKey);
		} catch (error) {
			await appendScheduledJobAudit(auditPath, {
				job: "intraday-period-digest",
				slotKey,
				status: "failed",
				error: redactProviderError(
					error instanceof Error ? error.message : String(error),
				),
				...job.finish(),
			});
			this.scheduleRetry(slotKey, error);
		} finally {
			if (this.activeAbort === abort) this.activeAbort = undefined;
			await release();
		}
	}
}

export function startIntradayDigestScheduler() {
	if (activeManager) return activeManager;
	activeManager = new IntradayDigestScheduler();
	activeManager.start();
	return activeManager;
}

export function stopIntradayDigestScheduler() {
	activeManager?.stop();
	activeManager = undefined;
}

export const __test__ = {
	IntradayDigestScheduler,
};
