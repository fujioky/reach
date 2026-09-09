'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV === 'development') return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => {
        // SW registration is best-effort — PWA still works via manifest alone on some platforms.
      });
  }, []);

  return null;
}