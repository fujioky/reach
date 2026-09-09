// app/s/[token]/layout.tsx
// Visitor-side layout — Reach 外壳包裹（D-71/D-72）。

import { PageBackground } from '@/app/_components/layout/PageBackground';

export default function VisitorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-paper font-sans text-ink">
      <PageBackground intensity="subtle" />
      <div className="relative">{children}</div>
    </div>
  );
}
