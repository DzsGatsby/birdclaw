// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import NativeSqliteDatabase, { SQLITE_BUSY_TIMEOUT_MS } from "./sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { resetBirdclawPathsForTests } from "./config";
import { getNativeDb, getReadDb, resetDatabaseForTests } from "./db";

const tempDirs: string[] = [];

async function waitForOutput(child: ChildProcess, expected: string) {
	await new Promise<void>((resolve, reject) => {
		let output = "";
		const onData = (chunk: Buffer) => {
			output += chunk.toString();
			if (output.includes(expected)) {
				cleanup();
				resolve();
			}
		};
		const onExit = (code: number | null) => {
			cleanup();
			reject(new Error(`lock holder exited before ready (${code})`));
		};
		const cleanup = () => {
			child.stdout?.off("data", onData);
			child.off("exit", onExit);
		};
		child.stdout?.on("data", onData);
		child.on("exit", onExit);
	});
}

async function stopChild(child: ChildProcess) {
	if (child.exitCode !== null) return;
	await new Promise<void>((resolve) => {
		child.once("exit", () => resolve());
		child.kill();
	});
}

function spawnWriteLockHolder(dbPath: string, holdMs: number) {
	return spawn(
		process.execPath,
		[
			"-e",
			`
        const { DatabaseSync } = require("node:sqlite");
        const db = new DatabaseSync(process.argv[1], { timeout: 1000 });
        db.exec("pragma journal_mode = wal; begin immediate");
        db.prepare(
          "insert or replace into sync_cache (cache_key, value_json, updated_at) values ('test:lock', '{}', '2026-06-15T00:00:00.000Z')"
        ).run();
        process.stdout.write("locked\\n");
        setTimeout(() => {
          db.exec("commit");
          db.close();
        }, Number(process.argv[2]));
      `,
			dbPath,
			String(holdMs),
		],
		{ stdio: ["ignore", "pipe", "inherit"] },
	);
}

afterEach(() => {
	resetDatabaseForTests();
	resetBirdclawPathsForTests();
	delete process.env.BIRDCLAW_HOME;

	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("database init", () => {
	it("keeps the schema at v23 with digest coverage and existing features", () => {
		const tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-db-"));
		tempDirs.push(tempDir);
		process.env.BIRDCLAW_HOME = tempDir;

		const db = getNativeDb({ seedDemoData: false });
		const columns = db
			.prepare("pragma table_info(timeline_read_positions)")
			.all() as Array<{ name: string }>;
		expect(columns.map((column) => column.name)).toEqual([
			"account_id",
			"view_key",
			"anchor_tweet_id",
			"anchor_created_at",
			"pixel_offset",
			"client_session_id",
			"client_sequence",
			"revision",
			"updated_at",
		]);
		expect(
			db
				.prepare("pragma table_info(twitter6551_events)")
				.all()
				.map((column) => (column as { name: string }).name),
		).toEqual([
			"event_id",
			"event_type",
			"watch_user",
			"tweet_id",
			"raw_json",
			"received_at",
			"processed_at",
			"error",
		]);
		expect(
			db
				.prepare(
					`select count(*) as count from sqlite_master
					 where type = 'table'
					 and name in ('twitter6551_recovery_state', 'twitter6551_paid_daily_usage')`,
				)
				.get(),
		).toEqual({ count: 0 });
		expect(
			db
				.prepare("pragma table_info(birdclaw_profile_notes)")
				.all()
				.map((column) => (column as { name: string }).name),
		).toEqual([
			"note_key",
			"identifier",
			"additional_name",
			"remark",
			"description",
			"updated_at",
			"tags_json",
			"category_name",
			"sync_revision",
			"base_json",
		]);
		expect(
			db.prepare("select * from xremark_outbound_state where id = 1").get(),
		).toEqual({ id: 1, next_revision: 0, last_acked_revision: 0 });
		expect(
			db
				.prepare(
					`select name from sqlite_master
					 where type = 'table' and name in ('feed_items', 'feed_sync_state')
					 order by name`,
				)
				.all(),
		).toEqual([{ name: "feed_items" }, { name: "feed_sync_state" }]);
		expect(db.pragma("user_version", { simple: true })).toBe(23);
		expect(
			db
				.prepare("pragma table_info(period_digest_history)")
				.all()
				.map((column) => (column as { name: string }).name),
		).toContain("coverage_json");
	});

	it.each([17, 18])(
		"queues v%s BirdClaw notes without crossing a recycled X handle",
		(legacyVersion) => {
			const tempDir = mkdtempSync(
				path.join(os.tmpdir(), "birdclaw-db-xremark-"),
			);
			tempDirs.push(tempDir);
			process.env.BIRDCLAW_HOME = tempDir;

			const initial = getNativeDb({ seedDemoData: false });
			initial
				.prepare(
					`insert into xremark_profile_notes (
			 identifier, additional_name, given_name, remark, description,
			 tags_json, category_name, source_updated_at, imported_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					"43",
					"recycled",
					"New Owner",
					"Wrong account baseline",
					"",
					"[]",
					null,
					100,
					"2026-08-01T00:00:00.000Z",
					"99",
					"ada",
					"Ada",
					"Imported A",
					"Imported description",
					JSON.stringify(["分析师"]),
					null,
					100,
					"2026-08-01T00:00:00.000Z",
				);
			initial.exec(`
			drop table birdclaw_profile_notes;
			drop table xremark_outbound_state;
			create table birdclaw_profile_notes (
				note_key text primary key,
				identifier text,
				additional_name text not null,
				remark text not null default '',
				description text,
				updated_at text not null
			);
			insert into birdclaw_profile_notes values (
				'id:42', '42', 'recycled', 'Local 42', null,
				'2026-08-01T00:00:00.000Z'
			);
			insert into birdclaw_profile_notes values (
				'handle:ada', null, 'ada', 'Local Ada', null,
				'2026-08-01T00:01:00.000Z'
			);
		`);
			initial.pragma(`user_version = ${String(legacyVersion)}`);
			resetDatabaseForTests();

			const db = getNativeDb({ seedDemoData: false });
			const rows = db
				.prepare(
					`select note_key, identifier, sync_revision, base_json
				 from birdclaw_profile_notes order by sync_revision`,
				)
				.all() as Array<Record<string, unknown>>;
			expect(rows).toEqual([
				expect.objectContaining({
					note_key: "id:42",
					identifier: "42",
					sync_revision: 1,
					base_json: JSON.stringify([{ exists: false }]),
				}),
				expect.objectContaining({
					note_key: "handle:ada",
					identifier: "99",
					sync_revision: 2,
					base_json: expect.stringContaining("Imported A"),
				}),
			]);
			expect(
				db.prepare("select next_revision from xremark_outbound_state").get(),
			).toEqual({ next_revision: 2 });
			expect(db.pragma("user_version", { simple: true })).toBe(23);
		},
	);

	it("migrates the independent profile-priority table with a false default", () => {
		const tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-db-"));
		tempDirs.push(tempDir);
		process.env.BIRDCLAW_HOME = tempDir;

		const db = getNativeDb({ seedDemoData: false });
		const columns = db
			.prepare("pragma table_info(birdclaw_profile_priorities)")
			.all() as Array<{ name: string; dflt_value: string | null }>;
		expect(columns.map((column) => column.name)).toEqual([
			"priority_key",
			"identifier",
			"additional_name",
			"is_special_follow",
			"updated_at",
		]);
		expect(
			columns.find((column) => column.name === "is_special_follow")?.dflt_value,
		).toBe("0");
		db.prepare(
			`insert into birdclaw_profile_priorities (
			 priority_key, additional_name, updated_at
			) values (?, ?, ?)`,
		).run("handle:ada", "ada", "2026-08-01T00:00:00.000Z");
		expect(
			db
				.prepare(
					"select is_special_follow from birdclaw_profile_priorities where priority_key = 'handle:ada'",
				)
				.get(),
		).toEqual({ is_special_follow: 0 });
	});

	it("migrates a v19 database to editorial feed storage without losing data", () => {
		const tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-db-feed-"));
		tempDirs.push(tempDir);
		process.env.BIRDCLAW_HOME = tempDir;
		resetBirdclawPathsForTests();

		const previous = getNativeDb({ seedDemoData: false });
		previous.exec(`
			create table migration_sentinel (value text not null);
			insert into migration_sentinel (value) values ('keep-me');
			drop table feed_sync_state;
			drop table feed_items;
			alter table period_digest_history drop column twitter_scope;
			alter table period_digest_history drop column feed_json;
			alter table period_digest_history drop column include_feed;
			alter table weekly_digest_history drop column twitter_scope;
			alter table weekly_digest_history drop column feed_json;
			alter table weekly_digest_history drop column include_feed;
			pragma user_version = 19;
		`);
		resetDatabaseForTests();

		const db = getNativeDb({ seedDemoData: false });
		expect(db.prepare("select value from migration_sentinel").get()).toEqual({
			value: "keep-me",
		});
		expect(
			db
				.prepare(
					`select name from sqlite_master
					 where type = 'table' and name in ('feed_items', 'feed_sync_state')
					 order by name`,
				)
				.all(),
		).toEqual([{ name: "feed_items" }, { name: "feed_sync_state" }]);
		for (const table of ["period_digest_history", "weekly_digest_history"]) {
			const columns = db.prepare(`pragma table_info(${table})`).all() as Array<{
				name: string;
			}>;
			expect(columns.map((column) => column.name)).toEqual(
				expect.arrayContaining(["include_feed", "feed_json", "twitter_scope"]),
			);
		}
		expect(
			db.prepare("select * from xremark_outbound_state where id = 1").get(),
		).toEqual({ id: 1, next_revision: 0, last_acked_revision: 0 });
		expect(db.pragma("user_version", { simple: true })).toBe(23);
	});

	it("seeds demo data after an initial unseeded open", () => {
		const tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-db-"));
		tempDirs.push(tempDir);
		process.env.BIRDCLAW_HOME = tempDir;

		const unseededDb = getNativeDb({ seedDemoData: false });
		expect(
			unseededDb.prepare("select count(*) as count from accounts").get(),
		).toEqual({ count: 0 });

		const seededDb = getNativeDb();

		expect(
			seededDb.prepare("select count(*) as count from accounts").get(),
		).toEqual({ count: 2 });
		expect(
			seededDb
				.prepare(
					"select count(*) as count from link_occurrences where source_kind = 'tweet'",
				)
				.get(),
		).toEqual({ count: 3 });
	});

	it("migrates legacy tweet tables before creating quoted tweet indexes", () => {
		const tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-db-"));
		tempDirs.push(tempDir);
		process.env.BIRDCLAW_HOME = tempDir;

		const legacyDb = new NativeSqliteDatabase(
			path.join(tempDir, "birdclaw.sqlite"),
		);
		legacyDb.exec(`
      create table tweets (
        id text primary key,
        account_id text not null,
        author_profile_id text not null,
        kind text not null,
        text text not null,
        created_at text not null,
        is_replied integer not null default 0,
        reply_to_id text,
        like_count integer not null default 0,
        media_count integer not null default 0,
        bookmarked integer not null default 0,
        liked integer not null default 0
      );
			insert into tweets (
				id, account_id, author_profile_id, kind, text, created_at,
				bookmarked, liked
			) values (
				'legacy_saved_home', 'legacy_account', 'legacy_author', 'home',
				'legacy tweet', '2026-01-01T00:00:00.000Z', 1, 1
			), (
				'legacy_authored', 'legacy_account', 'legacy_author', 'authored',
				'legacy authored tweet', '2026-01-02T00:00:00.000Z', 0, 0
			), (
				'legacy_search', 'legacy_account', 'legacy_author', 'search',
				'legacy search tweet', '2026-01-03T00:00:00.000Z', 0, 0
			);
    `);
		legacyDb.close();

		const db = getNativeDb();
		const columnNames = db.prepare("pragma table_info(tweets)").all() as Array<{
			name: string;
		}>;

		expect(columnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"entities_json",
				"media_json",
				"quoted_tweet_id",
			]),
		);
		expect(columnNames.map((column) => column.name)).not.toEqual(
			expect.arrayContaining(["account_id", "kind", "bookmarked", "liked"]),
		);
		expect(
			db
				.prepare(
					"select account_id, tweet_id, kind from tweet_account_edges where tweet_id = ?",
				)
				.get("legacy_saved_home"),
		).toEqual({
			account_id: "legacy_account",
			tweet_id: "legacy_saved_home",
			kind: "home",
		});
		expect(
			db
				.prepare(
					"select tweet_id, kind from tweet_account_edges where tweet_id in ('legacy_authored', 'legacy_search') order by tweet_id",
				)
				.all(),
		).toEqual([
			{ tweet_id: "legacy_authored", kind: "authored" },
			{ tweet_id: "legacy_search", kind: "search" },
		]);
		expect(
			db
				.prepare(
					"select kind from tweet_collections where tweet_id = ? order by kind",
				)
				.all("legacy_saved_home"),
		).toEqual([{ kind: "bookmarks" }, { kind: "likes" }]);

		const profileColumnNames = db
			.prepare("pragma table_info(profiles)")
			.all() as Array<{
			name: string;
		}>;
		expect(profileColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"following_count",
				"avatar_url",
				"public_metrics_json",
			]),
		);

		const quotedIndex = db
			.prepare("pragma index_info(idx_tweets_quoted)")
			.all() as Array<{
			name: string;
		}>;
		expect(quotedIndex).toEqual([
			expect.objectContaining({ name: "quoted_tweet_id" }),
		]);

		const syncCacheColumnNames = db
			.prepare("pragma table_info(sync_cache)")
			.all() as Array<{
			name: string;
		}>;
		expect(syncCacheColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining(["cache_key", "value_json", "updated_at"]),
		);

		const followEdgeColumnNames = db
			.prepare("pragma table_info(follow_edges)")
			.all() as Array<{
			name: string;
		}>;
		expect(followEdgeColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"account_id",
				"direction",
				"profile_id",
				"external_user_id",
				"current",
				"first_seen_at",
				"last_seen_at",
				"ended_at",
			]),
		);

		const followSnapshotColumnNames = db
			.prepare("pragma table_info(follow_snapshots)")
			.all() as Array<{
			name: string;
		}>;
		expect(followSnapshotColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining(["id", "direction", "status", "result_count"]),
		);

		const geocodeColumnNames = db
			.prepare("pragma table_info(geocoded_locations)")
			.all() as Array<{
			name: string;
		}>;
		expect(geocodeColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining(["normalized_key", "lat", "lng", "provider"]),
		);

		const collectionColumnNames = db
			.prepare("pragma table_info(tweet_collections)")
			.all() as Array<{
			name: string;
		}>;
		expect(collectionColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"account_id",
				"tweet_id",
				"kind",
				"collected_at",
				"source",
				"raw_json",
				"updated_at",
			]),
		);

		const localBookmarkColumnNames = db
			.prepare("pragma table_info(local_tweet_bookmarks)")
			.all() as Array<{ name: string }>;
		expect(localBookmarkColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"account_id",
				"tweet_id",
				"is_bookmarked",
				"created_at",
				"updated_at",
			]),
		);

		const timelineEdgeColumnNames = db
			.prepare("pragma table_info(tweet_account_edges)")
			.all() as Array<{
			name: string;
		}>;
		expect(timelineEdgeColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"account_id",
				"tweet_id",
				"kind",
				"first_seen_at",
				"last_seen_at",
				"seen_count",
				"source",
				"raw_json",
				"updated_at",
			]),
		);

		const identityIndexColumnNames = db
			.prepare("pragma table_info(identity_search_index)")
			.all() as Array<{
			name: string;
		}>;
		expect(identityIndexColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"profile_id",
				"kind",
				"value",
				"normalized_value",
				"source",
				"weight",
				"updated_at",
			]),
		);

		const accountColumnNames = db
			.prepare("pragma table_info(accounts)")
			.all() as Array<{
			name: string;
		}>;
		expect(accountColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining(["external_user_id"]),
		);

		const urlExpansionColumnNames = db
			.prepare("pragma table_info(url_expansions)")
			.all() as Array<{
			name: string;
		}>;
		expect(urlExpansionColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining(["image_url", "site_name"]),
		);

		const muteColumnNames = db
			.prepare("pragma table_info(mutes)")
			.all() as Array<{
			name: string;
		}>;
		expect(muteColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"account_id",
				"profile_id",
				"source",
				"created_at",
			]),
		);

		const xRemarkColumnNames = db
			.prepare("pragma table_info(xremark_profile_notes)")
			.all() as Array<{ name: string }>;
		expect(xRemarkColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"identifier",
				"additional_name",
				"remark",
				"description",
				"tags_json",
				"category_name",
			]),
		);
		const xRemarkLiveColumnNames = db
			.prepare("pragma table_info(xremark_live_sync)")
			.all() as Array<{ name: string }>;
		expect(xRemarkLiveColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"token_hash",
				"source_id",
				"last_sequence",
				"last_captured_at",
				"last_snapshot_at",
				"last_seen_at",
			]),
		);
		const profileNoteColumnNames = db
			.prepare("pragma table_info(birdclaw_profile_notes)")
			.all() as Array<{ name: string }>;
		expect(profileNoteColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"note_key",
				"identifier",
				"additional_name",
				"remark",
				"description",
				"updated_at",
			]),
		);

		const busyTimeout = db.pragma("busy_timeout", {
			simple: true,
		}) as number;
		expect(busyTimeout).toBe(SQLITE_BUSY_TIMEOUT_MS);
		expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
		const discussionHistoryColumnNames = db
			.prepare("pragma table_info(discussion_history)")
			.all() as Array<{ name: string }>;
		expect(discussionHistoryColumnNames.map((column) => column.name)).toEqual(
			expect.arrayContaining([
				"id",
				"root_id",
				"cache_key",
				"range",
				"context_hash",
				"discussion_json",
				"tweets_json",
				"dms_json",
				"deleted_at",
			]),
		);
		expect(
			db
				.prepare("pragma table_info(twitter6551_events)")
				.all()
				.map((column) => (column as { name: string }).name),
		).toEqual(
			expect.arrayContaining([
				"event_id",
				"event_type",
				"raw_json",
				"processed_at",
				"error",
			]),
		);
		expect(
			db
				.prepare("pragma table_info(weekly_digest_history)")
				.all()
				.map((column) => (column as { name: string }).name),
		).toContain("format_version");
		expect(db.pragma("user_version", { simple: true })).toBe(23);
	});

	it("normalizes legacy tweet timestamps during startup migration", () => {
		const tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-db-date-"));
		tempDirs.push(tempDir);
		process.env.BIRDCLAW_HOME = tempDir;
		resetBirdclawPathsForTests();

		const dbPath = path.join(tempDir, "birdclaw.sqlite");
		const legacy = new NativeSqliteDatabase(dbPath);
		legacy.exec(`
      create table tweets (
        id text primary key,
        created_at text not null
      );
      insert into tweets (id, created_at)
      values ('tweet_legacy_date', 'Tue Jun 23 06:06:01 +0000 2026');
      pragma user_version = 2;
    `);
		legacy.close();

		const db = getNativeDb({ seedDemoData: false });

		expect(
			db
				.prepare("select created_at from tweets where id = ?")
				.get("tweet_legacy_date"),
		).toEqual({ created_at: "2026-06-23T06:06:01.000Z" });
		expect(db.pragma("user_version", { simple: true })).toBe(23);
	});

	it("migrates v12 profile notes without overriding imported descriptions", () => {
		const tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-db-note-"));
		tempDirs.push(tempDir);
		process.env.BIRDCLAW_HOME = tempDir;
		resetBirdclawPathsForTests();

		const dbPath = path.join(tempDir, "birdclaw.sqlite");
		const legacy = new NativeSqliteDatabase(dbPath);
		legacy.exec(`
      create table birdclaw_profile_notes (
        note_key text primary key,
        identifier text,
        additional_name text not null,
        remark text not null default '',
        updated_at text not null
      );
      insert into birdclaw_profile_notes (
        note_key, identifier, additional_name, remark, updated_at
      ) values (
        'id:42', '42', 'ada', 'Legacy local remark',
        '2026-08-07T00:00:00.000Z'
      );
      pragma user_version = 12;
    `);
		legacy.close();

		const db = getNativeDb({ seedDemoData: false });
		expect(
			db
				.prepare(
					"select remark, description from birdclaw_profile_notes where note_key = 'id:42'",
				)
				.get(),
		).toEqual({ remark: "Legacy local remark", description: null });
		expect(db.pragma("user_version", { simple: true })).toBe(23);
	});

	it("migrates a v22 production database to daily coverage storage", () => {
		const tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-db-v22-"));
		tempDirs.push(tempDir);
		process.env.BIRDCLAW_HOME = tempDir;
		resetBirdclawPathsForTests();

		const initial = getNativeDb({ seedDemoData: false });
		initial.exec(`
			alter table period_digest_history drop column coverage_json;
			pragma user_version = 22;
		`);
		resetDatabaseForTests();

		const migrated = getNativeDb({ seedDemoData: false });
		expect(migrated.pragma("user_version", { simple: true })).toBe(23);
		expect(
			migrated
				.prepare("pragma table_info(period_digest_history)")
				.all()
				.map((column) => (column as { name: string }).name),
		).toContain("coverage_json");
	});

	it("does not request a write lock for completed startup backfills", async () => {
		const tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-db-lock-"));
		tempDirs.push(tempDir);
		process.env.BIRDCLAW_HOME = tempDir;

		getNativeDb();
		resetDatabaseForTests();

		const dbPath = path.join(tempDir, "birdclaw.sqlite");
		const holder = spawnWriteLockHolder(dbPath, 1500);
		await waitForOutput(holder, "locked");

		const startedAt = Date.now();
		try {
			const reopened = getNativeDb({ seedDemoData: false });
			expect(Date.now() - startedAt).toBeLessThan(900);
			expect(reopened.pragma("foreign_keys", { simple: true })).toBe(1);
			expect(reopened.pragma("busy_timeout", { simple: true })).toBe(
				SQLITE_BUSY_TIMEOUT_MS,
			);
		} finally {
			await stopChild(holder);
		}
	});

	it("uses independent query-only connections for reads", () => {
		const tempDir = mkdtempSync(path.join(os.tmpdir(), "birdclaw-db-read-"));
		tempDirs.push(tempDir);
		process.env.BIRDCLAW_HOME = tempDir;

		const writer = getNativeDb({ seedDemoData: false });
		writer.exec("create table read_probe (value text)");
		writer.prepare("insert into read_probe (value) values ('committed')").run();
		const reader = getReadDb({ seedDemoData: false });

		writer.exec("begin immediate");
		try {
			writer.prepare("insert into read_probe (value) values ('pending')").run();
			expect(
				reader.prepare("select value from read_probe order by value").all(),
			).toEqual([{ value: "committed" }]);
			expect(() =>
				reader
					.prepare("insert into read_probe (value) values ('blocked')")
					.run(),
			).toThrow(/read.?only|write/i);
		} finally {
			writer.exec("rollback");
		}
	});
});

describe("native sqlite compatibility wrapper", () => {
	it("installs a busy timeout as soon as the database opens", () => {
		const db = new NativeSqliteDatabase(":memory:");

		try {
			expect(db.pragma("busy_timeout", { simple: true })).toBe(
				SQLITE_BUSY_TIMEOUT_MS,
			);
		} finally {
			db.close();
		}
	});

	it("waits for the writer slot before a transaction reads and writes", async () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "birdclaw-sqlite-lock-"),
		);
		tempDirs.push(tempDir);
		const dbPath = path.join(tempDir, "database.sqlite");
		const setupDb = new NativeSqliteDatabase(dbPath);
		setupDb.exec(`
      pragma journal_mode = wal;
      create table sync_cache (
        cache_key text primary key,
        value_json text not null,
        updated_at text not null
      );
      create table events (name text);
    `);
		setupDb.close();

		const holder = spawnWriteLockHolder(dbPath, 500);
		await waitForOutput(holder, "locked");
		const contender = new NativeSqliteDatabase(dbPath, { timeout: 2000 });
		const startedAt = Date.now();

		try {
			contender.transaction(() => {
				contender.prepare("select count(*) from events").get();
				contender.prepare("insert into events (name) values (?)").run("waited");
			})();
			expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
			expect(contender.prepare("select name from events").all()).toEqual([
				{ name: "waited" },
			]);
		} finally {
			contender.close();
			await stopChild(holder);
		}
	});

	it("normalizes rows, buffers, parameter arrays, and close behavior", () => {
		const db = new NativeSqliteDatabase(":memory:");
		db.exec(
			"create table files (id integer primary key, name text, data blob)",
		);

		const insert = db.prepare("insert into files (name, data) values (?, ?)");
		const result = insert.run(["readme", Buffer.from("hello")]);
		expect(result).toMatchObject({ changes: 1, lastInsertRowid: 1 });

		const row = db
			.prepare("select id, name, data from files where name = ?")
			.get("readme") as { id: number; name: string; data: Buffer };
		expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
		expect(row.data).toBeInstanceOf(Buffer);
		expect(row.data.toString("utf8")).toBe("hello");

		const rows = [
			...db.prepare("select name from files where id in (?)").iterate(1),
		] as Array<{ name: string }>;
		expect(rows).toEqual([{ name: "readme" }]);
		expect(db.pragma("application_id")).toEqual([
			expect.objectContaining({ application_id: 0 }),
		]);
		expect(db.pragma("does_not_exist", { simple: true })).toBeUndefined();

		db.close();
		expect(() => db.close()).not.toThrow();
	});

	it("commits, rolls back, and nests transactions with savepoints", () => {
		const db = new NativeSqliteDatabase(":memory:");
		db.exec("create table events (name text)");

		db.transaction((name: string) => {
			db.prepare("insert into events (name) values (?)").run(name);
		})("committed");

		expect(() =>
			db.transaction(() => {
				db.prepare("insert into events (name) values (?)").run("rolled-back");
				throw new Error("nope");
			})(),
		).toThrow("nope");

		expect(() =>
			db.transaction(() => {
				db.prepare("insert into events (name) values (?)").run("outer");
				db.transaction(() => {
					db.prepare("insert into events (name) values (?)").run("inner");
					throw new Error("inner nope");
				})();
			})(),
		).toThrow("inner nope");

		const names = db
			.prepare("select name from events order by name")
			.all() as Array<{ name: string }>;
		expect(names).toEqual([{ name: "committed" }]);
		db.close();
	});
});
