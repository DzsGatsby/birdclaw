import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	statfsSync,
	statSync,
	unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

// This is the latest schema version that must have a verified pre-migration
// backup before the server opens the writable database. Keep it aligned with
// src/lib/db.ts even when the migration is unrelated to Twillot.
export const REQUIRED_BACKUP_SCHEMA_VERSION = 23;
const BACKUP_SPACE_MARGIN_BYTES = 32 * 1024 * 1024;

export function resolveBirdclawRoot(
	rootDir,
	env = process.env,
	homeDir = os.homedir(),
) {
	return path.resolve(
		rootDir || env.BIRDCLAW_HOME?.trim() || path.join(homeDir, ".birdclaw"),
	);
}

function readSchemaVersion(databasePath) {
	const db = new DatabaseSync(databasePath, { readOnly: true });
	try {
		return Number(db.prepare("pragma user_version").get()?.user_version ?? 0);
	} finally {
		db.close();
	}
}

function validateBackup(databasePath, expectedVersion) {
	const db = new DatabaseSync(databasePath, { readOnly: true });
	try {
		const integrity = db.prepare("pragma integrity_check").get();
		if (integrity?.integrity_check !== "ok") {
			throw new Error("SQLite integrity_check did not return ok");
		}
		const version = Number(
			db.prepare("pragma user_version").get()?.user_version ?? 0,
		);
		if (version !== expectedVersion) {
			throw new Error(
				`SQLite backup schema mismatch: expected ${String(expectedVersion)}, got ${String(version)}`,
			);
		}
	} finally {
		db.close();
	}
}

export function requiredBackupBytes(databaseBytes, walBytes = 0) {
	return databaseBytes + walBytes + BACKUP_SPACE_MARGIN_BYTES;
}

function assertBackupCapacity(rootDir, databasePath) {
	const databaseBytes = statSync(databasePath).size;
	const walPath = `${databasePath}-wal`;
	const walBytes = existsSync(walPath) ? statSync(walPath).size : 0;
	const filesystem = statfsSync(rootDir);
	const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
	const requiredBytes = requiredBackupBytes(databaseBytes, walBytes);
	if (!Number.isFinite(availableBytes) || availableBytes < requiredBytes) {
		throw new Error(
			`Not enough free space for the required SQLite migration backup: need ${String(requiredBytes)} bytes, have ${String(availableBytes)} bytes`,
		);
	}
}

function recoverPartialBackup(backupDir, backupPath, expectedVersion) {
	const prefix = `${path.basename(backupPath)}.partial-`;
	let recovered = false;
	for (const entry of readdirSync(backupDir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
		const candidate = path.join(backupDir, entry.name);
		if (recovered) {
			unlinkSync(candidate);
			continue;
		}
		try {
			validateBackup(candidate, expectedVersion);
			chmodSync(candidate, 0o600);
			renameSync(candidate, backupPath);
			recovered = true;
		} catch {
			unlinkSync(candidate);
		}
	}
	return recovered;
}

export async function ensurePreMigrationBackup({
	rootDir,
	targetVersion = REQUIRED_BACKUP_SCHEMA_VERSION,
	log = console.error,
} = {}) {
	const resolvedRoot = resolveBirdclawRoot(rootDir);
	const databasePath = path.join(resolvedRoot, "birdclaw.sqlite");
	if (!existsSync(databasePath)) return { created: false, reason: "missing" };

	const currentVersion = readSchemaVersion(databasePath);
	if (currentVersion >= targetVersion) {
		return { created: false, reason: "current", currentVersion };
	}

	const backupDir = path.join(resolvedRoot, "backups");
	const backupPath = path.join(
		backupDir,
		`pre-v${String(targetVersion)}-birdclaw.sqlite`,
	);
	if (existsSync(backupPath)) {
		validateBackup(backupPath, currentVersion);
		return {
			created: false,
			reason: "existing",
			currentVersion,
			backupPath,
		};
	}

	mkdirSync(backupDir, { recursive: true, mode: 0o700 });
	if (recoverPartialBackup(backupDir, backupPath, currentVersion)) {
		return {
			created: false,
			reason: "recovered",
			currentVersion,
			backupPath,
		};
	}
	assertBackupCapacity(resolvedRoot, databasePath);
	const partialPath = `${backupPath}.partial-${String(process.pid)}`;
	const source = new DatabaseSync(databasePath, { readOnly: true });
	try {
		await backup(source, partialPath);
	} catch (error) {
		if (existsSync(partialPath)) unlinkSync(partialPath);
		throw error;
	} finally {
		source.close();
	}

	try {
		chmodSync(partialPath, 0o600);
		validateBackup(partialPath, currentVersion);
		renameSync(partialPath, backupPath);
	} catch (error) {
		if (existsSync(partialPath)) unlinkSync(partialPath);
		throw error;
	}
	log(
		`birdclaw: verified pre-migration backup at ${path.relative(resolvedRoot, backupPath)}`,
	);
	return { created: true, currentVersion, backupPath };
}
