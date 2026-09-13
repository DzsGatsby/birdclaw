import NativeSqliteDatabase, {
	type Database,
	SQLITE_BUSY_TIMEOUT_MS,
} from "./sqlite";
import { ensureBirdclawDirs, getBirdclawPaths } from "./config";
import {
	type DatabaseMigration,
	runDatabaseMigrations,
} from "./database-migrations";
import { seedDemoData } from "./seed";
import {
	type DatabaseConnectionRole,
	recordDatabaseStatement,
} from "./database-metrics";
import { normalizeTimestampToIso } from "./timestamps";
import { ensurePersonArchiveTables } from "./person-archive-schema";

let nativeDb: Database | undefined;
let readDbs: Database[] = [];
let readDbIndex = 0;
let demoSeedAttempted = false;

export interface InitDatabaseOptions {
	seedDemoData?: boolean;
}

const BASE_SCHEMA_SQL = `
  create table if not exists accounts (
    id text primary key,
    name text not null,
    handle text not null unique,
    external_user_id text,
    transport text not null,
    is_default integer not null default 0,
    created_at text not null
  );

  create table if not exists profiles (
    id text primary key,
    handle text not null unique,
    display_name text not null,
    bio text not null,
    followers_count integer not null default 0,
    following_count integer not null default 0,
    public_metrics_json text not null default '{}',
    avatar_hue integer not null default 0,
    avatar_url text,
    location text,
    url text,
    verified_type text,
    entities_json text not null default '{}',
    raw_json text not null default '{}',
    created_at text not null
  );

  create table if not exists profile_affiliations (
    subject_profile_id text not null,
    organization_profile_id text not null,
    organization_name text,
    organization_handle text,
    badge_url text,
    url text,
    label text,
    source text not null,
    is_active integer not null default 1,
    first_seen_at text not null,
    last_seen_at text not null,
    raw_json text not null default '{}',
    updated_at text not null,
    primary key (subject_profile_id, organization_profile_id)
  );

  create table if not exists profile_snapshots (
    profile_id text not null,
    snapshot_hash text not null,
    observed_at text not null,
    last_seen_at text not null,
    source text not null,
    handle text not null,
    display_name text not null,
    bio text not null,
    location text,
    url text,
    verified_type text,
    followers_count integer not null default 0,
    following_count integer not null default 0,
    affiliations_json text not null default '[]',
    raw_json text not null default '{}',
    primary key (profile_id, snapshot_hash)
  );

  create table if not exists profile_bio_entities (
    profile_id text not null,
    kind text not null,
    value text not null,
    source text not null,
    is_active integer not null default 1,
    first_seen_at text not null,
    last_seen_at text not null,
    raw_json text not null default '{}',
    primary key (profile_id, kind, value)
  );

  create table if not exists identity_search_index (
    profile_id text not null,
    kind text not null,
    value text not null,
    normalized_value text not null,
    source text not null,
    weight integer not null,
    updated_at text not null,
    primary key (profile_id, kind, value, source)
  );

  create table if not exists tweets (
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
    liked integer not null default 0,
    entities_json text not null default '{}',
    media_json text not null default '[]',
    quoted_tweet_id text
  );

  create table if not exists tweet_collections (
    account_id text not null,
    tweet_id text not null,
    kind text not null,
    collected_at text,
    source text not null,
    raw_json text not null default '{}',
    updated_at text not null,
    primary key (account_id, tweet_id, kind)
  );

  create table if not exists local_tweet_bookmarks (
    account_id text not null,
    tweet_id text not null,
    is_bookmarked integer not null check (is_bookmarked in (0, 1)),
    created_at text not null,
    updated_at text not null,
    primary key (account_id, tweet_id)
  );

  create table if not exists tweet_account_edges (
    account_id text not null,
    tweet_id text not null,
    kind text not null,
    first_seen_at text not null,
    last_seen_at text not null,
    seen_count integer not null default 1,
    source text not null,
    raw_json text not null default '{}',
    updated_at text not null,
    primary key (account_id, tweet_id, kind)
  );

  create table if not exists dm_conversations (
    id text primary key,
    account_id text not null,
    participant_profile_id text not null,
    title text not null,
    inbox_kind text not null default 'accepted',
    last_message_at text not null,
    unread_count integer not null default 0,
    needs_reply integer not null default 0
  );

  create table if not exists dm_messages (
    id text primary key,
    conversation_id text not null,
    sender_profile_id text not null,
    text text not null,
    created_at text not null,
    direction text not null,
    is_replied integer not null default 0,
    media_count integer not null default 0
  );

  create table if not exists tweet_actions (
    id text primary key,
    account_id text not null,
    tweet_id text,
    kind text not null,
    body text not null,
    created_at text not null
  );

  create table if not exists blocks (
    account_id text not null,
    profile_id text not null,
    source text not null,
    created_at text not null,
    primary key (account_id, profile_id)
  );

  create table if not exists mutes (
    account_id text not null,
    profile_id text not null,
    source text not null,
    created_at text not null,
    primary key (account_id, profile_id)
  );

  create table if not exists ai_scores (
    entity_kind text not null,
    entity_id text not null,
    model text not null,
    score integer not null,
    summary text not null,
    reasoning text not null,
    updated_at text not null,
    primary key (entity_kind, entity_id)
  );

  create table if not exists tweet_quality_scores (
    tweet_id text primary key,
    provider text not null,
    model text not null,
    score integer not null check (score between -2 and 9),
    label text not null,
    dimensions_json text not null,
    sentiment text not null,
    assets_json text not null,
    reason text not null,
    explanation text not null,
    content_hash text not null,
    updated_at text not null
  );

  create table if not exists tweet_quality_score_requests (
    tweet_id text primary key,
    content_hash text not null,
    generation integer not null,
    updated_at text not null
  );

  create table if not exists sync_cache (
    cache_key text primary key,
    value_json text not null,
    updated_at text not null
  );

  create table if not exists discussion_history (
    id text primary key,
    root_id text not null,
    parent_id text,
    cache_key text not null,
    title text not null,
    summary text not null,
    query text not null,
    question text,
    account text,
    source text not null,
    mode text not null,
    range text not null default 'all',
    since text,
    until text,
    include_dms integer not null default 0,
    originals_only integer not null default 0,
    hide_low_quality integer not null default 0,
    model text not null,
    reasoning_effort text not null,
    service_tier text not null,
    context_hash text not null,
    counts_json text not null,
    discussion_json text not null,
    markdown text not null,
    tweets_json text not null default '[]',
    dms_json text not null default '[]',
    live_search_json text,
    created_at text not null,
    updated_at text not null,
    pinned_at text,
    deleted_at text
  );

  create table if not exists period_digest_history (
    id text primary key,
    digest_date text not null unique,
    timezone text not null,
    status text not null default 'pending',
	claim_token text not null default '',
    attempt_count integer not null default 0,
    window_since text not null default '',
    window_until text not null default '',
    include_dms integer not null default 0,
    include_feed integer not null default 0,
	twitter_scope text not null default 'all'
	  check (twitter_scope in ('home', 'all')),
    provider text not null default '',
    model text not null default '',
    reasoning_effort text not null default '',
	    service_tier text not null default '',
	    context_hash text not null default '',
	    counts_json text not null default '{}',
	    coverage_json text not null default '{}',
	    digest_json text not null default '{}',
    markdown text not null default '',
    tweets_json text not null default '[]',
    dms_json text not null default '[]',
    links_json text not null default '[]',
    feed_json text not null default '[]',
    error text,
    started_at text not null,
    finished_at text,
    created_at text not null,
    updated_at text not null
  );

  create table if not exists weekly_digest_history (
    id text primary key,
    week_start text not null unique,
    week_end text not null,
    timezone text not null,
    status text not null default 'pending',
	claim_token text not null default '',
    attempt_count integer not null default 0,
    format_version integer not null default 1,
    window_since text not null default '',
    window_until text not null default '',
    include_dms integer not null default 0,
    include_feed integer not null default 0,
	twitter_scope text not null default 'all'
	  check (twitter_scope in ('home', 'all')),
    provider text not null default '',
    model text not null default '',
    reasoning_effort text not null default '',
	    service_tier text not null default '',
	    context_hash text not null default '',
	    counts_json text not null default '{}',
	    digest_json text not null default '{}',
    markdown text not null default '',
    tweets_json text not null default '[]',
    dms_json text not null default '[]',
    links_json text not null default '[]',
    feed_json text not null default '[]',
    error text,
    started_at text not null,
    finished_at text,
    created_at text not null,
    updated_at text not null
  );

  create table if not exists url_expansions (
    short_url text primary key,
    expanded_url text not null,
    final_url text not null,
    status text not null,
    expanded_tweet_id text,
    expanded_handle text,
    title text,
    description text,
    image_url text,
    site_name text,
    error text,
    source text not null,
    updated_at text not null
  );

  create table if not exists link_occurrences (
    source_kind text not null,
    source_id text not null,
    source_position integer not null,
    short_url text not null,
    account_id text,
    conversation_id text,
    direction text,
    created_at text not null,
    primary key (source_kind, source_id, source_position, short_url)
  );

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

  create table if not exists birdclaw_lists (
    id text primary key,
    account_id text not null,
    name text not null,
    description text not null default '',
    created_at text not null,
    updated_at text not null,
    deleted_at text,
    foreign key (account_id) references accounts(id) on delete cascade
  );

  create table if not exists birdclaw_list_members (
    list_id text not null,
    member_key text not null,
    identifier text,
    additional_name text not null,
    is_member integer not null default 1 check (is_member in (0, 1)),
    added_at text not null,
    updated_at text not null,
    primary key (list_id, member_key),
    foreign key (list_id) references birdclaw_lists(id) on delete cascade
  );

  create table if not exists follow_snapshots (
    id text primary key,
    account_id text not null,
    direction text not null,
    source text not null,
    status text not null,
    page_count integer not null default 0,
    result_count integer not null default 0,
    started_at text not null,
    completed_at text not null,
    raw_meta_json text not null default '{}'
  );

  create table if not exists follow_snapshot_members (
    snapshot_id text not null,
    profile_id text not null,
    external_user_id text not null,
    position integer not null,
    primary key (snapshot_id, profile_id)
  );

  create table if not exists follow_edges (
    account_id text not null,
    direction text not null,
    profile_id text not null,
    external_user_id text not null,
    source text not null,
    current integer not null default 1,
    first_seen_at text not null,
    last_seen_at text not null,
    ended_at text,
    updated_at text not null,
    primary key (account_id, direction, profile_id)
  );

  create table if not exists follow_events (
    id text primary key,
    account_id text not null,
    direction text not null,
    profile_id text not null,
    external_user_id text not null,
    kind text not null,
    event_at text not null,
    snapshot_id text not null
  );

  create table if not exists geocoded_locations (
    normalized_key text primary key,
    original text not null,
    lat real not null,
    lng real not null,
    formatted text,
    country_code text,
    confidence integer,
    provider text not null,
    approx_radius_m real,
    bounds_json text not null default '{}',
    components_json text not null default '{}',
    hits integer not null default 1,
    created_at text not null,
    last_used_at text not null
  );

  create table if not exists geocoded_locations_unresolved (
    normalized_key text primary key,
    original text not null,
    reason text not null,
    last_attempted_at text not null,
    ttl_until text
  );

  create virtual table if not exists tweets_fts using fts5(
    tweet_id unindexed,
    text
  );

  create virtual table if not exists dm_fts using fts5(
    message_id unindexed,
    text
  );
`;

const INDEX_SQL = `
  create index if not exists idx_tweets_kind_created on tweets(kind, created_at desc);
  create index if not exists idx_tweets_created on tweets(created_at desc);
  create index if not exists idx_tweets_account_created on tweets(account_id, created_at desc);
  create index if not exists idx_tweets_quoted on tweets(quoted_tweet_id);
  create index if not exists idx_tweet_collections_kind_account on tweet_collections(kind, account_id, collected_at desc, tweet_id);
  create index if not exists idx_tweet_collections_tweet on tweet_collections(tweet_id);
  create index if not exists idx_local_tweet_bookmarks_active on local_tweet_bookmarks(account_id, is_bookmarked, updated_at desc, tweet_id);
  create index if not exists idx_tweets_author_created on tweets(author_profile_id, created_at desc, id desc);
  create index if not exists idx_tweet_account_edges_kind_account on tweet_account_edges(kind, account_id, last_seen_at desc, tweet_id);
  create index if not exists idx_tweet_account_edges_kind_tweet on tweet_account_edges(kind, tweet_id, account_id);
  create index if not exists idx_tweet_account_edges_tweet on tweet_account_edges(tweet_id);
  create index if not exists idx_dm_conversations_account on dm_conversations(account_id, last_message_at desc);
  create index if not exists idx_dm_messages_conversation on dm_messages(conversation_id, created_at asc);
  create index if not exists idx_profiles_followers on profiles(followers_count desc);
  create index if not exists idx_profiles_following on profiles(following_count desc);
  create index if not exists idx_profiles_handle on profiles(handle);
  create index if not exists idx_profile_affiliations_subject on profile_affiliations(subject_profile_id, is_active, last_seen_at desc);
  create index if not exists idx_profile_affiliations_org on profile_affiliations(organization_profile_id, is_active, last_seen_at desc);
  create index if not exists idx_profile_snapshots_profile on profile_snapshots(profile_id, last_seen_at desc);
  create index if not exists idx_profile_bio_entities_profile on profile_bio_entities(profile_id, is_active, last_seen_at desc);
  create index if not exists idx_profile_bio_entities_value on profile_bio_entities(kind, value, is_active);
  create index if not exists idx_identity_search_index_profile on identity_search_index(profile_id);
  create index if not exists idx_identity_search_index_value on identity_search_index(normalized_value, kind, weight desc);
  create index if not exists idx_blocks_account_created on blocks(account_id, created_at desc);
  create index if not exists idx_mutes_account_created on mutes(account_id, created_at desc);
  create index if not exists idx_ai_scores_updated on ai_scores(updated_at desc);
  create index if not exists idx_tweet_quality_scores_updated on tweet_quality_scores(updated_at desc);
  create index if not exists idx_sync_cache_updated on sync_cache(updated_at desc);
  create index if not exists idx_discussion_history_list on discussion_history(deleted_at, pinned_at desc, created_at desc);
  create index if not exists idx_discussion_history_cache on discussion_history(cache_key, deleted_at, created_at desc);
  create index if not exists idx_discussion_history_root on discussion_history(root_id, deleted_at, created_at asc);
  create index if not exists idx_period_digest_history_list on period_digest_history(digest_date desc);
  create index if not exists idx_period_digest_history_status on period_digest_history(status, updated_at desc);
  create index if not exists idx_weekly_digest_history_list on weekly_digest_history(week_start desc);
  create index if not exists idx_weekly_digest_history_status on weekly_digest_history(status, updated_at desc);
  create index if not exists idx_url_expansions_expanded on url_expansions(expanded_url);
  create index if not exists idx_url_expansions_tweet on url_expansions(expanded_tweet_id);
  create index if not exists idx_url_expansions_handle on url_expansions(expanded_handle);
  create index if not exists idx_link_occurrences_url on link_occurrences(short_url);
  create index if not exists idx_link_occurrences_created on link_occurrences(created_at desc);
  create index if not exists idx_link_occurrences_account on link_occurrences(account_id, created_at desc);
  create index if not exists idx_link_occurrences_direction on link_occurrences(direction, created_at desc);
  create index if not exists idx_feed_items_kind_published on feed_items(kind, published_at desc, id desc);
  create index if not exists idx_feed_items_source_external on feed_items(source, kind, external_id);
  create index if not exists idx_feed_items_publisher on feed_items(publisher, published_at desc);
  create index if not exists idx_feed_sync_state_updated on feed_sync_state(updated_at desc);
  create unique index if not exists idx_birdclaw_lists_active_name
    on birdclaw_lists(account_id, name collate nocase)
    where deleted_at is null;
  create index if not exists idx_birdclaw_lists_account
    on birdclaw_lists(account_id, deleted_at, updated_at desc);
  create index if not exists idx_birdclaw_list_members_active
    on birdclaw_list_members(list_id, is_member, updated_at desc);
  create index if not exists idx_birdclaw_list_members_identifier
    on birdclaw_list_members(identifier, is_member);
  create index if not exists idx_follow_edges_current on follow_edges(account_id, direction, current, last_seen_at desc);
  create index if not exists idx_follow_edges_profile on follow_edges(profile_id, current);
  create index if not exists idx_follow_snapshots_account on follow_snapshots(account_id, direction, completed_at desc);
  create index if not exists idx_follow_events_account on follow_events(account_id, direction, kind, event_at desc);
  create index if not exists idx_geocoded_locations_country on geocoded_locations(country_code);
  create index if not exists idx_geocoded_locations_last_used on geocoded_locations(last_used_at desc);
  create index if not exists idx_geocoded_unresolved_ttl on geocoded_locations_unresolved(ttl_until desc);
`;

function getColumnNames(db: Database, tableName: string): Set<string> {
	const rows = db.prepare(`pragma table_info(${tableName})`).all() as Array<{
		name: string;
	}>;
	return new Set(rows.map((row) => row.name));
}

function ensureTweetMetadataColumns(db: Database) {
	const columnNames = getColumnNames(db, "tweets");
	if (!columnNames.has("entities_json")) {
		db.exec(
			"alter table tweets add column entities_json text not null default '{}'",
		);
	}
	if (!columnNames.has("media_json")) {
		db.exec(
			"alter table tweets add column media_json text not null default '[]'",
		);
	}
	if (!columnNames.has("quoted_tweet_id")) {
		db.exec("alter table tweets add column quoted_tweet_id text");
	}
}

function ensureProfileAvatarColumns(db: Database) {
	const columnNames = getColumnNames(db, "profiles");
	if (!columnNames.has("following_count")) {
		db.exec(
			"alter table profiles add column following_count integer not null default 0",
		);
	}
	if (!columnNames.has("avatar_url")) {
		db.exec("alter table profiles add column avatar_url text");
	}
	if (!columnNames.has("location")) {
		db.exec("alter table profiles add column location text");
	}
	if (!columnNames.has("url")) {
		db.exec("alter table profiles add column url text");
	}
	if (!columnNames.has("verified_type")) {
		db.exec("alter table profiles add column verified_type text");
	}
	if (!columnNames.has("entities_json")) {
		db.exec(
			"alter table profiles add column entities_json text not null default '{}'",
		);
	}
	if (!columnNames.has("raw_json")) {
		db.exec(
			"alter table profiles add column raw_json text not null default '{}'",
		);
	}
	if (!columnNames.has("public_metrics_json")) {
		db.exec(
			"alter table profiles add column public_metrics_json text not null default '{}'",
		);
	}
}

function ensureAccountExternalUserIdColumn(db: Database) {
	const columnNames = getColumnNames(db, "accounts");
	if (!columnNames.has("external_user_id")) {
		db.exec("alter table accounts add column external_user_id text");
	}
}

function ensureDmConversationInboxColumns(db: Database) {
	const columnNames = getColumnNames(db, "dm_conversations");
	if (!columnNames.has("inbox_kind")) {
		db.exec(
			"alter table dm_conversations add column inbox_kind text not null default 'accepted'",
		);
	}
}

function ensureTweetCollectionsTable(db: Database) {
	db.exec(`
    create table if not exists tweet_collections (
      account_id text not null,
      tweet_id text not null,
      kind text not null,
      collected_at text,
      source text not null,
      raw_json text not null default '{}',
      updated_at text not null,
      primary key (account_id, tweet_id, kind)
    );
  `);
}

function ensureTweetQualityScoresTable(db: Database) {
	db.exec(`
    create table if not exists tweet_quality_scores (
      tweet_id text primary key,
      provider text not null,
      model text not null,
      score integer not null check (score between -2 and 9),
      label text not null,
      dimensions_json text not null,
      sentiment text not null,
      assets_json text not null,
      reason text not null,
      explanation text not null,
      content_hash text not null,
      updated_at text not null
    );
    create index if not exists idx_tweet_quality_scores_updated
      on tweet_quality_scores(updated_at desc);
    create table if not exists tweet_quality_score_requests (
      tweet_id text primary key,
      content_hash text not null,
      generation integer not null,
      updated_at text not null
    );
  `);
}

function ensureLocalTweetBookmarksTable(db: Database) {
	db.exec(`
    create table if not exists local_tweet_bookmarks (
      account_id text not null,
      tweet_id text not null,
      is_bookmarked integer not null check (is_bookmarked in (0, 1)),
      created_at text not null,
      updated_at text not null,
      primary key (account_id, tweet_id)
    );
    create index if not exists idx_local_tweet_bookmarks_active
      on local_tweet_bookmarks(account_id, is_bookmarked, updated_at desc, tweet_id);
  `);
	if (getColumnNames(db, "tweets").has("author_profile_id")) {
		db.exec(
			"create index if not exists idx_tweets_author_created on tweets(author_profile_id, created_at desc, id desc)",
		);
	}
}

function ensureTweetAccountEdgesTable(db: Database) {
	db.exec(`
    create table if not exists tweet_account_edges (
      account_id text not null,
      tweet_id text not null,
      kind text not null,
      first_seen_at text not null,
      last_seen_at text not null,
      seen_count integer not null default 1,
      source text not null,
      raw_json text not null default '{}',
      updated_at text not null,
      primary key (account_id, tweet_id, kind)
    );
  `);
}

function ensureProfileAffiliationsTable(db: Database) {
	db.exec(`
    create table if not exists profile_affiliations (
      subject_profile_id text not null,
      organization_profile_id text not null,
      organization_name text,
      organization_handle text,
      badge_url text,
      url text,
      label text,
      source text not null,
      is_active integer not null default 1,
      first_seen_at text not null,
      last_seen_at text not null,
      raw_json text not null default '{}',
      updated_at text not null,
      primary key (subject_profile_id, organization_profile_id)
    );
  `);
}

function ensureProfileSnapshotsTable(db: Database) {
	db.exec(`
    create table if not exists profile_snapshots (
      profile_id text not null,
      snapshot_hash text not null,
      observed_at text not null,
      last_seen_at text not null,
      source text not null,
      handle text not null,
      display_name text not null,
      bio text not null,
      location text,
      url text,
      verified_type text,
      followers_count integer not null default 0,
      following_count integer not null default 0,
      affiliations_json text not null default '[]',
      raw_json text not null default '{}',
      primary key (profile_id, snapshot_hash)
    );
  `);
}

function ensureProfileBioEntitiesTable(db: Database) {
	db.exec(`
    create table if not exists profile_bio_entities (
      profile_id text not null,
      kind text not null,
      value text not null,
      source text not null,
      is_active integer not null default 1,
      first_seen_at text not null,
      last_seen_at text not null,
      raw_json text not null default '{}',
      primary key (profile_id, kind, value)
    );
  `);
}

function ensureIdentitySearchIndexTable(db: Database) {
	db.exec(`
    create table if not exists identity_search_index (
      profile_id text not null,
      kind text not null,
      value text not null,
      normalized_value text not null,
      source text not null,
      weight integer not null,
      updated_at text not null,
      primary key (profile_id, kind, value, source)
    );
  `);
}

function ensureLinkIndexTables(db: Database) {
	db.exec(`
    create table if not exists url_expansions (
      short_url text primary key,
      expanded_url text not null,
      final_url text not null,
      status text not null,
      expanded_tweet_id text,
      expanded_handle text,
      title text,
      description text,
      image_url text,
      site_name text,
      error text,
      source text not null,
      updated_at text not null
    );

    create table if not exists link_occurrences (
      source_kind text not null,
      source_id text not null,
      source_position integer not null,
      short_url text not null,
      account_id text,
      conversation_id text,
      direction text,
      created_at text not null,
      primary key (source_kind, source_id, source_position, short_url)
    );
  `);

	const urlExpansionColumns = getColumnNames(db, "url_expansions");
	if (!urlExpansionColumns.has("image_url")) {
		db.exec("alter table url_expansions add column image_url text");
	}
	if (!urlExpansionColumns.has("site_name")) {
		db.exec("alter table url_expansions add column site_name text");
	}
}

function ensureFeedTables(db: Database) {
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

    create index if not exists idx_feed_items_kind_published
      on feed_items(kind, published_at desc, id desc);
    create index if not exists idx_feed_items_source_external
      on feed_items(source, kind, external_id);
    create index if not exists idx_feed_items_publisher
      on feed_items(publisher, published_at desc);
    create index if not exists idx_feed_sync_state_updated
      on feed_sync_state(updated_at desc);
  `);
}

function ensureProfileListsTables(db: Database) {
	db.exec(`
    create table if not exists birdclaw_lists (
      id text primary key,
      account_id text not null,
      name text not null,
      description text not null default '',
      created_at text not null,
      updated_at text not null,
      deleted_at text,
      foreign key (account_id) references accounts(id) on delete cascade
    );

    create table if not exists birdclaw_list_members (
      list_id text not null,
      member_key text not null,
      identifier text,
      additional_name text not null,
      is_member integer not null default 1 check (is_member in (0, 1)),
      added_at text not null,
      updated_at text not null,
      primary key (list_id, member_key),
      foreign key (list_id) references birdclaw_lists(id) on delete cascade
    );

    create unique index if not exists idx_birdclaw_lists_active_name
      on birdclaw_lists(account_id, name collate nocase)
      where deleted_at is null;
    create index if not exists idx_birdclaw_lists_account
      on birdclaw_lists(account_id, deleted_at, updated_at desc);
    create index if not exists idx_birdclaw_list_members_active
      on birdclaw_list_members(list_id, is_member, updated_at desc);
    create index if not exists idx_birdclaw_list_members_identifier
      on birdclaw_list_members(identifier, is_member);
  `);
}

function ensureFollowGraphTables(db: Database) {
	db.exec(`
    create table if not exists follow_snapshots (
      id text primary key,
      account_id text not null,
      direction text not null,
      source text not null,
      status text not null,
      page_count integer not null default 0,
      result_count integer not null default 0,
      started_at text not null,
      completed_at text not null,
      raw_meta_json text not null default '{}'
    );

    create table if not exists follow_snapshot_members (
      snapshot_id text not null,
      profile_id text not null,
      external_user_id text not null,
      position integer not null,
      primary key (snapshot_id, profile_id)
    );

    create table if not exists follow_edges (
      account_id text not null,
      direction text not null,
      profile_id text not null,
      external_user_id text not null,
      source text not null,
      current integer not null default 1,
      first_seen_at text not null,
      last_seen_at text not null,
      ended_at text,
      updated_at text not null,
      primary key (account_id, direction, profile_id)
    );

    create table if not exists follow_events (
      id text primary key,
      account_id text not null,
      direction text not null,
      profile_id text not null,
      external_user_id text not null,
      kind text not null,
      event_at text not null,
      snapshot_id text not null
    );
	`);
}

function ensureTwillotHistoryQueueTables(db: Database) {
	db.exec(`
    create table if not exists twillot_history_jobs (
      id text primary key,
      account_id text not null,
      profile_id text not null,
      provider text not null,
      external_user_id text,
      handle text not null,
      state text not null check (
        state in ('queued', 'leased', 'deferred', 'completed', 'failed')
      ),
      capture_status text not null check (
        capture_status in (
          'capture_requested', 'waiting_for_twillot', 'capturing', 'ingesting',
          'caught_up_unverified', 'verified_complete', 'needs_attention'
        )
      ),
      cursor_json text not null default 'null',
      next_run_at text not null,
      lease_token text,
      lease_expires_at text,
      lease_usage_day text,
      lease_allowance integer not null default 0 check (lease_allowance >= 0),
      attempt_count integer not null default 0 check (attempt_count >= 0),
      downloaded_count integer not null default 0 check (downloaded_count >= 0),
      imported_count integer not null default 0 check (imported_count >= 0),
      last_error text,
      created_at text not null,
      updated_at text not null,
      completed_at text,
      unique (account_id, profile_id, provider)
    );

    create table if not exists twillot_history_batches (
      provider text not null,
      batch_id text not null,
      job_id text not null,
      lease_token text not null,
      usage_day text not null,
      downloaded_count integer not null check (downloaded_count >= 0),
      imported_count integer not null check (imported_count >= 0),
      cursor_json text not null default 'null',
      done integer not null check (done in (0, 1)),
      resulting_state text not null check (
        resulting_state in ('queued', 'deferred', 'completed')
      ),
      next_run_at text,
      created_at text not null,
      primary key (provider, batch_id)
    );

    create table if not exists twillot_history_daily_usage (
      provider text not null,
      usage_day text not null,
      downloaded_count integer not null default 0 check (downloaded_count >= 0),
      updated_at text not null,
      primary key (provider, usage_day)
    );

    create table if not exists twillot_companion_sync (
      id integer primary key check (id = 1),
      token_hash text not null,
      token_created_at text not null,
      source_id text,
      last_seen_at text,
      last_job_id text,
      last_error text
    );

    create table if not exists twillot_follow_sync_state (
      id integer primary key check (id = 1),
      last_started_at text,
      last_success_at text,
      last_error text
    );

    create index if not exists idx_twillot_history_jobs_ready
      on twillot_history_jobs(provider, state, next_run_at, created_at);
    create index if not exists idx_twillot_history_jobs_lease
      on twillot_history_jobs(provider, state, lease_expires_at);
    create index if not exists idx_twillot_history_batches_job
      on twillot_history_batches(job_id, created_at);
	`);
}

function ensureDiscussionHistoryTable(db: Database) {
	db.exec(`
    create table if not exists discussion_history (
      id text primary key,
      root_id text not null,
      parent_id text,
      cache_key text not null,
      title text not null,
      summary text not null,
      query text not null,
      question text,
      account text,
      source text not null,
      mode text not null,
      range text not null default 'all',
      since text,
      until text,
      include_dms integer not null default 0,
      originals_only integer not null default 0,
      hide_low_quality integer not null default 0,
      model text not null,
      reasoning_effort text not null,
      service_tier text not null,
      context_hash text not null,
      counts_json text not null,
      discussion_json text not null,
      markdown text not null,
      tweets_json text not null default '[]',
      dms_json text not null default '[]',
      live_search_json text,
      created_at text not null,
      updated_at text not null,
      pinned_at text,
      deleted_at text
    );

    create index if not exists idx_discussion_history_list
      on discussion_history(deleted_at, pinned_at desc, created_at desc);
    create index if not exists idx_discussion_history_cache
      on discussion_history(cache_key, deleted_at, created_at desc);
    create index if not exists idx_discussion_history_root
      on discussion_history(root_id, deleted_at, created_at asc);
	`);
}

function ensurePeriodDigestHistoryTable(db: Database) {
	db.exec(`
    create table if not exists period_digest_history (
      id text primary key,
      digest_date text not null unique,
      timezone text not null,
      status text not null default 'pending',
	  claim_token text not null default '',
      attempt_count integer not null default 0,
      window_since text not null default '',
      window_until text not null default '',
      include_dms integer not null default 0,
      include_feed integer not null default 0,
	  twitter_scope text not null default 'all'
	    check (twitter_scope in ('home', 'all')),
      provider text not null default '',
      model text not null default '',
      reasoning_effort text not null default '',
	      service_tier text not null default '',
	      context_hash text not null default '',
	      counts_json text not null default '{}',
	      coverage_json text not null default '{}',
	      digest_json text not null default '{}',
      markdown text not null default '',
      tweets_json text not null default '[]',
      dms_json text not null default '[]',
      links_json text not null default '[]',
      feed_json text not null default '[]',
      error text,
      started_at text not null,
      finished_at text,
      created_at text not null,
      updated_at text not null
    );

    create index if not exists idx_period_digest_history_list
      on period_digest_history(digest_date desc);
    create index if not exists idx_period_digest_history_status
      on period_digest_history(status, updated_at desc);
	`);
	const columns = getColumnNames(db, "period_digest_history");
	if (!columns.has("include_feed")) {
		db.exec(
			"alter table period_digest_history add column include_feed integer not null default 0",
		);
	}
	if (!columns.has("feed_json")) {
		db.exec(
			"alter table period_digest_history add column feed_json text not null default '[]'",
		);
	}
	if (!columns.has("twitter_scope")) {
		db.exec(
			"alter table period_digest_history add column twitter_scope text not null default 'all' check (twitter_scope in ('home', 'all'))",
		);
	}
	if (!columns.has("coverage_json")) {
		db.exec(
			"alter table period_digest_history add column coverage_json text not null default '{}'",
		);
	}
}

function ensureWeeklyDigestHistoryTable(db: Database) {
	db.exec(`
    create table if not exists weekly_digest_history (
      id text primary key,
      week_start text not null unique,
      week_end text not null,
      timezone text not null,
      status text not null default 'pending',
	  claim_token text not null default '',
      attempt_count integer not null default 0,
      format_version integer not null default 1,
      window_since text not null default '',
      window_until text not null default '',
      include_dms integer not null default 0,
      include_feed integer not null default 0,
	  twitter_scope text not null default 'all'
	    check (twitter_scope in ('home', 'all')),
      provider text not null default '',
      model text not null default '',
      reasoning_effort text not null default '',
      service_tier text not null default '',
      context_hash text not null default '',
      counts_json text not null default '{}',
      digest_json text not null default '{}',
      markdown text not null default '',
      tweets_json text not null default '[]',
      dms_json text not null default '[]',
      links_json text not null default '[]',
      feed_json text not null default '[]',
      error text,
      started_at text not null,
      finished_at text,
      created_at text not null,
      updated_at text not null
    );

    create index if not exists idx_weekly_digest_history_list
      on weekly_digest_history(week_start desc);
    create index if not exists idx_weekly_digest_history_status
      on weekly_digest_history(status, updated_at desc);
	`);
	const columns = getColumnNames(db, "weekly_digest_history");
	if (!columns.has("include_feed")) {
		db.exec(
			"alter table weekly_digest_history add column include_feed integer not null default 0",
		);
	}
	if (!columns.has("feed_json")) {
		db.exec(
			"alter table weekly_digest_history add column feed_json text not null default '[]'",
		);
	}
	if (!columns.has("twitter_scope")) {
		db.exec(
			"alter table weekly_digest_history add column twitter_scope text not null default 'all' check (twitter_scope in ('home', 'all'))",
		);
	}
}

function ensureWeeklyDigestFormatVersionColumn(db: Database) {
	if (!getColumnNames(db, "weekly_digest_history").has("format_version")) {
		db.exec(
			"alter table weekly_digest_history add column format_version integer not null default 1",
		);
	}
}

function ensureXRemarkTables(db: Database) {
	db.exec(`
    create table if not exists xremark_profile_notes (
      identifier text primary key,
      additional_name text not null,
      given_name text not null default '',
      remark text not null default '',
      description text not null default '',
      tags_json text not null default '[]',
      category_name text,
      source_created_at integer,
      source_updated_at integer,
      imported_at text not null
    );

    create table if not exists xremark_import_state (
      id integer primary key check (id = 1),
      backup_id text,
      backup_time integer,
      source_version integer not null,
      imported_at text not null,
      annotation_count integer not null default 0
    );

    create index if not exists idx_xremark_profile_notes_handle
      on xremark_profile_notes(lower(additional_name));
  `);
}

function ensureXRemarkLiveSyncTable(db: Database) {
	db.exec(`
    create table if not exists xremark_live_sync (
      id integer primary key check (id = 1),
      token_hash text,
      token_created_at text,
      source_id text,
      last_sequence integer not null default 0,
      last_captured_at integer,
      last_snapshot_at text,
      last_seen_at text
    );
  `);
}

function ensureBirdclawProfileNotesTable(db: Database) {
	db.exec(`
    create table if not exists birdclaw_profile_notes (
      note_key text primary key,
      identifier text,
      additional_name text not null,
      remark text not null default '',
      description text,
      updated_at text not null
    );

    create index if not exists idx_birdclaw_profile_notes_identifier
      on birdclaw_profile_notes(identifier);
    create index if not exists idx_birdclaw_profile_notes_handle
      on birdclaw_profile_notes(lower(additional_name));
  `);
}

function ensureBirdclawProfileNoteDescriptionColumn(db: Database) {
	ensureBirdclawProfileNotesTable(db);
	if (!getColumnNames(db, "birdclaw_profile_notes").has("description")) {
		db.exec("alter table birdclaw_profile_notes add column description text");
	}
}

function ensureXRemarkBidirectionalSyncColumns(db: Database) {
	ensureBirdclawProfileNotesTable(db);
	ensureXRemarkLiveSyncTable(db);
	const noteColumns = getColumnNames(db, "birdclaw_profile_notes");
	if (!noteColumns.has("tags_json")) {
		db.exec("alter table birdclaw_profile_notes add column tags_json text");
	}
	if (!noteColumns.has("category_name")) {
		db.exec("alter table birdclaw_profile_notes add column category_name text");
	}
	if (!noteColumns.has("sync_revision")) {
		db.exec(
			"alter table birdclaw_profile_notes add column sync_revision integer",
		);
	}
	if (!noteColumns.has("base_json")) {
		db.exec("alter table birdclaw_profile_notes add column base_json text");
	}
	db.exec(`
		create table if not exists xremark_outbound_state (
			id integer primary key check (id = 1),
			next_revision integer not null default 0,
			last_acked_revision integer not null default 0
		);
		insert into xremark_outbound_state (
			id, next_revision, last_acked_revision
		) values (1, 0, 0)
		on conflict(id) do nothing;
		create index if not exists idx_birdclaw_profile_notes_sync_revision
			on birdclaw_profile_notes(sync_revision);
	`);
	reconcileBirdclawXRemarkOutbox(db);
}

export function reconcileBirdclawXRemarkOutbox(db: Database) {
	const state = db
		.prepare("select next_revision from xremark_outbound_state where id = 1")
		.get() as { next_revision: number };
	let nextRevision = Math.max(0, state.next_revision);
	const legacyNotes = db
		.prepare(
			`select note_key, identifier, additional_name, base_json
			 from birdclaw_profile_notes
			 where sync_revision is null
			 order by updated_at asc, note_key asc`,
		)
		.all() as Array<{
		note_key: string;
		identifier: string | null;
		additional_name: string;
		base_json: string | null;
	}>;
	const stableIdentifier = (value: string | null | undefined) => {
		const candidate = value?.trim() ?? "";
		if (/^\d+$/.test(candidate)) return candidate;
		const prefixed = candidate.match(/^profile_user_(\d+)$/);
		return prefixed?.[1] ?? "";
	};
	const safeTags = (value: string | null | undefined) => {
		try {
			const parsed = JSON.parse(value ?? "[]") as unknown;
			return Array.isArray(parsed)
				? parsed.filter((tag): tag is string => typeof tag === "string")
				: [];
		} catch {
			return [];
		}
	};
	const updateLegacy = db.prepare(
		`update birdclaw_profile_notes
		 set identifier = ?, sync_revision = ?, base_json = ?
		 where note_key = ? and sync_revision is null`,
	);
	const hasXRemarkNotes = Boolean(
		db
			.prepare(
				`select 1 as present from sqlite_master
				 where type = 'table' and name = 'xremark_profile_notes'`,
			)
			.get(),
	);
	const importedLookup = hasXRemarkNotes
		? db.prepare(
				`select identifier, remark, description, tags_json, category_name
				 from xremark_profile_notes
				 where (? <> '' and identifier = ?)
				    or (? = '' and lower(additional_name) = lower(?))
				 order by case when identifier = ? then 0 else 1 end
				 limit 1`,
			)
		: null;
	for (const note of legacyNotes) {
		let identifier = stableIdentifier(note.identifier);
		const imported = importedLookup?.get(
			identifier,
			identifier,
			identifier,
			note.additional_name,
			identifier,
		) as
			| {
					identifier: string;
					remark: string;
					description: string;
					tags_json: string;
					category_name: string | null;
			  }
			| undefined;
		if (!identifier) identifier = stableIdentifier(imported?.identifier);
		if (!identifier) {
			const profile = db
				.prepare(
					"select id from profiles where lower(handle) = lower(?) limit 1",
				)
				.get(note.additional_name) as { id: string } | undefined;
			identifier = stableIdentifier(profile?.id);
		}
		if (!identifier) continue;
		const base = imported
			? {
					exists: true as const,
					remark: imported.remark,
					description: imported.description,
					tags: safeTags(imported.tags_json),
					category: imported.category_name,
				}
			: { exists: false as const };
		let bases: unknown[] = [];
		try {
			const parsed = JSON.parse(note.base_json ?? "") as unknown;
			bases = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
		} catch {
			bases = [];
		}
		if (bases.length === 0) bases.push(base);
		nextRevision += 1;
		updateLegacy.run(
			identifier,
			nextRevision,
			JSON.stringify(bases),
			note.note_key,
		);
	}
	db.prepare(
		"update xremark_outbound_state set next_revision = ? where id = 1",
	).run(nextRevision);
}

function ensureBirdclawProfilePrioritiesTable(db: Database) {
	db.exec(`
    create table if not exists birdclaw_profile_priorities (
      priority_key text primary key,
      identifier text,
      additional_name text not null,
      is_special_follow integer not null default 0 check (is_special_follow in (0, 1)),
      updated_at text not null
    );

    create index if not exists idx_birdclaw_profile_priorities_identifier
      on birdclaw_profile_priorities(identifier);
    create index if not exists idx_birdclaw_profile_priorities_handle
      on birdclaw_profile_priorities(lower(additional_name));
  `);
}

function ensureTimelineReadPositionsTable(db: Database) {
	db.exec(`
    create table if not exists timeline_read_positions (
      account_id text not null,
      view_key text not null,
      anchor_tweet_id text not null,
      anchor_created_at text not null,
      pixel_offset integer not null default 0 check (pixel_offset between -4096 and 4096),
      client_session_id text not null,
      client_sequence integer not null check (client_sequence >= 0),
      revision integer not null check (revision >= 1),
      updated_at text not null,
      primary key (account_id, view_key),
      foreign key (account_id) references accounts(id) on delete cascade
    );

    create index if not exists idx_timeline_read_positions_updated
      on timeline_read_positions(updated_at desc);
  `);
}

function ensureTwitter6551EventTable(db: Database) {
	db.exec(`
    create table if not exists twitter6551_events (
      event_id text primary key,
      event_type text not null,
      watch_user text not null,
      tweet_id text,
      raw_json text not null,
      received_at text not null,
      processed_at text,
      error text
    );
    create index if not exists idx_twitter6551_events_pending
      on twitter6551_events(processed_at, received_at);
  `);
}

function backfillTweetCollections(db: Database) {
	const missingKinds = (
		[
			["likes", "liked"],
			["bookmarks", "bookmarked"],
		] as const
	).filter(([, column]) =>
		db
			.prepare(
				`
        select 1
        from tweets as tweet
        where tweet.${column} = 1
          and not exists (
            select 1
            from tweet_collections as collection
            where collection.account_id = tweet.account_id
              and collection.tweet_id = tweet.id
              and collection.kind = ?
          )
        limit 1
      `,
			)
			.get(column === "liked" ? "likes" : "bookmarks"),
	);
	if (missingKinds.length === 0) {
		return;
	}

	const now = new Date().toISOString();
	const insert = db.prepare(`
    insert or ignore into tweet_collections (
      account_id, tweet_id, kind, collected_at, source, raw_json, updated_at
    )
    select account_id, id, ?, null, 'legacy', '{}', ?
    from tweets
    where
      case
        when ? = 'likes' then liked
        else bookmarked
      end = 1
  `);

	db.transaction(() => {
		for (const [kind] of missingKinds) {
			insert.run(kind, now, kind);
		}
	})();
}

function backfillTweetAccountEdges(db: Database) {
	const missing = db
		.prepare(
			`
      select 1
      from tweets as tweet
      where tweet.kind in ('home', 'mention', 'authored', 'search')
        and not exists (
          select 1
          from tweet_account_edges as edge
          where edge.account_id = tweet.account_id
            and edge.tweet_id = tweet.id
            and edge.kind = tweet.kind
        )
      limit 1
    `,
		)
		.get();
	if (!missing) {
		return;
	}

	const now = new Date().toISOString();
	db.prepare(`
    insert or ignore into tweet_account_edges (
      account_id, tweet_id, kind, first_seen_at, last_seen_at, seen_count,
      source, raw_json, updated_at
    )
    select
      account_id,
      id,
      kind,
      created_at,
      created_at,
      1,
      'legacy',
      '{}',
      ?
    from tweets
    where kind in ('home', 'mention', 'authored', 'search')
  `).run(now);
}

function ensureSchemaIndexes(db: Database) {
	db.exec(INDEX_SQL);
}

function normalizeTweetState(db: Database) {
	backfillTweetCollections(db);
	backfillTweetAccountEdges(db);
	db.exec(`
	  drop index if exists idx_tweets_kind_created;
	  drop index if exists idx_tweets_account_created;
	  alter table tweets rename to tweets_legacy_state;
	  create table tweets (
	    id text primary key,
	    author_profile_id text not null,
	    text text not null,
	    created_at text not null,
	    is_replied integer not null default 0,
	    reply_to_id text,
	    like_count integer not null default 0,
	    media_count integer not null default 0,
	    entities_json text not null default '{}',
	    media_json text not null default '[]',
	    quoted_tweet_id text
	  );
	  insert into tweets (
	    id, author_profile_id, text, created_at, is_replied, reply_to_id,
	    like_count, media_count, entities_json, media_json, quoted_tweet_id
	  )
	  select
	    id, author_profile_id, text, created_at, is_replied, reply_to_id,
	    like_count, media_count, entities_json, media_json, quoted_tweet_id
	  from tweets_legacy_state;
	  drop table tweets_legacy_state;
	  create index idx_tweets_created on tweets(created_at desc);
	  create index idx_tweets_quoted on tweets(quoted_tweet_id);
		`);
}

function normalizeStoredTweetTimestamps(db: Database) {
	const rows = db.prepare("select id, created_at from tweets").all() as Array<{
		id: string;
		created_at: string;
	}>;
	const update = db.prepare("update tweets set created_at = ? where id = ?");

	for (const row of rows) {
		const normalized = normalizeTimestampToIso(row.created_at);
		if (normalized !== row.created_at) {
			update.run(normalized, row.id);
		}
	}
}

const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
	{
		version: 1,
		name: "canonical schema baseline",
		up: (db) => {
			db.exec(BASE_SCHEMA_SQL);
			ensureAccountExternalUserIdColumn(db);
			ensureDmConversationInboxColumns(db);
			ensureTweetMetadataColumns(db);
			ensureProfileAvatarColumns(db);
			ensureTweetCollectionsTable(db);
			ensureLocalTweetBookmarksTable(db);
			ensureTweetAccountEdgesTable(db);
			ensureProfileAffiliationsTable(db);
			ensureProfileSnapshotsTable(db);
			ensureProfileBioEntitiesTable(db);
			ensureIdentitySearchIndexTable(db);
			ensureLinkIndexTables(db);
			ensureFollowGraphTables(db);
			ensureSchemaIndexes(db);
			backfillTweetCollections(db);
			backfillTweetAccountEdges(db);
		},
	},
	{
		version: 2,
		name: "normalize tweet account and collection state",
		up: normalizeTweetState,
	},
	{
		version: 3,
		name: "normalize tweet created timestamps",
		up: normalizeStoredTweetTimestamps,
	},
	{
		version: 4,
		name: "add discussion history",
		up: (db) => {
			ensureDiscussionHistoryTable(db);
		},
	},
	{
		version: 5,
		name: "add X Remark profile notes",
		up: (db) => {
			ensureXRemarkTables(db);
		},
	},
	{
		version: 6,
		name: "add X Remark live sync pairing",
		up: (db) => {
			ensureXRemarkLiveSyncTable(db);
		},
	},
	{
		version: 7,
		name: "add local tweet bookmark overrides and author timeline index",
		up: (db) => {
			ensureLocalTweetBookmarksTable(db);
		},
	},
	{
		version: 8,
		name: "add durable 6551 realtime event inbox",
		up: (db) => {
			ensureTwitter6551EventTable(db);
		},
	},
	{
		version: 9,
		name: "add daily period digest history",
		up: (db) => {
			ensurePeriodDigestHistoryTable(db);
		},
	},
	{
		version: 10,
		name: "add weekly period digest history",
		up: (db) => {
			ensureWeeklyDigestHistoryTable(db);
		},
	},
	{
		version: 11,
		name: "version weekly period digest format",
		up: (db) => {
			ensureWeeklyDigestHistoryTable(db);
			ensureWeeklyDigestFormatVersionColumn(db);
		},
	},
	{
		version: 12,
		name: "add BirdClaw profile note overrides",
		up: (db) => {
			ensureBirdclawProfileNotesTable(db);
		},
	},
	{
		version: 13,
		name: "add BirdClaw profile description overrides",
		up: (db) => {
			ensureBirdclawProfileNoteDescriptionColumn(db);
		},
	},
	{
		version: 14,
		name: "add BirdClaw profile priorities",
		up: (db) => {
			ensureBirdclawProfilePrioritiesTable(db);
		},
	},
	{
		version: 15,
		name: "add durable Twillot history queue",
		up: (db) => {
			ensureTwillotHistoryQueueTables(db);
		},
	},
	{
		version: 16,
		name: "add durable tweet quality scores",
		up: (db) => {
			ensureTweetQualityScoresTable(db);
		},
	},
	{
		version: 17,
		name: "add durable timeline reading positions",
		up: (db) => {
			ensureTimelineReadPositionsTable(db);
		},
	},
	{
		version: 18,
		name: "reserve legacy 6551 recovery schema checkpoint",
		up: () => {},
	},
	{
		version: 19,
		name: "add bidirectional X Remark note sync",
		up: (db) => {
			ensureXRemarkBidirectionalSyncColumns(db);
		},
	},
	{
		version: 20,
		name: "add editorial feed and digest feed context",
		up: (db) => {
			ensureFeedTables(db);
			ensurePeriodDigestHistoryTable(db);
			ensureWeeklyDigestHistoryTable(db);
		},
	},
	{
		version: 21,
		name: "add private profile lists",
		up: (db) => {
			ensureProfileListsTables(db);
		},
	},
	{
		version: 22,
		name: "add person archives, source jobs, documents and media",
		up: ensurePersonArchiveTables,
	},
	{
		version: 23,
		name: "add daily digest coverage ledger",
		up: (db) => {
			ensurePeriodDigestHistoryTable(db);
		},
	},
];

function ensureDemoData(db: Database) {
	if (demoSeedAttempted) {
		return;
	}

	seedDemoData(db);
	demoSeedAttempted = true;
}

function initDatabase(options: InitDatabaseOptions = {}) {
	ensureBirdclawDirs();

	if (!nativeDb) {
		const { dbPath } = getBirdclawPaths();
		nativeDb = createDatabaseConnection(dbPath, "writer");
		nativeDb.exec(`
		  pragma journal_mode = wal;
		  pragma busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};
		  pragma foreign_keys = on;
		`);
		runDatabaseMigrations(nativeDb, DATABASE_MIGRATIONS);
		if (options.seedDemoData !== false) {
			ensureDemoData(nativeDb);
		}
	} else if (options.seedDemoData !== false) {
		ensureDemoData(nativeDb);
	}
}

function createDatabaseConnection(
	dbPath: string,
	role: DatabaseConnectionRole,
	options: { readonly?: boolean } = {},
) {
	return new NativeSqliteDatabase(dbPath, {
		...options,
		onStatement: (sql, durationMs) =>
			recordDatabaseStatement(role, sql, durationMs),
	});
}

export function getNativeDb(options: InitDatabaseOptions = {}) {
	initDatabase(options);
	return nativeDb as Database;
}

export function getReadDb(options: InitDatabaseOptions = {}) {
	initDatabase(options);
	if (readDbs.length === 0) {
		const { dbPath } = getBirdclawPaths();
		readDbs = Array.from({ length: 2 }, () => {
			const db = createDatabaseConnection(dbPath, "reader", {
				readonly: true,
			});
			db.exec(`
			  pragma busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};
			  pragma foreign_keys = on;
			  pragma query_only = on;
			`);
			return db;
		});
	}
	const db = readDbs[readDbIndex % readDbs.length] as Database;
	readDbIndex = (readDbIndex + 1) % readDbs.length;
	return db;
}

export function closeDatabase() {
	const native = nativeDb;
	const readers = readDbs;
	nativeDb = undefined;
	readDbs = [];
	readDbIndex = 0;
	demoSeedAttempted = false;

	for (const reader of readers) reader.close();
	native?.close();
}

export function resetDatabaseForTests() {
	const native = nativeDb;
	const readers = readDbs;
	nativeDb = undefined;
	readDbs = [];
	readDbIndex = 0;
	demoSeedAttempted = false;
	for (const reader of readers) reader.close();
	native?.close();
}
