// Reach — minimal service worker for PWA installability.
// Network-first: no offline cache for dynamic mirror/admin routes.

const SW_VERSION = 'reach-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through — always hit the network for fresh content.
  event.respondWith(fetch(event.request));
});