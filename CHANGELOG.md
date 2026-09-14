# CHANGELOG

## Unreleased

## 0.11.22

- Compact complete Today coverage into bounded batch summaries plus prioritized details before final synthesis, and enable native Responses API context compaction as a second guard against oversized model context.
- Recover abandoned pre-v0.8.63 scheduler lock files on persistent volumes after a conservative two-hour safety window, while archiving the legacy file for rollback.

## 0.11.21

- Make an explicit daily-digest retry release any stale in-progress claim before queueing, so a deployment or crashed worker can resume immediately from its persisted coverage checkpoint.

## 0.11.20

- Accept valid structured JSON even when the model omits the requested hybrid-output delimiter, avoiding unnecessary retries and recursive Today coverage splits.

## 0.11.19

- Preserve an irreducible single tweet locally after repeated structured-output failures, ensuring one adversarial or malformed item cannot prevent complete daily coverage.

## 0.11.18

- Pre-split large Today coverage batches and recursively halve any smaller batch that still returns incomplete structured output, so every tweet can be verified without depending on a paid backup provider.

## 0.11.17

- Retry malformed or incomplete Today coverage batches on the same summary provider before failing over, while discarding invalid streamed output and preserving completed checkpoints.

## 0.11.16

- Add the v23 production database migration for the daily coverage ledger introduced in v0.11.15.

## 0.11.15

- Review every Home tweet in resumable, strictly validated batches before completing a Today report; visibly append any important item omitted from the main synthesis and report reviewed versus cited coverage.
- Preserve real source counts, coverage progress, and both provider failures on unsuccessful daily reports; add authenticated exact-date retry and cool down unavailable providers to stop retry storms.

## 0.11.14

- Submit verified Following snapshots directly from the cloud worker with the existing pairing token and endpoint checks; reject redirects and emit only safe transfer diagnostics.

## 0.11.13

- Scope Following scroll collection to the container holding all rendered user rows, preventing clipped user cells from being mistaken for the table viewport.

## 0.11.12

- Read every rendered window of the virtualized Following table before advancing pages, and retain strict full-roster count validation before upload.

## 0.11.11

- Support the current Following sync sheet for both first sync and repeated full refreshes; verify an updated completion timestamp and close the sheet before collecting every results page.

## 0.11.10

- Wait for Twillot to finish verifying and persist its connected account before closing the verification tab or reloading the following list.

## 0.11.9

- Recover verified orphaned Chromium locks on the exclusive cloud volume while preserving all session and database data. Let following-list collection proceed independently when the initial history queue check fails or defers.

## 0.11.8

- Verify the running Twillot extension against its built content revision and reload stale Chromium workers once before pairing, preventing deployments from silently executing cached companion code.

## 0.11.7

- Close the Twillot browser immediately on termination so pending automation cannot delay profile-lock release. Keep one private, bounded failure screenshot for following-sync diagnostics.

## 0.11.6

- Answer current Twillot website capability probes using the audited Chrome extension’s supported features, preventing initialization from waiting indefinitely on legacy null responses.

## 0.11.5

- Restrict the BirdClaw companion message listener to its own controls so it cannot steal Twillot’s profile and following responses or stall account connection.

## 0.11.4

- Discover the current X account when Twillot’s profile cache is empty, complete its existing-session connection, and report safe connection stages.

## 0.11.3

- Complete Twillot’s existing-account connection before cloud following sync, wait through extension initialization, and reclaim temporary verification pages after failures.

## 0.11.2 - 2026-09-08

### Fixed

- Route paired following uploads to their dedicated Origin and Bearer checks without requiring a separate web login.
- Reconnect an existing cloud X session before retrying Twillot following sync, close the temporary page, and keep login challenges explicit.

## 0.11.1 - 2026-09-08

### Fixed

- Reuse localized Twillot following pages instead of leaking a new page on every retry and exhausting cloud worker resources.
- Wait for complete rendered following pages, bound synchronization, and record safe failure diagnostics.
- Preserve the original collector source when recovering a complete following snapshot through the authenticated bridge.

## 0.11.0 - 2026-09-06

### Added

- Organize X accounts, public Telegram channels and uploaded PDF/text originals into person archives with merge, source controls and unread updates.
- Connect X sources to Twillot history backfill and collect public Telegram history and new posts with restart-safe cursors and separately tracked media downloads.
- Extend the authenticated read-only RAG MCP with person filters, document chunks, page/source attribution and exact document links.
- Deliver in-app live archive updates and protect schema 22 with a verified pre-migration backup.

### Coverage

- Collection is limited to accessible provider/public history; private or unavailable Telegram content requires a separate authorized Telegram API integration. Large or inaccessible media and PDFs needing OCR display their actual processing status.

## 0.10.25 - 2026-09-05

### Fixed

- Keep complete PDF exports available when optional tweet scoring is busy, times out, or fails.

## 0.10.24 - 2026-09-04

### Fixed

- Route configured cloud collection accounts through Twillot after FxTwitter failures even when the following graph has not been imported yet.

## 0.10.23 - 2026-09-04

### Fixed

- Authenticate displayless Chromium worker requests with the pairing token plus the dedicated integration header when no extension Origin is sent.

## 0.10.22 - 2026-09-04

### Fixed

- Include the bounded server rejection reason in Twillot cloud claim diagnostics without logging credentials.

## 0.10.21 - 2026-09-04

### Fixed

- Allow the Twillot worker's integration header through cloud CORS and report sanitized claim failure codes.

## 0.10.20 - 2026-09-04

### Fixed

- Have the Twillot cloud worker report in and claim available work immediately after pairing instead of waiting for its first five-minute alarm.

## 0.10.19 - 2026-09-04

### Fixed

- Load the BirdClaw companion before Twillot's official worker module so cloud startup cannot suppress the bridge.

## 0.10.18 - 2026-09-04

### Fixed

- Drive the cloud collector through a private service-worker bridge so Twillot's own message listeners cannot swallow controller requests.

## 0.10.17 - 2026-09-04

### Fixed

- Support Chromium's displayless Ozone backend for the full extension runtime and report whether the Twillot service worker is active.

## 0.10.16 - 2026-09-04

### Fixed

- Reapply an updated allowlisted session bootstrap when its digest changes, including Twillot and X local storage needed by the persistent cloud profile.

## 0.10.15 - 2026-09-04

### Fixed

- Pair the cloud companion through its own extension storage API so headless Railway startup does not depend on an options-page button state.

## 0.10.14 - 2026-09-04

### Fixed

- Use a dedicated worker bootstrap module that reports entry and import phases before loading Chromium automation.

## 0.10.13 - 2026-09-04

### Fixed

- Launch Railway Chromium directly in modern headless mode so worker startup does not depend on an Xvfb display server.

## 0.10.12 - 2026-09-04

### Fixed

- Start the dedicated Twillot worker unconditionally from its container entrypoint instead of relying on a path-sensitive direct-run check.

## 0.10.11 - 2026-09-04

### Fixed

- Prepare the audited official Twillot bridge while building the Railway image so worker startup does not depend on a live Chrome Web Store download.
- Emit bounded startup-phase events for cloud-worker deployment verification without exposing credentials or browser data.

## 0.10.10 - 2026-09-04

### Fixed

- Let Railway service-level build settings select the dedicated Twillot worker Dockerfile instead of inheriting the retired repository-wide Config-as-Code file.

## 0.10.9 - 2026-09-04

### Added

- Run the audited Twillot extension in a dedicated Railway Chromium worker with a persistent profile, automatic following-scope sync, and automatic public-post capture.
- Collect every current following account through a per-account FxTwitter → Twillot → 6551 fallback chain instead of depending on a local Mac collector.
- Bootstrap only allowlisted X and Twillot browser session data into the persistent cloud worker profile, then remove the one-time secret after first use.

### Changed

- Keep 6551 as the budgeted last resort only after the matching Twillot attempt fails or times out.

## 0.10.8 - 2026-09-03

### Fixed

- Let the exact Twillot companion endpoint reach its dedicated extension-origin and pairing-token checks before the private web login gate, including browser preflight requests.
- Keep lookalike and all other private API paths behind the existing BirdClaw web session gate.

## 0.10.7 - 2026-09-02

### Fixed

- Support the audited Twillot 11.0.8 extension while preserving its extension identity, permissions, and reversible official rollback copy.
- Refuse to build the BirdClaw companion when the installed Twillot source differs from the audited 11.0.8 manifest, worker, locale, or extension-key fingerprints.

## 0.10.6 - 2026-08-25

### Changed

- Revert the v0.10.4 Today source integration and restore the pre-v0.10.4 tweet-led digest behavior.
- Restore the complete PDF's separate Feed editorial-source appendix instead of folding Feed items into topic source groups.

## 0.10.5 - 2026-08-21

### Fixed

- Prevent timeline translation, scoring, and conversation request storms from exhausting Railway memory when many cards enter the viewport.
- Cancel off-screen enrichment work, serialize score batches, and load conversations only after an explicit open action.
- Bound server-side score and translation concurrency, shed overload with retry guidance, and release model slots after hard timeouts.

## 0.10.4 - 2026-08-21

### Added

- Show expandable topic-level source details in Today for flashes, articles, ordinary posts, and special-follow posts, with safe links back to each original source.

### Changed

- Build Today and weekly digests around events and themes that synthesize tweets, editorial flashes, and publisher articles while preserving reported-fact, opinion, and inference boundaries.
- Integrate editorial sources into the complete PDF's topic groups, shared source numbering, matrix, and index instead of placing them in a separate Feed appendix.

### Fixed

- Recover uniquely matched editorial citations from Markdown when model JSON is malformed or omits a nested source reference, without guessing ambiguous URLs.
- Preserve title-only context for restricted editorial articles without hydrating or reusing their cached full text, and stop complete PDF export from making hidden tweet-scoring requests.

## 0.10.3 - 2026-08-20

### Fixed

- Fetch a deeper 600-item Following window once when the Mac collector starts, then return to the lightweight 100-item poll.
- Keep retrying the deeper startup catch-up until Home succeeds, with an independent environment override that cannot reduce a larger regular poll.

## 0.10.2 - 2026-08-19

### Fixed

- Open the full PDF export for saved intraday overviews without waiting for hidden AI tweet scoring.
- Show a clear preparation state and keep PDF actions disabled while a saved digest is still restoring.

## 0.10.1 - 2026-08-18

### Added

- Generate and archive a closed-window intraday overview every eight hours at 00:00, 08:00, and 16:00 local time.
- Browse intraday history beside daily and weekly archives, with distinct slot labels and PDF filenames.

### Changed

- Make Today summaries strictly on demand so opening the page or changing its period and source controls does not call the model or spend tokens.
- Limit automatic intraday catch-up to the latest 24 hours and serialize it with daily and weekly generation.

## 0.10.0 - 2026-08-18

### Added

- Add private, account-scoped Lists beside Home with create, rename, delete, member search, and member management flows.
- Read each List as a searchable, paginated timeline of already-synced Home posts, and add profiles to Lists directly from author and profile pages.

### Changed

- Put Lists between Home and Feed in the desktop navigation and in the mobile More menu without displacing the primary mobile tabs.
- Preserve Lists, membership state, and removal tombstones through schema v21 migration and portable backup schema v12.

### Fixed

- Refresh the currently selected BirdClaw account from a List instead of silently refreshing the default account.
- Keep List APIs account-isolated and retain stable profile identities when handles change or are reused.

## 0.9.4 - 2026-08-18

### Added

- Submit a specific public X profile to the canonical Railway Twillot history queue from Settings.
- Preserve quoted-post text and author context alongside historical posts while retaining reply and quote references.

### Changed

- Pair the audited Twillot companion directly with BirdClaw Cloud instead of requiring a local BirdClaw web server.
- Keep Mini's 20,000-record daily BirdClaw budget and next-day queue resumption on Railway.

### Fixed

- Exclude video and animated-GIF media, including duplicate preview records, while keeping post text and photo attachments.
- Accept only the exact BirdClaw production companion endpoint, trusted Railway forwarding headers, or an uncredentialed loopback development endpoint.

## 0.9.3 - 2026-08-18

### Added

- Fetch and persistently cache Tiger article full text from the official detail endpoint, with strict article identity, authentication-state, response-size, and content-integrity validation.
- Read complete articles inside Feed through a mobile-safe on-demand expander while retaining the canonical Tiger source link.

### Changed

- Use cached full article bodies in Feed-enabled Today summaries, with per-article and total prompt budgets while keeping full text out of history and portable backups.
- Refresh Today digest cache versions so earlier excerpt-only summaries cannot be reused after full-text support is deployed.

### Fixed

- Bound article hydration to 25 seconds and degrade individual failures without blocking Feed synchronization, background scheduling, or Today generation.
- Reject corrupt or mismatched cached article bodies before they can reach the API, reader, or AI prompt.

## 0.9.2 - 2026-08-18

### Fixed

- Find Chinese, Japanese, and Korean phrases inside continuous post text while preserving the existing English full-text and author/ID search behavior.
- Keep substring results deduplicated and provide correctly aligned highlighted snippets for Unicode text.

## 0.9.1 - 2026-08-18

### Changed

- Restrict important breaking-news ingestion, Feed display, Today summaries, and complete PDF source labels to Tiger's US-market channel.
- Keep legacy global flash records out of user-visible queries while the first US sync safely reclassifies matching records and backfills the recent window.

### Fixed

- Reject fallback flash payloads unless they explicitly identify the US market and important-only mode.
- Exclude article excerpts when rights, risk, or content-tag metadata is missing, and treat composite `analysis` tags as non-factual commentary.

## 0.9.0 - 2026-08-18

### Added

- Add a dedicated editorial Feed with important Tiger breaking news and article tabs, canonical source links, bounded background sync, and persistent cloud history.
- Add a Today control for including or excluding Feed reports, with editorial source references carried through summaries, history, and complete PDF exports.

### Changed

- Define Today's Twitter source as Home posts, with Feed as an explicit optional second source, and isolate both choices in digest hashes and caches.
- Put Feed beside Home in desktop and mobile navigation, and wrap Today actions for narrow mobile screens without horizontal clipping.

### Fixed

- Preserve Feed records and source-selection provenance through schema v20 migration, portable backup restore, daily history, and weekly history.
- Prevent a stopped Feed synchronization run from scheduling work into a newly restarted scheduler lane.

## 0.8.93 - 2026-08-18

### Added

- Sync private profile remarks, descriptions, tags, and deletions from BirdClaw back into X Remark, while retaining the existing X Remark-to-BirdClaw import path.
- Add one-tap `交易员` and `分析师` profile tags plus custom tag entry and removal in the private-note editor.

### Changed

- Poll the paired Railway X Remark bridge every 30 seconds and write tag names through X Remark's real tag IDs, creating missing tag records without duplicating existing names.
- Queue existing and backup-restored BirdClaw notes for outbound sync when a stable X identifier is available; clearly keep unresolved handle-only notes local until they can be linked.

### Fixed

- Preserve newer X Remark edits during conflicts, chain rapid BirdClaw edits across in-flight revisions, and acknowledge only exact revisions after a post-apply full snapshot has reached BirdClaw.
- Prevent recycled handles, stale local-cloud snapshots, partial acknowledgements, or an older in-flight acknowledgement from deleting or misattributing a newer private note.

## 0.8.92 - 2026-08-17

### Added

- Add configurable primary and backup providers for automatic tweet translation, with DeepSeek and OpenAI-compatible/Sub2API support in Settings.
- Fall back once when the primary translation provider is unavailable, misconfigured, or returns an invalid response, while keeping request cancellation final and isolating caches by provider, model, and priority order.

### Changed

- Keep provider credentials server-side, show only safe configured status in Settings, and preserve the legacy DeepSeek translation model environment variable.

## 0.8.91 - 2026-08-15

### Changed

- Keep the 6551 daily paid-request budget and Fx recovery/cooldown state in reserved, already-processed rows of the existing `twitter6551_events` inbox. Strictly valid state already written by v0.8.90 is promoted transactionally on first use, while corrupt legacy state blocks paid requests. This preserves the hard guards across restarts and content restores without a new SQLite schema version or a full-database pre-migration copy.
- Restore the latest BirdClaw schema and migration-backup threshold to v17 so a production v17 database can start without allocating a redundant v18 backup.

## 0.8.90 - 2026-08-15

### Added

- Add a guarded three-tier Twitter recovery chain: authenticated local Home first, free FxTwitter second, and paid 6551 only after consecutive total free-source failures.
- Persist the 6551 failure threshold, six-hour paid cooldown, and UTC-day request-attempt budget across worker and service restarts.

### Changed

- Cap paid 6551 at 24 actual HTTP attempts per day by default, counting retries before network access and failing closed when budget state is invalid or unavailable.
- Keep combined recovery REST-only, make manual free sync incapable of escalating to paid 6551, and stop paid batches as soon as the local bridge returns.
- Preserve authenticated canonical tweets while retaining successfully fetched paid partial results, and apply the same paid budget to profile analysis requests.

## 0.8.89 - 2026-08-15

### Added

- Add no-key FxTwitter recovery for configured watched accounts, target posts, conversations, and quote posts, with bounded retries, response validation, and clear runtime status.

### Changed

- Prefer free REST-only FxTwitter recovery when enabled, without creating a paid 6551 client or attempting Watch and WebSocket connections.
- Keep public recovery fill-only so authenticated or archived canonical tweets and Home edges are never downgraded; isolate endpoint failures so healthy targets continue syncing.
- Skip native repost rows that lack a wrapper ID and repost timestamp instead of inventing incorrect Home authorship or ordering.

## 0.8.88 - 2026-08-15

### Changed

- Add a REST-only 6551 recovery mode that skips unsupported Watch and WebSocket traffic while reporting successful periodic recovery as polling.
- Preserve the next recovery due time across failover worker recreation so a flapping local bridge cannot repeatedly trigger full paid backfills; an explicit manual sync still runs exactly once.

### Fixed

- Keep a successful full Following timeline collection fresh when a supplemental watched-account or target-post refresh fails, preventing false 6551 takeovers while retaining the supplemental error for diagnostics.

## 0.8.87 - 2026-08-13

### Changed

- Keep the 特别关注 view in the URL so a browser reload returns directly to the same cloud-restored reading position instead of reopening the normal Mentions tab.
- Load any remaining newer special-follow posts automatically as the reader scrolls upward, without a sync, refresh, or jump-to-latest control and without moving the visible post.

### Fixed

- Isolate automatic newer-post pagination from the cloud resume query so cached pages never replace another device's fresh reading anchor, even after slow-network scrolling and a same-browser remount.
- Preserve the currently visible post when automatic newer-post pagination reaches the browser's absolute top, where native Chrome scroll anchoring cannot keep the reading point stable by itself.

## 0.8.86 - 2026-08-13

### Changed

- Make 特别关注 a restore-only Moments-style feed: remove manual Home sync, list refresh, and jump-to-latest controls so every entry resumes the cloud reading anchor without displacing it.

### Fixed

- Remove the obsolete manual-sync instruction from the configured empty state; newly archived posts appear automatically.

## 0.8.85 - 2026-08-13

### Fixed

- Wait for the fresh cloud reading window whenever 特别关注 is reopened, keeping cached posts hidden through refresh failures and restoring the other device's anchor after Retry instead of consuming stale state.

## 0.8.84 - 2026-08-13

### Added

- Add a distinct 特别关注 tab inside Mentions that shows chronological Home posts from specially followed authors while leaving the original Mentions and Home feeds unchanged.
- Restore the 特别关注 reading anchor and offset from cloud SQLite across desktop and mobile, with deterministic pagination, deleted-anchor fallback, explicit newer-post navigation, and conflict-safe throttled saves.

### Changed

- Reuse the existing profile-level 特别关注 selection for both Today and the new feed, with clearer Chinese labels and polished configured, empty, loading, and error states.

## 0.8.83 - 2026-08-12

### Fixed

- Keep avatar, score, citation, and other floating previews mutually exclusive so keyboard focus followed by mouse hover cannot leave overlapping cards open.

## 0.8.82 - 2026-08-12

### Fixed

- Return a conservative temporary numeric score when a scoring provider responds with malformed JSON, instead of failing the timeline and complete-PDF score request.

## 0.8.81 - 2026-08-12

### Added

- Show a compact information-value score beneath each timeline avatar, with a Chinese hover, keyboard, and tap card for the five scoring dimensions, post judgment, rationale, and plain-language explanation.
- Add the numeric score alone to every referenced tweet in complete Today and Discuss PDFs while preserving their existing content, media, pagination, and index.

### Fixed

- Keep score caching durable across backups and content changes, reject malformed cached explanations, fence concurrent generations so older content cannot overwrite newer scores, and fall back to a printable conservative number when a model is unavailable.

## 0.8.80 - 2026-08-12

### Fixed

- Keep timeline Print and Open actions fully inside cards when production posts have unusually long author names or handles, while preserving compact desktop layout and mobile touch targets.
- Cover the long-author production case at landscape width and allow the mobile end-to-end fixture enough time to finish its initial local timeline load.

## 0.8.79 - 2026-08-12

### Fixed

- Keep author hover previews fully inside the browser viewport by rendering them outside timeline paint-containment and clipping boundaries, including at 320px and 390px widths.
- Remove the author-name hover underline, let both the avatar and author name open the same Twitter-style profile preview, and preserve keyboard-safe read-only bio details.

## 0.8.78 - 2026-08-12

### Added

- Add a direct Print action immediately beside each actionable timeline Open link, reusing the complete-PDF A4 pagination, image handling, and source-card typography for the selected tweet.

### Fixed

- Keep Print and Open visible inside timeline cards at 320px and 390px with full touch targets, and prevent overlapping print jobs across cards.
- Preserve the existing Discuss complete-PDF output while including reply and quoted-post context only in direct single-tweet printing.

## 0.8.77 - 2026-08-10

### Fixed

- Search Home timeline posts by author display name, exact `@handle`, stable numeric user ID, or full profile ID while preserving full-text post search and snippets.
- Keep exact handle and ID searches isolated from similarly named accounts, deduplicate author/text matches, and advertise the expanded search scope in the Home search field.

## 0.8.76 - 2026-08-10

### Added

- Queue newly followed profiles for Twillot history capture with a persistent 20,000-post daily processing budget, resumable leases, idempotent batches, and explicit unverified/verified completion states.
- Add a local, same-ID Twillot companion that reads only the audited extension database, uploads whitelisted public-post fields into BirdClaw, and preserves a vanilla rollback copy.
- Surface pairing, queue health, retries, and verification controls in Settings while periodically refreshing complete Following snapshots after pairing.

### Fixed

- Preserve richer canonical tweet and profile data when Twillot history is merged locally or replicated to Railway.
- Back up and validate pre-v15 SQLite databases before migration, including capacity checks, stale-partial recovery, and portable backup/restore support for the new queue tables.

## 0.8.75 - 2026-08-09

### Added

- Make paired Mac and Railway bookmarks visibly automatic: remove the misleading cloud collection command, refresh the open Bookmarks view every 30 seconds and on focus, and retain an explicit `Sync from X` fallback only for unpaired local installs.

### Fixed

- Hydrate cloud-only bookmarks with their tweet, author, and one-level quote data before merging state on the Mac, including a resumable capability-gated replay for bookmarks skipped by older deployments.
- Bound large bookmark hydration responses with safe pagination while preserving cursors, tombstones, idempotent replay, and rollback compatibility.

## 0.8.74 - 2026-08-09

### Fixed

- Keep the cloud Home timeline fresh without an open browser tab by syncing the full Following feed through the local collector every two minutes and continuing to upload new data during partial supplemental-source failures.
- Require a fresh full-timeline attestation before local bridge batches can keep 6551 on standby, rejecting missing, stale, or implausibly future heartbeats while preserving the configured failover window.

## 0.8.73 - 2026-08-09

### Added

- Keep BirdClaw local bookmarks synchronized between the Mac and Railway with paginated two-way replication, account isolation, deterministic tombstone conflict handling, and safe replay across rolling upgrades.
- Replicate X-native bookmarks collected on the Mac, including their tweet and profile data, into the unified Bookmarks view on mobile and cloud deployments.

### Fixed

- Apply X's 90-item bookmark page cap only to real multi-page xurl walks so 99+ saved posts continue across page tokens while explicit single-page requests keep their full requested size.

## 0.8.72 - 2026-08-08

### Fixed

- Keep Thread, Reply, Analyse, local bookmark, and like count fully inside mobile timeline cards down to 320px, with 44px touch targets and no clipped actions.
- Put the local bookmark directly in the primary mobile action row while preserving its saved state across reloads and keeping imported X bookmark metadata independent.

## 0.8.71 - 2026-08-07

### Added

- Add a persistent Special Follow control to both author profile views, with stable-account isolation, cross-device sync, backup/restore support, and disabled tombstones.
- Prioritize Special Follow authors throughout Today AI and weekly reports: before source limits, before the overall tweet cap, and before prompt-size trimming, with richer direct citations in the final report.

### Fixed

- Invalidate exact and latest Today caches when priorities change while keeping each in-flight generation bound to its starting priority snapshot.
- Preserve newer handle-only choices when a stable X user ID becomes available without transferring priorities between accounts that reuse the same handle.

## 0.8.70 - 2026-08-07

### Fixed

- Match the PC X Remark editor on mobile author pages with separately editable Remark and Description fields, including the original 80- and 300-character limits.
- Preserve both local text overrides across X Remark sync, backup, restore, and database migration while keeping same-handle accounts isolated by stable ID.
- Wait for existing private notes to load before enabling edits so a slow request cannot overwrite either field with an empty value.

## 0.8.69 - 2026-08-07

### Added

- Add and edit persistent profile remarks directly from mobile author pages, while preserving them across X Remark sync, backups, and restores.

### Fixed

- Keep Home filters in the normal mobile document flow so All, Unreplied, and Replied remain aligned, visible, and tappable in portrait and landscape layouts.
- Isolate profile remarks by stable account identity so recycled handles cannot leak or overwrite another account's note.

## 0.8.68 - 2026-08-04

### Fixed

- Honor the configured primary and backup summary providers in Discuss, allowing Railway to fall back from unavailable OpenAI credentials to the configured DeepSeek model.
- Keep cached discussion results separated by provider and record the model that actually completed the streamed analysis.

## 0.8.67 - 2026-08-04

### Fixed

- Require profile-analysis Markdown and structured summaries from both local GPT and cloud DeepSeek to use natural Simplified Chinese while preserving source quotations, handles, URLs, tickers, and proper names.
- Invalidate cached English profile analyses after the language-contract update and keep malformed-response fallback copy in Chinese.

## 0.8.66 - 2026-08-04

### Added

- Route cloud profile-analysis jobs to the local Mac over an authenticated, leased, long-poll bridge so an online Mac can stream ChatGPT results without exposing its OpenAI key to Railway.

### Fixed

- Fall back explicitly to DeepSeek when no Mac worker claims the cloud job or local GPT fails before emitting text, while preventing provider output from being mixed after streaming starts.
- Abort abandoned long polls, half-open bridge responses, and in-flight GPT work during disconnects or shutdown so stale workers cannot steal or strand later analysis jobs.

## 0.8.65 - 2026-08-04

### Fixed

- Stream profile-analysis Markdown into the page as it is generated instead of leaving large profiles on an empty preparing state until the entire response finishes.
- Honor the configured primary and backup summary providers for profile analysis, including an explicit failover status, while caching only successfully completed results.

## 0.8.64 - 2026-08-03

### Changed

- Expand weekly reports into a 7,000–10,000-character deep dive with executive context, six to ten themes, weekly turning points, key viewpoints, disagreements, important links, direct-reading picks, and a next-week watchlist.
- Balance weekly evidence across local calendar days, preserve high-signal saved and linked posts, backfill unused day quotas during one-day spikes, and raise the weekly output budget without changing daily reports.

### Fixed

- Regenerate older short weekly reports through a versioned, atomic upgrade while keeping their saved content and PDF available on provider failures.
- Fence upgrade workers against backup restores, prefer richer backup formats, and defer failed legacy upgrades until the next daily scan instead of repeatedly spending model tokens.

## 0.8.63 - 2026-08-02

### Fixed

- Replace scheduled-job lock files with renewable atomic leases, recovering abandoned work within 30 seconds without letting long-running reports or late releases overlap a successor.
- Add a drain-confirmed, recoverable migration command for legacy period-digest, account-sync, and bookmarks-sync locks.

## 0.8.62 - 2026-08-02

### Fixed

- Isolate daily and weekly scheduler startup in production-server tests so test servers cannot create report claims or leave generation locks in the real BirdClaw home.

## 0.8.61 - 2026-08-02

### Added

- Generate and persist the previous complete Monday-through-Sunday report after each local Monday midnight, using high reasoning, independent retries, bounded weekly gap recovery, and a shared model-generation lock with daily reports.
- Browse Daily and Weekly archives from Today, restore either report with zero model tokens, download private weekly PDFs, and preserve weekly history through text backup export and restore.

### Fixed

- Pin the Railway runtime to `Asia/Shanghai` so cloud daily and weekly calendar boundaries match the local app, and fence late archive responses when switching between Daily and Weekly history.

## 0.8.60 - 2026-08-02

### Fixed

- Resume a one-time, full-history cloud bridge replay with an independent cursor after live sync catches up, so older Home tweets omitted by the original 24-hour bootstrap are uploaded without rewinding normal incremental sync.
- Expose authenticated aggregate bridge counts for verifying cloud archive completeness, while keeping historical batches from falsely refreshing the live-collector heartbeat.

## 0.8.59 - 2026-08-02

### Fixed

- Reload older cloud tabs when the live-version manifest recovers from a missing or failed initial response, while avoiding duplicate reloads and out-of-order polling races.

## 0.8.58 - 2026-08-01

### Fixed

- Serve Railway's deployed commit as a compact live-version manifest instead of returning a full SSR 404 page, so open cloud tabs can detect releases without wasteful responses.
- Stop the local-only X Remark live-status updater from polling every two seconds on remote deployments while preserving automatic updates on loopback installations.

## 0.8.57 - 2026-08-01

### Fixed

- Keep Today and saved daily digest prose in Simplified Chinese by default on both the local app and Railway, without relying on a machine-specific language environment variable.
- Use the Chinese language in digest cache identities so an older language-unspecified English result is not reused after the fix.

## 0.8.56 - 2026-08-01

### Added

- Preserve X Remark author labels, personal notes, follow reasons, and categories in cloud RAG search and fetch results, and make annotation text such as `反指` searchable.

### Fixed

- Sync the authoritative X Remark snapshot through the local-cloud bridge so old posts and thread context retain author judgment context, while explicitly marking authors without annotations.

## 0.8.55 - 2026-08-01

### Added

- Generate a saved Today digest for the previous local calendar day at midnight, recover bounded gaps after sleep or restart, and browse those reports from the new desktop right rail or mobile history drawer without spending model tokens again.
- Download each saved daily digest as a private PDF attachment generated from its persisted snapshot with an isolated browser profile and content-aware cache invalidation.
- Configure a primary and backup summary model in Settings, defaulting to ChatGPT `gpt-5.5` with DeepSeek `deepseek-v4-flash` failover, while storing the DeepSeek credential only in the Mac's private BirdClaw config.

### Fixed

- Fence concurrent daily workers, reclaim interrupted runs, retry each missed date independently, redact provider credentials from persisted errors and audit logs, and preserve daily history through backup export and restore.

## 0.8.54 - 2026-08-01

### Changed

- Route automatic tweet translation through the dedicated DeepSeek API with `deepseek-v4-flash`, while leaving Today, Discuss, profile analysis, inbox scoring, and all other OpenAI model settings unchanged.

## 0.8.53 - 2026-08-01

### Fixed

- Show each cited tweet's local posting time to the minute in complete Today, Yesterday, and Discuss PDF exports, including reply context and the source index.

## 0.8.52 - 2026-07-31

### Added

- Expose the private cloud tweet archive as a read-only remote RAG MCP with ChatGPT-compatible `search` and `fetch` tools, stable source IDs, canonical citation URLs, and archived thread context.
- Protect the MCP independently from the BirdClaw web login with OAuth discovery, signed JWT verification, scoped access, and an explicit identity allowlist.

## 0.8.51 - 2026-07-31

### Fixed

- Share the live 6551/local failover status across the production server and SSR bundle so Settings reports `Local · 6551 standby` instead of a stale disabled state.

## 0.8.50 - 2026-07-31

### Fixed

- Build the Railway container on current Node 26 images by installing the pinned pnpm release directly when Corepack is unavailable.

## 0.8.49 - 2026-07-31

### Added

- Prefer the Mac's authenticated local Bird collector while it is healthy, then automatically hand collection to 6551 after three minutes without a completed local upload.
- Upload watched-account posts, complete target threads, and quote tweets to the cloud through a dedicated authenticated bridge with bounded replay, adaptive batches, and idempotent cursors.

### Fixed

- Keep local and 6551 data in one account scope across handoffs, including safe migration of legacy timeline edges, bookmarks, collections, and profile identities.
- Keep 6551 active until the local backlog is fully caught up, recover best-effort target-conversation replies, and clean up failover workers safely after startup or runtime errors.

## 0.8.48 - 2026-07-31

### Added

- Run BirdClaw continuously in Railway with a persistent SQLite volume, a private signed-cookie login, health checks, graceful shutdown, and secure fail-closed remote access.
- Ingest watched-account activity from 6551 through validated REST and WebSocket adapters, with a durable event inbox, reconnect recovery, idempotent writes, manual sync, and live status in Settings.
- Use BirdClaw comfortably from phones with touch-sized bottom navigation, safe-area spacing, responsive layouts, and automated portrait and landscape checks.

### Fixed

- Preserve rich profile bios and metrics when later tweet events only contain partial author data.
- Keep failed or out-of-scope 6551 events from corrupting timelines, reply state, or existing profiles.

## 0.8.47 - 2026-07-31

### Fixed

- Automatically translate non-Chinese quoted posts inside timeline cards instead of translating only the surrounding post.
- Give each quoted post its own “显示原文 / 显示翻译” control while preserving links, mentions, hashtags, responsive layout, and the parent thread state.

## 0.8.46 - 2026-07-31

### Added

- Automatically translate visible English, Korean, Japanese, and other non-Chinese timeline posts into Simplified Chinese, with Twitter-style “显示原文 / 显示翻译” controls that default to the translation.
- Preserve translated post links, mentions, hashtags, media hiding, and repost expansion while caching translations locally and deduplicating concurrent model requests.

## 0.8.45 - 2026-07-31

### Fixed

- Open the same local author homepage from author names, handles, mentions, media details, and network-map rows as from timeline avatars.
- Keep explicit Analyse and Analysis actions pointed at the profile analysis view while removing accidental analysis jumps from author identity links.

## 0.8.44 - 2026-07-31

### Added

- Open a Twitter-style local author timeline from any timeline avatar, with profile context, search, pagination, and every canonical post BirdClaw has stored for that person.
- Save or remove local bookmarks directly on tweet cards and see them immediately in the existing sidebar Bookmarks view without altering imported or X-native bookmark state.
- Preserve local bookmark changes, including removals, across portable backups with account-aware conflict resolution.

## 0.8.43 - 2026-07-26

### Fixed

- Stream Twitter MP4 playback through BirdClaw's loopback server with strict CDN validation and byte-range support when the browser cannot reach the video CDN directly.
- Add a reliable in-card play button, preserve expanded playback, and cancel upstream streams when the browser seeks or disconnects without truncating long videos.

## 0.8.42 - 2026-07-26

### Fixed

- Retry transient OpenAI analysis failures with bounded backoff, server-directed delays, and cancellation support before failing Today or Discuss generation.
- Replace raw OpenAI 408, 409, 429, and 5xx payloads on Today with a concise retry message after automatic recovery is exhausted.

## 0.8.41 - 2026-07-24

### Fixed

- Restore paged Likes and Bookmarks synchronization with Bird 0.8.0 by supplying the required `--all` flag whenever a maximum page count is requested.

## 0.8.40 - 2026-07-22

### Added

- Expand truncated repost text directly inside the timeline card, with loading, retry, collapse, and original-post access after the full text resolves.

### Fixed

- Resolve long repost note text on demand without opening X, while preserving complete posts that intentionally end with an ellipsis and bounding the upstream lookup time.

## 0.8.39 - 2026-07-22

### Added

- Play single tweet videos directly in the timeline with native controls, inline playback, responsive sizing, and the existing expanded media viewer.
- Preserve Bird video and animated-GIF URLs, posters, dimensions, duration, and media attachments during timeline synchronization.

### Fixed

- Keep GIF playback user-controlled and ensure expanding media leaves only one active player while restoring keyboard focus on close.

## 0.8.38 - 2026-07-22

### Fixed

- Treat fallback `t.co` links as opaque short codes so adjacent Chinese prose stays readable instead of becoming a percent-encoded blue URL.
- Reuse the same URL boundaries for background expansion, Links insights, and research exports to prevent malformed links from spreading beyond the timeline.

## 0.8.37 - 2026-07-20

### Added

- Add loopback-only real-time X Remark synchronization with one-time pairing tokens, persistent retry, full-snapshot deletion semantics, and immediate BirdClaw UI refresh.
- Ship a local bridge builder that preserves the official extension ID, observes committed IndexedDB remark changes without writing to X Remark, and produces a separate vanilla rollback copy.

### Security

- Restrict live snapshots to `127.0.0.1`, the exact X Remark extension origin, and a hashed high-entropy pairing token while rejecting forwarded requests and oversized payloads.
- Keep Chrome's managed X Remark installation untouched and forbid loading it as an unpacked extension; generated bridge and rollback directories are isolated and overwrite-protected.

## 0.8.36 - 2026-07-19

### Added

- Import X Remark JSON backups from Settings and match profile annotations by stable X user ID, with a guarded handle fallback for notes whose profile has not reached BirdClaw yet.
- Show private remarks, descriptions, categories, and tags across timelines, profile pages, previews, embedded posts, and conversation threads without adding them to AI analysis contexts or portable Git backups.

### Fixed

- Reject oversized or older X Remark snapshots before they can replace current local notes, and avoid attaching a note to a reused former handle when its stable profile is already known.

## 0.8.35 - 2026-07-19

### Fixed

- Show the source post beside Home media in a desktop X-style detail rail, with author, body, timestamp, known like/save state, and original-post access while retaining the full-screen media stage.
- Carry the same post context into quoted, reply-thread, native repost, and manual repost media; preserve the canonical original-post URL and keep media-only short links out of the detail body.

## 0.8.34 - 2026-07-19

### Fixed

- Open tweet media in a true full-viewport portal so Home timeline card containment can no longer clip the viewer or move it off-screen after scrolling.
- Add an X-style black media stage with close and gallery navigation controls, keyboard shortcuts, original-media access, 100–500% image zoom, and drag-to-pan while restoring page scroll and focus on close.

## 0.8.33 - 2026-07-19

### Fixed

- Size complete-PDF tweet media from its loaded proportions instead of fixed-height thumbnails, keeping ordinary images readable without letting them dominate the page.
- Split ultra-tall screenshots into ordered 55 mm print columns, prefer full-resolution image sources, and retain the prepared readable layout if Paged.js falls back.

## 0.8.32 - 2026-07-19

### Added

- Add a persistent Discuss history rail with time-grouped topics, summaries, theme labels, source and DM counts, pin/delete actions, search, and a responsive narrow-screen drawer.
- Restore saved discussions from a direct `run` URL without another model call, keep regenerated results as versions, and include cited source snapshots in the portable JSONL backup.

### Fixed

- Cancel active generation and stale restore requests when switching history entries, preventing late stream results from replacing the selected saved discussion.

## 0.8.31 - 2026-07-19

### Fixed

- Include cited tweet images and available video or GIF covers in both Today and Discuss complete PDF exports, using compact non-cropping grids and printing repeated sources' media only once.
- Bound image preparation before Paged.js pagination, retry original images when thumbnails fail, and replace unreachable media with a compact placeholder so one bad URL cannot stall the entire export.

## 0.8.30 - 2026-07-19

### Added

- Add `Export PDF` and `导出完整 PDF` actions to Discuss, preserving the existing on-screen summary export while building an A4 reference booklet from the completed discussion without rerunning it.
- Recover cited tweets and DMs from structured results and Markdown references, include complete cited private context, fill final Paged.js page references, and omit raw tweet URLs and like counts from the booklet.

## 0.8.29 - 2026-07-19

### Added

- Add a custom local date-and-time range to Today and Discuss, store the applied window in the URL, preserve it on refresh, and keep every existing preset available.
- Validate custom ranges before requests and keep the picker and preset controls usable in narrow layouts.

## 0.8.28 - 2026-07-19

### Fixed

- Keep complete reference PDF pagination working in production builds by feeding Paged.js only the dedicated print rules instead of the minified site-wide stylesheets.

## 0.8.27 - 2026-07-19

### Fixed

- Match Today's complete reference PDF to the approved print booklet: A4 cover, detailed contents, source matrix, topic summaries, prominent author identities, source cards, running footers, and a compact source index.
- Print the already paginated booklet so every contents and source-index page number matches the final PDF, while preserving uncited webpage text and full topic titles.

## 0.8.26 - 2026-07-18

### Added

- Add a `导出完整 PDF` action to Today that turns the currently rendered digest and its cited posts into a print-ready reference collection with reading navigation, topic grouping, page numbers, author/date metadata, and a source index, while preserving the existing summary PDF export.
- Keep the reference collection focused on reading by omitting like counts, original tweet links, and exact times while retaining shared external materials.

## 0.8.25 - 2026-07-18

### Fixed

- Render tweet citations wrapped in Chinese full-width punctuation as compact `source` links instead of exposing blue raw tweet IDs, while keeping the surrounding Discuss prose at the normal text color.

## 0.8.24 - 2026-07-18

### Fixed

- Hydrate avatars for text-only `RT @handle:` reposts across Bird, Xurl, and cached Home timeline syncs, including recent historical rows that no longer appear in the latest payload.
- Prefer hydrated and canonical profiles when legacy handle rows differ only by letter casing, preventing blank placeholders from winning timeline reads.

## 0.8.23 - 2026-07-18

### Added

- Add All, Today, 24h, Yesterday, and Week date-range filters to Discuss, with refreshes preserving the submitted time window.

### Fixed

- Scope Discuss citation links to trailing `source` labels so generated prose and ordinary Markdown links keep the normal text color, matching Today.
- Keep local Discuss sources local instead of running an unused live keyword sync before reading Home, Mentions, Authored, Likes, or Bookmarks.

## 0.8.22 - 2026-07-18

### Fixed

- Place Today topic headings inline before their matching discussion groups instead of collecting every topic in a separate summary at the top.
- Recover the same inline structure for cached flat-Markdown reports by matching cited tweet IDs, while requiring future reports to emit corresponding level-3 headings directly.

## 0.8.21 - 2026-07-18

### Fixed

- Preserve Chinese and other IME composition text in both Discuss inputs, syncing the URL only after the candidate text is committed.

## 0.8.20 - 2026-07-18

### Fixed

- Restore the Today digest's structured key-topic headings and summaries, including cached reports whose generated Markdown omits headings.
- Require future Today reports to use Markdown section headings and concise bold topic labels.

## 0.8.19 - 2026-07-18

### Fixed

- Hydrate original authors in reposts from bird raw user data, with a bounded `user-tweets` fallback for non-followed accounts and failed following-list lookups, so reposted posts render real avatars.

## 0.8.18 - 2026-06-30

### Fixed

- Hydrate Home timeline author profiles from bird profile/following data so newly followed accounts render real avatars instead of blank initials-only placeholders.

## 0.8.17 - 2026-06-29

### Added

- Add a global Settings page control for Profile Analyse sources: Local, XURL refresh, and 6551 refresh.
- Make Profile Analyse default to local archived tweets and replies for both the Analyse page and profile routes, with xurl kept as an explicit refresh source.

## 0.8.16 - 2026-06-29

### Fixed

- Keep ordinary Markdown title links in the Today digest body at the normal text color instead of the blue accent link color.

## 0.8.15 - 2026-06-29

### Fixed

- Keep Today digest citation links scoped to `source` labels so cited body text no longer turns blue.

## 0.8.14 - 2026-06-28

### Changed

- Replace the Home timeline auto-refresh minute input with fixed hourly choices from 1 to 24 hours, migrate legacy minute settings to at least 1 hour, and verify scheduled syncs refresh local timeline data.

## 0.8.13 - 2026-06-28

### Fixed

- Make the Home timeline `open` reply pill a real external link to the original X post, including hover/focus feedback.

## 0.8.12 - 2026-06-27

### Fixed

- Keep Home timeline auto-refresh timers on schedule across page rerenders, show a compact next-run status, and group the refresh controls into one toolbar.
- Restore the active Today digest period segment to the accent blue background with white text even when Tailwind utility order would otherwise keep the inactive transparent style.

## 0.8.11 - 2026-06-27

### Fixed

- Keep custom page numbers in exported Today digest PDFs while suppressing browser date and URL print chrome.

## 0.8.10 - 2026-06-27

### Fixed

- Route Today/digest and inbox OpenAI requests through `OPENAI_BASE_URL` again so local OpenAI-compatible gateways work.
- Redact OpenAI API keys from surfaced HTTP error messages.

## 0.8.9 - 2026-06-27

### Added

- Restore the Home timeline auto-refresh controls with a persisted custom minute interval next to `Sync timeline`.

## 0.8.8 - 2026-06-27

### Added

- Reload already-open local web tabs when the source-served 3001 app is rebuilt from a newer `Gatsby1s/birdclaw` commit.

## 0.8.7 - 2026-06-27

### Changed

- Point repository metadata, documentation links, docs-site links, backup examples, and request user-agent URLs at `Gatsby1s/birdclaw`.
- Restrict the Homebrew tap updater to manual dispatch for the `Gatsby1s` fork instead of firing automatically on every release.

## 0.8.6 - 2026-06-27

### Added

- Add a Home filter for replies to other accounts, including query/read-model support and route coverage.
- Add PDF export for digest summaries.

### Fixed

- Show full tweet text in Today citation popovers instead of truncating long posts after six lines.
- Show inline tweet images in Today citation popovers instead of leaving media-only `t.co` links in the preview text.
- Hydrate quoted and retweeted tweets so embedded timeline cards render the referenced post content.
- Keep yesterday digest cache lookups from reusing the wrong period summary.
- Normalize tweet timestamps before sorting timelines.

## 0.8.5 - 2026-06-21

### Fixed

- Keep large Likes, Bookmarks, and Today digest reads on indexed tweet lookups instead of blocking the web server with quadratic SQLite scans.
- Normalize legacy tweet URL entities at the API boundary so saved and quoted tweets remain readable without expanded-link metadata.

## 0.8.4 - 2026-06-19

### Changed

- Ship compiled CLI and production SSR/static artifacts, remove runtime TypeScript and Vite requirements, and validate installed npm tarballs end to end.
- Normalize tweet ownership and saved state into account edges and collections, add transactional schema migrations, and preserve older databases and backups through boundary adapters.
- Consolidate API schemas, NDJSON clients, React Query caches, profile codecs, moderation state, scheduled jobs, and live pagination while deleting superseded runtime paths.
- Split archive import, portable backup codecs, and CLI command registration into domain-owned modules with shared contract tests.
- Refresh runtime and development dependencies and resolve esbuild 0.28.1, clearing the active dependency advisory.
- Rank link insights with a lightweight first pass and hydrate only the requested top groups, substantially reducing all-time Links latency.

### Fixed

- Preserve backup JSONL rows containing Unicode line or paragraph separators during export and import. (#62 - thanks @uwe-schwarz)
- Derive unauthenticated local API access from the production server peer socket so spoofed host headers cannot bypass remote-access controls.
- Normalize legacy stored media types at the API boundary so older archives and backups remain readable through typed response contracts.

## 0.8.3 - 2026-06-15

### Changed

- Centralize SQLite writes and migrations, unify live-sync ingestion, and move retained web server state to TanStack Query for faster sidebar navigation and fewer duplicate reads.
- Isolate web reads onto query-only SQLite connections while serializing action and sync writes through one measured writer queue.
- Share page caps, cursor progression, delays, and repeated-cursor protection across live timeline, DM, and follow-graph sync.
- Stream archive arrays and backup JSONL records through resumable batches instead of buffering entire source files.
- Split query access into typed timeline, DM, status, resource, and action modules while retaining the existing compatibility import.
- Retain Blocks, Inbox, Data Sources, and Rate Limits server state in TanStack Query across sidebar navigation and targeted refreshes.
- Split compose, inbox, follow-graph, database, and backup CLI registration into domain-owned command modules.

### Fixed

- Preload hover-preview avatars after page load so citation and profile cards open with cached thumbnails.

## 0.8.2 - 2026-06-15

### Fixed

- Wait for concurrent SQLite writers before starting write transactions and avoid unnecessary legacy backfill writes during normal startup.
- Retain timeline and DM data across sidebar navigation, deduplicate status reads, debounce searches, skip unused Spotlight archive scans in web status, and remove TanStack debug controls.
- Keep tweet and profile hover previews outside wrapped links, flip them to the roomier vertical side, and constrain them to the viewport.
- Expand Twitter Articles into titled preview cards and citation popovers instead of showing bare `t.co` links.

## 0.8.1 - 2026-06-13

### Changed

- Refresh dependency backstop updates for `@steipete/sweet-cookie`, `@types/node`, the adopted TypeScript native-preview toolchain, and the pnpm 10 package-manager pin.
- Remove the separate public read-only web profile; deployments can expose the full private app behind an external authentication boundary.
- Show recent web timestamps as live relative time, then switch to calendar dates with exact local time on hover.

### Fixed

- Open long-running AI streams immediately, keep the Today digest within proxy limits by using the locally synchronized archive, and show actionable retry errors when a connection is interrupted.
- Reuse freshly generated Today reports across reloads while background sync updates the archive, and hydrate locally stored cited tweets so source hovercards remain available outside the selected time window.

## 0.8.0 - 2026-06-10

### Added

- Add localized Today/digest reports through `--language <locale-id>`, `BIRDCLAW_DIGEST_LANGUAGE`, and the period-digest API, with canonical locale validation and separate caches. (#47 - thanks @yujiawei)

### Changed

- Update runtime and development dependencies, align TanStack Start packages, and move pnpm's native build allowlist into workspace configuration.

### Fixed

- Add accurate archive-first Sign in and archive-request onboarding, including account-binding requirements, current xurl/bird setup, scoped transport selection, and clean autolink rendering. (#46 - thanks @peetzweg)
- Respect `OPENAI_BASE_URL` when sending Today/digest requests to OpenAI-compatible API endpoints.
- Anchor Link Insights' Today range to UTC midnight so it matches stored `created_at` timestamps across local time zones.

## 0.7.0 - 2026-06-01

### Added

- Stream live `birdclaw import archive` progress to stderr: per-slice parsing ticks (tweets, DMs, likes, bookmarks, follows, media) and chunked write-phase progress every 1,000 rows for profiles, tweets, likes+bookmarks, and DM messages. `--json` still keeps stdout clean for scripting.
- Add `birdclaw discuss <query>` and a Discuss web view for live keyword search via `bird`/`xurl`, persisted search-result tweets, and streaming OpenAI summaries with optional private DM context.
- Add `birdclaw profile-analyze <handle>` plus a Profile Analyse web view that backfills profile timelines and conversation context through `xurl`, caches the fetched context and AI result in SQLite, and exposes Analyse actions on tweet cards.
- Add canonical `/profiles/:handle` pages with profile headers and cached Profile Analyse output.
- Add a Rate Limits web view for observed `xurl` profile-analysis calls, 429s, local throttle settings, and documented X API recent-search windows.
- Add a Network Map web view for current followers/following, with SQLite geocode caching, OpenCage refreshes, Mapbox rendering, and a local fallback map.
- Render Network Map clusters as avatar stacks with relationship-weighted rings and avatar-rich profile/cluster overlays.
- Make the Network Map people list follow the current viewport with an in-view search panel.
- Add a Data Sources web view showing Birdclaw, bird, and xurl health, authenticated accounts, and automatic fallback order.
- Prefetch cached avatars for Discuss hover citations so source previews avoid fallback initials once profile metadata includes an avatar URL.
- Refresh Today digests from live `xurl` home timelines, mentions, and mention conversations before AI analysis so reports see more current context and reply parents.

### Changed

- Let Today and Discuss fetch much deeper live `xurl` data for the selected time window while keeping the AI prompt constrained to a large model-context budget.

### Fixed

- Implement `birdclaw auth use <auto|bird|xurl>` so the documented command persists the preferred moderation action transport. (#45 - thanks @peetzweg)
- Keep `birdclaw init` alive when the macOS Downloads scan is blocked, falling back to the other archive discovery paths. (#44 - thanks @peetzweg)
- Show live Today fetch progress while Birdclaw pulls X home timeline, mentions, and reply context before the first AI tokens arrive.
- Include live fetch counts and page/thread progress in Today status messages before AI summary streaming begins.
- Recover live `xurl` sync when the valid OAuth token is stored under a different local xurl username label than the Birdclaw account handle.
- Keep Profile Analyse citation hover cards linked to real tweet/avatar sources, throttle `xurl` conversation searches, and retry 429s before continuing AI summaries with partial context.
- Open `/profiles/:handle` analysis streams immediately, use same-origin profile fetches, and let `BIRDCLAW_PROFILE_ANALYSIS_ACCOUNT` select the xurl account used for profile backfills.
- Keep Profile Analyse headers from slicing through loaded avatars/names and turn unresolved numeric tweet citations into safe X source links without leaking raw IDs.
- Group adjacent Profile Analyse tweet citations so cached AI reports show numbered source links instead of repeated generic `source` labels.
- Highlight hydrated Profile Analyse `@handle` mentions with profile previews and link multi-source citations to readable clauses when possible.
- Hydrate Profile Analyse header bio `@handle` mentions as soon as the profile context loads, so affiliation-style bios show profile hover previews.
- Flip tweet and profile hover previews above their trigger when there is not enough room below.
- Show expanded URLs instead of `t.co` shortlinks in tweet citation hover previews whenever tweet URL entities are available.
- Show expanded URLs instead of `t.co` shortlinks in Profile Analyse account bios when X description URL entities are available.
- Keep emoji-bearing profile bios and media tweets aligned with X entity ranges, and route `@handle` profile-preview links to internal `/profiles/:handle` analysis pages.
- Make Discuss search source/mode controls look like dropdowns in one row, raise live tweet search depth to 20,000 results / 200 pages, combine bird plus xurl in auto mode, and include matching local timeline/saved tweets in Live search discussions.
- Default Discuss live mode to xurl now that OAuth2 search is authorized.
- Use the default authorized xurl OAuth2 user for Discuss/Profile Analyse recent-search reads instead of the selected Birdclaw account handle.
- Keep Discuss/Profile Analyse recent-search reads from inheriting `BIRDCLAW_XURL_OAUTH2_*` overrides, so account-scoped xurl settings do not force stale app/user auth into global search calls.
- Let normal Discuss web searches reuse cached AI discussions while keeping the Refresh button as the explicit forced-refresh path.
- Keep Discuss Live search scoped to live/search-result tweets instead of sweeping every local timeline bucket before AI streaming starts.
- Link unresolved model-emitted `tweet_<id>` citations in AI reports to X source URLs instead of showing raw citation tokens.
- Tighten AI report line height and first-block spacing in Today and Discuss.
- Keep Network Map profile positions anchored to exact geocoded locations and render dense areas through smarter avatar clusters instead of random scatter.
- Ignore stale configured OAuth2 xurl account overrides for Profile Analyse user lookup and profile timeline reads.

## 0.6.0 - 2026-05-22

### Added

- Add `birdclaw dms sync/list --mode xurl|auto` for recent OAuth2 DM event imports through `xurl`, with bird fallback in auto mode.
- Add an explicit Messages sort toggle for newest conversations or sender follower count.
- Add web DM inbox controls for switching between all, accepted, and message-request conversations.
- Render the `What happened` AI digest as a structured day overview with summary cards, signal topics, highlight tweets, links, people, and hover previews for cited tweet ids and `@handle` mentions.
- Add a streaming `What happened` AI digest in the web UI and CLI (`birdclaw today`, `birdclaw digest`) backed by OpenAI Responses API, GPT-5.5 by default, medium reasoning, priority service tier, local context hashing, and cached final structured results.
- Add a global web account switcher plus `jobs sync-account`/`install-account-launchd` so multi-account Birdclaw installs can refresh home, mentions, likes, bookmarks, and DMs from launchd.

### Changed

- Stream the Today report as one longer Markdown brief with inline hoverable tweet citations instead of adding separate overview and action cards after the model finishes.
- Increase the default Today digest tweet context and accept larger web digest requests so 24-hour reports can see deeper into the local archive.
- Start the Effect rewrite by making `effect` a first-class runtime dependency and moving web API fetches, web sync orchestration, live command helpers, action transport, `bird`/`xurl` JSON/action transports and public adapters, backup export/import/validation and Git orchestration, moderation target resolution, blocks/mutes write helpers, remote block sync, batch blocklist imports, x-web mutations, authored/mentions/mention-thread sync including xurl recent-search and parent-walk fallback internals, conversation loading, home timeline, saved collection, DM live sync, profile hydration/resolution/affiliation/reply inspection, shared tweet lookup, research and whois report generation, follow graph live sync, link preview/index fetches, archive discovery/import subprocesses, avatar/URL caches, OpenAI/inbox scoring, scheduled bookmark sync locking/audit/launchd install, and media-fetch archive reuse/download concurrency onto Effect programs with Promise-compatible public wrappers.

### Fixed

- Deduplicate unscoped timeline rows across accounts so Home does not show the same tweet twice when multiple accounts saw it.
- Render model-emitted Markdown links even when the model inserts a space or line break between the link label and URL.
- Close Today tweet hover previews when opening their source links so command-clicked citations cannot leave stale preview cards stacked on later hovers.
- Keep the Messages shell aligned with the rest of the app while collapsing the sidebar labels, and label optional follower/score DM filters instead of showing default `0` fields.
- Link grouped AI digest tweet citations to nearby readable text instead of showing raw `tweet_...` IDs.
- Expand the Messages web layout into an icon-rail workspace so the DM list and thread panes no longer squeeze into the standard feed width.
- Show DM message requests across accounts instead of filtering them by the active sidebar account.
- Verify the live `bird` account before DM sync, preserve stable account IDs for sparse DM payloads, and pace request-page imports.
- Align DM profile stat labels and values consistently in the web detail panel.
- Keep outbound DM bubble text readable by separating inbound and outbound bubble color classes in the web UI.
- Link AI digest tweet citations on readable text instead of leaking raw `tweet_...` ids when the model cites a local tweet by prefixed id.
- Hydrate profile metadata for Today highlight tweets so real avatar images replace fallback initials after cached digest results render.
- Allow trusted private-proxy web deployments to stream the AI digest remotely without a token, while keeping app-level token enforcement when configured and surfacing API error details in the Today view.
- Harden web write/quota endpoints, URL/avatar fetching, backup imports, archive replacement imports, block sync pruning, and GitHub workflows based on a deepsec security pass.
- Validate compose, tweet-reply, and DM-reply writes before live transport, reject failed xurl sends without leaving local ghost entries, and keep failed web reply drafts visible with the transport error.
- Keep account-scoped manual sync buttons disabled until account metadata loads so saved timelines do not submit accountless collection syncs.
- Cancel failed link preview response bodies promptly so repeated broken preview fetches do not leave sockets open until timeout.
- Harden link preview metadata fetching against private-network redirects, DNS rebinding, oversized or compressed responses, and slow/broken multi-address hosts.
- Link raw `@handle` mentions in archived timeline text and render retweets as embedded original tweets with compact repost attribution.
- Remove the duplicate inline sync account picker now that the global web account switcher controls manual sync account state, and move the theme toggle out of the sidebar footer so the account switcher stays anchored at the bottom.
- Move the one-button theme toggle above the sidebar account picker so the bottom controls align with the active-account avatar.
- Hide unresolved `t.co` placeholders and duplicate preview cards on media tweets, and let single-image media render in a natural image-sized frame.
- Render reposts as native timeline rows with the original author avatar and a single compact repost attribution.
- Hide empty bookmark, media, and account metadata from timeline action rows so the footer only shows useful state.
- Move the theme toggle into the sidebar account footer row so it sits with the active-account controls.

## 0.5.1 - 2026-05-15

### Fixed

- Harden the published CLI wrapper and release checks so the packaged `birdclaw` binary avoids `tsx` CLI IPC startup and stays covered by lint, format, and smoke tests.
- Forward shutdown signals through the published CLI and bundled web server, and include referenced script helpers in npm packages.
- Keep the selected DM conversation visible while its thread refreshes so the reply composer no longer flashes away mid-action.
- Send the selected web account through manual sync controls so multi-account timelines sync the intended profile.
- Run web sync requests as background jobs with status polling so the UI no longer holds one blocking sync request open.
- Add typed web API fetch handling and explicit DMs loading/error/empty states so failed local reads surface cleanly.
- Add explicit web app sync controls for home timeline, mentions, likes, bookmarks, and DMs so fresh live data can be pulled without leaving the UI.
- Refine the web app sidebar tagline and theme selector so the brand chrome reads more clearly in compact layouts.
- Add shared web feed loading/error/empty states with timeline-shaped skeleton rows and move conversation expansion into a cached single-thread surface with hover prefetch.
- Use the Birdclaw crab-bird mark in the web app chrome, loading states, and empty states; soften dark-mode contrast and replace text-only reply warnings with conversation/replied indicators.
- Allow the local web app to respond when Tailscale Serve forwards requests through the `clawmac.sheep-coho.ts.net` hostname.
- Speed up the default home timeline load on large local databases and keep malformed archived media URL entities from crashing the web timeline.
- Preserve tweet media aspect ratios, open timeline media in an inline viewer, and suppress duplicate media URL cards.

## 0.5.0 - 2026-05-15

### Added

- Add `birdclaw import archive --select` for importing targeted archive slices while preserving unselected local data.
- Add `birdclaw sync authored` for filling own-tweet gaps from `xurl` after the archive cutoff. Thanks @cavit99.
- Add live `sync mentions` and `sync mention-threads --mode xurl` ingestion for current mention data and conversation context. Thanks @cavit99.
- Add `birdclaw media fetch` plus archive bundled-media extraction and live media variant persistence for local originals caching. Thanks @cavit99.
- Add a `/links` web lane for Hacker News-style top URL and video-provider insights with today, week, month, year, and all-time ranges.
- Import archive `follower.js`/`following.js` files into the local follow graph and add archive-authored tweet edges so fresh archive imports are immediately queryable without live sync. Thanks @cavit99.
- Add cache-first followers/following sync, local follow graph queries, and backup/export support for graph snapshots and churn events. Thanks @ma08.
- Hydrate missing link-discussion profile avatars through `bird`/`xurl` so hover sheets can upgrade archive placeholders into real profile cards.
- Add inline tweet conversation expansion in the web timeline, preserving the selected reply's parent chain before broad thread context.

### Changed

- Update npm dependencies, including React, Vite, Vitest, Playwright, Tailwind, Kysely, TanStack packages, oxlint, and oxfmt.

### Fixed

- Seed demo link insight data before direct `/links` route loads, so the lane is populated even when it is the first web route opened.
- Isolate the default `bird` command config test from the maintainer's local `~/.birdclaw/config.json`.
- Skip non-numeric archive placeholder IDs such as self-DM conversation IDs when hydrating profiles through X, so one malformed local ID no longer aborts the batch. Thanks @nfarina.
- Include expanded short URLs and link occurrences in Git-friendly backups so linked-tweet search survives backup restore.
- Prefer `bird` for follow graph sync in `auto` mode, keeping `xurl` as an explicit fallback for accounts where OAuth2 follow reads work.
- Update the docs site and app icons to use the Birdclaw crab-bird mark instead of the generic bird logo.

## 0.4.1 - 2026-05-11

### Added

- Add a first-class short-link index for `t.co` URLs, including `links backfill` and `search links` so DM shares can be found through expanded tweet text, authors, dates, and media filters.

## 0.4.0 - 2026-05-09

### Added

- Preserve richer X profile metadata during `bird`/`xurl` profile hydration, including profile URLs, profile URL entities, locations, verification type, raw profile JSON, and X affiliation/highlighted-label metadata.
- Add first-class `profile_affiliations` storage, backup/export/import support, and `whois --json` `profileEvidence` so identity lookups can explain whether a match came from bio text, profile URLs, affiliation badges, DM context, or expanded links.
- Add profile-change snapshots for hydrated profiles, preserving prior bio/profile URL/location/verification/affiliation states so identity searches can surface current and previous affiliation evidence.
- Add first-class bio entity extraction for profile bios and profile URLs, including `@handle`, domain, and company-phrase evidence used by fuzzy identity searches such as `whois "blacksmith guy"`.
- Add a derived `identity_search_index` and `whois` filters for affiliation-oriented identity lookups: `--affiliation`, `--current-affiliation`, and `--exclude-domain-only`.

### Changed

- Use Node's native `node:sqlite` runtime instead of `better-sqlite3`, removing the native npm dependency while preserving the existing synchronous SQLite API surface.
- Allow Node 26.x in the package engine range and update install docs for the native SQLite runtime.
- Improve DM `whois` ranking with Sweetistics-style profile evidence scoring: profile URLs and affiliation badges now boost relevant candidates, while cached profile and URL lookups still avoid repeated API/network work.
- Resolve synthetic X highlighted-label organization badges into real local organization profile ids when `bird` can hydrate the org handle.
- Rank current affiliation and bio identity evidence above plain profile domains in `whois`, group human output into ambiguity buckets, and explain "why this person?" with the strongest typed evidence first.
- Use `bird profiles --json` for batch profile hydration when available, falling back to single-profile `bird user --profile-only --json`.

## 0.3.0 - 2026-05-05

### Added

- Add research mode for turning bookmarked Twitter threads into Markdown briefs, with shared `xurl`/`bird` tweet lookup fallback for thread expansion. Thanks @anupamchugh.
- Add live home timeline and mention-thread sync commands so local triage can pull current `bird` context into the SQLite store.
- Add search snippets for tweet and DM results, including deterministic DM snippets when multiple messages in a conversation match. Thanks @mvanhorn.
- Add `--min-likes` and `--quality-reason` controls for tweet search quality filtering. Thanks @mvanhorn.
- Store Twitter following counts on profiles and include them in JSONL backups.

### Changed

- Use the native TypeScript preview compiler for the `typecheck` script.
- Refresh TypeScript and related development dependencies.

### Fixed

- Use the existing Twitter web cookie fallback as the final `auto` transport for block and unblock actions. Thanks @pejmanjohn.
- Resolve the `bird` transport from `PATH` before falling back to the local development checkout. Thanks @vyctorbrzezowski.
- Stabilize the presenter timestamp test across local time zones. Thanks @pejmanjohn.
- Clean up the DMs route render test so CI does not leave React work running after jsdom teardown.
- Allow Playwright e2e runs to use an alternate local port when `3000` is already occupied.
- Replace maintainer-local documentation links with repo-relative links and align the setup docs with the Node version file. Thanks @stainlu.

## Unreleased

### Fixed

- Fix live `xurl` status detection when the CLI is installed but not authenticated; thanks @kyupark.
- Default local `bird` integration to `bird` on PATH and report stale configured command paths with setup guidance.

## 0.2.1 - 2026-04-27

### Changed

- Use Twitter wording in public descriptions, docs, CLI help, and release notes.

## 0.2.0 - 2026-04-27

### Added

- Add live likes and bookmarks sync through `xurl`/`bird`, local search filters, archive import support, and dedicated Likes/Bookmarks web views.
- Add Git-friendly JSONL backup sync, export, import, validation, and stale-aware auto-sync for rebuilding or merging the local SQLite store from text shards across machines.
- Add a scheduled bookmark sync job with launchd installation, JSONL audit logging, overlap locking, and automatic Git backup sync after each refresh.
- Add launchd env-file support so scheduled bookmark sync can source `bird` credentials without storing secrets in the plist.

### Changed

- Update the README tagline and package description for local Twitter memory across archives, DMs, likes, bookmarks, and moderation.
- Refresh dependencies, including `jsdom` 29.1.0.
- Hide reply state and reply actions in saved likes/bookmarks web lanes.
- Shard backup DMs by year and route unknown tweet dates to `data/tweets/unknown.jsonl` so Git backups stay compact and avoid bogus 1970 files.
- Speed up archive imports plus JSONL backup export, import, and validation for large local datasets.

### Fixed

- Fix live bookmark sync to use stored Twitter user ids, force OAuth2 for `xurl` collection reads, and tolerate large/current `bird` bookmark payloads.
- Fix fresh-machine backup sync so demo data is never exported into Git backups, and keep no-op syncs from creating metadata-only commits.

## 0.1.1 - 2026-04-27

### Added

- Add opt-in low-quality timeline filtering for year-scale tweet review, including date windows, originals-only mode, and CLI/API flags for hiding retweets, tiny replies, and link-only noise.

### Fixed

- Fix fresh npm installs so the packaged `birdclaw` binary includes its TypeScript runtime dependency.

## 0.1.0 - 2026-04-27

### Added

- Add Twitter web cookie fallback for block and unblock actions when the Twitter API rejects OAuth2 block writes.
- Add `profiles replies` so moderation triage can inspect a user's recent reply pattern before blocking.
- Add `blocks import <path>` for one-shot blocklist application from a file.
- Add paged `mentions export --mode xurl --all --max-pages <n>` so moderation loops can scan the full retrievable mentions window.
- Add `actions.transport` config plus shared action transport routing for `bird`, `xurl`, and `auto`.
- Add transport-aware mute/unmute support to the API action route.
- Add the first packaged `birdclaw` CLI release.

### Fixed

- Capture `xurl` mutation error bodies so transport fallbacks can key off the real API failure.
- Make `birdclaw` block and unblock flows succeed remotely again on Peter's current auth setup.
- Verify forced `xurl` mute/block writes through `bird status` before mutating local sqlite.
- Cache authenticated `xurl whoami` lookups so repeated moderation writes do less redundant auth work.
- Strip inherited `--localstorage-file` from the Playwright web-server env to avoid noisy cross-repo test warnings.
- Override Node 25 native web storage in jsdom test setup so Vitest runs stop emitting `--localstorage-file` warnings.

### Docs

- Document block transport behavior and fallback path in the CLI/docs.
- Document the reply-pattern inspection flow for borderline AI/slop accounts.
- Document blocklist import file format and usage.
- Document paged xurl mention export for agent moderation runs.
- Document that mention reads and moderation writes use separate config knobs.
