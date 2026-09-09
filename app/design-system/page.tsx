// app/_design-system/page.tsx — 设计系统预览页（仅用于 review，后续删除）
//
// 展示 Reach 品牌 token 系统的所有组件：颜色、字体、圆角、阴影、
// wordmark、主题切换器、按钮/卡片/输入框等基础组件样式。

import { ReachMark, ReachMarkWordmark } from '@/app/_components/brand/ReachMark';
import { PageBackground } from '@/app/_components/layout/PageBackground';
import { ThemeToggle } from '@/app/_components/theme/ThemeToggle';
import { SurfaceCard } from '@/app/_components/ui/SurfaceCard';

export default function DesignSystemPage() {
  return (
    <div className="relative min-h-screen bg-paper font-sans text-ink">
      <PageBackground intensity="subtle" />
      <div className="relative mx-auto max-w-4xl px-6 py-12">
        {/* ── Header ── */}
        <header className="mb-12 flex items-center justify-between">
          <div>
            <ReachMarkWordmark size="lg" />
            <p className="mt-2 text-sm text-muted">设计系统预览 · Reach Indigo</p>
          </div>
          <ThemeToggle />
        </header>

        {/* ── Wordmark ── */}
        <Section title="Wordmark · 弧线标识">
          <div className="flex flex-wrap items-center gap-8">
            <div className="flex flex-col items-center gap-2">
              <ReachMark size={48} className="text-brand" />
              <span className="text-xs text-subtle">48px</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <ReachMark size={30} className="text-brand" />
              <span className="text-xs text-subtle">30px</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <ReachMark size={20} className="text-brand" />
              <span className="text-xs text-subtle">20px</span>
            </div>
            <div className="h-12 w-px bg-border" />
            <ReachMarkWordmark size="sm" />
            <ReachMarkWordmark size="md" />
            <ReachMarkWordmark size="lg" />
            <div className="h-12 w-px bg-border" />
            {/* 暗色背景上的 wordmark */}
            <div className="flex flex-col items-center gap-2 rounded-lg bg-ink p-4">
              <ReachMarkWordmark size="md" />
              <span className="text-xs text-subtle">暗色背景</span>
            </div>
          </div>
        </Section>

        {/* ── Colors ── */}
        <Section title="配色 · Reach Indigo">
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <ColorSwatch name="Brand" hex="#5B4FE9" className="bg-brand" />
            <ColorSwatch name="Brand Hover" hex="#4A3FD4" className="bg-brand-hover" />
            <ColorSwatch name="Brand Dark" hex="#8B82FF" className="bg-brand-dark" />
            <ColorSwatch name="Tint" hex="#F1F0FD" className="bg-tint border border-border" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-6 md:grid-cols-4">
            <ColorSwatch name="Ink" hex="#17161B" className="bg-ink" />
            <ColorSwatch name="Muted" hex="#6C6B75" className="bg-muted" />
            <ColorSwatch name="Subtle" hex="#9C9BA6" className="bg-subtle" />
            <ColorSwatch name="Paper" hex="#FAFAF8" className="bg-paper border border-border" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-6 md:grid-cols-4">
            <ColorSwatch name="Surface" hex="#FFFFFF" className="bg-surface border border-border" />
            <ColorSwatch name="Surface 2" hex="#F3F2F7" className="bg-surface-2" />
            <ColorSwatch name="Border" hex="#ECEBF1" className="bg-border" />
            <div className="h-2" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-6">
            <ColorSwatch name="Success" hex="#0FA968" className="bg-success" />
            <ColorSwatch name="Danger" hex="#E5484D" className="bg-danger" />
            <ColorSwatch name="Warning" hex="#E0A800" className="bg-warning" />
          </div>
          <p className="mt-4 text-xs text-subtle">
            切换暗色主题看 token 变化 → 点右上角切换器
          </p>
        </Section>

        {/* ── Typography ── */}
        <Section title="字体 · Space Grotesk + 思源黑体">
          <div className="space-y-4">
            <div>
              <div className="font-display text-4xl font-bold tracking-tight text-ink">
                Space Grotesk 1234567890
              </div>
              <p className="mt-1 text-xs text-subtle">font-display · 标题 / 品牌 / 数字</p>
            </div>
            <div>
              <div className="font-display text-2xl font-semibold text-ink">
                Reach — 把够不着的内容，递到朋友手里
              </div>
              <p className="mt-1 text-xs text-subtle">font-display · 大标题</p>
            </div>
            <div>
              <div className="font-sans text-base text-ink">
                思源黑体 · 界面文字与中文内容。拉丁字符回退到 Space Grotesk。
              </div>
              <p className="mt-1 text-xs text-subtle">font-sans · 正文</p>
            </div>
            <div>
              <div className="font-mono text-sm text-ink">
                SF Mono · /s/k7Fq2 · 612 MB / 1024 MB
              </div>
              <p className="mt-1 text-xs text-subtle">font-mono · 代码 / 数字</p>
            </div>
            <div className="flex flex-wrap gap-4 pt-2">
              <span className="font-display text-xs text-subtle">text-xs 12px</span>
              <span className="font-display text-sm text-subtle">text-sm 14px</span>
              <span className="font-display text-base text-subtle">text-base 16px</span>
              <span className="font-display text-lg text-subtle">text-lg 18px</span>
              <span className="font-display text-xl text-subtle">text-xl 20px</span>
              <span className="font-display text-2xl text-subtle">text-2xl 24px</span>
              <span className="font-display text-4xl text-subtle">text-4xl 36px</span>
            </div>
          </div>
        </Section>

        {/* ── Radius ── */}
        <Section title="圆角体系">
          <div className="flex flex-wrap items-end gap-6">
            <RadiusBox name="xs" value="4px" className="rounded-xs" />
            <RadiusBox name="sm" value="8px" className="rounded-sm" />
            <RadiusBox name="md" value="12px" className="rounded-md" />
            <RadiusBox name="lg" value="14px" className="rounded-lg" />
            <RadiusBox name="xl" value="16px" className="rounded-xl" />
            <RadiusBox name="pill" value="999px" className="rounded-pill" />
          </div>
        </Section>

        {/* ── Shadows ── */}
        <Section title="阴影体系">
          <div className="flex flex-wrap gap-8">
            <ShadowBox name="sm" className="shadow-sm" />
            <ShadowBox name="md" className="shadow-md" />
            <ShadowBox name="lg" className="shadow-lg" />
            <ShadowBox name="brand" className="shadow-brand" />
            <ShadowBox name="brand-lg" className="shadow-brand-lg" />
          </div>
        </Section>

        {/* ── Buttons ── */}
        <Section title="按钮 · 基础组件">
          <div className="flex flex-wrap gap-4">
            <button className="ds-btn-primary px-6 py-2.5 text-sm font-medium text-white shadow-brand transition-colors hover:bg-brand-hover">
              主按钮 · Brand
            </button>
            <button className="rounded-sm border border-border bg-surface px-6 py-2.5 text-sm font-medium text-ink transition-colors hover:border-muted">
              次按钮 · Surface
            </button>
            <button className="rounded-sm bg-danger px-6 py-2.5 text-sm font-medium text-white transition-colors hover:opacity-90">
              危险 · Danger
            </button>
            <button className="rounded-sm bg-surface-2 px-6 py-2.5 text-sm font-medium text-subtle cursor-not-allowed">
              禁用 · Disabled
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-4">
            <button className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-white shadow-brand transition-colors hover:bg-brand-hover">
              Pill 主按钮
            </button>
            <button className="rounded-pill border border-border bg-surface px-5 py-2 text-sm font-medium text-ink transition-colors hover:border-muted">
              Pill 次按钮
            </button>
          </div>
        </Section>

        {/* ── Design System Classes ── */}
        <Section title="设计系统类 · ds-*">
          <div className="grid gap-4 sm:grid-cols-2">
            <SurfaceCard className="p-4">
              <div className="ds-section-label">ds-section-label</div>
              <h3 className="ds-page-heading mt-2">ds-page-heading</h3>
              <p className="ds-page-subtitle">ds-page-subtitle 描述文字</p>
            </SurfaceCard>
            <SurfaceCard interactive className="p-4">
              <div className="ds-icon-box">✦</div>
              <p className="mt-3 text-sm text-muted">ds-card-interactive · 悬停有反馈</p>
            </SurfaceCard>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <span className="ds-pill-badge">ds-pill-badge</span>
            <button type="button" className="ds-btn-primary">ds-btn-primary</button>
            <button type="button" className="ds-btn-ink">ds-btn-ink</button>
          </div>
        </Section>

        {/* ── Card ── */}
        <Section title="卡片 · 基础组件">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="ds-card p-6 shadow-sm">
              <h3 className="font-display text-lg font-semibold text-ink">标准卡片</h3>
              <p className="mt-2 text-sm text-muted">
                rounded-lg · border · bg-surface · shadow-sm · p-6
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-6">
              <h3 className="font-display text-lg font-semibold text-ink">二级表面卡片</h3>
              <p className="mt-2 text-sm text-muted">
                bg-surface-2 · 用于折叠区 / 次级面板
              </p>
            </div>
          </div>
        </Section>

        {/* ── Input ── */}
        <Section title="输入框 · 基础组件">
          <div className="max-w-md space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-muted">标签</label>
              <input
                type="text"
                placeholder="placeholder"
                className="ds-input text-base"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-muted">聚焦态</label>
              <input
                type="text"
                defaultValue="聚焦时 border-brand"
                className="w-full rounded-sm border border-brand bg-surface px-4 py-3 text-base text-ink outline-none transition-colors focus:border-brand"
              />
            </div>
          </div>
        </Section>

        {/* ── Badge ── */}
        <Section title="徽章 / 状态标签">
          <div className="flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-tint px-3 py-1 text-xs font-medium text-brand">
              <span className="h-1.5 w-1.5 rounded-pill bg-brand" />
              镜像自 X
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-tint px-3 py-1 text-xs font-medium text-brand">
              via Reach
            </span>
            <span className="inline-flex items-center rounded-pill bg-success/10 px-3 py-1 text-xs font-medium text-success">
              有效
            </span>
            <span className="inline-flex items-center rounded-pill bg-subtle/10 px-3 py-1 text-xs font-medium text-subtle">
              已过期
            </span>
            <span className="inline-flex items-center rounded-pill bg-danger/10 px-3 py-1 text-xs font-medium text-danger">
              已撤销
            </span>
            <span className="inline-flex items-center rounded-pill bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
              即将过期
            </span>
          </div>
        </Section>

        {/* ── Platform variants ── */}
        <Section title="平台 Variant · x: / yt:">
          <p className="mb-4 text-sm text-muted">
            通过 <code className="font-mono text-xs text-brand">data-platform</code> 属性切换平台特定样式
          </p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div
              data-platform="x"
              className="rounded-lg border-2 border-border bg-surface p-6 x:border-brand yt:border-danger"
            >
              <h3 className="font-display text-lg font-semibold text-ink">X / Twitter</h3>
              <p className="mt-2 text-sm text-muted">
                <code className="font-mono text-xs">data-platform="x"</code> → x:border-brand
              </p>
            </div>
            <div
              data-platform="youtube"
              className="rounded-lg border-2 border-border bg-surface p-6 x:border-brand yt:border-danger"
            >
              <h3 className="font-display text-lg font-semibold text-ink">YouTube</h3>
              <p className="mt-2 text-sm text-muted">
                <code className="font-mono text-xs">data-platform="youtube"</code> → yt:border-danger
              </p>
            </div>
          </div>
        </Section>

        {/* ── Theme toggle note ── */}
        <div className="mt-12 ds-card p-6 text-center">
          <p className="text-sm text-muted">
            点击右上角 <ThemeToggle size="sm" className="ml-2" /> 切换亮 / 暗 / 跟随系统
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Helper components ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="mb-4 font-display text-xl font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function ColorSwatch({ name, hex, className }: { name: string; hex: string; className: string }) {
  return (
    <div>
      <div className={`h-16 rounded-sm ${className}`} />
      <div className="mt-2 text-xs font-medium text-ink">{name}</div>
      <div className="text-xs text-subtle">{hex}</div>
    </div>
  );
}

function RadiusBox({ name, value, className }: { name: string; value: string; className: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`h-16 w-16 bg-brand/20 border-2 border-brand ${className}`} />
      <div className="text-xs font-medium text-ink">{name}</div>
      <div className="text-xs text-subtle">{value}</div>
    </div>
  );
}

function ShadowBox({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`h-20 w-28 rounded-lg bg-surface ${className}`} />
      <div className="text-xs font-medium text-ink">{name}</div>
    </div>
  );
}
