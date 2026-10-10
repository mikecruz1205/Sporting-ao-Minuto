/* =========================================================================
   SERVICE WORKER — Sporting ao Minuto
   -------------------------------------------------------------------------
   O que faz:
     · guarda a "casca" do site (HTML, CSS, JS, ícones) para abrir depressa
       e funcionar sem rede — as notícias já lidas vivem no arquivo local
       do app.js, por isso offline continua a haver o que ler;
     · páginas: rede primeiro (3 s), depois a cópia guardada, depois a
       página offline;
     · CSS, JS, imagens do próprio site e fontes: mostra o guardado e
       atualiza por trás (stale-while-revalidate);
     · feeds e API do site: rede primeiro, cópia guardada se falhar;
     · Supabase (contas, chat, fantasy) e tudo o que não é GET: nunca passa
       pela cache;
     · notificações push: recebe e mostra (ver docs/NOTIFICACOES.md).

   Ao mudar a lista da casca ou a lógica, sobe VERSAO — as caches antigas
   são apagadas na ativação.
   ========================================================================= */

const VERSAO = 'v3-2026-10-10';
const CACHE_CASCA   = `casca-${VERSAO}`;
const CACHE_ESTATICO = `estatico-${VERSAO}`;
const CACHE_DADOS   = `dados-${VERSAO}`;

/* o mínimo para abrir sem rede; o resto entra à medida que é pedido */
const CASCA = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/img/marca/emblema-128.webp',
  '/img/marca/emblema-256.webp',
  '/img/icones/icone-192.png',
  '/img/icones/badge-96.png',
  '/favicon.ico'
];

const LIMITES = { [CACHE_ESTATICO]: 220, [CACHE_DADOS]: 60 };

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(CACHE_CASCA)
      .then(c => c.addAll(CASCA))
      .catch(() => { /* sem rede na instalação: fica para a próxima */ })
  );
});

self.addEventListener('activate', evento => {
  evento.waitUntil((async () => {
    const validas = [CACHE_CASCA, CACHE_ESTATICO, CACHE_DADOS];
    for(const nome of await caches.keys()){
      if(!validas.includes(nome)) await caches.delete(nome);
    }
    if(self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

/* o site pede para ativar a versão nova (botão "Atualizar") */
self.addEventListener('message', evento => {
  if(evento.data === 'ativar-ja') self.skipWaiting();
});

/* ---------------------------------------------------------------------
   PEDIDOS
   --------------------------------------------------------------------- */
const DADOS_DO_SITE = /^\/(api\/|rss|ler|fundo|emblema|dados\/)/;
const ESTATICO = /\.(css|js|webp|png|jpe?g|svg|ico|woff2?|json)$/i;

self.addEventListener('fetch', evento => {
  const pedido = evento.request;
  if(pedido.method !== 'GET') return;
  const url = new URL(pedido.url);

  /* contas, chat e fantasy: sempre direto ao servidor */
  if(/supabase\.(co|in)$/.test(url.hostname)) return;

  /* navegação entre páginas do site */
  if(pedido.mode === 'navigate'){
    evento.respondWith(pagina(evento));
    return;
  }

  if(url.origin === self.location.origin){
    /* o jogo em direto nunca sai da cache: sem rede, o centro de jogo tem
       de saber que falhou (e dizer que os dados são antigos), em vez de
       receber uma cópia velha como se fosse nova */
    if(url.pathname.startsWith('/api/jogo')) return;
    if(DADOS_DO_SITE.test(url.pathname)){ evento.respondWith(redePrimeiro(pedido, CACHE_DADOS)); return; }
    if(ESTATICO.test(url.pathname) || url.pathname === '/manifest.webmanifest'){
      evento.respondWith(guardadoEAtualiza(pedido, CACHE_ESTATICO)); return;
    }
    return;
  }

  /* fontes do Google e a biblioteca do Supabase (CDN) */
  if(/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || url.hostname === 'cdn.jsdelivr.net'){
    evento.respondWith(guardadoEAtualiza(pedido, CACHE_ESTATICO));
  }
  /* imagens dos jornais: não se guardam — são respostas opacas que
     ocupam muito espaço na quota e mudam a toda a hora */
});

async function pagina(evento){
  try{
    const pre = await evento.preloadResponse;
    if(pre) return pre;
    const resposta = await comLimite(fetch(evento.request), 3000);
    /* qualquer rota (/jogos, /plantel…) é a mesma página: guarda-se como "/" */
    if(resposta.ok){
      const c = await caches.open(CACHE_CASCA);
      c.put('/', resposta.clone());
    }
    return resposta;
  }catch(e){
    const c = await caches.open(CACHE_CASCA);
    return (await c.match('/')) || (await c.match('/offline.html')) || Response.error();
  }
}

async function guardadoEAtualiza(pedido, nome){
  const c = await caches.open(nome);
  const guardado = await c.match(pedido);
  const daRede = fetch(pedido).then(r => {
    if(r.ok || r.type === 'opaque' && pedido.destination === 'font'){
      c.put(pedido, r.clone()).then(() => aparar(nome));
    }
    return r;
  }).catch(() => guardado);
  return guardado || daRede;
}

async function redePrimeiro(pedido, nome){
  const c = await caches.open(nome);
  try{
    const r = await comLimite(fetch(pedido), 8000);
    if(r.ok) c.put(pedido, r.clone()).then(() => aparar(nome));
    return r;
  }catch(e){
    return (await c.match(pedido)) || new Response('', { status: 503, statusText: 'offline' });
  }
}

function comLimite(promessa, ms){
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tempo')), ms);
    promessa.then(r => { clearTimeout(t); resolve(r); }, e => { clearTimeout(t); reject(e); });
  });
}

/* cada cache tem um teto de entradas; saem as mais antigas */
async function aparar(nome){
  const max = LIMITES[nome];
  if(!max) return;
  const c = await caches.open(nome);
  const chaves = await c.keys();
  for(let i = 0; i < chaves.length - max; i++) await c.delete(chaves[i]);
}

/* ---------------------------------------------------------------------
   NOTIFICAÇÕES PUSH
   O servidor envia JSON: { tipo, titulo, corpo, url, tag, imagem }.
   Os tipos estão descritos em js/notificacoes.js e docs/NOTIFICACOES.md.
   --------------------------------------------------------------------- */
const PREDEFINICOES = {
  GOLO:      { titulo: 'GOLO!',              tag: 'jogo',     renotify: true,  vibrar: [120, 60, 120, 60, 240] },
  INICIO:    { titulo: 'Começou o jogo',     tag: 'jogo',     renotify: true },
  FIM:       { titulo: 'Fim do jogo',        tag: 'jogo',     renotify: true },
  RESULTADO: { titulo: 'Resultado final',    tag: 'jogo',     renotify: true },
  ONZE:      { titulo: 'Onze inicial',       tag: 'onze' },
  NOTICIA:   { titulo: 'Sporting ao Minuto', tag: 'noticia' },
  MERCADO:   { titulo: 'Mercado',            tag: 'mercado' }
};

self.addEventListener('push', evento => {
  let dados = {};
  try{ dados = evento.data ? evento.data.json() : {}; }
  catch(e){ dados = { corpo: evento.data?.text() || '' }; }

  const base = PREDEFINICOES[dados.tipo] || PREDEFINICOES.NOTICIA;
  const titulo = dados.titulo || base.titulo;
  evento.waitUntil(self.registration.showNotification(titulo, {
    body: dados.corpo || '',
    icon: '/img/icones/icone-192.png',
    badge: '/img/icones/badge-96.png',
    image: dados.imagem || undefined,
    tag: dados.tag || base.tag,
    renotify: !!base.renotify,
    vibrate: base.vibrar,
    lang: 'pt-PT',
    data: { url: dados.url || '/', tipo: dados.tipo || 'NOTICIA' }
  }));
});

self.addEventListener('notificationclick', evento => {
  evento.notification.close();
  const destino = new URL(evento.notification.data?.url || '/', self.location.origin).href;
  evento.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for(const j of janelas){
      if(new URL(j.url).origin === self.location.origin){
        await j.focus();
        if('navigate' in j) return j.navigate(destino);
        return;
      }
    }
    return self.clients.openWindow(destino);
  })());
});
