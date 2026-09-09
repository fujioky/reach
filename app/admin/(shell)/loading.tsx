// app/admin/(shell)/loading.tsx
// 路由切换的即时反馈：服务端页面还在准备时先渲染骨架，消除「点了没反应、
// 卡一会才整页切换」的观感。覆盖 (shell) 下所有页面。

export default function AdminLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-busy="true" aria-label="加载中">
      <div>
        <div className="h-3 w-14 rounded bg-surface-2" />
        <div className="mt-2.5 h-7 w-44 rounded bg-surface-2" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 rounded-xl bg-surface-2/70" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-surface-2/50" />
      <div className="h-40 rounded-xl bg-surface-2/40" />
    </div>
  );
}
