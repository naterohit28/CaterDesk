/** Activate updates without reloading open entries; pin each page to its release. */
const RELEASE = '5.0.0';
const CACHE_NAME = 'flavor-fusion-v2-cache-v102';
const CLIENT_RELEASES = 'caterdesk-client-releases';
const PRECACHE = ['./', './index.html', './styles.css', './app.js', './register-sw.js', './error-reporter.js', './db.js', './utils.js', './backup-crypto.js', './drive-backup.js', './drive-config.js', './icons.js', './i18n.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];
function clientKey(id) { return new Request(new URL('./__client_release__/' + encodeURIComponent(id), self.registration.scope)); }
async function pinnedRelease(id) {
  if (!id) return null;
  const entry = await (await caches.open(CLIENT_RELEASES)).match(clientKey(id));
  return entry ? entry.text() : null;
}
async function pinRelease(id, release) {
  if (id) await (await caches.open(CLIENT_RELEASES)).put(clientKey(id), new Response(release));
}
async function preserveOpenReleases() {
  const keys = await caches.keys();
  const oldReleases = keys.filter(k => /^flavor-fusion-v2-cache-v\d+$/.test(k) && k !== CACHE_NAME)
    .sort((a, b) => Number(b.match(/v(\d+)$/)[1]) - Number(a.match(/v(\d+)$/)[1]));
  const openClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of openClients) {
    if (!await pinnedRelease(client.id)) await pinRelease(client.id, oldReleases[0] || CACHE_NAME);
  }
}
// Old release caches are kept only while an open tab still uses one; the rest are deleted, with the pins of tabs
// that have closed. Business records (IndexedDB) are never touched (19 Nov audit: caches piled up on the phone).
async function pruneOldReleases() {
  const open = new Set((await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).map(c => c.id));
  const pins = await caches.open(CLIENT_RELEASES), keep = new Set([CACHE_NAME]);
  for (const req of await pins.keys()) {
    const id = decodeURIComponent(new URL(req.url).pathname.split('/__client_release__/')[1] || '');
    if (open.has(id)) keep.add(await (await pins.match(req)).text()); else await pins.delete(req);
  }
  for (const k of await caches.keys()) if (/^flavor-fusion-v2-cache-v\d+$/.test(k) && !keep.has(k)) await caches.delete(k);
}
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    await (await caches.open(CACHE_NAME)).addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' })));
    await preserveOpenReleases();
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await preserveOpenReleases();
    // Old release caches stay available to tabs still open on them; business storage is untouched.
    await pruneOldReleases();
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => {
  if (e.data?.type === 'GET_RELEASE') e.ports[0]?.postMessage({ release: RELEASE });
});
self.addEventListener('fetch', e => {
  // Only this app's own files: Google sign-in and Drive requests go straight to the network, never cached
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const navigation = e.request.mode === 'navigate';
    const release = navigation ? CACHE_NAME : await pinnedRelease(e.clientId) || CACHE_NAME;
    if (navigation) await pinRelease(e.resultingClientId || e.clientId, CACHE_NAME);
    const cache = await caches.open(release);
    const cached = await cache.match(e.request, { ignoreSearch: true });
    if (cached) return cached;
    if (navigation) {
      const page = await cache.match('./index.html');
      if (page) return page;
    }
    try { return await fetch(e.request); } catch { return Response.error(); }
  })());
});
