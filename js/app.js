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
  const alvos = [$('#emblema'), $('#emblema-rodape')].filter(Boolean);
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

/* =========================================================================
   1b. ENTRADA — boas-vindas, contas e modo visitante (ver js/entrada.js)
   ========================================================================= */
let UTILIZADOR_ATUAL = null;
const naNuvem = () => Nuvem.ligado;

/* quem entra ou sai: o que depende da conta volta a desenhar-se */
function contaMudou(nome){
  UTILIZADOR_ATUAL = nome;
  carregarFormacaoGuardada();
  pintarComunidade();
  if(vistaAtual === 'chat') pintarChat();
  if(vistaAtual === 'formacao') window.Fantasy?.abrir();
}

/* =========================================================================
   FANTASY E COMUNIDADE na página inicial — números reais do Supabase
   ========================================================================= */
async function pintarComunidade(){
  const corpoF = $('#comu-fantasy-corpo'), corpoC = $('#comu-chat-corpo');
  if(!corpoF || !corpoC) return;
  const seguro = Componentes.seguro;
  const db = Nuvem.cliente;
  const eu = Nuvem.perfil;

  /* ---- Fantasy ---- */
  let jornada = null, minha = null, total = null;
  if(db){
    try{
      const { data } = await db.from('fantasy_jornadas').select('numero, fecho')
        .gt('fecho', new Date().toISOString()).order('fecho').limit(1);
      jornada = data?.[0] || null;
    }catch(e){}
    try{
      const { count } = await db.from('fantasy_perfis').select('perfil_id', { count: 'exact', head: true });
      total = Number.isFinite(count) ? count : null;
    }catch(e){}
    if(eu){
      try{
        const { data } = await db.from('fantasy_classificacao').select('total, posicao, nome_equipa').eq('perfil_id', eu.id).maybeSingle();
        minha = data || null;
      }catch(e){}
    }
  }
  const fecho = jornada ? new Date(jornada.fecho) : null;
  corpoF.innerHTML = `
    ${jornada ? `<p class="comu__linha"><b>Jornada ${jornada.numero}</b> · fecha ${rotuloDia(fecho).toLowerCase()} às ${fecho.toLocaleTimeString('pt-PT', { hour:'2-digit', minute:'2-digit' })}</p>`
              : `<p class="comu__linha">${db ? 'Não há nenhuma jornada aberta neste momento.' : 'Sem ligação ao servidor da Fantasy.'}</p>`}
    <div class="comu__numeros">
      ${minha ? `<span class="comu__numero"><b>${minha.total ?? 0}</b><span>os teus pontos</span></span>
                 ${minha.posicao ? `<span class="comu__numero"><b>${minha.posicao}.º</b><span>na geral</span></span>` : ''}` : ''}
      ${total != null ? `<span class="comu__numero"><b>${total}</b><span>${total === 1 ? 'equipa inscrita' : 'equipas inscritas'}</span></span>` : ''}
    </div>
    <p class="comu__linha">Plantel de 15 jogadores do Sporting, 100 M€ de orçamento, capitão a dobrar e ligas privadas com os amigos. Os pontos são calculados no servidor.</p>
    <div class="comu__acoes">
      <button type="button" class="p1" data-ir="formacao">${eu ? (minha ? 'Gerir a minha equipa' : 'Fazer a minha equipa') : 'Ver a Fantasy'}</button>
      ${eu ? '' : '<button type="button" class="p2" data-auth="criar" data-auth-vista="formacao">Criar conta para jogar</button>'}
    </div>`;

  /* ---- chat ---- */
  if(eu && Nuvem.ligado){
    let msgs = [];
    try{ msgs = (await Nuvem.lerMensagens(3)).slice(-2).reverse(); }catch(e){}
    corpoC.innerHTML = `
      ${msgs.length ? `<ul class="comu__msgs">${msgs.map(m => {
          const nome = m.perfis?.nome_mostrado || m.perfis?.utilizador || m.autor || 'alguém';
          return `<li><b>@${seguro(nome)}</b> ${seguro((m.texto || '📷 fotografia').slice(0, 140))}
            <time datetime="${new Date(m.criado_em).toISOString()}">${Componentes.haQuanto(new Date(m.criado_em))}</time></li>`;
        }).join('')}</ul>` : '<p class="comu__linha">Ainda ninguém escreveu. Começa tu a conversa.</p>'}
      <div class="comu__acoes"><button type="button" class="p1" data-ir="chat">Abrir o chat</button></div>`;
  }else{
    corpoC.innerHTML = `
      <p class="comu__linha">Conversa entre adeptos durante os jogos, com fotografias. As mensagens são só para quem tem conta.</p>
      <div class="comu__acoes">
        <button type="button" class="p1" data-auth="entrar" data-auth-vista="chat">Entrar</button>
        <button type="button" class="p2" data-auth="criar" data-auth-vista="chat">Criar conta</button>
      </div>`;
  }
  /* os data-ir novos precisam de ouvinte */
  $$('#comu-fantasy-corpo [data-ir], #comu-chat-corpo [data-ir]').forEach(b =>
    b.addEventListener('click', () => irPara(b.dataset.ir)));
}

/* a página de boas-vindas mostra o que há lá dentro — só com dados reais */
function pintarPreviaEntrada(){
  if(!window.Entrada || $('#acesso')?.hidden) return;
  const ultimo = JOGOS.filter(jogado).slice(-1)[0] || null;
  Entrada.pintarPrevia({
    jogo: jogosSincronizados || porJogar().length ? (porJogar()[0] || null) : undefined,
    ultimo,
    emblema: emblemaEquipa,
    nomeProva,
    quando: j => {
      const d = new Date(j.data);
      return { hora: horaJogo(j, d), dia: rotuloDia(d) };
    },
    noticias: NOTICIAS.length ? NOTICIAS.slice(0, 3).map(n => ({ titulo: n.titulo, sigla: Componentes.sigla(n), classe: Componentes.classeFonte(n) })) : undefined
  });
}

/* a jornada da Fantasy que está aberta (pública: fantasy_jornadas tem leitura para todos) */
async function previaFantasy(){
  if(!window.Entrada || $('#acesso')?.hidden) return;
  let j = null;
  try{
    const db = Nuvem.cliente;
    if(db){
      const { data } = await db.from('fantasy_jornadas').select('numero, fecho')
        .gt('fecho', new Date().toISOString()).order('fecho').limit(1);
      j = data?.[0] || null;
    }
  }catch(e){}
  Entrada.pintarPrevia({ fantasy: j ? { numero: j.numero,
    texto: 'fecha ' + rotuloDia(new Date(j.fecho)).toLowerCase() + ' às ' +
      new Date(j.fecho).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) } : null });
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
  pintarPreviaEntrada();
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
  /* as notícias do jogo, no Centro de jogo, acompanham as leituras */
  if(vistaAtual === 'aovivo') CentroJogo.repintar();
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
  if(situacaoFoco && chaveDoJogo(j) === chaveDoJogo(jogoEmFoco)){
    const r = CentroJogo.rotulo(situacaoFoco);
    if(r.aoVivo) return { texto: r.texto, classe:'vivo' };
  }
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
  irPara('aovivo', { jogo: j });
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
  const feitos = JOGOS.filter(jogado).slice(-4).reverse();      // 2 × 2 ao lado do próximo jogo
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

  /* página inicial: os jogos oficiais já jogados (os particulares ficam de fora) */
  const todosFeitos = JOGOS.filter(jogado).filter(j => provaDoJogo(j) !== 'Pré-época');
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

  pintarEstatisticasEpoca();
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

/* =========================================================================
   ESTATÍSTICAS DA ÉPOCA — jogo a jogo, em casa e fora, por competição
   Tudo calculado a partir dos RESULTADOS do calendário (Wikipédia): são
   contas sobre resultados reais, não estatísticas de jogo inventadas.
   ========================================================================= */
function balancoDe(jogos){
  const b = { j: 0, v: 0, e: 0, d: 0, gm: 0, gs: 0 };
  jogos.forEach(j => {
    const r = resultadoSCP(j);
    if(!r) return;
    b.j++; b.gm += r.nos; b.gs += r.deles;
    b[{ V: 'v', E: 'e', D: 'd' }[r.r]]++;
  });
  return b;
}

function linhaBalanco(rotulo, b){
  const dg = b.gm - b.gs;
  return `<tr><th scope="row">${rotulo}</th><td>${b.j}</td><td>${b.v}</td><td>${b.e}</td><td>${b.d}</td>
    <td>${b.gm}</td><td>${b.gs}</td><td>${dg > 0 ? '+' : ''}${dg}</td>
    <td>${b.j ? (b.gm / b.j).toFixed(1).replace('.', ',') : '—'}</td></tr>`;
}
const CABECA_BALANCO = `<thead><tr><th scope="col"></th><th scope="col" title="Jogos">J</th><th scope="col" title="Vitórias">V</th>
  <th scope="col" title="Empates">E</th><th scope="col" title="Derrotas">D</th><th scope="col" title="Golos marcados">GM</th>
  <th scope="col" title="Golos sofridos">GS</th><th scope="col" title="Diferença de golos">DG</th><th scope="col" title="Golos marcados por jogo">GM/J</th></tr></thead>`;

function pintarEstatisticasEpoca(){
  const oficiais = JOGOS.filter(jogado).filter(j => provaDoJogo(j) !== 'Pré-época')
    .sort((a, b) => new Date(a.data) - new Date(b.data));
  const forma = $('#est-forma');
  if(!forma) return;
  if(!oficiais.length){
    const msg = jogosSincronizados ? 'Ainda não há jogos oficiais com resultado nesta época.' : 'A ler o calendário…';
    forma.innerHTML = `<li class="vazio">${msg}</li>`;
    $('#est-casa-fora').innerHTML = $('#est-provas').innerHTML = `<p class="vazio">${msg}</p>`;
    return;
  }
  const NOME = { V: 'Vitória', E: 'Empate', D: 'Derrota' };
  forma.innerHTML = oficiais.slice(-10).reverse().map(j => {
    const r = resultadoSCP(j);
    const casa = eSporting(j.casa);
    const adv = casa ? j.fora : j.casa;
    return `<li><button type="button" class="est-jogo est-jogo--${r.r}" data-jogo-data="${j.data}">
      <span class="est-jogo__r" aria-label="${NOME[r.r]}">${r.r}</span>
      <span class="est-jogo__adv"><img src="${emblemaEquipa(adv)}" alt="" width="22" height="22" loading="lazy">
        <b>${Componentes.seguro(adv)}</b><small>${casa ? 'em casa' : 'fora'} · ${Componentes.seguro(nomeProva(j.comp).completo)}</small></span>
      <span class="est-jogo__res">${r.nos}–${r.deles}</span>
      <time datetime="${new Date(j.data).toISOString()}">${diaMes(new Date(j.data))}</time>
    </button></li>`;
  }).join('');
  forma.querySelectorAll('[data-jogo-data]').forEach(b => b.addEventListener('click', () => {
    const j = JOGOS.find(x => x.data === b.dataset.jogoData);
    if(j) verJogo(j);
  }));

  const emCasa = oficiais.filter(j => eSporting(j.casa));
  const fora = oficiais.filter(j => !eSporting(j.casa));
  $('#est-casa-fora').innerHTML = `<table class="tabela est-tabela"><caption class="so-leitor">Em casa e fora</caption>${CABECA_BALANCO}<tbody>
    ${linhaBalanco('Em casa', balancoDe(emCasa))}${linhaBalanco('Fora', balancoDe(fora))}${linhaBalanco('<b>Total</b>', balancoDe(oficiais))}</tbody></table>`;

  const provas = [...new Set(oficiais.map(provaDoJogo))];
  $('#est-provas').innerHTML = `<table class="tabela est-tabela"><caption class="so-leitor">Por competição</caption>${CABECA_BALANCO}<tbody>
    ${provas.map(p => linhaBalanco(Componentes.seguro(p), balancoDe(oficiais.filter(j => provaDoJogo(j) === p)))).join('')}</tbody></table>`;

  pintarIndividuais(oficiais.length);
}

/* estatísticas individuais por jogo: só as que estão na base de dados
   (sincronização com uma fonte ou introdução manual na Gestão da Fantasy) */
let individuaisLidos = null;
async function pintarIndividuais(jogosOficiais){
  const alvo = $('#est-individuais');
  if(!alvo) return;
  const db = Nuvem.cliente;
  if(!db){ alvo.innerHTML = '<p class="vazio">Sem ligação à base de dados.</p>'; return; }
  if(!individuaisLidos){
    alvo.innerHTML = Componentes.esqueletoCompacto(3);
    try{
      const [{ data: linhas }, { data: jogadores }] = await Promise.all([
        db.from('desporto_estatisticas_jogo').select('jogo_id, jogador_id, minutos, golos, assistencias, amarelos, vermelhos, defesas, fonte'),
        db.from('desporto_jogadores').select('id, nome, nome_curto, posicao')
      ]);
      individuaisLidos = { linhas: linhas || [], jogadores: new Map((jogadores || []).map(j => [j.id, j])) };
    }catch(e){
      alvo.innerHTML = '<p class="vazio">Não foi possível ler as estatísticas individuais. Tenta mais tarde.</p>';
      return;
    }
  }
  const { linhas, jogadores } = individuaisLidos;
  if(!linhas.length){
    $('#est-ind-nota').textContent = 'sem dados';
    alvo.innerHTML = `<p class="vazio">Ainda não há estatísticas individuais por jogo nesta época (0 de ${jogosOficiais} jogos oficiais).
      Entram aqui quando uma fonte de dados estiver ligada ou quando forem introduzidas a partir do relatório oficial do jogo.
      As presenças e os golos da tabela de cima vêm do Wikipédia.</p>`;
    return;
  }
  const porJogador = new Map();
  const soma = (a, b) => b == null ? a : (a ?? 0) + b;     // NULL = sem dados, não 0
  linhas.forEach(l => {
    const t = porJogador.get(l.jogador_id) || { jogos: 0, minutos: null, golos: null, assistencias: null, amarelos: null, vermelhos: null, defesas: null };
    t.jogos++;
    ['minutos', 'golos', 'assistencias', 'amarelos', 'vermelhos', 'defesas'].forEach(k => { t[k] = soma(t[k], l[k]); });
    porJogador.set(l.jogador_id, t);
  });
  const nJogos = new Set(linhas.map(l => l.jogo_id)).size;
  const fontes = [...new Set(linhas.map(l => l.fonte).filter(Boolean))].join(', ') || 'não indicada';
  $('#est-ind-nota').textContent = `${nJogos} de ${jogosOficiais} jogos oficiais com dados`;
  const lista = [...porJogador.entries()].map(([id, t]) => ({ ...t, j: jogadores.get(id) }))
    .sort((a, b) => (b.minutos ?? -1) - (a.minutos ?? -1));
  const v = x => x == null ? '—' : x;
  alvo.innerHTML = `<div class="est-tabela-rolo"><table class="tabela est-tabela">
    <caption class="so-leitor">Estatísticas individuais nos jogos com dados</caption>
    <thead><tr><th scope="col">Jogador</th><th scope="col">Jogos</th><th scope="col">Min</th><th scope="col">Golos</th>
      <th scope="col">Assist.</th><th scope="col">Amarelos</th><th scope="col">Verm.</th><th scope="col">Defesas</th></tr></thead>
    <tbody>${lista.map(x => `<tr><th scope="row">${Componentes.seguro(x.j?.nome_curto || x.j?.nome || '—')} <small>${x.j?.posicao || ''}</small></th>
      <td>${x.jogos}</td><td>${v(x.minutos)}</td><td>${v(x.golos)}</td><td>${v(x.assistencias)}</td><td>${v(x.amarelos)}</td><td>${v(x.vermelhos)}</td><td>${v(x.defesas)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="est-nota">Só os ${nJogos} jogos com estatísticas individuais na base de dados (fonte: ${Componentes.seguro(fontes)}). «—» = sem dados.</p>`;
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
let capitaoIdx = -1;           // posição do capitão (só para mostrar o (C))
let plantelReal = false;       // o plantel a sério (Wikipédia/zerozero) já chegou
let formacaoCarregada = false;

/* A chave separa as contas: com sessão no Supabase usa-se o id da conta
   (nunca o nome mostrado, que pode repetir-se em maiúsculas/minúsculas). */
const chaveFormacao = () => 'scp-formacao-' + (Nuvem.perfil?.id
  || (UTILIZADOR_ATUAL ? Contas.idDe(UTILIZADOR_ATUAL) : 'convidado'));

/* =========================================================================
   QUE JOGADOR SERVE EM CADA POSIÇÃO
   O primeiro grupo é o natural (aparece primeiro na escolha); os outros
   são as adaptações habituais — um médio a ala, um avançado a extremo.
   Um defesa a ponta de lança ou um guarda-redes fora da baliza não entram.
   ========================================================================= */
const COMPATIVEIS = {
  GR: ['GR'], DC: ['DEF'], LE: ['DEF'], LD: ['DEF'], ALA: ['DEF', 'MED'],
  MDC: ['MED', 'DEF'], MC: ['MED'], MO: ['MED', 'AVA'], EXT: ['AVA', 'MED'], PL: ['AVA']
};
const gruposDoPapel = papel => COMPATIVEIS[papel] || [PAPEL_GRUPO[papel]].filter(Boolean);
const grupoDoPapel = papel => gruposDoPapel(papel)[0] || 'MED';
const serve = (p, slot) => !!p && !!slot && gruposDoPapel(slot.papel).includes(p.posGrupo);
const NOME_GRUPO = { GR: 'guarda-redes', DEF: 'defesa', MED: 'médio', AVA: 'avançado' };

/* nomes guardados de jogadores que já saíram do plantel (ou escritos de
   outra forma) passam ao nome do plantel atual, ou a vaga; repetidos saem */
function normalizarOnze(){
  if(!plantelReal) return;
  const vistos = new Set();
  meuOnze = meuOnze.map(n => {
    const p = n ? acharJogador(n) : null;
    if(!p || vistos.has(p.nome)) return null;
    vistos.add(p.nome);
    return p.nome;
  });
}
const noOnze = () => meuOnze.filter(n => n && acharJogador(n));

/* o quadro tático é o onze ideal de cada um: não conta para a Fantasy
   (que tem as suas regras no servidor), por isso mexe-se à vontade */
const equipaTrancada = () => false;
function podeMexer(){ return { pode: true }; }
function gastarSubstituicao(){}

function guardarFormacao(){
  const equipa = { desenho: desenhoAtual, onze: meuOnze, capitao: capitaoIdx, atualizado: Date.now() };

  /* cópia local: serve de rascunho e faz o site abrir depressa */
  try{ localStorage.setItem(chaveFormacao(), JSON.stringify(equipa)); }catch(e){}

  /* e na conta, para ser a mesma em qualquer aparelho. Espera-se um pouco
     para não mandar um pedido por cada clique. */
  if(naNuvem() && Nuvem.perfil){
    const dono = Nuvem.perfil.id;
    clearTimeout(guardarFormacao._espera);
    guardarFormacao._espera = setTimeout(async () => {
      if(Nuvem.perfil?.id !== dono) return;          // entretanto mudou de conta
      const r = await Nuvem.guardarEquipa({ ...equipa, trancada: false, pontos: 0, jogadores: noOnze().length });
      if(r?.erro) avisarSubstituicoes('Não foi possível guardar o onze na tua conta (ficou guardado neste aparelho).');
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
  let local = null, nuvem = null;
  try{ local = JSON.parse(localStorage.getItem(chaveFormacao()) || 'null'); }catch(e){}
  if(naNuvem() && Nuvem.perfil){
    try{ nuvem = await Nuvem.lerEquipa(); }catch(e){}
  }
  /* as duas cópias podem divergir (mexeste sem rede, ou noutro aparelho):
     fica a mais recente; se a local for mais nova, sobe para a conta */
  const quando = g => g ? (Number(g.atualizado) || Date.parse(g.atualizado) || 0) : -1;
  const guardada = quando(local) > quando(nuvem) ? local : (nuvem || local);
  const subir = !!(nuvem || Nuvem.perfil) && guardada === local && local && quando(local) > quando(nuvem);

  if(guardada && FORMACOES[guardada.desenho]){
    desenhoAtual = guardada.desenho;
    meuOnze = FORMACOES[desenhoAtual].map((_, i) => guardada.onze?.[i] ?? null);
    capitaoIdx = Number.isInteger(guardada.capitao) ? guardada.capitao : -1;
  }else{
    /* primeira vez: arranca com a sugestão de data.js */
    desenhoAtual = FORMACOES[FORMACAO.desenho] ? FORMACAO.desenho : Object.keys(FORMACOES)[0];
    meuOnze = FORMACOES[desenhoAtual].map((slot, i) => FORMACAO.titulares[i]?.nome ?? null);
    capitaoIdx = -1;
  }
  formacaoCarregada = true;
  normalizarOnze();
  pintarFormacao();
  if(subir) guardarFormacao();
}

/* o plantel a sério chegou: os nomes guardados passam aos do plantel */
function plantelChegou(){
  plantelReal = true;
  if(!formacaoCarregada) carregarFormacaoGuardada();
  else { normalizarOnze(); pintarFormacao(); }
}

/* muda de desenho tentando manter quem já lá está: primeiro no mesmo
   papel, depois numa posição onde sirva; quem não couber é dito */
function mudarDesenho(novo){
  if(!FORMACOES[novo]) return;
  const antigos = meuOnze.slice();
  const antesSlots = FORMACOES[desenhoAtual];
  desenhoAtual = novo;
  const slots = FORMACOES[novo];

  const usados = new Set();
  meuOnze = slots.map(slot => {
    const i = antesSlots.findIndex((s, k) => s.papel === slot.papel && antigos[k] && !usados.has(k));
    if(i >= 0){ usados.add(i); return antigos[i]; }
    return null;
  });
  /* quem sobrou: primeiro onde é o grupo natural, depois onde sirva */
  let sobra = antigos.filter((n, k) => n && !usados.has(k));
  for(const natural of [true, false]){
    slots.forEach((slot, i) => {
      if(meuOnze[i]) return;
      const j = sobra.findIndex(n => {
        const p = acharJogador(n);
        return p && (natural ? p.posGrupo === grupoDoPapel(slot.papel) : serve(p, slot));
      });
      if(j >= 0) meuOnze[i] = sobra.splice(j, 1)[0];
    });
  }
  capitaoIdx = -1;
  guardarFormacao();
  pintarFormacao();
  const fora = sobra.filter(n => acharJogador(n));
  if(fora.length) avisarSubstituicoes(`No ${novo} não há lugar para ${fora.map(nomeCurto).join(', ')} — ${fora.length > 1 ? 'ficaram' : 'ficou'} no plantel.`);
}

/* preenche as vagas com quem estiver livre e sirva para a posição */
function preencherAuto(){
  if(!plantelReal) return;
  normalizarOnze();
  const slots = FORMACOES[desenhoAtual];
  for(const natural of [true, false]){
    slots.forEach((slot, i) => {
      if(meuOnze[i]) return;
      const livre = PLANTEL.filter(p => !meuOnze.includes(p.nome));
      const c = natural ? livre.find(p => p.posGrupo === grupoDoPapel(slot.papel)) : livre.find(p => serve(p, slot));
      if(c) meuOnze[i] = c.nome;
    });
  }
  guardarFormacao();
  pintarFormacao();
  const vagas = slots.filter((s, i) => !meuOnze[i]).map(s => s.papel);
  if(vagas.length) avisarSubstituicoes(`Não há mais jogadores no plantel para: ${[...new Set(vagas)].join(', ')}.`);
}

function limparOnze(){
  meuOnze = meuOnze.map(() => null);
  capitaoIdx = -1;
  guardarFormacao();
  pintarFormacao();
}

/* ---------- desenhar ---------- */
const etiquetaPapel = (papel, grupo) =>
  `<span class="papel papel--${grupo}">${papel}</span>`;

function pintarFormacao(){
  const alvo = $('#campo');
  if(!alvo) return;

  const slots = FORMACOES[desenhoAtual] || [];
  if(meuOnze.length !== slots.length)
    meuOnze = slots.map((_, i) => meuOnze[i] ?? null);

  /* selector de desenho */
  const sel = $('#escolher-formacao');
  if(sel && sel.options.length !== Object.keys(FORMACOES).length){
    sel.innerHTML = Object.keys(FORMACOES).map(d => `<option value="${d}">${d}</option>`).join('');
  }
  if(sel) sel.value = desenhoAtual;
  $('#formacao-auto') && ($('#formacao-auto').disabled = !plantelReal);
  $('#formacao-limpar') && ($('#formacao-limpar').disabled = !noOnze().length);

  /* o contador só conta quem existe mesmo no plantel */
  const escolhidos = noOnze().length;
  $('#onze-conta').textContent = `${escolhidos}/11`;

  const aviso = $('#formacao-aviso');
  if(aviso && !aviso.classList.contains('formacao__aviso--alerta')){
    aviso.innerHTML = 'O teu onze ideal — <b>não conta para a Fantasy</b>. Toca numa posição para escolher '
      + 'quem joga lá, ou arrasta para trocar. Cada posição só aceita quem serve para ela. Fica guardado na tua conta.';
  }

  /* campo (4:5, como a escalação de um jogo de futebol) */
  alvo.innerHTML = `
    <div class="campo__relva"></div>
    <svg class="campo__linhas" viewBox="0 0 100 125" preserveAspectRatio="none" aria-hidden="true">
      <g fill="none" stroke="#fff" stroke-width="0.6" opacity=".7">
        <rect x="3" y="3" width="94" height="119"/>
        <line x1="3" y1="62.5" x2="97" y2="62.5"/>
        <circle cx="50" cy="62.5" r="10"/>
        <rect x="22" y="3" width="56" height="17"/><rect x="37" y="3" width="26" height="6"/>
        <path d="M41 20 a10 10 0 0 0 18 0"/>
        <rect x="22" y="105" width="56" height="17"/><rect x="37" y="116" width="26" height="6"/>
        <path d="M41 105 a10 10 0 0 1 18 0"/>
      </g>
      <circle cx="50" cy="62.5" r=".8" fill="#fff" opacity=".7"/>
    </svg>
    ${slots.map((slot, i) => {
      const nome = meuOnze[i];
      const p = nome ? acharJogador(nome) : null;
      const g = grupoDoPapel(slot.papel);
      /* nas alas o nome não sai do campo */
      const pos = `left:${Math.min(86, Math.max(14, slot.x))}%; top:${slot.y}%; animation-delay:${i * .03}s`;
      if(!p){
        return `<button type="button" class="posicao posicao--vazia" data-i="${i}" style="${pos}"
                     aria-label="Escolher ${NOME_GRUPO[g]} para ${slot.papel}">
          <span class="posicao__nome" aria-hidden="true">+</span>${etiquetaPapel(slot.papel, g)}</button>`;
      }
      const fora = !serve(p, slot);
      return `<button type="button" class="posicao ${fora ? 'posicao--fora' : ''}" data-i="${i}" style="${pos}" title="${p.nome}"
                   aria-label="${p.nome}, ${slot.papel}${fora ? ', fora de posição' : ''}${capitaoIdx === i ? ', capitão' : ''} — toca para trocar">
        <span class="posicao__nome">${nomeCurto(p.nome)}${capitaoIdx === i ? ' <i>(C)</i>' : ''}</span>${etiquetaPapel(slot.papel, g)}</button>`;
    }).join('')}
    <span class="campo__desenho" aria-hidden="true">${desenhoAtual}</span>
    ${plantelReal ? '' : '<p class="campo__espera" role="status">A carregar o plantel…</p>'}`;

  /* listas à direita: a escalação e o resto do plantel */
  $('#lista-titulares').innerHTML = slots.map((slot, i) => {
    const p = meuOnze[i] ? acharJogador(meuOnze[i]) : null;
    const fora = p && !serve(p, slot);
    return `<li class="${p ? '' : 'onze--vazio'}" data-i="${i}" tabindex="0" role="button"
                aria-label="${slot.papel}: ${p ? p.nome : 'por escolher'}${fora ? ' (fora de posição)' : ''}">
      ${etiquetaPapel(slot.papel, grupoDoPapel(slot.papel))}
      <span class="onze__nome">${p ? (ALCUNHAS[p.nome] || p.nome) : 'por escolher'}</span>
      ${fora ? '<span class="onze__aviso">fora de posição</span>' : ''}
    </li>`;
  }).join('');

  $$('#lista-titulares li').forEach(li => {
    li.addEventListener('click', () => abrirEscolha(+li.dataset.i));
    li.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); abrirEscolha(+li.dataset.i); } });
  });

  const naoJogam = PLANTEL.filter(p => !meuOnze.includes(p.nome))
    .sort((a, b) => ['GR', 'DEF', 'MED', 'AVA'].indexOf(a.posGrupo) - ['GR', 'DEF', 'MED', 'AVA'].indexOf(b.posGrupo));
  $('#lista-suplentes').innerHTML = !plantelReal
    ? '<li class="onze--vazio"><span class="onze__nome">a carregar o plantel…</span></li>'
    : naoJogam.map(p => `
    <li data-nome="${p.nome}">
      ${etiquetaPapel(p.posGrupo, p.posGrupo)}
      <span class="onze__nome">${ALCUNHAS[p.nome] || p.nome}</span>
    </li>`).join('') || '<li class="onze--vazio"><span class="onze__nome">ninguém de fora</span></li>';

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
          `<span class="posicao__nome">${nomeCurto(nomeArrastado)}</span>${etiquetaPapel(p?.posGrupo || '', p?.posGrupo || 'MED')}`;
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
      const p = acharJogador(vindoDaLista), slot = FORMACOES[desenhoAtual][para];
      if(!serve(p, slot)){ avisarSubstituicoes(`${nomeCurto(vindoDaLista)} é ${NOME_GRUPO[p?.posGrupo] || 'jogador'}: não joga a ${slot.papel}.`); return; }
      meuOnze[para] = p.nome;
      if(capitaoIdx === para) capitaoIdx = -1;
      guardarFormacao();
      pintarFormacao();
      return;
    }

    /* ---- troca entre duas posições do campo ---- */
    if(para === de) return;

    /* a troca só se faz se cada um servir na posição do outro */
    const slotsAgora = FORMACOES[desenhoAtual];
    const pDe = meuOnze[de] && acharJogador(meuOnze[de]), pPara = meuOnze[para] && acharJogador(meuOnze[para]);
    if(pDe && !serve(pDe, slotsAgora[para])){ avisarSubstituicoes(`${nomeCurto(pDe.nome)} não joga a ${slotsAgora[para].papel}.`); return; }
    if(pPara && !serve(pPara, slotsAgora[de])){ avisarSubstituicoes(`${nomeCurto(pPara.nome)} não joga a ${slotsAgora[de].papel}.`); return; }

    [meuOnze[de], meuOnze[para]] = [meuOnze[para], meuOnze[de]];
    if(capitaoIdx === de) capitaoIdx = para;
    else if(capitaoIdx === para) capitaoIdx = de;

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
  const grupos = gruposDoPapel(slot.papel);
  const q = semAcentos(procura);

  /* só quem serve para a posição; primeiro o grupo natural */
  const ordenado = PLANTEL.filter(p => grupos.includes(p.posGrupo))
    .sort((a, b) => grupos.indexOf(a.posGrupo) - grupos.indexOf(b.posGrupo) || (a.n ?? 999) - (b.n ?? 999))
    .filter(p => !q || semAcentos(p.nome + ' ' + (ALCUNHAS[p.nome] || '') + ' ' + p.pos).includes(q));

  $('#escolha-nota').textContent = (meuOnze[posicaoAberta] ? 'está lá ' + nomeCurto(meuOnze[posicaoAberta]) + ' · ' : '')
    + 'servem: ' + grupos.map(g => NOME_GRUPO[g] + 's').join(' e ');

  $('#escolha-lista').innerHTML = !plantelReal ? '<div class="vazio">O plantel ainda está a carregar.</div>'
    : ordenado.map(p => {
    const onde = meuOnze.indexOf(p.nome);
    const jaJoga = onde >= 0 && onde !== posicaoAberta;
    const natural = p.posGrupo === grupos[0];
    return `<button type="button" class="cand ${natural ? 'cand--certo' : ''}" data-nome="${p.nome}">
      <img src="${p.foto}" alt="" loading="lazy" width="40" height="40"
           onerror="this.onerror=null;this.src='${avatarJogador(p)}'">
      <span class="cand__txt">
        <b>${ALCUNHAS[p.nome] || p.nome}</b>
        <span>${etiquetaPapel(p.posGrupo, p.posGrupo)} ${p.nac || ''}${natural ? '' : ' · adaptado'}</span>
      </span>
      <span class="cand__n">${p.n ?? '–'}</span>
      ${jaJoga ? `<span class="cand__aviso">já joga a ${FORMACOES[desenhoAtual][onde].papel} — trocam</span>` : ''}
    </button>`;
  }).join('') || `<div class="vazio">${q ? 'Ninguém com esse nome que sirva para ' + slot.papel + '.' : 'Ninguém no plantel serve para ' + slot.papel + '.'}</div>`;

  $$('#escolha-lista .cand').forEach(b => b.addEventListener('click', () => {
    const nome = b.dataset.nome;
    const onde = meuOnze.indexOf(nome);
    const slots = FORMACOES[desenhoAtual];
    /* já estava noutra posição: trocam, se o outro servir lá */
    if(onde >= 0 && onde !== posicaoAberta){
      const outro = meuOnze[posicaoAberta] && acharJogador(meuOnze[posicaoAberta]);
      if(outro && !serve(outro, slots[onde])){
        avisarSubstituicoes(`${nomeCurto(outro.nome)} não joga a ${slots[onde].papel}: tira-o primeiro.`);
        $('#escolha').close();
        return;
      }
      meuOnze[onde] = meuOnze[posicaoAberta];
    }
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
    if(capitaoIdx === posicaoAberta) capitaoIdx = -1;
    guardarFormacao();
    pintarFormacao();
    dlg.close();
  });
  /* clicar fora fecha */
  dlg.addEventListener('click', e => { if(e.target === dlg) dlg.close(); });

  $('#escolher-formacao').addEventListener('change', e => mudarDesenho(e.target.value));
  $('#formacao-auto').addEventListener('click', preencherAuto);
  $('#formacao-limpar').addEventListener('click', limparOnze);
}
/* =========================================================================
   7c-bis. DIA DE JOGO — faixa do topo e Centro de jogo (ver js/centro.js)
   -------------------------------------------------------------------------
   O jogo "em foco" é o que, segundo o calendário, está entre 3 h antes e
   4 h depois do início; fora disso, o próximo. A faixa e a página inicial
   ouvem o CentroJogo: o minuto e o "Em direto" só aparecem se uma fonte os
   der — aqui não há relógio a estimar o minuto. Antes do início há uma
   contagem decrescente, que é só isso: o tempo até à hora marcada.
   ========================================================================= */
const H_MS = 3600000;
let jogoEmFoco = null;        // o jogo da faixa e da página inicial
let situacaoFoco = null;      // o que o CentroJogo sabe dele
let largarFoco = null;
let jogoVisto = null;         // o jogo aberto no Centro de jogo
const chaveDoJogo = j => j ? `${j.data}|${j.casa}|${j.fora}` : '';

function escolherJogoEmFoco(){
  const agora = Date.now();
  const perto = JOGOS.filter(j => j.data && !j.modalidade)
    .map(j => ({ j, t: new Date(j.data).getTime() - agora }))
    .filter(x => x.t < 3 * H_MS && x.t > -4 * H_MS)
    .sort((a, b) => a.t - b.t)[0];
  return perto ? perto.j : (porJogar()[0] || null);
}

function seguirJogoEmFoco(){
  const j = escolherJogoEmFoco();
  if(j && chaveDoJogo(j) === chaveDoJogo(jogoEmFoco)){
    jogoEmFoco = j;
    if(situacaoFoco) situacaoFoco = { ...situacaoFoco, falta: new Date(j.data) - Date.now() };
    pintarFaixa(situacaoFoco);
    return;
  }
  largarFoco?.();
  jogoEmFoco = j; situacaoFoco = null; largarFoco = null;
  if(!j){ pintarFaixa(null); pintarJogoAgora(null); return; }
  if(vistaAtual === 'aovivo' && !jogoVisto) CentroJogo.abrir(j);
  largarFoco = CentroJogo.observar(j, sit => {
    situacaoFoco = sit;
    pintarFaixa(sit);
    pintarJogoAgora(sit);
    pintarProximoJogo();
  });
}

/* durante o jogo, o "Ao minuto" da barra de baixo passa a levar ao jogo */
function marcarBarraVivo(jogo, aoVivo){
  const b = $('#barra-vivo');
  if(!b) return;
  b.classList.toggle('a-jogar', !!aoVivo);
  b.dataset.vista = jogo ? 'aovivo' : 'aominuto';
  $('#barra-vivo-rotulo').textContent = aoVivo ? 'Ao vivo' : jogo ? 'Jogo' : 'Ao minuto';
}

function pintarFaixa(sit){
  const faixa = $('#faixa-jogo');
  if(!faixa) return;
  const longe = !sit || (sit.falta > CONFIG.antecedenciaJogo * 60000);
  if(longe){
    faixa.hidden = true;
    marcarBarraVivo(false, false);
    document.body.classList.remove('dia-de-jogo', 'a-jogar');
    return;
  }
  const j = sit.jogo;
  const r = CentroJogo.rotulo(sit);
  faixa.hidden = false;
  document.body.classList.add('dia-de-jogo');
  document.body.classList.toggle('a-jogar', !!r.aoVivo);
  faixa.classList.toggle('faixa-jogo--vivo', !!r.aoVivo);
  marcarBarraVivo(true, r.aoVivo);

  $('#faixa-casa').textContent = j.casa;
  $('#faixa-fora').textContent = j.fora;
  $('#faixa-casa-img').src = emblemaEquipa(j.casa);
  $('#faixa-fora-img').src = emblemaEquipa(j.fora);
  const res = sit.resultado && sit.resultado.casa != null ? sit.resultado : null;
  $('#faixa-resultado').textContent = res ? `${res.casa} - ${res.fora}` : 'vs';

  let fase;
  if(sit.tipo === 'agendado' && sit.falta > 0){
    const h = Math.floor(sit.falta / H_MS), m = Math.floor(sit.falta % H_MS / 60000);
    fase = h > 0 ? `FALTAM ${h}H${String(m).padStart(2, '0')}` : `FALTAM ${Math.max(1, m)} MIN`;
  }else{
    fase = r.texto.toUpperCase();
  }
  $('#faixa-fase').textContent = fase;

  /* a última coisa que a fonte registou; sem fonte, a hora prevista */
  const lista = sit.dados?.disponivel ? (sit.dados.eventos?.lista || []) : [];
  const ultimo = lista[lista.length - 1];
  const NOMES = { golo:'Golo', penalti:'Golo (g.p.)', autogolo:'Autogolo', penalti_falhado:'Penálti falhado',
                  amarelo:'Amarelo', segundo_amarelo:'2.º amarelo', vermelho:'Vermelho', substituicao:'Substituição', var:'VAR' };
  let texto = '';
  if(ultimo) texto = `${ultimo.minuto}${ultimo.acrescimo ? '+' + ultimo.acrescimo : ''}' · ${NOMES[ultimo.tipo] || 'Lance'}${
    ultimo.jogador ? ' — ' + ultimo.jogador : ultimo.entrou ? ' — entra ' + ultimo.entrou : ''}`;
  else if(sit.tipo === 'sem_direto') texto = `Início às ${horaJogo(j, new Date(j.data))} · sem dados em direto`;
  else if(sit.tipo === 'terminado') texto = sit.fonte ? `Fonte: ${sit.fonte}` : '';
  else texto = j.local || '';
  $('#faixa-lance').textContent = texto;
  $('#faixa-lance').title = texto;
}

/* o jogo que já começou (ou devia ter começado), no topo da página inicial */
function pintarJogoAgora(sit){
  const alvo = $('#jogo-agora');
  if(!alvo) return;
  if(!sit || sit.falta > 0){ alvo.hidden = true; alvo.innerHTML = ''; return; }
  const j = sit.jogo;
  const r = CentroJogo.rotulo(sit);
  const res = sit.resultado && sit.resultado.casa != null ? sit.resultado : null;
  const prova = nomeProva(j.comp);
  const eq = nome => `<span class="ja__eq ${eSporting(nome) ? 'e-nos' : ''}"><img src="${emblemaEquipa(nome)}" alt="" width="44" height="44"><b>${Componentes.seguro(nome)}</b></span>`;
  const ev = sit.dados?.disponivel ? (sit.dados.eventos?.lista || []) : [];
  const golos = ev.filter(e => ['golo', 'penalti', 'autogolo'].includes(e.tipo));
  alvo.hidden = false;
  alvo.innerHTML = `
    <div class="ja__topo">
      <span class="cj-estado ${r.classe}">${r.aoVivo ? '<i class="cj-pulso" aria-hidden="true"></i>' : ''}${Componentes.seguro(r.texto)}</span>
      <span class="ja__prova">${Componentes.seguro(prova.completo)}</span>
    </div>
    <div class="ja__jogo">${eq(j.casa)}<span class="ja__res">${res ? `${res.casa}<i>–</i>${res.fora}` : horaJogo(j, new Date(j.data))}</span>${eq(j.fora)}</div>
    ${golos.length ? `<p class="ja__golos">${golos.map(g => `${g.minuto}' ${Componentes.seguro(g.jogador || '')}`).join(' · ')}</p>` : ''}
    ${sit.tipo === 'sem_direto' ? '<p class="ja__nota">Dados em direto indisponíveis: nenhuma fonte em direto está ligada. Não mostramos minuto nem resultado estimados.</p>' : ''}
    <div class="ja__base"><p class="ja__fonte">${CentroJogo.linhaFonte(sit)}</p>
    <button type="button" class="botao-cta ja__ir" data-ir-jogo>Centro de jogo ${ICONE_SETA}</button></div>`;
  alvo.querySelector('[data-ir-jogo]').addEventListener('click', () => verJogo(j));
}

/* O onze sai numa notícia perto do jogo. Não se tiram nomes do texto (não
   seria um dado fiável): aponta-se para a notícia, que se lê na fonte. */
const ONZE_OFICIAL = /onze oficial|eis o onze|j[áa] h[áa] onze|onze escolhido|comunicado o onze|equipa inicial|onze do sporting para|escala[çc][ãa]o oficial/i;
function procurarOnzeOficial(j){
  const inicio = new Date(j.data).getTime();
  return NOTICIAS
    .filter(n => CONFIG.filtroOnze.test(n.titulo))
    .filter(n => { const dt = n.data.getTime() - inicio; return dt > -14 * H_MS && dt < 3 * H_MS; })
    .map(n => ({ ...n, oficial: ONZE_OFICIAL.test(n.titulo) || (n.data.getTime() - inicio) > -2.5 * H_MS }))
    .sort((a, b) => (b.oficial - a.oficial) || (b.data - a.data))[0] || null;
}

/* notícias que falam do adversário, à volta da hora do jogo */
function noticiasDoJogo(j, adversario){
  const palavras = chaveNome(adversario).split(' ').filter(p => p.length > 3 && !['clube', 'futebol', 'sporting'].includes(p));
  if(!palavras.length) return [];
  const inicio = new Date(j.data).getTime();
  return NOTICIAS
    .filter(n => { const dt = n.data.getTime() - inicio; return dt > -36 * H_MS && dt < 12 * H_MS; })
    .filter(n => { const t = semAcentos(n.titulo); return palavras.some(p => t.includes(p)); })
    .sort((a, b) => b.data - a.data);
}

/* "SC Braga" e "Braga" são a mesma equipa; "Sporting CP" só é ele próprio */
function mesmaEquipaNome(a, b){
  const limpa = n => chaveNome(APELIDOS_EQUIPA[chaveNome(n)] || n).replace(/\b(sc|fc|cd|sl|gd|cf|ud|sad)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if(eSporting(a) || eSporting(b)) return eSporting(a) && eSporting(b);
  const x = limpa(a), y = limpa(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

let FONTE_TABELA = 'Wikipédia';

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
  /* o chat é dos adeptos com conta: o servidor (RLS) só dá as mensagens a
     quem entrou, por isso aqui nem se pede — mostra-se o convite */
  if(!eu){
    estadoChat('só com conta', '');
    lista.innerHTML = `<li>${Entrada.portao({
      titulo: 'O chat é para quem tem conta',
      texto: 'Entra ou cria uma conta gratuita para leres e escreveres com outros adeptos durante os jogos.',
      vista: 'chat' })}</li>`;
    return;
  }
  estadoChat('ligado como @' + eu.utilizador, 'ok');

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
    const doFD = await FD.classificacao();
    TABELA = doFD || (await Wiki.classificacao());
    FONTE_TABELA = doFD ? 'football-data.org' : 'Wikipédia';
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
      plantelChegou();
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
    pintarJogosTodos(); pintarEstatisticas(); seguirJogoEmFoco();
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
  jogosSincronizados = true; pintarProximoJogo(); pintarCalendario(); pintarPreviaEntrada();
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
    <h4>Sem conta</h4>
    <p>Quem só lê (modo visitante) não deixa nada no servidor. No teu browser
    ficam apenas preferências (tema, filtros) e o arquivo das notícias já
    lidas, para abrir mais depressa.</p>
    <h4>Com conta</h4>
    <p>As contas, o chat e a Fantasy vivem no <b>Supabase</b> (UE, Irlanda). Guarda-se:</p>
    <ul>
      <li>o nome de utilizador e um resumo criptográfico (bcrypt) da palavra-passe —
          a palavra-passe em si nunca é guardada;</li>
      <li>o resumo do código de recuperação, se o gerares (o código só aparece uma vez);</li>
      <li>as mensagens e fotografias que publicas no chat e a tua equipa Fantasy;</li>
      <li>nas tentativas de recuperação de palavra-passe, o endereço IP e a hora,
          durante 30 dias, só para travar tentativas repetidas.</li>
    </ul>
    <p>As contas não têm email: nunca te pedimos nenhum.</p>
    <h4>O que não se faz</h4>
    <p>Não há publicidade, registo de visitas para marketing nem partilha com terceiros.</p>
    <h4>Apagar</h4>
    <p>Podes apagar as tuas mensagens no chat. Para apagar a conta inteira, fala connosco
    (Contacto). Terminar sessão limpa a sessão deste browser.</p>`],

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
    <p>RSS dos jornais (Leonino, Record, Maisfutebol, Notícias ao Minuto, zerozero, RTP,
    Observador, Bola na Rede, Futebol 365, Correio da Manhã, Público) e o sitemap de
    notícias d'A BOLA. Só título, data, resumo curto e ligação — lê-se sempre no jornal.</p>
    <h4>Calendário, resultados, classificação e plantel</h4>
    <p>Wikipédia (CC BY-SA), atualizado algumas horas depois de cada jogo. Os totais da
    época e as comparações entre épocas são contas sobre esses resultados.</p>
    <h4>Jogo em direto e estatísticas da partida</h4>
    <p>Só de uma fonte autorizada, identificada em cada bloco com a hora da última
    atualização. A fonte gratuita é a <b>SportScore</b> (API pública, sem custos, com a
    ligação «Powered by SportScore» onde os dados aparecem): resultado, minuto, golos,
    cartões, substituições, onzes e algumas estatísticas, atualizados a cada minuto. Quando
    não está ligada ou não responde, o centro de jogo mostra a última leitura com a hora dela,
    ou diz «Dados em direto indisponíveis» — nunca estima minutos, lances ou estatísticas.</p>
    <table class="tabela"><thead><tr><th>Fonte</th><th>Direto</th><th>Eventos</th><th>Onzes</th><th>Estatísticas</th></tr></thead><tbody>
      <tr><th>SportScore (grátis)</th><td>sim, ~1 min</td><td>sim</td><td>sim</td><td>algumas da equipa</td></tr>
      <tr><th>API-Football</th><td>sim (pago)</td><td>sim</td><td>sim</td><td>equipa e jogadores</td></tr>
      <tr><th>football-data.org (grátis)</th><td>com atraso</td><td>não</td><td>não</td><td>não</td></tr>
      <tr><th>Wikipédia</th><td>não</td><td>só golos, depois do jogo</td><td>não</td><td>não</td></tr>
    </tbody></table>
    <p>Não usamos o painel de resultados do Google nem endereços privados de outros sites:
    para acompanhar sem fonte ativa, o centro de jogo leva-te para fora.</p>
    <h4>Imagens</h4>
    <p>Fotografia da entrada: «Estádio José Alvalade antes do jogo Sporting - Arouca», de
    Megutim, CC BY 4.0, via Wikimedia Commons. Fotografias de jogadores e emblemas: API-Football.
    Os emblemas pertencem aos clubes; este é um projeto de adeptos, sem ligação oficial.</p>
    <h4>Valores de mercado</h4>
    <p>Transfermarkt, escritos à mão.</p>`]
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
  agenda:'Agenda', classificacao:'Classificação', aovivo:'Centro de jogo', equipa:'Plantel',
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
  aovivo:'Centro de jogo do Sporting CP: resultado, lances, estatísticas, equipas e classificação, com a fonte de cada dado.',
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
  document.body.dataset.vista = vista;
  if(vista === 'chat') pintarChat();
  if(vista === 'formacao') window.Fantasy?.abrir();
  if(vista === 'estatisticas') window.Arquivo?.abrir();
  if(vista === 'aovivo'){
    /* sem jogo escolhido, o Centro segue o jogo em foco (e muda com ele) */
    if(!opcoes.manterJogo) jogoVisto = opcoes.jogo || null;
    CentroJogo.abrir(jogoVisto || jogoEmFoco || porJogar()[0] || JOGOS.filter(jogado).slice(-1)[0]);
  }
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
   PESQUISA — jogadores do plantel e notícias, numa só caixa
   Escrever filtra as notícias e sugere jogadores; Enter abre as notícias
   com a pesquisa; uma sugestão de jogador abre a ficha dele.
   ========================================================================= */
let sugestaoAtiva = -1;
function fecharSugestoes(){
  const caixa = $('#procura-sugestoes');
  if(!caixa) return;
  caixa.hidden = true; caixa.innerHTML = '';
  $('#procura')?.setAttribute('aria-expanded', 'false');
  $('#procura')?.removeAttribute('aria-activedescendant');
  sugestaoAtiva = -1;
}
function pintarSugestoes(texto){
  const caixa = $('#procura-sugestoes');
  if(!caixa) return;
  const t = semAcentos(texto);
  if(t.length < 2){ fecharSugestoes(); return; }
  const jogadores = PLANTEL.filter(p => p.nome && (semAcentos(p.nome).includes(t) || semAcentos(ALCUNHAS[p.nome] || '').includes(t))).slice(0, 5);
  const nNoticias = NOTICIAS.filter(n => semAcentos(n.titulo + ' ' + (n.resumo || '')).includes(t)).length;
  const seguro = Componentes.seguro;
  caixa.innerHTML = jogadores.map((p, i) => `
      <button type="button" role="option" id="sug-${i}" class="sug" data-sug-jogador="${seguro(p.nome)}" aria-selected="false">
        <img src="${p.foto || avatarJogador(p)}" alt="" width="32" height="32" loading="lazy" onerror="this.onerror=null;this.src='${avatarJogador(p)}'">
        <span><b>${seguro(ALCUNHAS[p.nome] || p.nome)}</b><small>${seguro([p.pos, p.n ? 'n.º ' + p.n : ''].filter(Boolean).join(' · ') || 'Plantel')}</small></span>
      </button>`).join('') + `
      <button type="button" role="option" id="sug-n" class="sug sug--noticias" data-sug-noticias aria-selected="false">
        <span class="sug__ico" aria-hidden="true">${'<svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'}</span>
        <span><b>Notícias com «${seguro(texto)}»</b><small>${nNoticias} ${nNoticias === 1 ? 'notícia' : 'notícias'} nos jornais lidos</small></span>
      </button>`;
  caixa.hidden = false;
  $('#procura').setAttribute('aria-expanded', 'true');
  sugestaoAtiva = -1;
}
function escolherSugestao(b){
  if(!b) return;
  if(b.dataset.sugJogador){ abrirFichaDoNome(b.dataset.sugJogador); }
  else irPara('noticias');
  fecharSugestoes();
  $('#procura-caixa')?.classList.remove('is-aberta');
}
function ligarProcura(){
  const campo = $('#procura'), caixa = $('#procura-sugestoes');
  if(!campo || !caixa) return;
  campo.addEventListener('input', e => {
    procuraTexto = e.target.value.trim();
    pintarNoticias();
    pintarSugestoes(procuraTexto);
  });
  campo.addEventListener('keydown', e => {
    const opcoes = $$('#procura-sugestoes .sug');
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      if(!opcoes.length) return;
      e.preventDefault();
      sugestaoAtiva = (sugestaoAtiva + (e.key === 'ArrowDown' ? 1 : -1) + opcoes.length) % opcoes.length;
      opcoes.forEach((o, i) => o.setAttribute('aria-selected', i === sugestaoAtiva));
      campo.setAttribute('aria-activedescendant', opcoes[sugestaoAtiva].id);
      opcoes[sugestaoAtiva].scrollIntoView({ block: 'nearest' });
    }else if(e.key === 'Enter'){
      e.preventDefault();
      if(sugestaoAtiva >= 0) escolherSugestao(opcoes[sugestaoAtiva]);
      else if(procuraTexto){ irPara('noticias'); fecharSugestoes(); }
    }
  });
  caixa.addEventListener('click', e => escolherSugestao(e.target.closest('.sug')));
  document.addEventListener('click', e => { if(!e.target.closest('#procura-caixa')) fecharSugestoes(); });
}

/* =========================================================================
   11. ARRANQUE
   ========================================================================= */
async function arranque(){
  montarEmblema();
  /* a nuvem trata das contas, do ranking e do chat; se nao houver ligacao
     o site continua a funcionar com as contas locais */
  await Nuvem.iniciar();
  Entrada.iniciar({ irPara });
  UTILIZADOR_ATUAL = Entrada.nome;
  document.addEventListener('conta:mudou', e => contaMudou(e.detail.nome));
  ligarLeitor();
  ligarMenuMobile();
  ligarAoTopo();
  ligarHero();
  ligarTrocaProva();
  ligarLegais();
  const elAno = $('#ano'); if(elAno) elAno.textContent = new Date().getFullYear();
  const tacaMenu = $('.menu__taca');
  if(tacaMenu) tacaMenu.innerHTML = tacaSVG('liga', 'currentColor');
  /* o lema do clube saiu do cabeçalho: a marca é a do site, de adeptos */
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

  previaFantasy();
  pintarComunidade();
  setInterval(pintarComunidade, 5 * 60000);

  /* skeletons já visíveis enquanto os feeds não respondem */
  pintarHome();
  CentroJogo.iniciar({
    emblema: emblemaEquipa, nomeProva, irPara,
    tabela: () => TABELA, fonteTabela: () => FONTE_TABELA, jogos: () => JOGOS,
    mesmaEquipa: mesmaEquipaNome, noticiaOnze: procurarOnzeOficial, noticiasDoJogo
  });
  seguirJogoEmFoco();
  /* a faixa entra e sai sozinha conforme a hora do jogo (os pedidos à
     fonte são do CentroJogo, ao ritmo que o servidor indicar) */
  setInterval(seguirJogoEmFoco, 30000);

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
  ligarProcura();

  $('#mais-antigas').addEventListener('click', () => {
    mostradas += 40;
    pintarNoticias();
  });

  $('#btn-alertas').addEventListener('click', () => {
    novasDesdeVista = 0;
    $('#badge-alertas').textContent = NOTICIAS.length;
    irPara('aominuto');
  });
  addEventListener('keydown', e => {
    if(e.key === 'Escape'){ caixaProcura.classList.remove('is-aberta'); fecharSugestoes(); }
  });
}

document.addEventListener('DOMContentLoaded', arranque);
})();
