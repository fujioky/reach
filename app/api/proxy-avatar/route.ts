// app/api/proxy-avatar/route.ts
// 头像/缩略图代理 — 让墙内用户能看到 X/YouTube 的作者头像。
//
// SECURITY:
// - url 参数必须来自已知平台域名白名单（防 SSRF）
// - 只代理 image/* 响应，其他 Content-Type 一律拒绝
// - 不转发 cookie、authorization 等敏感请求头
//
// CACHING（三级）:
// - Vercel Edge CDN: cdn-cache-control: public, max-age=86400, stale-while-revalidate=3600
//   → 命中 CDN 后不再触发 Function，头像 24h 内直接从边缘返回
// - 浏览器: Cache-Control: public, max-age=86400
// - Next.js Data Cache: revalidate = 86400（同一 url 参数复用缓存）

export const runtime = 'nodejs';
export const revalidate = 86400; // 24h — Next.js Data Cache

// 允许代理的头像/缩略图域名白名单
const ALLOWED_HOSTS = new Set([
  'pbs.twimg.com',          // X/Twitter 头像
  'abs.twimg.com',          // X/Twitter 静态资源
  'yt3.ggpht.com',          // YouTube 频道头像
  'yt3.googleusercontent.com', // YouTube 头像（备用域）
  'lh3.googleusercontent.com', // Google 账号头像
  'i.ytimg.com',            // YouTube 视频缩略图
]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return new Response('Missing url', { status: 400 });
  }

  // 解析并校验域名白名单
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new Response('Invalid url', { status: 400 });
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return new Response('Forbidden: host not allowed', { status: 403 });
  }

  // 仅允许 https
  if (parsed.protocol !== 'https:') {
    return new Response('Forbidden: https only', { status: 403 });
  }

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ReachProxy/1.0)',
        'Accept': 'image/webp,image/avif,image/*,*/*;q=0.8',
      },
      referrer: '',
      referrerPolicy: 'no-referrer',
    });

    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.status}`, {
        status: upstream.status,
      });
    }

    const contentType = upstream.headers.get('Content-Type') ?? '';
    if (!contentType.startsWith('image/')) {
      return new Response('Not an image', { status: 400 });
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type': contentType,
        // 浏览器缓存 24h
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
        // Vercel Edge CDN 缓存 24h（优先级高于 Cache-Control）
        'CDN-Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
        'Vercel-CDN-Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
        'Content-Length': upstream.headers.get('Content-Length') ?? '',
      },
    });
  } catch (err) {
    return new Response(`Proxy error: ${(err as Error).message}`, {
      status: 502,
    });
  }
}
