import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  boolean,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/**
 * app_settings — admin-configurable key-value settings store.
 * Keys are stable string identifiers; value is a text column (JSON-encoded
 * for complex values, plain string for simple ones). updatedAt tracks when
 * each setting was last changed.
 *
 * Known keys (see lib/settings/index.ts for typed accessors):
 *   video_proxy_url   — base URL for the video reverse proxy
 *   agent_reach_url   — base URL for the upstream Agent Reach API
 *   agent_reach_pwd   — password for the Agent Reach API
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * content_items — mirrored or original article content.
 * Per PRD §7 data model and Research §5 schema design.
 *
 * type='article' rows are self-authored posts (Markdown in `body`) and use the
 * article-only columns below. They are reachable at the public /p/<slug> URL
 * instead of the mirror's /s/<token> share link, so `slug` is their identity:
 * unique where present, null for mirrors (a partial unique index, since
 * Postgres treats NULLs as distinct in a plain unique index anyway).
 */
export const contentItems = pgTable(
  'content_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type'), // 'mirror' | 'article'
    sourceUrl: text('source_url'),
    platform: text('platform'),
    title: text('title').notNull(),
    author: jsonb('author').notNull(),
    publishedAt: timestamp('published_at'),
    body: text('body').notNull(),
    stats: jsonb('stats'),
    platformData: jsonb('platform_data'),
    fetchedAt: timestamp('fetched_at'),
    refreshedAt: timestamp('refreshed_at'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    // ── article-only columns (null for mirrors) ──
    slug: text('slug'), // public URL segment, /p/<slug>
    status: text('status'), // 'draft' | 'published'
    excerpt: text('excerpt'), // list-page summary; auto-derived from body when blank
    coverImageUrl: text('cover_image_url'), // permanent Blob URL (presigned at render)
    updatedAt: timestamp('updated_at'),
    commentsEnabled: boolean('comments_enabled').notNull().default(true),
    // Whether the article appears on the public archive. False keeps it fully
    // readable at its own URL but off the index — for a post meant to be
    // shared by link rather than browsed to.
    listed: boolean('listed').notNull().default(true),
    // Password gate. Applies to articles and mirrors alike:
    //   'none'    — open (default, and what every existing row means)
    //   'inherit' — use the site-wide password from app_settings
    //   'custom'  — use passwordHash below
    // Null is read as 'none' so historical rows need no backfill.
    passwordMode: text('password_mode'),
    passwordHash: text('password_hash'),
    // How the cover renders: 'above' (default, a band under the header) or
    // 'hero' (behind the title block, under a scrim). Null reads as 'above'.
    coverStyle: text('cover_style'),
  },
  (table) => ({
    slugIdx: uniqueIndex('content_items_slug_unique').on(table.slug),
    typeStatusIdx: index('content_items_type_status_idx').on(table.type, table.status),
  }),
);

/**
 * media — images and videos attached to a content item.
 */
export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  contentItemId: uuid('content_item_id')
    .notNull()
    .references(() => contentItems.id),
  type: text('type'), // 'image' | 'video'
  originalUrl: text('original_url').notNull(),
  blobUrl: text('blob_url'),
  size: integer('size'),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * comments — platform-native comments on a content item.
 */
export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  contentItemId: uuid('content_item_id')
    .notNull()
    .references(() => contentItems.id),
  platformCommentId: text('platform_comment_id'),
  author: jsonb('author').notNull(),
  text: text('text').notNull(),
  postedAt: timestamp('posted_at'),
  likes: integer('likes').default(0),
  retained: boolean('retained').notNull().default(true), // D-27: all stored, retained flag
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * article_comments — visitor-submitted comments on self-authored articles.
 *
 * Deliberately NOT the `comments` table: that one holds platform-native
 * comments scraped for a mirror (author is a jsonb platform profile, retention
 * is an editorial choice). These are anonymous submissions from the open web
 * and need moderation, rate-limit and abuse columns the mirror flow has no use
 * for. Keeping them apart keeps the mirror's CommentList query untouched.
 *
 * `status` is 'visible' by default (the admin chose display-immediately with a
 * human check, not review-before-publish) and flips to 'hidden' when the admin
 * moderates a comment away. `authorEmail` is optional and never rendered.
 * `ipHash` is a keyed hash — used for the per-IP rate limit, not identity.
 *
 * FK ON DELETE CASCADE: comments are meaningless without the article.
 */
export const articleComments = pgTable(
  'article_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    authorName: text('author_name').notNull(),
    authorEmail: text('author_email'), // optional, never displayed publicly
    body: text('body').notNull(),
    status: text('status').notNull().default('visible'), // 'visible' | 'hidden'
    ipHash: text('ip_hash'), // keyed SHA-256, for rate limiting only
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    contentItemIdx: index('article_comments_content_item_idx').on(
      table.contentItemId,
      table.createdAt,
    ),
    ipHashIdx: index('article_comments_ip_hash_idx').on(table.ipHash, table.createdAt),
  }),
);

// ─── Auth.js tables (@auth/drizzle-adapter PostgreSQL) ────
// D-23: database users table + bcrypt + database session strategy.
// JS property names match @auth/drizzle-adapter expectations; DB column
// names follow the project snake_case convention. All PKs/FKs are uuid
// to stay consistent with the existing schema (PATTERNS Open Q1 resolved:
// pass these four tables explicitly to DrizzleAdapter so the adapter does
// not fall back to its text-id default schema).

/**
 * users — admin accounts. Project extends adapter schema with
 * username (unique login identifier) and passwordHash (bcrypt).
 * Created empty; first admin inserted by 03-03 login-page setup (D-28).
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  email: text('email'),
  emailVerified: timestamp('email_verified'),
  image: text('image'),
});

/**
 * accounts — OAuth link records. OAuth not used yet but the adapter
 * requires the table to exist. Composite PK on (provider, providerAccountId).
 */
export const accounts = pgTable(
  'account',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => ({
    compoundKey: primaryKey({ columns: [account.provider, account.providerAccountId] }),
  }),
);

/**
 * sessions — database strategy session persistence (D-23).
 * sessionToken is the cookie value (Pitfall 1 workaround stores it directly).
 */
export const sessions = pgTable('session', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires').notNull(),
});

/**
 * verificationTokens — email magic-link tokens. Not used yet but the
 * adapter requires the table to exist. Composite PK on (identifier, token).
 */
export const verificationTokens = pgTable(
  'verification_token',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires').notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);

/**
 * shares — share links for content items (Phase 4, D-29/D-31/D-35/D-38).
 *
 * One content item may have many share links (D-31 one-to-many:
 * contentItemId is NOT unique). token is plaintext nanoid 21 chars
 * (D-33/D-35) with a unique index for O(log n) visitor-page lookup.
 * status defaults to 'active'; Phase 5 adds expired/revoked/burned
 * transitions (D-38) — the column is预留 here so no migration is
 * needed when state flow arrives.
 *
 * FK ON DELETE NO ACTION (matches media/comments): deleteMirror must
 * delete shares rows before the parent content_items row
 * (PATTERNS landmine #1).
 *
 * Phase 5 access control columns (D-50/D-51/D-52): expiresAt /
 * maxViews / maxUniqueVisitors are nullable (null = no limit);
 * burnAfterRead defaults false; viewCount / uniqueVisitorCount
 * default 0 and increment atomically via UPDATE...RETURNING.
 */
export const shares = pgTable(
  'shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: text('token').notNull(), // D-35: plaintext nanoid 21 chars
    contentItemId: uuid('content_item_id') // D-31: one-to-many, NOT unique
      .notNull()
      .references(() => contentItems.id),
    // D-38/D-52: 6-value enum — active|expired|revoked|burned|max_views|max_visitors
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    // Phase 5 access control (D-50): null = no limit
    expiresAt: timestamp('expires_at'), // SHRE-03: expiry timestamp
    maxViews: integer('max_views'), // SHRE-04: total view count limit
    maxUniqueVisitors: integer('max_unique_visitors'), // SHRE-05: unique visitor limit
    burnAfterRead: boolean('burn_after_read').notNull().default(false), // SHRE-07
    viewCount: integer('view_count').notNull().default(0), // atomic increment
    uniqueVisitorCount: integer('unique_visitor_count').notNull().default(0), // atomic increment
  },
  (table) => ({
    tokenIdx: uniqueIndex('shares_token_unique').on(table.token),
    contentItemIdx: index('shares_content_item_id_idx').on(table.contentItemId),
  }),
);

/**
 * share_visits — visit log for unique-visitor dedup (D-51, SHRE-05).
 *
 * Records every visit with both the visitor_id cookie and the client
 * IP. Dedup is cookie-first, IP-fallback (D-51). FK ON DELETE CASCADE
 * (unlike media/comments which use NO ACTION) — visit logs are
 * meaningless without the share, so they cascade on share deletion.
 */
export const shareVisits = pgTable(
  'share_visits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shareId: uuid('share_id')
      .notNull()
      .references(() => shares.id, { onDelete: 'cascade' }),
    visitorCookie: text('visitor_cookie').notNull(),
    visitorIp: text('visitor_ip').notNull(),
    visitedAt: timestamp('visited_at').defaultNow().notNull(),
  },
  (table) => ({
    shareIdIdx: index('share_visits_share_id_idx').on(table.shareId),
  }),
);

/**
 * mirror_versions — snapshot-based version history for mirror refresh (D-53).
 *
 * Each row is a complete content snapshot (contentItem + media[] + comments[])
 * stored as jsonb. A new version is created only on substantial change
 * (body/comments/media — NOT stats, Pitfall 5). At most 3 versions are
 * retained per mirror; oldest is pruned. Rollback = write the snapshot back
 * to content_items + media + comments.
 *
 * FK ON DELETE CASCADE — version history is meaningless without the mirror.
 * Unique index on (contentItemId, versionNumber) — no duplicate version
 * numbers per mirror. Regular index on contentItemId for the version list
 * query.
 */
export const mirrorVersions = pgTable(
  'mirror_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    contentItemVersionIdx: uniqueIndex('mirror_versions_content_item_version_unique')
      .on(table.contentItemId, table.versionNumber),
    contentItemIdx: index('mirror_versions_content_item_id_idx').on(table.contentItemId),
  }),
);

/**
 * refresh_previews — pending mirror refresh data for admin review (D-53 ext).
 *
 * When a re-fetch detects a substantial change, the new FetchedContent is stored
 * here (not yet applied to content_items). The admin reviews the diff on a
 * preview page, selects which comments to retain, then confirms apply or cancels.
 * Expired rows are cleaned up lazily; FK cascade removes them when the mirror is
 * deleted.
 */
export const refreshPreviews = pgTable(
  'refresh_previews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    content: jsonb('content').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').defaultNow().notNull(),
  },
  (table) => ({
    contentItemIdx: index('refresh_previews_content_item_id_idx').on(table.contentItemId),
    expiresAtIdx: index('refresh_previews_expires_at_idx').on(table.expiresAt),
  }),
);

/**
 * visit_events — behavior analytics atomic events (Phase 6, PRD §7).
 *
 * Event-level data (vs share_visits which is visit-level). Each row is one
 * tracked event: view, dwell (block enter/leave), media_click, outlink_click,
 * click, scroll, video. payload is jsonb with event-specific data.
 *
 * System-level analytics: events are keyed on content_item_id so both mirrors
 * (visited through a share) and articles (visited at /p/<slug>) are tracked.
 * share_id stays for mirror visits (nullable — articles have none), and
 * session_id ties an event to its analytics_sessions recording (no FK: events
 * may race the session upsert; they are correlated, not owned).
 *
 * FK ON DELETE CASCADE — events are meaningless without the content.
 * Composite indexes (content_item_id, ts) / (content_item_id, type) drive the
 * aggregation queries; the legacy share_id indexes remain for share drilldown.
 */
export const visitEvents = pgTable(
  'visit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contentItemId: uuid('content_item_id').references(() => contentItems.id, {
      onDelete: 'cascade',
    }),
    shareId: uuid('share_id').references(() => shares.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id'), // analytics_sessions.id (correlation, no FK)
    visitorId: text('visitor_id').notNull(), // visitor_id cookie value (anonymous)
    type: text('type').notNull(), // view | dwell | media_click | outlink_click | click | scroll | video
    payload: jsonb('payload').$type<VisitEventPayload>(),
    ts: timestamp('ts').defaultNow().notNull(),
    ua: text('ua'), // user agent string (nullable — may be large)
    ip: text('ip'), // real client IP (x-forwarded-for first hop)
  },
  (table) => ({
    shareTsIdx: index('visit_events_share_ts_idx').on(table.shareId, table.ts),
    shareTypeIdx: index('visit_events_share_type_idx').on(table.shareId, table.type),
    contentTsIdx: index('visit_events_content_ts_idx').on(table.contentItemId, table.ts),
    contentTypeIdx: index('visit_events_content_type_idx').on(table.contentItemId, table.type),
    sessionIdx: index('visit_events_session_idx').on(table.sessionId),
  }),
);

/**
 * analytics_sessions — one row per visitor page session (self-built analytics).
 *
 * A session is one open of a mirror/article page by one visitor. It carries
 * the device context (real IP, UA, screen + viewport size, DPR) and rolling
 * duration/event counters updated on every ingest batch. The rrweb recording
 * for the session lives in analytics_chunks; structured events reference the
 * session via visit_events.session_id.
 *
 * id is client-generated (crypto.randomUUID) so the recorder can batch lazily
 * without a round-trip; the ingest route upserts.
 */
export const analyticsSessions = pgTable(
  'analytics_sessions',
  {
    id: uuid('id').primaryKey(),
    contentItemId: uuid('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    shareId: uuid('share_id').references(() => shares.id, { onDelete: 'set null' }),
    visitorId: text('visitor_id').notNull(),
    ip: text('ip'),
    // Geo resolved from the IP via ip.sb at ingest (lib/analytics/geo.ts);
    // sessions sharing an IP reuse the first lookup's result.
    country: text('country'), // ISO code, e.g. 'CN'
    region: text('region'),
    city: text('city'),
    ua: text('ua'),
    // Visitor display context — the replay/heatmap canvas is sized from these.
    screenW: integer('screen_w'),
    screenH: integer('screen_h'),
    viewportW: integer('viewport_w'),
    viewportH: integer('viewport_h'),
    dpr: integer('dpr_x100'), // devicePixelRatio × 100 (integer column, 2 decimals)
    lang: text('lang'),
    referrer: text('referrer'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    lastEventAt: timestamp('last_event_at').defaultNow().notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    eventCount: integer('event_count').notNull().default(0),
    chunkCount: integer('chunk_count').notNull().default(0),
  },
  (table) => ({
    contentStartedIdx: index('analytics_sessions_content_started_idx').on(
      table.contentItemId,
      table.startedAt,
    ),
    startedIdx: index('analytics_sessions_started_idx').on(table.startedAt),
  }),
);

/**
 * analytics_chunks — ordered rrweb event batches for a session recording.
 *
 * The recorder flushes its rrweb buffer every few seconds; each flush is one
 * chunk (jsonb array of rrweb events, snapshot + incrementals). Replay =
 * concat chunks by seq. Unique (session_id, seq) makes client retries
 * idempotent (ON CONFLICT DO NOTHING).
 */
export const analyticsChunks = pgTable(
  'analytics_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => analyticsSessions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    events: jsonb('events').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    sessionSeqIdx: uniqueIndex('analytics_chunks_session_seq_unique').on(
      table.sessionId,
      table.seq,
    ),
  }),
);

/**
 * translation_cache — persistent DeepL translation cache (server-side).
 *
 * Key is SHA-256(source_text) truncated to 64 hex chars, scoped by
 * target_lang. Same source text reuses the same cache row regardless of
 * which comment or body paragraph it came from — maximises reuse.
 *
 * No foreign keys intentionally: the cache is content-agnostic and shared
 * across comments, body paragraphs, and any future translatable field.
 * Rows are never deleted (translations don't expire — the source text is
 * the stable key). Composite PK (text_hash, target_lang) enforces uniqueness.
 */
export const translationCache = pgTable(
  'translation_cache',
  {
    textHash: text('text_hash').notNull(),       // SHA-256 hex of source text (64 chars)
    targetLang: text('target_lang').notNull(),   // 'ZH', 'EN', etc.
    sourceText: text('source_text').notNull(),   // original text (for debugging / re-translate)
    translatedText: text('translated_text').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.textHash, table.targetLang] }),
  }),
);

// Payload type — discriminated by `type` field
export type VisitEventPayload = {
  // For 'view' events
  // (no payload needed — the event itself is the view)
  // For 'dwell' events
  blockId?: string; // 'body' | 'gallery' | 'video' | 'comments'
  dwellMs?: number; // accumulated dwell time in milliseconds
  // For 'media_click' events
  mediaId?: string; // media UUID
  mediaType?: string; // 'image' | 'video'
  // For 'outlink_click' events
  url?: string; // the clicked link URL
  linkContext?: string; // 'original_post' | 'in_body' | etc.
  // For 'click' events — page coordinates + document/viewport size at click
  // time, so the heatmap can normalise across screens.
  x?: number;
  y?: number;
  docW?: number;
  docH?: number;
  viewportW?: number;
  viewportH?: number;
  selector?: string; // short CSS-ish path of the clicked element
  text?: string; // trimmed innerText of the clicked element (≤80 chars)
  // For 'scroll' events — max depth reached, as page pixels + percentage
  scrollY?: number;
  depthPct?: number;
  // For 'video' events
  action?: string; // play | pause | seek | range | progress | fullscreen_enter | fullscreen_exit | ended | ratechange
  position?: number; // currentTime in seconds
  duration?: number; // video duration in seconds
  from?: number; // seek: origin; range: continuous-watch span start (seconds)
  to?: number; // seek: target; range: continuous-watch span end (seconds)
  pct?: number; // progress milestone (10/20/…/100)
};
