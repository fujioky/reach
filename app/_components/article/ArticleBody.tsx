'use client';

// app/_components/article/ArticleBody.tsx
// Markdown renderer for self-authored articles.
//
// react-markdown with remark-gfm, and deliberately without rehype-raw: the
// article body is stored as Markdown and rendered as Markdown, so no raw HTML
// ever reaches the DOM. That removes the whole injection surface — including
// from a future editor, an import, or a compromised admin session — at the cost
// of an escape hatch nobody has asked for.
//
// Videos ride on image syntax: `![](/api/article-media/<id>.mp4)`. Markdown has
// no video node, and the renderer can't query the media table, so the file
// extension in the URL decides between <img> and <video>. See
// lib/article/markdown.ts for the convention.
//
// Images that sit together in one paragraph render as a grid rather than as a
// stack of separate figures — see the paragraph handler below.

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isVideoUrl } from '@/lib/article/markdown';
import { ArticleFigure, ArticleImageGrid, type ArticleImage } from './ArticleImages';
import { ArticleVideo } from './ArticleVideo';
import { CodeBlock } from './CodeBlock';

/** hast node, narrowed to what the paragraph inspection needs. */
type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
};

/** Children of a paragraph, ignoring whitespace-only text nodes. */
function meaningfulChildren(node: HastNode | undefined): HastNode[] {
  return (node?.children ?? []).filter(
    (child) => !(child.type === 'text' && !String(child.value ?? '').trim()),
  );
}

/**
 * Read the media out of a paragraph that contains nothing else.
 *
 * A paragraph holding only images is how a group is expressed: consecutive
 * `![](…)` lines with no blank line between them parse into one paragraph, so
 * an author gets a grid by writing them together and separate figures by
 * leaving blank lines. It also has to be unwrapped — <figure> and <video> are
 * block elements, and a browser silently closes a <p> before them, leaving
 * React hydrating against a DOM that doesn't match its tree.
 */
function readMediaParagraph(
  node: HastNode | undefined,
): { images: ArticleImage[]; videos: ArticleImage[] } | null {
  const children = meaningfulChildren(node);
  if (children.length === 0) return null;
  if (!children.every((child) => child.type === 'element' && child.tagName === 'img')) return null;

  const images: ArticleImage[] = [];
  const videos: ArticleImage[] = [];
  for (const child of children) {
    const src = String(child.properties?.src ?? '');
    if (!src) continue;
    const item = { src, alt: String(child.properties?.alt ?? '') };
    (isVideoUrl(src) ? videos : images).push(item);
  }
  if (images.length === 0 && videos.length === 0) return null;
  return { images, videos };
}

/** Stable, readable anchor id for a heading. */
function headingId(node: HastNode | undefined, fallback: string): string {
  const text = collectText(node) || fallback;
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9㐀-䶿一-鿿぀-ヿ가-힯]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  );
}

function collectText(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return String(node.value ?? '');
  return (node.children ?? []).map(collectText).join('');
}

/** Anchor link shown on hover, so a section can be linked to directly. */
function Heading({
  level,
  id,
  children,
}: {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  id: string;
  children: React.ReactNode;
}) {
  const Tag = `h${level}` as const;
  return (
    <Tag id={id} className="group scroll-mt-24">
      <a
        href={`#${id}`}
        aria-label="链接到此段落"
        className="float-left -ml-6 hidden w-6 text-subtle no-underline opacity-0 transition-opacity group-hover:opacity-100 md:block"
      >
        #
      </a>
      {children}
    </Tag>
  );
}

const components: Components = {
  p({ node, children }) {
    const media = readMediaParagraph(node as HastNode);
    if (!media) return <p>{children}</p>;

    return (
      <>
        {media.images.length > 0 && <ArticleImageGrid images={media.images} />}
        {media.videos.map((video) => (
          <ArticleVideo key={video.src} src={video.src} caption={video.alt} />
        ))}
      </>
    );
  },

  // An image outside a media-only paragraph (mixed with text) still renders,
  // just inline-ish as its own figure rather than in a grid.
  img({ src, alt }) {
    const url = typeof src === 'string' ? src : '';
    if (!url) return null;
    return isVideoUrl(url) ? (
      <ArticleVideo src={url} caption={alt ?? undefined} />
    ) : (
      <ArticleFigure image={{ src: url, alt: alt ?? '' }} />
    );
  },

  h1: ({ node, children }) => (
    <Heading level={1} id={headingId(node as HastNode, 'h1')}>{children}</Heading>
  ),
  h2: ({ node, children }) => (
    <Heading level={2} id={headingId(node as HastNode, 'h2')}>{children}</Heading>
  ),
  h3: ({ node, children }) => (
    <Heading level={3} id={headingId(node as HastNode, 'h3')}>{children}</Heading>
  ),
  h4: ({ node, children }) => (
    <Heading level={4} id={headingId(node as HastNode, 'h4')}>{children}</Heading>
  ),

  a({ href, children }) {
    const url = href ?? '';
    const isExternal = /^https?:\/\//i.test(url);
    return (
      <a
        href={url}
        {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
      >
        {children}
      </a>
    );
  },

  pre({ children }) {
    return <CodeBlock>{children}</CodeBlock>;
  },

  // Tables can be wider than the column; let them scroll on their own instead
  // of pushing the page into horizontal scroll.
  table({ children }) {
    return (
      <div className="my-6 overflow-x-auto">
        <table>{children}</table>
      </div>
    );
  },
};

export function ArticleBody({ markdown, className = '' }: { markdown: string; className?: string }) {
  return (
    <div className={`article-prose ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
