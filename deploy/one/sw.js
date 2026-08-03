// GAPT One — Service Worker
// Push notifications + offline shell

const CACHE = 'gapt-one-v2';
const SHELL = ['/one/', '/one/index.html', '/one/app.js'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Push notification handler
self.addEventListener('push', event => {
  let data = {
    title: 'GAPT One',
    body: 'Tienes una notificación nueva.',
    url: '/one/',
    tag: 'gapt-general',
    urgency: 'normal',
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}

  const options = {
    body: data.body,
    icon: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    tag: data.tag,
    data: { url: data.url },
    requireInteraction: data.urgency === 'high',
    silent: false,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Tap on notification → open or focus the right page
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/one/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      // Find an already-open window on our domain
      const match = wins.find(w => new URL(w.url).pathname.startsWith('/one') || w.url.includes(url));
      if (match) return match.focus().then(w => w.navigate(url));
      return clients.openWindow(url);
    })
  );
});
