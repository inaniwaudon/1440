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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    fetch(new Request(request, { cache: "no-store" }))
      .then((response) => {
        const url = new URL(request.url);
        if (url.origin === self.location.origin && response.ok) {
          event.waitUntil(
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, response.clone()))
              .catch(() => undefined),
          );
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (request.mode === "navigate") {
          const appShell = await caches.match(
            new URL("index.html", self.registration.scope),
          );
          if (appShell) return appShell;
        }

        return Response.error();
      }),
  );
});
