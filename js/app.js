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
let provaAtiva = 'Total';
let PROVAS_DISPONIVEIS = ['Total'];

/* =========================================================================
   1. EMBLEMAS
   ========================================================================= */
/* Ordem de preferência: o teu ficheiro → o emblema oficial descarregado
   pela API → o escudo desenhado em código. */
/* -------------------------------------------------------------------------
   Imagens que podem estar em vários sítios.
   O /emblema e o /fundo só existem no servidor.py local — no site publicado
   (Vercel) não há essas rotas. Por isso experimentam-se os ficheiros
   diretamente e fica-se pelo primeiro que carregar. Assim funciona nos dois.
   ------------------------------------------------------------------------- */
const EMBLEMAS_SCP = [
  'img/crest.png', 'img/crest.jpg', 'img/crest.jpeg', 'img/crest.webp',
  '/emblema', 'img/crest.svg', 'img/teams/228.png'
];
const FUNDOS_ENTRADA = [
  'img/entrada.jpg', 'img/entrada.jpeg', 'img/entrada.png',
  'img/entrada.webp', '/fundo'
];

/* devolve o primeiro caminho que carregue, ou null */
function primeiraImagem(caminhos){
  return new Promise(resolve => {
    let i = 0;
    const tentar = () => {
      if(i >= caminhos.length) return resolve(null);
      const caminho = caminhos[i++];
      const img = new Image();
      img.onload  = () => resolve(caminho);
      img.onerror = tentar;
      img.src = caminho;
    };
    tentar();
  });
}

async function montarEmblema(){
  const alvos = [$('#emblema'), $('#acesso-emblema'), $('#emblema-rodape')].filter(Boolean);
  alvos.forEach(a => a.innerHTML = EMBLEMA_SVG);

  const caminho = await primeiraImagem(EMBLEMAS_SCP);
  if(!caminho) return;

  alvos.forEach(a => {
    const img = new Image();
    img.src = caminho;
    img.alt = 'Sporting CP';
    a.innerHTML = '';
    a.appendChild(img);
  });

  /* o ícone do separador segue o mesmo ficheiro */
  const icone = document.querySelector('link[rel="icon"]');
  if(icone) icone.href = caminho;
}

async function montarFundoEntrada(){
  const caminho = await primeiraImagem(FUNDOS_ENTRADA);
  if(!caminho) return;
  const foto = $('#acesso-foto');
  if(!foto) return;
  foto.style.backgroundImage = `url('${caminho}')`;
  foto.classList.add('tem');
  $('#acesso')?.classList.add('com-foto');
}

/* =========================================================================
   1b. ACESSO — registo e entrada (ver js/contas.js)
   ========================================================================= */
let UTILIZADOR_ATUAL = null;

function abrirSite(animar){
  const ecra = $('#acesso');
  if(!ecra) return;
  if(animar){
    ecra.classList.add('fechado');
    setTimeout(() => ecra.remove(), 520);
  }else{
    ecra.remove();
  }
  document.body.classList.remove('trancado');
  $('#quem').textContent = UTILIZADOR_ATUAL ? '@' + UTILIZADOR_ATUAL : '';
}

function treme(){
  const caixa = $('.acesso__caixa');
  caixa.classList.remove('treme');
  void caixa.offsetWidth;
  caixa.classList.add('treme');
}

function mostrarAba(qual){
  const entrar = qual === 'entrar';
  $('#form-entrar').hidden = !entrar;
  $('#form-criar').hidden  = entrar;
  $('#aba-entrar').classList.toggle('is-on', entrar);
  $('#aba-criar').classList.toggle('is-on', !entrar);
  $('#aba-entrar').setAttribute('aria-selected', entrar);
  $('#aba-criar').setAttribute('aria-selected', !entrar);
  setTimeout(() => $(entrar ? '#entrar-utilizador' : '#criar-utilizador').focus(), 60);
}

function ligarAcesso(){
  const sessao = Contas.sessao();
  if(sessao){
    UTILIZADOR_ATUAL = sessao.nome;
    abrirSite(false);
    return;
  }

  /* sem contas ainda? abre logo no registo */
  if(Contas.quantas() === 0) mostrarAba('criar');

  $('#aba-entrar').addEventListener('click', () => mostrarAba('entrar'));
  $('#aba-criar').addEventListener('click',  () => mostrarAba('criar'));
  $$('.acesso__ligacao').forEach(b =>
    b.addEventListener('click', () => mostrarAba(b.dataset.aba)));

  /* olho para ver a palavra-passe */
  $$('.ver-palavra').forEach(b => b.addEventListener('click', () => {
    const campo = document.getElementById(b.dataset.alvo);
    const escondida = campo.type === 'password';
    campo.type = escondida ? 'text' : 'password';
    b.setAttribute('aria-label', escondida ? 'Esconder palavra-passe' : 'Mostrar palavra-passe');
    b.classList.toggle('is-on', escondida);
    campo.focus();
  }));

  /* nome livre ou já usado, à medida que se escreve */
  const campoNovo = $('#criar-utilizador');
  campoNovo.addEventListener('input', () => {
    const v = campoNovo.value.trim();
    const estado = $('#estado-utilizador');
    if(!v){ estado.textContent = ''; estado.className = 'acesso__estado'; return; }
    const erro = Contas.validarUtilizador(v);
    if(erro){ estado.textContent = erro; estado.className = 'acesso__estado mau'; return; }
    const usado = Contas.existe(v);
    estado.textContent = usado ? 'Já está a ser usado.' : 'Está livre.';
    estado.className = 'acesso__estado ' + (usado ? 'mau' : 'bom');
  });

  /* ---- criar conta ---- */
  $('#form-criar').addEventListener('submit', async e => {
    e.preventDefault();
    const erroEl = $('#erro-criar');
    erroEl.textContent = '';

    const r = await Contas.registar(campoNovo.value, $('#criar-palavra').value);
    if(r.erro){ erroEl.textContent = r.erro; treme(); return; }

    /* conta criada: entra já, sem obrigar a escrever outra vez */
    await Contas.entrar(campoNovo.value, $('#criar-palavra').value, true);
    UTILIZADOR_ATUAL = r.nome;
    abrirSite(true);
    carregarFormacaoGuardada();
  });

  /* ---- entrar ---- */
  $('#form-entrar').addEventListener('submit', async e => {
    e.preventDefault();
    const erroEl = $('#erro-entrar');
    erroEl.textContent = '';

    const r = await Contas.entrar($('#entrar-utilizador').value,
                                  $('#entrar-palavra').value,
                                  $('#lembrar').checked);
    if(r.erro){
      erroEl.textContent = r.erro;
      $('#entrar-palavra').value = '';
      $('#entrar-palavra').focus();
      treme();
      return;
    }
    UTILIZADOR_ATUAL = r.nome;
    abrirSite(true);
    carregarFormacaoGuardada();
  });

  setTimeout(() => $(Contas.quantas() ? '#entrar-utilizador' : '#criar-utilizador').focus(), 300);
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

/* A ordem importa: a primeira que bater é a que fica. Feminino e
   modalidades vêm à frente para não serem engolidos pelo "mercado". */
function classificar(n){
  const t = n.titulo + ' ' + (n.resumo || '');
  if(CONFIG.filtroFeminino.test(t))        return 'FEMININO';
  if(CONFIG.filtroModalidades.test(t))     return 'MODALIDADES';
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

/* =========================================================================
   3c. HOMEPAGE — hero, últimas, mercado, vídeos, mais lidas
   ========================================================================= */
const LIDAS = 'scp-lidas-v1';
let categoriaHome = 'todas';

/* conta as aberturas de cada notícia, para a lista "mais lidas" */
function registarLeitura(link, titulo, fonte){
  try{
    const t = JSON.parse(localStorage.getItem(LIDAS) || '{}');
    const e = t[link] || { link, titulo, fonte, vezes: 0 };
    e.vezes++; e.quando = Date.now(); e.titulo = titulo; e.fonte = fonte;
    t[link] = e;
    /* não deixar crescer para sempre */
    const todas = Object.values(t).sort((a,b) => b.quando - a.quando).slice(0,120);
    localStorage.setItem(LIDAS, JSON.stringify(
      Object.fromEntries(todas.map(x => [x.link, x]))));
  }catch(e){}
}

function pintarHome(){
  const lista = noticiasFiltradas();

  /* ---- hero ---- */
  const alvoHero = $('#hero');
  const principal = escolherPrincipal(lista);
  if(alvoHero){
    alvoHero.innerHTML = NOTICIAS.length
      ? Componentes.hero(principal, procuraTexto)
      : Componentes.esqueletoHero();
  }

  /* ---- filtros de categoria ---- */
  pintarFiltrosCategoria();

  /* ---- últimas ---- */
  const alvoUltimas = $('#ultimas');
  if(alvoUltimas){
    const restantes = lista.filter(n => n !== principal)
                           .filter(n => categoriaHome === 'todas' || n.categoria === categoriaHome)
                           .slice(0,8);
    alvoUltimas.innerHTML = !NOTICIAS.length
      ? Componentes.esqueletoCartao(5)
      : restantes.length
        ? restantes.map(n => Componentes.cartaoNoticia(n, {destaque: procuraTexto})).join('')
        : Componentes.vazio('Nada nesta categoria',
            'Experimenta outro filtro — as notícias entram de minuto a minuto.', '◎');
  }

  /* ---- mercado ---- */
  const alvoMercado = $('#mercado-home');
  if(alvoMercado){
    const mercado = NOTICIAS.filter(n => n.categoria === 'MERCADO').slice(0,4);
    alvoMercado.innerHTML = !NOTICIAS.length
      ? Componentes.esqueletoCartao(3)
      : mercado.length
        ? mercado.map(n => Componentes.cartaoNoticia(n, {modo:'grelha'})).join('')
        : Componentes.vazio('Mercado calmo', 'Sem movimentações na imprensa neste momento.', '⇄');
  }

  /* ---- vídeos ---- */
  const alvoVideos = $('#videos');
  if(alvoVideos){
    const videos = NOTICIAS.filter(n => CONFIG.filtroVideo.test(n.titulo + ' ' + n.resumo)).slice(0,4);
    alvoVideos.closest('.seccao').hidden = NOTICIAS.length > 0 && videos.length === 0;
    alvoVideos.innerHTML = !NOTICIAS.length
      ? Componentes.esqueletoCartao(2)
      : videos.map(n => Componentes.cartaoNoticia(n, {modo:'grelha'})).join('');
  }

  /* ---- mais lidas ---- */
  pintarMaisLidas();
}

/* Qual é a notícia principal.
   Não é só a mais recente: uma notícia quente (oficial, lesão, golo) das
   últimas horas vale mais do que uma notícia morna acabada de sair. */
function escolherPrincipal(lista){
  const comFoto = lista.filter(n => n.imagem);
  if(!comFoto.length) return lista[0];

  const agora = Date.now();
  const pontos = n => {
    const horas = (agora - n.data.getTime()) / 3600000;
    let p = Math.max(0, 48 - horas);                 // quanto mais fresca, melhor
    if(n.categoria === 'DESTAQUE') p += 30;
    if(n.categoria === 'MERCADO')  p += 10;
    if((n.resumo || '').length > 80) p += 5;         // tem resumo a sério
    return p;
  };
  return [...comFoto].sort((a,b) => pontos(b) - pontos(a))[0];
}

function pintarFiltrosCategoria(){
  const alvo = $('#filtros-categoria');
  if(!alvo || !NOTICIAS.length) return;

  const contas = {};
  NOTICIAS.forEach(n => contas[n.categoria] = (contas[n.categoria] || 0) + 1);
  const cats = ['todas', ...CONFIG.categorias.filter(c => contas[c])];

  const chave = cats.map(c => c + (contas[c]||0)).join('|') + categoriaHome;
  if(alvo.dataset.chave === chave) return;
  alvo.dataset.chave = chave;

  alvo.innerHTML = cats.map(c => `
    <button class="filtro-cat ${c===categoriaHome?'is-on':''}" data-cat="${c}"
            aria-pressed="${c===categoriaHome}">
      ${c === 'todas' ? 'Todas' : c}
      ${c !== 'todas' ? `<span class="filtro-cat__n">${contas[c]}</span>` : ''}
    </button>`).join('');

  $$('#filtros-categoria .filtro-cat').forEach(b =>
    b.addEventListener('click', () => {
      categoriaHome = b.dataset.cat;
      alvo.dataset.chave = '';
      pintarHome();
    }));
}

function pintarMaisLidas(){
  const alvo = $('#mais-lidas');
  if(!alvo) return;

  let guardadas = [];
  try{
    guardadas = Object.values(JSON.parse(localStorage.getItem(LIDAS) || '{}'))
      .sort((a,b) => b.vezes - a.vezes || b.quando - a.quando).slice(0,5);
  }catch(e){}

  if(guardadas.length){
    alvo.innerHTML = guardadas.map((e,i) => Componentes.itemCompacto({
      titulo: e.titulo, link: e.link, fonte: e.fonte, data: new Date(e.quando)
    }, i+1)).join('');
    return;
  }

  /* ainda ninguém leu nada: mostra as mais recentes */
  alvo.innerHTML = NOTICIAS.length
    ? NOTICIAS.slice(0,5).map((n,i) => Componentes.itemCompacto(n, i+1)).join('')
    : Componentes.esqueletoCompacto(5);
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
  pintarHome();
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
/* As notícias abrem num separador novo do browser, no site do jornal.
   O leitor dentro do site foi tirado — os links já levam target="_blank",
   por isso aqui só se garante que nada intercepta o clique. */
function ligarLeitor(){
  /* conta as aberturas para a lista "mais lidas" e abre em separador novo */
  document.addEventListener('click', ev => {
    const a = ev.target.closest('a[data-link]');
    if(!a) return;
    ev.preventDefault();
    const link = a.dataset.link;
    const cartao = a.closest('.ncartao, .hero, .compacto');
    const titulo = cartao?.querySelector('.ncartao__titulo, .hero__titulo, b')?.textContent?.trim() || link;
    const fonte  = cartao?.querySelector('.ncartao__fonte, .hero__meta span:nth-child(2), .compacto__txt span')?.textContent?.trim() || '';
    registarLeitura(link, titulo, fonte);
    pintarMaisLidas();
    window.open(link, '_blank', 'noopener');
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
      const r = await fetch('/api/api?p=' + encodeURIComponent(p), {cache:'no-store'});
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
/* =========================================================================
   7c. FANTASY — pontuação do teu onze e ranking das contas
   ========================================================================= */
const RANKING = 'scp-ranking-v1';

/* Pontos de um jogador — SÓ com o que fez na época 2026/27.
   Enquanto não houver jogos, ninguém pontua: é essa a ideia. */
function pontosJogador(p){
  const g = p.posGrupo;
  const s = p.stats || {jogos:0, golos:0};

  const porGolos = s.golos * (FANTASY.golo[g] ?? 4);
  const porJogos = s.jogos * (FANTASY.jogo[g] ?? 2);

  return {
    total: porGolos + porJogos,
    porGolos, porJogos,
    golos: s.golos, jogos: s.jogos
  };
}

function pintarFantasy(){
  const alvo = $('#fantasy-jogadores');
  if(!alvo) return;

  const escolhidos = meuOnze.map((nome, i) => {
    const p = nome ? acharJogador(nome) : null;
    if(!p) return null;
    return { p, i, capitao: i === capitaoIdx, pts: pontosJogador(p) };
  }).filter(Boolean);

  if(!escolhidos.length){
    alvo.innerHTML = '<li class="vazio">Monta o teu onze aqui em cima para teres pontos.</li>';
    $('#fantasy-pontos').textContent = '0';
    $('#fantasy-detalhe').textContent = 'escolhe o teu onze';
    $('#fantasy-nota').textContent = '';
    pintarTabelaPontos();
    pintarRanking();
    return;
  }

  /* Sem capitão escolhido, fica quem mais pontua e não é guarda-redes.
     Só quando já houver pontos — antes disso a braçadeira sairia à sorte. */
  const haPontos = escolhidos.some(e => e.pts.total > 0);
  if(haPontos && (capitaoIdx < 0 || !meuOnze[capitaoIdx])){
    const melhor = escolhidos
      .filter(e => e.p.posGrupo !== 'GR')
      .sort((a,b) => b.pts.total - a.pts.total)[0] || escolhidos[0];
    capitaoIdx = melhor.i;
    escolhidos.forEach(e => e.capitao = e.i === capitaoIdx);
    guardarFormacao();
  }

  const total = escolhidos.reduce((s,e) =>
    s + Math.round(e.pts.total * (e.capitao ? FANTASY.capitao : 1)), 0);

  $('#fantasy-pontos').textContent = total.toLocaleString('pt-PT');
  $('#fantasy-detalhe').textContent = haPontos
    ? `${escolhidos.length}/11 escolhidos · ${desenhoAtual}`
    : `${escolhidos.length}/11 escolhidos · ainda sem jogos oficiais`;
  $('#fantasy-nota').textContent = UTILIZADOR_ATUAL ? '@' + UTILIZADOR_ATUAL : '';

  alvo.innerHTML = [...escolhidos]
    .sort((a,b) => b.pts.total - a.pts.total || (a.i - b.i))
    .map(e => `
      <li class="${e.capitao ? 'e-capitao' : ''}" data-i="${e.i}"
          title="Carrega para pôr a braçadeira">
        <img src="${e.p.foto}" alt="" loading="lazy"
             onerror="this.onerror=null;this.src='${avatarJogador(e.p)}'">
        <span class="fj__txt">
          <b>${ALCUNHAS[e.p.nome] || e.p.nome}${e.capitao ? ' <i class="fj__c">C</i>' : ''}</b>
          <span>${FORMACOES[desenhoAtual][e.i].papel} ·
            ${e.pts.jogos} jogos (${e.pts.porJogos}) ·
            ${e.pts.golos} golos (${e.pts.porGolos})</span>
        </span>
        <b class="fj__pts">${Math.round(e.pts.total * (e.capitao ? FANTASY.capitao : 1))}</b>
      </li>`).join('');

  $$('#fantasy-jogadores li[data-i]').forEach(li =>
    li.addEventListener('click', () => {
      capitaoIdx = +li.dataset.i;
      guardarFormacao();
      pintarFantasy();
    }));

  pintarTabelaPontos();
  guardarPontuacao(total, escolhidos.length);
  pintarRanking();
}

/* tabela visível com as regras da pontuação */
function pintarTabelaPontos(){
  const alvo = $('#pontuacao');
  if(!alvo) return;
  $('#fantasy-epoca').textContent = CONFIG.epoca;

  const grupos = ['GR','DEF','MED','AVA'];
  alvo.innerHTML = `
    <table class="tabela tabela--pontos">
      <thead>
        <tr><th>POSIÇÃO</th><th>POR GOLO</th><th>POR JOGO</th></tr>
      </thead>
      <tbody>
        ${grupos.map(g => `<tr>
          <td>${FANTASY.rotulos[g]}</td>
          <td><b>${FANTASY.golo[g]}</b></td>
          <td>${FANTASY.jogo[g]}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <ul class="pontuacao__notas">
      <li><b>Capitão ×${String(FANTASY.capitao).replace('.',',')}</b> — carrega
          num jogador da lista acima para lhe pores a braçadeira.</li>
      <li>Um golo de um guarda-redes vale ${FANTASY.golo.GR} pontos; o mesmo golo
          de um avançado vale ${FANTASY.golo.AVA}.</li>
      <li>Contam jogos e golos em <b>provas oficiais</b> — os particulares de
          pré-época não entram.</li>
    </ul>`;
}

function guardarPontuacao(total, quantos){
  if(!UTILIZADOR_ATUAL) return;
  let tabela = {};
  try{ tabela = JSON.parse(localStorage.getItem(RANKING) || '{}'); }catch(e){}
  tabela[Contas.idDe(UTILIZADOR_ATUAL)] = {
    nome: UTILIZADOR_ATUAL, pontos: total, jogadores: quantos,
    desenho: desenhoAtual, quando: Date.now()
  };
  try{ localStorage.setItem(RANKING, JSON.stringify(tabela)); }catch(e){}
}

function pintarRanking(){
  let tabela = {};
  try{ tabela = JSON.parse(localStorage.getItem(RANKING) || '{}'); }catch(e){}

  /* junta entradas repetidas do mesmo nome (pode haver restos de versões
     antigas da chave) ficando com a melhor pontuação */
  const porNome = new Map();
  Object.values(tabela).forEach(e => {
    const id = Contas.idDe(e.nome);
    if(!porNome.has(id) || porNome.get(id).pontos < e.pontos) porNome.set(id, e);
  });

  const lista = [...porNome.values()]
    .sort((a,b) => b.pontos - a.pontos)
    .slice(0,10);

  $('#ranking').innerHTML = lista.length
    ? lista.map((e,i) => `
        <li class="${chaveNome(e.nome) === chaveNome(UTILIZADOR_ATUAL || '') ? 'eu' : ''}">
          <span class="rk__pos ${i<3?'rk__pos--podio':''}">${i+1}</span>
          <span class="rk__nome">@${e.nome}</span>
          <span class="rk__eq">${e.desenho} · ${e.jogadores}/11</span>
          <b>${e.pontos.toLocaleString('pt-PT')}</b>
        </li>`).join('')
    : '<li class="vazio">Ainda ninguém pontuou.</li>';
}

function pintarEstatisticas(){
  const marcadores = PLANTEL.filter(p => p.stats.golos > 0)
                            .sort((a,b) => b.stats.golos - a.stats.golos).slice(0,5);
  $('#marcadores').innerHTML = marcadores.length
    ? marcadores.map(p => `<li>
        <img src="${p.foto}" alt="" onerror="this.onerror=null;this.src='${avatarJogador(p)}'">
        <span>${ALCUNHAS[p.nome] || p.nome}</span><b>${p.stats.golos}</b></li>`).join('')
    : `<li class="vazio">Sem golos registados — a época começa a 8 de agosto.</li>`;

  /* caixas da equipa a partir de um conjunto de jogos */
  const caixasDe = jogos => {
    const r = jogos.map(resultadoSCP);
    const gm = r.reduce((s,x)=>s+x.nos,0), gs = r.reduce((s,x)=>s+x.deles,0);
    const v = r.filter(x=>x.r==='V').length;
    const cs = r.filter(x=>x.deles===0).length;
    const n = jogos.length;
    return [
      ['JOGOS',            n,   ''],
      ['GOLOS<br>MARCADOS',gm,  n ? (gm/n).toFixed(1)+' por jogo' : ''],
      ['GOLOS<br>SOFRIDOS',gs,  n ? (gs/n).toFixed(1)+' por jogo' : ''],
      ['VITÓRIAS',         n ? v + '/' + n : '0', n ? Math.round(v/n*100)+'%' : ''],
      ['SEM<br>SOFRER',    cs,  n ? Math.round(cs/n*100)+'%' : '']
    ].map(([l,val,sub]) =>
      `<div class="caixa"><label>${l}</label><b>${val}</b><i>${sub}</i></div>`).join('');
  };

  /* página inicial: tudo o que já se jogou, pré-época incluída */
  const todosFeitos = JOGOS.filter(jogado);
  $('#caixas-equipa').innerHTML = todosFeitos.length
    ? caixasDe(todosFeitos)
    : `<div class="vazio" style="grid-column:1/-1">Ainda não há jogos.</div>`;

  /* ---- filtro por competição ---- */
  const temPreEpoca = JOGOS.some(j => jogado(j) && provaDoJogo(j) === 'Pré-época');
  const opcoes = [...PROVAS_DISPONIVEIS, ...(temPreEpoca ? ['Pré-época'] : [])];

  const caixa = $('#provas-filtro');
  if(caixa && caixa.dataset.n !== opcoes.join('|')){
    caixa.dataset.n = opcoes.join('|');
    caixa.innerHTML = opcoes.map(nome =>
      `<button class="pilula ${nome===provaAtiva?'is-on':''}" data-prova="${nome}">
         ${nome === 'Total' ? 'TODAS AS OFICIAIS' : nome.toUpperCase()}
       </button>`).join('');
    $$('#provas-filtro .pilula').forEach(b => b.addEventListener('click', () => {
      provaAtiva = b.dataset.prova;
      caixa.dataset.n = '';
      pintarEstatisticas();
    }));
  }

  /* jogos da prova escolhida — "Total" = todas as oficiais, sem pré-época */
  const jogosDaProva = JOGOS.filter(jogado).filter(j => {
    const prova = provaDoJogo(j);
    return provaAtiva === 'Total' ? prova !== 'Pré-época' : prova === provaAtiva;
  });

  $('#caixas-equipa-total').innerHTML = jogosDaProva.length
    ? caixasDe(jogosDaProva)
    : `<div class="vazio" style="grid-column:1/-1">
         Ainda não há jogos ${provaAtiva === 'Total' ? 'oficiais' : 'nesta prova'} —
         por isso não há golos nem resultados para mostrar.
       </div>`;

  /* ---- tabela de jogadores ---- */
  $('#prova-nota').textContent = provaAtiva === 'Total'
    ? 'todas as provas oficiais' : provaAtiva;

  /* a pré-época não tem estatísticas individuais publicadas */
  if(provaAtiva === 'Pré-época'){
    $('#tabela-jogadores tbody').innerHTML =
      `<tr><td colspan="6" class="vazio">
        Os particulares de pré-época não têm estatísticas individuais publicadas.
      </td></tr>`;
    return;
  }

  const daProva = p => (provaAtiva === 'Total' || !p.stats.provas)
    ? { jogos: p.stats.jogos, golos: p.stats.golos }
    : (p.stats.provas[provaAtiva] || { jogos:0, golos:0 });

  const linhas = PLANTEL.map(p => ({ p, s: daProva(p) }))
    .sort((a,b) => b.s.golos - a.s.golos || b.s.jogos - a.s.jogos);

  const alguem = linhas.some(l => l.s.jogos || l.s.golos);
  $('#tabela-jogadores tbody').innerHTML = alguem
    ? linhas.map(({p,s}) => `<tr>
        <td><img src="${p.foto}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${avatarJogador(p)}'"></td>
        <td><b>${ALCUNHAS[p.nome] || p.nome}</b></td>
        <td>${p.pos}</td><td>${p.n ?? '–'}</td>
        <td>${s.jogos}</td><td><b>${s.golos}</b></td>
      </tr>`).join('')
    : `<tr><td colspan="6" class="vazio">
         Ninguém jogou ${provaAtiva === 'Total' ? 'em provas oficiais' : 'nesta prova'} até agora,
         por isso ninguém tem golos.
       </td></tr>`;
}

/* a que prova pertence um jogo do calendário */
function provaDoJogo(j){
  const c = (j.comp || '').toUpperCase();
  if(/^PR[ÉE]/.test(c))            return 'Pré-época';
  if(c.includes('TAÇA DA LIGA'))   return 'Taça da Liga';
  if(c.includes('TAÇA DE PORTUGAL'))return 'Taça de Portugal';
  if(c.includes('SUPERTAÇA'))      return 'Supertaça';
  if(c.includes('CHAMPIONS'))      return 'Champions';
  if(c.includes('EUROPA'))         return 'Liga Europa';
  if(c.includes('CONFERENCE'))     return 'Conference';
  if(c.includes('LIGA'))           return 'Liga';
  return 'Outra';
}

/* =========================================================================
   7b. FORMAÇÃO — campo à esquerda, convocados à direita
   ========================================================================= */
/* Procura no plantel pelo nome. O apelido sozinho não chega: "Alisson
   Santos" apanhava o Nuno Santos. Por isso a inicial do primeiro nome
   também tem de bater certo. */
function acharJogador(nome){
  const k = chaveNome(nome);
  const exato = PLANTEL.find(p => chaveNome(p.nome) === k);
  if(exato) return exato;
  return PLANTEL.find(p => apelido(p.nome) === apelido(nome)
                        && chaveNome(p.nome)[0] === k[0]) || null;
}

/* Nome curto para caber debaixo da camisola.
   Usa a alcunha se houver (Pote), e quando o apelido se repete no plantel
   (Silva, Gonçalves…) junta a inicial do próprio para não haver confusão. */
function nomeCurto(nome){
  const p = acharJogador(nome);
  if(p && ALCUNHAS[p.nome]) return ALCUNHAS[p.nome];

  const partes = nome.split(' ').filter(Boolean);
  if(partes.length === 1) return nome;

  let ultimo = partes[partes.length-1];
  if(ultimo.length <= 3) return partes.slice(-2).join(' ');

  const repetido = PLANTEL.filter(x => apelido(x.nome) === apelido(nome)).length > 1;
  return repetido ? `${partes[0][0]}. ${ultimo}` : ultimo;
}

/* ---------- estado da tua formação ---------- */
let desenhoAtual = FORMACAO.desenho;
let meuOnze = [];              // um nome (ou null) por posição do desenho
let posicaoAberta = -1;
let capitaoIdx = -1;      // posicao do capitao no onze (x1.5 na fantasy)

/* Contas.idDe mantem os numeros do nome — o chaveNome() do app deita-os
   fora, e "mike1"/"mike2" acabavam a partilhar a mesma formacao. */
const chaveFormacao = () =>
  'scp-formacao-' + (UTILIZADOR_ATUAL ? Contas.idDe(UTILIZADOR_ATUAL) : 'convidado');

function guardarFormacao(){
  try{
    localStorage.setItem(chaveFormacao(),
      JSON.stringify({ desenho: desenhoAtual, onze: meuOnze, capitao: capitaoIdx }));
  }catch(e){}
}

function carregarFormacaoGuardada(){
  let guardada = null;
  try{ guardada = JSON.parse(localStorage.getItem(chaveFormacao()) || 'null'); }
  catch(e){}

  if(guardada && FORMACOES[guardada.desenho]){
    desenhoAtual = guardada.desenho;
    meuOnze = FORMACOES[desenhoAtual].map((_, i) => guardada.onze?.[i] ?? null);
    capitaoIdx = Number.isInteger(guardada.capitao) ? guardada.capitao : -1;
  }else{
    /* primeira vez: arranca com a sugestão de data.js */
    desenhoAtual = FORMACOES[FORMACAO.desenho] ? FORMACAO.desenho : Object.keys(FORMACOES)[0];
    meuOnze = FORMACOES[desenhoAtual].map((slot, i) =>
      FORMACAO.titulares[i]?.nome ?? null);
  }
  pintarFormacao();
}

/* muda de desenho tentando manter quem já lá está, posição a posição */
function mudarDesenho(novo){
  if(!FORMACOES[novo]) return;
  const antigos = meuOnze.slice();
  const antesSlots = FORMACOES[desenhoAtual];
  desenhoAtual = novo;

  const usados = new Set();
  meuOnze = FORMACOES[novo].map(slot => {
    /* procura alguém do desenho anterior com o mesmo papel e ainda livre */
    const i = antesSlots.findIndex((s, k) =>
      s.papel === slot.papel && antigos[k] && !usados.has(k));
    if(i >= 0){ usados.add(i); return antigos[i]; }
    return null;
  });

  /* quem sobrou tenta entrar nas posições vazias do mesmo grupo */
  const sobra = antigos.filter((n, k) => n && !usados.has(k));
  FORMACOES[novo].forEach((slot, i) => {
    if(meuOnze[i]) return;
    const j = sobra.findIndex(n => {
      const p = acharJogador(n);
      return p && p.posGrupo === PAPEL_GRUPO[slot.papel] && !meuOnze.includes(n);
    });
    if(j >= 0) meuOnze[i] = sobra.splice(j, 1)[0];
  });

  guardarFormacao();
  pintarFormacao();
}

/* preenche os buracos com quem estiver livre e der para a posição */
function preencherAuto(){
  FORMACOES[desenhoAtual].forEach((slot, i) => {
    if(meuOnze[i]) return;
    const grupo = PAPEL_GRUPO[slot.papel];
    const candidato =
      PLANTEL.find(p => p.posGrupo === grupo && !meuOnze.includes(p.nome)) ||
      PLANTEL.find(p => !meuOnze.includes(p.nome) && p.posGrupo !== 'GR');
    if(candidato) meuOnze[i] = candidato.nome;
  });
  guardarFormacao();
  pintarFormacao();
}

/* ---------- desenhar ---------- */
function pintarFormacao(){
  const alvo = $('#campo');
  if(!alvo) return;

  const slots = FORMACOES[desenhoAtual] || [];
  if(meuOnze.length !== slots.length)
    meuOnze = slots.map((_, i) => meuOnze[i] ?? null);

  /* selector de desenho */
  const sel = $('#escolher-formacao');
  if(sel && sel.options.length !== Object.keys(FORMACOES).length){
    sel.innerHTML = Object.keys(FORMACOES)
      .map(d => `<option value="${d}">${d}</option>`).join('');
  }
  if(sel) sel.value = desenhoAtual;

  const escolhidos = meuOnze.filter(Boolean).length;
  $('#onze-conta').textContent = `${escolhidos}/11`;

  /* campo */
  alvo.innerHTML = `
    <div class="campo__relva"></div>
    <svg class="campo__linhas" viewBox="0 0 100 150" preserveAspectRatio="none">
      <rect x="2" y="2" width="96" height="146" fill="none" stroke="#fff" stroke-width="0.7" opacity=".75"/>
      <line x1="2" y1="75" x2="98" y2="75" stroke="#fff" stroke-width="0.7" opacity=".75"/>
      <circle cx="50" cy="75" r="13" fill="none" stroke="#fff" stroke-width="0.7" opacity=".75"/>
      <circle cx="50" cy="75" r="1" fill="#fff" opacity=".75"/>
      <rect x="24" y="2" width="52" height="22" fill="none" stroke="#fff" stroke-width="0.7" opacity=".75"/>
      <rect x="38" y="2" width="24" height="9" fill="none" stroke="#fff" stroke-width="0.7" opacity=".75"/>
      <rect x="24" y="126" width="52" height="22" fill="none" stroke="#fff" stroke-width="0.7" opacity=".75"/>
      <rect x="38" y="139" width="24" height="9" fill="none" stroke="#fff" stroke-width="0.7" opacity=".75"/>
      <path d="M40 24 a13 13 0 0 0 20 0" fill="none" stroke="#fff" stroke-width="0.7" opacity=".75"/>
      <path d="M40 126 a13 13 0 0 1 20 0" fill="none" stroke="#fff" stroke-width="0.7" opacity=".75"/>
    </svg>
    ${slots.map((slot, i) => {
      const nome = meuOnze[i];
      const p = nome ? acharJogador(nome) : null;
      const gr = slot.papel === 'GR';

      if(!p){
        return `<button class="posicao posicao--vazia" data-i="${i}"
                     style="left:${slot.x}%; top:${slot.y}%; animation-delay:${i*.04}s"
                     title="Escolher ${slot.papel}">
          <span class="posicao__vazia"><i>+</i></span>
          <span class="posicao__nome posicao__nome--papel">${slot.papel}</span>
        </button>`;
      }
      return `<button class="posicao" data-i="${i}"
                   style="left:${slot.x}%; top:${slot.y}%; animation-delay:${i*.04}s"
                   title="${p.nome} · ${slot.papel} — carrega para trocar">
        <span class="posicao__camisola">${camisolaSVG(p.n ?? '', gr ? 'gr' : 'campo')}</span>
        <span class="posicao__nome">${nomeCurto(p.nome)}</span>
      </button>`;
    }).join('')}`;

  $$('#campo .posicao').forEach(el =>
    el.addEventListener('click', () => abrirEscolha(+el.dataset.i)));

  /* listas à direita */
  $('#lista-titulares').innerHTML = slots.map((slot, i) => {
    const p = meuOnze[i] ? acharJogador(meuOnze[i]) : null;
    return `<li class="${p ? '' : 'onze--vazio'}" data-i="${i}">
      <span class="onze__n">${p?.n ?? '·'}</span>
      <span class="onze__nome">${p ? (ALCUNHAS[p.nome] || p.nome) : 'por escolher'}</span>
      <span class="onze__papel">${slot.papel}</span>
    </li>`;
  }).join('');

  $$('#lista-titulares li').forEach(li =>
    li.addEventListener('click', () => abrirEscolha(+li.dataset.i)));

  const fora = PLANTEL.filter(p => !meuOnze.includes(p.nome));
  $('#lista-suplentes').innerHTML = fora.map(p => `
    <li data-nome="${p.nome}">
      <span class="onze__n">${p.n ?? '–'}</span>
      <span class="onze__nome">${ALCUNHAS[p.nome] || p.nome}</span>
      <span class="onze__papel">${p.pos}</span>
    </li>`).join('') || '<li class="onze--vazio"><span class="onze__nome">ninguém de fora</span></li>';

  $$('#lista-suplentes li[data-nome]').forEach(li =>
    li.addEventListener('click', () => {
      const p = PLANTEL.find(x => x.nome === li.dataset.nome);
      if(!p) return;
      irPara('equipa');
      mostrarFicha(p);
      $$('.jog').forEach(b => b.classList.toggle('is-on', b.dataset.nome === p.nome));
    }));

  pintarFantasy();
}

/* ---------- escolher quem joga numa posição ---------- */
function abrirEscolha(i){
  posicaoAberta = i;
  const slot = FORMACOES[desenhoAtual][i];
  const dlg = $('#escolha');

  $('#escolha-papel').textContent = slot.papel;
  $('#escolha-nota').textContent = meuOnze[i]
    ? 'está lá ' + meuOnze[i]
    : 'escolhe quem joga aqui';
  $('#escolha-tirar').hidden = !meuOnze[i];
  $('#escolha-procura').value = '';

  listarCandidatos('');
  dlg.showModal();
  setTimeout(() => $('#escolha-procura').focus(), 50);
}

function listarCandidatos(procura){
  const slot = FORMACOES[desenhoAtual][posicaoAberta];
  const grupo = PAPEL_GRUPO[slot.papel];
  const q = semAcentos(procura);

  /* primeiro os da posição certa, depois os restantes */
  const ordenado = [...PLANTEL].sort((a,b) => {
    const pa = a.posGrupo === grupo ? 0 : 1;
    const pb = b.posGrupo === grupo ? 0 : 1;
    return pa - pb || (a.n ?? 999) - (b.n ?? 999);
  }).filter(p => !q || semAcentos(p.nome + ' ' + p.pos).includes(q));

  $('#escolha-lista').innerHTML = ordenado.map(p => {
    const onde = meuOnze.indexOf(p.nome);
    const jaJoga = onde >= 0 && onde !== posicaoAberta;
    return `<button class="cand ${p.posGrupo === grupo ? 'cand--certo' : ''}"
                 data-nome="${p.nome}">
      <img src="${p.foto}" alt="" loading="lazy"
           onerror="this.onerror=null;this.src='${avatarJogador(p)}'">
      <span class="cand__txt">
        <b>${ALCUNHAS[p.nome] || p.nome}</b>
        <span>${p.pos} · ${p.nac} · ${p.stats.golos} golos</span>
      </span>
      <span class="cand__n">${p.n ?? '–'}</span>
      ${jaJoga ? `<span class="cand__aviso">já joga a ${FORMACOES[desenhoAtual][onde].papel}</span>` : ''}
    </button>`;
  }).join('') || '<div class="vazio">Ninguém com esse nome.</div>';

  $$('#escolha-lista .cand').forEach(b => b.addEventListener('click', () => {
    const nome = b.dataset.nome;
    const onde = meuOnze.indexOf(nome);
    /* se já jogava noutro sítio, trocam de posição */
    if(onde >= 0 && onde !== posicaoAberta) meuOnze[onde] = meuOnze[posicaoAberta];
    meuOnze[posicaoAberta] = nome;
    guardarFormacao();
    pintarFormacao();
    $('#escolha').close();
  }));
}

function ligarEscolha(){
  const dlg = $('#escolha');
  $('#escolha-fechar').addEventListener('click', () => dlg.close());
  $('#escolha-procura').addEventListener('input', e => listarCandidatos(e.target.value));
  $('#escolha-tirar').addEventListener('click', () => {
    meuOnze[posicaoAberta] = null;
    guardarFormacao();
    pintarFormacao();
    dlg.close();
  });
  /* clicar fora fecha */
  dlg.addEventListener('click', e => { if(e.target === dlg) dlg.close(); });

  $('#escolher-formacao').addEventListener('change', e => mudarDesenho(e.target.value));
  $('#formacao-auto').addEventListener('click', preencherAuto);
  $('#formacao-limpar').addEventListener('click', () => {
    meuOnze = meuOnze.map(() => null);
    guardarFormacao();
    pintarFormacao();
  });
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

  /* barra proporcional: o maior negócio enche a barra toda */
  const maior = Math.max(...[...ENTRADAS, ...SAIDAS].map(x => x.valor || 0), 1);

  const cartao = (x, campo, sentido) => {
    const p = acharJogador(x.nome);
    /* quem já saiu não está no plantel — a foto vem do plantel.json,
       onde o atualizar_fotos.py também guarda os ex-jogadores */
    const ex = p ? null : FOTOS.jogadores.find(j =>
      chaveNome(j.nome) === chaveNome(x.nome) ||
      (apelido(j.nome) === apelido(x.nome) &&
       chaveNome(j.nome)[0] === chaveNome(x.nome)[0]));
    const foto = p ? p.foto : (ex ? ex.foto : null);
    const inicial = x.nome.split(' ').map(s => s[0]).slice(0,2).join('');
    return `
    <li class="negocio negocio--${sentido}" ${p ? `data-nome="${p.nome}"` : ''}>
      <span class="negocio__foto">
        ${foto ? `<img src="${foto}" alt="" loading="lazy"
                      onerror="this.onerror=null;this.src='${avatarJogador(p || {nome:x.nome})}'">`
               : `<i class="negocio__ini">${inicial}</i>`}
      </span>
      <span class="negocio__txt">
        <b>${x.nome}</b>
        <span class="negocio__clube">${sentido === 'in' ? '←' : '→'} ${x[campo]}${x.nota ? ' · ' + x.nota : ''}</span>
        <span class="negocio__barra"><i style="width:${(x.valor || 0)/maior*100}%"></i></span>
      </span>
      <span class="negocio__valor">
        ${x.valor ? milhoes(x.valor) : (x.nota === 'empréstimo' ? 'cedência' : 'livre')}
        ${x.bonus ? `<i>+${milhoes(x.bonus)}</i>` : ''}
      </span>
    </li>`;
  };

  $('#mercado').innerHTML = `
    <div class="mv mv--in">
      <h4><span class="mv__seta">▼</span> CHEGARAM <em>${ENTRADAS.length}</em></h4>
      <ul>${ENTRADAS.map(e => cartao(e,'origem','in')).join('')}</ul>
      <div class="mv__soma"><span>INVESTIDO</span><b>${milhoes(gasto)}</b></div>
      ${gastoB ? `<div class="mv__extra">mais ${milhoes(gastoB)} por objetivos</div>` : ''}
    </div>

    <div class="mv mv--out">
      <h4><span class="mv__seta">▲</span> SAÍRAM <em>${SAIDAS.length}</em></h4>
      <ul>${SAIDAS.map(s => cartao(s,'destino','out')).join('')}</ul>
      <div class="mv__soma"><span>ENCAIXADO</span><b>${milhoes(encaixe)}</b></div>
      ${encaixeB ? `<div class="mv__extra">mais ${milhoes(encaixeB)} por objetivos</div>` : ''}
    </div>

    <div class="saldo">
      <div class="saldo__lados">
        <div class="saldo__lado">
          <label>SAIU DO COFRE</label><b class="neg">${milhoes(gasto)}</b>
        </div>
        <div class="saldo__meio">
          <label>SALDO</label>
          <b class="${saldo >= 0 ? 'pos' : 'neg'}">${saldo >= 0 ? '+' : '−'}${milhoes(Math.abs(saldo))}</b>
        </div>
        <div class="saldo__lado">
          <label>ENTROU NO COFRE</label><b class="pos">${milhoes(encaixe)}</b>
        </div>
      </div>
      <div class="saldo__barra">
        <i class="saldo__in"  style="width:${gasto/(gasto+encaixe)*100}%"></i>
        <i class="saldo__out" style="width:${encaixe/(gasto+encaixe)*100}%"></i>
      </div>
      <div class="saldo__nota">só valores fixos — os objetivos não entram na conta</div>
    </div>`;

  $$('#mercado .negocio[data-nome]').forEach(li => li.addEventListener('click', () => {
    const p = PLANTEL.find(x => x.nome === li.dataset.nome);
    if(!p) return;
    irPara('equipa');
    mostrarFicha(p);
    $$('.jog').forEach(b => b.classList.toggle('is-on', b.dataset.nome === p.nome));
  }));
}

function pintarClube(){
  const total = CLUBE.titulos.reduce((s,t) => s + t.n, 0);

  $('#clube').innerHTML = `
    <div class="clube__bloco"><h4>FUNDAÇÃO</h4><p>${CLUBE.fundacao}</p></div>
    <div class="clube__bloco"><h4>ESTÁDIO</h4><p>${CLUBE.estadio}<br><span style="color:var(--texto-3)">${CLUBE.lugares} lugares</span></p></div>
    <div class="clube__bloco"><h4>TREINADOR</h4><p>${CLUBE.treinador || CONFIG.treinador}</p></div>
    <div class="clube__bloco"><h4>CORES</h4><p>${CLUBE.cores}</p></div>`;

  /* ---- palmarés ---- */
  $('#palmares-total').textContent = `${total} troféus`;
  $('#palmares').innerHTML = CLUBE.titulos.map((t,i) => `
    <article class="trofeu" style="animation-delay:${i*.07}s">
      <div class="trofeu__brilho"></div>
      <div class="trofeu__taca">${tacaSVG(t.taca, t.cor)}</div>
      <b class="trofeu__n">${t.n}</b>
      <span class="trofeu__nome">${t.nome}</span>
      ${t.ultima ? `<span class="trofeu__ultima">última em ${t.ultima}</span>`
                 : `<span class="trofeu__ultima trofeu__ultima--vazia">—</span>`}
    </article>`).join('');

  /* ---- campeões que ainda estão no plantel ---- */
  const lista = (CLUBE.campeoes || [])
    .map(c => ({...c, jogador: acharJogador(c.nome)}))
    .filter(c => c.jogador);

  $('#campeoes-nota').textContent = lista.length
    ? `${lista.length} no plantel atual`
    : '';
  $('#campeoes').innerHTML = lista.length
    ? lista.map((c,i) => `
        <button class="campeao" data-nome="${c.jogador.nome}" style="animation-delay:${i*.04}s">
          <span class="campeao__foto">
            <img src="${c.jogador.foto}" alt="${c.nome}" loading="lazy"
                 onerror="this.onerror=null;this.src='${avatarJogador(c.jogador)}'">
            <i class="campeao__n">${c.jogador.n ?? ''}</i>
          </span>
          <b>${ALCUNHAS[c.jogador.nome] || nomeCurto(c.nome)}</b>
          <span>${c.titulos}</span>
        </button>`).join('')
    : `<div class="vazio">Ninguém do plantel atual está na lista — edita CLUBE.campeoes em js/data.js.</div>`;

  $$('#campeoes .campeao').forEach(b => b.addEventListener('click', () => {
    const p = PLANTEL.find(x => x.nome === b.dataset.nome);
    if(!p) return;
    irPara('equipa');
    mostrarFicha(p);
    $$('.jog').forEach(x => x.classList.toggle('is-on', x.dataset.nome === p.nome));
  }));
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
    const { plantel, stats, provas, jogos } = await Wiki.sincronizarSporting();

    if(provas?.length) PROVAS_DISPONIVEIS = provas;

    if(plantel.length){
      PLANTEL = plantel.map(p => {
        const chave = Object.keys(stats).find(k => chaveNome(k) === chaveNome(p.nome));
        return {...p, stats: stats[chave] || {jogos:0, golos:0, provas:{}}, idade:null};
      });
      ligarFotos();
      pintarPlantel();
      /* só agora há plantel a sério para pôr no campo */
      carregarFormacaoGuardada();
      /* estes dois usam as fotos do plantel, por isso repintam-se agora */
      pintarMercado();
      pintarClube();
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
  const noRodape = $('#rodape-estado');
  if(noRodape) noRodape.textContent = falhas.length
    ? 'dados parciais · ' + hora
    : 'dados atualizados às ' + hora;
  if(!falhas.length){ marca.textContent = `dados reais · ${hora}`; marca.className = 'menu__estado ok'; }
  else if(falhas.length === 1){ marca.textContent = `parcial: falhou ${falhas[0]}`; marca.className = 'menu__estado aviso'; }
  else { marca.textContent = 'offline · dados locais'; marca.className = 'menu__estado erro'; }
}

/* =========================================================================
   10. NAVEGAÇÃO
   ========================================================================= */
/* =========================================================================
   10b. CROMOS DE INTERFACE — menu mobile, voltar ao topo, textos legais
   ========================================================================= */
function ligarMenuMobile(){
  const menu = $('#menu');
  const botao = $('#menu-abrir');
  if(!menu || !botao) return;

  const veu = document.createElement('div');
  veu.className = 'menu-veu';
  document.body.appendChild(veu);

  const fechar = () => {
    menu.classList.remove('aberto');
    veu.classList.remove('aparece');
    botao.setAttribute('aria-expanded','false');
    botao.setAttribute('aria-label','Abrir menu');
  };
  const abrir = () => {
    menu.classList.add('aberto');
    veu.classList.add('aparece');
    botao.setAttribute('aria-expanded','true');
    botao.setAttribute('aria-label','Fechar menu');
    menu.querySelector('.menu__item')?.focus();
  };

  botao.addEventListener('click', () =>
    menu.classList.contains('aberto') ? fechar() : abrir());
  veu.addEventListener('click', fechar);
  $$('.menu__item').forEach(b => b.addEventListener('click', fechar));
  addEventListener('keydown', e => {
    if(e.key === 'Escape' && menu.classList.contains('aberto')) { fechar(); botao.focus(); }
  });

  /* a barra fica colada por baixo do cabeçalho — a altura é medida, não adivinhada */
  const medir = () => document.documentElement.style.setProperty(
    '--altura-topo', ($('.topo')?.offsetHeight || 92) + 'px');
  medir();
  addEventListener('resize', medir);
}

function ligarAoTopo(){
  const botao = $('#ao-topo');
  if(!botao) return;
  botao.addEventListener('click', () => scrollTo({top:0, behavior:'smooth'}));

  let aEsperar = false;
  addEventListener('scroll', () => {
    if(aEsperar) return;
    aEsperar = true;
    requestAnimationFrame(() => {
      botao.classList.toggle('aparece', scrollY > 600);
      aEsperar = false;
    });
  }, {passive:true});
}

const TEXTOS_LEGAIS = {
  privacidade: ['Política de Privacidade', `
    <h4>O que se guarda</h4>
    <p>Este site não tem servidor de contas nem base de dados. Tudo o que
    guarda fica <b>no teu browser</b>, no teu computador:</p>
    <ul>
      <li>a tua conta (nome e um resumo criptográfico da palavra-passe)</li>
      <li>a tua formação e a pontuação da Fantasy</li>
      <li>o arquivo de notícias já lidas e a lista das mais abertas</li>
    </ul>
    <h4>O que não se guarda</h4>
    <p>Nada é enviado para lado nenhum. Não há registo de visitas, nem
    publicidade, nem partilha com terceiros.</p>
    <h4>Como apagar</h4>
    <p>Limpar os dados do site no browser apaga tudo, incluindo a conta.</p>`],

  termos: ['Termos de Utilização', `
    <h4>O que isto é</h4>
    <p>Um projeto pessoal de adepto. <b>Não tem qualquer ligação oficial ao
    Sporting Clube de Portugal.</b> Os emblemas e nomes pertencem aos
    respetivos donos.</p>
    <h4>Notícias</h4>
    <p>As notícias são dos jornais que as publicam. Aqui só se mostra o
    título, um resumo curto e a ligação — a leitura é sempre feita no site
    de origem, que recebe a visita.</p>
    <h4>Sem garantias</h4>
    <p>Os dados vêm de fontes públicas e podem ter erros ou atraso. Não uses
    isto como fonte única para nada que interesse a sério.</p>`],

  contacto: ['Contacto', `
    <h4>Quem faz</h4>
    <p>Projeto pessoal, feito por um adepto para uso próprio.</p>
    <h4>Erros e sugestões</h4>
    <p>Se encontrares um erro nos dados — um jogador que já saiu, um
    resultado trocado, uma notícia mal categorizada — quase tudo se corrige
    no ficheiro <code>js/data.js</code>.</p>
    <h4>Contribuir</h4>
    <p>O código está em GitHub, em <b>mikecruz1205/Sporting-ao-Minuto</b>.</p>`],

  fontes: ['Fontes dos dados', `
    <h4>Notícias</h4>
    <p>RSS diretos de Leonino, Record, Maisfutebol, Notícias ao Minuto,
    zerozero, RTP, Observador, Bola na Rede, Futebol 365, Correio da Manhã
    e Público. Atualizam de 60 em 60 segundos.</p>
    <h4>Plantel, jogos e classificação</h4>
    <p>API do Wikipédia, atualizada poucas horas depois de cada jogo.</p>
    <h4>Fotografias e emblemas</h4>
    <p>API-Football, descarregados uma vez para a pasta do projeto.</p>
    <h4>Valores de mercado</h4>
    <p>Transfermarkt, escritos à mão — o site bloqueia leitura automática.</p>`]
};

function ligarLegais(){
  const dlg = $('#legal');
  if(!dlg) return;
  $$('[data-legal]').forEach(b => b.addEventListener('click', () => {
    const [titulo, corpo] = TEXTOS_LEGAIS[b.dataset.legal] || ['—',''];
    $('#legal-titulo').textContent = titulo;
    $('#legal-corpo').innerHTML = corpo;
    dlg.showModal();
  }));
  $('#legal-fechar').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if(e.target === dlg) dlg.close(); });
}

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
  ligarMenuMobile();
  ligarAoTopo();
  ligarLegais();
  const elAno = $('#ano'); if(elAno) elAno.textContent = new Date().getFullYear();
  $('#lema').textContent = CONFIG.lema;
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
  carregarFormacaoGuardada();
  ligarEscolha();

  montarFundoEntrada();

  /* skeletons já visíveis enquanto os feeds não respondem */
  pintarHome();

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
    Contas.sair();
    location.reload();
  });

  addEventListener('keydown', e => {
    if(e.key === 'Escape') caixaProcura.classList.remove('is-aberta');
  });
}

document.addEventListener('DOMContentLoaded', arranque);
})();
