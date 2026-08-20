// ============================================================
//  service-worker.js
//  Hace que la app abra sin internet y sea instalable (PWA).
//  Estrategia: "network-first" para los archivos propios.
//   - Con internet: SIEMPRE trae la última versión del servidor
//     (y guarda una copia).
//   - Sin internet: usa la copia guardada.
//  Así los cambios se ven apenas hay conexión, sin quedar pegado
//  a una versión vieja en caché.
// ============================================================

// Si cambiás archivos y no ves los cambios, subí este número (v3, v4...).
const CACHE = "gym-cache-v8";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./db.js",
  "./config.js",
  "./plan.json",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./fonts/urbanist-400.woff2",
  "./fonts/urbanist-500.woff2",
  "./fonts/urbanist-600.woff2",
  "./fonts/urbanist-700.woff2",
  "./fonts/urbanist-800.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Solo manejamos archivos de la propia app. A Supabase / esm.sh los dejamos pasar directo.
  if (url.origin !== self.location.origin) return;

  // Network-first: pedimos al servidor; si falla (sin internet), usamos la copia guardada.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match("./index.html"))
      )
  );
});
