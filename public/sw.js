/* Service worker do Aprova+.
 * - Arquivos estáticos (_next/static, ícones, worker do PDF): cache-first.
 * - Páginas: rede primeiro; sem conexão, usa a última versão visitada ou /offline.
 * - Nunca guarda respostas de API, Server Actions (POST) ou dados de outros domínios.
 */
const VERSAO = "aprova-v1";
const ESTATICOS = `${VERSAO}-estaticos`;
const PAGINAS = `${VERSAO}-paginas`;
const OFFLINE = "/offline";

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(PAGINAS).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => !k.startsWith(VERSAO)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  const estatico = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/pdf.worker.min.mjs";
  if (estatico) {
    evento.respondWith(
      caches.open(ESTATICOS).then(async (cache) => {
        const salvo = await cache.match(req);
        if (salvo) return salvo;
        const resp = await fetch(req);
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    evento.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp.ok && !resp.redirected) {
            const copia = resp.clone();
            caches.open(PAGINAS).then((c) => c.put(req, copia));
          }
          return resp;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match(OFFLINE))),
    );
  }
});
