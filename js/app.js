/* =========================================================================
   SPORTING CP — motor do portal
   ========================================================================= */
(() => {
'use strict';

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];

const semAcentos = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
const chaveNome  = s => semAcentos(s).replace(/[^a-z ]/g,'').trim();
const apelido    = s => chaveNome(s).split(' ').filter(Boolean).slice(-1)[0] || '';

/* ---------------- estado ---------------- */
let NOTICIAS = [];          // tudo o que vem dos RSS
let PLANTEL  = [];          // jogadores (Wikipédia + fotos da API)
let JOGOS    = [...FIXTURES];
let TABELA   = [...TABLE];
let FOTOS    = { jogadores: [], equipas: {} };
let escolhido = null;
let vistaAtual = 'inicio';
let filtroFonte = 'todas';
let filtroPos = 'todos';
let procuraTexto = '';

/* =========================================================================
   1. EMBLEMAS
   ========================================================================= */
/* Ordem de preferência: o teu ficheiro → o emblema oficial descarregado
   pela API → o escudo desenhado em código. */
const EMBLEMAS_SCP = [
  'img/crest.png',    // se puseres um ficheiro teu, ganha a este
  'img/crest.svg',    // emblema de 2026, o atual
  'img/teams/228.png' // versão simplificada da API, último recurso
];

function montarEmblema(){
  const alvos = [$('#emblema'), $('#acesso-emblema')].filter(Boolean);
  alvos.forEach(a => a.innerHTML = EMBLEMA_SVG);

  const tentar = i => {
    if(i >= EMBLEMAS_SCP.length) return;
    const img = new Image();
    img.onload = () => alvos.forEach(a => {
      const c = img.cloneNode();
      c.alt = 'Sporting CP';
      a.innerHTML = '';
      a.appendChild(c);
    });
    img.onerror = () => tentar(i + 1);
    img.src = EMBLEMAS_SCP[i];
  };
  tentar(0);
}

/* =========================================================================
   1b. ACESSO
   Nota: isto é um cadeado de cortesia, do lado do browser. Serve para não
   entrar qualquer pessoa que abra a página, não é segurança a sério —
   quem souber ver o código-fonte passa à frente.
   ========================================================================= */
const UTILIZADOR = 'sporting';
const PALAVRA    = '1906';
const SESSAO     = 'scp-sessao';

function abrirSite(animar){
  const ecra = $('#acesso');
  if(animar){
    ecra.classList.add('fechado');
    setTimeout(() => { ecra.remove(); }, 520);
  }else{
    ecra.remove();
  }
  document.body.classList.remove('trancado');
}

function ligarAcesso(){
  if(localStorage.getItem(SESSAO) === 'aberta'){ abrirSite(false); return; }

  const form = $('#acesso-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const u = $('#utilizador').value.trim().toLowerCase();
    const p = $('#palavra').value.trim();

    if(u === UTILIZADOR && p === PALAVRA){
      if($('#lembrar').checked) localStorage.setItem(SESSAO, 'aberta');
      abrirSite(true);
      return;
    }
    const caixa = $('.acesso__caixa');
    caixa.classList.remove('treme');
    void caixa.offsetWidth;                       // reinicia a animação
    caixa.classList.add('treme');
    $('#acesso-erro').textContent = !u || !p
      ? 'Preenche os dois campos.'
      : 'Utilizador ou palavra-passe errados.';
    $('#palavra').value = '';
    $('#palavra').focus();
  });

  setTimeout(() => $('#utilizador').focus(), 300);
}

/* nomes como os escrevemos → nomes na base de emblemas da API */
const NOMES_API = {
  'sporting cp':'Sporting CP', 'benfica':'Benfica', 'sl benfica':'Benfica',
  'fc porto':'FC Porto', 'porto':'FC Porto',
  'sc braga':'SC Braga', 'braga':'SC Braga', 'sp. braga':'SC Braga',
  'v. guimaraes':'Guimaraes', 'vitoria de guimaraes':'Guimaraes', 'vitoria sc':'Guimaraes',
  'famalicao':'Famalicao', 'gil vicente':'GIL Vicente', 'maritimo':'Maritimo',
  'ac. viseu':'Academico Viseu', 'academico de viseu':'Academico Viseu',
  'estrela da amadora':'Estrela', 'estrela':'Estrela',
  'casa pia':'Casa Pia', 'rio ave':'Rio Ave', 'estoril':'Estoril', 'arouca':'Arouca',
  'moreirense':'Moreirense', 'nacional':'Nacional', 'santa clara':'Santa Clara',
  'torreense':'Torreense', 'portimonense':'Portimonense', 'boavista':'Boavista',
  'pacos de ferreira':'Pacos Ferreira', 'feirense':'Feirense', 'tondela':'Tondela'
};

function emblemaEquipa(nome){
  const alvo = NOMES_API[chaveNome(nome)];
  const caminho = alvo && FOTOS.equipas[alvo];
  return caminho || escudoIniciais(nome);
}

const eSporting = n => /sporting cp/i.test(n||'');

/* =========================================================================
   2. LEITURA DOS RSS  (feeds portugueses, links diretos)
   ========================================================================= */
async function buscarRSS(url){
  for(const proxy of CONFIG.proxies){
    try{
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), CONFIG.timeoutFeed);
      const r = await fetch(proxy + encodeURIComponent(url), {cache:'no-store', signal:ctrl.signal});
      clearTimeout(t);
      if(!r.ok) continue;
      const doc = new DOMParser().parseFromString(await r.text(), 'text/xml');
      if(doc.querySelector('parsererror')) continue;
      const itens = [...doc.querySelectorAll('item, entry')];
      if(itens.length) return itens;
    }catch(e){ /* proxy seguinte */ }
  }
  return null;
}

function imagemDoItem(it){
  const enc = it.querySelector('enclosure');
  if(enc?.getAttribute('url') && /image/i.test(enc.getAttribute('type')||'image'))
    return enc.getAttribute('url');

  for(const t of ['content','thumbnail']){
    const el = [...it.getElementsByTagName('media:' + t)][0];
    if(el?.getAttribute('url')) return el.getAttribute('url');
  }
  const corpo = it.querySelector('encoded')?.textContent
             || it.querySelector('content')?.textContent
             || it.querySelector('description')?.textContent || '';
  const m = corpo.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function limparTexto(html){
  return (html || '').replace(/<[^>]*>/g,' ').replace(/&[a-z]+;/gi,' ')
                     .replace(/\s+/g,' ').trim();
}

function classificar(n){
  if(CONFIG.filtroFormacao.test(n.titulo)) return 'FORMAÇÃO';
  if(CONFIG.filtroRumores.test(n.titulo))  return 'MERCADO';
  if(CONFIG.palavrasQuentes.test(n.titulo))return 'DESTAQUE';
  return 'EQUIPA PRINCIPAL';
}

async function lerFeed(f){
  const itens = await buscarRSS(f.url);
  if(!itens) return 0;

  const novos = itens.map(it => {
    const titulo = limparTexto(it.querySelector('title')?.textContent);
    const link = (it.querySelector('link')?.textContent
               || it.querySelector('link')?.getAttribute('href') || '').trim();
    const dt = it.querySelector('pubDate, updated, published')?.textContent;
    return {
      titulo, link,
      resumo: limparTexto(it.querySelector('description')?.textContent).slice(0,180),
      imagem: imagemDoItem(it),
      data: dt ? new Date(dt) : new Date(),
      fonte: f.nome, canal: f.id
    };
  })
  .filter(n => n.titulo.length > 14 && n.link.startsWith('http'))
  /* o clube tem de estar no TÍTULO — se procurarmos também no resumo
     entram notícias de outros clubes que só mencionam o Sporting de passagem */
  .filter(n => CONFIG.filtroSporting.test(n.titulo))
  .filter(n => !CONFIG.excluir.some(rx => rx.test(n.titulo)));

  if(!novos.length) return 0;

  novos.forEach(n => n.categoria = classificar(n));

  const mapa = new Map(NOTICIAS.map(n => [chaveNome(n.titulo).slice(0,60), n]));
  novos.forEach(n => {
    const k = chaveNome(n.titulo).slice(0,60);
    if(!mapa.has(k)) mapa.set(k, n);
  });
  const antes = NOTICIAS.length;
  NOTICIAS = [...mapa.values()].sort((a,b) => b.data - a.data).slice(0, LIMITE_ARQUIVO);
  guardarArquivo();
  return NOTICIAS.length - antes;      // quantas são mesmo novas
}

let novasDesdeVista = 0;

async function carregarNoticias(){
  let novas = 0;
  for(const f of CONFIG.feeds){
    novas += await lerFeed(f);
    pintarNoticias();
  }

  ultimaLeitura = Date.now();
  if(novas > 0) novasDesdeVista += novas;
  marcarAtualizacao(novas);

  const badge = $('#badge-alertas');
  badge.textContent = novasDesdeVista || NOTICIAS.length;
  badge.classList.toggle('vazio', !NOTICIAS.length);
  return novas;
}

let ultimaLeitura = 0;

function marcarAtualizacao(novas){
  const el = $('#feed-estado');
  if(!el) return;
  const hora = new Date(ultimaLeitura).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});
  el.innerHTML = novas > 0
    ? `<b>+${novas}</b> novas · ${hora}`
    : `sem novidades · ${hora}`;
  el.classList.toggle('brilha', novas > 0);
  if(novas > 0) setTimeout(() => el.classList.remove('brilha'), 4000);
}

/* ---- arquivo local: guarda o que já passou, para se poder recuar ---- */
const ARQUIVO = 'scp-arquivo-v1';
const LIMITE_ARQUIVO = 600;
const DIAS_ARQUIVO = 45;

function guardarArquivo(){
  try{
    localStorage.setItem(ARQUIVO, JSON.stringify({
      quando: Date.now(),
      itens: NOTICIAS.map(n => ({...n, data:n.data.toISOString()}))
    }));
  }catch(e){
    /* se encher, deita fora metade e tenta outra vez */
    try{
      NOTICIAS = NOTICIAS.slice(0, Math.floor(NOTICIAS.length/2));
      localStorage.setItem(ARQUIVO, JSON.stringify({
        quando: Date.now(),
        itens: NOTICIAS.map(n => ({...n, data:n.data.toISOString()}))
      }));
    }catch(e2){}
  }
}

function lerArquivo(){
  try{
    const c = JSON.parse(localStorage.getItem(ARQUIVO) || 'null');
    if(!c) return false;
    const limite = Date.now() - DIAS_ARQUIVO*24*3600*1000;
    NOTICIAS = c.itens.map(n => ({...n, data:new Date(n.data)}))
                      .filter(n => n.data.getTime() > limite);
    return NOTICIAS.length > 0;
  }catch(e){ return false; }
}

/* =========================================================================
   3. NOTÍCIAS NO ECRÃ
   ========================================================================= */
function haQuanto(d){
  const s = Math.floor((Date.now() - d.getTime())/1000);
  if(s < 60)    return 'agora mesmo';
  if(s < 3600)  return `há ${Math.floor(s/60)} min`;
  if(s < 86400) return `há ${Math.floor(s/3600)} h`;
  if(s < 172800)return 'ontem';
  return `há ${Math.floor(s/86400)} dias`;
}

const dataCurta = d => d.toLocaleDateString('pt-PT',{day:'2-digit',month:'short'}).toUpperCase().replace('.','');

function itemNoticia(n){
  const img = n.imagem
    ? `<img src="${n.imagem}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`
    : `<img src="${escudoIniciais('SCP')}" alt="">`;
  return `<li><a href="${n.link}" target="_blank" rel="noopener">
      ${img}
      <div>
        <div class="cat">${n.categoria} <i>· ${dataCurta(n.data)} · ${n.fonte}</i></div>
        <h4>${n.titulo}</h4>
        <p>${n.resumo || ''}</p>
      </div>
    </a></li>`;
}

/* mostra a lista com uma barra por dia, para se perceber o recuo no tempo */
let mostradas = 40;

function agruparPorDia(lista){
  let saida = '', diaAtual = '';
  const hoje = new Date().toDateString();
  const ontem = new Date(Date.now()-86400000).toDateString();

  lista.forEach(n => {
    const d = n.data.toDateString();
    if(d !== diaAtual){
      diaAtual = d;
      const rotulo = d === hoje ? 'HOJE'
                   : d === ontem ? 'ONTEM'
                   : n.data.toLocaleDateString('pt-PT',
                       {weekday:'long', day:'2-digit', month:'long'}).toUpperCase();
      saida += `<li class="dia"><span>${rotulo}</span></li>`;
    }
    saida += itemNoticia(n);
  });
  return saida;
}

function noticiasFiltradas(){
  let l = NOTICIAS;
  if(filtroFonte !== 'todas') l = l.filter(n => n.canal === filtroFonte);
  if(procuraTexto){
    const q = semAcentos(procuraTexto);
    l = l.filter(n => semAcentos(n.titulo + ' ' + n.resumo).includes(q));
  }
  return l;
}

function pintarNoticias(){
  const vazio = `<li class="vazio">Sem notícias de momento.<br>
     Arranca com <b>python servidor.py</b> para ler os feeds sem bloqueios.</li>`;

  const curtas = NOTICIAS.filter(n => n.categoria !== 'MERCADO').slice(0,6);
  $('#noticias-curtas').innerHTML = curtas.length ? curtas.map(itemNoticia).join('') : vazio;

  const todas = noticiasFiltradas();
  $('#noticias-todas').innerHTML = todas.length
    ? agruparPorDia(todas.slice(0, mostradas))
    : `<li class="vazio">Nada encontrado${procuraTexto ? ' para «'+procuraTexto+'»' : ''}.</li>`;

  const btn = $('#mais-antigas');
  if(btn){
    const restam = todas.length - mostradas;
    btn.hidden = restam <= 0;
    btn.textContent = `VER MAIS ANTIGAS (${restam})`;
  }
  const cont = $('#noticias-conta');
  if(cont) cont.textContent = todas.length
    ? `${todas.length} notícias · desde ${dataCurta(todas[todas.length-1].data)}`
    : '';

  const rumores = NOTICIAS.filter(n => n.categoria === 'MERCADO');
  $('#rumores-todos').innerHTML = rumores.length ? rumores.slice(0,40).map(itemNoticia).join('') : vazio;
  $('#rumores-curtos').innerHTML = rumores.slice(0,3).map(n => `
    <li><a href="${n.link}" target="_blank" rel="noopener">
      <img src="${n.imagem || escudoIniciais('SCP')}" alt="" loading="lazy"
           onerror="this.src='${escudoIniciais('SCP')}'">
      <div><b>${n.titulo}</b><span>${haQuanto(n.data).toUpperCase()} · ${n.fonte}</span></div>
    </a></li>`).join('') || `<li class="vazio">Sem rumores agora.</li>`;

  const formacao = NOTICIAS.filter(n => n.categoria === 'FORMAÇÃO');
  $('#formacao-lista').innerHTML = formacao.length
    ? formacao.map(itemNoticia).join('')
    : `<li class="vazio">Sem notícias da formação neste momento.</li>`;

  pintarFontes();
  pintarDestaque();
  pintarLinhaTempo();
}

function pintarFontes(){
  const usadas = [...new Set(NOTICIAS.map(n => n.canal))];
  const caixa = $('#fontes-filtro');
  if(caixa.dataset.n === String(usadas.length)) return;
  caixa.dataset.n = usadas.length;
  caixa.innerHTML = `<button class="pilula ${filtroFonte==='todas'?'is-on':''}" data-fonte="todas">TODAS</button>` +
    usadas.map(id => {
      const f = CONFIG.feeds.find(x => x.id === id);
      return `<button class="pilula ${filtroFonte===id?'is-on':''}" data-fonte="${id}">${f?f.nome:id}</button>`;
    }).join('');
  $$('#fontes-filtro .pilula').forEach(b => b.addEventListener('click', () => {
    filtroFonte = b.dataset.fonte;
    caixa.dataset.n = '';
    pintarNoticias();
  }));
}

/* ---------------- destaque rotativo ---------------- */
let destaqueIdx = 0, destaqueTimer = null;

function pintarDestaque(){
  const alvo = $('#destaque');
  const lista = NOTICIAS.filter(n => n.imagem).slice(0,5);
  if(!lista.length){
    alvo.innerHTML = `<div class="destaque__vazio">sem destaques</div>`;
    $('#destaque-pontos').innerHTML = '';
    return;
  }
  if(alvo.dataset.chave === lista.map(n=>n.link).join()) return;
  alvo.dataset.chave = lista.map(n=>n.link).join();

  alvo.innerHTML = lista.map((n,i) => `
    <article class="dst ${i===0?'is-on':''}" data-i="${i}">
      <div class="dst__foto" style="background-image:url('${n.imagem}')"></div>
      <div class="dst__veu"></div>
      <div class="dst__txt">
        <span class="etiqueta">DESTAQUE</span>
        <div class="dst__meta">${n.categoria} · ${dataCurta(n.data)} · ${n.fonte}</div>
        <h3>${n.titulo}</h3>
        <p>${n.resumo || ''}</p>
        <a class="dst__ler" href="${n.link}" target="_blank" rel="noopener">LER NOTÍCIA</a>
      </div>
    </article>`).join('');

  $('#destaque-pontos').innerHTML = lista.map((_,i) =>
    `<i class="${i===0?'is-on':''}" data-i="${i}"></i>`).join('');
  $$('#destaque-pontos i').forEach(p =>
    p.addEventListener('click', () => mostrarDestaque(+p.dataset.i)));

  destaqueIdx = 0;
  clearInterval(destaqueTimer);
  destaqueTimer = setInterval(() => mostrarDestaque(destaqueIdx + 1), 7000);
}

function mostrarDestaque(i){
  const cartoes = $$('.dst');
  if(!cartoes.length) return;
  destaqueIdx = ((i % cartoes.length) + cartoes.length) % cartoes.length;
  cartoes.forEach((c,k) => c.classList.toggle('is-on', k === destaqueIdx));
  $$('#destaque-pontos i').forEach((p,k) => p.classList.toggle('is-on', k === destaqueIdx));
}

/* ---------------- ao minuto ---------------- */
function pintarLinhaTempo(){
  const filtro = $('#minuto-filtro').value;
  let l = NOTICIAS;
  if(filtro === 'quente')  l = l.filter(n => n.categoria === 'DESTAQUE');
  if(filtro === 'mercado') l = l.filter(n => n.categoria === 'MERCADO');

  const evento = (n,i) => {
    const classe = n.categoria === 'DESTAQUE' ? 'ev--quente'
                 : n.categoria === 'MERCADO'  ? 'ev--mercado' : '';
    return `<li class="ev ${classe}" style="animation-delay:${i*.03}s">
      <span class="ev__hora">${n.data.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})}</span>
      <span class="ev__marca"><i class="ev__bola"></i><i class="ev__linha"></i></span>
      <span class="ev__txt">
        <a href="${n.link}" target="_blank" rel="noopener"><b>${n.titulo}</b></a>
        <span class="ev__fonte">${n.fonte} · ${haQuanto(n.data)}</span>
      </span>
    </li>`;
  };

  $('#linha-tempo').innerHTML = l.length
    ? l.slice(0,12).map(evento).join('')
    : `<li class="vazio">sem eventos</li>`;
  $('#linha-tempo-total').innerHTML = l.length
    ? l.slice(0,80).map(evento).join('')
    : `<li class="vazio">sem eventos</li>`;
}

/* =========================================================================
   3b. LEITOR — abre a notícia dentro do site
   O servidor.py vai buscar o artigo, tira-lhe os scripts e devolve-o.
   Se o jornal não deixar, fica o botão para abrir no site original.
   ========================================================================= */
function abrirLeitor(link, titulo, fonte){
  const leitor = $('#leitor');
  $('#leitor-titulo').textContent = titulo || '';
  $('#leitor-fonte').textContent = fonte || 'ARTIGO';
  $('#leitor-externo').href = link;
  $('#leitor-carga').classList.remove('escondido');
  $('#leitor-quadro').src = '/ler?url=' + encodeURIComponent(link);
  leitor.hidden = false;
  document.body.style.overflow = 'hidden';
}

function fecharLeitor(){
  $('#leitor').hidden = true;
  $('#leitor-quadro').src = 'about:blank';
  document.body.style.overflow = '';
}

function ligarLeitor(){
  /* qualquer ligação de notícia passa a abrir aqui dentro */
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="http"]');
    if(!a) return;
    if(!a.closest('.lista-noticias, .lista-rumores, .linha-tempo, .dst')) return;
    e.preventDefault();

    const cartao = a.closest('li, article');
    const titulo = a.querySelector('h4, b')?.textContent
                || cartao?.querySelector('h3, h4, b')?.textContent || a.textContent;
    const fonte = cartao?.querySelector('.cat i, .ev__fonte, .dst__meta')?.textContent
                || 'ARTIGO';
    abrirLeitor(a.href, titulo.trim(), fonte.replace(/^·\s*/,'').trim());
  });

  $('#leitor-fechar').addEventListener('click', fecharLeitor);
  $('#leitor-recuar').addEventListener('click', () => {
    $('#leitor-quadro').src = $('#leitor-quadro').src;
  });
  $('#leitor-quadro').addEventListener('load', () =>
    $('#leitor-carga').classList.add('escondido'));
  addEventListener('keydown', e => {
    if(e.key === 'Escape' && !$('#leitor').hidden) fecharLeitor();
  });
}

/* =========================================================================
   4. JOGOS
   ========================================================================= */
const jogado = j => j.golosCasa !== undefined && j.golosFora !== undefined;

function resultadoSCP(j){
  if(!jogado(j)) return null;
  const casa = eSporting(j.casa);
  const nos = casa ? j.golosCasa : j.golosFora;
  const deles = casa ? j.golosFora : j.golosCasa;
  return { nos, deles, r: nos>deles ? 'V' : nos===deles ? 'E' : 'D' };
}

const porJogar = () => JOGOS.filter(j => !jogado(j) && new Date(j.data) > Date.now())
                            .sort((a,b) => new Date(a.data)-new Date(b.data));

let jogoIdx = 0, contaTimer = null;

function pintarProximoJogo(){
  const lista = porJogar();
  const alvo = $('#proximo-jogo');
  if(!lista.length){ alvo.innerHTML = `<div class="vazio">sem jogos agendados</div>`; return; }

  jogoIdx = Math.max(0, Math.min(jogoIdx, lista.length-1));
  const j = lista[jogoIdx];
  const d = new Date(j.data);

  alvo.innerHTML = `
    <div class="jogo__comp">${j.comp}</div>
    <div class="jogo__equipas">
      <div class="jogo__eq"><img src="${emblemaEquipa(j.casa)}" alt=""><span>${j.casa.toUpperCase()}</span></div>
      <div class="jogo__x">X</div>
      <div class="jogo__eq"><img src="${emblemaEquipa(j.fora)}" alt=""><span>${j.fora.toUpperCase()}</span></div>
    </div>
    <div class="jogo__quando">${d.toLocaleDateString('pt-PT',{day:'2-digit',month:'long',year:'numeric'}).toUpperCase()} · ${d.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})}</div>
    <div class="jogo__onde">${(j.local||'').toUpperCase()}</div>
    <div class="jogo__conta">
      <div><b id="c-d">00</b><i>DIAS</i></div>
      <div><b id="c-h">00</b><i>HORAS</i></div>
      <div><b id="c-m">00</b><i>MIN</i></div>
      <div><b id="c-s">00</b><i>SEG</i></div>
    </div>`;

  clearInterval(contaTimer);
  const tick = () => {
    let s = Math.max(0, Math.floor((new Date(j.data) - Date.now())/1000));
    const p = n => String(n).padStart(2,'0');
    const el = id => document.getElementById(id);
    if(!el('c-d')) return clearInterval(contaTimer);
    el('c-d').textContent = p(Math.floor(s/86400));
    el('c-h').textContent = p(Math.floor(s%86400/3600));
    el('c-m').textContent = p(Math.floor(s%3600/60));
    el('c-s').textContent = p(s%60);
  };
  tick();
  contaTimer = setInterval(tick, 1000);
}

function pintarCalendario(){
  $('#calendario').innerHTML = porJogar().slice(0,4).map(j => {
    const d = new Date(j.data);
    return `<li>
      <div class="cal-data"><b>${d.getDate()}</b><i>${d.toLocaleDateString('pt-PT',{month:'short'}).toUpperCase().replace('.','')}</i></div>
      <div class="cal-jogo">
        <div class="comp">${j.comp}</div>
        <div class="eqs">${j.casa} x ${j.fora}</div>
      </div>
      <div class="cal-hora">${d.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})}</div>
    </li>`;
  }).join('') || `<li class="vazio">sem jogos</li>`;
}

function pintarResultados(){
  const feitos = JOGOS.filter(jogado).slice(-5).reverse();
  $('#resultados').innerHTML = feitos.map(j => {
    const r = resultadoSCP(j);
    const cor = r.r === 'V' ? 'res-v' : r.r === 'D' ? 'res-d' : '';
    const d = new Date(j.data);
    const golos = [...(j.marcadoresCasa||[]), ...(j.marcadoresFora||[])];
    return `<li>
      <span class="res-data">${dataCurta(d)}</span>
      <span class="res-eq"><img src="${emblemaEquipa(j.casa)}" alt=""><span>${j.casa}</span></span>
      <span class="res-golos ${cor}">${j.golosCasa} - ${j.golosFora}</span>
      <span class="res-eq res-eq--d"><img src="${emblemaEquipa(j.fora)}" alt=""><span>${j.fora}</span></span>
      <span class="res-comp">${j.comp.split('—')[0].trim()}</span>
      ${golos.length ? `<span class="res-golead">${golos.map(g => `${g.nome} ${g.minuto}'`).join(' · ')}</span>` : ''}
    </li>`;
  }).join('') || `<li class="vazio">sem resultados</li>`;
}

/* marcadores em texto: "Pote 12', 45'  ·  Suárez 61' (g.p.)" */
function textoMarcadores(lista){
  if(!lista || !lista.length) return '';
  const juntos = {};
  lista.forEach(m => (juntos[m.nome] ||= []).push(
    m.minuto + "'" + (m.tipo === 'gp' ? ' (g.p.)' : m.tipo === 'ag' ? ' (a.g.)' : '')));
  return Object.entries(juntos)
               .map(([n,mins]) => `${n} ${mins.join(', ')}`)
               .join(' · ');
}

function detalheJogo(j){
  const r = resultadoSCP(j);
  const partes = [];
  if(j.publico) partes.push(`${j.publico} espetadores`);
  if(j.arbitro) partes.push(`árbitro: ${j.arbitro}`);
  if(j.local)   partes.push(j.local);

  const mc = textoMarcadores(j.marcadoresCasa);
  const mf = textoMarcadores(j.marcadoresFora);
  const totalGolos = (j.golosCasa || 0) + (j.golosFora || 0);

  return `<div class="jl-detalhe">
    ${(mc || mf) ? `
      <div class="golos">
        <div class="golos__lado"><b>${j.casa}</b><span>${mc || '—'}</span></div>
        <div class="golos__bola">⚽</div>
        <div class="golos__lado golos__lado--d"><b>${j.fora}</b><span>${mf || '—'}</span></div>
      </div>` : `<div class="jl-vazio">
        Sem marcadores para este jogo.<br>
        Os particulares de pré-época não têm ficha publicada — a partir da
        1.ª jornada aparecem aqui os golos, os minutos, a assistência e o árbitro.
      </div>`}

    <div class="jl-numeros">
      <div><label>RESULTADO</label><b class="${r.r==='V'?'res-v':r.r==='D'?'res-d':''}">${r.r === 'V' ? 'Vitória' : r.r === 'E' ? 'Empate' : 'Derrota'}</b></div>
      <div><label>GOLOS A FAVOR</label><b>${r.nos}</b></div>
      <div><label>GOLOS SOFRIDOS</label><b>${r.deles}</b></div>
      <div><label>DIFERENÇA</label><b>${r.nos - r.deles > 0 ? '+' : ''}${r.nos - r.deles}</b></div>
      <div><label>GOLOS NO JOGO</label><b>${totalGolos}</b></div>
      ${j.publico ? `<div><label>ASSISTÊNCIA</label><b>${j.publico}</b></div>` : ''}
    </div>

    ${partes.length ? `<div class="jl-extra">${partes.join(' · ')}</div>` : ''}
  </div>`;
}

function pintarJogosTodos(){
  const feitos = JOGOS.filter(jogado);
  const r = feitos.map(resultadoSCP);
  $('#jogos-resumo').textContent =
    `${feitos.length} jogados · ${r.filter(x=>x.r==='V').length}V ${r.filter(x=>x.r==='E').length}E ${r.filter(x=>x.r==='D').length}D`;

  $('#jogos-lista').innerHTML = JOGOS.map((j,i) => {
    const d = new Date(j.data);
    const res = resultadoSCP(j);
    const cor = res ? (res.r==='V'?'res-v':res.r==='D'?'res-d':'') : '';
    return `<li class="${res ? 'tem-detalhe' : ''}" data-jogo="${i}">
      <span class="jl-data">${d.toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit',year:'2-digit'})}</span>
      <span class="jl-comp">${j.comp}</span>
      <span class="res-eq"><img src="${emblemaEquipa(j.casa)}" alt=""><span>${j.casa}</span></span>
      <span class="jl-res ${cor}">${jogado(j) ? j.golosCasa+' - '+j.golosFora
        : d.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})}</span>
      <span class="res-eq"><img src="${emblemaEquipa(j.fora)}" alt=""><span>${j.fora}</span></span>
      <span class="jl-por">${res ? '<i class="jl-abre">ver ficha ▾</i>' : (j.local||'').split(',')[0]}</span>
    </li>`;
  }).join('');

  $$('#jogos-lista li.tem-detalhe').forEach(li => li.addEventListener('click', () => {
    const j = JOGOS[+li.dataset.jogo];
    const aberto = li.nextElementSibling?.classList.contains('jl-linha-detalhe');
    $$('#jogos-lista .jl-linha-detalhe').forEach(x => x.remove());
    $$('#jogos-lista li').forEach(x => x.classList.remove('aberta'));
    if(aberto) return;
    li.classList.add('aberta');
    li.insertAdjacentHTML('afterend',
      `<li class="jl-linha-detalhe">${detalheJogo(j)}</li>`);
  }));
}

/* =========================================================================
   5. CLASSIFICAÇÃO
   ========================================================================= */
function pintarTabela(){
  const comecou = TABELA.some(t => t.j > 0);
  $('#tabela-nota').textContent = comecou
    ? 'Liga Portugal Betclic ' + CONFIG.epoca
    : 'ordem alfabética — a época começa a 7 de agosto';

  $('#tabela-curta tbody').innerHTML = TABELA.slice(0,5).map(t => `
    <tr class="${eSporting(t.equipa)?'eu':''}">
      <td class="np">${t.pos}</td>
      <td><span class="eq"><img src="${emblemaEquipa(t.equipa)}" alt="">${t.equipa}</span></td>
      <td>${t.j}</td><td>${t.gm - t.gs}</td><td class="pts">${t.p}</td>
    </tr>`).join('');

  $('#tabela-total tbody').innerHTML = TABELA.map(t => `
    <tr class="${eSporting(t.equipa)?'eu':''}">
      <td class="np">${t.pos}</td>
      <td><span class="eq"><img src="${emblemaEquipa(t.equipa)}" alt="">${t.equipa}</span></td>
      <td>${t.j}</td><td>${t.v}</td><td>${t.e}</td><td>${t.d}</td>
      <td>${t.gm}</td><td>${t.gs}</td><td>${t.gm - t.gs}</td><td class="pts">${t.p}</td>
    </tr>`).join('');
}

/* =========================================================================
   6. PLANTEL
   ========================================================================= */
function ligarFotos(){
  const porNome = new Map();
  const porApelido = new Map();
  FOTOS.jogadores.forEach(j => {
    porNome.set(chaveNome(j.nome), j);
    const a = apelido(j.nome);
    if(!porApelido.has(a)) porApelido.set(a, []);
    porApelido.get(a).push(j);
  });

  const alcunhasApi = { 'pedro goncalves':'pote' };

  PLANTEL.forEach(p => {
    const k = chaveNome(p.nome);
    let achado = porNome.get(k)
              || (alcunhasApi[k] && porNome.get(alcunhasApi[k]));

    if(!achado){
      const iguais = porApelido.get(apelido(p.nome)) || [];
      achado = iguais.length === 1
        ? iguais[0]
        : iguais.find(j => chaveNome(j.nome)[0] === k[0]);
    }
    p.foto = achado ? achado.foto : avatarJogador(p);
    p.apiId = achado ? achado.id : null;
    if(achado && p.idade == null) p.idade = achado.idade;
  });
}

/* -------------------------------------------------------------------------
   CARREIRA — épocas passadas, vindas da API-Football através do servidor.
   O plano gratuito só dá 2022, 2023 e 2024, e o servidor guarda em cache,
   por isso cada jogador só é pedido uma vez.
   ------------------------------------------------------------------------- */
const carreiraCache = new Map();

async function buscarCarreira(id){
  if(carreiraCache.has(id)) return carreiraCache.get(id);

  const linhas = [];
  for(const epoca of EPOCAS_API){
    try{
      const p = `players?id=${id}&season=${epoca}`;
      const r = await fetch('/api?p=' + encodeURIComponent(p), {cache:'no-store'});
      if(!r.ok) continue;
      const d = await r.json();
      const jog = d.response?.[0];
      if(!jog) continue;
      (jog.statistics || []).forEach(s => {
        const jogos = s.games?.appearences || 0;
        if(!jogos) return;                       // salta convocatórias sem jogos
        linhas.push({
          epoca,
          clube: s.team?.name || '—',
          clubeLogo: s.team?.logo || '',
          prova: s.league?.name || '—',
          jogos,
          golos: s.goals?.total || 0,
          assist: s.goals?.assists || 0,
          minutos: s.games?.minutes || 0,
          rating: s.games?.rating ? Number(s.games.rating).toFixed(2) : null
        });
      });
    }catch(e){ /* passa à época seguinte */ }
  }
  carreiraCache.set(id, linhas);
  return linhas;
}

function pintarCarreira(linhas){
  const alvo = $('#carreira-corpo');
  if(!alvo) return;

  if(!linhas.length){
    alvo.innerHTML = `<div class="esperar">Sem registos nas épocas que a API disponibiliza.</div>`;
    return;
  }

  /* A API mete, em cada época, uma linha com o total da época etiquetada
     como se fosse uma prova qualquer (às vezes "Super Cup", às vezes
     "Taça da Liga"). Se a somássemos, o total vinha a dobrar.
     Reconhece-se assim: tem mais minutos do que todas as outras juntas. */
  const porEpoca = {};
  linhas.forEach(l => (porEpoca[l.epoca] ||= []).push(l));
  Object.values(porEpoca).forEach(grupo => {
    if(grupo.length < 2) return;
    const total = grupo.reduce((s,l) => s + l.minutos, 0);
    grupo.forEach(l => { l.agregado = l.minutos > total - l.minutos; });
  });

  const reais = linhas.filter(l => !l.agregado);
  const t = reais.reduce((a,l) => ({
    jogos:a.jogos+l.jogos, golos:a.golos+l.golos,
    assist:a.assist+l.assist, minutos:a.minutos+l.minutos
  }), {jogos:0, golos:0, assist:0, minutos:0});

  alvo.innerHTML = `
    <table>
      <thead><tr><th>ÉPOCA</th><th>CLUBE / PROVA</th><th>J</th><th>G</th><th>A</th><th>MIN</th><th>NOTA</th></tr></thead>
      <tbody>
        ${linhas.map(l => `<tr class="${l.agregado ? 'agregado' : ''}">
          <td class="ep">${l.epoca}</td>
          <td>
            <span class="clube">${l.clubeLogo ? `<img src="${l.clubeLogo}" alt="" loading="lazy">` : ''}${l.clube}</span>
            <span class="comp">${l.agregado ? 'todas as provas da época' : l.prova}</span>
          </td>
          <td>${l.jogos}</td><td>${l.golos}</td><td>${l.assist}</td>
          <td>${l.minutos.toLocaleString('pt-PT')}</td>
          <td>${l.rating ?? '—'}</td>
        </tr>`).join('')}
        <tr class="total">
          <td></td><td>TOTAL POR PROVA</td>
          <td>${t.jogos}</td><td>${t.golos}</td><td>${t.assist}</td>
          <td>${t.minutos.toLocaleString('pt-PT')}</td><td></td>
        </tr>
      </tbody>
    </table>`;
}

function pintarPlantel(){
  const lista = filtroPos === 'todos' ? PLANTEL : PLANTEL.filter(p => p.posGrupo === filtroPos);

  $('#plantel').innerHTML = lista.map(p => `
    <button class="jog ${p.nome===escolhido?'is-on':''}" data-nome="${p.nome}">
      <span class="jog__n">${p.n ?? '–'}</span>
      <img src="${p.foto}" alt="${p.nome}" loading="lazy"
           onerror="this.onerror=null;this.src='${avatarJogador(p)}'">
      <span class="jog__txt">
        <b>${ALCUNHAS[p.nome] || p.nome}</b>
        <span>${p.pos} · ${p.nac}</span>
        <span class="jog__mini"><span>${p.stats.jogos} jogos</span><span>${p.stats.golos} golos</span></span>
      </span>
    </button>`).join('');

  $$('.jog').forEach(b => b.addEventListener('click', () => {
    mostrarFicha(PLANTEL.find(p => p.nome === b.dataset.nome));
    $$('.jog').forEach(x => x.classList.toggle('is-on', x === b));
  }));
}

function mostrarFicha(p){
  if(!p) return;
  escolhido = p.nome;
  const perfil = PERFIS[p.nome] || PERFIL_BASE[p.posGrupo];
  const s = p.stats;
  const kpis = [
    ['JOGOS', s.jogos], ['GOLOS', s.golos],
    ['GOLOS/JOGO', s.jogos ? (s.golos/s.jogos).toFixed(2) : '0.00'],
    ['IDADE', p.idade ?? '—'], ['Nº', p.n ?? '–']
  ];
  const rotulos = {fin:'FINALIZAÇÃO',passe:'PASSE',drible:'DRIBLE',defesa:'DEFESA',fisico:'FÍSICO',vel:'VELOCIDADE'};

  $('#ficha').innerHTML = `
    <div class="ficha__foto">
      <img src="${p.foto}" alt="${p.nome}" onerror="this.onerror=null;this.src='${avatarJogador(p)}'">
      <span class="ficha__num">${p.n ?? ''}</span>
    </div>
    <div class="ficha__dados">
      <h3>${ALCUNHAS[p.nome] ? p.nome + ' «' + ALCUNHAS[p.nome] + '»' : p.nome}</h3>
      <div class="ficha__sub">${p.pos} · ${p.nac} · ${p.idade ?? '—'} anos
        ${p.nota ? '<em>'+p.nota+'</em>' : ''}</div>
      <div class="valor-mercado">
        <b>${VALOR_MERCADO[p.nome] != null ? milhoes(VALOR_MERCADO[p.nome]) : 'n.d.'}</b>
        <span>VALOR DE MERCADO · TRANSFERMARKT</span>
      </div>
      <div class="ficha__kpis">
        ${kpis.map(([l,v]) => `<div class="caixa"><b>${v}</b><label>${l}</label></div>`).join('')}
      </div>
      <div class="ficha__baixo">
        <div class="ficha__radar">
          <svg viewBox="0 0 200 200" id="radar"></svg>
          <span class="leg">PERFIL · leitura própria, não é estatística</span>
        </div>
        <div id="barras">
          ${Object.entries(perfil).map(([k,v]) => `
            <div class="barra">
              <label><span>${rotulos[k]}</span><b>${v}</b></label>
              <div class="via"><div class="cheia" data-w="${v}"></div></div>
            </div>`).join('')}
        </div>
      </div>

      <div class="carreira">
        <div class="carreira__topo">
          <h4>CARREIRA — ÉPOCAS ANTERIORES</h4>
          <span class="carreira__nota">API-Football · 2022 a 2024</span>
        </div>
        <div id="carreira-corpo"><div class="esperar">a carregar…</div></div>
      </div>
    </div>`;

  desenharRadar(perfil);
  setTimeout(() => $$('#barras .cheia').forEach(b => b.style.width = b.dataset.w + '%'), 60);

  if(p.apiId){
    buscarCarreira(p.apiId).then(linhas => {
      if(escolhido === p.nome) pintarCarreira(linhas);   // só se ainda for este
    });
  }else{
    pintarCarreira([]);
  }
}

/* 30 → "30 M€" · 7.25 → "7,25 M€" · 0 → "livre" */
function milhoes(v){
  if(v == null) return 'n.d.';
  if(v === 0) return '—';
  const s = Number(v).toFixed(2).replace(/\.?0+$/,'').replace('.',',');
  return s + ' M€';
}

function desenharRadar(attrs){
  const ks = Object.keys(attrs), n = ks.length, cx=100, cy=100, R=68;
  const pt = (i,r) => { const a = Math.PI*2*i/n - Math.PI/2;
                        return [cx+Math.cos(a)*r, cy+Math.sin(a)*r]; };
  let svg = '';
  [.25,.5,.75,1].forEach(f => {
    svg += `<polygon points="${ks.map((_,i)=>pt(i,R*f).map(v=>v.toFixed(1)).join(',')).join(' ')}"
             fill="none" stroke="#232a26"/>`;
  });
  ks.forEach((_,i) => { const [x,y]=pt(i,R);
    svg += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#232a26"/>`; });
  svg += `<polygon points="${ks.map((k,i)=>pt(i,R*attrs[k]/100).map(v=>v.toFixed(1)).join(',')).join(' ')}"
           fill="rgba(47,217,138,.25)" stroke="#2fd98a" stroke-width="2"/>`;
  ks.forEach((k,i) => { const [x,y]=pt(i,R*attrs[k]/100);
    svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#2fd98a"/>`; });
  const curto = {fin:'FIN',passe:'PAS',drible:'DRB',defesa:'DEF',fisico:'FIS',vel:'VEL'};
  ks.forEach((k,i) => { const [x,y]=pt(i,R+16);
    svg += `<text x="${x.toFixed(1)}" y="${(y+3).toFixed(1)}" text-anchor="middle"
             font-size="9" fill="#64726b" font-family="Inter,sans-serif">${curto[k]}</text>`; });
  const el = $('#radar');
  if(el) el.innerHTML = svg;
}

/* =========================================================================
   7. ESTATÍSTICAS
   ========================================================================= */
function pintarEstatisticas(){
  const marcadores = PLANTEL.filter(p => p.stats.golos > 0)
                            .sort((a,b) => b.stats.golos - a.stats.golos).slice(0,5);
  $('#marcadores').innerHTML = marcadores.length
    ? marcadores.map(p => `<li>
        <img src="${p.foto}" alt="" onerror="this.onerror=null;this.src='${avatarJogador(p)}'">
        <span>${ALCUNHAS[p.nome] || p.nome}</span><b>${p.stats.golos}</b></li>`).join('')
    : `<li class="vazio">Sem golos registados — a época começa a 8 de agosto.</li>`;

  const feitos = JOGOS.filter(jogado);
  const r = feitos.map(resultadoSCP);
  const gm = r.reduce((s,x)=>s+x.nos,0), gs = r.reduce((s,x)=>s+x.deles,0);
  const v = r.filter(x=>x.r==='V').length;
  const cs = r.filter(x=>x.deles===0).length;
  const n = feitos.length;

  const caixas = [
    ['GOLOS<br>MARCADOS', gm, n ? (gm/n).toFixed(1)+' por jogo' : ''],
    ['GOLOS<br>SOFRIDOS', gs, n ? (gs/n).toFixed(1)+' por jogo' : ''],
    ['VITÓRIAS', v + '/' + n, n ? Math.round(v/n*100)+'%' : ''],
    ['SEM<br>SOFRER', cs, n ? Math.round(cs/n*100)+'%' : '']
  ];
  const html = caixas.map(([l,val,sub]) =>
    `<div class="caixa"><label>${l}</label><b>${val}</b><i>${sub}</i></div>`).join('');
  $('#caixas-equipa').innerHTML = html;
  $('#caixas-equipa-total').innerHTML = html;

  $('#tabela-jogadores tbody').innerHTML = [...PLANTEL]
    .sort((a,b) => b.stats.golos - a.stats.golos || b.stats.jogos - a.stats.jogos)
    .map(p => `<tr>
      <td><img src="${p.foto}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${avatarJogador(p)}'"></td>
      <td><b>${ALCUNHAS[p.nome] || p.nome}</b></td>
      <td>${p.pos}</td><td>${p.n ?? '–'}</td>
      <td>${p.stats.jogos}</td><td><b>${p.stats.golos}</b></td>
    </tr>`).join('');
}

/* =========================================================================
   8. MERCADO E CLUBE
   ========================================================================= */
function pintarMercado(){
  const soma  = l => l.reduce((t,x) => t + (x.valor || 0), 0);
  const bonus = l => l.reduce((t,x) => t + (x.bonus || 0), 0);

  const gasto  = soma(ENTRADAS),  gastoB  = bonus(ENTRADAS);
  const encaixe= soma(SAIDAS),    encaixeB= bonus(SAIDAS);
  const saldo  = encaixe - gasto;

  const linha = (x, ondeCampo) => `
    <li>
      <span class="mv__nome">${x.nome}<i>${x[ondeCampo]}${x.nota ? ' · ' + x.nota : ''}</i></span>
      <b>${x.valor ? milhoes(x.valor) : (x.nota === 'empréstimo' ? 'cedência' : 'livre')}</b>
    </li>`;

  $('#mercado').innerHTML = `
    <div class="mv mv--in">
      <h4>▲ ENTRARAM (${ENTRADAS.length})</h4>
      <ul>${ENTRADAS.map(e => linha(e,'origem')).join('')}</ul>
      <div class="mv__soma"><span>INVESTIDO</span><b>${milhoes(gasto)}</b></div>
      ${gastoB ? `<div class="mv__soma" style="border:none;padding-top:2px;margin-top:0">
         <span>+ OBJETIVOS</span><i style="font-style:normal;color:var(--texto-3)">${milhoes(gastoB)}</i></div>` : ''}
    </div>

    <div class="mv mv--out">
      <h4>▼ SAÍRAM (${SAIDAS.length})</h4>
      <ul>${SAIDAS.map(s => linha(s,'destino')).join('')}</ul>
      <div class="mv__soma"><span>ENCAIXADO</span><b>${milhoes(encaixe)}</b></div>
      ${encaixeB ? `<div class="mv__soma" style="border:none;padding-top:2px;margin-top:0">
         <span>+ OBJETIVOS</span><i style="font-style:normal;color:var(--texto-3)">${milhoes(encaixeB)}</i></div>` : ''}
    </div>

    <div class="saldo">
      <span>SALDO DO MERCADO</span>
      <b class="${saldo >= 0 ? 'pos' : 'neg'}">${saldo >= 0 ? '+' : '−'}${milhoes(Math.abs(saldo))}</b>
      <i>${milhoes(encaixe)} a entrar · ${milhoes(gasto)} a sair · valores fixos</i>
    </div>`;
}

function pintarClube(){
  $('#clube').innerHTML = `
    <div class="clube__bloco"><h4>FUNDAÇÃO</h4><p>${CLUBE.fundacao}</p></div>
    <div class="clube__bloco"><h4>ESTÁDIO</h4><p>${CLUBE.estadio}<br><span style="color:var(--texto-3)">${CLUBE.lugares} lugares</span></p></div>
    <div class="clube__bloco"><h4>TREINADOR</h4><p>${CLUBE.treinador || CONFIG.treinador}</p></div>
    <div class="clube__bloco"><h4>CORES</h4><p>${CLUBE.cores}</p></div>
    <div class="clube__bloco" style="grid-column:span 2"><h4>PALMARÉS</h4><ul>
      ${CLUBE.titulos.map(([t,n]) => `<li>${t}<b>${n}</b></li>`).join('')}</ul></div>`;
}

/* =========================================================================
   9. SINCRONIZAÇÃO (Wikipédia)
   ========================================================================= */
const chaveJogo = j => chaveNome(j.casa) + '|' + chaveNome(j.fora);

async function sincronizar(){
  const marca = $('#estado-dados');
  marca.textContent = 'a sincronizar…';
  marca.className = 'menu__estado';
  const falhas = [];

  try{
    TABELA = await Wiki.classificacao();
    pintarTabela();
  }catch(e){ falhas.push('classificação'); }

  try{
    const { plantel, stats, jogos } = await Wiki.sincronizarSporting();

    if(plantel.length){
      PLANTEL = plantel.map(p => {
        const chave = Object.keys(stats).find(k => chaveNome(k) === chaveNome(p.nome));
        return {...p, stats: stats[chave] || {jogos:0, golos:0}, idade:null};
      });
      ligarFotos();
      pintarPlantel();
      mostrarFicha(PLANTEL.find(p => p.nome === escolhido)
                || PLANTEL.find(p => ALCUNHAS[p.nome] === 'Pote') || PLANTEL[0]);
    }

    if(jogos.length){
      const mapa = new Map(JOGOS.map(j => [chaveJogo(j), j]));
      jogos.forEach(j => mapa.set(chaveJogo(j), {...(mapa.get(chaveJogo(j))||{}), ...j}));
      JOGOS = [...mapa.values()].sort((a,b) => new Date(a.data) - new Date(b.data));
    }

    pintarProximoJogo(); pintarCalendario(); pintarResultados();
    pintarJogosTodos(); pintarEstatisticas();
  }catch(e){ falhas.push('plantel/jogos'); }

  const hora = new Date().toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});
  if(!falhas.length){ marca.textContent = `dados reais · ${hora}`; marca.className = 'menu__estado ok'; }
  else if(falhas.length === 1){ marca.textContent = `parcial: falhou ${falhas[0]}`; marca.className = 'menu__estado aviso'; }
  else { marca.textContent = 'offline · dados locais'; marca.className = 'menu__estado erro'; }
}

/* =========================================================================
   10. NAVEGAÇÃO
   ========================================================================= */
function irPara(vista){
  vistaAtual = vista;
  $$('.vista').forEach(v => v.classList.toggle('is-on', v.id === 'vista-' + vista));
  $$('.menu__item').forEach(b => b.classList.toggle('is-on', b.dataset.vista === vista));
  scrollTo({top:0, behavior:'smooth'});
}

/* =========================================================================
   11. ARRANQUE
   ========================================================================= */
async function arranque(){
  montarEmblema();
  ligarAcesso();
  ligarLeitor();
  $('#lema').textContent = CONFIG.lema;
  $('#menu-loja').href = CONFIG.lojaUrl;
  CLUBE.treinador = CONFIG.treinador;

  /* fotos e emblemas descarregados por atualizar_fotos.py */
  try{
    FOTOS = await (await fetch('dados/plantel.json', {cache:'no-store'})).json();
  }catch(e){ /* segue com avatares desenhados */ }

  /* plantel de arranque: só nomes dos perfis, até o Wikipédia responder */
  PLANTEL = Object.keys(PERFIS).map(nome => ({
    nome, n:null, pos:'—', posGrupo:'MED', nac:'', nota:'', idade:null,
    stats:{jogos:0, golos:0}
  }));
  ligarFotos();

  pintarMercado(); pintarClube(); pintarTabela();
  pintarProximoJogo(); pintarCalendario(); pintarResultados();
  pintarJogosTodos(); pintarPlantel(); pintarEstatisticas();

  /* fotografia do ecrã de entrada: qualquer img/entrada.* serve */
  const foto = new Image();
  foto.onload = () => {
    $('#acesso-foto')?.classList.add('tem');
    $('#acesso')?.classList.add('com-foto');
  };
  foto.src = '/fundo';

  /* mostra já o arquivo guardado, enquanto os feeds respondem */
  if(lerArquivo()) pintarNoticias();

  sincronizar();
  setInterval(sincronizar, CONFIG.refreshDadosMinutos * 60000);

  carregarNoticias();
  setInterval(carregarNoticias, CONFIG.refreshSegundos * 1000);

  /* ---- eventos ---- */
  $$('.menu__item[data-vista]').forEach(b =>
    b.addEventListener('click', () => irPara(b.dataset.vista)));
  $$('[data-ir]').forEach(b =>
    b.addEventListener('click', () => irPara(b.dataset.ir)));

  $('#minuto-filtro').addEventListener('change', pintarLinhaTempo);

  $$('#pos-filtro .pilula').forEach(b => b.addEventListener('click', () => {
    $$('#pos-filtro .pilula').forEach(x => x.classList.remove('is-on'));
    b.classList.add('is-on');
    filtroPos = b.dataset.pos;
    pintarPlantel();
  }));

  $('#jogo-ant').addEventListener('click', () => { jogoIdx--; pintarProximoJogo(); });
  $('#jogo-seg').addEventListener('click', () => { jogoIdx++; pintarProximoJogo(); });

  const caixaProcura = $('#procura-caixa');
  $('#btn-procura').addEventListener('click', () => {
    caixaProcura.classList.toggle('is-aberta');
    if(caixaProcura.classList.contains('is-aberta')) $('#procura').focus();
  });
  $('#procura').addEventListener('input', e => {
    procuraTexto = e.target.value.trim();
    pintarNoticias();
    if(procuraTexto && vistaAtual !== 'noticias') irPara('noticias');
  });

  $('#mais-antigas').addEventListener('click', () => {
    mostradas += 40;
    pintarNoticias();
  });

  $('#btn-alertas').addEventListener('click', () => {
    novasDesdeVista = 0;
    $('#badge-alertas').textContent = NOTICIAS.length;
    irPara('aominuto');
  });
  $('#btn-conta').addEventListener('click', () => irPara('clube'));

  $('#btn-sair').addEventListener('click', () => {
    localStorage.removeItem(SESSAO);
    location.reload();
  });

  addEventListener('keydown', e => {
    if(e.key === 'Escape') caixaProcura.classList.remove('is-aberta');
  });
}

document.addEventListener('DOMContentLoaded', arranque);
})();
