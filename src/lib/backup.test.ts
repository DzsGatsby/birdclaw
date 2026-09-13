// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
	insertTestAccount,
	insertTestProfile,
	insertTestTweet,
	useTestHome,
} from "../test/test-home";
import {
	exportBackup,
	exportBackupEffect,
	getBackupDatabaseFingerprint,
	importBackup,
	importBackupEffect,
	maybeAutoSyncBackup,
	maybeAutoUpdateBackup,
	syncBackup,
	updateBackupFromGitEffect,
	validateBackup,
	validateBackupEffect,
} from "./backup";
import { resetBirdclawPathsForTests } from "./config";
import { getNativeDb } from "./db";
import {
	acknowledgeXRemarkChanges,
	saveBirdclawProfileRemark,
} from "./xremark";

const testHome = useTestHome({ prefix: "birdclaw-backup-home-" });

function makeTempDir(prefix: string) {
	return testHome().makeTempDir(prefix);
}

function ensureEditorialBackupTestSchema() {
	const db = getNativeDb({ seedDemoData: false });
	db.exec(`
		create table if not exists feed_items (
			id text primary key,
			source text not null,
			external_id text not null,
			kind text not null check (kind in ('flash', 'article')),
			title text not null,
			summary text not null default '',
			url text not null,
			publisher text not null,
			published_at text not null,
			market text not null default '',
			language text not null default 'zh-CN',
			symbols_json text not null default '[]',
			image_url text,
			is_important integer not null default 0 check (is_important in (0, 1)),
			content_hash text not null,
			first_seen_at text not null,
			updated_at text not null,
			unique (source, kind, external_id)
		);
		create table if not exists feed_sync_state (
			source text not null,
			kind text not null check (kind in ('flash', 'article')),
			status text not null check (status in ('idle', 'syncing', 'ready', 'error')),
			last_started_at text,
			last_success_at text,
			last_item_at text,
			last_error text,
			updated_at text not null,
			primary key (source, kind)
		);
	`);
	for (const [table, column, definition] of [
		["period_digest_history", "include_feed", "integer not null default 0"],
		["period_digest_history", "feed_json", "text not null default '[]'"],
		["period_digest_history", "twitter_scope", "text not null default 'all'"],
		["weekly_digest_history", "include_feed", "integer not null default 0"],
		["weekly_digest_history", "feed_json", "text not null default '[]'"],
		["weekly_digest_history", "twitter_scope", "text not null default 'all'"],
	] as const) {
		const columns = db.prepare(`pragma table_info(${table})`).all() as Array<{
			name: string;
		}>;
		if (!columns.some((item) => item.name === column)) {
			db.exec(`alter table ${table} add column ${column} ${definition}`);
		}
	}
}

function switchHome(prefix: string) {
	const root = testHome().switchHome(prefix).root;
	ensureEditorialBackupTestSchema();
	return root;
}

function clearData() {
	const db = getNativeDb();
	db.exec(`
	delete from feed_sync_state;
	delete from feed_items;
	delete from tweet_quality_score_requests;
	delete from tweet_quality_scores;
	delete from twillot_history_batches;
	delete from twillot_history_daily_usage;
	delete from twillot_history_jobs;
	delete from birdclaw_list_members;
	delete from birdclaw_lists;
	delete from birdclaw_profile_priorities;
	delete from birdclaw_profile_notes;
	delete from weekly_digest_history;
	delete from period_digest_history;
    delete from discussion_history;
    delete from follow_events;
    delete from follow_edges;
    delete from follow_snapshot_members;
    delete from follow_snapshots;
    delete from ai_scores;
    delete from tweet_actions;
    delete from tweet_account_edges;
    delete from tweet_collections;
    delete from link_occurrences;
    delete from url_expansions;
    delete from blocks;
    delete from mutes;
    delete from dm_fts;
    delete from tweets_fts;
    delete from dm_messages;
    delete from dm_conversations;
    delete from tweets;
    delete from profile_bio_entities;
    delete from profile_snapshots;
    delete from profile_affiliations;
    delete from profiles;
    delete from accounts;
    delete from sync_cache;
	`);
}

function writeBackupConfig(
	home: string,
	backup: {
		repoPath?: string;
		remote?: string;
		autoSync?: boolean;
		staleAfterSeconds?: number;
	},
) {
	writeFileSync(path.join(home, "config.json"), JSON.stringify({ backup }));
	resetBirdclawPathsForTests();
}

function seedBackupFixture() {
	const db = getNativeDb();
	clearData();
	db.exec(`
    insert into accounts (
      id, name, handle, external_user_id, transport, is_default, created_at
    ) values (
      'acct_primary', 'Peter Steinberger', '@steipete', '25401953', 'archive', 1, '2009-03-19T22:54:05.000Z'
    );

    insert into profiles (
      id, handle, display_name, bio, followers_count, following_count,
      public_metrics_json, avatar_hue, avatar_url, location, url,
      verified_type, entities_json, raw_json, created_at
    ) values
      ('profile_me', 'steipete', 'Peter Steinberger', 'Local-first builder', 1000, 75, '{"followers_count":1000,"following_count":75,"listed_count":42}', 42, 'https://img.example/me.jpg', 'Vienna', 'https://steipete.me', 'blue', '{"url":{"urls":[{"url":"https://t.co/me","expanded_url":"https://steipete.me"}]}}', '{"id":"profile_me"}', '2009-03-19T22:54:05.000Z'),
      ('profile_friend', 'friend', 'Friend', 'Sends useful DMs', 50, 25, '{"followers_count":50,"following_count":25,"listed_count":3}', 210, null, null, 'https://friend.example', null, '{}', '{}', '2025-01-01T00:00:00.000Z');

    insert into profile_affiliations (
      subject_profile_id, organization_profile_id, organization_name,
      organization_handle, badge_url, url, label, source, is_active,
      first_seen_at, last_seen_at, raw_json, updated_at
    ) values (
      'profile_friend', 'profile_org_blacksmith', 'Blacksmith', 'blacksmith',
      'https://cdn.example/badge.png', 'https://www.blacksmith.sh', 'Blacksmith',
      'fixture', 1, '2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z',
      '{"label":"Blacksmith"}', '2025-01-02T00:00:00.000Z'
    );

    insert into profile_snapshots (
      profile_id, snapshot_hash, observed_at, last_seen_at, source, handle,
      display_name, bio, location, url, verified_type, followers_count,
      following_count, affiliations_json, raw_json
    ) values (
      'profile_friend', 'snapshot_blacksmith', '2025-01-01T00:00:00.000Z',
      '2025-01-02T00:00:00.000Z', 'fixture', 'friend', 'Friend',
      'Sends useful DMs', null, 'https://friend.example', null, 50, 0,
      '[{"organizationName":"Blacksmith"}]', '{}'
    );

    insert into profile_bio_entities (
      profile_id, kind, value, source, is_active, first_seen_at, last_seen_at,
      raw_json
    ) values
      ('profile_friend', 'domain', 'friend.example', 'profile_url', 1,
        '2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z', '{}'),
      ('profile_friend', 'company_phrase', 'Blacksmith', 'affiliation', 1,
        '2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z', '{}');

    insert into tweets (
      id, author_profile_id, text, created_at, is_replied,
      reply_to_id, like_count, media_count, entities_json,
      media_json, quoted_tweet_id
    ) values
      ('tweet_2024', 'profile_me', 'Shipping text backups https://t.co/shared', '2024-12-31T23:59:00.000Z', 0, null, 12, 0, '{"hashtags":[{"text":"backup"}],"urls":[{"url":"https://t.co/shared","expandedUrl":"https://example.com/demo","displayUrl":"example.com/demo","start":22,"end":41}]}', '[]', null),
      ('tweet_2025', 'profile_friend', 'Saved useful thing', '2025-01-02T08:00:00.000Z', 0, null, 5, 1, '{}', '[{"type":"photo"}]', 'tweet_quote'),
      ('tweet_unknown_date', 'profile_friend', 'Unknown creation date like', '1970-01-01T00:00:00.000Z', 0, null, 1, 0, '{}', '[]', null);

    insert into tweet_collections (
      account_id, tweet_id, kind, collected_at, source, raw_json, updated_at
    ) values
      ('acct_primary', 'tweet_2025', 'bookmarks', '2025-01-02T09:00:00.000Z', 'archive', '{"bookmark":{"tweetId":"tweet_2025"}}', '2025-01-03T00:00:00.000Z'),
      ('acct_primary', 'tweet_2025', 'likes', null, 'bird', '{"id":"tweet_2025"}', '2025-01-03T00:00:00.000Z'),
      ('acct_primary', 'tweet_unknown_date', 'likes', null, 'archive', '{"like":{"tweetId":"tweet_unknown_date"}}', '2025-01-03T00:00:00.000Z');

    insert into tweet_account_edges (
      account_id, tweet_id, kind, first_seen_at, last_seen_at, seen_count, source,
      raw_json, updated_at
    ) values
      ('acct_primary', 'tweet_2024', 'home', '2024-12-31T23:59:00.000Z', '2024-12-31T23:59:00.000Z', 1, 'archive', '{}', '2025-01-03T00:00:00.000Z'),
      ('acct_primary', 'tweet_2025', 'search', '2025-01-02T09:00:00.000Z', '2025-01-02T09:00:00.000Z', 1, 'bird', '{"query":"useful"}', '2025-01-03T00:00:00.000Z');

    insert into tweets_fts (tweet_id, text) values
      ('tweet_2024', 'Shipping text backups'),
      ('tweet_2025', 'Saved useful thing'),
      ('tweet_unknown_date', 'Unknown creation date like');

    insert into dm_conversations (
      id, account_id, participant_profile_id, title, inbox_kind, last_message_at, unread_count, needs_reply
    ) values (
      'dm:friend', 'acct_primary', 'profile_friend', 'Friend', 'request', '2025-01-05T10:00:00.000Z', 0, 1
    );

    insert into dm_messages (
      id, conversation_id, sender_profile_id, text, created_at, direction, is_replied, media_count
    ) values
      ('dm_1', 'dm:friend', 'profile_friend', 'Backup this please', '2025-01-05T09:00:00.000Z', 'inbound', 0, 0),
      ('dm_2', 'dm:friend', 'profile_me', 'On it', '2025-01-05T10:00:00.000Z', 'outbound', 1, 0);

    insert into dm_fts (message_id, text) values
      ('dm_1', 'Backup this please'),
      ('dm_2', 'On it');

    insert into url_expansions (
      short_url, expanded_url, final_url, status, expanded_tweet_id,
      expanded_handle, title, description, error, source, updated_at
    ) values (
      'https://t.co/shared', 'https://x.com/friend/status/2039395915421942108',
      'https://x.com/friend/status/2039395915421942108', 'hit',
      '2039395915421942108', 'friend', 'Shared tweet', 'An expanded DM share',
      null, 'network', '2025-01-05T10:01:00.000Z'
    );

    insert into link_occurrences (
      source_kind, source_id, source_position, short_url, account_id,
      conversation_id, direction, created_at
    ) values (
      'dm', 'dm_2', 0, 'https://t.co/shared', 'acct_primary', 'dm:friend',
      'outbound', '2025-01-05T10:00:00.000Z'
    );

    insert into blocks (account_id, profile_id, source, created_at)
    values ('acct_primary', 'profile_friend', 'manual', '2025-01-06T00:00:00.000Z');

    insert into mutes (account_id, profile_id, source, created_at)
    values ('acct_primary', 'profile_friend', 'manual', '2025-01-07T00:00:00.000Z');

    insert into tweet_actions (id, account_id, tweet_id, kind, body, created_at)
    values ('action_1', 'acct_primary', 'tweet_2025', 'reply', 'Thanks', '2025-01-08T00:00:00.000Z');

    insert into ai_scores (
      entity_kind, entity_id, model, score, summary, reasoning, updated_at
    ) values (
      'tweet', 'tweet_2025', 'test-model', 88, 'useful', 'has context', '2025-01-09T00:00:00.000Z'
    );

	    insert into birdclaw_profile_notes (
	      note_key, identifier, additional_name, remark, description,
	      tags_json, category_name, updated_at
	    ) values (
	      'id:42', '42', 'friend',
	      'Met at a local-first meetup', 'Maintains the local archive',
	      '["分析师"]', '市场观察',
	      '2025-01-09T00:30:00.000Z'
	    );

	insert into birdclaw_profile_priorities (
	  priority_key, identifier, additional_name, is_special_follow, updated_at
	) values (
	  'id:profile_friend', 'profile_friend', 'friend', 1,
	  '2025-01-09T00:45:00.000Z'
	);

	insert into birdclaw_lists (
	  id, account_id, name, description, created_at, updated_at, deleted_at
	) values (
	  'list-facts', 'acct_primary', '事实源', '公司与媒体',
	  '2025-01-09T00:46:00.000Z', '2025-01-09T00:47:00.000Z', null
	);

	insert into birdclaw_list_members (
	  list_id, member_key, identifier, additional_name, is_member, added_at, updated_at
	) values
	  ('list-facts', 'id:profile_friend', 'profile_friend', 'friend', 1,
	   '2025-01-09T00:48:00.000Z', '2025-01-09T00:48:00.000Z'),
	  ('list-facts', 'handle:removed', null, 'removed', 0,
	   '2025-01-09T00:49:00.000Z', '2025-01-09T00:50:00.000Z');

	insert into feed_items (
	  id, source, external_id, kind, title, summary, url, publisher,
	  published_at, market, language, symbols_json, image_url, is_important,
	  content_hash, first_seen_at, updated_at
	) values
	  ('tiger:flash:flash-1', 'tiger', 'flash-1', 'flash',
	   'Important market flash', 'A verified editorial flash item.',
	   'https://example.com/flash-1', 'Tiger News',
	   '2025-01-08T08:00:00.000Z', 'US', 'zh-CN', '["AAPL"]', null, 1,
	   'feed-hash-flash-1', '2025-01-08T08:01:00.000Z', '2025-01-08T08:01:00.000Z'),
	  ('tiger:article:article-1', 'tiger', 'article-1', 'article',
	   'Editorial market article', 'A concise article summary.',
	   'https://example.com/article-1', 'Tiger News',
	   '2025-01-09T08:00:00.000Z', 'US', 'zh-CN', '["NVDA"]',
	   'https://example.com/article-1.jpg', 0, 'feed-hash-article-1',
	   '2025-01-09T08:01:00.000Z', '2025-01-09T08:01:00.000Z');

	insert into feed_sync_state (
	  source, kind, status, last_started_at, last_success_at, last_item_at,
	  last_error, updated_at
	) values (
	  'tiger', 'flash', 'ready', '2025-01-09T08:01:00.000Z',
	  '2025-01-09T08:01:00.000Z', '2025-01-08T08:00:00.000Z', null,
	  '2025-01-09T08:01:00.000Z'
	);

    insert into discussion_history (
      id, root_id, parent_id, cache_key, title, summary, query, question,
      account, source, mode, range, since, until, include_dms,
      originals_only, hide_low_quality, model, reasoning_effort,
      service_tier, context_hash, counts_json, discussion_json, markdown,
      tweets_json, dms_json, live_search_json, created_at, updated_at,
      pinned_at, deleted_at
    ) values (
      'discussion_1', 'discussion_1', null, 'search-discussion:test',
      'Backup discussion', 'A durable saved discussion', 'backup', null,
      'acct_primary', 'all', 'local', 'all', null, null, 1, 0, 0,
      'gpt-5.5', 'medium', 'priority', 'history_hash',
      '{"search":0,"home":1,"mentions":0,"authored":0,"likes":0,"bookmarks":0,"dms":1}',
      '{"title":"Backup discussion","summary":"A durable saved discussion","themes":[],"tensions":[],"followUps":[],"sourceTweetIds":["tweet_2025"],"sourceDmConversationIds":["dm:friend"]}',
      '# Backup discussion',
      '[{"id":"tweet_2025","text":"Saved useful thing"}]',
      '[{"id":"dm:friend","text":"Backup this please"}]', null,
      '2025-01-09T01:00:00.000Z', '2025-01-09T01:00:00.000Z', null, null
    );

    insert into period_digest_history (
      id, digest_date, timezone, status, attempt_count, window_since,
	  window_until, include_dms, include_feed, twitter_scope, provider, model, reasoning_effort,
      service_tier, context_hash, counts_json, digest_json, markdown,
	  tweets_json, dms_json, links_json, feed_json, started_at, finished_at,
      created_at, updated_at
    ) values (
      'daily_2025_01_08', '2025-01-08', 'UTC', 'ready', 1,
	  '2025-01-08T00:00:00.000Z', '2025-01-09T00:00:00.000Z', 0, 1, 'home',
      'openai', 'gpt-5.5', 'medium', 'priority', 'daily_hash',
	  '{"home":1,"mentions":0,"authored":0,"likes":0,"bookmarks":0,"dms":0,"links":0,"feed":1}',
      '{"title":"Daily backup","summary":"Saved daily report","keyTopics":[],"notableLinks":[],"people":[],"actionItems":[],"sourceTweetIds":[]}',
	  '# Daily backup', '[]', '[]', '[]',
	  '[{"id":"tiger:flash:flash-1","title":"Important market flash"}]',
      '2025-01-09T00:00:00.000Z', '2025-01-09T00:01:00.000Z',
      '2025-01-09T00:00:00.000Z', '2025-01-09T00:01:00.000Z'
    );

    insert into weekly_digest_history (
      id, week_start, week_end, timezone, status, attempt_count, window_since,
	  window_until, include_dms, include_feed, twitter_scope, provider, model, reasoning_effort,
      service_tier, context_hash, counts_json, digest_json, markdown,
	  tweets_json, dms_json, links_json, feed_json, started_at, finished_at,
      created_at, updated_at
    ) values (
      'weekly_2025_01_06', '2025-01-06', '2025-01-12', 'UTC', 'ready', 1,
	  '2025-01-06T00:00:00.000Z', '2025-01-13T00:00:00.000Z', 0, 1, 'home',
      'openai', 'gpt-5.5', 'high', 'priority', 'weekly_hash',
	  '{"home":1,"mentions":0,"authored":0,"likes":0,"bookmarks":0,"dms":0,"links":0,"feed":1}',
      '{"title":"Weekly backup","summary":"Saved weekly report","keyTopics":[],"notableLinks":[],"people":[],"actionItems":[],"sourceTweetIds":[]}',
	  '# Weekly backup', '[]', '[]', '[]',
	  '[{"id":"tiger:article:article-1","title":"Editorial market article"}]',
      '2025-01-13T00:00:00.000Z', '2025-01-13T00:01:00.000Z',
      '2025-01-13T00:00:00.000Z', '2025-01-13T00:01:00.000Z'
    );

    insert into follow_snapshots (
      id, account_id, direction, source, status, page_count, result_count,
      started_at, completed_at, raw_meta_json
    ) values (
      'follow_snapshot_1', 'acct_primary', 'followers', 'xurl', 'complete',
      1, 1, '2025-01-10T00:00:00.000Z', '2025-01-10T00:00:01.000Z',
      '{"result_count":1}'
    );

    insert into follow_snapshot_members (
      snapshot_id, profile_id, external_user_id, position
    ) values (
      'follow_snapshot_1', 'profile_friend', 'external_friend', 0
    );

    insert into follow_edges (
      account_id, direction, profile_id, external_user_id, source, current,
      first_seen_at, last_seen_at, ended_at, updated_at
    ) values (
      'acct_primary', 'followers', 'profile_friend', 'external_friend', 'xurl',
      1, '2025-01-10T00:00:01.000Z', '2025-01-10T00:00:01.000Z', null,
      '2025-01-10T00:00:01.000Z'
    );

    insert into follow_events (
      id, account_id, direction, profile_id, external_user_id, kind, event_at,
      snapshot_id
    ) values (
      'follow_event_1', 'acct_primary', 'followers', 'profile_friend',
      'external_friend', 'started', '2025-01-10T00:00:01.000Z',
      'follow_snapshot_1'
    );

    insert into twillot_history_jobs (
      id, account_id, profile_id, provider, external_user_id, handle, state,
      capture_status, cursor_json, next_run_at, lease_token, lease_expires_at,
      lease_usage_day, lease_allowance, attempt_count, downloaded_count,
      imported_count, last_error, created_at, updated_at, completed_at
    ) values (
      'twillot_job_1', 'acct_primary', 'profile_friend', 'twillot',
      'external_friend', 'friend', 'completed', 'caught_up_unverified',
      '{"tweetId":"tweet_2025"}', '2025-01-10T00:00:02.000Z', null, null,
      null, 0, 1, 2, 2, null, '2025-01-10T00:00:01.000Z',
      '2025-01-10T00:00:02.000Z', '2025-01-10T00:00:02.000Z'
    );

    insert into twillot_history_batches (
      provider, batch_id, job_id, lease_token, usage_day, downloaded_count,
      imported_count, cursor_json, done, resulting_state, next_run_at, created_at
    ) values (
      'twillot', 'twillot_batch_1', 'twillot_job_1', 'expired-lease',
      '2025-01-10', 2, 2, '{"tweetId":"tweet_2025"}', 1, 'completed',
      null, '2025-01-10T00:00:02.000Z'
    );

    insert into twillot_history_daily_usage (
      provider, usage_day, downloaded_count, updated_at
    ) values (
      'twillot', '2025-01-10', 2, '2025-01-10T00:00:02.000Z'
    );
  `);
}

function expectNoDemoSeedRows() {
	const db = getNativeDb({ seedDemoData: false });
	expect(
		db
			.prepare(
				"select count(*) as count from accounts where id = 'acct_studio'",
			)
			.get(),
	).toEqual({ count: 0 });
	expect(
		db
			.prepare("select count(*) as count from tweets where id like 'tweet_00%'")
			.get(),
	).toEqual({ count: 0 });
	expect(
		db
			.prepare(
				"select count(*) as count from dm_conversations where id glob 'dm_00*'",
			)
			.get(),
	).toEqual({ count: 0 });
}

describe("text backup", () => {
	it("builds backup Git update effects lazily", async () => {
		switchHome("birdclaw-backup-lazy-home-");
		const repoPath = path.join(
			makeTempDir("birdclaw-backup-lazy-parent-"),
			"repo",
		);

		const effect = updateBackupFromGitEffect({ repoPath });

		expect(existsSync(repoPath)).toBe(false);
		await expect(Effect.runPromise(effect)).resolves.toMatchObject({
			ok: true,
			repoPath,
			pulled: false,
			imported: false,
		});
		expect(existsSync(path.join(repoPath, ".git"))).toBe(true);
	}, 20000);

	it("exposes backup export, import, and validation as Effects", async () => {
		switchHome("birdclaw-backup-effect-src-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-backup-effect-store-");

		const exported = await Effect.runPromise(exportBackupEffect({ repoPath }));
		const validation = await Effect.runPromise(validateBackupEffect(repoPath));

		switchHome("birdclaw-backup-effect-dst-");
		const imported = await Effect.runPromise(
			importBackupEffect({ repoPath, mode: "replace" }),
		);

		expect(exported.validation.ok).toBe(true);
		expect(validation.ok).toBe(true);
		expect(imported.ok).toBe(true);
		expect(imported.mode).toBe("replace");
	}, 20000);

	it("rejects backup export paths that traverse symlinked managed directories", async () => {
		switchHome("birdclaw-backup-symlink-src-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-backup-symlink-store-");
		const targetPath = makeTempDir("birdclaw-backup-symlink-target-");
		symlinkSync(targetPath, path.join(repoPath, "data"), "dir");

		await expect(
			Effect.runPromise(exportBackupEffect({ repoPath })),
		).rejects.toThrow("Backup path contains symlink");
		expect(existsSync(path.join(targetPath, "tweets"))).toBe(false);
	}, 20000);

	it("rejects backup validation paths that traverse symlinked directories", async () => {
		const repoPath = makeTempDir("birdclaw-backup-read-symlink-store-");
		const targetPath = makeTempDir("birdclaw-backup-read-symlink-target-");
		mkdirSync(path.join(targetPath, "tweets"), { recursive: true });
		writeFileSync(path.join(targetPath, "tweets", "2026.jsonl"), "{}\n");
		symlinkSync(targetPath, path.join(repoPath, "data"), "dir");
		writeFileSync(
			path.join(repoPath, "manifest.json"),
			JSON.stringify({
				app: "birdclaw",
				schemaVersion: 1,
				generatedAt: "2026-05-17T00:00:00.000Z",
				counts: {},
				files: [
					{
						path: "data/tweets/2026.jsonl",
						rows: 1,
						sha256: "bad",
						bytes: 3,
					},
				],
				backupHash: "bad",
			}) + "\n",
		);

		const validation = await Effect.runPromise(validateBackupEffect(repoPath));

		expect(validation.ok).toBe(false);
		expect(validation.errors.join("\n")).toContain(
			"Backup path contains symlink",
		);
	});

	it("builds backup import effects lazily", async () => {
		switchHome("birdclaw-backup-import-src-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-backup-import-store-");

		const effect = importBackupEffect({ repoPath, mode: "replace" });

		expect(existsSync(path.join(repoPath, "manifest.json"))).toBe(false);
		await exportBackup({ repoPath });

		switchHome("birdclaw-backup-import-dst-");
		const imported = await Effect.runPromise(effect);

		expect(imported.ok).toBe(true);
		expect(imported.mode).toBe("replace");
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare("select count(*) as count from tweets where id = 'tweet_2025'")
				.get(),
		).toEqual({ count: 1 });
	}, 20000);

	it("exports JSONL shards and imports them without changing the portable fingerprint", async () => {
		switchHome("birdclaw-backup-src-");
		seedBackupFixture();
		const collectionRawJson = JSON.stringify({
			id: "tweet_2025",
			text: "line\u2028separator\u2029done",
		});
		getNativeDb()
			.prepare(
				`
        update tweet_collections
        set raw_json = ?
        where account_id = 'acct_primary'
          and tweet_id = 'tweet_2025'
          and kind = 'likes'
        `,
			)
			.run(collectionRawJson);
		const before = getBackupDatabaseFingerprint();
		const repoPath = makeTempDir("birdclaw-store-");

		const exported = await exportBackup({ repoPath });

		expect(exported.validation.ok).toBe(true);
		expect(exported.manifest.counts).toMatchObject({
			accounts: 1,
			profiles: 2,
			profile_affiliations: 1,
			profile_snapshots: 1,
			profile_bio_entities: 2,
			tweets: 3,
			timeline_edges_home: 1,
			timeline_edges_search: 1,
			collections_bookmarks: 1,
			collections_likes: 2,
			dm_conversations: 1,
			dm_messages: 2,
			url_expansions: 1,
			link_occurrences: 1,
			blocks: 1,
			mutes: 1,
			tweet_actions: 1,
			ai_scores: 1,
			birdclaw_profile_notes: 1,
			birdclaw_profile_priorities: 1,
			birdclaw_lists: 1,
			birdclaw_list_members: 2,
			discussion_history: 1,
			feed_items: 2,
			period_digest_history: 1,
			weekly_digest_history: 1,
			follow_snapshots: 1,
			follow_snapshot_members: 1,
			follow_edges: 1,
			follow_events: 1,
			twillot_history_jobs: 1,
			twillot_history_batches: 1,
			twillot_history_daily_usage: 1,
		});
		expect(existsSync(path.join(repoPath, "data/tweets/2024.jsonl"))).toBe(
			true,
		);
		expect(existsSync(path.join(repoPath, "data/tweets/2025.jsonl"))).toBe(
			true,
		);
		expect(existsSync(path.join(repoPath, "data/tweets/unknown.jsonl"))).toBe(
			true,
		);
		expect(existsSync(path.join(repoPath, "data/dms/2025.jsonl"))).toBe(true);
		expect(
			existsSync(path.join(repoPath, "data/links/url_expansions.jsonl")),
		).toBe(true);
		expect(
			existsSync(path.join(repoPath, "data/links/occurrences.jsonl")),
		).toBe(true);
		expect(
			existsSync(path.join(repoPath, "data/twillot/history-jobs.jsonl")),
		).toBe(true);
		expect(
			readFileSync(
				path.join(repoPath, "data/collections/bookmarks.jsonl"),
				"utf8",
			),
		).toContain('"kind":"bookmarks"');
		const likesJsonl = readFileSync(
			path.join(repoPath, "data/collections/likes.jsonl"),
			"utf8",
		);
		expect(likesJsonl).not.toContain("\u2028");
		expect(likesJsonl).not.toContain("\u2029");
		expect(likesJsonl).toContain("\\u2028");
		expect(likesJsonl).toContain("\\u2029");
		expect(
			readFileSync(
				path.join(repoPath, "data/timeline_edges/search.jsonl"),
				"utf8",
			),
		).toContain('"kind":"search"');
		expect(
			readFileSync(
				path.join(repoPath, "data/links/url_expansions.jsonl"),
				"utf8",
			),
		).toContain('"expanded_tweet_id":"2039395915421942108"');
		expect(
			readFileSync(path.join(repoPath, "data/profiles.jsonl"), "utf8"),
		).toContain('"public_metrics_json"');
		expect(
			readFileSync(path.join(repoPath, "data/dms/conversations.jsonl"), "utf8"),
		).toContain('"inbox_kind":"request"');
		expect(existsSync(path.join(repoPath, "data/follow_snapshots.jsonl"))).toBe(
			true,
		);
		expect(existsSync(path.join(repoPath, "data/follow_edges.jsonl"))).toBe(
			true,
		);
		expect(
			existsSync(path.join(repoPath, "data/discussions/history.jsonl")),
		).toBe(true);
		expect(existsSync(path.join(repoPath, "data/profile-lists.jsonl"))).toBe(
			true,
		);
		expect(
			existsSync(path.join(repoPath, "data/profile-list-members.jsonl")),
		).toBe(true);
		expect(existsSync(path.join(repoPath, "data/feed/items.jsonl"))).toBe(true);
		expect(
			existsSync(path.join(repoPath, "data/digests/weekly-history.jsonl")),
		).toBe(true);

		switchHome("birdclaw-backup-dst-");
		const staleDb = getNativeDb();
		staleDb.exec(`
	  insert into birdclaw_profile_notes (
	    note_key, identifier, additional_name, remark, updated_at
	  ) values (
	    'id:stale_profile', 'stale_profile', 'stale_handle', 'Stale note',
	    '2026-04-01T00:00:00.000Z'
	  );
	  insert into discussion_history (
	    id, root_id, cache_key, title, summary, query, source, mode, range,
	    model, reasoning_effort, service_tier, context_hash, counts_json,
	    discussion_json, markdown, created_at, updated_at
	  ) values (
	    'stale_discussion', 'stale_discussion', 'stale', 'Stale', 'Stale',
	    'stale', 'all', 'local', 'all', 'gpt-5.5', 'medium', 'priority',
	    'stale', '{}', '{}', 'stale', '2026-04-01T00:00:00.000Z',
	    '2026-04-01T00:00:00.000Z'
	  );
      insert into url_expansions (
        short_url, expanded_url, final_url, status, source, updated_at
      ) values (
        'https://t.co/stale', 'https://x.com/stale/status/1', 'https://x.com/stale/status/1', 'hit', 'network', '2026-04-01T00:00:00.000Z'
      );
      insert into link_occurrences (
        source_kind, source_id, source_position, short_url, created_at
      ) values (
        'dm', 'deleted-message', 0, 'https://t.co/stale', '2026-04-01T00:00:00.000Z'
      );
	  insert into feed_items (
		id, source, external_id, kind, title, summary, url, publisher,
		published_at, market, language, symbols_json, image_url, is_important,
		content_hash, first_seen_at, updated_at
	  ) values (
		'stale-feed', 'stale', 'stale-1', 'flash', 'Stale feed item', '',
		'https://example.com/stale', 'Stale', '2026-04-01T00:00:00.000Z',
		'', 'zh-CN', '[]', null, 1, 'stale-feed-hash',
		'2026-04-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'
	  );
	  insert into feed_sync_state (
		source, kind, status, last_error, updated_at
	  ) values (
		'stale', 'flash', 'error', 'stale runtime state',
		'2026-04-01T00:00:00.000Z'
	  );
    `);
		const imported = await importBackup({ repoPath, mode: "replace" });
		const after = getBackupDatabaseFingerprint();

		expect(imported.mode).toBe("replace");
		expect(imported.validation?.ok).toBe(true);
		expect(after).toEqual(before);
		expect(imported.fingerprint).toEqual(before);
		expect(
			staleDb
				.prepare(
					"select short_url, expanded_tweet_id from url_expansions order by short_url",
				)
				.all(),
		).toEqual([
			{
				short_url: "https://t.co/shared",
				expanded_tweet_id: "2039395915421942108",
			},
		]);
		expect(
			staleDb
				.prepare(
					"select source_kind, source_id, short_url from link_occurrences order by source_kind, source_id",
				)
				.all(),
		).toEqual([
			{
				source_kind: "dm",
				source_id: "dm_2",
				short_url: "https://t.co/shared",
			},
		]);
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					"select inbox_kind from dm_conversations where id = 'dm:friend'",
				)
				.get(),
		).toEqual({ inbox_kind: "request" });
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare("select entities_json from tweets where id = 'tweet_2024'")
				.get(),
		).toEqual({
			entities_json:
				'{"hashtags":[{"text":"backup"}],"urls":[{"url":"https://t.co/shared","expandedUrl":"https://example.com/demo","displayUrl":"example.com/demo","start":22,"end":41}]}',
		});
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					`
          select raw_json
          from tweet_collections
          where account_id = 'acct_primary'
            and tweet_id = 'tweet_2025'
            and kind = 'likes'
          `,
				)
				.get(),
		).toEqual({ raw_json: collectionRawJson });
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					"select kind, source from tweet_account_edges where tweet_id = 'tweet_2025' and kind = 'search'",
				)
				.get(),
		).toEqual({ kind: "search", source: "bird" });
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					"select public_metrics_json from profiles where id = 'profile_friend'",
				)
				.get(),
		).toEqual({
			public_metrics_json:
				'{"followers_count":50,"following_count":25,"listed_count":3}',
		});
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					"select count(*) as count from follow_events where id = 'follow_event_1'",
				)
				.get(),
		).toEqual({ count: 1 });
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					`select state, capture_status, downloaded_count, imported_count
					 from twillot_history_jobs where id = 'twillot_job_1'`,
				)
				.get(),
		).toEqual({
			state: "completed",
			capture_status: "caught_up_unverified",
			downloaded_count: 2,
			imported_count: 2,
		});
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare("select id, title from discussion_history order by id")
				.all(),
		).toEqual([{ id: "discussion_1", title: "Backup discussion" }]);
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					"select additional_name, remark, description, tags_json, category_name, sync_revision, base_json from birdclaw_profile_notes where note_key = 'id:42'",
				)
				.get(),
		).toEqual({
			additional_name: "friend",
			remark: "Met at a local-first meetup",
			description: "Maintains the local archive",
			tags_json: '["分析师"]',
			category_name: "市场观察",
			sync_revision: 1,
			base_json: JSON.stringify([{ exists: false }]),
		});
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare("select count(*) as count from birdclaw_profile_notes")
				.get(),
		).toEqual({ count: 1 });
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					"select identifier, additional_name, is_special_follow from birdclaw_profile_priorities where priority_key = 'id:profile_friend'",
				)
				.get(),
		).toEqual({
			identifier: "profile_friend",
			additional_name: "friend",
			is_special_follow: 1,
		});
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					`select list.name, list.description, member.member_key, member.is_member
					 from birdclaw_lists as list
					 join birdclaw_list_members as member on member.list_id = list.id
					 order by member.member_key`,
				)
				.all(),
		).toEqual([
			{
				name: "事实源",
				description: "公司与媒体",
				member_key: "handle:removed",
				is_member: 0,
			},
			{
				name: "事实源",
				description: "公司与媒体",
				member_key: "id:profile_friend",
				is_member: 1,
			},
		]);
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					"select digest_date, status, include_feed, twitter_scope, feed_json, markdown from period_digest_history",
				)
				.all(),
		).toEqual([
			{
				digest_date: "2025-01-08",
				status: "ready",
				include_feed: 1,
				twitter_scope: "home",
				feed_json:
					'[{"id":"tiger:flash:flash-1","title":"Important market flash"}]',
				markdown: "# Daily backup",
			},
		]);
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					"select week_start, week_end, status, include_feed, twitter_scope, feed_json, markdown from weekly_digest_history",
				)
				.all(),
		).toEqual([
			{
				week_start: "2025-01-06",
				week_end: "2025-01-12",
				status: "ready",
				include_feed: 1,
				twitter_scope: "home",
				feed_json:
					'[{"id":"tiger:article:article-1","title":"Editorial market article"}]',
				markdown: "# Weekly backup",
			},
		]);
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					"select id, kind, is_important from feed_items order by published_at, id",
				)
				.all(),
		).toEqual([
			{ id: "tiger:flash:flash-1", kind: "flash", is_important: 1 },
			{ id: "tiger:article:article-1", kind: "article", is_important: 0 },
		]);
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare("select count(*) as count from feed_sync_state")
				.get(),
		).toEqual({ count: 0 });

		const validation = await validateBackup(repoPath);
		expect(validation.ok).toBe(true);
	}, 20000);

	it("round-trips disabled special-follow tombstones", async () => {
		switchHome("birdclaw-backup-priority-src-");
		getNativeDb({ seedDemoData: false })
			.prepare(
				`insert into birdclaw_profile_priorities (
				 priority_key, identifier, additional_name, is_special_follow, updated_at
				) values (?, ?, ?, ?, ?)`,
			)
			.run("id:42", "42", "ada", 0, "2026-08-01T00:00:00.000Z");
		const repoPath = makeTempDir("birdclaw-backup-priority-repo-");
		await exportBackup({ repoPath });

		switchHome("birdclaw-backup-priority-dest-");
		await importBackup({ repoPath, mode: "replace" });
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					"select is_special_follow, updated_at from birdclaw_profile_priorities where priority_key = 'id:42'",
				)
				.get(),
		).toEqual({
			is_special_follow: 0,
			updated_at: "2026-08-01T00:00:00.000Z",
		});
	}, 20000);

	it("replace removes Twillot queue rows that are absent from the backup", async () => {
		switchHome("birdclaw-backup-empty-twillot-src-");
		const repoPath = makeTempDir("birdclaw-backup-empty-twillot-repo-");
		await exportBackup({ repoPath });

		switchHome("birdclaw-backup-stale-twillot-dest-");
		const db = getNativeDb({ seedDemoData: false });
		db.prepare(
			`insert into accounts (
			 id, name, handle, external_user_id, transport, is_default, created_at
			) values ('stale-account', 'Stale', 'stale', '1', 'xurl', 1, ?)`,
		).run("2026-08-10T00:00:00.000Z");
		db.prepare(
			`insert into twillot_history_jobs (
			 id, account_id, profile_id, provider, external_user_id, handle,
			 state, capture_status, next_run_at, created_at, updated_at
			) values (
			 'stale-job', 'stale-account', 'profile_user_2', 'twillot', '2',
			 'stale-target', 'queued', 'capture_requested', ?, ?, ?
			)`,
		).run(
			"2026-08-10T00:00:00.000Z",
			"2026-08-10T00:00:00.000Z",
			"2026-08-10T00:00:00.000Z",
		);
		db.prepare(
			`insert into twillot_history_batches (
			 provider, batch_id, job_id, lease_token, usage_day, downloaded_count,
			 imported_count, cursor_json, done, resulting_state, created_at
			) values ('twillot', 'stale-batch', 'stale-job', '', '2026-08-10',
			 1, 1, 'null', 1, 'completed', ?)`,
		).run("2026-08-10T00:00:00.000Z");
		db.prepare(
			`insert into twillot_history_daily_usage (
			 provider, usage_day, downloaded_count, updated_at
			) values ('twillot', '2026-08-10', 1, ?)`,
		).run("2026-08-10T00:00:00.000Z");

		await importBackup({ repoPath, mode: "replace" });
		expect(
			db.prepare("select count(*) as count from twillot_history_jobs").get(),
		).toEqual({ count: 0 });
		expect(
			db.prepare("select count(*) as count from twillot_history_batches").get(),
		).toEqual({ count: 0 });
		expect(
			db
				.prepare("select count(*) as count from twillot_history_daily_usage")
				.get(),
		).toEqual({ count: 0 });
	}, 20000);

	it("replace removes score cache and request fences absent from the backup", async () => {
		switchHome("birdclaw-backup-empty-score-src-");
		const repoPath = makeTempDir("birdclaw-backup-empty-score-repo-");
		await exportBackup({ repoPath });

		switchHome("birdclaw-backup-stale-score-dest-");
		const db = getNativeDb({ seedDemoData: false });
		db.prepare(
			`insert into tweet_quality_scores (
				tweet_id, provider, model, score, label, dimensions_json, sentiment,
				assets_json, reason, explanation, content_hash, updated_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			"stale-tweet",
			"openai",
			"stale-model",
			8,
			"高信息价值",
			JSON.stringify({
				informationDelta: 4,
				clearThesis: 2,
				explainedMechanism: 1,
				verifiability: 1,
				clearBoundaries: 0,
			}),
			"positive",
			JSON.stringify(["股票"]),
			"这是一条应当被替换导入删除的旧评分。",
			"这条旧解释也不应残留。",
			"stale-hash",
			"2026-08-10T00:00:00.000Z",
		);
		db.prepare(
			`insert into tweet_quality_score_requests (
				tweet_id, content_hash, generation, updated_at
			) values (?, ?, ?, ?)`,
		).run("stale-tweet", "stale-hash", 1, "2026-08-10T00:00:00.000Z");

		await importBackup({ repoPath, mode: "replace" });
		expect(
			db.prepare("select count(*) as count from tweet_quality_scores").get(),
		).toEqual({ count: 0 });
		expect(
			db
				.prepare("select count(*) as count from tweet_quality_score_requests")
				.get(),
		).toEqual({ count: 0 });
	}, 20000);

	it("round-trips tweet quality scores without backing up request fences", async () => {
		switchHome("birdclaw-backup-score-src-");
		const sourceDb = getNativeDb({ seedDemoData: false });
		sourceDb
			.prepare(
				`insert into tweet_quality_scores (
				tweet_id, provider, model, score, label, dimensions_json, sentiment,
				assets_json, reason, explanation, content_hash, updated_at
			) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"scored-tweet",
				"openai",
				"score-model",
				6,
				"中等信息价值",
				JSON.stringify({
					informationDelta: 3,
					clearThesis: 2,
					explainedMechanism: 1,
					verifiability: 0,
					clearBoundaries: 0,
				}),
				"mixed",
				JSON.stringify(["股票", "加密资产"]),
				"帖子提供了新信息，也给出了明确判断。",
				"这条帖子看好股票，同时对加密资产保持谨慎。",
				"score-hash",
				"2026-08-12T08:00:00.000Z",
			);
		sourceDb
			.prepare(
				`insert into tweet_quality_score_requests (
				tweet_id, content_hash, generation, updated_at
			) values (?, ?, ?, ?)`,
			)
			.run("scored-tweet", "score-hash", 4, "2026-08-12T08:00:00.000Z");
		const repoPath = makeTempDir("birdclaw-backup-score-repo-");
		await exportBackup({ repoPath });

		switchHome("birdclaw-backup-score-dest-");
		await importBackup({ repoPath, mode: "replace" });
		const destinationDb = getNativeDb({ seedDemoData: false });
		expect(
			destinationDb
				.prepare(
					"select score, label, reason, content_hash from tweet_quality_scores where tweet_id = ?",
				)
				.get("scored-tweet"),
		).toEqual({
			score: 6,
			label: "中等信息价值",
			reason: "帖子提供了新信息，也给出了明确判断。",
			content_hash: "score-hash",
		});
		expect(
			destinationDb
				.prepare("select count(*) as count from tweet_quality_score_requests")
				.get(),
		).toEqual({ count: 0 });
	}, 20000);

	it("does not restore an orphan Twillot batch receipt when job ids differ", async () => {
		switchHome("birdclaw-backup-twillot-source-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-backup-twillot-conflict-repo-");
		await exportBackup({ repoPath });

		switchHome("birdclaw-backup-twillot-destination-");
		seedBackupFixture();
		const db = getNativeDb({ seedDemoData: false });
		db.exec(`
			delete from twillot_history_batches;
			delete from twillot_history_jobs;
		`);
		db.prepare(
			`insert into twillot_history_jobs (
			 id, account_id, profile_id, provider, external_user_id, handle, state,
			 capture_status, next_run_at, created_at, updated_at
			) values (
			 'local-job-id', 'acct_primary', 'profile_friend', 'twillot',
			 'external_friend', 'friend', 'queued', 'capture_requested', ?, ?, ?
			)`,
		).run(
			"2026-08-10T00:00:00.000Z",
			"2026-08-10T00:00:00.000Z",
			"2026-08-10T00:00:00.000Z",
		);

		await importBackup({ repoPath, mode: "merge" });

		expect(
			db
				.prepare(
					`select id from twillot_history_jobs
					 where account_id = 'acct_primary' and profile_id = 'profile_friend'`,
				)
				.get(),
		).toEqual({ id: "local-job-id" });
		expect(
			db.prepare("select count(*) as count from twillot_history_batches").get(),
		).toEqual({ count: 0 });
	}, 20000);

	it("emits byte-identical schema-v12 data and still accepts schema v2", async () => {
		switchHome("birdclaw-backup-stable-src-");
		seedBackupFixture();
		const firstRepoPath = makeTempDir("birdclaw-backup-stable-first-");
		const secondRepoPath = makeTempDir("birdclaw-backup-stable-second-");

		const first = await exportBackup({ repoPath: firstRepoPath });
		const second = await exportBackup({ repoPath: secondRepoPath });

		expect(first.manifest.schemaVersion).toBe(12);
		expect(second.manifest.files).toEqual(first.manifest.files);
		expect(second.manifest.counts).toEqual(first.manifest.counts);
		expect(second.manifest.backupHash).toBe(first.manifest.backupHash);
		for (const file of first.manifest.files) {
			expect(readFileSync(path.join(secondRepoPath, file.path))).toEqual(
				readFileSync(path.join(firstRepoPath, file.path)),
			);
		}
		writeFileSync(
			path.join(secondRepoPath, "manifest.json"),
			JSON.stringify({ ...second.manifest, schemaVersion: 2 }, null, 2) + "\n",
		);
		expect((await validateBackup(secondRepoPath)).ok).toBe(true);
	}, 20000);

	it("imports daily history rows created before coverage metadata existed", async () => {
		switchHome("birdclaw-backup-legacy-coverage-src-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-backup-legacy-coverage-repo-");
		await exportBackup({ repoPath });

		const dailyPath = path.join(repoPath, "data/digests/daily-history.jsonl");
		const row = JSON.parse(readFileSync(dailyPath, "utf8")) as Record<
			string,
			unknown
		>;
		delete row.coverage_json;
		writeFileSync(dailyPath, `${JSON.stringify(row)}\n`);

		switchHome("birdclaw-backup-legacy-coverage-dest-");
		await importBackup({ repoPath, mode: "replace", validate: false });
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					"select coverage_json from period_digest_history where digest_date = '2025-01-08'",
				)
				.get(),
		).toEqual({ coverage_json: "{}" });
	}, 20000);

	it("imports schema-v10 history without feed fields or feed items", async () => {
		switchHome("birdclaw-backup-legacy-feed-src-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-backup-legacy-feed-repo-");
		const exported = await exportBackup({ repoPath });

		for (const relativePath of [
			"data/digests/daily-history.jsonl",
			"data/digests/weekly-history.jsonl",
		]) {
			const fullPath = path.join(repoPath, relativePath);
			const row = JSON.parse(readFileSync(fullPath, "utf8")) as Record<
				string,
				unknown
			>;
			delete row.include_feed;
			delete row.feed_json;
			delete row.twitter_scope;
			writeFileSync(fullPath, `${JSON.stringify(row)}\n`);
		}
		const feedPath = path.join(repoPath, "data/feed/items.jsonl");
		rmSync(feedPath);
		const manifestPath = path.join(repoPath, "manifest.json");
		writeFileSync(
			manifestPath,
			`${JSON.stringify(
				{
					...exported.manifest,
					schemaVersion: 10,
					files: exported.manifest.files.filter(
						(file) => file.path !== "data/feed/items.jsonl",
					),
				},
				null,
				2,
			)}\n`,
		);

		switchHome("birdclaw-backup-legacy-feed-dest-");
		await importBackup({ repoPath, mode: "replace", validate: false });
		const destinationDb = getNativeDb({ seedDemoData: false });
		expect(
			destinationDb
				.prepare(
					"select include_feed, twitter_scope, feed_json from period_digest_history where digest_date = '2025-01-08'",
				)
				.get(),
		).toEqual({ include_feed: 0, twitter_scope: "all", feed_json: "[]" });
		expect(
			destinationDb
				.prepare(
					"select include_feed, twitter_scope, feed_json from weekly_digest_history where week_start = '2025-01-06'",
				)
				.get(),
		).toEqual({ include_feed: 0, twitter_scope: "all", feed_json: "[]" });
		expect(
			destinationDb.prepare("select count(*) as count from feed_items").get(),
		).toEqual({ count: 0 });
	}, 20000);

	it("imports legacy weekly digest backups without a format version", async () => {
		switchHome("birdclaw-backup-legacy-weekly-src-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-backup-legacy-weekly-repo-");
		await exportBackup({ repoPath });
		const weeklyPath = path.join(repoPath, "data/digests/weekly-history.jsonl");
		const legacyWeekly = readFileSync(weeklyPath, "utf8").replace(
			'"format_version":1,',
			"",
		);
		expect(legacyWeekly).not.toContain("format_version");
		writeFileSync(weeklyPath, legacyWeekly);

		switchHome("birdclaw-backup-legacy-weekly-dest-");
		await importBackup({ repoPath, validate: false });

		expect(
			getNativeDb({ seedDemoData: false })
				.prepare("select week_start, format_version from weekly_digest_history")
				.all(),
		).toEqual([{ week_start: "2025-01-06", format_version: 1 }]);
	});

	it("requeues a restored note without letting an old ACK delete it", async () => {
		switchHome("birdclaw-backup-note-source-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-backup-note-store-");
		await exportBackup({ repoPath });

		switchHome("birdclaw-backup-note-target-");
		const db = getNativeDb({ seedDemoData: false });
		saveBirdclawProfileRemark(
			{ identifier: "42", handle: "friend", remark: "Pending B" },
			db,
		);
		db.prepare(
			"update birdclaw_profile_notes set updated_at = ? where note_key = ?",
		).run("2024-01-01T00:00:00.000Z", "id:42");

		await importBackup({ repoPath, db });
		const restored = db
			.prepare(
				`select remark, sync_revision, base_json
				 from birdclaw_profile_notes where note_key = 'id:42'`,
			)
			.get() as {
			remark: string;
			sync_revision: number;
			base_json: string;
		};
		expect(restored).toMatchObject({
			remark: "Met at a local-first meetup",
			sync_revision: 2,
		});
		expect(JSON.parse(restored.base_json)).toEqual([
			{ exists: false },
			expect.objectContaining({ exists: true, remark: "Pending B" }),
		]);

		acknowledgeXRemarkChanges({ applied: [1], conflicts: [] }, db);
		expect(
			db
				.prepare(
					"select remark, sync_revision from birdclaw_profile_notes where note_key = 'id:42'",
				)
				.get(),
		).toEqual({
			remark: "Met at a local-first meetup",
			sync_revision: 2,
		});
	}, 20000);

	it("prefers a richer weekly format over a newer legacy timestamp", async () => {
		switchHome("birdclaw-backup-weekly-v2-src-");
		seedBackupFixture();
		getNativeDb({ seedDemoData: false })
			.prepare(
				`update weekly_digest_history
				 set format_version = 2, markdown = '# Rich weekly backup'
				 where week_start = '2025-01-06'`,
			)
			.run();
		const repoPath = makeTempDir("birdclaw-backup-weekly-v2-repo-");
		await exportBackup({ repoPath });

		switchHome("birdclaw-backup-weekly-v1-dest-");
		getNativeDb({ seedDemoData: false })
			.prepare(
				`insert into weekly_digest_history (
				 id, week_start, week_end, timezone, status, claim_token, format_version,
				 started_at, finished_at, created_at, updated_at
				) values (
				 'legacy-newer', '2025-01-06', '2025-01-12', 'UTC', 'ready',
				 'active-upgrade', 1,
				 '2030-01-01T00:00:00.000Z', '2030-01-01T00:01:00.000Z',
				 '2030-01-01T00:00:00.000Z', '2030-01-01T00:01:00.000Z'
				)`,
			)
			.run();

		await importBackup({ repoPath });

		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					`select format_version, claim_token, markdown
					 from weekly_digest_history where week_start = '2025-01-06'`,
				)
				.get(),
		).toEqual({
			format_version: 2,
			claim_token: "",
			markdown: "# Rich weekly backup",
		});
	});

	it("does not downgrade a fresh DM request when merging a stale backup", async () => {
		switchHome("birdclaw-backup-dm-merge-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-backup-dm-merge-repo-");
		await exportBackup({ repoPath });

		const conversationsPath = path.join(
			repoPath,
			"data/dms/conversations.jsonl",
		);
		writeFileSync(
			conversationsPath,
			readFileSync(conversationsPath, "utf8").replace(
				'"inbox_kind":"request"',
				'"inbox_kind":"accepted"',
			),
		);

		await importBackup({ repoPath, validate: false });

		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					"select inbox_kind from dm_conversations where id = 'dm:friend'",
				)
				.get(),
		).toEqual({ inbox_kind: "request" });
	});

	it("merges backup rows without deleting local-only tweets", async () => {
		switchHome("birdclaw-backup-src-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-store-");
		await exportBackup({ repoPath });

		switchHome("birdclaw-backup-merge-");
		const db = getNativeDb();
		clearData();
		insertTestAccount(db, {
			id: "acct_primary",
			name: "Peter Steinberger",
			handle: "@steipete",
			externalUserId: "25401953",
			createdAt: "2009-03-19T22:54:05.000Z",
		});
		insertTestProfile(db, {
			id: "profile_me",
			handle: "steipete",
			displayName: "Peter Steinberger",
			bio: "",
			followersCount: 0,
			followingCount: 0,
			publicMetricsJson: "{}",
			createdAt: "2009-03-19T22:54:05.000Z",
		});
		insertTestTweet(db, {
			id: "local_only",
			authorProfileId: "profile_me",
			text: "Local-only tweet",
		});

		await importBackup({ repoPath });

		expect(
			db
				.prepare("select count(*) from tweets where id = 'local_only'")
				.get() as { "count(*)": number },
		).toEqual({ "count(*)": 1 });
		expect(
			db
				.prepare("select count(*) from tweets where id = 'tweet_2025'")
				.get() as { "count(*)": number },
		).toEqual({ "count(*)": 1 });
	}, 20000);

	it("syncs through git by pulling, merging, exporting, committing, and pushing", async () => {
		const remotePath = path.join(makeTempDir("birdclaw-remote-"), "remote.git");
		execFileSync("git", ["init", "--bare", remotePath]);

		switchHome("birdclaw-sync-src-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-sync-work-");

		const first = await syncBackup({
			repoPath,
			remote: remotePath,
			message: "archive: initial backup",
		});

		expect(first.imported).toBe(false);
		expect(first.exportResult.git?.committed).toBe(true);
		expect(first.exportResult.git?.pushed).toBe(true);

		switchHome("birdclaw-sync-dst-");
		const secondRepoPath = makeTempDir("birdclaw-sync-other-");
		const second = await syncBackup({
			repoPath: secondRepoPath,
			remote: remotePath,
			message: "archive: roundtrip backup",
		});

		expect(second.imported).toBe(true);
		expect(second.importResult?.validation?.ok).toBe(true);
		expect(second.exportResult.git?.committed).toBe(false);
		expect(second.exportResult.manifest.counts).toMatchObject({
			accounts: 1,
			profiles: 2,
			profile_affiliations: 1,
			profile_snapshots: 1,
			profile_bio_entities: 2,
			tweets: 3,
			timeline_edges_home: 1,
			collections_bookmarks: 1,
			collections_likes: 2,
			dm_conversations: 1,
			dm_messages: 2,
			url_expansions: 1,
			link_occurrences: 1,
			blocks: 1,
			mutes: 1,
			tweet_actions: 1,
			ai_scores: 1,
			birdclaw_profile_notes: 1,
			birdclaw_profile_priorities: 1,
			birdclaw_lists: 1,
			birdclaw_list_members: 2,
			discussion_history: 1,
			feed_items: 2,
			period_digest_history: 1,
			weekly_digest_history: 1,
			follow_snapshots: 1,
			follow_snapshot_members: 1,
			follow_edges: 1,
			follow_events: 1,
			twillot_history_jobs: 1,
			twillot_history_batches: 1,
			twillot_history_daily_usage: 1,
		});
		expectNoDemoSeedRows();
		expect(
			getNativeDb({ seedDemoData: false })
				.prepare(
					"select count(*) as count from tweets where id in ('tweet_2024', 'tweet_2025', 'tweet_unknown_date')",
				)
				.get(),
		).toEqual({ count: 3 });
		expect(
			execFileSync(
				"git",
				["--git-dir", remotePath, "rev-list", "--count", "refs/heads/main"],
				{ encoding: "utf8" },
			).trim(),
		).toBe("1");
	}, 20000);

	it("does not inherit commit signing for generated backup commits", async () => {
		switchHome("birdclaw-sync-signing-src-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-sync-signing-work-");
		execFileSync("git", ["init", repoPath]);
		execFileSync("git", ["-C", repoPath, "config", "commit.gpgsign", "true"]);
		execFileSync("git", ["-C", repoPath, "config", "gpg.program", "false"]);

		const result = await exportBackup({
			repoPath,
			commit: true,
			message: "archive: unsigned backup",
		});

		expect(result.git?.committed).toBe(true);
		expect(
			execFileSync("git", ["-C", repoPath, "rev-parse", "--verify", "HEAD"], {
				encoding: "utf8",
			}).trim(),
		).toBe(result.git?.commit);
	}, 20000);

	it("reports validation errors for missing or corrupt backup files", async () => {
		const missingManifest = await validateBackup(
			makeTempDir("birdclaw-empty-"),
		);

		expect(missingManifest.ok).toBe(false);
		expect(missingManifest.errors[0]).toContain("manifest.json");

		switchHome("birdclaw-corrupt-src-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-corrupt-store-");
		await exportBackup({ repoPath });

		const manifestPath = path.join(repoPath, "manifest.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			backupHash: string;
			counts: { tweets: number };
		};
		manifest.backupHash = "bad-hash";
		manifest.counts.tweets = -1;
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
		appendFileSync(path.join(repoPath, "data/tweets/2024.jsonl"), "{broken\n");
		rmSync(path.join(repoPath, "data/profiles.jsonl"));

		const validation = await validateBackup(repoPath);

		expect(validation.ok).toBe(false);
		expect(validation.errors.join("\n")).toContain("data/profiles.jsonl");
		expect(validation.errors.join("\n")).toContain("data/tweets/2024.jsonl:2");
		expect(validation.errors.join("\n")).toContain("backup hash");
		expect(validation.errors.join("\n")).toContain("manifest counts");
	}, 20000);

	it("reports unowned data paths as validation errors", async () => {
		switchHome("birdclaw-unowned-src-");
		seedBackupFixture();
		const repoPath = makeTempDir("birdclaw-unowned-store-");
		await exportBackup({ repoPath });

		const manifestPath = path.join(repoPath, "manifest.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
			files: Array<{
				path: string;
				rows: number;
				sha256: string;
				bytes: number;
			}>;
		};
		const relativePath = "data/unowned.jsonl";
		const content = "{}\n";
		writeFileSync(path.join(repoPath, relativePath), content);
		manifest.files.push({
			path: relativePath,
			rows: 1,
			sha256: "unimportant",
			bytes: Buffer.byteLength(content),
		});
		writeFileSync(manifestPath, JSON.stringify(manifest));

		const validation = await validateBackup(repoPath);

		expect(validation.ok).toBe(false);
		expect(validation.errors).toContain(
			"No backup codec owns path: data/unowned.jsonl",
		);
	}, 20000);

	it("auto-updates from the configured backup repo only when stale", async () => {
		const previousAutoSyncEnv = process.env.BIRDCLAW_BACKUP_AUTO_SYNC;
		process.env.BIRDCLAW_BACKUP_AUTO_SYNC = "1";
		const remotePath = path.join(makeTempDir("birdclaw-remote-"), "remote.git");
		execFileSync("git", ["init", "--bare", remotePath]);

		try {
			switchHome("birdclaw-auto-src-");
			seedBackupFixture();
			await syncBackup({
				repoPath: makeTempDir("birdclaw-auto-push-"),
				remote: remotePath,
				message: "archive: auto sync seed",
			});

			switchHome("birdclaw-auto-dst-");
			const repoPath = makeTempDir("birdclaw-auto-work-");
			writeFileSync(
				path.join(testHome().root, "config.json"),
				JSON.stringify({
					backup: {
						repoPath,
						remote: remotePath,
						autoSync: true,
						staleAfterSeconds: 900,
					},
				}),
			);

			const first = await maybeAutoUpdateBackup();

			expect(first).toMatchObject({
				ok: true,
				enabled: true,
				skipped: false,
				imported: true,
			});
			expect(
				getNativeDb()
					.prepare(
						"select count(*) as count from tweets where id = 'tweet_2025'",
					)
					.get(),
			).toEqual({ count: 1 });

			const second = await maybeAutoUpdateBackup();

			expect(second).toMatchObject({
				ok: true,
				enabled: true,
				skipped: true,
				reason: "backup auto-sync is fresh",
			});
		} finally {
			if (previousAutoSyncEnv === undefined) {
				delete process.env.BIRDCLAW_BACKUP_AUTO_SYNC;
			} else {
				process.env.BIRDCLAW_BACKUP_AUTO_SYNC = previousAutoSyncEnv;
			}
		}
	}, 20000);

	it("skips automatic backup work when disabled or unconfigured", async () => {
		const previousAutoSyncEnv = process.env.BIRDCLAW_BACKUP_AUTO_SYNC;
		try {
			process.env.BIRDCLAW_BACKUP_AUTO_SYNC = "0";
			await expect(maybeAutoUpdateBackup()).resolves.toMatchObject({
				ok: true,
				enabled: false,
				skipped: true,
			});
			await expect(maybeAutoSyncBackup()).resolves.toMatchObject({
				ok: true,
				enabled: false,
				skipped: true,
			});

			process.env.BIRDCLAW_BACKUP_AUTO_SYNC = "1";
			switchHome("birdclaw-auto-unconfigured-");

			await expect(maybeAutoUpdateBackup()).resolves.toMatchObject({
				ok: true,
				enabled: false,
				skipped: true,
				reason: "backup auto-sync is not configured",
			});
			await expect(maybeAutoSyncBackup()).resolves.toMatchObject({
				ok: true,
				enabled: false,
				skipped: true,
				reason: "backup auto-sync is not configured",
			});
		} finally {
			if (previousAutoSyncEnv === undefined) {
				delete process.env.BIRDCLAW_BACKUP_AUTO_SYNC;
			} else {
				process.env.BIRDCLAW_BACKUP_AUTO_SYNC = previousAutoSyncEnv;
			}
		}
	});

	it("handles backup auto-sync config variants and failures", async () => {
		const previousAutoSyncEnv = process.env.BIRDCLAW_BACKUP_AUTO_SYNC;
		process.env.BIRDCLAW_BACKUP_AUTO_SYNC = "1";
		try {
			switchHome("birdclaw-auto-off-");
			writeBackupConfig(testHome().root, {
				repoPath: makeTempDir("birdclaw-auto-off-repo-"),
				autoSync: false,
			});

			await expect(maybeAutoUpdateBackup()).resolves.toMatchObject({
				ok: true,
				enabled: false,
				skipped: true,
			});

			switchHome("birdclaw-auto-empty-config-");
			writeBackupConfig(testHome().root, {});

			await expect(maybeAutoSyncBackup()).resolves.toMatchObject({
				ok: true,
				enabled: false,
				skipped: true,
			});

			switchHome("birdclaw-auto-bad-config-");
			writeFileSync(path.join(testHome().root, "config.json"), "{bad");
			resetBirdclawPathsForTests();

			await expect(maybeAutoUpdateBackup()).resolves.toMatchObject({
				ok: false,
				enabled: true,
				skipped: false,
			});
			await expect(maybeAutoSyncBackup()).resolves.toMatchObject({
				ok: false,
				enabled: true,
				skipped: false,
			});

			switchHome("birdclaw-auto-repo-only-");
			const repoOnlyPath = makeTempDir("birdclaw-auto-repo-only-work-");
			writeBackupConfig(testHome().root, {
				repoPath: repoOnlyPath,
				staleAfterSeconds: -1,
			});

			const repoOnly = await maybeAutoUpdateBackup();

			expect(repoOnly).toMatchObject({
				ok: true,
				enabled: true,
				skipped: false,
				imported: false,
			});
			expect(repoOnly.remote).toBeUndefined();

			const db = getNativeDb();
			db.prepare(
				"update sync_cache set value_json = ? where cache_key = 'backup:auto-sync'",
			).run("{broken");
			const invalidState = await maybeAutoUpdateBackup();
			expect(invalidState).toMatchObject({
				ok: true,
				enabled: true,
				skipped: false,
			});

			db.prepare(
				"update sync_cache set value_json = ? where cache_key = 'backup:auto-sync'",
			).run(
				JSON.stringify({
					checkedAt: new Date(Date.now() + 60_000).toISOString(),
					ok: true,
				}),
			);
			const futureState = await maybeAutoUpdateBackup();
			expect(futureState).toMatchObject({
				ok: true,
				enabled: true,
				skipped: false,
			});

			switchHome("birdclaw-auto-fail-update-");
			const fileRepoPath = path.join(testHome().root, "not-a-dir");
			writeFileSync(fileRepoPath, "");
			writeBackupConfig(testHome().root, { repoPath: fileRepoPath });

			await expect(maybeAutoUpdateBackup()).resolves.toMatchObject({
				ok: false,
				enabled: true,
				skipped: false,
				repoPath: fileRepoPath,
			});
			await expect(maybeAutoSyncBackup()).resolves.toMatchObject({
				ok: false,
				enabled: true,
				skipped: false,
				repoPath: fileRepoPath,
			});
		} finally {
			if (previousAutoSyncEnv === undefined) {
				delete process.env.BIRDCLAW_BACKUP_AUTO_SYNC;
			} else {
				process.env.BIRDCLAW_BACKUP_AUTO_SYNC = previousAutoSyncEnv;
			}
		}
	});

	it("auto-syncs local changes back to the configured backup repo", async () => {
		const previousAutoSyncEnv = process.env.BIRDCLAW_BACKUP_AUTO_SYNC;
		process.env.BIRDCLAW_BACKUP_AUTO_SYNC = "1";
		const remotePath = path.join(makeTempDir("birdclaw-remote-"), "remote.git");
		execFileSync("git", ["init", "--bare", remotePath]);

		try {
			switchHome("birdclaw-auto-write-");
			seedBackupFixture();
			const repoPath = makeTempDir("birdclaw-auto-write-work-");
			writeFileSync(
				path.join(testHome().root, "config.json"),
				JSON.stringify({
					backup: {
						repoPath,
						remote: remotePath,
						autoSync: true,
						staleAfterSeconds: 900,
					},
				}),
			);
			resetBirdclawPathsForTests();

			const result = await maybeAutoSyncBackup();

			expect(result).toMatchObject({
				ok: true,
				enabled: true,
				skipped: false,
				imported: false,
			});
			expect(existsSync(path.join(repoPath, "manifest.json"))).toBe(true);
			expect(
				execFileSync(
					"git",
					["--git-dir", remotePath, "rev-list", "--count", "refs/heads/main"],
					{
						encoding: "utf8",
					},
				).trim(),
			).toBe("1");
		} finally {
			if (previousAutoSyncEnv === undefined) {
				delete process.env.BIRDCLAW_BACKUP_AUTO_SYNC;
			} else {
				process.env.BIRDCLAW_BACKUP_AUTO_SYNC = previousAutoSyncEnv;
			}
		}
	}, 20000);
});
