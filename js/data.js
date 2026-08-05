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
    { id:"record",  nome:"RECORD",             url:"https://www.record.pt/rss" },
    { id:"mf",      nome:"MAISFUTEBOL",        url:"https://maisfutebol.iol.pt/rss" },
    { id:"nam",     nome:"NOTÍCIAS AO MINUTO", url:"https://www.noticiasaominuto.com/rss/desporto" },
    { id:"zz",      nome:"ZEROZERO",           url:"https://www.zerozero.pt/rss/noticias.php" },
    { id:"rtp",     nome:"RTP",                url:"https://www.rtp.pt/noticias/rss/desporto" },
    { id:"obs",     nome:"OBSERVADOR",         url:"https://observador.pt/seccao/desporto/feed/" }
  ],

  /* uma notícia só entra se falar do clube.
     «leão» no singular está atrás de um travão: senão apanhava o Rafael Leão */
  filtroSporting: /sporting|leões|leonin|alvalade|verde e branco|(?<!rafael\s)\bleão\b/i,

  /* … e não pode ser outro "Sporting", nem o Leão do Milan */
  excluir: [/sporting\s+(de\s+)?braga/i, /sporting\s+gij/i, /sporting\s+kansas/i,
            /sporting\s+cristal/i, /sporting\s+charleroi/i, /sporting\s+covilh/i,
            /sporting\s+lokeren/i, /rafael\s+leão/i],

  /* separa os rumores das notícias normais */
  filtroRumores: /transfer|mercado|refor[çc]o|rumor|contrata[çc]|proposta|negoci|assinar|renova|sai(?:da)?\b|alvo|interess/i,
  /* e a formação */
  filtroFormacao: /forma[çc][ãa]o|sub-?\d\d|juniores|juvenis|academia|puxa|equipa b\b/i,

  palavrasQuentes: /oficial|confirmad|les[ãa]o|golo|hat-?trick|expuls|resciso?|apresentad/i,

  wiki: {
    api:      "https://en.wikipedia.org/w/api.php",
    epocaSCP: "2026–27 Sporting CP season",
    liga:     "2026–27 Primeira Liga"
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
const ENTRADAS = [
  { nome:"Rodrigo Zalazar", origem:"SC Braga",     valor:30,   bonus:0 },
  { nome:"Issa Doumbia",    origem:"Venezia",      valor:20,   bonus:0 },
  { nome:"Ibrahima Ba",     origem:"Famalicão",    valor:20,   bonus:0 },
  { nome:"Sergi Altimira",  origem:"Real Betis",   valor:18,   bonus:2 },
  { nome:"Silas Andersen",  origem:"BK Häcken",    valor:7.25, bonus:0 },
  { nome:"Pedro Lima",      origem:"AVS",          valor:4,    bonus:0 },
  { nome:"Jesse Derry",     origem:"Chelsea",      valor:0,    bonus:0, nota:"empréstimo" }
];

const SAIDAS = [
  { nome:"Geovany Quenda",    destino:"Chelsea",             valor:50,    bonus:0 },
  { nome:"Morten Hjulmand",   destino:"Atlético de Madrid",  valor:40,    bonus:5 },
  { nome:"Francisco Trincão", destino:"Al-Ahli",             valor:39.34, bonus:4.37 },
  { nome:"Alisson Santos",    destino:"Nápoles",             valor:16.5,  bonus:0 },
  { nome:"Diogo Travassos",   destino:"SC Braga",            valor:5.5,   bonus:0 },
  { nome:"Rodrigo Ribeiro",   destino:"FC Augsburg",         valor:5,     bonus:0 },
  { nome:"Hidemasa Morita",   destino:"fim de contrato",     valor:0,     bonus:0, nota:"livre" }
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
  titulos: [
    ["Campeonatos nacionais", 21],
    ["Taças de Portugal", 18],
    ["Supertaças", 11],
    ["Taças da Liga", 5],
    ["Taça das Taças (UEFA)", 1]
  ]
};
