/* global self */

// This manifest is replaced by vite-plugin-pwa at build time.
const manifest = self.__WB_MANIFEST;
const fingerprint = manifest
  .map(({ url, revision }) => `${url}:${revision ?? ""}`)
  .join("|")
  .split("")
  .reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0);
const CACHE_PREFIX = "1440-offline-";
const CACHE_NAME = `${CACHE_PREFIX}${fingerprint.toString(36)}`;
const precachedUrls = manifest.map(
  ({ url }) => new URL(url, self.registration.scope),
);
const precachedKeys = new Set(precachedUrls.map((url) => url.href));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        precachedUrls.map(async (url) => {
          const response = await fetch(new Request(url, { cache: "reload" }));
          if (!response.ok) {
            throw new Error(`Failed to precache ${url}`);
          }
          await cache.put(url, response);
        }),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isHashedAsset(url) {
  return /\/assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(url.pathname);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}

async function networkFirst(request, { fallback } = {}) {
  try {
    const response = await fetch(request);
    if (response.ok && precachedKeys.has(new URL(request.url).href)) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallback) {
      const fallbackResponse = await caches.match(fallback);
      if (fallbackResponse) return fallbackResponse;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, {
        fallback: new URL("index.html", self.registration.scope),
      }).catch(() => Response.error()),
    );
    return;
  }

  if (isHashedAsset(url) || precachedKeys.has(url.href)) {
    event.respondWith(cacheFirst(request).catch(() => Response.error()));
    return;
  }

  event.respondWith(networkFirst(request).catch(() => Response.error()));
});
