import assert from "node:assert/strict";
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
	ensurePreMigrationBackup,
	requiredBackupBytes,
	resolveBirdclawRoot,
} from "../bin/migration-backup.mjs";

function fixture(version = 22) {
	const rootDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-migration-"));
	const databasePath = path.join(rootDir, "birdclaw.sqlite");
	const db = new DatabaseSync(databasePath);
	db.exec(`
		pragma user_version = ${String(version)};
		create table evidence (id text primary key, value text not null);
		insert into evidence values ('one', 'preserved');
	`);
	db.close();
	return { rootDir, databasePath };
}

test("creates and validates a private v22 backup before the v23 migration", async () => {
	const { rootDir } = fixture();
	try {
		const result = await ensurePreMigrationBackup({ rootDir, log: () => {} });
		assert.equal(result.created, true);
		const backupPath = path.join(rootDir, "backups", "pre-v23-birdclaw.sqlite");
		assert.equal(statSync(backupPath).mode & 0o777, 0o600);
		const backupDb = new DatabaseSync(backupPath, { readOnly: true });
		assert.equal(
			backupDb.prepare("select value from evidence where id = 'one'").get()
				.value,
			"preserved",
		);
		assert.equal(
			backupDb.prepare("pragma user_version").get().user_version,
			22,
		);
		backupDb.close();
		assert.equal(
			(await ensurePreMigrationBackup({ rootDir, log: () => {} })).reason,
			"existing",
		);
	} finally {
		rmSync(rootDir, { recursive: true, force: true });
	}
});

test("does not create a migration backup for an already-current v23 database", async () => {
	const { rootDir, databasePath } = fixture(23);
	try {
		const before = readFileSync(databasePath);
		const result = await ensurePreMigrationBackup({ rootDir, log: () => {} });
		assert.deepEqual(result, {
			created: false,
			reason: "current",
			currentVersion: 23,
		});
		assert.deepEqual(readFileSync(databasePath), before);
		assert.equal(existsSync(path.join(rootDir, "backups")), false);
	} finally {
		rmSync(rootDir, { recursive: true, force: true });
	}
});

test("uses the real home directory default instead of the current directory", () => {
	assert.equal(
		resolveBirdclawRoot(undefined, {}, "/Users/example"),
		path.join("/Users/example", ".birdclaw"),
	);
	assert.equal(
		resolveBirdclawRoot(
			undefined,
			{ BIRDCLAW_HOME: "/data" },
			"/Users/example",
		),
		"/data",
	);
});

test("budgets database, WAL, and restore headroom before backup", () => {
	assert.equal(requiredBackupBytes(100, 50), 32 * 1024 * 1024 + 150);
});

test("removes an invalid stale partial before creating the verified backup", async () => {
	const { rootDir } = fixture();
	try {
		const backupDir = path.join(rootDir, "backups");
		const stalePath = path.join(
			backupDir,
			"pre-v23-birdclaw.sqlite.partial-99999",
		);
		mkdirSync(backupDir, { recursive: true });
		writeFileSync(stalePath, "incomplete");

		const result = await ensurePreMigrationBackup({ rootDir, log: () => {} });
		assert.equal(result.created, true);
		assert.equal(existsSync(stalePath), false);
		assert.equal(
			existsSync(path.join(backupDir, "pre-v23-birdclaw.sqlite")),
			true,
		);
	} finally {
		rmSync(rootDir, { recursive: true, force: true });
	}
});

test("promotes a complete stale partial without taking a second backup", async () => {
	const { rootDir, databasePath } = fixture();
	try {
		const backupDir = path.join(rootDir, "backups");
		const partialPath = path.join(
			backupDir,
			"pre-v23-birdclaw.sqlite.partial-99999",
		);
		mkdirSync(backupDir, { recursive: true });
		copyFileSync(databasePath, partialPath);

		const result = await ensurePreMigrationBackup({ rootDir, log: () => {} });
		assert.equal(result.reason, "recovered");
		assert.equal(existsSync(partialPath), false);
		assert.equal(existsSync(result.backupPath), true);
	} finally {
		rmSync(rootDir, { recursive: true, force: true });
	}
});

test("promotes one complete partial and removes additional owned partials", async () => {
	const { rootDir, databasePath } = fixture();
	try {
		const backupDir = path.join(rootDir, "backups");
		const first = path.join(backupDir, "pre-v23-birdclaw.sqlite.partial-1000");
		const second = path.join(backupDir, "pre-v23-birdclaw.sqlite.partial-2000");
		mkdirSync(backupDir, { recursive: true });
		copyFileSync(databasePath, first);
		copyFileSync(databasePath, second);

		const result = await ensurePreMigrationBackup({ rootDir, log: () => {} });

		assert.equal(result.reason, "recovered");
		assert.equal(existsSync(first), false);
		assert.equal(existsSync(second), false);
		assert.equal(existsSync(result.backupPath), true);
	} finally {
		rmSync(rootDir, { recursive: true, force: true });
	}
});
