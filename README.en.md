# Reach

**Reach turns out-of-reach posts into links anyone can open.**
Mirror an X or YouTube post — text, images, video, comments — into a private share link, publish your own articles, and watch how visitors actually read them.

[简体中文](./README.md) · English

Demo: **https://reach.fujioky.com**

> **Deploy the fetcher first.** Reach does not scrape platforms itself; it depends on the proxy in [fujioky/reach-upstream](https://github.com/fujioky/reach-upstream) (`proxy/`), which adds the X / YouTube parsing and the public API Reach needs on top of Agent Reach. A stock upstream install will not work. Setup steps: [proxy/README.md](https://github.com/fujioky/reach-upstream/blob/main/proxy/README.md). For the video proxy / re-hosting channel, deploy [fujioky/reach-dlproxy](https://github.com/fujioky/reach-dlproxy) on the same host: googlevideo links are bound to the egress IP that extracted them, so only the fetcher's machine can pull the stream.

---

## What it does

**Mirrors** — paste a post URL, get a self-hosted copy.

- Fetches X (Twitter) posts and YouTube videos through an upstream *Agent Reach* API, then normalises them into one content model: title, body, author, media, engagement stats, comments.
- Video is re-hosted: streamed through the app (`/api/proxy-video`), through an optional external reverse proxy (reference implementation: [fujioky/reach-dlproxy](https://github.com/fujioky/reach-dlproxy)), or uploaded to any S3-compatible bucket (Cloudflare R2, AWS S3, MinIO) and served from a CDN domain. Upstream streams are pulled in bounded chunks with automatic failover between hops.
- Share links (`/s/<token>`) can expire by time, by view count, or burn after a single read. Each mirror keeps a version history with preview-before-apply refresh and rollback.
- Subtitles: the best caption track is shown in-player; non-Chinese tracks are translated cue-by-cue via DeepL. Post text and comments get the same on-demand translation, cached in the database.

**Articles** — write your own posts in Markdown.

- Split-pane editor with live preview, drag-and-drop or paste uploads, and a site-wide media library.
- Images go to Vercel Blob; videos go to the S3 bucket via chunked multipart upload with per-part retry — both browser-direct, never through a serverless function.
- Remote import: paste image/video links (or a page URL) and the server transfers the media into your own storage. An optional LLM resolver finds the media URL on pages the hand-written rules cannot parse.
- Public permalinks (`/p/<slug>`), an archive page (`/post`), visitor comments with moderation, cover layouts, responsive WebP variants, and per-article password protection.

**Analytics** — self-built, no third-party script.

- Every visitor page is recorded with [rrweb](https://github.com/rrweb-io/rrweb) (inputs masked) alongside structured events: views, dwell time per block, scroll depth, clicks, media plays, outbound links, video play/pause/seek/progress.
- Admin dashboards: overview trends, per-content detail, session replay sized to the visitor's viewport, and click heatmaps rendered over a real page snapshot.
- Ingest is unauthenticated but defended: body cap, origin check, schema validation, content existence check, and per-visitor rate limiting. Geo is resolved from IP and cached per address.

**Operations**

- Public status page (`/status`) with latency sparklines, fed by a daily cron sample and an admin health panel that probes the video proxy, S3 bucket, Agent Reach and DeepL.
- Cloudflare Turnstile gate for visitor pages, optional site-wide content password, PWA manifest and service worker, light/dark theme.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript |
| Styling | Tailwind CSS 4, custom design tokens (`/design-system`) |
| Database | PostgreSQL via Drizzle ORM (Neon / Vercel Postgres in production) |
| Auth | Auth.js v5 with credentials provider, bcrypt, JWT sessions |
| Storage | Vercel Blob (images), any S3-compatible bucket (video) |
| Media | Plyr player, sharp for image variants, rrweb / rrweb-player for replay |
| Charts | Recharts |
| Tests | Vitest |

## Getting started

Prerequisites: Node.js 24, a PostgreSQL database, a Vercel Blob store, and an Agent Reach endpoint (see below).

```bash
git clone https://github.com/fujioky/reach.git
cd reach
npm install
cp .env.local.example .env.local   # fill in POSTGRES_URL, AUTH_SECRET, BLOB_READ_WRITE_TOKEN, AGENT_REACH_*
npm run db:migrate
npm run dev
```

Open `http://localhost:3000/admin/login`. When the users table is empty the login page becomes a one-time setup form that creates the single admin account. Everything else — video proxy, S3 bucket, DeepL key, AI parser, content password — is configured at runtime under **Admin → 系统设置**.

Run the test suite with `npm test`.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `POSTGRES_URL` | yes | Postgres connection string (also used by `drizzle-kit`) |
| `AUTH_SECRET` | yes | Auth.js secret (`openssl rand -base64 32`) |
| `BLOB_READ_WRITE_TOKEN` | yes | Vercel Blob token for images and avatars |
| `AGENT_REACH_BASE_URL` | yes* | Upstream Agent Reach base URL |
| `AGENT_REACH_PWD` | yes* | Upstream Agent Reach password |
| `NEXT_PUBLIC_SITE_URL` | no | Canonical origin for share links, OpenGraph and the analytics origin check; defaults to the Vercel production URL |
| `CRON_SECRET` | no | Protects `/api/cron/*`; Vercel sends it automatically for scheduled jobs |
| `AI_PARSER_API_KEY` | no | Key for the optional LLM media resolver |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | no | Enable the Cloudflare Turnstile gate on visitor pages; leave both empty to disable |

\* Can be set in the admin settings instead; environment values take precedence.

### Agent Reach

Reach does not scrape platforms itself. It calls an HTTP service that wraps the [Agent Reach](https://github.com/Panniantong/agent-reach) toolchain. A stock upstream install is **not** enough: upstream is a local capability layer for AI agents with no wrapping API. Deploy the proxy from **[fujioky/reach-upstream](https://github.com/fujioky/reach-upstream)** (`proxy/`, see its [README](https://github.com/fujioky/reach-upstream/blob/main/proxy/README.md)) instead. It adds the custom X/Twitter and YouTube parsing Reach depends on — one normalised item, every progressive YouTube video source, subtitles as timed VTT, threaded comments, structured error kinds — and exposes the toolchain publicly through this endpoint and an MCP server with OAuth (usable from ChatGPT / Claude connectors):

```
GET {base}/healthz                                   → { "ok": true, ... }
GET {base}/http/?platform=x|youtube&query=<url>&pwd=<pwd>
                                                     → { "ok": true, "item": { ... }, "errors": [] }
```

`item` carries the post text, author, media (with all yt-dlp video sources for YouTube), engagement stats, comments, and optional `transcript` / `transcript_lang` / `transcript_vtt` fields. The adapters in `lib/fetcher/platforms/` normalise it; error kinds map to `lib/fetcher/errors.ts`. Rate limits (429) and network errors are retried with exponential backoff.

## Deploying to Vercel

1. Create a Vercel project from this repository (framework preset: Next.js, Node 24).
2. Attach a Postgres database (Neon via the Vercel marketplace works out of the box) and a Blob store; Vercel injects `POSTGRES_URL` and `BLOB_READ_WRITE_TOKEN`.
3. Add `AUTH_SECRET`, `AGENT_REACH_BASE_URL`, `AGENT_REACH_PWD`, and optionally `NEXT_PUBLIC_SITE_URL` and the Turnstile keys.
4. Run the migrations once against the production database: `POSTGRES_URL=... npm run db:migrate`.
5. Deploy. `vercel.json` already schedules the daily health sample cron.
6. Visit `/admin/login` to create the admin account, then fill in the video proxy / storage settings.

The `vercel` CLI uploads the working directory rather than a git commit; `.vercelignore` keeps local caches and media out of the upload.

## Project layout

```
app/
  admin/(shell)/      admin UI: mirrors, shares, articles, media, analytics, settings
  admin/login/        login + first-run setup
  api/                route handlers: fetch, proxy-video, article-media, analytics ingest, health, cron…
  s/[token]/          mirror visitor page
  p/[slug]/, post/    article page and archive
  status/             public status page
lib/
  fetcher/            Agent Reach client + platform adapters (X, YouTube)
  video/              chunked upstream fetch, proxy failover, playback URL resolution
  storage/, blob/     S3 multipart + presign, Vercel Blob helpers
  article/            markdown, media library, remote import (SSRF-guarded), tokens
  analytics/          queries, geo lookup, replay media re-signing
  access/, content/   share access control, password gate
  health/, settings/  health probes, typed app_settings accessor
drizzle/migrations/   SQL migrations (drizzle-kit)
```

`AGENTS.md` collects the non-obvious behaviours and pitfalls that matter when changing the code; `docs/article-publishing.md` documents the article pipeline in depth.
