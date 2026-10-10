/* =========================================================================
   SPORTING CP — CONFIGURAÇÃO E DADOS
   -------------------------------------------------------------------------
   DE ONDE VEM CADA COISA:

   · Notícias, ao minuto e rumores  → RSS diretos de jornais portugueses,
     lidos pelo servidor.py. Cada notícia abre no site original.
   · Plantel, classificação, jogos e golos → API do Wikipédia (sem chave).
   · Fotografias dos jogadores e emblemas → API-Football, já descarregados
     para img/ pelo script atualizar_fotos.py.

   O que fica aqui para editares: perfis dos jogadores, alcunhas, entradas
   e saídas do mercado, e o calendário de reserva.
   ========================================================================= */

const CONFIG = {
  epoca: "2026/27",
  treinador: "Rui Borges",
  lema: "ESFORÇO, DEDICAÇÃO, DEVOÇÃO E GLÓRIA",

  refreshSegundos: 60,        // notícias
  refreshDadosMinutos: 15,    // plantel / classificação / jogos

  /* Onde ir buscar os feeds. O primeiro é o servidor.py local. */
 proxies: ["/api/rss?url=", "https://api.allorigins.win/raw?url=", "https://corsproxy.io/?url="],
  timeoutFeed: 15000,

  /* ---------------------------------------------------------------------
     FONTES DE NOTÍCIAS — RSS diretos, links diretos para o artigo.
     Para acrescentar um jornal: mete aqui o RSS e o domínio em
     DOMINIOS_PERMITIDOS no servidor.py.
     --------------------------------------------------------------------- */
  feeds: [
    { id:"leonino", nome:"LEONINO",            url:"https://leonino.pt/feed" },
    { id:"record",  nome:"RECORD",             url:"https://www.record.pt/rss" },
    { id:"mf",      nome:"MAISFUTEBOL",        url:"https://maisfutebol.iol.pt/rss" },
    { id:"nam",     nome:"NOTÍCIAS AO MINUTO", url:"https://www.noticiasaominuto.com/rss/desporto" },
    { id:"zz",      nome:"ZEROZERO",           url:"https://www.zerozero.pt/rss/noticias.php" },
    { id:"rtp",     nome:"RTP",                url:"https://www.rtp.pt/noticias/rss/desporto" },
    { id:"obs",     nome:"OBSERVADOR",         url:"https://observador.pt/seccao/desporto/feed/" },
    { id:"bnr",     nome:"BOLA NA REDE",       url:"https://bolanarede.pt/feed/" },
    { id:"f365",    nome:"FUTEBOL 365",        url:"https://futebol365.pt/feed/" },
    { id:"cm",      nome:"CORREIO DA MANHÃ",   url:"https://www.cmjornal.pt/rss" },
    { id:"publico", nome:"PÚBLICO",            url:"https://feeds.feedburner.com/PublicoRSS" },
    /* A BOLA não publica RSS (o /rss/sporting só redireciona para a página
       da secção). Usa-se o sitemap de notícias que o próprio jornal anuncia
       no robots.txt: XML estruturado com título, data e endereço de cada
       artigo dos últimos dias. Só isso entra — sem imagens nem texto do
       artigo; a notícia abre sempre no site d'A BOLA.
       Secção oficial: https://www.abola.pt/futebol/sporting-448 */
    { id:"abola",   nome:"A BOLA",             url:"https://www.abola.pt/sitemap-news.xml", formato:"sitemap" }
  ],

  /* uma notícia só entra se falar do clube.
     «leão» no singular está atrás de um travão: senão apanhava o Rafael Leão */
  filtroSporting: /sporting|leões|leonin|alvalade|verde e branco|(?<!rafael\s)\bleão\b/i,

  /* … e nao pode ser outro "Sporting", nem o Leao do Milan, nem o Papa */
  excluir: [/sporting\s+(de\s+)?braga/i, /sporting\s+gij/i, /sporting\s+kansas/i,
            /sporting\s+cristal/i, /sporting\s+charleroi/i, /sporting\s+covilh/i,
            /sporting\s+lokeren/i, /rafael\s+le[ãa]o/i,
            /le[ãa]o\s+(xiv|xiii|xii|papa)/i, /papa\s+le[ãa]o/i,
            /vaticano|pontif[íi]ce|santa s[ée]/i],

  /* separa os rumores das notícias normais */
  filtroRumores: /transfer|mercado|refor[çc]o|rumor|contrata[çc]|proposta|negoci|assinar|renova|sai(?:da)?\b|alvo|interess/i,
  /* e a formação */
  filtroFormacao: /forma[çc][ãa]o|sub-?\d\d|juniores|juvenis|academia|puxa|equipa b\b/i,

  palavrasQuentes: /oficial|confirmad|les[ãa]o|golo|hat-?trick|expuls|resciso?|apresentad/i,

  /* categorias usadas nos filtros da homepage e nos cartões */
  categorias: ['EQUIPA PRINCIPAL','MERCADO','FORMAÇÃO','FEMININO','MODALIDADES','DESTAQUE'],
  filtroFeminino: /feminin[ao]s?|equipa feminina/i,
  filtroModalidades: /futsal|andebol|atletismo|voleibol|h[óo]quei|nata[çc][ãa]o|basquetebol|r[ûu]gbi|ciclismo|t[ée]nis|judo|xadrez|modalidades/i,
  filtroVideo: /v[íi]deo|assiste|em imagens|highlights|resumo do jogo|declara[çc][õo]es em v/i,

  /* ---------------------------------------------------------------------
     APLICAÇÃO
     googlePlay: o endereço da ficha na Google Play, quando a app Android
       existir (https://play.google.com/store/apps/details?id=…). Enquanto
       for null, o Android mostra a instalação da PWA — nunca um link
       inventado. Ver docs/ANDROID.md.
     --------------------------------------------------------------------- */
  app: {
    nome: 'Sporting ao Minuto',
    googlePlay: null
  },

  /* notificações push: a chave pública VAPID. null = desligadas (ver
     docs/NOTIFICACOES.md e js/notificacoes.js) */
  push: {
    chavePublica: null
  },

  /* ---------------------------------------------------------------------
     MODALIDADES — cada equipa do clube.
     `rx` decide de que modalidade é uma notícia (sobretudo pelo título).
     `jogos` diz de onde vem o calendário: 'principal' é o do futebol
     (Wikipédia / football-data); null quer dizer que ainda não há fonte
     ligada — a página diz isso em vez de inventar jogos. Para ligar uma
     fonte nova basta trocar o null por um id e tratá-lo em jogosDaModalidade.
     --------------------------------------------------------------------- */
  modalidades: [
    { id:'futebol',     nome:'Futebol',          curto:'Futebol',     jogos:'principal' },
    { id:'feminino',    nome:'Futebol Feminino', curto:'Feminino',    jogos:null,
      rx:/feminin[ao]s?|equipa feminina|\bleoas\b/i },
    { id:'futsal',      nome:'Futsal',           curto:'Futsal',      jogos:null, rx:/futsal/i },
    { id:'andebol',     nome:'Andebol',          curto:'Andebol',     jogos:null, rx:/andebol/i },
    { id:'basquetebol', nome:'Basquetebol',      curto:'Basquetebol', jogos:null, rx:/basquet|\bbasket/i },
    { id:'hoquei',      nome:'Hóquei em Patins', curto:'Hóquei',      jogos:null, rx:/h[óo]quei/i },
    { id:'voleibol',    nome:'Voleibol',         curto:'Voleibol',    jogos:null, rx:/volei/i },
    { id:'atletismo',   nome:'Atletismo',        curto:'Atletismo',   jogos:null,
      rx:/atletismo|maratona|corta-mato|\bestafeta/i },
    { id:'formacao',    nome:'Formação',         curto:'Formação',    jogos:null,
      rx:/forma[çc][ãa]o|sub-?\d\d|juniores|juvenis|iniciados|academia|equipa b\b/i }
  ],
  /* sub-23 e equipa B: um separador próprio nas notícias */
  filtroSub23: /sub-?23|equipa b\b/i,
  /* vida do clube: assembleias, eleições, contas, SAD */
  filtroClube: /assembleia|s[óo]cios\b|elei[çc][õo]es|\bSAD\b|relat[óo]rio e contas|or[çc]amento|estatutos|museu|gala\b|anivers[áa]rio do clube/i,

  /* ---------------------------------------------------------------------
     DIA DE JOGO
     O onze sai cerca de uma hora antes, sempre por notícia. Estes padrões
     servem para a apanhar no meio do resto.
     --------------------------------------------------------------------- */
  /* Apanhar a notícia do onze é o que dá mais trabalho: cada jornal
     escreve à sua maneira. A lista foi crescendo com o que aparece mesmo. */
  filtroOnze: new RegExp([
    'onze (oficial|inicial|escolhido|provável|de rui borges)',
    'eis o onze', 'já há onze', 'onze do sporting', 'o onze leonino',
    'equipa inicial', 'escalaç(ão|ões)', 'as escolhas de rui borges',
    'comunicado o onze', 'sporting joga com', 'alinha com',
    'sporting alinha', 'titulares do sporting', 'com estes onze',
    'onze do le[ãa]o', 'rui borges (aposta|escolhe|opta) (em|por)'
  ].join('|'), 'i'),

  /* Notícias que descrevem o que se passa no jogo. Inclui o resultado
     escrito por extenso ("faz o 2-0"), que é a forma mais comum de
     anunciar um golo sem usar a palavra golo. */
  filtroLance: new RegExp([
    'golo|golaço|autogolo|marca(?:ou)?|bisa|hat.?trick',
    '\\d\\s*[-–x]\\s*\\d',
    'amplia|aumenta a vantagem|reduz|empata|inaugura o marcador',
    'de cabe[çc]a|de livre|de grande penalidade',
    'expuls|cart(?:ão|ao) (?:amarelo|vermelho)|vermelho direto',
    'substitui|rende|entra .{0,30}sai |sai .{0,30}entra ',
    'pen[áa]lt|assist[êe]ncia',
    'intervalo|ao intervalo|apito final|fim do jogo',
    'come[çc](?:a|ou) o jogo|arranca o jogo|rola a bola'
  ].join('|'), 'i'),

  /* de quanto em quanto tempo se atualiza durante o jogo (segundos) */
  refreshJogoSegundos: 30,

  /* Quanto tempo antes do apontapé o site entra em modo de jogo (minutos).
     São 4 horas e não 90 minutos: assim a aba já está lá quando começam a
     sair as antevisões, e não só quando o onze é conhecido. */
  antecedenciaJogo: 240,

  wiki: {
    api:      "https://en.wikipedia.org/w/api.php",
    epocaSCP:  "2026–27 Sporting CP season",
    liga:      "2026–27 Primeira Liga",
    champions: "2026–27 UEFA Champions League league phase"
  },

  lojaUrl: "https://store.sporting.pt/"
};

/* =========================================================================
   ALCUNHAS E PERFIS
   O perfil (0-100) é leitura tua, não é um facto — muda à vontade.
   ========================================================================= */
const PERFIS = {
  "Rui Silva":            {fin:12, passe:74, drible:30, defesa:86, fisico:78, vel:52},
  "João Virgínia":        {fin:10, passe:70, drible:28, defesa:79, fisico:76, vel:52},
  "Diego Callai":         {fin:10, passe:68, drible:30, defesa:74, fisico:74, vel:54},
  "Francisco Silva":      {fin:8,  passe:64, drible:26, defesa:70, fisico:70, vel:52},
  "Zeno Debast":          {fin:30, passe:80, drible:55, defesa:81, fisico:80, vel:70},
  "Nuno Santos":          {fin:70, passe:74, drible:80, defesa:52, fisico:70, vel:82},
  "Georgios Vagiannidis": {fin:48, passe:74, drible:70, defesa:70, fisico:74, vel:84},
  "Maximiliano Araújo":   {fin:55, passe:76, drible:78, defesa:70, fisico:80, vel:86},
  "Iván Fresneda":        {fin:40, passe:75, drible:74, defesa:70, fisico:74, vel:87},
  "Gonçalo Inácio":       {fin:52, passe:86, drible:62, defesa:84, fisico:78, vel:74},
  "Ousmane Diomande":     {fin:34, passe:74, drible:58, defesa:85, fisico:88, vel:82},
  "Eduardo Quaresma":     {fin:28, passe:76, drible:50, defesa:80, fisico:79, vel:72},
  "Ibrahima Ba":          {fin:26, passe:70, drible:52, defesa:74, fisico:82, vel:76},
  "Silas Andersen":       {fin:44, passe:80, drible:62, defesa:80, fisico:83, vel:68},
  "Sergi Altimira":       {fin:48, passe:84, drible:70, defesa:74, fisico:74, vel:70},
  "Pedro Gonçalves":      {fin:88, passe:82, drible:84, defesa:46, fisico:68, vel:82},
  "Giorgi Kochorashvili": {fin:50, passe:78, drible:70, defesa:74, fisico:80, vel:70},
  "Rodrigo Zalazar":      {fin:74, passe:85, drible:82, defesa:48, fisico:70, vel:74},
  "Pedro Lima":           {fin:46, passe:78, drible:72, defesa:68, fisico:74, vel:76},
  "Daniel Bragança":      {fin:52, passe:88, drible:76, defesa:62, fisico:64, vel:68},
  "João Simões":          {fin:44, passe:80, drible:72, defesa:70, fisico:66, vel:72},
  "Flávio Gonçalves":     {fin:60, passe:76, drible:78, defesa:46, fisico:62, vel:76},
  "Issa Doumbia":         {fin:46, passe:78, drible:72, defesa:72, fisico:80, vel:72},
  "Koba Koindredi":       {fin:48, passe:80, drible:74, defesa:66, fisico:70, vel:72},
  "Fotis Ioannidis":      {fin:83, passe:68, drible:70, defesa:34, fisico:80, vel:78},
  "Rafael Nel":           {fin:74, passe:64, drible:70, defesa:32, fisico:74, vel:80},
  "Geny Catamo":          {fin:66, passe:72, drible:82, defesa:44, fisico:70, vel:88},
  "Souleymane Faye":      {fin:64, passe:66, drible:78, defesa:36, fisico:72, vel:86},
  "Jesse Derry":          {fin:66, passe:70, drible:80, defesa:34, fisico:68, vel:84},
  "Luis Guilherme":       {fin:66, passe:72, drible:82, defesa:36, fisico:66, vel:82},
  "Luis Suárez":          {fin:85, passe:70, drible:72, defesa:36, fisico:82, vel:76}
};

const ALCUNHAS = { "Pedro Gonçalves": "Pote", "Maximiliano Araújo": "Maxi" };

/* perfil por omissão para jogadores novos, até lhes dares um */
const PERFIL_BASE = {
  GR: {fin:10, passe:66, drible:28, defesa:72, fisico:72, vel:52},
  DEF:{fin:32, passe:72, drible:56, defesa:76, fisico:78, vel:74},
  MED:{fin:52, passe:78, drible:70, defesa:66, fisico:72, vel:72},
  AVA:{fin:74, passe:68, drible:74, defesa:36, fisico:74, vel:80}
};

/* =========================================================================
   MERCADO — defeso 2026
   -------------------------------------------------------------------------
   valor  = quantia fixa, em milhões de euros
   bonus  = objetivos/variáveis por cima do fixo
   Fontes: comunicados do clube e imprensa (julho de 2026).
   ========================================================================= */
/* =========================================================================
   MERCADO 2026/27
   -------------------------------------------------------------------------
   Recolhido do zerozero.pt, que mantem a lista completa e com valores —
   o Wikipedia so tinha uma das quinze entradas. Os bonus por objetivos
   nao vem de la: esses ficam escritos a mao quando se souberem.
   Ultima recolha: 12 de setembro de 2026
   ========================================================================= */
const ENTRADAS = [
  { nome:"Rodrigo Zalazar",         origem:"SC Braga",           valor:30,    bonus:0 },
  { nome:"Ibrahima Ba",             origem:"Famalicão",          valor:21.25, bonus:0 },
  { nome:"Issa Doumbia",            origem:"Venezia",            valor:20.53, bonus:0 },
  { nome:"Sergi Altimira",          origem:"Real Betis",         valor:18.25, bonus:2 },
  { nome:"Nestory Irankunda",       origem:"Watford",            valor:15,    bonus:0 },
  { nome:"Silas Andersen",          origem:"BK Häcken",          valor:7.25,  bonus:0 },
  { nome:"Pedro Lima",              origem:"AVS",                valor:4,     bonus:0 },
  { nome:"Kaique Pereira",          origem:"Palmeiras",          valor:4,     bonus:0 },
  { nome:"Moncef Zekri",            origem:"KV Mechelen",        valor:3,     bonus:0 },
  { nome:"Bruno Ramos",             origem:"Académico de Viseu", valor:2,     bonus:0 },
  { nome:"Sebastián Osorio",        origem:"Universitario",      valor:0.75,  bonus:0 },
  { nome:"Catarino Pascoal",        origem:"Atlético CP",        valor:0.45,  bonus:0 },
  { nome:"Bidu",                    origem:"Criciúma",           valor:0.38,  bonus:0 },
  { nome:"Sotiris Alexandropoulos", origem:"Fortuna Düsseldorf", valor:null,  bonus:0, nota:"regresso de empréstimo" },
  { nome:"Jesse Derry",             origem:"Chelsea",            valor:0,     bonus:0, nota:"empréstimo" }
];

const SAIDAS = [
  { nome:"Ousmane Diomande",     destino:"Nottingham Forest",    valor:40,    bonus:0 },
  { nome:"Morten Hjulmand",      destino:"Atlético de Madrid",   valor:40,    bonus:5 },
  { nome:"Francisco Trincão",    destino:"Al-Ahli",              valor:39.35, bonus:4.37 },
  { nome:"Alisson Santos",       destino:"Nápoles",              valor:16.5,  bonus:0 },
  { nome:"Diogo Travassos",      destino:"SC Braga",             valor:5.5,   bonus:0 },
  { nome:"Rodrigo Ribeiro",      destino:"FC Augsburg",          valor:5,     bonus:0 },
  { nome:"Giorgi Kochorashvili", destino:"Sevilha",              valor:4.5,   bonus:0 },
  { nome:"Pedro Gonçalves",      destino:"Fiorentina",           valor:2.5,   bonus:0, nota:"empréstimo" },
  { nome:"João Virgínia",        destino:"Wolverhampton",        valor:1.5,   bonus:0 },
  { nome:"Daniel Bragança",      destino:"Torino",               valor:1,     bonus:0, nota:"empréstimo" },
  { nome:"Alexandre Brito",      destino:"Pafos",                valor:0.1,   bonus:0 },
  { nome:"Koba Koindredi",       destino:"Lausanne-Sport",       valor:null,  bonus:0 },
  { nome:"Biel Teixeira",        destino:"Pafos",                valor:null,  bonus:0, nota:"empréstimo" },
  { nome:"Rafael Pontelo",       destino:"Radnik Surdulica",     valor:0,     bonus:0 },
  { nome:"Souleymane Faye",      destino:"FC Lorient",           valor:0,     bonus:0, nota:"empréstimo" },
  { nome:"Hidemasa Morita",      destino:"Hull City",            valor:0,     bonus:0 },
  { nome:"Ricardo Mangas",       destino:"Monza",                valor:0,     bonus:0, nota:"empréstimo" },
  { nome:"David Moreira",        destino:"Gil Vicente",          valor:0,     bonus:0 }
];

/* =========================================================================
   VALORES DE MERCADO (Transfermarkt, em milhões de €)
   -------------------------------------------------------------------------
   O Transfermarkt bloqueia leitura automática, por isso estes valores são
   escritos à mão. Consulta transfermarkt.pt/sporting-cp/kader/verein/336
   e atualiza aqui quando quiseres. Quem não estiver na lista aparece "n.d.".
   ========================================================================= */
const VALOR_MERCADO = {
  "Ousmane Diomande": 45,  "Gonçalo Inácio": 40,   "Pedro Gonçalves": 30,
  "Rodrigo Zalazar": 30,   "Zeno Debast": 25,      "Issa Doumbia": 22,
  "Ibrahima Ba": 20,       "Sergi Altimira": 20,   "Geny Catamo": 18,
  "Maximiliano Araújo": 18,"Fotis Ioannidis": 18,  "Iván Fresneda": 15,
  "Luis Suárez": 14,       "Eduardo Quaresma": 12, "Daniel Bragança": 10,
  "Silas Andersen": 10,    "João Simões": 9,       "Georgios Vagiannidis": 8,
  "Giorgi Kochorashvili": 7,"Rafael Nel": 6,       "Luis Guilherme": 5,
  "Pedro Lima": 5,         "Rui Silva": 4,         "Nuno Santos": 3,
  "Jesse Derry": 3,        "Souleymane Faye": 2.5, "Flávio Gonçalves": 2,
  "Koba Koindredi": 2,     "João Virgínia": 1.5,   "Diego Callai": 1,
  "Francisco Silva": 0.5
};

/* épocas que a API deixa consultar no plano gratuito */
const EPOCAS_API = [2024, 2023, 2022];

/* =========================================================================
   FANTASY — quanto vale cada coisa
   -------------------------------------------------------------------------
   Um golo de um guarda-redes ou de um defesa vale muito mais do que um golo
   de um avançado, como é hábito neste tipo de jogo. Muda os números à
   vontade: a pontuação é recalculada logo a seguir.
   ========================================================================= */
const FANTASY = {
  /* SÓ CONTA A ÉPOCA 2026/27. Nada de carreira, nada de épocas passadas:
     quem não jogar esta época não pontua. */

  /* pontos por golo, conforme a posição de quem marca */
  golo: { GR:10, DEF:6, MED:5, AVA:4 },

  /* pontos por cada jogo disputado */
  jogo: { GR:2, DEF:2, MED:2, AVA:2 },

  /* multiplicador do capitão */
  capitao: 1.5,

  /* Regras de mercado da Fantasy.
     Antes do primeiro jogo oficial mexes à vontade. A partir daí a equipa
     tranca e só se podem fazer 2 trocas por jornada. */
  substituicoesPorJornada: 2,

  /* como é explicado na página */
  rotulos: {
    GR:'Guarda-redes', DEF:'Defesas', MED:'Médios', AVA:'Avançados'
  }
};

/* =========================================================================
   ONZE PROVÁVEL E BANCO
   -------------------------------------------------------------------------
   ISTO É UM PALPITE, não é a equipa oficial — só se sabe uma hora antes do
   jogo. Escrito à mão, muda à vontade.

   Os números das camisolas e as fotos não se escrevem aqui: são procurados
   no plantel pelo nome, por isso mantêm-se certos sozinhos.

   x e y são a posição no campo, em percentagem:
     x = 0 (esquerda) … 100 (direita)
     y = 0 (baliza adversária) … 100 (nossa baliza)
   ========================================================================= */
/* =========================================================================
   DESENHOS TÁCTICOS disponíveis em «A TUA FORMAÇÃO»
   x = 0 (esquerda) … 100 (direita)   ·   y = 0 (baliza adversária) … 100 (a nossa)
   ========================================================================= */
const FORMACOES = {
  "4-3-3": [
    {papel:"GR",x:50,y:91},
    {papel:"LE",x:12,y:72},{papel:"DC",x:36,y:78},{papel:"DC",x:64,y:78},{papel:"LD",x:88,y:72},
    {papel:"MC",x:30,y:55},{papel:"MC",x:50,y:61},{papel:"MC",x:70,y:55},
    {papel:"EXT",x:14,y:26},{papel:"PL",x:50,y:15},{papel:"EXT",x:86,y:26}
  ],
  "4-2-3-1": [
    {papel:"GR",x:50,y:91},
    {papel:"LE",x:12,y:72},{papel:"DC",x:36,y:78},{papel:"DC",x:64,y:78},{papel:"LD",x:88,y:72},
    {papel:"MDC",x:36,y:60},{papel:"MDC",x:64,y:60},
    {papel:"EXT",x:13,y:38},{papel:"MO",x:50,y:36},{papel:"EXT",x:87,y:38},
    {papel:"PL",x:50,y:13}
  ],
  "3-4-3": [
    {papel:"GR",x:50,y:91},
    {papel:"DC",x:26,y:77},{papel:"DC",x:50,y:80},{papel:"DC",x:74,y:77},
    {papel:"ALA",x:10,y:55},{papel:"MC",x:37,y:58},{papel:"MC",x:63,y:58},{papel:"ALA",x:90,y:55},
    {papel:"EXT",x:16,y:26},{papel:"PL",x:50,y:15},{papel:"EXT",x:84,y:26}
  ],
  "3-4-2-1": [
    {papel:"GR",x:50,y:91},
    {papel:"DC",x:26,y:76},{papel:"DC",x:50,y:79},{papel:"DC",x:74,y:76},
    {papel:"ALA",x:10,y:54},{papel:"MC",x:37,y:58},{papel:"MC",x:63,y:58},{papel:"ALA",x:90,y:54},
    {papel:"MO",x:32,y:32},{papel:"MO",x:68,y:32},
    {papel:"PL",x:50,y:13}
  ],
  "3-5-2": [
    {papel:"GR",x:50,y:91},
    {papel:"DC",x:26,y:78},{papel:"DC",x:50,y:81},{papel:"DC",x:74,y:78},
    {papel:"ALA",x:9,y:55},{papel:"MC",x:32,y:58},{papel:"MC",x:50,y:63},{papel:"MC",x:68,y:58},{papel:"ALA",x:91,y:55},
    {papel:"PL",x:37,y:17},{papel:"PL",x:63,y:17}
  ],
  "4-4-2": [
    {papel:"GR",x:50,y:91},
    {papel:"LE",x:12,y:74},{papel:"DC",x:36,y:79},{papel:"DC",x:64,y:79},{papel:"LD",x:88,y:74},
    {papel:"EXT",x:12,y:50},{papel:"MC",x:37,y:55},{papel:"MC",x:63,y:55},{papel:"EXT",x:88,y:50},
    {papel:"PL",x:37,y:18},{papel:"PL",x:63,y:18}
  ],
  "5-3-2": [
    {papel:"GR",x:50,y:91},
    {papel:"ALA",x:8,y:66},{papel:"DC",x:28,y:80},{papel:"DC",x:50,y:83},{papel:"DC",x:72,y:80},{papel:"ALA",x:92,y:66},
    {papel:"MC",x:30,y:54},{papel:"MC",x:50,y:58},{papel:"MC",x:70,y:54},
    {papel:"PL",x:37,y:20},{papel:"PL",x:63,y:20}
  ]
};

/* que posições do plantel encaixam em cada papel (só para sugerir primeiro) */
const PAPEL_GRUPO = {
  GR:"GR", DC:"DEF", LE:"DEF", LD:"DEF", ALA:"DEF",
  MDC:"MED", MC:"MED", MO:"MED",
  EXT:"AVA", PL:"AVA"
};

/* Onze de arranque sugerido — é o que aparece antes de mexeres em nada.
   A partir do momento em que escolheres jogadores, fica guardada a tua. */
const FORMACAO = {
  desenho: "3-4-2-1",
  nota: "sugestão de arranque",

  titulares: [
    { nome:"Rui Silva",          papel:"GR",     x:50, y:91 },

    { nome:"Ousmane Diomande",   papel:"DC",     x:26, y:75 },
    { nome:"Gonçalo Inácio",     papel:"DC",     x:50, y:78, capitao:true },
    { nome:"Zeno Debast",        papel:"DC",     x:74, y:75 },

    { nome:"Maximiliano Araújo", papel:"ALA E",  x:10, y:53 },
    { nome:"Silas Andersen",     papel:"MC",     x:37, y:57 },
    { nome:"Sergi Altimira",     papel:"MC",     x:63, y:57 },
    { nome:"Georgios Vagiannidis",papel:"ALA D", x:90, y:53 },

    { nome:"Pedro Gonçalves",    papel:"MO",     x:32, y:32 },
    { nome:"Rodrigo Zalazar",    papel:"MO",     x:68, y:32 },

    { nome:"Fotis Ioannidis",    papel:"PL",     x:50, y:14 }
  ],

  suplentes: [
    "João Virgínia", "Eduardo Quaresma", "Iván Fresneda", "Ibrahima Ba",
    "Daniel Bragança", "Issa Doumbia", "Geny Catamo", "Luis Suárez", "Rafael Nel"
  ]
};

/* =========================================================================
   CALENDÁRIO DE RESERVA
   Usado só se o Wikipédia não responder. Pré-época com resultados reais.
   ========================================================================= */
const FIXTURES = [
  { data:"2026-07-11T18:00:00", comp:"PRÉ-ÉPOCA", casa:"Sporting CP",  fora:"Torreense",         golosCasa:2, golosFora:0, local:"Estádio José Alvalade" },
  { data:"2026-07-13T19:00:00", comp:"PRÉ-ÉPOCA", casa:"Sporting CP",  fora:"Celtic",            golosCasa:4, golosFora:1, local:"Estádio José Alvalade" },
  { data:"2026-07-20T10:00:00", comp:"PRÉ-ÉPOCA", casa:"Portimonense", fora:"Sporting CP",       golosCasa:0, golosFora:1, local:"Lagos (à porta fechada)" },
  { data:"2026-07-20T19:00:00", comp:"PRÉ-ÉPOCA", casa:"Sporting CP",  fora:"Estrasburgo",       golosCasa:7, golosFora:0, local:"Algarve" },
  { data:"2026-07-27T20:00:00", comp:"PRÉ-ÉPOCA", casa:"Sporting CP",  fora:"Mónaco",            golosCasa:2, golosFora:0, local:"Estádio José Alvalade" },
  { data:"2026-07-31T19:45:00", comp:"PRÉ-ÉPOCA", casa:"Sporting CP",  fora:"Nottingham Forest", golosCasa:4, golosFora:1, local:"Estádio José Alvalade" },
  { data:"2026-08-08T20:30:00", comp:"LIGA — J1", casa:"Estrela da Amadora", fora:"Sporting CP", local:"Estádio José Gomes, Amadora" },
  { data:"2026-08-14T20:15:00", comp:"LIGA — J2", casa:"Sporting CP", fora:"V. Guimarães",       local:"Estádio José Alvalade" },
  { data:"2026-08-23T18:00:00", comp:"LIGA — J3", casa:"Sporting CP", fora:"Alverca",            local:"Estádio José Alvalade" },
  { data:"2026-08-30T18:00:00", comp:"LIGA — J4", casa:"Rio Ave",     fora:"Sporting CP",        local:"Estádio dos Arcos" }
];

const TABLE = [
  "Ac. Viseu","Alverca","Arouca","Benfica","SC Braga","Casa Pia","Estoril",
  "Estrela da Amadora","Famalicão","Gil Vicente","Marítimo","Moreirense",
  "Nacional","FC Porto","Rio Ave","Santa Clara","Sporting CP","V. Guimarães"
].map((equipa, i) => ({ pos:i+1, equipa, j:0, v:0, e:0, d:0, gm:0, gs:0, p:0 }));

/* =========================================================================
   CLUBE — factos para o separador CLUBE
   ========================================================================= */
const CLUBE = {
  fundacao: "1 de julho de 1906",
  estadio: "Estádio José Alvalade",
  lugares: "50.095",
  alcunha: "Leões",
  cores: "Verde e branco",
  /* o palmarés está em PALMARES, logo a seguir */

  /* Jogadores com títulos pelo Sporting (futebol sénior), como estão na
     secção de palmarés de cada um na Wikipédia inglesa — verificado a 10 de
     outubro de 2026. Só aparecem os que estão no plantel atual. */
  campeoes: [
    { nome:"Gonçalo Inácio",     titulos:{ liga:['2020–21','2023–24','2024–25'], taca:['2024–25'], ligacup:['2020–21','2021–22'], supertaca:['2021'] } },
    { nome:"Pedro Gonçalves",    titulos:{ liga:['2020–21','2023–24','2024–25'], taca:['2024–25'], ligacup:['2020–21','2021–22'], supertaca:['2021'] } },
    { nome:"Nuno Santos",        titulos:{ liga:['2020–21','2023–24','2024–25'], taca:['2024–25'], ligacup:['2020–21','2021–22'], supertaca:['2021'] } },
    { nome:"Daniel Bragança",    titulos:{ liga:['2020–21','2023–24','2024–25'], taca:['2024–25'], ligacup:['2020–21','2021–22'] } },
    { nome:"Eduardo Quaresma",   titulos:{ liga:['2020–21','2023–24','2024–25'], taca:['2024–25'], ligacup:['2020–21'] } },
    { nome:"Ousmane Diomande",   titulos:{ liga:['2023–24','2024–25'], taca:['2024–25'] } },
    { nome:"Geny Catamo",        titulos:{ liga:['2023–24','2024–25'], taca:['2024–25'] } },
    { nome:"Iván Fresneda",      titulos:{ liga:['2023–24','2024–25'], taca:['2024–25'] } },
    { nome:"Maximiliano Araújo", titulos:{ liga:['2024–25'], taca:['2024–25'] } },
    { nome:"Rui Silva",          titulos:{ liga:['2024–25'], taca:['2024–25'] } },
    { nome:"Zeno Debast",        titulos:{ liga:['2024–25'], taca:['2024–25'] } },
    { nome:"Eduardo Felicíssimo", titulos:{ liga:['2024–25'], taca:['2024–25'] } },
    { nome:"João Simões",        titulos:{ liga:['2024–25'], taca:['2024–25'] } },
    { nome:"João Virgínia",      titulos:{ ligacup:['2021–22'] } }
  ]
};

/* =========================================================================
   PALMARÉS — futebol sénior masculino, para o museu (js/museu.js)
   -------------------------------------------------------------------------
   Verificado a 10 de outubro de 2026 nas secções de palmarés da Wikipédia
   em português e em inglês (as duas dão os mesmos números nas competições
   principais). Em 2025/26 o Sporting não ganhou nenhuma destas provas.
   Cada época leva o título do artigo da Wikipédia em português quando ele
   existe; sem artigo fica null e a ficha liga à página da competição.
   "so_pt": só aparece na Wikipédia em português — mostra-se à parte.
   Não entram equipas B nem torneios particulares.
   ========================================================================= */
const PALMARES = {
  verificado: '10 de outubro de 2026',
  fontes: [
    ['Wikipédia — Sporting Clube de Portugal, Palmarés', 'https://pt.wikipedia.org/wiki/Sporting_Clube_de_Portugal#Palmarés'],
    ['Wikipedia — Sporting CP, Honours', 'https://en.wikipedia.org/wiki/Sporting_CP#Honours']
  ],
  imagem: {
    src: 'img/museu/tricampeonato-1280.webp', src800: 'img/museu/tricampeonato-800.webp',
    alt: 'Taças dos Campeonatos Nacionais de 1943/44, 1946/47, 1947/48, 1948/49 e 1950/51 em vitrines no Museu Sporting',
    legenda: 'Taças dos Campeonatos de 1943/44 a 1950/51 no Museu Sporting',
    autor: 'Threeohsix', licenca: 'CC BY-SA 4.0', licencaUrl: 'https://creativecommons.org/licenses/by-sa/4.0/deed.pt',
    origem: 'https://commons.wikimedia.org/wiki/File:Trof%C3%A9us_do_tricampeonato_do_Sporting_de_1947_a_1949_no_Museu_Sporting.jpg',
    alteracao: 'reduzida e convertida para WebP'
  },
  competicoes: [
    { id:'liga', nome:'Campeonato Nacional', plural:'Campeonatos Nacionais', curto:'Campeonato',
      grupo:'principal', ambito:'nacional', extinta:false, taca:'liga', artigo:'Primeira Liga',
      sobre:'O campeonato principal do futebol português.',
      epocas:[
        ['1940–41','Primeira Divisão de 1940–41'], ['1943–44','Primeira Divisão de 1943–44'], ['1946–47','Primeira Divisão de 1946–47'],
        ['1947–48','Primeira Divisão de 1947–48'], ['1948–49','Primeira Divisão de 1948–49'], ['1950–51','Primeira Divisão de 1950–51'],
        ['1951–52','Primeira Divisão de 1951–52'], ['1952–53','Primeira Divisão de 1952–53'], ['1953–54','Primeira Divisão de 1953–54'],
        ['1957–58','Primeira Divisão de 1957–58'], ['1961–62','Primeira Divisão de 1961–62'], ['1965–66','Primeira Divisão de 1965–66'],
        ['1969–70','Primeira Divisão de 1969–70'], ['1973–74','Primeira Divisão de 1973–74'], ['1979–80','Primeira Divisão de 1979–80'],
        ['1981–82','Primeira Divisão de 1981–82'], ['1999–00','Primeira Liga de 1999–00'], ['2001–02','Primeira Liga de 2001–02'],
        ['2020–21','Primeira Liga de 2020–21'], ['2023–24','Primeira Liga de 2023–24'], ['2024–25','Primeira Liga de 2024–25']
      ] },
    { id:'taca', nome:'Taça de Portugal', plural:'Taças de Portugal', curto:'Taça de Portugal',
      grupo:'principal', ambito:'nacional', extinta:false, taca:'taca', artigo:'Taça de Portugal',
      sobre:'A taça nacional, disputada por eliminatórias desde 1938/39.',
      epocas:[
        ['1940–41','Taça de Portugal de 1940–41'], ['1944–45',null], ['1945–46',null], ['1947–48',null], ['1953–54',null],
        ['1962–63',null], ['1970–71',null], ['1972–73',null], ['1973–74',null], ['1977–78',null], ['1981–82',null],
        ['1994–95','Taça de Portugal de 1994–95'], ['2001–02','Taça de Portugal de 2001–02'], ['2006–07','Taça de Portugal de 2006–07'],
        ['2007–08','Taça de Portugal de 2007–08'], ['2014–15','Taça de Portugal de 2014–15'], ['2018–19','Taça de Portugal de 2018–19'],
        ['2024–25','Taça de Portugal de 2024–25']
      ] },
    { id:'supertaca', nome:'Supertaça Cândido de Oliveira', plural:'Supertaças', curto:'Supertaça',
      grupo:'principal', ambito:'nacional', extinta:false, taca:'supertaca', artigo:'Supertaça Cândido de Oliveira',
      sobre:'O jogo entre o campeão nacional e o vencedor da Taça de Portugal. Conta-se pelo ano em que se jogou.',
      epocas:[
        ['1982',null], ['1987',null], ['1995',null], ['2000',null], ['2002','Supertaça Cândido de Oliveira de 2002'],
        ['2007','Supertaça Cândido de Oliveira de 2007'], ['2008','Supertaça Cândido de Oliveira de 2008'],
        ['2015','Supertaça Cândido de Oliveira de 2015'], ['2021','Supertaça Cândido de Oliveira de 2021']
      ] },
    { id:'ligacup', nome:'Taça da Liga', plural:'Taças da Liga', curto:'Taça da Liga',
      grupo:'principal', ambito:'nacional', extinta:false, taca:'ligacup', artigo:'Taça da Liga',
      sobre:'A taça organizada pela Liga Portugal, disputada desde 2007/08.',
      epocas:[
        ['2017–18','Taça da Liga de 2017–18'], ['2018–19','Taça da Liga de 2018–19'],
        ['2020–21','Taça da Liga de 2020–21'], ['2021–22','Taça da Liga de 2021–22']
      ] },
    { id:'europa', nome:'Taça das Taças', plural:'Taça das Taças', curto:'Taça das Taças',
      grupo:'principal', ambito:'europeu', extinta:true, taca:'europa', artigo:'Taça dos Clubes Vencedores de Taças',
      sobre:'A Taça dos Clubes Vencedores de Taças da UEFA, para os vencedores das taças nacionais, disputada entre 1960/61 e 1998/99.',
      epocas:[ ['1963–64','Taça dos Clubes Vencedores de Taças de 1963–64'] ] },
    { id:'cpt', nome:'Campeonato de Portugal', plural:'Campeonatos de Portugal', curto:'Campeonato de Portugal',
      grupo:'principal', ambito:'nacional', extinta:true, taca:'taca', artigo:'Campeonato de Portugal (1922–1938)',
      sobre:'A prova nacional por eliminatórias disputada entre 1922 e 1938, antes da Taça de Portugal. O clube expõe estes títulos no Museu Sporting.',
      epocas:[ ['1922–23','Campeonato de Portugal de 1922–23'], ['1933–34',null], ['1935–36',null], ['1937–38',null] ] },
    { id:'imperio', nome:'Taça Império', plural:'Taça Império', curto:'Taça Império',
      grupo:'outra', ambito:'nacional', extinta:true, taca:'taca', artigo:'Taça Império', so_pt:true,
      sobre:'Competição extinta, jogada uma única vez, em 1944.',
      epocas:[ ['1944',null] ] },
    { id:'intertoto', nome:'Taça Intertoto', plural:'Taça Intertoto', curto:'Intertoto',
      grupo:'outra', ambito:'europeu', extinta:true, taca:'europa', artigo:'Taça Intertoto', so_pt:true,
      sobre:'Competição europeia de verão, hoje extinta.',
      epocas:[ ['1968',null] ] },
    { id:'iberica', nome:'Taça Ibérica', plural:'Taça Ibérica', curto:'Taça Ibérica',
      grupo:'outra', ambito:'europeu', extinta:true, taca:'supertaca', artigo:'Taça Ibérica', so_pt:true,
      sobre:'Jogo entre clubes de Portugal e de Espanha, hoje extinto.',
      epocas:[ ['2000',null] ] },
    { id:'lisboa', nome:'Campeonato de Lisboa', plural:'Campeonatos de Lisboa', curto:'Campeonato de Lisboa',
      grupo:'regional', ambito:'regional', extinta:true, taca:'liga', artigo:'Campeonato Regional de Lisboa', so_pt:true,
      sobre:'O campeonato regional da Associação de Futebol de Lisboa, hoje extinto.',
      epocas:['1914–15','1918–19','1921–22','1922–23','1924–25','1927–28','1930–31','1933–34','1934–35','1935–36',
              '1936–37','1937–38','1938–39','1940–41','1941–42','1942–43','1944–45','1946–47'].map(e => [e, null]) },
    { id:'honra', nome:'Taça de Honra de Lisboa', plural:'Taças de Honra de Lisboa', curto:'Taça de Honra',
      grupo:'regional', ambito:'regional', extinta:false, taca:'taca', artigo:'Taça de Honra da AF Lisboa (1.ª Divisão)', so_pt:true,
      sobre:'A taça da Associação de Futebol de Lisboa.',
      epocas:['1914–15','1915–16','1916–17','1947–48','1961–62','1963–64','1965–66','1970–71','1984–85','1990–91',
              '1991–92','2013–14','2014–15'].map(e => [e, null]) }
  ]
};

/* =========================================================================
   CLASSIFICACAO DA CHAMPIONS — fase de liga
   Retrato guardado do Wikipedia, so para o site ter o que mostrar enquanto
   o pedido nao volta. O que manda e o que o Wiki.classificacaoChampions()
   trouxer; isto e a rede de seguranca.
   Ultima recolha: 12 de setembro de 2026 (jornada 1)
   ========================================================================= */
const TABLE_CL = [
  {pos: 1, equipa:"Paris Saint-Germain",   j:1, v:1, e:0, d:0, gm: 6, gs: 1, p:3},
  {pos: 2, equipa:"Bayern Munich",         j:1, v:1, e:0, d:0, gm: 5, gs: 0, p:3},
  {pos: 3, equipa:"Barcelona",             j:1, v:1, e:0, d:0, gm: 5, gs: 1, p:3},
  {pos: 4, equipa:"Manchester United",     j:1, v:1, e:0, d:0, gm: 4, gs: 0, p:3},
  {pos: 5, equipa:"Como",                  j:1, v:1, e:0, d:0, gm: 4, gs: 1, p:3},
  {pos: 6, equipa:"Sporting CP",           j:1, v:1, e:0, d:0, gm: 3, gs: 1, p:3},
  {pos: 6, equipa:"VfB Stuttgart",         j:1, v:1, e:0, d:0, gm: 3, gs: 1, p:3},
  {pos: 8, equipa:"Manchester City",       j:1, v:1, e:0, d:0, gm: 2, gs: 0, p:3},
  {pos: 9, equipa:"Aston Villa",           j:1, v:1, e:0, d:0, gm: 3, gs: 2, p:3},
  {pos: 9, equipa:"Lens",                  j:1, v:1, e:0, d:0, gm: 3, gs: 2, p:3},
  {pos: 9, equipa:"Real Betis",            j:1, v:1, e:0, d:0, gm: 3, gs: 2, p:3},
  {pos:12, equipa:"Borussia Dortmund",     j:1, v:1, e:0, d:0, gm: 3, gs: 2, p:3},
  {pos:13, equipa:"Liverpool",             j:1, v:1, e:0, d:0, gm: 2, gs: 1, p:3},
  {pos:13, equipa:"Real Madrid",           j:1, v:1, e:0, d:0, gm: 2, gs: 1, p:3},
  {pos:15, equipa:"Arsenal",               j:1, v:1, e:0, d:0, gm: 1, gs: 0, p:3},
  {pos:16, equipa:"AEK Athens",            j:1, v:1, e:0, d:0, gm: 1, gs: 0, p:3},
  {pos:17, equipa:"Roma",                  j:1, v:0, e:1, d:0, gm: 1, gs: 1, p:1},
  {pos:17, equipa:"Shakhtar Donetsk",      j:1, v:0, e:1, d:0, gm: 1, gs: 1, p:1},
  {pos:19, equipa:"Fenerbahçe",            j:1, v:0, e:1, d:0, gm: 1, gs: 1, p:1},
  {pos:19, equipa:"PSV Eindhoven",         j:1, v:0, e:1, d:0, gm: 1, gs: 1, p:1},
  {pos:21, equipa:"Villarreal",            j:1, v:0, e:0, d:1, gm: 2, gs: 3, p:0},
  {pos:22, equipa:"Club Brugge",           j:1, v:0, e:0, d:1, gm: 2, gs: 3, p:0},
  {pos:22, equipa:"Lille",                 j:1, v:0, e:0, d:1, gm: 2, gs: 3, p:0},
  {pos:22, equipa:"Slavia Prague",         j:1, v:0, e:0, d:1, gm: 2, gs: 3, p:0},
  {pos:25, equipa:"Atlético Madrid",       j:1, v:0, e:0, d:1, gm: 1, gs: 2, p:0},
  {pos:25, equipa:"Inter Milan",           j:1, v:0, e:0, d:1, gm: 1, gs: 2, p:0},
  {pos:27, equipa:"LASK",                  j:1, v:0, e:0, d:1, gm: 0, gs: 1, p:0},
  {pos:27, equipa:"Napoli",                j:1, v:0, e:0, d:1, gm: 0, gs: 1, p:0},
  {pos:29, equipa:"Galatasaray",           j:1, v:0, e:0, d:1, gm: 1, gs: 3, p:0},
  {pos:29, equipa:"Viking",                j:1, v:0, e:0, d:1, gm: 1, gs: 3, p:0},
  {pos:31, equipa:"Porto",                 j:1, v:0, e:0, d:1, gm: 0, gs: 2, p:0},
  {pos:32, equipa:"RB Leipzig",            j:1, v:0, e:0, d:1, gm: 1, gs: 4, p:0},
  {pos:33, equipa:"Feyenoord",             j:1, v:0, e:0, d:1, gm: 1, gs: 5, p:0},
  {pos:34, equipa:"Sabah",                 j:1, v:0, e:0, d:1, gm: 0, gs: 4, p:0},
  {pos:35, equipa:"Slovan Bratislava",     j:1, v:0, e:0, d:1, gm: 1, gs: 6, p:0},
  {pos:36, equipa:"Bodø/Glimt",            j:1, v:0, e:0, d:1, gm: 0, gs: 5, p:0},
];

/* Os oito adversarios do Sporting na fase de liga, do sorteio de 27 de
   agosto de 2026. Quatro em Alvalade, quatro fora. */
const CL_ADVERSARIOS = [
  {equipa:"Barcelona",        casa:true,  pote:1},
  {equipa:"Manchester City",  casa:false, pote:1},
  {equipa:"Manchester United",casa:true,  pote:2},
  {equipa:"Roma",             casa:false, pote:2},
  {equipa:"Galatasaray",      casa:true,  pote:3},
  {equipa:"Shakhtar Donetsk", casa:false, pote:3},
  {equipa:"LASK",             casa:true,  pote:4},
  {equipa:"Lens",             casa:false, pote:4}
];
