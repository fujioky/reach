# Reach

![Reach](docs/screenshots/hero.png)

**所不及者，可达于人。**
把一条 X / YouTube 的帖子——正文、图片、视频、评论——镜像成一条可控的私密链接；也可以发布自己撰写的文章，并看见访客究竟是怎样阅读它们的。

简体中文 · [English](./README.en.md)

演示站：**https://reach.fujioky.com**

---

## 关联仓库

Reach 由几个独立仓库协作，各仓库自身的说明更完整：

- **[reach-upstream](https://github.com/fujioky/reach-upstream)** — Reach 的抓取端：一个 HTTP / MCP 代理，抓取 X、YouTube、小红书、Telegram 与网页内容并整理成统一结构，也能直接接入 Claude、ChatGPT 等 AI（小红书**特别优化**：帖子图片内嵌返回，让 AI 能读完整篇帖子）。**可以通用**，不止服务 Reach——Reach 自身只镜像 X / YouTube。**Reach 必须先部署它**，步骤见其 [README](https://github.com/fujioky/reach-upstream/blob/main/README.zh-CN.md)。
- **[reach-dlproxy](https://github.com/fujioky/reach-dlproxy)** — 一个支持访问控制与递归解析的简单反向代理服务器，用作 Reach 的视频转发 / 转存通道。**可以通用**。
- **[reach-browser-extension](https://github.com/fujioky/reach-browser-extension)** — 浏览器扩展，在你正浏览的 X 帖子或 YouTube 视频页一键生成 Reach 分享链接（Chrome / Edge / Firefox）。**支持快捷共享**。

## 预览

| | |
| --- | --- |
| ![镜像页](docs/screenshots/mirror.png) 镜像页：X 帖子正文与逐段翻译、视频、互动数据、精选评论 | ![首页](docs/screenshots/home.png) 首页（浅色主题） |
| ![文章页](docs/screenshots/article.png) 文章页：目录、阅读进度、封面与正文 | ![归档](docs/screenshots/article-archive.png) 文章归档 `/post` |
| ![创建镜像](docs/screenshots/admin-create-mirror.png) 创建镜像：粘贴链接 → 抓取预览 → 勾选保留的评论 | ![镜像管理](docs/screenshots/admin-mirrors.png) 镜像管理：每条内容下的分享链接与访问统计 |
| ![分享链接](docs/screenshots/admin-share-link.png) 新增分享链接：有效期、总次数、独立访客数、阅后即焚 | ![会话回放](docs/screenshots/admin-session-replay.png) 会话回放：按访客视口还原，附点击热力图 |
| ![文章管理](docs/screenshots/admin-articles.png) 文章管理 | ![素材管理](docs/screenshots/admin-media-library.png) 素材管理：引用状态、公开分享、清理未引用 |
| ![人机验证](docs/screenshots/turnstile-gate.png) 访客页的 Cloudflare Turnstile 门 | ![浏览器扩展](docs/screenshots/browser-extension.png) 浏览器扩展：弹窗里一键分享（访问控制、访问密码、历史记录），设置页用管理员账号登录 |

## 功能

**镜像** —— 贴上帖子链接，得到一份自托管副本。

- 通过抓取端 *reach-upstream* 抓取 X（Twitter）帖子与 YouTube 视频，统一归一化为同一套内容模型：标题、正文、作者、媒体、互动数据、评论。
- 视频重新托管：可经本站转发（`/api/proxy-video`）、经外部反向代理转发（参考实现 [fujioky/reach-dlproxy](https://github.com/fujioky/reach-dlproxy)），或上传到任意 S3 兼容存储桶（Cloudflare R2、AWS S3、MinIO）并从自定义域名分发。上游取流按有界分块进行，各通道之间自动故障转移。
- 分享链接（`/s/<token>`）支持限期、限次、阅后即焚。每条镜像保留版本历史，刷新前可预览差异，随时回滚。
- 字幕：播放器内直接显示最佳字幕轨，非中文字幕逐条经 DeepL 翻译；正文与评论同样按需翻译，结果缓存在数据库。

**文章** —— 用 Markdown 写自己的内容。

- 左右分栏编辑器带实时预览，拖拽 / 粘贴即上传，全站共用素材库。
- 图片存 Vercel Blob，视频经分块 multipart 直传 S3 存储桶、每块独立重试——都是浏览器直传，不经过 Serverless 函数。
- 远程转存：粘贴图片 / 视频链接（或页面地址），服务端把媒体转存到自己的存储；手写规则解析不出媒体地址时，可选用 LLM 解析器兜底。
- 公开固定链接（`/p/<slug>`）、归档页（`/post`）、访客评论与后台审核、两种封面版式、响应式 WebP 变体、逐篇密码保护。

**数据分析** —— 自建，不引入第三方脚本。

- 每个访客页面用 [rrweb](https://github.com/rrweb-io/rrweb) 录制 DOM 变化，同时采集结构化事件：浏览、分块停留时长、滚动深度、点击、媒体播放、外链点击、视频播放 / 暂停 / 拖动 / 进度。
- 后台看板：总览趋势、单条内容详情、按访客视口尺寸还原的会话回放、叠加在真实页面快照上的点击热力图。
- 上报接口无需登录，但层层设防：请求体上限、来源校验、schema 校验、内容存在性校验、按访客限流。地理位置按 IP 解析并按地址缓存。

**浏览器扩展** —— [fujioky/reach-browser-extension](https://github.com/fujioky/reach-browser-extension)（Chrome / Edge / Firefox）。

- 在 X 帖子或 YouTube 视频页点图标、按快捷键，或在帖子链接上右键，即可生成分享链接并自动复制，可带有效期、限次、阅后即焚和访问密码。
- 已经镜像过的帖子直接在原镜像上新建分享链接，不重复抓取；新帖子走与后台向导相同的创建流程，保留全部评论。
- 扩展用管理员账号登录，换得一个独立令牌（只存哈希），后台「系统 → 浏览器扩展」可逐个撤销。详见下文[浏览器扩展](#浏览器扩展)。

**运维**

- 公开状态页（`/status`）带延迟迷你图，数据来自每日 cron 采样；后台健康面板探测视频代理、S3 存储桶、抓取端与 DeepL。
- 访客页 Cloudflare Turnstile 人机验证门、可选的全站内容密码、PWA manifest 与 Service Worker、亮 / 暗色主题。

## 访问记录与会话回放

访客打开镜像页（`/s/<token>`）或文章页（`/p/<slug>`）时，页面会挂载一个录制器（`app/_components/analytics/Recorder.tsx`），一次打开就是一条会话。它记录三类东西：

| 类别 | 内容 | 落库 |
| --- | --- | --- |
| DOM 录像 | [rrweb](https://github.com/rrweb-io/rrweb) 的完整快照 + 增量变更；鼠标移动 60ms、滚动 150ms、媒体 800ms 采样 | `analytics_chunks`（按 `seq` 排序的 jsonb 批次） |
| 结构化事件 | `view`、`dwell`（各内容块可见时长）、`scroll`（最大深度）、`click`（页面坐标 + 文档/视口尺寸）、`media_click`、`media_play`、`outlink_click`、`video`（播放 / 暂停 / 拖动 / 每 10% 进度 / 全屏 / 结束 / 倍速） | `visit_events` |
| 会话元数据 | IP、User-Agent、屏幕与视口尺寸、DPR、语言、来源页、按 IP 解析并缓存的国家 / 地区 / 城市、累计时长与事件计数 | `analytics_sessions` |

录制器每 5 秒把缓冲批量发到 `/api/analytics/ingest`，缓冲超过 400 条 rrweb 事件时提前发送；页面关闭时用 `sendBeacon` 做最后一次提交，失败的批次留在发件箱下次重试，会话元数据在被确认前随每批重发，上报接口的写入是幂等的。视频事件在 document 捕获阶段统一采集，任何 `<video>`（含 Plyr）都能覆盖，不用给播放器埋点。

后台能看到的：

- **`/admin/analytics/sessions`** —— 会话列表（时间、内容、地区、设备、时长、事件数）。
- **`/admin/analytics/session/<id>`** —— 会话回放：rrweb-player 按访客当时的视口尺寸还原，旁边是行为时间轴；回放里的视频与录像进度同步。
- **`/admin/analytics/content/<id>/heatmap`** —— 点击热力图：取一条真实会话的录像渲染出页面快照，把该内容全部会话的点击叠上去，按桌面 / 移动视口分桶。
- **`/admin/analytics/content/<id>`** —— 单条内容的统计：趋势、分块停留、滚动深度漏斗、视频进度漏斗与暂停位置、点击目标、媒体与外链图表。

几点要知道的：

- 文章媒体地址带 6 小时签名令牌，录像里记下的是访客当时的 URL；回放接口下发前会重签令牌（`lib/analytics/resign-media.ts`），所以旧会话的图片与视频照常显示，存储的数据不动。
- 上报接口无需登录，但有请求体上限、来源校验、schema 校验、内容存在性校验、按访客限流。访客靠 HttpOnly 的 `visitor_id` cookie 区分。
- 录像**不打码**输入框（`maskAllInputs: false`），访客在评论框里输入的内容会进入录像。
- 没有关闭录制的开关，也没有自动清理：录像随内容项级联删除，长期运行要留意 `analytics_chunks` 的体积。`app/privacy-policy` 页面的文案要与你实际的采集范围保持一致。

## 浏览器扩展

[fujioky/reach-browser-extension](https://github.com/fujioky/reach-browser-extension) 把「打开后台 → 粘贴链接 → 等抓取 → 复制分享链接」压成一步：在 X 帖子或 YouTube 视频页直接生成分享链接，自动复制到剪贴板。支持 Chrome / Edge / Firefox。

![浏览器扩展：左为弹窗，右为设置页](docs/screenshots/browser-extension.png)

**安装与连接**

1. 部署本仓库（构建时会自动完成数据库迁移，扩展需要其中的 `api_tokens` 表）。
2. 从扩展的 [Releases](https://github.com/fujioky/reach-browser-extension/releases/latest) 下载 zip。Chrome / Edge：解压到固定文件夹，在 `chrome://extensions` 打开开发者模式，「加载已解压的扩展程序」选这个文件夹。Firefox：zip 未签名，可在 `about:debugging` 临时载入，长期使用需到 AMO 以「不公开」方式签名。
3. 打开扩展设置，填入 Reach 地址，用管理员账号登录。Reach 验证密码后签发一个只给这个浏览器用的令牌，扩展不保存密码。后台「系统 → 浏览器扩展」页面提供可复制的 Reach 地址，并列出所有登录过的扩展和最近使用时间，可以逐个撤销。

**使用**

- 在帖子页点扩展图标或按 `Alt+Shift+S` 后回车；或者在时间线里的帖子链接上右键「用 Reach 分享此链接」，不用打开帖子。分享在扩展后台完成，弹窗可以随时关，完成后自动复制链接。
- 每次分享可设链接的有效期（不限 / 1 / 7 / 30 天）、最多打开次数、阅后即焚，以及镜像的访问密码（系统密码 / 单独密码）。独立访客数、精确到期时间仍在后台对链接编辑。
- 弹窗先显示当前帖子的分享（twitter.com / x.com、youtu.be / watch 等不同写法按同一条帖子识别），其余分享收在「历史记录」里。

**接口**

| 接口 | 作用 |
| --- | --- |
| `POST /api/extension/session` | 用管理员账号密码换令牌 |
| `GET /api/extension/session` | 检查令牌是否仍然有效 |
| `DELETE /api/extension/session` | 退出登录，作废当前令牌 |
| `POST /api/extension/share` | 帖子链接进、分享链接出，NDJSON 流式返回进度 |

几点要知道的：

- 同一条帖子（按平台 + 帖子 ID 识别）已经有镜像时，只在这份镜像上新建分享链接，不重新抓取；要更新内容，到后台对镜像「重新抓取」。新帖子与后台「创建镜像」走同一套创建逻辑（`lib/mirror/create.ts`），保留全部评论，视频转存放到响应返回之后进行。
- 分享时设置的访问密码写在**镜像**上，与后台镜像详情页的密码设置是同一个：这份镜像已有的分享链接也会随之需要这个密码。不设置则不改动镜像原有的密码；选「系统密码」而系统设置里还没有密码时，接口会直接拒绝，避免给出一个其实没加密的链接。
- `api_tokens` 只存令牌的 SHA-256。这些接口对任意来源开放 CORS——它们只认令牌（登录接口认密码本身），从不读 Cookie，所以不会被别的网站借用管理员会话。登录接口和后台登录页一样，没有做限流。
- 分享接口之所以流式返回，是因为 Chrome 会终止 30 秒内收不到 fetch 响应的扩展 service worker，而抓取一条新帖子经常超过 30 秒。流在没有 `done` 行时就结束，按失败处理。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Next.js 16（App Router，Turbopack）、React 19、TypeScript |
| 样式 | Tailwind CSS 4，自定义设计令牌（`/design-system`） |
| 数据库 | PostgreSQL + Drizzle ORM（生产环境用 Neon / Vercel Postgres） |
| 认证 | Auth.js v5 Credentials 提供者、bcrypt、JWT 会话 |
| 存储 | Vercel Blob（图片）、任意 S3 兼容存储桶（视频） |
| 媒体 | Plyr 播放器、sharp 生成图片变体、rrweb / rrweb-player 回放 |
| 图表 | Recharts |
| 测试 | Vitest |

## 本地运行

前置条件：Node.js 24、一个 PostgreSQL 数据库、一个 Vercel Blob 存储、一个抓取端接口（见下文）。

```bash
git clone https://github.com/fujioky/reach.git
cd reach
npm install
cp .env.local.example .env.local   # 填入 POSTGRES_URL、AUTH_SECRET、BLOB_READ_WRITE_TOKEN、AGENT_REACH_*
npm run dev                         # 启动前自动把数据库迁移到最新
```

打开 `http://localhost:3000/admin/login`。用户表为空时，登录页会变成一次性的初始化表单，创建唯一的管理员账号。其余配置——视频代理、S3 存储桶、DeepL 密钥、AI 解析器、内容密码——都在运行时于 **后台 → 系统设置** 中完成。

运行测试：`npm test`。

### 环境变量

| 变量 | 必需 | 用途 |
| --- | --- | --- |
| `POSTGRES_URL` | 是 | Postgres 连接串（`drizzle-kit` 也用它） |
| `AUTH_SECRET` | 是 | Auth.js 密钥（`openssl rand -base64 32`） |
| `BLOB_READ_WRITE_TOKEN` | 是 | Vercel Blob 令牌，存图片与头像 |
| `AGENT_REACH_BASE_URL` | 是* | 抓取端（reach-upstream）地址 |
| `AGENT_REACH_PWD` | 是* | 抓取端口令 |
| `NEXT_PUBLIC_SITE_URL` | 否 | 站点规范源：分享链接、OpenGraph、分析上报来源校验；缺省取 Vercel 生产域名 |
| `CRON_SECRET` | 否 | 保护 `/api/cron/*`；Vercel 定时任务会自动带上 |
| `AI_PARSER_API_KEY` | 否 | 可选 LLM 媒体解析器的密钥 |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | 否 | 开启访客页的 Cloudflare Turnstile 门；两者留空即关闭 |

\* 也可以在后台设置中填写；环境变量优先级更高。

### 抓取端

Reach 自身不抓取平台内容，而是调用抓取端 **[fujioky/reach-upstream](https://github.com/fujioky/reach-upstream)**（部署见其 [README](https://github.com/fujioky/reach-upstream/blob/main/README.zh-CN.md)）。它负责 Reach 依赖的 X/Twitter 与 YouTube 定制解析——统一内容结构、全部渐进式 YouTube 视频源、带时间轴的 VTT 字幕、回复串与回复图片、X 长文内嵌图片、结构化错误类型——并通过下面这个接口和一个带 OAuth 的 MCP 服务（可接入 ChatGPT / Claude 连接器）提供出去：

```
GET {base}/healthz                                   → { "ok": true, ... }
GET {base}/http/?platform=x|youtube&query=<url>&pwd=<pwd>
                                                     → { "ok": true, "item": { ... }, "errors": [] }
```

`item` 包含帖子正文、作者、媒体（YouTube 附带全部 yt-dlp 视频源）、互动数据、评论，以及可选的 `transcript` / `transcript_lang` / `transcript_vtt` 字段。`lib/fetcher/platforms/` 中的适配器负责归一化，错误类型映射见 `lib/fetcher/errors.ts`。限流（429）与网络错误会按指数退避重试。

## 部署到 Vercel

1. 从本仓库创建 Vercel 项目（框架预设 Next.js，Node 24）。
2. 挂载一个 Postgres 数据库（Vercel 市场里的 Neon 开箱即用）和一个 Blob 存储；Vercel 会自动注入 `POSTGRES_URL` 与 `BLOB_READ_WRITE_TOKEN`。
3. 添加 `AUTH_SECRET`、`AGENT_REACH_BASE_URL`、`AGENT_REACH_PWD`，按需添加 `NEXT_PUBLIC_SITE_URL` 与 Turnstile 密钥。
4. 数据库不用手动建表或升级：`npm run build`（Vercel 部署时也是它）会先执行 `drizzle-kit migrate`，全新的空库从头建表，已有的库只补上缺的迁移；迁移失败则构建失败，旧版本继续在线。
5. 部署。`vercel.json` 已配置每日健康采样的 cron。
6. 访问 `/admin/login` 创建管理员账号，然后填写视频代理 / 存储设置。

`vercel` CLI 上传的是工作目录而非 git 提交；`.vercelignore` 负责把本地缓存和媒体文件排除在外。

## 目录结构

```
app/
  admin/(shell)/      后台：镜像、分享、文章、素材、分析、设置
  admin/login/        登录与首次初始化
  api/                路由处理器：抓取、视频代理、文章媒体、分析上报、健康检查、cron……
  api/extension/      浏览器扩展接口：登录换令牌、流式快捷分享
  s/[token]/          镜像访客页
  p/[slug]/, post/    文章页与归档页
  status/             公开状态页
lib/
  fetcher/            抓取端客户端与平台适配器（X、YouTube），帖子链接解析
  mirror/             镜像创建（后台向导与扩展共用）、快捷分享、刷新与版本
  video/              分块上游取流、代理故障转移、播放地址解析
  storage/, blob/     S3 multipart 与预签名、Vercel Blob 辅助
  article/            Markdown、素材库、远程转存（含 SSRF 防护）、签名令牌
  analytics/          聚合查询、地理位置、回放媒体重签
  access/, content/   分享访问控制、密码门
  auth/               管理员凭据校验、扩展令牌
  health/, settings/  健康探测、app_settings 类型化访问层
drizzle/migrations/   SQL 迁移（drizzle-kit）
```

`AGENTS.md` 汇总了改代码时需要知道的非显性行为与陷阱；`docs/article-publishing.md` 详细记录了文章发布链路。
