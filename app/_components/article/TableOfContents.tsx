'use client';

// app/_components/article/TableOfContents.tsx
// Floating outline beside the article, with the current section highlighted.
//
// Headings are read from the rendered DOM rather than parsed from Markdown a
// second time: the ids have to match the anchors ArticleBody produced, and
// reading them back is the only way to be sure they do.
//
// Desktop only. On a narrow screen there is no room beside the column, and a
// collapsible outline above the article is a worse version of just scrolling.

import { useEffect, useState } from 'react';

interface Entry {
  id: string;
  text: string;
  level: number;
}

export function TableOfContents({ containerId }: { containerId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) return;

    const headings = Array.from(container.querySelectorAll<HTMLElement>('h2[id], h3[id]'));
    setEntries(
      headings.map((el) => ({
        id: el.id,
        text: el.textContent?.replace(/^#/, '').trim() ?? '',
        level: Number(el.tagName[1]),
      })),
    );
    if (headings.length === 0) return;

    // The heading nearest the top of the viewport wins. IntersectionObserver
    // alone reports what's *visible*, which flickers between two headings that
    // are on screen at once; comparing distances gives a stable answer.
    const pickActive = () => {
      let best: { id: string; distance: number } | null = null;
      for (const el of headings) {
        const distance = Math.abs(el.getBoundingClientRect().top - 100);
        if (!best || distance < best.distance) best = { id: el.id, distance };
      }
      setActiveId(best?.id ?? null);
    };

    let frame = 0;
    const onScroll = () => {
      if (frame === 0)
        frame = requestAnimationFrame(() => {
          frame = 0;
          pickActive();
        });
    };

    pickActive();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [containerId]);

  if (entries.length < 2) return null; // a one-heading outline is just noise

  return (
    <nav
      aria-label="目录"
      className="sticky top-24 hidden max-h-[calc(100dvh-8rem)] overflow-y-auto xl:block"
    >
      <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-subtle">目录</div>
      <ul className="space-y-1 border-l border-border">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              aria-current={activeId === entry.id ? 'true' : undefined}
              className={`-ml-px block border-l-2 py-1 text-[13px] leading-snug transition-colors ${
                entry.level === 3 ? 'pl-6' : 'pl-3.5'
              } ${
                activeId === entry.id
                  ? 'border-brand font-medium text-brand'
                  : 'border-transparent text-muted hover:border-border hover:text-ink'
              }`}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
