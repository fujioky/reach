import { describe, it, expect } from 'vitest';
import { bodyImageUrl, bodyImageUrls } from '@/lib/content/body-images';
import { normalizeComments } from '@/lib/fetcher/normalize';

describe('body inline images', () => {
  it('recognises a paragraph that is only an image line', () => {
    expect(bodyImageUrl('![](https://pbs.twimg.com/media/A.jpg)')).toBe('https://pbs.twimg.com/media/A.jpg');
    expect(bodyImageUrl('see ![](https://pbs.twimg.com/media/A.jpg)')).toBeNull();
    expect(bodyImageUrl('![](javascript:alert(1))')).toBeNull();
  });

  it('lists image lines in body order', () => {
    const body = 'intro\n\n![](https://x/1.jpg)\n\ntext\n\n![](https://x/2.png)';
    expect(bodyImageUrls(body)).toEqual(['https://x/1.jpg', 'https://x/2.png']);
  });
});

describe('normalizeComments images', () => {
  it('keeps image URLs and drops videos', () => {
    const [c] = normalizeComments([
      {
        id: '1',
        content: 'hi',
        author: { id: 'a', name: 'n', handle: 'h', url: '', avatar_url: '' },
        created_at: '',
        stats: { likes: 0, comments: 0, reposts: 0, views: 0, collects: 0 },
        images: [
          'https://pbs.twimg.com/media/A.jpg',
          'https://video.twimg.com/ext_tw_video/1/pu/vid/480x468/x.mp4?tag=12',
        ],
      },
    ]);
    expect(c!.images).toEqual(['https://pbs.twimg.com/media/A.jpg']);
  });
});
