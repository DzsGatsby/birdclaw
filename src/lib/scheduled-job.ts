import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { lock as acquireLease } from "proper-lockfile";
import { tryPromise } from "./effect-runtime";

export interface ScheduledJobRunMetadata {
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	host: string;
	pid: number;
}

export interface ScheduledJobRun {
	readonly startedAt: string;
	finish(): ScheduledJobRunMetadata;
}

export type ScheduledJobLockRelease = () => Promise<void>;

export interface LegacyScheduledJobLockMigration {
	status: "absent" | "lease" | "legacy";
	migrated: boolean;
	archivedPath?: string;
}

function hasErrorCode(error: unknown, code: string) {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === code
	);
}

function leaseStaleMs(requestedMs: number) {
	return Math.min(Math.max(requestedMs, 2_000), 30_000);
}

const MIN_AUTOMATIC_LEGACY_LOCK_AGE_MS = 2 * 60 * 60_000;

function automaticLegacyLockAgeMs(requestedMs: number) {
	return Math.max(requestedMs, MIN_AUTOMATIC_LEGACY_LOCK_AGE_MS);
}

function legacyLockArchivePath(lockPath: string) {
	return `${lockPath}.legacy-${new Date()
		.toISOString()
		.replaceAll(/[^0-9]/g, "")}-${randomUUID()}`;
}

export function startScheduledJobRun(started = Date.now()): ScheduledJobRun {
	const startedAt = new Date(started).toISOString();
	return {
		startedAt,
		finish() {
			const finished = Date.now();
			return {
				startedAt,
				finishedAt: new Date(finished).toISOString(),
				durationMs: finished - started,
				host: os.hostname(),
				pid: process.pid,
			};
		},
	};
}

export async function appendScheduledJobAudit(logPath: string, entry: unknown) {
	await fs.mkdir(path.dirname(logPath), { recursive: true });
	await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export async function migrateLegacyScheduledJobLock(
	lockPath: string,
	confirmedDrained = false,
): Promise<LegacyScheduledJobLockMigration> {
	const existing = await fs.lstat(lockPath).catch((error: unknown) => {
		if (hasErrorCode(error, "ENOENT")) return undefined;
		throw error;
	});
	if (!existing) return { status: "absent", migrated: false };
	if (existing.isDirectory()) return { status: "lease", migrated: false };
	if (!confirmedDrained) return { status: "legacy", migrated: false };

	const archivedPath = legacyLockArchivePath(lockPath);
	await fs.rename(lockPath, archivedPath);
	return { status: "legacy", migrated: true, archivedPath };
}

export function appendScheduledJobAuditEffect(logPath: string, entry: unknown) {
	return tryPromise(() => appendScheduledJobAudit(logPath, entry));
}

export async function acquireScheduledJobLock(
	lockPath: string,
	staleMs: number,
): Promise<ScheduledJobLockRelease | undefined> {
	await fs.mkdir(path.dirname(lockPath), { recursive: true });
	const existing = await fs.lstat(lockPath).catch((error: unknown) => {
		if (hasErrorCode(error, "ENOENT")) return undefined;
		throw error;
	});
	// Releases before v0.8.63 used a regular file at this path. Preserve fresh
	// files during rolling upgrades, but recover ancient files left on a
	// persistent volume by archiving them before acquiring the current lease.
	if (existing && !existing.isDirectory()) {
		if (Date.now() - existing.mtimeMs < automaticLegacyLockAgeMs(staleMs)) {
			return undefined;
		}
		try {
			await fs.rename(lockPath, legacyLockArchivePath(lockPath));
		} catch (error) {
			if (!hasErrorCode(error, "ENOENT")) throw error;
		}
	}

	const stale = leaseStaleMs(staleMs);
	try {
		return await acquireLease(lockPath, {
			lockfilePath: lockPath,
			realpath: false,
			retries: 0,
			stale,
			update: Math.max(1_000, Math.floor(stale / 3)),
		});
	} catch (error) {
		if (!hasErrorCode(error, "ELOCKED")) throw error;
		return undefined;
	}
}

export function acquireScheduledJobLockEffect(
	lockPath: string,
	staleMs: number,
): Effect.Effect<(() => Effect.Effect<void>) | undefined, unknown> {
	return tryPromise(() => acquireScheduledJobLock(lockPath, staleMs)).pipe(
		Effect.map((release) =>
			release
				? () =>
						tryPromise(release).pipe(
							Effect.asVoid,
							Effect.catchAll(() => Effect.void),
						)
				: undefined,
		),
	);
}

export const __test__ = { automaticLegacyLockAgeMs, leaseStaleMs };
