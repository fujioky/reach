// lib/article/__tests__/assets.test.ts
// Reference extraction — the check that decides whether an asset gets deleted.
// A false negative here silently destroys media a live article is using, so the
// cases below lean on the ways an asset URL actually shows up in a body.

import { describe, it, expect } from 'vitest';
import { extractMediaIds, formatBytes, CLEANUP_GRACE_MS } from '@/lib/article/assets';
import { articleMediaUrl } from '@/lib/article/markdown';

const ID_A = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('extractMediaIds', () => {
  it('finds an id in Markdown image syntax', () => {
    const body = `文字\n\n![封面](${articleMediaUrl(ID_A, 'jpg')})\n\n更多文字`;
    expect([...extractMediaIds(body)]).toEqual([ID_A]);
  });

  it('finds ids regardless of media type', () => {
    const body = `![图](${articleMediaUrl(ID_A, 'png')})\n![片](${articleMediaUrl(ID_B, 'mp4')})`;
    expect([...extractMediaIds(body)].sort()).toEqual([ID_A, ID_B].sort());
  });

  it('finds an id in a plain link, not just image syntax', () => {
    // An author may link a video instead of embedding it; that still counts.
    const body = `[下载视频](${articleMediaUrl(ID_A, 'mp4')})`;
    expect([...extractMediaIds(body)]).toEqual([ID_A]);
  });

  it('finds a bare URL with no Markdown around it', () => {
    expect([...extractMediaIds(`见 ${articleMediaUrl(ID_A, 'webp')} 这张`)]).toEqual([ID_A]);
  });

  it('scans every text it is given, so a cover counts as a reference', () => {
    const body = `![](${articleMediaUrl(ID_A, 'jpg')})`;
    const cover = articleMediaUrl(ID_B, 'png');
    expect([...extractMediaIds(body, cover)].sort()).toEqual([ID_A, ID_B].sort());
  });

  it('deduplicates an id used several times', () => {
    const url = articleMediaUrl(ID_A, 'jpg');
    expect([...extractMediaIds(`![a](${url}) ![b](${url}) ${url}`)]).toEqual([ID_A]);
  });

  it('is case-insensitive about the uuid and normalizes to lowercase', () => {
    const body = `![](/api/article-media/${ID_A.toUpperCase()}.JPG)`;
    expect([...extractMediaIds(body)]).toEqual([ID_A]);
  });

  it('ignores null and undefined texts', () => {
    expect([...extractMediaIds(null, undefined, '')]).toEqual([]);
  });

  it('does not match a bare uuid without the media path', () => {
    // Otherwise an article that merely mentions an id would pin an asset alive.
    expect([...extractMediaIds(`素材 id 是 ${ID_A}`)]).toEqual([]);
  });

  it('does not match a similar path from somewhere else', () => {
    expect([...extractMediaIds(`/api/other-media/${ID_A}.jpg`)]).toEqual([]);
    expect([...extractMediaIds(`https://cdn.example.com/${ID_A}.jpg`)]).toEqual([]);
  });

  it('finds an id inside an HTML img tag pasted into the body', () => {
    const body = `<img src="${articleMediaUrl(ID_A, 'png')}" alt="x">`;
    expect([...extractMediaIds(body)]).toEqual([ID_A]);
  });
});

describe('CLEANUP_GRACE_MS', () => {
  it('is 24 hours', () => {
    expect(CLEANUP_GRACE_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('formatBytes', () => {
  it('scales through the units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB');
  });

  it('renders an unknown size as a dash rather than "0 B"', () => {
    expect(formatBytes(0)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});
