const CACHE_NAME = 'rental-app-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 僅快取「應用程式外殼」靜態檔案；API 資料一律走網路，確保資料即時
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (url.indexOf('script.google.com') !== -1) {
    return; // API 請求不快取，直接走網路
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
