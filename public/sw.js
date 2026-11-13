/** Activate updates without reloading open entries; pin each page to its release. */
const RELEASE = '4.3.0';
const CACHE_NAME = 'flavor-fusion-v2-cache-v35';
const CLIENT_RELEASES = 'caterdesk-client-releases';
const PRECACHE = ['./', './index.html', './styles.css', './app.js', './register-sw.js', './error-reporter.js', './db.js', './utils.js', './icons.js', './i18n.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'];
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
    // Old release caches remain available to open tabs; business storage is untouched.
    await self.clients.claim();
  })());
});
self.addEventListener('message', e => {
  if (e.data?.type === 'GET_RELEASE') e.ports[0]?.postMessage({ release: RELEASE });
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
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
