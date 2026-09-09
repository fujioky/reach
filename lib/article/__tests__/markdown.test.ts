// lib/article/__tests__/markdown.test.ts
// Plain-text extraction, excerpts, and the media-URL convention that lets
// Markdown reference uploaded images and videos.

import { describe, it, expect } from 'vitest';
import {
  ARTICLE_MEDIA_PREFIX,
  articleMediaUrl,
  deriveExcerpt,
  estimateReadingMinutes,
  firstImageUrl,
  isVideoUrl,
  parseArticleMediaKey,
  stripMarkdown,
} from '@/lib/article/markdown';

const MEDIA_ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

describe('articleMediaUrl / parseArticleMediaKey', () => {
  it('round-trips a media id and extension', () => {
    const url = articleMediaUrl(MEDIA_ID, 'jpg');
    expect(url).toBe(`${ARTICLE_MEDIA_PREFIX}${MEDIA_ID}.jpg`);
    expect(parseArticleMediaKey(`${MEDIA_ID}.jpg`)).toEqual({
      mediaId: MEDIA_ID,
      extension: 'jpg',
    });
  });

  it('normalizes a leading dot and uppercase extension', () => {
    expect(articleMediaUrl(MEDIA_ID, '.MP4')).toBe(`${ARTICLE_MEDIA_PREFIX}${MEDIA_ID}.mp4`);
    expect(parseArticleMediaKey(`${MEDIA_ID}.JPG`)?.extension).toBe('jpg');
  });

  it('rejects keys that are not a uuid plus extension', () => {
    // The route answers 400 on these rather than querying with junk.
    expect(parseArticleMediaKey('not-a-uuid.jpg')).toBeNull();
    expect(parseArticleMediaKey(MEDIA_ID)).toBeNull();
    expect(parseArticleMediaKey(`../../etc/passwd`)).toBeNull();
    expect(parseArticleMediaKey(`${MEDIA_ID}.toolongext`)).toBeNull();
  });
});

describe('isVideoUrl', () => {
  it('recognizes video extensions', () => {
    expect(isVideoUrl(`${ARTICLE_MEDIA_PREFIX}${MEDIA_ID}.mp4`)).toBe(true);
    expect(isVideoUrl('/x/y.webm')).toBe(true);
    expect(isVideoUrl('/x/y.MOV')).toBe(true);
  });

  it('treats everything else as an image', () => {
    expect(isVideoUrl(`${ARTICLE_MEDIA_PREFIX}${MEDIA_ID}.jpg`)).toBe(false);
    expect(isVideoUrl('https://example.com/photo.png')).toBe(false);
  });

  it('ignores query strings and fragments', () => {
    expect(isVideoUrl('/a/b.mp4?v=2')).toBe(true);
    expect(isVideoUrl('/a/b.png?ext=.mp4')).toBe(false);
  });
});

describe('stripMarkdown', () => {
  it('removes headings, emphasis and list markers', () => {
    expect(stripMarkdown('## 标题\n\n**粗体**和*斜体*')).toBe('标题 粗体和斜体');
    expect(stripMarkdown('- one\n- two')).toBe('one two');
  });

  it('keeps link text but drops the URL', () => {
    expect(stripMarkdown('see [the docs](https://example.com) now')).toBe('see the docs now');
  });

  it('drops images entirely', () => {
    expect(stripMarkdown('before ![alt text](/a/b.png) after')).toBe('before after');
  });

  it('drops fenced code blocks including their contents', () => {
    // Code must go first, or its contents get mistaken for other syntax.
    expect(stripMarkdown('intro\n\n```js\nconst a = **1**;\n```\n\noutro')).toBe('intro outro');
  });

  it('strips blockquote markers and inline code fences', () => {
    expect(stripMarkdown('> quoted\n\nuse `npm run build`')).toBe('quoted use');
  });
});

describe('deriveExcerpt', () => {
  it('returns short text unchanged', () => {
    expect(deriveExcerpt('# 标题\n\n短短一句话。')).toBe('标题 短短一句话。');
  });

  it('truncates with an ellipsis at the limit', () => {
    const excerpt = deriveExcerpt('字'.repeat(300), 20);
    expect(excerpt).toBe(`${'字'.repeat(20)}…`);
  });

  it('never leaks markdown syntax into the excerpt', () => {
    const excerpt = deriveExcerpt('![cover](/api/article-media/x.png)\n\n**开头**正文');
    expect(excerpt).not.toContain('![');
    expect(excerpt).not.toContain('**');
  });
});

describe('estimateReadingMinutes', () => {
  it('is at least one minute for any post', () => {
    expect(estimateReadingMinutes('嗨')).toBe(1);
    expect(estimateReadingMinutes('')).toBe(1);
  });

  it('scales with length', () => {
    const short = estimateReadingMinutes('字'.repeat(400));
    const long = estimateReadingMinutes('字'.repeat(4000));
    expect(long).toBeGreaterThan(short);
  });

  it('counts CJK characters and latin words on their own scales', () => {
    // ~760 CJK chars ≈ 2 min; the same character count in latin words would be
    // far less reading.
    expect(estimateReadingMinutes('字'.repeat(760))).toBe(2);
  });
});

describe('firstImageUrl', () => {
  it('finds the first image in the body', () => {
    expect(firstImageUrl('text\n\n![a](/first.png)\n\n![b](/second.png)')).toBe('/first.png');
  });

  it('ignores videos — a cover has to be an image', () => {
    expect(firstImageUrl(`![clip](${ARTICLE_MEDIA_PREFIX}${MEDIA_ID}.mp4)`)).toBeNull();
  });

  it('returns null when there is no image', () => {
    expect(firstImageUrl('just words')).toBeNull();
  });
});
