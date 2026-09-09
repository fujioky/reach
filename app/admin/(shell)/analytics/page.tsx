// app/admin/(shell)/analytics/page.tsx
// 分析总览已并入 Dashboard（/admin）——保留此路由做跳转，旧链接不断。
// 深度页面（/admin/analytics/sessions、content/[id]、session/[id]）不受影响。

import { redirect } from 'next/navigation';

export default function AnalyticsRedirect() {
  redirect('/admin');
}
