const CACHE_NAME = 'zeiterfassung-v61';

const ASSETS = [
  '/',
  '/index.html',
  '/icon.svg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// IndexedDB Helper für Share Target
const DB_NAME = 'share-target-db';
const STORE_NAME = 'shared-files';

async function storeSharedFile(file) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      event.target.result.createObjectStore(STORE_NAME, { autoIncrement: true });
    };
    request.onsuccess = (event) => {
      const db = event.target.result;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.add(file);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Share Target Handler
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const file = formData.get('file');

          if (file) {
            await storeSharedFile(file);
            console.log('Shared file stored in IDB');
          }

          // Redirect to app with query param to trigger check
          return Response.redirect('/?shared_target=true', 303);
        } catch (err) {
          console.error('Share Target Error:', err);
          return Response.redirect('/?error=share_failed', 303);
        }
      })()
    );
    return;
  }

  // Normal Fetch Strategy
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// Listener für Nachrichten vom Frontend (z.B. Update-Button geklickt)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
