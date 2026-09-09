# Reach — Project Notes

## Build & Deploy

- **Build**: `npm run build` (Next.js 16 + Turbopack)
- **Deploy to Vercel**: `vercel build --prod && vercel deploy --prebuilt --prod`
- **Node runtime**: several `/api/*` routes require `export const runtime = 'nodejs'` because they rely on Node.js fetch streaming / S3 / PostgreSQL.

## Self-Authored Articles

The site publishes original articles alongside mirrors — see
`docs/article-publishing.md` for the full picture. Key facts for anyone touching
adjacent code:

- Articles live in `content_items` with `type='article'` and are reachable at
  the public `/p/<slug>` URL (no access control, no expiry) rather than the
  mirror's `/s/<token>`. Article-only columns (`slug`, `status`, `excerpt`,
  `cover_image_url`, `updated_at`, `comments_enabled`) are all nullable.
- **Any query over `content_items` now needs a type scope.** Use `isArticle` /
  `isNotArticle` from `lib/article/queries.ts`. `isNotArticle` deliberately
  keeps `type IS NULL` rows — early mirrors predate the column, and a bare
  `ne(type,'article')` silently drops them.
- Visitor comments go to `article_comments`, not `comments` (which stays the
  platform-scraped mirror table).
- The archive lives at `/post`; individual articles stay at `/p/<slug>` (a
  permanent redirect covers the old bare `/p`). Articles with `listed=false`
  are readable at their URL but excluded from the archive — use
  `listPublishedArticles(limit, includeUnlisted)` when that matters.
- Article slugs are random lowercase ASCII. They used to be derived from the
  title, which produced CJK slugs — and Next hands dynamic segments to the page
  **still percent-encoded**, so `测试1` arrived as `%E6%B5%8B%E8%AF%951`, missed
  the lookup, and the article 404'd while still listing on `/p`. `/p/[slug]`
  decodes params for that reason; don't remove it, older articles rely on it.
- Article media is uploaded browser → storage directly, never through a Route
  Handler (Vercel's ~4.5MB body cap). Videos need CORS on the R2/S3 bucket —
  the rule must include `AllowedHeaders: ["content-type"]`, or the preflight is
  rejected and every upload fails in the browser.
- Remote import ("从链接转存") is the only place a user-supplied hostname
  reaches the server's network stack. It must go through
  `lib/article/remote-fetch.ts`, which rejects non-http schemes and any host
  resolving to a private/loopback/link-local address, and re-validates every
  redirect hop. Do not swap it for a plain `fetch` with `redirect: 'follow'` —
  that validates only the first URL. The resolver walks up to 4 HTML pages
  (embedded media URL → meta-refresh/JS redirect → the AI fallback in
  `lib/article/ai-resolver.ts`, off by default); **anything the model returns is
  remote input and goes back through the same validation** before it is fetched.
- The transfer itself lives in `lib/article/remote-import.ts` and reports stages
  through a callback. `/api/article-import` streams those as NDJSON so the
  editor can show per-item progress; the `importRemoteMedia` Server Action calls
  the same function and just awaits the result. A stream that ends without a
  `done` event is a failure, not a success — that is what a Vercel function
  timeout looks like from the browser.
- `/api/article-media` is the single entry point for article media: it decides
  both access (public asset → open; otherwise a signed `?t=` token from the
  rendered page, or an admin session) and delivery (stream vs 302 to a
  presigned storage URL, per `article_media_direct`). Pages emit only that
  path — don't reintroduce URL rewriting on the page side.
- Direct delivery redirects to a **presigned** S3 GET, so the bucket does not
  need public read.
- The 「插入素材」 panel's 素材库 tab lists **every** article asset, not the open
  article's. That is the point: an asset uploaded into another article (or one
  whose article no longer references it) is otherwise unreachable. Nothing in
  the access path is scoped by owning article — `findGatedMediaIds` signs by
  media id and the route checks `shared`/token/session — so cross-article
  references render correctly. Don't add an owner check there without also
  killing this tab.
- Which assets are still in use is derived by scanning article text for
  `/api/article-media/<id>.<ext>`, not from a join table — the author edits
  Markdown freely and no API sees those edits. `lib/article/assets.ts` owns
  that; the cleanup path re-scans before deleting and skips uploads younger
  than 24h.
- Markdown bodies are rendered **without** raw HTML (no `rehype-raw`). Don't add
  it without a reason — it reopens the injection surface.
- Password gate (`lib/content/password.ts`) covers articles and mirrors: per-item
  mode none/inherit/custom, unlock scoped by password hash via an HMAC cookie.
  On mirrors it must run **before** `checkAccess`, which is what consumes a view
  and burns a one-shot link.
- `checkAccess` mutates (view count, burn); `peekAccess` is the read-only twin.
  Anything running per-request before the visitor sees the page — notably
  `generateMetadata` — must use peek, or it spends a view for the title alone.

## Video proxy health check

`probeVideoProxy` (`lib/health/checks.ts`) asks the proxy's own `/healthz` (then
`/health`) first, and only falls back to pulling one byte of the newest stored
video through it. The fallback alone used to be the whole check, and it reported
a healthy proxy as down whenever the sample URL had expired — a googlevideo
address lasts hours, so a healthy proxy showed HTTP 502 while working fine.

The probe appends `/healthz` to the configured base URL. A proxy configured
with a path prefix (e.g. `https://proxy.example.com/dl`) must therefore answer
at `/dl/healthz`, not just `/healthz`.

Only a **2xx** from the health path is taken as an answer. A proxy with no
health route treats `healthz` as the URL it was told to fetch and fails however
its upstream does (400/404/502/503, or a 200 HTML error page), and none of that
describes the proxy. So the health probe can only ever make the check more
permissive — do not "improve" it by trusting non-2xx statuses.

## Video Subtitles / Transcript

Subtitle flow for YouTube and X videos (implemented 2026-07):

- **Agent Reach (upstream service)** extracts the best subtitle track via yt-dlp and returns `transcript` + `transcript_lang` on the item. Priority: manual Chinese > native auto Chinese > manual English > auto English > native-language track for other languages. YouTube's auto-**translated** tracks (`automatic_captions` in non-native languages) are deliberately excluded — their quality is far below DeepL on the original text.
- For X, subtitle extraction only runs when the tweet media contains `video.twimg.com` (extra yt-dlp call, ~10s); most X videos have no track, in which case the fields are simply absent.
- The proxy also returns `transcript_vtt` — a normalized timed WEBVTT (headers/cue-ids/inline-tags stripped, rolling-duplicate lines removed) for in-player captions.
- **Reach app**: adapters store `transcript`/`transcriptLang`/`transcriptVtt` in `content_items.platform_data`. Rendering is **in-player CC captions only** (`VideoPlayer` + `subtitle-utils.ts`; a below-video transcript card was tried and removed by user preference): the VTT becomes a `<track>` via blob URL; Plyr gets a captions button (`captions: {active, language: 'zh', update: true}`). Non-Chinese tracks (by `transcriptLang`, CJK-heuristic fallback) are translated cue-by-cue via `/api/translate` (batches of 50, server-side DB cache) into a second "中文（翻译）" track that auto-activates when ready. The plain-text `transcript` field stays in platform_data (unused by UI, available for future search/summary).
- Mirrors fetched before subtitle support need one 「刷新字幕」 (admin mirror detail page) to backfill `transcriptVtt` — it updates only platform_data, no version snapshot.

## Video Playback — Stale Partial Cache

Browsers aggressively cache 206 Partial Content video responses. When the underlying video URL or blob changes (e.g., `refreshVideoUrl` generates a new googlevideo URL, or the lazy upload finishes), a cached partial response can become invalid, causing the player to appear stuck on "loading" while the actual proxy endpoint works fine when accessed with a no-cache refresh.

### Backend handling

- `/api/video-status` should not rely solely on a stored `proxyStatus` field; it should infer `ready`/`fresh` from the media row:
  - `blobUrl` present → `ready`
  - `fetchedAt` within the ~6h TTL → `fresh`
  - otherwise → recorded `proxyStatus` or `refreshing`
- `/api/proxy-video` upstream responses should include `Cache-Control: no-cache, must-revalidate` so stale partials are not served from disk cache without revalidation.

### Frontend handling

- The player should only auto-reload when the status transitions from a non-done state to a done state (`fresh`/`ready`), and it should append a cache-busting query parameter to avoid reusing the stale cached partial.
- Treating `hasStorage` as `done` in the client causes infinite reload loops when the cached partial is broken; the done decision should be based on the status itself, not on storage presence.

## Self-Built Analytics (session replay + heatmaps)

Vercel Web Analytics / Speed Insights were removed (2026-08). Analytics is now
fully self-built and system-level: mirrors (/s/<token>) and articles (/p/<slug>)
are both tracked, keyed on `content_item_id`.

### Data model

- **`visit_events`** — structured events: `view`, `dwell`, `media_click`,
  `media_play`, `outlink_click`, `click` (page coords + doc/viewport size, the
  heatmap source), `scroll` (max depth), `video` (play/pause/seek/progress
  deciles/fullscreen/ended/ratechange). Columns: `content_item_id` (system-level
  key), `share_id` (mirrors only), `session_id`, real `ip` (plus legacy
  `ip_hash` for old rows).
- **`analytics_sessions`** — one row per page open: real IP, UA, screen +
  viewport size, DPR, language, referrer, rolling duration/event counters.
- **`analytics_chunks`** — rrweb recording batches (jsonb, ordered by `seq`,
  unique per session for idempotent retries).

### Pipeline

- **`Recorder.tsx`** (`app/_components/analytics/`) — mounted on both visitor
  page types. Runs rrweb `record()` (masked inputs) and captures structured
  events; batches everything to the ingest route every 5s, final flush via
  sendBeacon. Video events are captured document-level in the capture phase, so
  any `<video>` (plyr included) is covered without instrumenting players.
- **`/api/analytics/ingest`** — unauthenticated ingest with layered defenses
  (3MB body cap, origin check, zod, content existence check, per-visitor rate
  limit). Upserts session, appends chunks, inserts events. Geo (country /
  region / city) is resolved from the client IP via the free ip.sb API
  (`lib/analytics/geo.ts`, no token) — sessions with a previously-seen IP
  reuse the stored result instead of re-querying.
- **`lib/analytics/queries.ts`** — all aggregation queries (content-level).
- **`/api/admin/analytics/session/[id]`** — auth()-gated JSON: session meta +
  full rrweb events + structured timeline (used by replay + heatmap viewers).

### Admin pages

- **`/admin/analytics`** — overview: totals, 30-day trend, device buckets (by
  session viewport), top content (mirrors + articles), referrers, recent
  sessions.
- **`/admin/analytics/content/[id]`** — per-content detail: stats, trends,
  block dwell, scroll-depth funnel, video analytics (progress funnel, pause
  positions), top click targets, media/outlink charts, session list.
- **`/admin/analytics/content/[id]/heatmap`** — click heatmap overlaid on a
  page snapshot rendered from a real session recording (rrweb Replayer paused
  at first frame, iframe stretched to full doc height, canvas heat layer).
  Snapshot width = the visitor's viewport width; desktop/mobile buckets.
- **`/admin/analytics/session/[id]`** — session replay (rrweb-player sized to
  the visitor's viewport) + behavior timeline.

### Notes

- The proxy (`proxy.ts`) sets the `visitor_id` cookie for both `/s/*` and
  `/p/*`.
- Recordings can be large; chunks are capped at 3MB per batch and sessions
  cascade-delete with their content item.
- `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` / `VERCEL_ORG_ID` are no longer needed.
