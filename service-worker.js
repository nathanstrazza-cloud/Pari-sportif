const CACHE_NAME = "pari-sportif-v28";
const APP_SHELL = [
  "./",
  "index.html",
  "styles.css",
  "auth.js",
  "app.js",
  "manifest.json",
  "logo.PNG",
  "Accueil.PNG",
  "Classements.PNG",
  "Tableau.PNG",
  "data/matches.json",
  "data/standings.json",
  "data/players-ea.json",
  "data/Cartes.json",
  "data/odds.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}
