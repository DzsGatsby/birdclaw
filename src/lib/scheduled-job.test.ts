// @vitest-environment node
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	__test__,
	acquireScheduledJobLock,
	appendScheduledJobAudit,
	migrateLegacyScheduledJobLock,
	startScheduledJobRun,
} from "./scheduled-job";

const tempDirs: string[] = [];

function makeTempDir() {
	const directory = mkdtempSync(
		path.join(os.tmpdir(), "birdclaw-job-runtime-"),
	);
	tempDirs.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of tempDirs.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("scheduled job runtime", () => {
	it("appends JSONL audit entries with run metadata", async () => {
		const logPath = path.join(makeTempDir(), "audit", "job.jsonl");
		const run = startScheduledJobRun(Date.now() - 10);
		const entry = { job: "test", ok: true, ...run.finish() };

		await appendScheduledJobAudit(logPath, entry);

		expect(JSON.parse(readFileSync(logPath, "utf8"))).toMatchObject({
			job: "test",
			ok: true,
			host: os.hostname(),
			pid: process.pid,
		});
		expect(entry.durationMs).toBeGreaterThanOrEqual(10);
	});

	it("allows only one active lease and replaces abandoned leases", async () => {
		const lockPath = path.join(makeTempDir(), "locks", "job.lock");
		const contenders = await Promise.all(
			Array.from({ length: 8 }, () => acquireScheduledJobLock(lockPath, 2_000)),
		);
		const releases = contenders.filter(
			(value): value is NonNullable<typeof value> => Boolean(value),
		);

		expect(releases).toHaveLength(1);
		expect(existsSync(lockPath)).toBe(true);
		await releases[0]?.();
		expect(existsSync(lockPath)).toBe(false);

		mkdirSync(lockPath);
		const old = new Date(Date.now() - 3_000);
		utimesSync(lockPath, old, old);
		const staleRelease = await acquireScheduledJobLock(lockPath, 2_000);

		expect(staleRelease).toBeTypeOf("function");
		await staleRelease?.();
	});

	it("renews long-running leases instead of letting a successor take over", async () => {
		const lockPath = path.join(makeTempDir(), "locks", "job.lock");
		const release = await acquireScheduledJobLock(lockPath, 2_000);
		await new Promise((resolve) => setTimeout(resolve, 2_300));

		const successor = await acquireScheduledJobLock(lockPath, 2_000);

		expect(release).toBeTypeOf("function");
		expect(successor).toBeUndefined();
		await release?.();
	});

	it("leaves legacy and foreign-host regular-file locks untouched", async () => {
		const lockPath = path.join(makeTempDir(), "locks", "job.lock");
		mkdirSync(path.dirname(lockPath), { recursive: true });
		writeFileSync(
			lockPath,
			`${JSON.stringify({ pid: 2_147_483_647, host: "another-host" })}\n`,
			"utf8",
		);
		const old = new Date(Date.now() - 60_000);
		utimesSync(lockPath, old, old);

		await expect(
			acquireScheduledJobLock(lockPath, 2_000),
		).resolves.toBeUndefined();
		expect(readFileSync(lockPath, "utf8")).toContain("another-host");
	});

	it("archives an ancient legacy regular-file lock before acquiring", async () => {
		const lockDirectory = path.join(makeTempDir(), "locks");
		const lockPath = path.join(lockDirectory, "job.lock");
		mkdirSync(lockDirectory, { recursive: true });
		writeFileSync(lockPath, "abandoned legacy lock\n", "utf8");
		const old = new Date(Date.now() - 3 * 60 * 60_000);
		utimesSync(lockPath, old, old);

		const release = await acquireScheduledJobLock(lockPath, 2_000);

		expect(release).toBeTypeOf("function");
		const archived = readdirSync(lockDirectory).filter((name) =>
			name.startsWith("job.lock.legacy-"),
		);
		expect(archived).toHaveLength(1);
		expect(readFileSync(path.join(lockDirectory, archived[0]!), "utf8")).toBe(
			"abandoned legacy lock\n",
		);
		await release?.();
	});

	it("migrates a legacy lock only after an operator confirms the service drained", async () => {
		const lockPath = path.join(makeTempDir(), "locks", "job.lock");
		mkdirSync(path.dirname(lockPath), { recursive: true });
		writeFileSync(lockPath, "legacy\n", "utf8");

		await expect(migrateLegacyScheduledJobLock(lockPath)).resolves.toEqual({
			status: "legacy",
			migrated: false,
		});
		expect(existsSync(lockPath)).toBe(true);

		const migrated = await migrateLegacyScheduledJobLock(lockPath, true);
		expect(migrated).toMatchObject({ status: "legacy", migrated: true });
		expect(existsSync(lockPath)).toBe(false);
		expect(migrated.archivedPath).toBeTruthy();
		expect(readFileSync(migrated.archivedPath!, "utf8")).toBe("legacy\n");

		const release = await acquireScheduledJobLock(lockPath, 2_000);
		expect(release).toBeTypeOf("function");
		await release?.();
	});

	it("caps crash recovery without shortening explicit test leases", () => {
		expect(__test__.leaseStaleMs(1_000)).toBe(2_000);
		expect(__test__.leaseStaleMs(10_000)).toBe(10_000);
		expect(__test__.leaseStaleMs(2 * 60 * 60_000)).toBe(30_000);
		expect(__test__.automaticLegacyLockAgeMs(2_000)).toBe(2 * 60 * 60_000);
	});
});
