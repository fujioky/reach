// lib/article/markdown.ts
// Markdown helpers shared by the editor, the list page and the article page.
//
// Rendering itself lives in the ArticleBody client component (react-markdown +
// remark-gfm). What lives here is everything that needs to run on the server or
// in tests: plain-text extraction for excerpts and metadata, and the media-URL
// convention that lets Markdown reference uploaded images and videos.

/**
 * Media reference convention.
 *
 * Uploaded media is addressed by a stable in-app path rather than a storage
 * URL, because both backends produce URLs that cannot be embedded in a
 * document: Vercel Blob presigned URLs expire in ~1h, and S3/R2 keys are not
 * public. `/api/article-media/<mediaId>.<ext>` never changes, and the route
 * resolves it to fresh storage credentials on each request.
 *
 * The extension is what tells the renderer whether a `![](...)` node is an
 * image or a video — the client cannot query the media table, and Markdown has
 * no video syntax. Keeping the type in the URL avoids both a custom syntax and
 * an extra round-trip.
 */
export const ARTICLE_MEDIA_PREFIX = '/api/article-media/';

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];

/** Build the in-app URL for an uploaded media row. */
export function articleMediaUrl(mediaId: string, extension: string): string {
  const ext = extension.replace(/^\./, '').toLowerCase();
  return `${ARTICLE_MEDIA_PREFIX}${mediaId}.${ext}`;
}

/**
 * Split an `<mediaId>.<ext>` key back into its parts.
 * Returns null when the key doesn't match the convention (bad request, not a
 * server error — the route answers 400).
 */
export function parseArticleMediaKey(
  key: string,
): { mediaId: string; extension: string } | null {
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([a-z0-9]{1,5})$/i.exec(
    key,
  );
  if (!match) return null;
  return { mediaId: match[1].toLowerCase(), extension: match[2].toLowerCase() };
}

/** True when a Markdown image URL should render as a video player. */
export function isVideoUrl(url: string): boolean {
  const withoutQuery = url.split(/[?#]/)[0];
  const ext = withoutQuery.split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXTENSIONS.includes(ext);
}

/**
 * Reduce Markdown to readable plain text.
 *
 * Not a parser — it strips the constructs that would otherwise leak syntax into
 * an excerpt or a meta description. Order matters: fenced code first (so its
 * contents can't be mistaken for other syntax), then images before links (image
 * syntax is link syntax with a bang).
 */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/^\s{0,3}>\s?/gm, '') // blockquote markers
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // ATX headings
    .replace(/^\s{0,3}([-*_]\s*){3,}$/gm, ' ') // thematic breaks
    .replace(/^\s{0,3}[-*+]\s+/gm, '') // bullet markers
    .replace(/^\s{0,3}\d+\.\s+/gm, '') // ordered list markers
    .replace(/\|/g, ' ') // table pipes
    .replace(/[*_~]{1,3}/g, '') // emphasis / strikethrough
    .replace(/<[^>]+>/g, ' ') // stray HTML tags
    .replace(/\s+/g, ' ')
    .trim();
}

/** Derive a list-page excerpt from the body when the author left it blank. */
export function deriveExcerpt(markdown: string, maxLength = 160): string {
  const text = stripMarkdown(markdown);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

/**
 * Rough reading time in minutes.
 *
 * CJK text is counted per character (~380 chars/min) and everything else per
 * whitespace-delimited word (~220 words/min); a mixed post gets the sum. Always
 * at least 1 so a short post doesn't read "0 分钟".
 */
export function estimateReadingMinutes(markdown: string): number {
  const text = stripMarkdown(markdown);
  const cjkCount = (text.match(/[㐀-䶿一-鿿぀-ヿ가-힯]/g) ?? []).length;
  const nonCjk = text.replace(/[㐀-䶿一-鿿぀-ヿ가-힯]/g, ' ');
  const wordCount = nonCjk.split(/\s+/).filter(Boolean).length;
  const minutes = cjkCount / 380 + wordCount / 220;
  return Math.max(1, Math.round(minutes));
}

/** First image URL in the body — used as a cover fallback on the list page. */
export function firstImageUrl(markdown: string): string | null {
  const match = /!\[[^\]]*\]\(\s*([^)\s]+)/.exec(markdown);
  if (!match) return null;
  const url = match[1];
  return isVideoUrl(url) ? null : url;
}
