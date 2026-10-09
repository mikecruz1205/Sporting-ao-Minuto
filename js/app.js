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
let TABELA_CL = [...TABLE_CL];   // fase de liga da Champions
let FOTOS    = { jogadores: [], equipas: {} };
let EMBLEMAS = {};          // nome da equipa -> ficheiro (dados/emblemas.json)
let PLANTEL_ZZ = { jogadores: [] };  // plantel do zerozero (atualizar_plantel.py)
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
  'img/marca/emblema-256.webp', 'img/marca/emblema-512.png',
  'img/crest.png', 'img/crest.jpg', 'img/crest.jpeg', 'img/crest.webp',
  '/emblema', 'img/crest.svg', 'img/teams/228.png'
];
/* a fotografia é posta pelo montarFundoEntrada (o CSS já não a pede, senão
   vinha duas vezes); o webp vai à frente porque é o que existe */
const FUNDOS_ENTRADA = [
  'img/entrada.webp', 'img/entrada.jpg', 'img/entrada.jpeg', 'img/entrada.png', '/fundo'
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

/* As contas vivem na nuvem. Se não houver ligação, cai-se nas contas
   locais do js/contas.js para o site continuar a abrir — só que aí o chat
   e o ranking partilhado ficam de fora. */
const naNuvem = () => Nuvem.ligado;

function ligarAcesso(){
  /* já havia sessão? */
  if(naNuvem() && Nuvem.perfil){
    UTILIZADOR_ATUAL = Nuvem.perfil.nome_mostrado;
    abrirSite(false);
    return;
  }
  if(!naNuvem()){
    const sessao = Contas.sessao();
    if(sessao){
      UTILIZADOR_ATUAL = sessao.nome;
      abrirSite(false);
      return;
    }
  }

  /* avisa se estiver a trabalhar sem ligação */
  if(!naNuvem()){
    const nota = $('.acesso__nota');
    if(nota) nota.innerHTML = '<b style="color:var(--amarelo)">Sem ligação ao servidor.</b> '
      + 'Podes entrar com uma conta local, mas o chat e o ranking partilhado '
      + 'ficam indisponíveis.';
  }

  /* sem contas locais ainda? abre logo no registo */
  if(!naNuvem() && Contas.quantas() === 0) mostrarAba('criar');

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

    if(!naNuvem()){
      const usado = Contas.existe(v);
      estado.textContent = usado ? 'Já está a ser usado.' : 'Está livre.';
      estado.className = 'acesso__estado ' + (usado ? 'mau' : 'bom');
      return;
    }

    /* na nuvem a pergunta vai ao servidor — espera-se que a pessoa pare
       de escrever, senão era um pedido por cada tecla */
    estado.textContent = 'a verificar…';
    estado.className = 'acesso__estado';
    clearTimeout(campoNovo._espera);
    campoNovo._espera = setTimeout(async () => {
      if(campoNovo.value.trim() !== v) return;      // já mudou entretanto
      const livre = await Nuvem.nomeLivre(v);
      if(campoNovo.value.trim() !== v) return;
      estado.textContent = livre ? 'Está livre.' : 'Já está a ser usado.';
      estado.className = 'acesso__estado ' + (livre ? 'bom' : 'mau');
    }, 400);
  });

  /* ---- criar conta ---- */
  $('#form-criar').addEventListener('submit', async e => {
    e.preventDefault();
    const erroEl = $('#erro-criar');
    erroEl.textContent = '';

    const botao = e.target.querySelector('button[type=submit]');
    botao.disabled = true; botao.textContent = 'A CRIAR…';
    try{
      const palavra = $('#criar-palavra').value;
      const r = naNuvem()
        ? await Nuvem.registar(campoNovo.value, palavra)
        : await Contas.registar(campoNovo.value, palavra);
      if(r.erro){ erroEl.textContent = r.erro; treme(); return; }

      /* conta criada: entra já, sem obrigar a escrever outra vez */
      if(!naNuvem()) await Contas.entrar(campoNovo.value, palavra, true);
      UTILIZADOR_ATUAL = r.nome;
      abrirSite(true);
      await carregarFormacaoGuardada();
    }finally{
      botao.disabled = false; botao.textContent = 'CRIAR CONTA';
    }
  });

  /* ---- entrar ---- */
  $('#form-entrar').addEventListener('submit', async e => {
    e.preventDefault();
    const erroEl = $('#erro-entrar');
    erroEl.textContent = '';

    const botao = e.target.querySelector('button[type=submit]');
    botao.disabled = true; botao.textContent = 'A ENTRAR…';
    try{
      const utilizador = $('#entrar-utilizador').value;
      const palavra = $('#entrar-palavra').value;
      const r = naNuvem()
        ? await Nuvem.entrar(utilizador, palavra, $('#lembrar').checked)
        : await Contas.entrar(utilizador, palavra, $('#lembrar').checked);

      if(r.erro){
        erroEl.textContent = r.erro;
        $('#entrar-palavra').value = '';
        $('#entrar-palavra').focus();
        treme();
        return;
      }
      UTILIZADOR_ATUAL = r.nome;
      abrirSite(true);
      await carregarFormacaoGuardada();
    }finally{
      botao.disabled = false; botao.textContent = 'ENTRAR';
    }
  });

  const haLocais = !naNuvem() && Contas.quantas() > 0;
  setTimeout(() => $(naNuvem() || haLocais ? '#entrar-utilizador' : '#criar-utilizador').focus(), 300);
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

/* O mapa de emblemas usa os nomes tal como o Wikipedia os escreve. Como o
   site usa formas mais curtas ("V. Guimaraes", "Sp. Braga"), compara-se sem
   acentos nem pontuacao antes de desistir. */
let EMBLEMAS_CHAVE = null;
function emblemaPorChave(nome){
  if(!EMBLEMAS_CHAVE){
    EMBLEMAS_CHAVE = new Map();
    for(const [k, v] of Object.entries(EMBLEMAS)) EMBLEMAS_CHAVE.set(chaveNome(k), v);
  }
  return EMBLEMAS_CHAVE.get(chaveNome(nome));
}

function emblemaEquipa(nome){
  /* 1. mapa do atualizar_emblemas.py (Liga + Champions) */
  const doMapa = EMBLEMAS[nome] || emblemaPorChave(nome) || emblemaPorChave(APELIDOS_EQUIPA[chaveNome(nome)] || '');
  if(doMapa) return doMapa;
  /* 2. o que ficou da API-Football, enquanto durar */
  const alvo = NOMES_API[chaveNome(nome)];
  return (alvo && FOTOS.equipas[alvo]) || escudoIniciais(nome);
}

/* formas curtas que o site usa -> nome no mapa de emblemas */
const APELIDOS_EQUIPA = {
  'v guimaraes':'Vitória de Guimarães', 'vitoria sc':'Vitória de Guimarães',
  'sp braga':'Braga', 'sc braga':'Braga',
  'fc porto':'Porto', 'sl benfica':'Benfica',
  'ac viseu':'Académico de Viseu', 'estrela':'Estrela da Amadora',
  'paris sg':'Paris Saint-Germain', 'psg':'Paris Saint-Germain',
  'internazionale':'Inter Milan', 'inter':'Inter Milan',
  'man city':'Manchester City', 'man united':'Manchester United',
  'sporting':'Sporting CP', 'nacional da madeira':'Nacional'
};

const eSporting = n => /sporting cp/i.test(n||'');

/* Hora do jogo. Enquanto a Liga não a marcar, o Wikipédia não a tem —
   mais vale dizê-lo do que mostrar uma hora que ninguém garantiu. */
const horaJogo = (j, d) => j.semHora
  ? 'hora a marcar'
  : d.toLocaleTimeString('pt-PT', {hour:'2-digit', minute:'2-digit'});

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
      /* sitemap de notícias (Google News): cada <url> com <news:news> */
      const urls = [...doc.getElementsByTagName('url')].filter(u => u.getElementsByTagName('news:news').length);
      if(urls.length) return urls;
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

/* entidades como &eacute; passam a "é" — antes eram trocadas por um
   espaço e as notícias ficavam com "m dio" e "Atl tico" */
const descodificador = document.createElement('textarea');
function descodificar(t){
  descodificador.innerHTML = t;
  return descodificador.value;
}

/* o zerozero mete ligações internas como {TEAM_LINK|16|Sporting}:
   fica só o nome */
const tirarLigacoesZZ = t => (t || '').replace(/\{[A-Z_]+_LINK\|[^|}]*\|([^}]*)\}/g, '$1');

/* Atenção: isto vai parar a innerHTML. Depois de descodificar, um
   "&lt;img onerror=…&gt;" vindo de um feed seria HTML vivo — por isso
   os < e > que sobrarem saem. */
function limparTexto(html){
  return descodificar(tirarLigacoesZZ(html).replace(/<[^>]*>/g,' '))
                     .replace(/[<>]/g,'')
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

/* Tema fino de uma notícia: a modalidade, a formação, o clube ou o
   futebol. Não substitui a categoria (que continua a mandar nas cores e
   nos filtros antigos) — junta-se a ela. O título manda; o resumo só
   conta quando a categoria já diz que é de outra modalidade. */
const ORDEM_TEMAS = ['futsal','andebol','basquetebol','hoquei','voleibol','atletismo','feminino','formacao'];
function temaDe(n){
  const mods = Object.fromEntries(CONFIG.modalidades.map(m => [m.id, m]));
  for(const id of ORDEM_TEMAS) if(mods[id]?.rx?.test(n.titulo)) return id;
  if(n.categoria === 'MODALIDADES' || n.categoria === 'FEMININO'){
    for(const id of ORDEM_TEMAS) if(mods[id]?.rx?.test(n.resumo || '')) return id;
  }
  if(n.categoria === 'FEMININO') return 'feminino';
  if(n.categoria === 'FORMAÇÃO') return 'formacao';
  if(CONFIG.filtroClube.test(n.titulo)) return 'clube';
  return 'futebol';
}
const modalidade = id => CONFIG.modalidades.find(m => m.id === id);

/* etiqueta curta para o ao minuto: OFICIAL, MERCADO, BASQUETEBOL… */
function etiquetaEvento(n){
  const tema = temaDe(n);
  if(/\boficial\b/i.test(n.titulo)) return { texto:'Oficial', classe:'oficial' };
  if(tema === 'clube') return { texto:'Clube', classe:'clube' };
  if(tema !== 'futebol') return { texto: modalidade(tema)?.curto || tema, classe:'m-' + tema };
  if(n.categoria === 'MERCADO')  return { texto:'Mercado', classe:'mercado' };
  if(n.categoria === 'DESTAQUE') return { texto:'Destaque', classe:'destaque' };
  return null;      // futebol do dia a dia: a etiqueta seria ruído em cada linha
}

async function lerFeed(f){
  const itens = await buscarRSS(f.url);
  if(!itens) return 0;
  ultimaLeituraOk = Date.now();

  const novos = itens.map(it => {
    /* sitemap de notícias: só título, data e endereço — sem resumo nem imagem */
    if(it.localName === 'url'){
      const dt = it.getElementsByTagName('news:publication_date')[0]?.textContent;
      return {
        titulo: limparTexto(it.getElementsByTagName('news:title')[0]?.textContent),
        link: (it.getElementsByTagName('loc')[0]?.textContent || '').trim(),
        resumo: '', imagem: null,
        data: dt ? new Date(dt) : new Date(),
        fonte: f.nome, canal: f.id
      };
    }
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
  /* data inválida (feed mal formado) não pode ir parar ao topo nem ao fundo */
  .filter(n => !isNaN(n.data))
  .filter(n => n.titulo.length > 14 && n.link.startsWith('http'))
  /* o clube tem de estar no TÍTULO — se procurarmos também no resumo
     entram notícias de outros clubes que só mencionam o Sporting de passagem */
  .filter(n => CONFIG.filtroSporting.test(n.titulo))
  .filter(n => !CONFIG.excluir.some(rx => rx.test(n.titulo)));

  if(!novos.length) return 0;

  novos.forEach(n => n.categoria = classificar(n));

  /* Duplicados: o mesmo endereço, ou o mesmo título (a mesma notícia
     publicada em várias secções ou copiada por outro jornal). Fica sempre
     a primeira que chegou — com a fonte e o link originais. */
  const mapa = new Map(NOTICIAS.map(n => [chaveNome(n.titulo).slice(0,60), n]));
  const links = new Set(NOTICIAS.map(n => n.link));
  novos.forEach(n => {
    const k = chaveNome(n.titulo).slice(0,60);
    if(links.has(n.link) && !mapa.has(k)) return;
    links.add(n.link);
    /* se já estava no arquivo, o texto fresco ganha ao guardado — mas só
       quando vem da mesma fonte; de outro jornal não troca nada */
    if(!mapa.has(k)) mapa.set(k, n);
    else if(mapa.get(k).canal === n.canal) mapa.set(k, {...mapa.get(k), titulo:n.titulo, resumo:n.resumo || mapa.get(k).resumo});
  });
  const antes = NOTICIAS.length;
  NOTICIAS = [...mapa.values()].sort((a,b) => b.data - a.data).slice(0, LIMITE_ARQUIVO);
  guardarArquivo();
  return NOTICIAS.length - antes;      // quantas são mesmo novas
}

let novasDesdeVista = 0;

/* até a primeira volta pelos jornais acabar, uma lista vazia é "a carregar";
   depois disso, sem nenhuma notícia, é erro (e há botão para tentar outra vez) */
let primeiraLeituraFeita = false;
async function carregarNoticias(){
  let novas = 0;
  for(const f of CONFIG.feeds){
    novas += await lerFeed(f);
    pintarNoticias();
  }

  ultimaLeitura = Date.now();
  if(!primeiraLeituraFeita){
    primeiraLeituraFeita = true;
    if(!NOTICIAS.length) pintarNoticias();
  }
  if(novas > 0) novasDesdeVista += novas;
  marcarAtualizacao(novas);
  pintarSeloVivo();

  const badge = $('#badge-alertas');
  badge.textContent = novasDesdeVista || NOTICIAS.length;
  badge.classList.toggle('vazio', !NOTICIAS.length);
  return novas;
}

let ultimaLeitura = 0;
let ultimaLeituraOk = 0;     // a última vez que pelo menos um jornal respondeu

/* O selo "Ao vivo" só aparece quando as atualizações estão mesmo a
   acontecer: o site relê os jornais a cada minuto e o último feed
   respondeu há menos de 3 minutos. Fora disso diz a hora da última
   leitura, ou que não há ligação — nunca finge estar ao vivo. */
function pintarSeloVivo(){
  const ligado = navigator.onLine !== false;
  const ativo = ligado && ultimaLeituraOk && Date.now() - ultimaLeituraOk < 3 * 60000;
  const hora = ultimaLeituraOk
    ? new Date(ultimaLeituraOk).toLocaleTimeString('pt-PT', { hour:'2-digit', minute:'2-digit' }) : '';
  const texto = ativo ? 'Ao vivo'
              : !ligado ? 'Sem ligação'
              : hora ? `Atualizado às ${hora}` : 'A ligar…';
  const ajuda = ativo
    ? `Os jornais são relidos a cada ${CONFIG.refreshSegundos} segundos. Última leitura às ${hora}.`
    : !ligado ? 'Sem ligação à internet: mostra-se o que já estava guardado.'
    : 'As atualizações automáticas estão paradas de momento.';
  $$('[data-selo-vivo]').forEach(el => {
    el.classList.toggle('selo-vivo--ativo', !!ativo);
    el.innerHTML = `<span class="${ativo ? 'ponto-vivo' : 'ponto-parado'}" aria-hidden="true"></span>${texto}`;
    el.title = ajuda;
  });
}
setInterval(pintarSeloVivo, 30000);
addEventListener('online', pintarSeloVivo);
addEventListener('offline', pintarSeloVivo);

function marcarAtualizacao(novas){
  const el = $('#feed-estado');
  if(!el) return;
  const hora = new Date(ultimaLeitura).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});
  const respondeu = ultimaLeituraOk && Date.now() - ultimaLeituraOk < 2 * 60000;
  el.innerHTML = !respondeu ? 'os jornais não responderam'
    : novas > 0 ? `<b>+${novas}</b> novas · ${hora}`
    : `atualizado às ${hora}`;
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
    /* o arquivo é antigo e os filtros mudam com o tempo — volta-se a
       passar tudo pelo crivo, senão lixo apanhado ontem fica cá para sempre */
    NOTICIAS = c.itens.map(n => ({...n, data:new Date(n.data), resumo:tirarLigacoesZZ(n.resumo)}))
                      .filter(n => n.data.getTime() > limite)
                      .filter(n => CONFIG.filtroSporting.test(n.titulo))
                      .filter(n => !CONFIG.excluir.some(rx => rx.test(n.titulo)));
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

const dataCurta = d => `${String(d.getDate()).padStart(2,'0')} ${MESES_CURTOS[d.getMonth()].toUpperCase()}`;

function itemNoticia(n){
  return Componentes.itemLista(n, procuraTexto);
}

/* lista ainda vazia: a carregar, sem ligação ou os jornais não responderam */
function estadoSemNoticias(tag = 'li'){
  return primeiraLeituraFeita || navigator.onLine === false
    ? Componentes.erroLeitura(navigator.onLine === false, tag)
    : (tag === 'li' ? Componentes.esqueletoLista(4) : '');
}
document.addEventListener('click', e => {
  if(!e.target.closest('[data-repetir-leitura]')) return;
  primeiraLeituraFeita = false;
  pintarNoticias();
  carregarNoticias();
});
addEventListener('online', () => { if(!NOTICIAS.length) carregarNoticias(); });

/* mostra a lista com uma barra por dia, para se perceber o recuo no tempo */
let mostradas = 40;

/* a primeira notícia com fotografia de cada dia vai em cartão grande */
function agruparPorDia(lista){
  let saida = '', diaAtual = '', grandeNoDia = false;
  const hoje = new Date().toDateString();
  const ontem = new Date(Date.now()-86400000).toDateString();

  lista.forEach(n => {
    const d = n.data.toDateString();
    if(d !== diaAtual){
      diaAtual = d;
      grandeNoDia = false;
      const rotulo = d === hoje ? 'Hoje'
                   : d === ontem ? 'Ontem'
                   : n.data.toLocaleDateString('pt-PT', {weekday:'long', day:'numeric', month:'long'});
      saida += `<li class="dia ${d === hoje ? 'dia--hoje' : ''}"><span>${rotulo}</span></li>`;
    }
    const grande = !grandeNoDia && !!n.imagem;
    if(grande) grandeNoDia = true;
    saida += Componentes.itemLista(n, procuraTexto, { grande, agrupado: true });
  });
  return saida;
}

/* ---------------------------------------------------------------------
   TEMAS DAS NOTÍCIAS — grupos e subtemas para os filtros da vista
   Notícias. Cada subtema é uma regra sobre o título (e sobre a categoria
   e o tema que a notícia já tem). São leituras por palavras-chave: nada
   muda a origem nem a categoria da notícia, e um subtema sem notícias
   não aparece.
   --------------------------------------------------------------------- */
const RX_ENTRADA = /refor[çc]o|contrat(a|ou|ad[oa])\b|\bassin(a|ou)\b|chega(da)? a alvalade|apresentad[oa]|novo le[ãa]o|garante|acordo (com|para) (a )?(contrata|chegada)/i;
const RX_SAIDA   = /sa[íi]da|deixa(r)? (o sporting|alvalade)|vendid[oa]|venda de|empr[ée]st|rescis|cedid[oa]|rumo a|troca o sporting|despede|adeus|\bsai\b/i;
const RX_RUMOR   = /interess|alvo|na mira|sondag|poder[áa]|rumor|negocia|proposta|\bquer\b|observa|cobi[çc]a|pretend|segue|aponta/i;
const RX_ANTEVISAO = /antevis|confer[êe]ncia de imprensa|convocad|onze prov[áa]vel|antes do jogo|pr[ée]-jogo|vai defrontar|defronta|recebe o|visita o|prepara (o|a) (jogo|receção|deslocação)/i;
const RX_RESULTADO = /\b\d{1,2}-\d{1,2}\b|venc(e|eu)|empat(a|ou)|perd(e|eu)\b|derrot|golei|triunf|vit[óo]ria/i;
const RX_RESCALDO  = /ap[óo]s o jogo|no final do jogo|rescaldo|reag(e|iu)|rea[çc][ãa]o|declara[çc]|\bnotas\b|an[áa]lise|figura|melhor em campo|depois d[ao] (jogo|vit[óo]ria|empate|derrota)|flash/i;
const RX_DIRECAO = /varandas|dire[çc][ãa]o|presidente|assembleia|\bSAD\b|elei[çc]|administra[çc]/i;
const RX_ESTADIO = /est[áa]dio|alvalade xxi|bilhete|lota[çc][ãa]o|relvado|obras|camarote|lugar anual/i;
const RX_ADEPTOS = /adeptos|claque|juve leo|juventude leonina|torcida|s[óo]cios|\bf[ãa]s\b/i;

const GRUPOS_TEMA = [
  { id:'sporting', nome:'Sporting', subs:[
    ['equipa',      'Equipa principal', n => temaDe(n) === 'futebol' && (n.categoria === 'EQUIPA PRINCIPAL' || n.categoria === 'DESTAQUE')],
    ['formacao',    'Formação',         n => temaDe(n) === 'formacao'],
    ['feminino',    'Futebol feminino', n => temaDe(n) === 'feminino'],
    ['academia',    'Academia',         n => /academia|alcochete/i.test(n.titulo)],
    ['modalidades', 'Modalidades',      n => !['futebol','clube','formacao','feminino'].includes(temaDe(n))]
  ]},
  { id:'mercado', nome:'Mercado', subs:[
    ['entradas', 'Entradas', n => n.categoria === 'MERCADO' && RX_ENTRADA.test(n.titulo)],
    ['saidas',   'Saídas',   n => n.categoria === 'MERCADO' && RX_SAIDA.test(n.titulo)],
    ['rumores',  'Rumores',  n => n.categoria === 'MERCADO' && (RX_RUMOR.test(n.titulo) || (!RX_ENTRADA.test(n.titulo) && !RX_SAIDA.test(n.titulo)))]
  ]},
  { id:'jogos', nome:'Jogos', subs:[
    ['antevisao',  'Antevisão',  n => RX_ANTEVISAO.test(n.titulo)],
    ['resultados', 'Resultados', n => RX_RESULTADO.test(n.titulo)],
    ['rescaldo',   'Rescaldo',   n => RX_RESCALDO.test(n.titulo)]
  ]},
  { id:'clube', nome:'Clube', subs:[
    ['direcao', 'Direção', n => RX_DIRECAO.test(n.titulo)],
    ['estadio', 'Estádio', n => RX_ESTADIO.test(n.titulo)],
    ['adeptos', 'Adeptos', n => RX_ADEPTOS.test(n.titulo)]
  ]}
];
let temaNoticias = 'todos', subtemaNoticias = 'todos';

const grupoTema = id => GRUPOS_TEMA.find(g => g.id === id);
function noTema(n, grupo, sub){
  if(grupo === 'todos') return true;
  const g = grupoTema(grupo);
  if(!g) return true;
  if(sub !== 'todos'){ const s = g.subs.find(x => x[0] === sub); return s ? s[2](n) : true; }
  return g.subs.some(x => x[2](n));
}

/* desenha as duas linhas de filtros de tema, com as contagens reais */
function pintarTemasNoticias(base){
  const alvo = $('#temas-noticias');
  const linhaSub = $('#subtemas-noticias');
  if(!alvo || !linhaSub) return;
  const conta = (g, s = 'todos') => base.filter(n => noTema(n, g, s)).length;

  const grupos = GRUPOS_TEMA.map(g => [g, conta(g.id)]).filter(([, c]) => c > 0);
  if(temaNoticias !== 'todos' && !grupos.some(([g]) => g.id === temaNoticias)){ temaNoticias = 'todos'; subtemaNoticias = 'todos'; }
  alvo.innerHTML = [
    `<button type="button" class="chip ${temaNoticias === 'todos' ? 'is-on' : ''}" data-tema="todos" aria-pressed="${temaNoticias === 'todos'}">Tudo<span class="chip__n">${base.length}</span></button>`,
    ...grupos.map(([g, c]) => `<button type="button" class="chip ${temaNoticias === g.id ? 'is-on' : ''}" data-tema="${g.id}" aria-pressed="${temaNoticias === g.id}">${g.nome}<span class="chip__n">${c}</span></button>`)
  ].join('');

  const g = grupoTema(temaNoticias);
  const subs = g ? g.subs.map(x => [x, conta(g.id, x[0])]).filter(([, c]) => c > 0) : [];
  linhaSub.hidden = !g || !subs.length;
  if(g && subtemaNoticias !== 'todos' && !subs.some(([x]) => x[0] === subtemaNoticias)) subtemaNoticias = 'todos';
  linhaSub.innerHTML = g ? [
    `<button type="button" class="chip ${subtemaNoticias === 'todos' ? 'is-on' : ''}" data-sub="todos" aria-pressed="${subtemaNoticias === 'todos'}">Todo o ${g.nome.toLowerCase()}</button>`,
    ...subs.map(([x, c]) => `<button type="button" class="chip ${subtemaNoticias === x[0] ? 'is-on' : ''}" data-sub="${x[0]}" aria-pressed="${subtemaNoticias === x[0]}">${x[1]}<span class="chip__n">${c}</span></button>`)
  ].join('') : '';

  alvo.querySelectorAll('[data-tema]').forEach(b => b.addEventListener('click', () => {
    temaNoticias = b.dataset.tema; subtemaNoticias = 'todos'; mostradas = 40; pintarNoticias();
  }));
  linhaSub.querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', () => {
    subtemaNoticias = b.dataset.sub; mostradas = 40; pintarNoticias();
  }));
  requestAnimationFrame(() => marcarTransbordo($('#vista-noticias')));
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

  /* ---- hero rotativo ---- */
  const principal = escolherPrincipal(lista);
  montarHero(lista, principal);

  /* ---- filtros de categoria ---- */
  pintarFiltrosCategoria();

  /* ---- últimas ---- */
  const alvoUltimas = $('#ultimas');
  if(alvoUltimas){
    /* o que já está no palco não se repete logo a seguir */
    const noPalco = new Set(heroLista.map(n => n.link));
    const restantes = lista.filter(n => !noPalco.has(n.link))
                           .filter(n => noSeparador(n, categoriaHome))
                           .slice(0, 13);
    alvoUltimas.innerHTML = !NOTICIAS.length
      ? Componentes.esqueletoEditorial()
      : restantes.length
        ? composicaoEditorial(restantes)
        : Componentes.vazio('Nada nesta categoria',
            'Experimenta outro filtro — as notícias entram de minuto a minuto.',
            tacaSVG('taca', 'var(--texto-3)'));
  }

  /* ---- mercado ---- */
  const alvoMercado = $('#mercado-home');
  if(alvoMercado){
    const mercado = NOTICIAS.filter(n => n.categoria === 'MERCADO').slice(0,4);
    alvoMercado.innerHTML = !NOTICIAS.length
      ? Componentes.esqueletoCartao(3)
      : mercado.length
        ? mercado.map(n => Componentes.cartaoEditorial(n, 'curta')).join('')
        : Componentes.vazio('Mercado calmo', 'Sem movimentações na imprensa neste momento.',
            tacaSVG('supertaca', 'var(--texto-3)'));
  }

  /* ---- vídeos ---- */
  const alvoVideos = $('#videos');
  if(alvoVideos){
    const videos = NOTICIAS.filter(n => CONFIG.filtroVideo.test(n.titulo + ' ' + n.resumo)).slice(0,4);
    alvoVideos.closest('.seccao').hidden = NOTICIAS.length > 0 && videos.length === 0;
    alvoVideos.innerHTML = !NOTICIAS.length
      ? Componentes.esqueletoCartao(2)
      : videos.map(n => Componentes.cartaoEditorial(n, 'curta')).join('');
  }

  pintarModalidadesCasa();
  pintarImportantes();
  pintarAtalhos();

  /* ---- mais lidas ---- */
  pintarMaisLidas();
  /* a entrada só se faz na primeira pintura com notícias; as que chegam
     depois, de minuto a minuto, aparecem sem voltar a animar a página */
  if(NOTICIAS.length && !homeRevelada){
    homeRevelada = true;
    revelar($('#vista-inicio'));
  }
}
let homeRevelada = false;

/* Filas que deslizam para o lado (temas, separadores): quando há mais do
   que cabe, a ponta desvanece — sem isso o último item parece cortado. */
function marcarTransbordo(raiz = document){
  raiz.querySelectorAll('.temas, .mod-separadores, .separadores, #pos-filtro, .jogos-filtro, .filtros-categoria, .atalhos, .filtro-temas, .filtro-linha--sub').forEach(el => {
    const mais = el.scrollWidth - el.clientWidth - el.scrollLeft > 4;
    el.classList.toggle('tem-mais', mais);
    if(!el.dataset.transbordo){
      el.dataset.transbordo = '1';
      el.addEventListener('scroll', () => marcarTransbordo(el.parentElement), { passive:true });
    }
  });
}
addEventListener('resize', () => marcarTransbordo());

/* "Importantes · 24 h": as notícias importantes do último dia — oficiais e
   destaques (palavras fortes no título) — sem repetir as do destaque.
   Com menos de duas, a faixa não aparece: não se enche com notícias
   banais só para ocupar o lugar. */
function pintarImportantes(){
  const seccao = $('#importantes');
  const alvo = $('#importantes-lista');
  if(!seccao || !alvo) return;
  /* últimas 24 horas: "hoje" de calendário deixava a faixa vazia de madrugada */
  const limite = Date.now() - 24 * 3600000;
  const noPalco = new Set(heroLista.map(n => n.link));
  const lista = NOTICIAS
    .filter(n => n.data.getTime() > limite && !noPalco.has(n.link))
    .filter(n => n.categoria === 'DESTAQUE' || /\boficial\b/i.test(n.titulo))
    .slice(0, 4);
  seccao.hidden = lista.length < 2;
  if(seccao.hidden) return;
  alvo.innerHTML = lista.map((n, i) => `
    <li class="imp">
      <a class="imp__ligacao" href="${/^https?:\/\//i.test(n.link || '') ? Componentes.seguro(n.link) : '#'}"
         target="_blank" rel="noopener" data-link="${Componentes.seguro(n.link)}">
        <span class="imp__n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
        <span class="imp__corpo">
          <span class="etiqueta etiqueta--${Componentes.categoriaClasse(n.categoria)}">${Componentes.seguro(n.categoria)}</span>
          <span class="imp__titulo">${Componentes.seguro(n.titulo)}</span>
          <span class="imp__meta"><span class="ed__fonte">${Componentes.seguro(n.fonte)}</span> · ${n.data.toLocaleTimeString('pt-PT', { hour:'2-digit', minute:'2-digit' })}</span>
        </span>
      </a>
    </li>`).join('');
}

/* Acesso rápido: as categorias e modalidades principais, num toque.
   Cada atalho leva à vista certa já filtrada. */
const ATALHOS = [
  ['Equipa principal', () => { temaNoticias = 'sporting'; subtemaNoticias = 'equipa'; irPara('noticias'); pintarNoticias(); }],
  ['Mercado',          () => irPara('rumores')],
  ['Ao minuto',        () => irPara('aominuto')],
  ['Jogos',            () => irPara('jogos')],
  ['Classificação',    () => irPara('classificacao')],
  ['Futebol feminino', () => abrirModalidade('feminino')],
  ['Formação',         () => abrirModalidade('formacao')],
  ['Modalidades',      () => irPara('modalidades')]
];
function abrirModalidade(id){
  modalidadeAtual = id;
  history.pushState({ vista:'modalidades' }, '', '/modalidades#' + id);
  irPara('modalidades', { historico:false });
}
function pintarAtalhos(){
  const alvo = $('#atalhos');
  if(!alvo || alvo.dataset.pronto) return;
  alvo.dataset.pronto = '1';
  alvo.innerHTML = `<span class="atalhos__rotulo">Acesso rápido</span>` +
    ATALHOS.map(([nome], i) => `<button type="button" class="chip atalho" data-atalho="${i}">${nome}</button>`).join('');
  alvo.querySelectorAll('[data-atalho]').forEach(b => b.addEventListener('click', () => ATALHOS[+b.dataset.atalho][1]()));
  requestAnimationFrame(() => marcarTransbordo(alvo.parentElement));
}

/* notícias de uma modalidade, das mais recentes para trás */
const noticiasDe = id => NOTICIAS.filter(n => temaDe(n) === id);

/* Mosaico das modalidades na homepage: cada uma com a cor própria, a
   notícia mais recente e quantas houve na última semana. */
function pintarModalidadesCasa(){
  const alvo = $('#modalidades-casa');
  if(!alvo) return;
  if(!NOTICIAS.length){
    alvo.innerHTML = Array.from({ length: 8 }, () => '<div class="mod-tile mod-tile--osso"><div class="osso"></div></div>').join('');
    return;
  }
  const semana = Date.now() - 7 * 86400000;
  alvo.innerHTML = CONFIG.modalidades.filter(m => m.id !== 'futebol').map(m => {
    const lista = noticiasDe(m.id);
    const recentes = lista.filter(n => n.data.getTime() > semana).length;
    const ultima = lista[0];
    return `
      <a class="mod-tile" href="/modalidades#${m.id}" data-modalidade="${m.id}" style="--m-cor: var(--m-${m.id})">
        <span class="mod-tile__topo">
          <span class="mod-tile__nome">${m.nome}</span>
          <span class="mod-tile__n">${recentes ? `${recentes} ${recentes === 1 ? 'notícia' : 'notícias'} esta semana` : 'Sem novidades esta semana'}</span>
        </span>
        ${ultima
          ? `<span class="mod-tile__titulo">${Componentes.seguro(ultima.titulo)}</span>
             <span class="mod-tile__quando">${haQuanto(ultima.data)} · ${Componentes.seguro(ultima.fonte)}</span>`
          : `<span class="mod-tile__titulo mod-tile__titulo--vazio">Ainda sem notícias no arquivo.</span>`}
      </a>`;
  }).join('');
  alvo.querySelectorAll('.mod-tile').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    modalidadeAtual = a.dataset.modalidade;
    history.pushState({ vista:'modalidades' }, '', '/modalidades#' + modalidadeAtual);
    irPara('modalidades', { historico:false });
  }));
}

/* Uma principal grande, três secundárias ao lado e o resto em grelha.
   As que têm fotografia vão primeiro para os lugares grandes — uma
   principal sem imagem estraga a página toda — mas dentro de cada grupo
   mantém-se a ordem por data. */
function composicaoEditorial(lista){
  const comFoto = n => !!n.imagem;
  const porFoto = (a, b) => comFoto(b) - comFoto(a);       // estável: dentro de cada grupo fica a data
  const topo = [...lista].sort(porFoto).slice(0, 4);
  const resto = lista.filter(n => !topo.includes(n));
  /* com fotografia vão para cartões; sem fotografia, para a lista de
     manchetes — uma grelha de capas vazias iguais não diz nada */
  let grelha = resto.filter(comFoto).slice(0, 6);
  if(grelha.length < 2) grelha = [];
  const manchetes = resto.filter(n => !grelha.includes(n)).slice(0, 10);

  const [principal, ...secundarias] = topo;
  const d = procuraTexto;
  return `
    <div class="editorial__topo">
      ${principal ? Componentes.cartaoEditorial(principal, 'principal', d) : ''}
      ${secundarias.length ? `<div class="editorial__lado">
        ${secundarias.map(n => Componentes.cartaoEditorial(n, 'secundaria', d)).join('')}
      </div>` : ''}
    </div>
    ${grelha.length ? `<div class="editorial__grelha">
      ${grelha.map(n => Componentes.cartaoEditorial(n, 'curta', d)).join('')}
    </div>` : ''}
    ${manchetes.length ? `<div class="editorial__manchetes">
      <h3 class="editorial__sub">Mais manchetes</h3>
      <ol class="manchetes">${manchetes.map(n => Componentes.manchete(n, d)).join('')}</ol>
    </div>` : ''}`;
}

/* Os cartões entram com um deslize curto quando chegam ao ecrã.
   Uma vez visto, fica visto — não se anima de cada vez que se volta. */
let observadorRevelar = null;
function revelar(raiz){
  if(!raiz) return;
  const alvos = raiz.querySelectorAll('.ed:not(.visto), .cartao:not(.visto), .caixa:not(.visto)');
  if(!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches){
    alvos.forEach(el => el.classList.add('visto'));
    return;
  }
  observadorRevelar ||= new IntersectionObserver(entradas => {
    entradas.forEach(e => {
      if(!e.isIntersecting) return;
      e.target.classList.add('visto');
      observadorRevelar.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -40px 0px' });
  alvos.forEach(el => { el.classList.add('revela'); observadorRevelar.observe(el); });
}

/* =========================================================================
   HERO ROTATIVO — as notícias de destaque vão mudando sozinhas
   ========================================================================= */
let heroLista = [];
let heroIdx = 0;
let heroRelogio = null;
const HERO_QUANTAS = 5;
const HERO_SEGUNDOS = 7;

function montarHero(lista, principal){
  const alvo = $('#hero');
  if(!alvo) return;

  if(!NOTICIAS.length){
    alvo.innerHTML = Componentes.esqueletoHero();
    $('#hero-pontos').innerHTML = '';
    return;
  }

  /* a principal à frente, depois as outras com fotografia */
  const nova = [principal, ...lista.filter(n => n !== principal && n.imagem)]
                 .filter(Boolean).slice(0, HERO_QUANTAS);

  /* nada mudou? não se repinta, senão a rotação saltava */
  const chave = nova.map(n => n.link).join('|');
  if(alvo.dataset.chave === chave){ return; }
  alvo.dataset.chave = chave;

  heroLista = nova;
  heroIdx = 0;

  alvo.innerHTML = heroLista
    .map((n,i) => `<div class="hero-slide ${i===0?'is-on':''}" data-i="${i}"
        role="tabpanel" aria-roledescription="destaque" aria-label="${i+1} de ${heroLista.length}">
        ${Componentes.hero(n, procuraTexto, i)}</div>`).join('');

  /* em vez de pontos, a fila do que vem a seguir — número, título e a
     barra que enche até mudar */
  $('#hero-pontos').innerHTML = heroLista.map((n,i) => `
    <button class="hero-ponto ${i===0?'is-on':''}" data-i="${i}" role="tab"
            aria-selected="${i===0}" aria-label="Destaque ${i+1}: ${Componentes.seguro(n.titulo)}">
      <span class="hero-ponto__n" aria-hidden="true">${String(i+1).padStart(2,'0')}</span>
      <span class="hero-ponto__t" aria-hidden="true">${Componentes.seguro(n.titulo)}</span>
      <span class="hero-ponto__barra" aria-hidden="true"></span>
    </button>`).join('');
  document.documentElement.style.setProperty('--hero-segundos', HERO_SEGUNDOS + 's');

  $$('#hero-pontos .hero-ponto').forEach(b =>
    b.addEventListener('click', () => mostrarHero(+b.dataset.i, true)));

  arrancarHero();
}

function mostrarHero(i, manual){
  if(!heroLista.length) return;
  heroIdx = ((i % heroLista.length) + heroLista.length) % heroLista.length;

  $$('#hero .hero-slide').forEach((s,k) => s.classList.toggle('is-on', k === heroIdx));
  $$('#hero-pontos .hero-ponto').forEach((p,k) => {
    p.classList.toggle('is-on', k === heroIdx);
    p.setAttribute('aria-selected', k === heroIdx);
  });

  if(manual) arrancarHero();      // mexer reinicia a contagem
}

function arrancarHero(){
  clearInterval(heroRelogio);
  reiniciarBarraHero();
  if(heroLista.length < 2) return;
  /* quem pediu menos movimento não leva com slides a mudar sozinhos */
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  heroRelogio = setInterval(() => { mostrarHero(heroIdx + 1); reiniciarBarraHero(); }, HERO_SEGUNDOS * 1000);
}

/* a barra do destaque atual volta a zero e enche outra vez */
function reiniciarBarraHero(){
  const caixa = $('.hero-caixa');
  if(!caixa) return;
  caixa.classList.remove('a-correr');
  void caixa.offsetWidth;
  if(heroLista.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches)
    caixa.classList.add('a-correr');
}

function ligarHero(){
  $('#hero-ant')?.addEventListener('click', () => mostrarHero(heroIdx - 1, true));
  $('#hero-seg')?.addEventListener('click', () => mostrarHero(heroIdx + 1, true));

  /* com o rato em cima ou com o separador escondido, pára */
  const caixa = $('.hero-caixa');
  caixa?.addEventListener('mouseenter', () => { clearInterval(heroRelogio); caixa.classList.add('em-pausa'); });
  caixa?.addEventListener('mouseleave', () => { caixa.classList.remove('em-pausa'); arrancarHero(); });
  /* teclado: setas mudam de destaque quando o foco está no palco */
  caixa?.addEventListener('keydown', e => {
    if(e.key === 'ArrowRight'){ mostrarHero(heroIdx + 1, true); e.preventDefault(); }
    if(e.key === 'ArrowLeft'){  mostrarHero(heroIdx - 1, true); e.preventDefault(); }
  });
  document.addEventListener('visibilitychange', () =>
    document.hidden ? clearInterval(heroRelogio) : arrancarHero());

  /* deslizar com o dedo */
  let x0 = null;
  caixa?.addEventListener('pointerdown', e => { x0 = e.clientX; });
  caixa?.addEventListener('pointerup', e => {
    if(x0 === null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if(Math.abs(dx) > 45) mostrarHero(heroIdx + (dx < 0 ? 1 : -1), true);
  });
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

/* separadores das notícias: compactos, uma linha só. Os da antiga
   categoria continuam a funcionar; Sub-23, Clube e Modalidades usam o tema. */
const SEPARADORES_NOTICIAS = [
  ['todas', 'Tudo'], ['EQUIPA PRINCIPAL', 'Equipa principal'], ['MERCADO', 'Mercado'],
  ['MODALIDADES', 'Modalidades'], ['FORMAÇÃO', 'Formação'], ['SUB-23', 'Sub-23'],
  ['FEMININO', 'Feminino'], ['CLUBE', 'Clube']
];
function noSeparador(n, chave){
  if(chave === 'todas') return true;
  if(chave === 'SUB-23') return CONFIG.filtroSub23.test(n.titulo);
  if(chave === 'CLUBE') return temaDe(n) === 'clube';
  if(chave === 'MODALIDADES') return !['futebol','clube','formacao','feminino'].includes(temaDe(n));
  if(chave === 'EQUIPA PRINCIPAL') return (n.categoria === 'EQUIPA PRINCIPAL' || n.categoria === 'DESTAQUE') && temaDe(n) === 'futebol';
  return n.categoria === chave;
}

function pintarFiltrosCategoria(){
  const alvo = $('#filtros-categoria');
  if(!alvo || !NOTICIAS.length) return;

  const contas = Object.fromEntries(SEPARADORES_NOTICIAS.map(([c]) => [c, NOTICIAS.filter(n => noSeparador(n, c)).length]));
  const visiveis = SEPARADORES_NOTICIAS.filter(([c]) => c === 'todas' || contas[c] > 0);

  const chave = visiveis.map(([c]) => c + contas[c]).join('|') + categoriaHome;
  if(alvo.dataset.chave === chave) return;
  alvo.dataset.chave = chave;

  alvo.innerHTML = visiveis.map(([c, rotulo]) => `
    <button type="button" class="tema ${c === categoriaHome ? 'is-on' : ''}" data-cat="${c}" aria-pressed="${c === categoriaHome}">
      ${rotulo}${c !== 'todas' ? `<span class="tema__n">${contas[c]}</span>` : ''}
    </button>`).join('');

  requestAnimationFrame(() => marcarTransbordo(alvo.parentElement));
  $$('#filtros-categoria .tema').forEach(b =>
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
  /* sem nenhuma notícia: esqueleto enquanto se lê, erro depois; com
     notícias mas nenhuma daquele tipo: uma frase simples */
  const vazio = texto => NOTICIAS.length ? `<li class="vazio">${texto}</li>` : estadoSemNoticias();

  const curtas = NOTICIAS.filter(n => n.categoria !== 'MERCADO').slice(0,6);
  $('#noticias-curtas').innerHTML = curtas.length ? curtas.map(itemNoticia).join('') : vazio('Sem notícias de momento.');

  /* a fonte e a pesquisa filtram primeiro; o tema por cima disso */
  const daFonte = noticiasFiltradas();
  pintarTemasNoticias(daFonte);
  const todas = daFonte.filter(n => noTema(n, temaNoticias, subtemaNoticias));
  $('#noticias-todas').innerHTML = todas.length
    ? agruparPorDia(todas.slice(0, mostradas))
    : !NOTICIAS.length ? estadoSemNoticias()
    : `<li class="estado"><p class="estado__titulo">Nada encontrado</p><p class="estado__texto">${procuraTexto
        ? 'Nenhuma notícia fala de «' + Componentes.seguro(procuraTexto) + '» com estes filtros.'
        : 'Não há notícias com esta combinação de tema e fonte. Experimenta outro filtro.'}</p></li>`;

  const btn = $('#mais-antigas');
  if(btn){
    const restam = todas.length - mostradas;
    btn.hidden = restam <= 0;
    btn.textContent = `Ver mais antigas (${restam})`;
  }
  const cont = $('#noticias-conta');
  if(cont) cont.textContent = todas.length
    ? `${todas.length} notícias · desde ${dataCurta(todas[todas.length-1].data)}`
    : '';

  const rumores = NOTICIAS.filter(n => n.categoria === 'MERCADO');
  $('#rumores-todos').innerHTML = rumores.length ? rumores.slice(0,40).map(itemNoticia).join('') : vazio('Sem rumores de mercado neste momento.');
  $('#rumores-curtos').innerHTML = rumores.slice(0,3).map(n => `
    <li><a href="${n.link}" target="_blank" rel="noopener">
      <img src="${n.imagem || escudoIniciais('SCP')}" alt="" loading="lazy"
           onerror="this.src='${escudoIniciais('SCP')}'">
      <div><b>${n.titulo}</b><span>${haQuanto(n.data).toUpperCase()} · ${n.fonte}</span></div>
    </a></li>`).join('') || `<li class="vazio">Sem rumores agora.</li>`;

  const formacao = NOTICIAS.filter(n => n.categoria === 'FORMAÇÃO');
  $('#formacao-lista').innerHTML = formacao.length
    ? formacao.map(itemNoticia).join('')
    : vazio('Sem notícias da formação neste momento.');

  pintarFontes();
  pintarDestaque();
  pintarLinhaTempo();
  pintarHome();
  /* (o intervalo da faixa do jogo é posto uma vez no arranque — aqui
     acumulava um novo a cada leitura dos jornais) */
  pintarDiaDeJogo();
}

/* A fonte é um seletor nativo dentro de um chip: ocupa o espaço de um
   botão e no telemóvel abre a lista do sistema. O rótulo do chip mostra
   a escolha. Não se refaz a lista com o seletor aberto. */
function pintarFontes(){
  const sel = $('#fonte-escolha');
  if(!sel) return;
  const nomeFonte = id => {
    const f = CONFIG.feeds.find(x => x.id === id);
    return f ? f.nome.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()) : id;
  };
  if(document.activeElement !== sel){
    const usadas = [...new Set(NOTICIAS.map(n => n.canal))];
    const conta = id => NOTICIAS.filter(n => n.canal === id).length;
    sel.innerHTML = `<option value="todas">Todas as fontes (${NOTICIAS.length})</option>` +
      usadas.map(id => `<option value="${Componentes.seguro(id)}">${Componentes.seguro(nomeFonte(id))} (${conta(id)})</option>`).join('');
    sel.value = filtroFonte;
    if(sel.value !== filtroFonte) sel.value = 'todas';
  }
  const rotulo = $('#fonte-rotulo');
  if(rotulo) rotulo.textContent = filtroFonte === 'todas' ? 'Fontes' : nomeFonte(filtroFonte);
  sel.closest('.chip')?.classList.toggle('is-on', filtroFonte !== 'todas');
  if(!sel.dataset.ligado){
    sel.dataset.ligado = '1';
    sel.addEventListener('change', () => {
      filtroFonte = sel.value;
      mostradas = 40;
      sel.blur();
      pintarNoticias();
    });
  }
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
/* até a primeira sincronização acabar, os jogos podem ser os guardados no código */
let jogosSincronizados = false;
/* Uma atualização do ao minuto. Na homepage é compacta (hora, título,
   etiqueta e fonte); na vista completa leva também o resumo e, só nas
   importantes, a imagem. O marcador da linha do tempo é a sigla do
   jornal, na cor dele — cada atualização tem cara, mesmo sem foto. */
function itemMinuto(n, i, completo){
  const classe = n.categoria === 'DESTAQUE' ? 'ev--quente' : n.categoria === 'MERCADO' ? 'ev--mercado' : '';
  const minutos = (Date.now() - n.data.getTime()) / 60000;
  const novo = minutos >= 0 && minutos < 30;
  const chegou = vivoVisto && n.data.getTime() > vivoVisto;
  const et = etiquetaEvento(n);
  const importante = et && (et.classe === 'oficial' || et.classe === 'destaque');
  const comImagem = completo && n.imagem && (importante || i === 0);
  const resumo = completo ? Componentes.resumir(n.resumo, 170) : '';
  const hora = n.data.toLocaleTimeString('pt-PT', { hour:'2-digit', minute:'2-digit' });
  const ligacao = /^https?:\/\//i.test(n.link || '') ? Componentes.seguro(n.link) : '#';
  const hoje = n.data.toDateString() === new Date().toDateString();
  return `<li class="ev ${classe} ${i === 0 ? 'ev--ultima' : ''} ${novo ? 'ev--novo' : ''} ${chegou ? 'ev--chegou' : ''} ${hoje ? 'ev--hoje' : 'ev--antes'} ${n.imagem ? '' : 'ev--sem-img'}">
    <a class="ev__ligacao" href="${ligacao}" target="_blank" rel="noopener" data-link="${Componentes.seguro(n.link)}">
      <time class="ev__hora" datetime="${n.data.toISOString()}">${hora}</time>
      <span class="ev__marca" aria-hidden="true">${Componentes.siglaFonte(n, 'ev__sigla')}<i class="ev__linha"></i></span>
      <span class="ev__txt">
        ${completo && i === 0 ? '<span class="ev__rotulo">Mais recente</span>' : ''}
        <span class="ev__titulo">${Componentes.seguro(n.titulo)}</span>
        ${resumo ? `<span class="ev__resumo">${Componentes.seguro(resumo)}</span>` : ''}
        <span class="ev__meta">
          ${novo ? '<span class="ev__novo">Novo</span>' : ''}
          ${et ? `<span class="ev__tipo ev__tipo--${et.classe}">${et.texto}</span>` : ''}
          <span class="ev__fonte-nome">${Componentes.seguro(n.fonte)}</span>
          <span class="ev__quando">${haQuanto(n.data)}</span>
        </span>
      </span>
      ${comImagem ? `<span class="ev__img">${Componentes.capa(n)}</span>` : ''}
    </a>
  </li>`;
}

/* a vista completa separa os dias, para se perceber o recuo no tempo;
   hoje tem o cabeçalho em destaque, os dias anteriores ficam mais calmos */
function minutoPorDia(lista){
  let dia = '';
  const hoje = new Date().toDateString();
  const ontem = new Date(Date.now() - 86400000).toDateString();
  const porDia = {};
  lista.forEach(n => { const d = n.data.toDateString(); porDia[d] = (porDia[d] || 0) + 1; });
  return lista.map((n, i) => {
    const d = n.data.toDateString();
    let cab = '';
    if(d !== dia){
      const data = (d === hoje || d === ontem)
        ? n.data.toLocaleDateString('pt-PT', { weekday:'long', day:'numeric', month:'long' }) : '';
      const quantas = porDia[d] === 1 ? '1 atualização' : `${porDia[d]} atualizações`;
      cab = `<li class="ev-dia ${d === hoje ? 'ev-dia--hoje' : ''}"><span>${rotuloDia(n.data)}</span><small>${data ? data + ' · ' : ''}${quantas}</small></li>`;
    }
    dia = d;
    return cab + itemMinuto(n, i, true);
  }).join('');
}

let vivoVisto = 0, avisoVivoTimer = null;
function pintarLinhaTempo(){
  const filtro = $('#minuto-filtro').value;
  let l = NOTICIAS;
  if(filtro === 'quente')  l = l.filter(n => n.categoria === 'DESTAQUE' || /\boficial\b/i.test(n.titulo));
  if(filtro === 'mercado') l = l.filter(n => n.categoria === 'MERCADO');
  $$('[data-segmentos-minuto] .segmento').forEach(x => {
    x.classList.toggle('is-on', x.dataset.valor === filtro);
    x.setAttribute('aria-pressed', x.dataset.valor === filtro);
  });

  /* vazio: sem nada no filtro, a carregar (esqueleto) ou sem resposta (erro) */
  const vazio = NOTICIAS.length
    ? `<li class="estado"><p class="estado__texto">Sem atualizações neste filtro.</p></li>`
    : (primeiraLeituraFeita || navigator.onLine === false)
      ? Componentes.erroLeitura(navigator.onLine === false)
      : Componentes.esqueletoMinuto(5);
  $('#linha-tempo').innerHTML = l.length ? l.slice(0, 12).map((n, i) => itemMinuto(n, i, false)).join('') : vazio;

  /* aviso discreto quando entram novidades */
  const maisRecente = NOTICIAS[0]?.data.getTime() || 0;
  const aviso = $('#vivo-novas');
  if(aviso && vivoVisto && maisRecente > vivoVisto){
    const n = NOTICIAS.filter(x => x.data.getTime() > vivoVisto).length;
    aviso.textContent = n === 1 ? '1 novidade agora mesmo' : `${n} novidades agora mesmo`;
    aviso.hidden = false;
    clearTimeout(avisoVivoTimer);
    avisoVivoTimer = setTimeout(() => { aviso.hidden = true; }, 6000);
  }
  if(maisRecente) vivoVisto = Math.max(vivoVisto, maisRecente);
  $('#linha-tempo-total').innerHTML = l.length ? minutoPorDia(l.slice(0, 80)) : vazio;
  pintarSeloVivo();
}

/* =========================================================================
   3b. LEITOR — abre a notícia dentro do site
   O servidor.py vai buscar o artigo, tira-lhe os scripts e devolve-o.
   Se o jornal não deixar, fica o botão para abrir no site original.
   ========================================================================= */
/* As notícias abrem num separador novo do browser, no site do jornal.
   O leitor dentro do site foi tirado — os links já levam target="_blank",
   por isso aqui só se garante que nada intercepta o clique. */
/* Partilhar uma notícia: a folha nativa do telemóvel quando existe; senão
   copia o link. Partilha-se o artigo original — é dele a pré-visualização
   certa (imagem, título) nas redes e nas mensagens. */
document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-partilhar]');
  if(!b) return;
  ev.preventDefault();
  const url = b.dataset.partilhar, title = b.dataset.titulo;
  if(navigator.share){
    try{ await navigator.share({ title, url }); }catch(e){ /* cancelado */ }
    return;
  }
  try{
    await navigator.clipboard.writeText(url);
    if(typeof PWA !== 'undefined') PWA.aviso('Ligação copiada. Já a podes colar onde quiseres.');
  }catch(e){
    window.prompt('Copia a ligação:', url);
  }
});

function ligarLeitor(){
  /* conta as aberturas para a lista "mais lidas" e abre em separador novo */
  document.addEventListener('click', ev => {
    const a = ev.target.closest('a[data-link]');
    if(!a) return;
    ev.preventDefault();
    const link = a.dataset.link;
    const cartao = a.closest('.nl, .ed, .imp, .manchete, .ncartao, .hero, .compacto, .ev');
    const titulo = cartao?.querySelector('.nl__titulo, .ed__titulo, .ev__titulo, .imp__titulo, .ncartao__titulo, .hero__titulo, b')?.textContent?.trim() || link;
    const fonte  = cartao?.querySelector('.nl__fonte, .ed__fonte, .ncartao__fonte, .hero__fonte, .ev__fonte-nome, .compacto__txt span')?.textContent?.trim() || '';
    if(!/^https?:\/\//i.test(link)) return;
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

const ICONE_LOCAL = '<svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
const ICONE_SETA = '<svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';

/* "09 OUT" — o pt-PT do browser às vezes devolve "09/10" com month:'short' */
const MESES_CURTOS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const diaMes = d => `${String(d.getDate()).padStart(2,'0')} ${MESES_CURTOS[d.getMonth()]}`;

const porJogar = () => JOGOS.filter(j => !jogado(j) && new Date(j.data) > Date.now())
                            .sort((a,b) => new Date(a.data)-new Date(b.data));

let jogoIdx = 0, contaTimer = null;

/* "LIGA — J8" → { prova:'Liga Portugal', fase:'Jornada 8' } */
const NOMES_PROVA = {
  'LIGA':'Liga Portugal', 'CHAMPIONS':'Liga dos Campeões', 'TAÇA DA LIGA':'Taça da Liga',
  'TAÇA DE PORTUGAL':'Taça de Portugal', 'SUPERTAÇA':'Supertaça', 'PRÉ-ÉPOCA':'Particular',
  'EUROPA LEAGUE':'Liga Europa', 'LIGA EUROPA':'Liga Europa'
};
const NOMES_FASE = { QF:'Quartos de final', MF:'Meias-finais', SF:'Meias-finais', F:'Final',
                     '1/8':'Oitavos de final', '1/16':'16 avos de final', PO:'Play-off' };
function nomeProva(comp){
  const [base, resto = ''] = String(comp || '').split(/\s+—\s+/);
  const prova = NOMES_PROVA[base.trim()] || base.trim();
  const m = resto.match(/^J(\d+)$/i);
  const fase = m ? `Jornada ${m[1]}` : (NOMES_FASE[resto.trim()] || resto.trim());
  return { prova, fase, completo: fase ? `${prova} · ${fase}` : prova };
}

/* em que pé está um jogo, em palavras */
function estadoDoJogo(j){
  if(jogado(j)) return { texto:'Terminado', classe:'fim' };
  const e = Jogo.estado(JOGOS);
  if(e && e.jogo?.data === j.data && Jogo.emJogo(e)) return { texto:`Ao vivo · ${Jogo.rotuloMinuto(e)}`, classe:'vivo' };
  const d = new Date(j.data), hoje = new Date();
  const dia = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((dia(d) - dia(hoje)) / 86400000);
  if(dias === 0) return { texto:'Hoje', classe:'hoje' };
  if(dias === 1) return { texto:'Amanhã', classe:'breve' };
  return { texto:'Agendado', classe:'agendado' };
}

/* "Ver jogo": no dia vai para o ao vivo; noutro dia, para a lista de
   jogos já com a linha desse jogo à vista */
function verJogo(j){
  const e = Jogo.estado(JOGOS);
  if(e && e.fase !== 'longe' && e.jogo?.data === j.data){ irPara('aovivo'); return; }
  irPara('jogos');
  const i = JOGOS.indexOf(j);
  requestAnimationFrame(() => {
    const li = document.querySelector(`#jogos-lista li[data-jogo="${i}"]`);
    if(!li) return;
    li.scrollIntoView({ block:'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    li.classList.remove('pisca'); void li.offsetWidth; li.classList.add('pisca');
  });
}

function pintarProximoJogo(){
  const lista = porJogar();
  const alvo = $('#proximo-jogo');
  const estado = $('#proximo-estado');
  if(!alvo) return;
  if(!lista.length){
    alvo.innerHTML = jogosSincronizados
      ? `<div class="estado"><p class="estado__titulo">Sem jogos marcados</p>
           <p class="estado__texto">Assim que a próxima jornada tiver data, aparece aqui.</p></div>`
      : `<div class="cartaz__osso" aria-hidden="true"><div class="osso"></div><div class="osso"></div><div class="osso"></div></div>`;
    if(estado) estado.textContent = '';
    return;
  }

  jogoIdx = Math.max(0, Math.min(jogoIdx, lista.length - 1));
  const j = lista[jogoIdx];
  const d = new Date(j.data);
  const prova = nomeProva(j.comp);
  const est = estadoDoJogo(j);
  if(estado){ estado.textContent = est.texto; estado.className = 'cartaz__estado cartaz__estado--' + est.classe; }

  const equipa = (nome, lado) => `
    <div class="cartaz__eq ${eSporting(nome) ? 'e-nos' : ''}">
      <span class="cartaz__escudo"><img src="${emblemaEquipa(nome)}" alt="" width="56" height="56"></span>
      <span class="cartaz__nome">${nome}</span>
      <span class="cartaz__lado">${lado}</span>
    </div>`;
  const diaCurto = diaMes(d);
  const diaSemana = d.toLocaleDateString('pt-PT', { weekday:'long' });

  alvo.innerHTML = `
    <p class="cartaz__prova"><span>${prova.prova}</span>${prova.fase ? `<span>${prova.fase}</span>` : ''}</p>
    <div class="cartaz__equipas">
      ${equipa(j.casa, 'Casa')}
      <span class="cartaz__vs" aria-label="contra">VS</span>
      ${equipa(j.fora, 'Fora')}
    </div>
    <div class="cartaz__quando">
      <span class="cartaz__data">${diaCurto}</span>
      <span class="cartaz__hora">${horaJogo(j, d)}</span>
      <span class="cartaz__dia">${diaSemana}</span>
    </div>
    ${j.local ? `<p class="cartaz__onde">${ICONE_LOCAL}${j.local}</p>` : ''}
    <div class="contagem" role="timer" aria-label="Tempo até ao início">
      <div><b id="c-d">00</b><i data-curto="d">dias</i></div>
      <div><b id="c-h">00</b><i data-curto="h">horas</i></div>
      <div><b id="c-m">00</b><i data-curto="m">min</i></div>
      <div class="contagem__seg"><b id="c-s">00</b><i data-curto="s">seg</i></div>
    </div>
    <div class="cartaz__acoes">
      <button type="button" class="botao-cta" id="ver-proximo">Ver jogo ${ICONE_SETA}</button>
      ${lista.length > 1 ? `<span class="cartaz__pos">${jogoIdx + 1} de ${lista.length}</span>` : ''}
    </div>`;
  $('#ver-proximo')?.addEventListener('click', () => verJogo(j));

  clearInterval(contaTimer);
  const tick = () => {
    let s = Math.max(0, Math.floor((new Date(j.data) - Date.now())/1000));
    const p = n => String(n).padStart(2,'0');
    const el = id => document.getElementById(id);
    if(!el('c-d')) return clearInterval(contaTimer);
    el('c-d').textContent = p(Math.floor(s/86400));
    el('c-h').textContent = p(Math.floor(s%86400/3600));
    el('c-m').textContent = p(Math.floor(s%3600/60));
    const seg = el('c-s');
    seg.textContent = p(s%60);
    seg.classList.remove('tique'); void seg.offsetWidth; seg.classList.add('tique');
  };
  tick();
  contaTimer = setInterval(tick, 1000);
}

/* um jogo na agenda: hora à esquerda, modalidade e prova, equipas */
function itemAgenda(j, opcoes = {}){
  const d = new Date(j.data);
  const prova = nomeProva(j.comp);
  const est = estadoDoJogo(j);
  const mod = modalidade(j.modalidade || 'futebol');
  const centro = jogado(j)
    ? `<span class="ag__res">${j.golosCasa}<i>–</i>${j.golosFora}</span>`
    : `<span class="ag__vs">vs</span>`;
  return `
    <li class="ag ag--${est.classe}" style="--m-cor: var(--m-${mod?.id || 'futebol'})">
      <button type="button" class="ag__ligacao" data-jogo-data="${j.data}">
        <span class="ag__hora">${horaJogo(j, d)}</span>
        <span class="ag__corpo">
          <span class="ag__meta"><b>${mod?.curto || 'Futebol'}</b> · ${prova.completo}${est.classe === 'vivo' || est.classe === 'fim' ? ` · <em>${est.texto}</em>` : ''}</span>
          <span class="ag__equipas">
            <span class="ag__eq ${eSporting(j.casa) ? 'e-nos' : ''}"><img src="${emblemaEquipa(j.casa)}" alt="" width="22" height="22" loading="lazy">${j.casa}</span>
            ${centro}
            <span class="ag__eq ${eSporting(j.fora) ? 'e-nos' : ''}"><img src="${emblemaEquipa(j.fora)}" alt="" width="22" height="22" loading="lazy">${j.fora}</span>
          </span>
          ${opcoes.local && j.local ? `<span class="ag__local">${j.local}</span>` : ''}
        </span>
      </button>
    </li>`;
}

/* rótulo do dia: Hoje, Amanhã, ou "sábado, 17 de outubro" */
function rotuloDia(d){
  const dia = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dif = Math.round((dia(d) - dia(new Date())) / 86400000);
  if(dif === 0) return 'Hoje';
  if(dif === 1) return 'Amanhã';
  if(dif === -1) return 'Ontem';
  return d.toLocaleDateString('pt-PT', { weekday:'long', day:'numeric', month:'long' });
}

/* lista de jogos agrupada por dia */
function agendaPorDia(jogos, opcoes = {}){
  let diaAtual = '';
  return jogos.map(j => {
    const d = new Date(j.data);
    const rot = rotuloDia(d);
    const cab = rot !== diaAtual ? `<li class="ag-dia"><span>${rot}</span></li>` : '';
    diaAtual = rot;
    return cab + itemAgenda(j, opcoes);
  }).join('');
}

function ligarItensAgenda(raiz){
  raiz?.querySelectorAll('.ag__ligacao').forEach(b => b.addEventListener('click', () => {
    const j = JOGOS.find(x => x.data === b.dataset.jogoData);
    if(j) verJogo(j);
  }));
}

function pintarCalendario(){
  const alvo = $('#calendario');
  if(!alvo) return;
  const prox = porJogar().slice(0, 5);
  alvo.innerHTML = prox.length
    ? agendaPorDia(prox)
    : jogosSincronizados
      ? `<li class="estado"><p class="estado__texto">Sem jogos marcados para já.</p></li>`
      : Array.from({ length: 4 }, () => `<li class="ag ag--osso" aria-hidden="true"><div class="osso"></div></li>`).join('');
  ligarItensAgenda(alvo);
}

function pintarResultados(){
  const alvo = $('#resultados');
  if(!alvo) return;
  const feitos = JOGOS.filter(jogado).slice(-6).reverse();
  if(!feitos.length){
    alvo.innerHTML = JOGOS.length
      ? `<li class="estado"><p class="estado__texto">Ainda não há resultados esta época.</p></li>`
      : Array.from({ length: 4 }, () => `<li class="rcartao rcartao--osso" aria-hidden="true"><div class="osso"></div></li>`).join('');
    return;
  }
  const NOME = { V:'Vitória', E:'Empate', D:'Derrota' };
  alvo.innerHTML = feitos.map(j => {
    const r = resultadoSCP(j);
    const d = new Date(j.data);
    const prova = nomeProva(j.comp);
    const linha = (nome, golos, ganhou) => `
      <span class="rcartao__eq ${eSporting(nome) ? 'e-nos' : ''} ${ganhou ? 'ganhou' : ''}">
        <img src="${emblemaEquipa(nome)}" alt="" width="28" height="28" loading="lazy">
        <span class="rcartao__nome">${nome}</span>
        <b class="rcartao__golos">${golos}</b>
      </span>`;
    return `
    <li class="rcartao rcartao--${r.r}">
      <button type="button" class="rcartao__ligacao" data-jogo-data="${j.data}">
        <span class="rcartao__topo">
          <span class="rcartao__prova">${prova.completo}</span>
          <time datetime="${d.toISOString()}">${diaMes(d)}</time>
        </span>
        ${linha(j.casa, j.golosCasa, j.golosCasa > j.golosFora)}
        ${linha(j.fora, j.golosFora, j.golosFora > j.golosCasa)}
        <span class="rcartao__fim">
          <span class="rcartao__ved rcartao__ved--${r.r}">${r.r}<span class="so-leitor"> — ${NOME[r.r]}</span></span>
          <span class="rcartao__estado">Terminado</span>
          <span class="rcartao__ver">Ver jogo ${ICONE_SETA}</span>
        </span>
      </button>
    </li>`;
  }).join('');
  alvo.querySelectorAll('.rcartao__ligacao').forEach(b => b.addEventListener('click', () => {
    const j = JOGOS.find(x => x.data === b.dataset.jogoData);
    if(j) verJogo(j);
  }));
}

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
        <div class="golos__bola">${j.golosCasa} – ${j.golosFora}</div>
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

/* "LIGA — J5" → "LIGA"; as taças juntam-se todas num filtro só */
function provaDe(j){
  const base = (j.comp || '').split(' — ')[0].trim();
  return /^TAÇA/.test(base) ? 'TAÇAS' : base;
}
const ORDEM_PROVAS = ['LIGA', 'CHAMPIONS', 'TAÇAS', 'PRÉ-ÉPOCA'];
const NOME_RES = { V:'Vitória', E:'Empate', D:'Derrota' };
let filtroProva = 'TODOS';

function pintarJogosTodos(){
  const feitos = JOGOS.filter(jogado);
  const r = feitos.map(resultadoSCP);
  $('#jogos-resumo').textContent =
    `${feitos.length} jogados · ${r.filter(x=>x.r==='V').length}V ${r.filter(x=>x.r==='E').length}E ${r.filter(x=>x.r==='D').length}D`;

  /* ---- filtros por competição, com contagem ---- */
  const provas = ORDEM_PROVAS.filter(pv => JOGOS.some(j => provaDe(j) === pv));
  JOGOS.forEach(j => { const pv = provaDe(j); if(pv && !provas.includes(pv)) provas.push(pv); });
  $('#jogos-filtro').innerHTML = ['TODOS', ...provas].map(pv => {
    const n = pv === 'TODOS' ? JOGOS.length : JOGOS.filter(j => provaDe(j) === pv).length;
    const on = pv === filtroProva;
    return `<button type="button" class="pilula ${on ? 'is-on' : ''}" data-prova="${pv}" aria-pressed="${on}">
      ${pv} <span class="pilula__n">${n}</span></button>`;
  }).join('');
  $$('#jogos-filtro .pilula').forEach(b => b.addEventListener('click', () => {
    filtroProva = b.dataset.prova;
    pintarJogosTodos();
  }));

  /* ---- o próximo jogo fica marcado e tem atalho ---- */
  const proximo = porJogar()[0];

  /* ---- lista, agrupada por mês ---- */
  const lista = JOGOS.map((j, i) => ({ j, i }))
                     .filter(({ j }) => filtroProva === 'TODOS' || provaDe(j) === filtroProva);
  let mesAtual = '';
  $('#jogos-lista').innerHTML = lista.map(({ j, i }) => {
    const d = new Date(j.data);
    const mes = d.toLocaleDateString('pt-PT', { month:'long', year:'numeric' }).toUpperCase();
    const cabecalho = mes !== mesAtual ? `<li class="jl-mes"><span>${mes}</span></li>` : '';
    mesAtual = mes;

    const res = resultadoSCP(j);
    const eProximo = j === proximo;
    const quando = d.toLocaleDateString('pt-PT', { weekday:'short', day:'2-digit', month:'2-digit' })
                    .replace('.', '');
    const centro = jogado(j)
      ? `<span class="jl-res">${j.golosCasa}<i>–</i>${j.golosFora}</span>`
      : `<span class="jl-hora">${horaJogo(j, d)}</span>`;
    const fim = res
      ? `<span class="jl-ved jl-ved--${res.r}" title="${NOME_RES[res.r]}">${res.r}<span class="so-leitor"> — ${NOME_RES[res.r]}</span></span>
         <svg class="icone jl-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`
      : (eProximo ? `<span class="jl-etiqueta">PRÓXIMO</span>` : '');

    const conteudo = `
      <span class="jl-quando"><span class="jl-data">${quando}</span><span class="jl-comp">${j.comp}</span></span>
      <span class="jl-placar">
        <span class="res-eq res-eq--casa ${eSporting(j.casa) ? 'e-nos' : ''}"><span>${j.casa}</span><img src="${emblemaEquipa(j.casa)}" alt=""></span>
        ${centro}
        <span class="res-eq ${eSporting(j.fora) ? 'e-nos' : ''}"><img src="${emblemaEquipa(j.fora)}" alt=""><span>${j.fora}</span></span>
      </span>
      <span class="jl-fim">${fim}</span>`;

    /* só os jogos com resultado abrem ficha — esses são botões a sério,
       para se poderem abrir com o teclado */
    const linha = res
      ? `<button type="button" class="jl-linha" aria-expanded="false" aria-controls="jl-det-${i}">${conteudo}</button>
         <div class="jl-detalhe-caixa" id="jl-det-${i}" hidden></div>`
      : `<div class="jl-linha">${conteudo}</div>`;

    return cabecalho + `<li class="jl ${res ? 'tem-detalhe' : 'por-jogar'} ${eProximo ? 'e-proximo' : ''}" data-jogo="${i}">${linha}</li>`;
  }).join('') || '<li class="jl-vazio">Sem jogos nesta competição.</li>';

  $$('#jogos-lista .jl-linha[aria-expanded]').forEach(bt => bt.addEventListener('click', () => {
    const li = bt.closest('li');
    const caixa = li.querySelector('.jl-detalhe-caixa');
    const abrir = bt.getAttribute('aria-expanded') !== 'true';
    $$('#jogos-lista .jl-linha[aria-expanded="true"]').forEach(x => {
      x.setAttribute('aria-expanded', 'false');
      x.closest('li').classList.remove('aberta');
      x.nextElementSibling.hidden = true;
    });
    if(!abrir) return;
    caixa.innerHTML = detalheJogo(JOGOS[+li.dataset.jogo]);
    caixa.hidden = false;
    bt.setAttribute('aria-expanded', 'true');
    li.classList.add('aberta');
  }));

  const ir = $('#ir-proximo');
  ir.hidden = !proximo;
  ir.onclick = () => {
    if(filtroProva !== 'TODOS' && proximo && provaDe(proximo) !== filtroProva){
      filtroProva = 'TODOS';
      pintarJogosTodos();
    }
    const alvo = $('#jogos-lista .e-proximo');
    if(!alvo) return;
    const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
    alvo.scrollIntoView({ behavior: calmo ? 'auto' : 'smooth', block: 'center' });
    alvo.classList.remove('pisca'); void alvo.offsetWidth; alvo.classList.add('pisca');
  };
}

/* =========================================================================
   5. CLASSIFICAÇÃO
   ========================================================================= */
/* qual das duas tabelas está a ser vista */
let provaTabela = 'liga';

/* Na Champions as 36 equipas jogam todas na mesma tabela: os 8 primeiros
   seguem direto para os oitavos, do 9.º ao 24.º há play-off, e daí para
   baixo está tudo acabado. */
function zonaChampions(pos){
  if(pos <= 8)  return 'q-direto';
  if(pos <= 24) return 'q-playoff';
  return 'q-fora';
}

/* forma recente do Sporting na Liga: os últimos cinco resultados */
function formaSporting(n = 5){
  return JOGOS.filter(j => jogado(j) && provaDe(j) === 'LIGA').slice(-n).map(resultadoSCP);
}
function chipsForma(forma){
  const NOME = { V:'Vitória', E:'Empate', D:'Derrota' };
  return forma.map(r => `<span class="forma__chip forma__chip--${r.r}" title="${NOME[r.r]} ${r.nos}-${r.deles}">${r.r}<span class="so-leitor"> ${NOME[r.r]}</span></span>`).join('');
}

/* Classificação da homepage: os cinco primeiros e o Sporting, se estiver
   abaixo. A forma só aparece para o Sporting — das outras equipas não há
   jogo a jogo, e não se inventa. */
function pintarTabelaCasa(){
  const alvo = $('#tabela-casa');
  if(!alvo) return;
  const comecou = TABELA.some(t => t.j > 0);
  let linhas = TABELA.slice(0, 5);
  const nos = TABELA.find(t => eSporting(t.equipa));
  if(nos && !linhas.includes(nos)) linhas = [...linhas, nos];
  const jornada = Math.max(0, ...TABELA.map(t => t.j || 0));
  const etiqueta = $('#tabela-casa-jornada');
  if(etiqueta) etiqueta.textContent = comecou ? `Jornada ${jornada}` : 'Liga';

  if(!TABELA.length){ alvo.innerHTML = '<div class="osso" style="height:220px"></div>'; return; }
  alvo.innerHTML = `
    <table class="classif">
      <caption class="so-leitor">Liga Portugal, primeiros classificados</caption>
      <thead><tr><th scope="col">#</th><th scope="col">Equipa</th><th scope="col">J</th><th scope="col">DG</th><th scope="col">Pts</th></tr></thead>
      <tbody>${linhas.map((t, i) => `
        <tr class="${eSporting(t.equipa) ? 'eu' : ''} ${i === 5 ? 'separada' : ''}">
          <td class="classif__pos">${t.pos}</td>
          <td><span class="eq"><img src="${emblemaEquipa(t.equipa)}" alt="" width="22" height="22" loading="lazy">${t.equipa}</span></td>
          <td>${t.j}</td>
          <td>${t.gm - t.gs > 0 ? '+' : ''}${t.gm - t.gs}</td>
          <td class="classif__pts">${t.p}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${formaSporting().length ? `<div class="forma"><span class="forma__rotulo">Forma do Sporting</span><span class="forma__chips">${chipsForma(formaSporting())}</span></div>` : ''}`;
}

function pintarTabela(){
  const naChampions = provaTabela === 'champions';
  const dados = naChampions ? TABELA_CL : TABELA;
  const comecou = dados.some(t => t.j > 0);

  $('#tabela-nota').textContent = naChampions
    ? `Liga dos Campeões ${CONFIG.epoca} · fase de liga`
    : (comecou ? 'Liga Portugal Betclic ' + CONFIG.epoca
               : 'ordem alfabética — a época ainda não começou');

  pintarTabelaCasa();

  /* a tabela curta da página inicial é sempre a da Liga */
  const curta = $('#tabela-curta tbody');
  if(curta) curta.innerHTML = TABELA.slice(0,5).map(t => `
    <tr class="${eSporting(t.equipa)?'eu':''}">
      <td class="np">${t.pos}</td>
      <td><span class="eq"><img src="${emblemaEquipa(t.equipa)}" alt="">${t.equipa}</span></td>
      <td>${t.j}</td><td>${t.gm - t.gs}</td><td class="pts">${t.p}</td>
    </tr>`).join('');

  $('#tabela-total tbody').innerHTML = dados.map(t => `
    <tr class="${eSporting(t.equipa)?'eu':''} ${naChampions ? zonaChampions(t.pos) : ''}">
      <td class="np">${t.pos}</td>
      <td><span class="eq"><img src="${emblemaEquipa(t.equipa)}" alt="" loading="lazy">${t.equipa}</span></td>
      <td>${t.j}</td><td>${t.v}</td><td>${t.e}</td><td>${t.d}</td>
      <td>${t.gm}</td><td>${t.gs}</td><td>${t.gm - t.gs}</td><td class="pts">${t.p}</td>
    </tr>`).join('');

  $('#tabela-legenda').innerHTML = naChampions
    ? `<i class="leg leg--direto"></i> 1.º a 8.º passam aos oitavos ·
       <i class="leg leg--playoff"></i> 9.º a 24.º disputam play-off ·
       do 25.º para baixo estão eliminados`
    : '';

  pintarChampions(naChampions);
  pintarResumoLiga(!naChampions && comecou);
}

/* o Sporting na Liga, num relance: posição, pontos, distância, forma */
function pintarResumoLiga(mostrar){
  const alvo = $('#liga-resumo');
  if(!alvo) return;
  const nos = TABELA.find(t => eSporting(t.equipa));
  alvo.hidden = !mostrar || !nos;
  if(alvo.hidden) return;
  const lider = TABELA[0];
  const distancia = nos === lider
    ? (TABELA[1] ? `${nos.p - TABELA[1].p} pts à frente do 2.º` : 'Na liderança')
    : `A ${lider.p - nos.p} pts do 1.º`;
  const forma = formaSporting();
  const caixa = (rotulo, valor) => `<div class="liga-resumo__c"><b>${valor}</b><span>${rotulo}</span></div>`;
  alvo.innerHTML = `
    <div class="liga-resumo__pos">
      <img src="${emblemaEquipa(nos.equipa)}" alt="" width="56" height="56">
      <div><b>${nos.pos}.º</b><span>${distancia}</span></div>
    </div>
    <div class="liga-resumo__nums">
      ${caixa('Pontos', nos.p)}
      ${caixa('Jogos', nos.j)}
      ${caixa('V · E · D', `${nos.v}·${nos.e}·${nos.d}`)}
      ${caixa('Golos', `${nos.gm}–${nos.gs}`)}
    </div>
    ${forma.length ? `<div class="liga-resumo__forma"><span>Últimos ${forma.length}</span><span class="forma__chips">${chipsForma(forma)}</span></div>` : ''}`;
}

/* O cartão de cima na Champions: como está a correr ao Sporting */
function pintarChampions(mostrar){
  const resumo = $('#cl-resumo');
  const cartao = $('#cl-adversarios-cartao');
  if(!resumo || !cartao) return;

  resumo.hidden = !mostrar;
  cartao.hidden  = !mostrar;
  if(!mostrar) return;

  const nos = TABELA_CL.find(t => eSporting(t.equipa));
  if(nos){
    const caixa = (rotulo, valor, destaque) => `
      <div class="cl-resumo__c ${destaque ? 'cl-resumo__c--forte' : ''}">
        <b>${valor}</b><span>${rotulo}</span>
      </div>`;
    resumo.innerHTML =
      caixa('POSIÇÃO', `${nos.pos}.º`, true) +
      caixa('PONTOS', nos.p, true) +
      caixa('JOGOS', nos.j) +
      caixa('V–E–D', `${nos.v}–${nos.e}–${nos.d}`) +
      caixa('GOLOS', `${nos.gm}–${nos.gs}`) +
      caixa('DIFERENÇA', (nos.gm - nos.gs >= 0 ? '+' : '−') + Math.abs(nos.gm - nos.gs));
  }else{
    resumo.innerHTML = '<p class="cl-resumo__vazio">O Sporting ainda não aparece na tabela.</p>';
  }

  $('#cl-advs').innerHTML = CL_ADVERSARIOS.map(a => `
    <li class="cl-adv">
      <img src="${emblemaEquipa(a.equipa)}" alt="" loading="lazy">
      <span class="cl-adv__nome">${Componentes.seguro(a.equipa)}</span>
      <span class="cl-adv__onde ${a.casa ? 'e-casa' : 'e-fora'}">
        ${a.casa ? 'ALVALADE' : 'FORA'}
      </span>
      <span class="cl-adv__pote">pote ${a.pote}</span>
    </li>`).join('');
}

function ligarTrocaProva(){
  $$('.troca-prova__b').forEach(b => b.addEventListener('click', () => {
    provaTabela = b.dataset.prova;
    $$('.troca-prova__b').forEach(o => {
      const activo = o === b;
      o.classList.toggle('is-on', activo);
      o.setAttribute('aria-selected', activo);
    });
    pintarTabela();
  }));
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

/* As bandeiras em emoji no Windows aparecem como duas letras ("GR GRE"),
   que repetem o código do país. Fica só o código. */
const semBandeira = nac => (nac || '').replace(/[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F3F3}\u{FE0F}?/gu, '').trim();

const GRUPOS_POS = [['GR','GUARDA-REDES'], ['DEF','DEFESAS'], ['MED','MÉDIOS'], ['AVA','AVANÇADOS']];

function cartaoJogador(p){
  return `
    <button class="jog ${p.nome===escolhido?'is-on':''}" data-nome="${p.nome}" aria-pressed="${p.nome===escolhido}">
      <span class="jog__n">${p.n ?? '–'}</span>
      <img src="${p.foto}" alt="" loading="lazy"
           onerror="this.onerror=null;this.src='${avatarJogador(p)}'">
      <span class="jog__txt">
        <b>${ALCUNHAS[p.nome] || p.nome}</b>
        <span>${p.pos} · ${semBandeira(p.nac)}</span>
        <span class="jog__mini"><span>${p.stats.jogos} jogos</span><span>${p.stats.golos} golos</span></span>
      </span>
    </button>`;
}

function pintarPlantel(){
  const porNumero = (a,b) => (a.n ?? 999) - (b.n ?? 999);

  /* contagem em cada pílula, para se saber o que há antes de carregar */
  $$('#pos-filtro .pilula').forEach(b => {
    const pos = b.dataset.pos;
    const n = pos === 'todos' ? PLANTEL.length : PLANTEL.filter(p => p.posGrupo === pos).length;
    b.dataset.rotulo ||= b.textContent.trim();
    b.innerHTML = `${b.dataset.rotulo} <span class="pilula__n">${n}</span>`;
    b.classList.toggle('is-on', pos === filtroPos);
    b.setAttribute('aria-pressed', pos === filtroPos);
  });

  /* em TODOS, o plantel vem arrumado por posição, como numa ficha de jogo */
  const grupos = filtroPos === 'todos'
    ? GRUPOS_POS.map(([pos, nome]) => [nome, PLANTEL.filter(p => p.posGrupo === pos)])
    : [[null, PLANTEL.filter(p => p.posGrupo === filtroPos)]];

  $('#plantel').innerHTML = grupos
    .filter(([, l]) => l.length)
    .map(([nome, l]) =>
      (nome ? `<h3 class="plantel__grupo">${nome} <span>${l.length}</span></h3>` : '')
      + [...l].sort(porNumero).map(cartaoJogador).join(''))
    .join('');

  $$('.jog').forEach(b => b.addEventListener('click', () => {
    mostrarFicha(PLANTEL.find(p => p.nome === b.dataset.nome));
    $$('.jog').forEach(x => {
      x.classList.toggle('is-on', x === b);
      x.setAttribute('aria-pressed', x === b);
    });
    /* a ficha está no topo: em telemóvel, sem isto, tocar num jogador
       lá em baixo parecia não fazer nada */
    const ficha = $('#ficha');
    if(ficha.getBoundingClientRect().top < 0){
      const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
      ficha.scrollIntoView({ behavior: calmo ? 'auto' : 'smooth', block: 'start' });
    }
  }));
}

function mostrarFicha(p){
  if(!p) return;
  escolhido = p.nome;
  const perfil = PERFIS[p.nome] || PERFIL_BASE[p.posGrupo];
  const s = p.stats;
  const kpis = [
    ['JOGOS', s.jogos], ['GOLOS', s.golos],
    /* golos por jogo não diz nada de um guarda-redes */
    ...(p.posGrupo === 'GR' ? [] :
      [['GOLOS/JOGO', s.jogos ? (s.golos/s.jogos).toFixed(2).replace('.',',') : '0,00']]),
    ['IDADE', p.idade ?? '—'], ['Nº', p.n ?? '–']
  ];
  const rotulos = {fin:'FINALIZAÇÃO',passe:'PASSE',drible:'DRIBLE',defesa:'DEFESA',fisico:'FÍSICO',vel:'VELOCIDADE'};

  $('#ficha').innerHTML = `
    <div class="ficha__foto">
      <img src="${p.foto}" alt="${p.nome}" onerror="this.onerror=null;this.src='${avatarJogador(p)}'">
      ${p.n != null ? `<span class="ficha__num">${p.n}</span>` : ''}
    </div>
    <div class="ficha__dados">
      <h3>${ALCUNHAS[p.nome] ? p.nome + ' «' + ALCUNHAS[p.nome] + '»' : p.nome}</h3>
      <div class="ficha__sub">${p.pos} · ${semBandeira(p.nac)} · ${p.idade ?? '—'} anos
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
          <svg viewBox="0 0 200 200" id="radar" role="img" aria-label="Perfil do jogador em radar"></svg>
          <span class="ficha__leg">PERFIL · leitura própria, não é estatística</span>
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
             font-size="11" font-weight="700" style="fill:var(--texto-2);font-family:var(--f-ui)">${curto[k]}</text>`; });
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

/* O ranking vem da nuvem quando ha ligacao — e o de toda a gente.
   Sem ligacao, mostra-se o das contas deste browser. */
async function pintarRanking(){
  if(naNuvem()){
    try{
      desenharRanking(await Nuvem.ranking(10), 'todas as contas');
      return;
    }catch(e){ /* cai para o local */ }
  }

  let tabela = {};
  try{ tabela = JSON.parse(localStorage.getItem(RANKING) || '{}'); }catch(e){}

  /* junta entradas repetidas do mesmo nome (restos de versoes antigas da
     chave) ficando com a melhor pontuacao */
  const porNome = new Map();
  Object.values(tabela).forEach(e => {
    const id = Contas.idDe(e.nome);
    if(!porNome.has(id) || porNome.get(id).pontos < e.pontos) porNome.set(id, e);
  });

  desenharRanking([...porNome.values()].sort((a,b) => b.pontos - a.pontos).slice(0,10),
                  'so deste browser');
}

function desenharRanking(lista, origem){
  /* o ranking antigo (pontos calculados no browser) saiu: o do Fantasy
     vem agora do servidor, em js/fantasy.js */
  if(!$('#ranking')) return;
  const nota = $('#ranking-origem');
  if(nota) nota.textContent = origem;

  $('#ranking').innerHTML = lista.length
    ? lista.map((e,i) => `
        <li class="${chaveNome(e.nome) === chaveNome(UTILIZADOR_ATUAL || '') ? 'eu' : ''}">
          <span class="rk__pos ${i<3?'rk__pos--podio':''}">${i+1}</span>
          <span class="rk__nome">@${Componentes.seguro(e.nome)}</span>
          <span class="rk__eq">${Componentes.seguro(e.desenho || '')} · ${e.jogadores}/11</span>
          <b>${(e.pontos||0).toLocaleString('pt-PT')}</b>
        </li>`).join('')
    : '<li class="vazio">Ainda ninguem pontuou.</li>';
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

/* =========================================================================
   REGRAS DA FANTASY — tranca e substituições
   -------------------------------------------------------------------------
   Antes do primeiro jogo oficial mexe-se à vontade. Assim que a bola rolar,
   a equipa tranca e só se fazem 2 trocas por jornada.
   ========================================================================= */
let jornadaGuardada = 0;
let substituicoesUsadas = 0;

/* quantos jogos oficiais já se jogaram (a pré-época não conta) */
function jornadaAtual(){
  return JOGOS.filter(j => jogado(j) && provaDoJogo(j) !== 'Pré-época').length;
}

const equipaTrancada = () => jornadaAtual() > 0;

function substituicoesRestantes(){
  if(!equipaTrancada()) return Infinity;
  return Math.max(0, FANTASY.substituicoesPorJornada - substituicoesUsadas);
}

/* Cada mexida no onze gasta uma substituição — mas só depois de a época
   começar, e só se for mesmo uma troca (pôr alguém numa vaga vazia
   durante a montagem inicial não conta). */
function podeMexer(){
  if(!equipaTrancada()) return { pode: true };
  if(substituicoesRestantes() > 0) return { pode: true };
  return { pode: false,
           razao: `Já usaste as ${FANTASY.substituicoesPorJornada} substituições desta jornada. ` +
                  `Podes voltar a mexer depois do próximo jogo.` };
}

function gastarSubstituicao(){
  if(!equipaTrancada()) return;
  substituicoesUsadas++;
  guardarFormacao();
}

/* quando muda a jornada, o saldo de trocas volta a zero */
function acertarJornada(){
  const agora = jornadaAtual();
  if(agora !== jornadaGuardada){
    jornadaGuardada = agora;
    substituicoesUsadas = 0;
    guardarFormacao();
  }
}

function guardarFormacao(){
  const equipa = { desenho: desenhoAtual, onze: meuOnze, capitao: capitaoIdx,
                   jornada: jornadaGuardada, substituicoes: substituicoesUsadas };

  /* copia local: serve de rascunho e faz o site abrir depressa */
  try{ localStorage.setItem(chaveFormacao(), JSON.stringify(equipa)); }catch(e){}

  /* e na nuvem, para entrar no ranking de toda a gente. Espera-se um pouco
     para nao mandar um pedido por cada clique. */
  if(naNuvem() && Nuvem.perfil){
    clearTimeout(guardarFormacao._espera);
    guardarFormacao._espera = setTimeout(() => {
      /* o quadro tático guarda-se, mas sem pontos: pontos calculados no
         browser não entram em lado nenhum (o Fantasy conta-os no servidor) */
      Nuvem.guardarEquipa({ ...equipa,
        trancada: equipaTrancada(),
        pontos: 0,
        jogadores: meuOnze.filter(Boolean).length
      });
    }, 700);
  }
}

/* pontos totais do onze, com o capitao a valer mais */
function pontosDoOnze(){
  return meuOnze.reduce((soma, nome, i) => {
    const p = nome ? acharJogador(nome) : null;
    if(!p) return soma;
    const pts = pontosJogador(p).total;
    return soma + Math.round(pts * (i === capitaoIdx ? FANTASY.capitao : 1));
  }, 0);
}

async function carregarFormacaoGuardada(){
  let guardada = null;
  /* o que esta na nuvem manda: e o mesmo em qualquer aparelho */
  if(naNuvem() && Nuvem.perfil){
    try{ guardada = await Nuvem.lerEquipa(); }catch(e){}
  }
  if(!guardada){
    try{ guardada = JSON.parse(localStorage.getItem(chaveFormacao()) || 'null'); }
    catch(e){}
  }

  if(guardada && FORMACOES[guardada.desenho]){
    desenhoAtual = guardada.desenho;
    meuOnze = FORMACOES[desenhoAtual].map((_, i) => guardada.onze?.[i] ?? null);
    capitaoIdx = Number.isInteger(guardada.capitao) ? guardada.capitao : -1;
    jornadaGuardada = guardada.jornada | 0;
    substituicoesUsadas = guardada.substituicoes | 0;
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

  /* estado das substituições */
  const aviso = $('#formacao-aviso');
  if(aviso && !aviso.classList.contains('formacao__aviso--alerta')){
    if(!equipaTrancada()){
      aviso.innerHTML = 'Arrasta os jogadores para trocar de posição, ou carrega numa para '
        + 'escolher outro. <b>Enquanto a época não começar mexes à vontade</b> — a partir do '
        + 'primeiro jogo oficial só podes fazer '
        + FANTASY.substituicoesPorJornada + ' substituições por jornada.';
    }else{
      const restam = substituicoesRestantes();
      aviso.innerHTML = `Jornada ${jornadaAtual()} · <b>${restam} de `
        + `${FANTASY.substituicoesPorJornada} substituições</b> por usar. `
        + 'Trocar dois jogadores de posição entre si não gasta substituição.';
    }
  }

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

  /* o toque nas posicoes e tratado no pointerup do arrastar (ligarArrastar),
     para funcionar tambem com o dedo */

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

  /* idem para a lista do plantel: o toque abre a ficha, o arrasto leva
     o jogador para o campo */

  pintarFantasy();
}

/* abre a ficha de um jogador a partir do nome */
function abrirFichaDoNome(nome){
  const p = PLANTEL.find(x => x.nome === nome);
  if(!p) return;
  irPara('equipa');
  mostrarFicha(p);
  $$('.jog').forEach(b => b.classList.toggle('is-on', b.dataset.nome === p.nome));
}

/* aviso curto no topo do campo */
function avisarSubstituicoes(texto){
  const alvo = $('#formacao-aviso');
  if(!alvo) return;
  alvo.classList.add('formacao__aviso--alerta');
  alvo.innerHTML = `<b>${texto}</b>`;
  clearTimeout(avisarSubstituicoes._t);
  avisarSubstituicoes._t = setTimeout(() => {
    alvo.classList.remove('formacao__aviso--alerta');
    pintarFormacao();
  }, 5000);
}

/* =========================================================================
   ARRASTAR JOGADORES — com rato e com dedo
   Usa Pointer Events, que dão os dois casos com o mesmo código.
   ========================================================================= */
function ligarArrastar(){
  const vistaFormacao = $('#vista-formacao');
  if(!vistaFormacao) return;

  let origem = null, fantasma = null, aArrastar = false, inicio = null;
  let nomeArrastado = null;      // quando vem da lista do plantel
  let armado = false;            // com o dedo, só se arrasta depois de segurar
  let relogioArmar = null;

  /* Com o dedo, um toque normal mexe sempre uns pixéis — se bastassem 8px
     para começar a arrastar, o toque virava arrastar e a lista nunca abria.
     Por isso no telemóvel exige-se segurar primeiro, e uma distância maior. */
  const ESPERA_ARMAR = 220;      // ms a segurar antes de poder arrastar
  const limiarDe = e => e.pointerType === 'touch' ? 18 : 6;

  const posicaoSob = (x, y) =>
    document.elementFromPoint(x, y)?.closest('.posicao');

  const limpar = () => {
    fantasma?.remove(); fantasma = null;
    origem?.classList.remove('a-arrastar');
    $$('.posicao').forEach(p => p.classList.remove('alvo-troca'));
    document.body.classList.remove('a-arrastar-jogador');
    origem = null; aArrastar = false; inicio = null; nomeArrastado = null;
  };

  /* Arrasta-se a partir de dois sítios: das posições no campo e das linhas
     do plantel à direita. Por isso o ouvinte fica na vista toda. */
  vistaFormacao.addEventListener('pointerdown', e => {
    const noCampo = e.target.closest('#campo .posicao');
    const naLista = e.target.closest('#lista-suplentes li[data-nome]');
    if((!noCampo && !naLista) || e.button === 2) return;

    origem = noCampo || naLista;
    nomeArrastado = naLista ? naLista.dataset.nome : null;
    inicio = { x: e.clientX, y: e.clientY };
  });

  vistaFormacao.addEventListener('pointermove', e => {
    if(!origem || !inicio) return;

    /* Só começa a arrastar depois de uns pixéis, senão estraga o toque.
       Com o dedo é preciso muito mais folga: um toque normal mexe sempre
       uns pixéis, e com 8px quase todos os toques viravam arrasto — era
       por isso que a lista não abria no telemóvel. */
    if(!aArrastar){
      const folga = e.pointerType === 'mouse' ? 8 : 18;
      if(Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) < folga) return;
      aArrastar = true;
      origem.setPointerCapture?.(e.pointerId);
      origem.classList.add('a-arrastar');
      document.body.classList.add('a-arrastar-jogador');

      fantasma = document.createElement('div');
      fantasma.className = 'posicao posicao--fantasma';
      if(nomeArrastado){
        const p = acharJogador(nomeArrastado);
        fantasma.innerHTML =
          `<span class="posicao__camisola">${camisolaSVG(p?.n ?? '', p?.posGrupo === 'GR' ? 'gr' : 'campo')}</span>
           <span class="posicao__nome">${nomeCurto(nomeArrastado)}</span>`;
      }else{
        fantasma.innerHTML = origem.innerHTML;
      }
      document.body.appendChild(fantasma);
    }

    e.preventDefault();
    fantasma.style.left = e.clientX + 'px';
    fantasma.style.top  = e.clientY + 'px';

    const sob = posicaoSob(e.clientX, e.clientY);
    $$('#campo .posicao').forEach(p =>
      p.classList.toggle('alvo-troca', p === sob && p !== origem));
  });

  const largar = e => {
    if(!origem) return;

    /* Não chegou a arrastar: foi um toque. Abre-se a lista aqui em vez de
       esperar pelo evento click — depois de setPointerCapture o click pode
       nunca chegar, e no telemóvel era isso que acontecia. */
    if(!aArrastar){
      const naPosicao = origem.closest('#campo .posicao');
      const i = naPosicao ? +naPosicao.dataset.i : -1;
      const jogadorDaLista = nomeArrastado;
      limpar();
      if(i >= 0) abrirEscolha(i);
      else if(jogadorDaLista) abrirFichaDoNome(jogadorDaLista);
      return;
    }

    const destino = posicaoSob(e.clientX, e.clientY);
    const vindoDaLista = nomeArrastado;
    const de = vindoDaLista ? -1 : +origem.dataset.i;
    const para = destino ? +destino.dataset.i : -1;
    limpar();

    if(para < 0) return;

    /* ---- veio da lista do plantel: entra alguém de fora ---- */
    if(vindoDaLista){
      const r = podeMexer();
      if(!r.pode){ avisarSubstituicoes(r.razao); return; }
      meuOnze[para] = vindoDaLista;
      gastarSubstituicao();
      guardarFormacao();
      pintarFormacao();
      return;
    }

    /* ---- troca entre duas posições do campo ---- */
    if(para === de) return;

    /* trocar dois jogadores do onze é reorganizar — não gasta substituição.
       Só gasta se uma das pontas estiver vazia (entra alguém de fora). */
    const vazia = !meuOnze[de] || !meuOnze[para];
    if(vazia){
      const r = podeMexer();
      if(!r.pode){ avisarSubstituicoes(r.razao); return; }
    }

    [meuOnze[de], meuOnze[para]] = [meuOnze[para], meuOnze[de]];
    if(capitaoIdx === de) capitaoIdx = para;
    else if(capitaoIdx === para) capitaoIdx = de;

    if(vazia) gastarSubstituicao();
    guardarFormacao();
    pintarFormacao();
  };

  vistaFormacao.addEventListener('pointerup', largar);
  vistaFormacao.addEventListener('pointercancel', limpar);
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

  /* Em telemóvel não se foca a procura: o teclado subia logo e tapava a
     lista toda, que é o que se quer ver. No computador foca-se. */
  if(innerWidth > 700) setTimeout(() => $('#escolha-procura').focus(), 50);
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

    /* trocar entre duas posições do próprio onze não gasta substituição:
       é reorganizar, não é mudar de jogador */
    const soReorganiza = onde >= 0;
    const trazDeFora = !soReorganiza && meuOnze[posicaoAberta];

    if(trazDeFora){
      const r = podeMexer();
      if(!r.pode){ avisarSubstituicoes(r.razao); return; }
    }

    if(onde >= 0 && onde !== posicaoAberta) meuOnze[onde] = meuOnze[posicaoAberta];
    meuOnze[posicaoAberta] = nome;

    if(trazDeFora) gastarSubstituicao();
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
   7c-bis. DIA DE JOGO — faixa, placar, onze e lances
   ========================================================================= */
let onzeOficial = null;      // { titulares, suplentes, fonte, link, data }
let relogioJogo = null;

/* A última coisa que aconteceu no jogo, numa linha, na faixa ao vivo.
   Vem da ficha oficial quando há (football-data), senão das notícias —
   e nesse caso vai dito, porque é uma leitura dos jornais. */
function pintarLanceNaFaixa(e){
  const alvo = $('#faixa-lance');
  if(!alvo) return;
  let texto = '';
  if(Jogo.emJogo(e)){
    const oficial = fichaFD?.lances?.slice(-1)[0];
    if(oficial){
      const min = oficial.minuto + (oficial.extra ? '+' + oficial.extra : '');
      const quem = oficial.tipo === 'troca' ? `${oficial.entrou || ''} entra` : (oficial.quem || '');
      texto = `${min}' · ${{golo:'Golo', amarelo:'Amarelo', vermelho:'Vermelho', troca:'Substituição'}[oficial.tipo] || 'Lance'}${quem ? ' — ' + quem : ''}`;
    }else{
      const l = Jogo.lances(NOTICIAS, e, PLANTEL).slice(-1)[0];
      texto = l ? `${l.minuto}' · ${l.titulo}` : 'Sem lances publicados ainda';
    }
  }else if(e.fase === 'fim'){
    texto = 'Jogo terminado';
  }else{
    texto = e.jogo.local || '';
  }
  alvo.textContent = texto;
  alvo.title = texto;
}

/* durante o jogo, o "Ao minuto" da barra inferior passa a "Ao vivo" */
function marcarBarraVivo(vivo){
  const b = $('#barra-vivo');
  if(!b) return;
  b.classList.toggle('a-jogar', vivo);
  b.dataset.vista = vivo ? 'aovivo' : 'aominuto';
  $('#barra-vivo-rotulo').textContent = vivo ? 'Ao vivo' : 'Ao minuto';
}

function pintarDiaDeJogo(){
  const e = Jogo.estado(JOGOS);
  const faixa = $('#faixa-jogo');
  const noMenu = $('#menu-aovivo');
  if(!faixa || !noMenu) return;

  /* longe de jogo: faixa e aba escondidas */
  if(!e || e.fase === 'longe'){
    faixa.hidden = true;
    noMenu.hidden = true;
    marcarBarraVivo(false);
    document.body.classList.remove('dia-de-jogo');
    clearInterval(relogioJogo); relogioJogo = null;
    return;
  }

  faixa.hidden = false;
  noMenu.hidden = false;
  document.body.classList.add('dia-de-jogo');
  document.body.classList.toggle('a-jogar', Jogo.emJogo(e));
  marcarBarraVivo(Jogo.emJogo(e));

  const j = e.jogo;
  $('#faixa-casa').textContent = j.casa;
  $('#faixa-fora').textContent = j.fora;
  $('#faixa-casa-img').src = emblemaEquipa(j.casa);
  $('#faixa-fora-img').src = emblemaEquipa(j.fora);

  const golos = jogado(j) ? `${j.golosCasa} - ${j.golosFora}` : 'vs';
  $('#faixa-resultado').textContent = golos;

  if(Jogo.emJogo(e)){
    $('#faixa-fase').textContent = Jogo.rotuloMinuto(e);
    faixa.classList.add('faixa-jogo--vivo');
  }else if(e.fase === 'fim'){
    $('#faixa-fase').textContent = 'TERMINADO';
    faixa.classList.remove('faixa-jogo--vivo');
  }else{
    const h = Math.floor(e.faltam / 3600000);
    const m = Math.floor(e.faltam % 3600000 / 60000);
    $('#faixa-fase').textContent = h > 0 ? `FALTAM ${h}H${String(m).padStart(2,'0')}` : `FALTAM ${m} MIN`;
    faixa.classList.remove('faixa-jogo--vivo');
  }

  pintarPlacar(e);
  pintarLanceNaFaixa(e);

  /* Havendo token do football-data, o onze e os lances vêm de lá: são
     dados da ficha de jogo, não títulos de jornal lidos à força. Se não
     houver, ou se a ficha ainda não estiver preenchida, fica o que
     sempre houve — a leitura das notícias. */
  usarFichaOficial(e).then(usou => {
    if(!usou){ pintarOnzeOficial(e); pintarLances(e); }
  });

  /* durante o jogo o minuto anda sozinho */
  if(Jogo.emJogo(e) && !relogioJogo){
    relogioJogo = setInterval(() => pintarDiaDeJogo(), 20000);
  }
}

/* ---------------------------------------------------------------------
   Ficha oficial do jogo (football-data.org)
   Devolve true se conseguiu desenhar alguma coisa, para quem chama saber
   se ainda precisa de recorrer às notícias.
   --------------------------------------------------------------------- */
let fichaFD = null;

async function usarFichaOficial(e){
  let ficha = null;
  try{
    const agora = await FD.jogoAgora();
    if(agora?.id) ficha = await FD.ficha(agora.id);
  }catch(err){ return false; }

  if(!ficha) return false;
  fichaFD = ficha;

  const temOnze   = ficha.titulares.length >= 10;
  const temLances = ficha.lances.length > 0;
  if(!temOnze && !temLances) return false;

  if(temOnze) desenharOnzeFD(ficha);
  if(temLances) desenharLancesFD(ficha);

  /* o que a ficha ainda não tem, vai buscar-se às notícias */
  if(!temOnze) pintarOnzeOficial(e);
  if(!temLances) pintarLances(e);
  return true;
}

function desenharOnzeFD(f){
  $('#onze-origem').textContent =
    'oficial · football-data' + (f.formacao ? ' · ' + f.formacao : '');
  $('#onze-oficial').classList.remove('onze--provavel');

  const linha = p => `
    <li data-nome="${Componentes.seguro(p.nome)}">
      <span class="onze__n">${p.n ?? '–'}</span>
      <span class="onze__nome">${Componentes.seguro(p.nome)}</span>
      <span class="onze__papel">${Componentes.seguro(p.pos)}</span>
    </li>`;

  $('#onze-oficial').innerHTML = f.titulares.map(linha).join('');
  $('#banco-oficial').innerHTML = f.suplentes.length
    ? f.suplentes.map(linha).join('')
    : '<li class="onze--vazio"><span class="onze__nome">banco por confirmar</span></li>';

  $$('#onze-oficial li[data-nome], #banco-oficial li[data-nome]').forEach(li =>
    li.addEventListener('click', () => abrirFichaDoNome(li.dataset.nome)));
}

function desenharLancesFD(f){
  const alvo = $('#lances');
  if(!alvo) return;

  $('#lances-nota').textContent = `${f.lances.length} lances · ficha oficial`;

  alvo.innerHTML = f.lances.map(l => {
    const minuto = l.minuto + (l.extra ? '+' + l.extra : '');
    /* a assistência é a informação que nenhuma outra fonte nos dava */
    const quem = l.tipo === 'golo'
      ? `<b>${Componentes.seguro(l.quem || '—')}</b>${
          l.assistiu ? ` <span class="lance__assist">assistência de ${Componentes.seguro(l.assistiu)}</span>` : ''}${
          l.detalhe ? ` <i>${l.detalhe}</i>` : ''}`
      : l.tipo === 'troca'
        ? `<b>${Componentes.seguro(l.entrou || '—')}</b> <span class="lance__assist">por ${Componentes.seguro(l.saiu || '—')}</span>`
        : `<b>${Componentes.seguro(l.quem || '—')}</b>`;

    return `
    <li class="lance lance--${l.tipo} ${l.nosso ? 'lance--nosso' : 'lance--deles'}">
      <span class="lance__min">${minuto}'</span>
      <span class="lance__ico" aria-hidden="true">${l.icone}</span>
      <span class="lance__txt">${quem}</span>
      ${l.resultado ? `<span class="lance__res">${l.resultado}</span>` : ''}
    </li>`;
  }).join('');
}

function pintarPlacar(e){
  const alvo = $('#placar');
  if(!alvo) return;
  const j = e.jogo;
  const d = new Date(j.data);

  alvo.innerHTML = `
    <div class="placar ${Jogo.emJogo(e) ? 'placar--vivo' : ''}">
      <div class="placar__comp">${Componentes.seguro(j.comp)}</div>
      <div class="placar__equipas">
        <div class="placar__eq">
          <img src="${emblemaEquipa(j.casa)}" alt="">
          <b>${Componentes.seguro(j.casa)}</b>
        </div>
        <div class="placar__meio">
          <div class="placar__golos">${jogado(j) ? `${j.golosCasa} - ${j.golosFora}` : '—'}</div>
          <div class="placar__minuto">${Jogo.rotuloMinuto(e) ||
            d.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})}</div>
        </div>
        <div class="placar__eq">
          <img src="${emblemaEquipa(j.fora)}" alt="">
          <b>${Componentes.seguro(j.fora)}</b>
        </div>
      </div>
      <div class="placar__onde">${Componentes.seguro(j.local || '')}</div>
      ${Jogo.emJogo(e) ? `<p class="placar__aviso">
        O minuto é calculado pelo relógio, a partir da hora de início — não
        conta descontos nem paragens. O resultado e os lances vêm das
        notícias dos jornais, por isso chegam com algum atraso.</p>` : ''}
    </div>`;
}

/* O onze oficial sai perto do jogo, mas de manhã já saem os prováveis.
   Vale a pena mostrar os dois — desde que se diga qual é qual. */
const ONZE_OFICIAL = /onze oficial|eis o onze|j[áa] h[áa] onze|onze escolhido|comunicado o onze|equipa inicial|onze do sporting para|escala[çc][ãa]o oficial/i;

/* procura nas notícias a que anuncia o onze e tira de lá os nomes */
function procurarOnzeOficial(e){
  const inicio = new Date(e.jogo.data).getTime();

  const candidatas = NOTICIAS
    .filter(n => CONFIG.filtroOnze.test(n.titulo))
    /* desde a manhã do jogo até um pouco depois do apito inicial */
    .filter(n => {
      const dt = n.data.getTime() - inicio;
      return dt > -14 * 3600000 && dt < 3 * 3600000;
    })
    .map(n => ({
      ...n,
      /* oficial se o disser, ou se saiu já perto do apontapé */
      oficial: ONZE_OFICIAL.test(n.titulo) || (n.data.getTime() - inicio) > -2.5 * 3600000
    }))
    /* o oficial ganha sempre ao provável; entre iguais, o mais recente */
    .sort((a,b) => (b.oficial - a.oficial) || (b.data - a.data));

  return candidatas[0] || null;
}

async function pintarOnzeOficial(e){
  const alvo = $('#onze-oficial');
  const banco = $('#banco-oficial');
  if(!alvo) return;

  const noticia = procurarOnzeOficial(e);
  if(!noticia){
    $('#onze-origem').textContent = 'ainda não saiu';
    alvo.innerHTML = `<li class="onze--vazio"><span class="onze__nome">
      O onze costuma ser conhecido cerca de uma hora antes. Assim que algum
      jornal o publicar, aparece aqui.</span></li>`;
    banco.innerHTML = '';
    return;
  }

  /* já foi lido? */
  if(onzeOficial?.link === noticia.link){
    desenharOnze(onzeOficial);
    return;
  }

  $('#onze-origem').textContent = 'a ler…';

  /* primeiro tenta-se com o resumo; se não chegar, vai-se ao artigo */
  let texto = noticia.titulo + ' ' + (noticia.resumo || '');
  let reparticao = Jogo.repartirOnze(texto, PLANTEL);

  if(reparticao.titulares.length < 9){
    try{
      const r = await fetch('/ler?url=' + encodeURIComponent(noticia.link));
      if(r.ok){
        const html = await r.text();
        const corpo = html.replace(/<script[\s\S]*?<\/script>/gi,'')
                          .replace(/<style[\s\S]*?<\/style>/gi,'')
                          .replace(/<[^>]+>/g,' ');
        reparticao = Jogo.repartirOnze(corpo, PLANTEL);
      }
    }catch(err){ /* fica o que se conseguiu do resumo */ }
  }

  onzeOficial = { ...reparticao, fonte: noticia.fonte, link: noticia.link,
                  data: noticia.data, oficial: noticia.oficial };
  desenharOnze(onzeOficial);
}

function desenharOnze(o){
  const alvo = $('#onze-oficial');
  const banco = $('#banco-oficial');

  if(!o.titulares.length){
    $('#onze-origem').textContent = 'não consegui ler';
    alvo.innerHTML = `<li class="onze--vazio"><span class="onze__nome">
      Encontrei a notícia do onze mas não consegui tirar de lá os nomes.
      <a href="${Componentes.seguro(o.link)}" target="_blank" rel="noopener">Abrir no jornal ↗</a>
    </span></li>`;
    banco.innerHTML = '';
    return;
  }

  /* de manhã só há prováveis: mais vale dizê-lo do que dar a entender
     que é o onze a sério */
  $('#onze-origem').textContent = o.oficial
    ? `oficial · ${o.fonte}`
    : `provável · ${o.fonte}`;
  $('#onze-oficial').classList.toggle('onze--provavel', !o.oficial);

  const linha = p => `
    <li data-nome="${Componentes.seguro(p.nome)}">
      <span class="onze__n">${p.n ?? '–'}</span>
      <span class="onze__nome">${Componentes.seguro(ALCUNHAS[p.nome] || p.nome)}</span>
      <span class="onze__papel">${Componentes.seguro(p.pos)}</span>
    </li>`;

  /* Os nomes saem pela ordem da prosa do jornal, que não é a do campo.
     Põe-se guarda-redes primeiro e avançados no fim, como numa ficha. */
  const ORDEM = { GR:0, DEF:1, MED:2, AVA:3 };
  /* o plantel já guarda o grupo em .pos; PAPEL_GRUPO só serve se algum dia
     lá vier o papel miúdo (DC, MC, PL…) */
  const grau = p => ORDEM[p.pos] ?? ORDEM[PAPEL_GRUPO[p.pos]] ?? 9;
  const porCampo = (a,b) => grau(a) - grau(b);

  alvo.innerHTML = [...o.titulares].sort(porCampo).map(linha).join('');
  banco.innerHTML = o.suplentes.length
    ? [...o.suplentes].sort(porCampo).map(linha).join('')
    : '<li class="onze--vazio"><span class="onze__nome">banco por confirmar</span></li>';

  $$('#onze-oficial li[data-nome], #banco-oficial li[data-nome]').forEach(li =>
    li.addEventListener('click', () => abrirFichaDoNome(li.dataset.nome)));
}

function pintarLances(e){
  const alvo = $('#lances');
  if(!alvo) return;

  const lista = Jogo.lances(NOTICIAS, e, PLANTEL);
  $('#lances-nota').textContent = Jogo.emJogo(e)
    ? `${lista.length} lances · das notícias`
    : 'o jogo ainda não começou';

  if(!lista.length){
    alvo.innerHTML = `<li>${Componentes.vazio(
      Jogo.emJogo(e) ? 'Ainda sem lances' : 'À espera do apito inicial',
      Jogo.emJogo(e)
        ? 'Assim que os jornais publicarem golos, cartões ou substituições, aparecem aqui.'
        : 'Quando o jogo começar, os lances vão aparecendo aqui.',
      tacaSVG('liga','var(--texto-3)'))}</li>`;
    return;
  }

  alvo.innerHTML = lista.map(l => `
    <li class="lance lance--${l.tipo}">
      <span class="lance__minuto">${l.minuto}'</span>
      <span class="lance__icone" aria-hidden="true">${l.icone}</span>
      <span class="lance__txt">
        <a href="${Componentes.seguro(l.link)}" target="_blank" rel="noopener">
          ${Componentes.seguro(l.titulo)}</a>
        <span>${Componentes.seguro(l.fonte)}${l.jogador
          ? ' · ' + Componentes.seguro(ALCUNHAS[l.jogador.nome] || l.jogador.nome) : ''}</span>
      </span>
    </li>`).join('');
}

/* =========================================================================
   7d. CHAT — comentários sobre os jogos, com fotografias
   Precisa de ligação: as mensagens são as mesmas para toda a gente.
   ========================================================================= */
let fotoEscolhida = null;
let pararDeOuvir = null;

function estadoChat(texto, tipo){
  const el = $('#chat-estado');
  if(el){ el.textContent = texto; el.className = 'sub-inline ' + (tipo || ''); }
}

async function pintarChat(){
  const lista = $('#chat-lista');
  if(!lista) return;

  if(!Nuvem.ligado){
    lista.innerHTML = Componentes.vazio('Chat offline',
      'O chat precisa de ligação ao servidor. Verifica a Internet e recarrega.',
      tacaSVG('europa', 'var(--texto-3)'));
    estadoChat('sem ligação', 'erro');
    $('#chat-form').hidden = true;
    return;
  }

  const eu = Nuvem.perfil;
  $('#chat-form').hidden = !eu;
  estadoChat(eu ? 'ligado como @' + eu.utilizador : 'entra na tua conta para escrever',
             eu ? 'ok' : '');

  const mensagens = await Nuvem.lerMensagens(60);
  if(!mensagens.length){
    lista.innerHTML = Componentes.vazio('Ainda ninguém falou',
      'Sê o primeiro a comentar o jogo.', tacaSVG('liga', 'var(--texto-3)'));
    return;
  }

  const perto = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 80;

  lista.innerHTML = mensagens.map(m => {
    const meu = eu && m.perfil_id === eu.id;
    /* m.autor é o nome gravado na mensagem — só entra em campo
       se a conta já não existir */
    const nome = m.perfis?.nome_mostrado || m.perfis?.utilizador || m.autor || 'alguém';
    const quando = new Date(m.criado_em);
    return `
    <li class="msg ${meu ? 'msg--minha' : ''}">
      <div class="msg__cabeca">
        <span class="msg__avatar" aria-hidden="true">${Componentes.seguro(nome[0].toUpperCase())}</span>
        <b>@${Componentes.seguro(nome)}</b>
        <time datetime="${quando.toISOString()}">${Componentes.haQuanto(quando)}</time>
        ${meu ? `<button class="msg__apagar" data-id="${m.id}" aria-label="Apagar mensagem">✕</button>` : ''}
      </div>
      ${m.texto ? `<p class="msg__texto">${Componentes.seguro(m.texto)}</p>` : ''}
      ${m.foto_url ? `<a class="msg__foto" href="${Componentes.seguro(m.foto_url)}"
           target="_blank" rel="noopener">
           <img src="${Componentes.seguro(m.foto_url)}" alt="Fotografia de @${Componentes.seguro(nome)}"
                loading="lazy" decoding="async"></a>` : ''}
    </li>`;
  }).join('');

  $$('#chat-lista .msg__apagar').forEach(b => b.addEventListener('click', async () => {
    if(!confirm('Apagar esta mensagem?')) return;
    await Nuvem.apagarMensagem(+b.dataset.id);
    pintarChat();
  }));

  if(perto) lista.scrollTop = lista.scrollHeight;
}

function ligarChat(){
  const form = $('#chat-form');
  if(!form) return;

  const campo = $('#chat-texto');
  const erro = $('#chat-erro');

  /* a caixa cresce com o texto */
  campo.addEventListener('input', () => {
    campo.style.height = 'auto';
    campo.style.height = Math.min(campo.scrollHeight, 140) + 'px';
  });

  /* Enter envia, Shift+Enter muda de linha */
  campo.addEventListener('keydown', e => {
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); form.requestSubmit(); }
  });

  /* fotografia */
  $('#chat-ficheiro').addEventListener('change', e => {
    const f = e.target.files?.[0];
    if(!f) return;
    if(f.size > 5*1024*1024){ erro.textContent = 'A imagem tem de ter menos de 5 MB.'; return; }
    fotoEscolhida = f;
    $('#chat-previa-img').src = URL.createObjectURL(f);
    $('#chat-previa').hidden = false;
    erro.textContent = '';
  });

  $('#chat-tirar-foto').addEventListener('click', () => {
    fotoEscolhida = null;
    $('#chat-previa').hidden = true;
    $('#chat-ficheiro').value = '';
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    erro.textContent = '';
    const botao = $('#chat-enviar');
    botao.disabled = true;
    botao.textContent = 'A enviar…';

    try{
      let url = null;
      if(fotoEscolhida){
        const r = await Nuvem.enviarFoto(fotoEscolhida);
        if(r.erro){ erro.textContent = r.erro; return; }
        url = r.url;
      }
      const jogoAtual = porJogar()[0];
      const r = await Nuvem.enviarMensagem(campo.value, url,
        jogoAtual ? `${jogoAtual.casa} — ${jogoAtual.fora}` : null);
      if(r.erro){ erro.textContent = r.erro; return; }

      campo.value = ''; campo.style.height = 'auto';
      $('#chat-tirar-foto').click();
      pintarChat();
    }catch(falha){
      /* sem isto um erro aqui dentro desaparecia sem deixar rasto */
      erro.textContent = 'Não consegui enviar: ' + (falha?.message || falha);
      console.error('chat:', falha);
    }finally{
      botao.disabled = false;
      botao.textContent = 'Enviar';
    }
  });

  /* mensagens novas aparecem sozinhas */
  pararDeOuvir?.();
  pararDeOuvir = Nuvem.ouvirChat(() => pintarChat());
}

/* =========================================================================
   8. MERCADO E CLUBE
   ========================================================================= */
/* =========================================================================
   MOVIMENTOS AUTOMÁTICOS
   -------------------------------------------------------------------------
   Não há fonte automática com os valores: as tabelas de transferências do
   Wikipédia para 2026/27 estão vazias, o Transfermarkt bloqueia leitura por
   programa e a conta da API-Football está suspensa.

   O que dá para fazer sozinho é reparar em quem ENTRA e SAI do plantel: a
   cada sincronização guarda-se a lista de nomes e compara-se com a anterior.
   Quem aparecer é reforço, quem desaparecer é saída. O valor, quando existe,
   vem do que está escrito à mão em data.js ou de um título de notícia.
   ========================================================================= */
/* Quem está mesmo no plantel.
   O Wikipédia é mantido por voluntários e chega a andar semanas atrás do
   mercado — em setembro de 2026 ainda lá estavam quatro jogadores já
   vendidos e faltavam três contratações. Quem manda na lista é o ficheiro
   do zerozero (atualizar_plantel.py); do Wikipédia aproveitam-se os jogos
   e golos por prova, que o zerozero não dá nesta página. */
function juntarComZerozero(doWiki){
  const zz = PLANTEL_ZZ.jogadores;
  if(!zz?.length) return doWiki;

  const porChave = new Map(doWiki.map(p => [chaveNome(p.nome), p]));

  return zz.map(z => {
    const w = porChave.get(chaveNome(z.nome))
           || doWiki.find(p => apelido(p.nome) === apelido(z.nome));
    return {
      ...(w || {}),
      nome: w?.nome || z.nome,      // o Wikipédia escreve os nomes por extenso
      n:    z.n ?? w?.n ?? null,
      pos:  z.pos, posGrupo: z.posGrupo,
      nac:  z.nac || w?.nac || '',
      idade: z.idade ?? null,
      valorZZ: z.valor,
      fotoZZ: z.foto || null,
      nota: w?.nota || ''
    };
  });
}

const RETRATO_PLANTEL = 'scp-plantel-retrato-v1';
/* de onde veio a lista. Muda quando se troca de fonte, para o retrato
   guardado não ser comparado com outro que foi feito de outra maneira. */
const FONTE_PLANTEL = 'zerozero';
let MOVIMENTOS_AUTO = { entradas: [], saidas: [] };

function lerRetrato(){
  try{ return JSON.parse(localStorage.getItem(RETRATO_PLANTEL) || 'null'); }
  catch(e){ return null; }
}

function guardarRetrato(nomes){
  try{
    localStorage.setItem(RETRATO_PLANTEL,
      JSON.stringify({ quando: Date.now(), fonte: FONTE_PLANTEL, nomes }));
  }catch(e){}
}

/* procura "20 milhões", "€18M", "18 M€" num título sobre o jogador */
function valorNasNoticias(nome){
  const apelidoDo = apelido(nome);
  for(const n of NOTICIAS){
    if(!semAcentos(n.titulo).includes(semAcentos(apelidoDo))) continue;
    const m = n.titulo.match(/(\d+[.,]?\d*)\s*(?:milh[õo]es|M\s*€|€\s*M|M€)/i);
    if(m) return parseFloat(m[1].replace(',', '.'));
  }
  return null;
}

function detetarMovimentos(){
  const nomes = PLANTEL.map(p => p.nome).sort();
  const retrato = lerRetrato();

  /* primeira vez: só se guarda, não se inventa nada */
  if(!retrato?.nomes?.length){
    guardarRetrato(nomes);
    return;
  }

  /* O retrato anterior foi tirado quando o plantel ainda vinha do
     Wikipédia. Comparar os dois dava movimentos que nunca existiram —
     jogadores que o Wikipédia não tinha, e miúdos subidos da formação,
     que não são transferências. Quando a fonte muda, recomeça-se. */
  if(retrato.fonte !== FONTE_PLANTEL){
    guardarRetrato(nomes);
    return;
  }

  const antes = new Set(retrato.nomes);
  const agora = new Set(nomes);

  const chegaram = nomes.filter(n => !antes.has(n));
  const sairam = retrato.nomes.filter(n => !agora.has(n));

  if(chegaram.length || sairam.length){
    const hoje = new Date().toISOString().slice(0,10);
    MOVIMENTOS_AUTO.entradas.push(...chegaram.map(nome => ({
      nome, origem: 'detetado no plantel', valor: valorNasNoticias(nome), data: hoje, auto: true
    })));
    MOVIMENTOS_AUTO.saidas.push(...sairam.map(nome => ({
      nome, destino: 'saiu do plantel', valor: valorNasNoticias(nome), data: hoje, auto: true
    })));
    guardarRetrato(nomes);
    pintarMercado();
  }
}

/* junta o que está escrito à mão com o que foi detetado, sem repetir */
function movimentosCompletos(){
  const juntar = (mao, auto, campo) => {
    const porNome = new Map(mao.map(x => [chaveNome(x.nome), {...x}]));
    auto.forEach(a => {
      const k = chaveNome(a.nome);
      if(porNome.has(k)){
        /* já existe à mão: só se preenche o que falta */
        const e = porNome.get(k);
        if(e.valor == null && a.valor != null) e.valor = a.valor;
      }else{
        porNome.set(k, { ...a, [campo]: a[campo] || 'sem detalhes' });
      }
    });
    return [...porNome.values()].sort((a,b) => (b.valor||0) - (a.valor||0));
  };
  return {
    entradas: juntar(ENTRADAS, MOVIMENTOS_AUTO.entradas, 'origem'),
    saidas:   juntar(SAIDAS,   MOVIMENTOS_AUTO.saidas,   'destino')
  };
}

function pintarMercado(){
  /* lista à mão + o que foi detetado sozinho pela diferença de plantel */
  const { entradas: ENTS, saidas: SAIS } = movimentosCompletos();

  const soma  = l => l.reduce((t,x) => t + (x.valor || 0), 0);
  const bonus = l => l.reduce((t,x) => t + (x.bonus || 0), 0);

  const gasto  = soma(ENTS),  gastoB  = bonus(ENTS);
  const encaixe= soma(SAIS),  encaixeB= bonus(SAIS);
  const saldo  = encaixe - gasto;

  /* barra proporcional: o maior negócio enche a barra toda */
  const maior = Math.max(...[...ENTS, ...SAIS].map(x => x.valor || 0), 1);

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
      <h4><span class="mv__seta">▼</span> CHEGARAM <em>${ENTS.length}</em></h4>
      <ul>${ENTS.map(e => cartao(e,'origem','in')).join('')}</ul>
      <div class="mv__soma"><span>INVESTIDO</span><b>${milhoes(gasto)}</b></div>
      ${gastoB ? `<div class="mv__extra">mais ${milhoes(gastoB)} por objetivos</div>` : ''}
    </div>

    <div class="mv mv--out">
      <h4><span class="mv__seta">▲</span> SAÍRAM <em>${SAIS.length}</em></h4>
      <ul>${SAIS.map(s => cartao(s,'destino','out')).join('')}</ul>
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
  const icone = $('#icone-palmares');
  if(icone && !icone.innerHTML) icone.innerHTML = tacaSVG('liga', 'var(--ouro)');
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
    /* Havendo token, a classificação vem do football-data, que atualiza
       logo a seguir aos jogos; senão vai ao Wikipédia como sempre foi. */
    TABELA = (await FD.classificacao()) || (await Wiki.classificacao());
    /* a Champions é uma página à parte: se falhar, fica o retrato guardado
       e a Liga não deixa de atualizar por causa disso */
    try{
      TABELA_CL = await Wiki.classificacaoChampions();
    }catch(e){ /* segue com TABLE_CL */ }
    pintarTabela();
  }catch(e){ falhas.push('classificação'); }

  try{
    const { plantel, stats, provas, jogos } = await Wiki.sincronizarSporting();

    if(provas?.length) PROVAS_DISPONIVEIS = provas;

    if(plantel.length){
      PLANTEL = juntarComZerozero(plantel).map(p => {
        const chave = Object.keys(stats).find(k => chaveNome(k) === chaveNome(p.nome));
        return {...p, stats: stats[chave] || {jogos:0, golos:0, provas:{}}, idade: p.idade ?? null};
      });
      ligarFotos();
      detetarMovimentos();
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
    pintarJogosTodos(); pintarEstatisticas(); pintarDiaDeJogo();
    pintarTabelaCasa(); pintarModalidadesCasa();
    pintarResumoLiga(provaTabela !== 'champions' && TABELA.some(t => t.j > 0));   // a forma precisa dos jogos
    if(vistaAtual === 'agenda') pintarAgenda();
    if(vistaAtual === 'modalidades') pintarModalidades();
  }catch(e){ falhas.push('plantel/jogos'); }

  const hora = new Date().toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});
  const noRodape = $('#rodape-estado');
  if(noRodape) noRodape.textContent = falhas.length
    ? 'dados parciais · ' + hora
    : 'dados atualizados às ' + hora;
  jogosSincronizados = true; pintarProximoJogo(); pintarCalendario();
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
    document.body.classList.remove('menu-aberto');
    botao.setAttribute('aria-expanded','false');
    botao.setAttribute('aria-label','Abrir menu');
    $('#barra-mais')?.setAttribute('aria-expanded','false');
    $('#barra-mais')?.classList.remove('is-on');
  };
  const abrir = () => {
    menu.classList.add('aberto');
    veu.classList.add('aparece');
    /* trava o deslize da página por baixo enquanto a gaveta está aberta */
    document.body.classList.add('menu-aberto');
    botao.setAttribute('aria-expanded','true');
    botao.setAttribute('aria-label','Fechar menu');
    $('#barra-mais')?.classList.add('is-on');
    menu.querySelector('.menu__item')?.focus();
  };

  botao.addEventListener('click', () =>
    menu.classList.contains('aberto') ? fechar() : abrir());
  veu.addEventListener('click', fechar);
  $$('.menu__item').forEach(b => b.addEventListener('click', fechar));
  $$('.barra-inferior__item[data-vista]').forEach(b => b.addEventListener('click', fechar));
  addEventListener('keydown', e => {
    if(e.key === 'Escape' && menu.classList.contains('aberto')) { fechar(); botao.focus(); }
  });

  /* a barra fica colada por baixo do cabeçalho — a altura é medida, não adivinhada */
  const medir = () => document.documentElement.style.setProperty(
    '--altura-topo', ($('#cabeca')?.offsetHeight || $('.topo')?.offsetHeight || 92) + 'px');
  medir();
  addEventListener('resize', medir);
}

/* Passados uns 80px de scroll, a faixa da marca encolhe e o emblema
   pequeno aparece na navegação. A altura muda, por isso volta-se a medir
   para a faixa de dia de jogo continuar colada por baixo. */
function ligarCabeca(){
  const cabeca = $('#cabeca');
  if(!cabeca) return;
  let rolou = null, aEsperar = false;
  const ver = () => {
    aEsperar = false;
    const agora = scrollY > 80;
    if(agora === rolou) return;
    rolou = agora;
    document.body.classList.toggle('rolou', agora);
    setTimeout(() => document.documentElement.style.setProperty(
      '--altura-topo', cabeca.offsetHeight + 'px'), 260);
  };
  addEventListener('scroll', () => {
    if(aEsperar) return;
    aEsperar = true;
    requestAnimationFrame(ver);
  }, { passive:true });
  ver();
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

  /* /privacidade e /termos abrem o texto diretamente — a Google Play (e
     quem quiser ligar para lá) precisa de um endereço público para isto */
  const pedido = { '/privacidade':'privacidade', '/termos':'termos' }[location.pathname.replace(/\/+$/, '')];
  if(pedido) $(`[data-legal="${pedido}"]`)?.click();
}

/* ---------------------------------------------------------------------
   ROTAS — cada vista tem um endereço próprio (/jogos, /plantel, …).
   Serve para partilhar, para os atalhos da aplicação instalada e para os
   links abrirem direto na vista certa. Só um nível: os ficheiros do site
   são pedidos com caminhos relativos, e /a/b partia-os.
   --------------------------------------------------------------------- */
const ROTAS = {
  inicio:'/', noticias:'/noticias', aominuto:'/ao-minuto', rumores:'/mercado',
  jogos:'/jogos', agenda:'/agenda', classificacao:'/classificacao', aovivo:'/ao-vivo',
  equipa:'/plantel', estatisticas:'/estatisticas', modalidades:'/modalidades',
  chat:'/chat', formacao:'/fantasy', clube:'/clube'
};
const TITULOS = {
  inicio:'Sporting ao Minuto — notícias, jogos e ao minuto do Sporting CP',
  noticias:'Notícias', aominuto:'Ao minuto', rumores:'Mercado', jogos:'Jogos',
  agenda:'Agenda', classificacao:'Classificação', aovivo:'Ao vivo', equipa:'Plantel',
  estatisticas:'Estatísticas', modalidades:'Modalidades', chat:'Chat',
  formacao:'Fantasy', clube:'O clube'
};

/* descrição de cada vista — vai para a meta description e para a partilha */
const DESCRICOES = {
  inicio:'Notícias do Sporting CP ao minuto, de 12 jornais: jogos, resultados, classificação, plantel, mercado e modalidades.',
  noticias:'Todas as notícias do Sporting CP, de minuto a minuto, de 12 jornais portugueses.',
  aominuto:'A linha do tempo do Sporting CP: cada notícia, rumor e lance à hora a que acontece.',
  rumores:'Mercado do Sporting CP: entradas, saídas, renovações e rumores na imprensa.',
  jogos:'Calendário e resultados do Sporting CP na Liga Portugal, Liga dos Campeões e taças.',
  agenda:'Os próximos jogos do Sporting CP, por dia e hora.',
  classificacao:'Classificação da Liga Portugal e da Liga dos Campeões, com a forma do Sporting CP.',
  aovivo:'O jogo do Sporting CP ao vivo: resultado, onze inicial e lances.',
  equipa:'O plantel do Sporting CP: jogadores, números, posições, valores e estatísticas.',
  estatisticas:'Estatísticas do Sporting CP: golos, jogos e números da época, por competição.',
  modalidades:'Futsal, andebol, basquetebol, hóquei, voleibol, atletismo, feminino e formação do Sporting CP.',
  chat:'Conversa entre adeptos do Sporting CP sobre os jogos.',
  formacao:'Fantasy do Sporting: plantel de 15, orçamento, capitão, transferências, jornadas e ligas privadas entre amigos.',
  clube:'O Sporting Clube de Portugal: história, palmarés, estádio e números.'
};

/* canónico, partilha e descrição acompanham a vista aberta */
function metaDaVista(vista){
  const url = location.origin + ROTAS[vista];
  const titulo = vista === 'inicio' ? 'Sporting ao Minuto' : `${TITULOS[vista]} · Sporting ao Minuto`;
  const por = (id, atributo, valor) => document.getElementById(id)?.setAttribute(atributo, valor);
  por('canonico', 'href', url);
  por('og-url', 'content', url);
  por('og-titulo', 'content', titulo);
  por('meta-descricao', 'content', DESCRICOES[vista] || DESCRICOES.inicio);
  por('og-descricao', 'content', DESCRICOES[vista] || DESCRICOES.inicio);
}

/* dados estruturados: o site e a pesquisa (/noticias?q=…) */
function dadosEstruturados(){
  if(document.getElementById('ld-site')) return;
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.id = 'ld-site';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Sporting ao Minuto',
    alternateName: 'Sporting ao Minuto — portal de adeptos',
    url: location.origin + '/',
    inLanguage: 'pt-PT',
    description: DESCRICOES.inicio,
    about: { '@type': 'SportsTeam', name: 'Sporting Clube de Portugal', sport: 'Futebol' },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: location.origin + '/noticias?q={search_term_string}' },
      'query-input': 'required name=search_term_string'
    }
  });
  document.head.appendChild(ld);
}

function vistaDaRota(caminho){
  const limpo = (caminho || '/').replace(/\/+$/, '') || '/';
  return Object.keys(ROTAS).find(v => ROTAS[v] === limpo) || 'inicio';
}

function irPara(vista, opcoes = {}){
  const { historico = true, rolar = true } = opcoes;
  if(!$('#vista-' + vista)) vista = 'inicio';
  vistaAtual = vista;
  if(vista === 'chat') pintarChat();
  if(vista === 'formacao') window.Fantasy?.abrir();
  if(vista === 'estatisticas') window.Arquivo?.abrir();
  if(vista === 'aovivo') pintarDiaDeJogo();
  if(vista === 'agenda') pintarAgenda();
  if(vista === 'modalidades') pintarModalidades();

  $$('.vista').forEach(v => v.classList.toggle('is-on', v.id === 'vista-' + vista));
  $$('[data-vista]').forEach(b => {
    const ativo = b.dataset.vista === vista;
    b.classList.toggle('is-on', ativo);
    if(ativo) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  /* o grupo do submenu acende quando uma das suas vistas está aberta */
  $$('.menu__grupo').forEach(g =>
    g.querySelector('.menu__pai').classList.toggle('is-on', !!g.querySelector(`[data-vista="${vista}"]`)));
  fecharSubmenus();

  document.title = vista === 'inicio' ? TITULOS.inicio : `${TITULOS[vista]} · Sporting ao Minuto`;
  metaDaVista(vista);
  if(historico && location.pathname !== ROTAS[vista]){
    history.pushState({ vista }, '', ROTAS[vista] + (vista === 'modalidades' ? location.hash : ''));
  }
  if(rolar) scrollTo({ top:0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

/* ---------------------------------------------------------------------
   AGENDA — os jogos que aí vêm, por dia.
   Só o futebol tem calendário ligado. Para as outras equipas a página
   diz isso e aponta para as notícias, em vez de mostrar jogos inventados.
   --------------------------------------------------------------------- */
let filtroAgenda = 'todos';

/* jogos de uma modalidade — hoje só há fonte para o futebol principal */
function jogosDaModalidade(id){
  const m = modalidade(id);
  if(m?.jogos === 'principal') return JOGOS;
  return [];
}

function pintarAgenda(){
  const alvo = $('#agenda-lista');
  if(!alvo) return;
  requestAnimationFrame(() => marcarTransbordo($('#vista-agenda')));
  $$('#agenda-filtro .separador').forEach(b => {
    b.classList.toggle('is-on', b.dataset.filtro === filtroAgenda);
    b.setAttribute('aria-pressed', b.dataset.filtro === filtroAgenda);
  });

  /* os de hoje que já acabaram ficam (com resultado); depois, o que vem */
  const inicioDoDia = new Date(); inicioDoDia.setHours(0, 0, 0, 0);
  const futebol = filtroAgenda === 'todos' || filtroAgenda === 'futebol';
  const jogos = futebol
    ? JOGOS.filter(j => new Date(j.data) >= inicioDoDia).sort((a, b) => new Date(a.data) - new Date(b.data)).slice(0, 30)
    : [];

  if(!JOGOS.length){
    alvo.innerHTML = Array.from({ length: 5 }, () => '<div class="ag ag--osso" aria-hidden="true"><div class="osso"></div></div>').join('');
    return;
  }

  const semFonte = {
    modalidades: ['Modalidades', 'futsal'],
    formacao: ['Formação', 'formacao'],
    feminino: ['Futebol feminino', 'feminino']
  }[filtroAgenda];

  let html = '';
  if(jogos.length) html += `<ol class="agenda">${agendaPorDia(jogos, { local:true })}</ol>`;
  if(semFonte){
    html += `<div class="estado">
      <p class="estado__titulo">${semFonte[0]}: calendário ainda não ligado</p>
      <p class="estado__texto">Por agora só o futebol da equipa principal tem uma fonte de jogos fiável.
        Não mostramos datas que não conseguimos confirmar. As notícias destas equipas estão nas Modalidades.</p>
      <button type="button" class="botao-texto" data-modalidade="${semFonte[1]}">Abrir modalidades ${ICONE_SETA}</button>
    </div>`;
  }else if(filtroAgenda === 'todos'){
    html += `<p class="agenda__nota">Calendário do futebol da equipa principal. O das modalidades ainda não está ligado a uma fonte.</p>`;
  }
  if(!html) html = `<div class="estado"><p class="estado__titulo">Sem jogos marcados</p><p class="estado__texto">Assim que houver datas, aparecem aqui.</p></div>`;
  alvo.innerHTML = html;
  ligarItensAgenda(alvo);
  alvo.querySelector('[data-modalidade]')?.addEventListener('click', e => {
    modalidadeAtual = e.currentTarget.dataset.modalidade;
    history.pushState({ vista:'modalidades' }, '', '/modalidades#' + modalidadeAtual);
    irPara('modalidades', { historico:false });
  });

  const resumo = $('#agenda-resumo');
  if(resumo){
    const prox = porJogar()[0];
    resumo.textContent = prox
      ? `Próximo: ${prox.casa} – ${prox.fora}, ${rotuloDia(new Date(prox.data)).toLowerCase()} às ${horaJogo(prox, new Date(prox.data))}.`
      : 'Hoje, amanhã e os dias seguintes, por hora de início.';
  }
}

/* ---------------------------------------------------------------------
   MODALIDADES — uma página por equipa do clube
   --------------------------------------------------------------------- */
let modalidadeAtual = 'futebol';

function pintarModalidades(){
  const seps = $('#mod-separadores');
  const painel = $('#mod-painel');
  if(!seps || !painel) return;

  const pedida = decodeURIComponent((location.hash || '').slice(1));
  if(pedida && modalidade(pedida)) modalidadeAtual = pedida;
  const m = modalidade(modalidadeAtual) || CONFIG.modalidades[0];

  seps.innerHTML = CONFIG.modalidades.map(x => `
    <button type="button" role="tab" class="mod-sep ${x.id === m.id ? 'is-on' : ''}" data-modalidade="${x.id}"
            aria-selected="${x.id === m.id}" aria-controls="mod-painel" style="--m-cor: var(--m-${x.id})">
      <i class="mod-sep__ponto" aria-hidden="true"></i>${x.curto}
    </button>`).join('');
  requestAnimationFrame(() => marcarTransbordo(seps.parentElement));
  seps.querySelectorAll('.mod-sep').forEach(b => b.addEventListener('click', () => {
    modalidadeAtual = b.dataset.modalidade;
    history.replaceState({ vista:'modalidades' }, '', '/modalidades#' + modalidadeAtual);
    pintarModalidades();
  }));
  /* setas entre separadores, como pede o padrão de tabs (liga-se uma vez) */
  if(!seps.dataset.ligado) seps.dataset.ligado = '1', seps.addEventListener('keydown', e => {
    if(!['ArrowRight','ArrowLeft'].includes(e.key)) return;
    const bts = [...seps.querySelectorAll('.mod-sep')];
    const i = bts.indexOf(document.activeElement);
    const prox = bts[(i + (e.key === 'ArrowRight' ? 1 : -1) + bts.length) % bts.length];
    prox?.click(); seps.querySelector('.mod-sep.is-on')?.focus();
  });

  const noticias = m.id === 'futebol'
    ? NOTICIAS.filter(n => temaDe(n) === 'futebol')
    : noticiasDe(m.id);
  const jogos = jogosDaModalidade(m.id);
  const proximo = jogos.filter(j => !jogado(j) && new Date(j.data) > Date.now()).sort((a, b) => new Date(a.data) - new Date(b.data))[0];
  const ultimo = jogos.filter(jogado).slice(-1)[0];

  const cartaoJogo = (titulo, j) => {
    if(!j) return `<div class="mod-jogo mod-jogo--vazio"><p class="mod-jogo__rotulo">${titulo}</p>
      <p class="mod-jogo__vazio">${m.jogos ? 'Sem jogo marcado.' : 'Calendário ainda não ligado para esta modalidade — não inventamos datas.'}</p></div>`;
    const d = new Date(j.data);
    const centro = jogado(j) ? `<b class="mod-jogo__res">${j.golosCasa}<i>–</i>${j.golosFora}</b>` : `<b class="mod-jogo__hora">${horaJogo(j, d)}</b>`;
    return `<button type="button" class="mod-jogo" data-jogo-data="${j.data}">
      <p class="mod-jogo__rotulo">${titulo}</p>
      <p class="mod-jogo__prova">${nomeProva(j.comp).completo} · ${rotuloDia(d)}</p>
      <span class="mod-jogo__equipas">
        <span class="${eSporting(j.casa) ? 'e-nos' : ''}"><img src="${emblemaEquipa(j.casa)}" alt="" width="32" height="32" loading="lazy">${j.casa}</span>
        ${centro}
        <span class="${eSporting(j.fora) ? 'e-nos' : ''}"><img src="${emblemaEquipa(j.fora)}" alt="" width="32" height="32" loading="lazy">${j.fora}</span>
      </span>
    </button>`;
  };

  const semana = Date.now() - 7 * 86400000;
  const destaques = noticias.slice(0, 13);
  painel.style.setProperty('--m-cor', `var(--m-${m.id})`);
  painel.innerHTML = `
    <header class="mod-cabeca">
      <h3 class="mod-cabeca__nome">${m.nome}</h3>
      <p class="mod-cabeca__n">${noticias.filter(n => n.data.getTime() > semana).length} notícias nos últimos 7 dias · ${noticias.length} no arquivo</p>
    </header>
    <div class="mod-jogos">
      ${cartaoJogo('Próximo jogo', proximo)}
      ${cartaoJogo('Último resultado', ultimo)}
      ${m.id === 'futebol' && TABELA.length ? `<div class="mod-tabela"><p class="mod-jogo__rotulo">Classificação</p><div id="mod-tabela-casa"></div></div>` : ''}
    </div>
    <section class="mod-noticias" aria-label="Notícias de ${m.nome}">
      ${!NOTICIAS.length
        ? Componentes.esqueletoEditorial()
        : destaques.length
          ? composicaoEditorial(destaques)
          : `<div class="estado"><p class="estado__titulo">Sem notícias de ${m.nome.toLowerCase()}</p>
             <p class="estado__texto">Os jornais que acompanhamos ainda não publicaram nada desta equipa no período guardado. Volta mais tarde — o arquivo vai crescendo.</p></div>`}
    </section>`;

  painel.querySelectorAll('.mod-jogo[data-jogo-data]').forEach(b => b.addEventListener('click', () => {
    const j = JOGOS.find(x => x.data === b.dataset.jogoData);
    if(j) verJogo(j);
  }));
  const mini = $('#mod-tabela-casa');
  if(mini){
    const nos = TABELA.find(t => eSporting(t.equipa));
    const linhas = [...TABELA.slice(0, 4), ...(nos && TABELA.indexOf(nos) > 3 ? [nos] : [])];
    mini.innerHTML = `<table class="classif"><caption class="so-leitor">Liga Portugal</caption><tbody>${linhas.map(t => `
      <tr class="${eSporting(t.equipa) ? 'eu' : ''}"><td class="classif__pos">${t.pos}</td>
      <td><span class="eq"><img src="${emblemaEquipa(t.equipa)}" alt="" width="20" height="20" loading="lazy">${t.equipa}</span></td>
      <td class="classif__pts">${t.p}</td></tr>`).join('')}</tbody></table>`;
  }
}

addEventListener('hashchange', () => { if(vistaAtual === 'modalidades') pintarModalidades(); });

/* voltar e avançar do browser */
addEventListener('popstate', () => irPara(vistaDaRota(location.pathname), { historico:false }));

/* ---------------------------------------------------------------------
   SUBMENUS (ecrãs largos). Abrem com clique ou com o rato por cima,
   fecham com Esc, com um clique fora ou ao escolher uma vista.
   --------------------------------------------------------------------- */
function fecharSubmenus(exceto){
  $$('.menu__grupo').forEach(g => {
    if(g === exceto) return;
    g.classList.remove('aberto');
    g.querySelector('.menu__pai')?.setAttribute('aria-expanded', 'false');
  });
}

function ligarSubmenus(){
  const largo = () => matchMedia('(min-width: 901px)').matches;
  $$('.menu__grupo').forEach(g => {
    const pai = g.querySelector('.menu__pai');
    const abrir = () => { fecharSubmenus(g); g.classList.add('aberto'); pai.setAttribute('aria-expanded', 'true'); };
    pai.addEventListener('click', () => {
      if(!largo()) return;                         // na gaveta os grupos estão sempre abertos
      g.classList.contains('aberto') ? fecharSubmenus() : abrir();
    });
    pai.addEventListener('keydown', e => {
      if(e.key === 'ArrowDown' && largo()){ e.preventDefault(); abrir(); g.querySelector('.menu__item')?.focus(); }
    });
    let espera = null;
    g.addEventListener('mouseenter', () => { if(largo() && matchMedia('(hover: hover)').matches){ clearTimeout(espera); abrir(); } });
    g.addEventListener('mouseleave', () => { if(largo()){ espera = setTimeout(() => fecharSubmenus(), 160); } });
    /* setas dentro do submenu */
    g.querySelector('.menu__sub')?.addEventListener('keydown', e => {
      const itens = [...g.querySelectorAll('.menu__item:not([hidden])')];
      const i = itens.indexOf(document.activeElement);
      if(e.key === 'ArrowDown'){ e.preventDefault(); itens[(i + 1) % itens.length]?.focus(); }
      if(e.key === 'ArrowUp'){ e.preventDefault(); itens[(i - 1 + itens.length) % itens.length]?.focus(); }
    });
  });
  document.addEventListener('click', e => { if(!e.target.closest('.menu__grupo')) fecharSubmenus(); });
  addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    const aberto = $('.menu__grupo.aberto');
    if(aberto){ fecharSubmenus(); aberto.querySelector('.menu__pai').focus(); }
  });
}

/* ---------------------------------------------------------------------
   BARRA INFERIOR (telemóvel). O "Mais" abre a gaveta com tudo o resto.
   --------------------------------------------------------------------- */
function ligarBarraInferior(){
  const mais = $('#barra-mais');
  mais?.addEventListener('click', () => {
    $('#menu-abrir')?.click();
    mais.setAttribute('aria-expanded', $('#menu').classList.contains('aberto'));
  });
}

/* =========================================================================
   11. ARRANQUE
   ========================================================================= */
async function arranque(){
  montarEmblema();
  /* a nuvem trata das contas, do ranking e do chat; se nao houver ligacao
     o site continua a funcionar com as contas locais */
  await Nuvem.iniciar();
  ligarAcesso();
  ligarLeitor();
  ligarMenuMobile();
  ligarAoTopo();
  ligarHero();
  ligarTrocaProva();
  ligarLegais();
  const elAno = $('#ano'); if(elAno) elAno.textContent = new Date().getFullYear();
  const tacaMenu = $('.menu__taca');
  if(tacaMenu) tacaMenu.innerHTML = tacaSVG('liga', 'currentColor');
  $('#lema').textContent = CONFIG.lema;
  CLUBE.treinador = CONFIG.treinador;

  /* fotos dos jogadores (atualizar_fotos.py) e emblemas (atualizar_emblemas.py) */
  try{
    FOTOS = await (await fetch('dados/plantel.json', {cache:'no-store'})).json();
  }catch(e){ /* segue com avatares desenhados */ }
  try{
    EMBLEMAS = await (await fetch('dados/emblemas.json', {cache:'no-store'})).json();
  }catch(e){ /* segue com as iniciais desenhadas */ }
  try{
    PLANTEL_ZZ = await (await fetch('dados/plantel_zz.json', {cache:'no-store'})).json();
  }catch(e){ /* sem ele, o plantel fica o do Wikipédia */ }

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
  ligarArrastar();
  ligarChat();

  montarFundoEntrada();

  /* skeletons já visíveis enquanto os feeds não respondem */
  pintarHome();
  pintarDiaDeJogo();
  /* a faixa entra e sai sozinha conforme a hora do jogo */
  setInterval(pintarDiaDeJogo, 30000);

  /* mostra já o arquivo guardado, enquanto os feeds respondem */
  if(lerArquivo()) pintarNoticias();
  /* o site já tem o que mostrar: sai o ecrã de carregamento do modo aplicação */
  window.fecharArranque?.();

  sincronizar();
  setInterval(sincronizar, CONFIG.refreshDadosMinutos * 60000);

  carregarNoticias();
  setInterval(carregarNoticias, CONFIG.refreshSegundos * 1000);

  /* ---- eventos ---- */
  /* o dataset é lido no clique: o botão "ao minuto" da barra inferior
     passa a "ao vivo" durante os jogos */
  $$('.menu__item[data-vista], .barra-inferior__item[data-vista]').forEach(b =>
    b.addEventListener('click', () => irPara(b.dataset.vista)));
  ligarSubmenus();
  ligarBarraInferior();
  /* na gaveta do telemóvel o sair faz o mesmo que o do cabeçalho */
  $('#btn-sair-gaveta')?.addEventListener('click', () => $('#btn-sair').click());
  $$('#agenda-filtro .separador').forEach(b => b.addEventListener('click', () => {
    filtroAgenda = b.dataset.filtro;
    pintarAgenda();
  }));
  {
    const inicial = vistaDaRota(location.pathname);
    /* /privacidade e /termos ficam com o seu endereço (o texto abre por cima do início) */
    if(!/^\/(privacidade|termos)\/?$/.test(location.pathname))
      history.replaceState({ vista: inicial }, '', ROTAS[inicial] + location.search + location.hash);
    if(inicial !== 'inicio') irPara(inicial, { historico:false, rolar:false });
    else metaDaVista('inicio');
    dadosEstruturados();
    /* /noticias?q=termo abre já com a pesquisa feita (é o que a SearchAction promete) */
    const q = new URLSearchParams(location.search).get('q');
    if(q){
      procuraTexto = q.trim().slice(0, 80);
      $('#procura').value = procuraTexto;
      $('#procura-caixa')?.classList.add('is-aberta');
      if(vistaAtual !== 'noticias') irPara('noticias', { rolar:false });
    }
  }
  $$('[data-ir]').forEach(b =>
    b.addEventListener('click', () => irPara(b.dataset.ir)));

  $('#minuto-filtro').addEventListener('change', pintarLinhaTempo);
  $$('[data-segmentos-minuto] .segmento').forEach(b => b.addEventListener('click', () => {
    $('#minuto-filtro').value = b.dataset.valor;
    pintarLinhaTempo();      // acende o segmento certo nos dois sítios
  }));
  pintarSeloVivo();
  ligarCabeca();

  $$('#pos-filtro .pilula').forEach(b => b.addEventListener('click', () => {
    filtroPos = b.dataset.pos;
    pintarPlantel();     // trata do is-on e do aria-pressed
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
    Promise.resolve(naNuvem() ? Nuvem.sair() : null)
      .finally(() => { Contas.sair(); location.reload(); });
  });

  addEventListener('keydown', e => {
    if(e.key === 'Escape') caixaProcura.classList.remove('is-aberta');
  });
}

document.addEventListener('DOMContentLoaded', arranque);
})();
