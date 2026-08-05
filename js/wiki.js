/* =========================================================================
   SCP // CENTRO DE COMANDO — SINCRONIZAÇÃO DE DADOS
   -------------------------------------------------------------------------
   Puxa dados reais da API do Wikipédia (aberta, com CORS, sem chave):
     · classificação da Liga            → atualiza depois de cada jornada
     · plantel (nº, posição, país)      → atualiza a cada transferência
     · presenças e golos por jogador    → atualiza depois de cada jogo
     · calendário e resultados          → atualiza depois de cada jogo

   Se alguma coisa falhar, fica o que está em data.js e a interface avisa.
   ========================================================================= */

const Wiki = (() => {

  /* ---------- pedido base ---------- */
  async function pagina(titulo){
    const url = `${CONFIG.wiki.api}?action=parse&page=${encodeURIComponent(titulo)}` +
                `&prop=text&format=json&origin=*&redirects=1`;
    const r = await fetch(url, {cache:'no-store'});
    if(!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if(j.error) throw new Error(j.error.code);
    return new DOMParser().parseFromString(j.parse.text['*'], 'text/html');
  }

  const texto  = el => (el?.textContent || '').replace(/\[\d+\]/g,'').replace(/\s+/g,' ').trim();
  const numero = t  => { const n = parseInt(String(t).replace(/[^\d-]/g,''), 10); return isNaN(n) ? 0 : n; };

  /* Nomes como aparecem no Wikipédia → como queremos mostrar */
  const NOMES = {
    'Porto':'FC Porto', 'Braga':'SC Braga', 'Vitória de Guimarães':'V. Guimarães',
    'Académico de Viseu':'Ac. Viseu', 'Estrela da Amadora':'Estrela da Amadora',
    'Sporting CP':'Sporting CP', 'Benfica':'Benfica'
  };
  const arrumaNome = n => NOMES[n] || n;

  /* =====================================================================
     1. CLASSIFICAÇÃO
     ===================================================================== */
  async function classificacao(){
    const doc = await pagina(CONFIG.wiki.liga);
    const tabela = [...doc.querySelectorAll('table')].find(t =>
      /\bPld\b/.test(t.textContent) && /\bPts\b/.test(t.textContent) && /\bPos\b/.test(t.textContent));
    if(!tabela) throw new Error('tabela não encontrada');

    const linhas = [...tabela.querySelectorAll('tr')].slice(1);
    const saida = [];

    for(const tr of linhas){
      const c = [...tr.children].map(texto);
      if(c.length < 10) continue;
      const pos = numero(c[0]);
      const equipa = c[1].replace(/\s*\(.*?\)\s*$/,'').trim();
      if(!pos || !equipa) continue;
      saida.push({
        pos, equipa: arrumaNome(equipa),
        j:numero(c[2]), v:numero(c[3]), e:numero(c[4]), d:numero(c[5]),
        gm:numero(c[6]), gs:numero(c[7]), p:numero(c[9])
      });
    }
    if(saida.length < 10) throw new Error('classificação incompleta');
    return saida;
  }

  /* =====================================================================
     2. PLANTEL
     ===================================================================== */
  const POSICOES = {
    GK:{pos:'GR', grupo:'GR'}, DF:{pos:'DEF', grupo:'DEF'},
    MF:{pos:'MED', grupo:'MED'}, FW:{pos:'AVA', grupo:'AVA'}
  };

  const BANDEIRAS = {
    POR:'🇵🇹', BRA:'🇧🇷', ESP:'🇪🇸', FRA:'🇫🇷', ITA:'🇮🇹', DEN:'🇩🇰', BEL:'🇧🇪',
    GRE:'🇬🇷', GEO:'🇬🇪', URU:'🇺🇾', COL:'🇨🇴', CIV:'🇨🇮', SEN:'🇸🇳', MOZ:'🇲🇿',
    ENG:'🏴󠁧󠁢󠁥󠁮󠁧󠁿', NED:'🇳🇱', ARG:'🇦🇷', JPN:'🇯🇵', SWE:'🇸🇪', NOR:'🇳🇴', GER:'🇩🇪'
  };

  function lerPlantel(doc){
    /* a tabela do plantel tem cabeçalho No. / Pos. / Nation / Player */
    const tabelas = [...doc.querySelectorAll('table')].filter(t => {
      const cab = texto(t.querySelector('tr'));
      return /No\..*Pos\..*Nation.*Player/.test(cab);
    });
    if(!tabelas.length) throw new Error('plantel não encontrado');

    const jogadores = [];
    const vistos = new Set();

    for(const t of tabelas){
      for(const tr of t.querySelectorAll('tr')){
        const c = [...tr.children].map(texto);
        if(c.length !== 4) continue;
        if(c[0] === 'No.') continue;

        const numeroCamisola = c[0] === '—' || c[0] === '–' ? null : numero(c[0]);
        const p = POSICOES[c[1]];
        if(!p) continue;

        const pais = c[2].trim().toUpperCase();
        let nome = c[3];
        let nota = '';
        const m = nome.match(/\((.+?)\)\s*$/);
        if(m){ nota = m[1]; nome = nome.replace(/\s*\(.+?\)\s*$/,'').trim(); }

        if(vistos.has(nome)) continue;
        vistos.add(nome);

        jogadores.push({
          n: numeroCamisola, nome,
          pos: p.pos, posGrupo: p.grupo,
          nac: `${BANDEIRAS[pais] || '🏳️'} ${pais}`,
          nota: traduzNota(nota)
        });
      }
    }
    return jogadores;
  }

  function traduzNota(n){
    if(!n) return '';
    return n
      .replace(/on loan from/i, 'emprestado pelo')
      .replace(/vice-captain/i, 'vice-capitão')
      .replace(/3rd captain/i, '3.º capitão')
      .replace(/captain/i, 'capitão');
  }

  /* =====================================================================
     3. PRESENÇAS E GOLOS
     Tabela "Appearances and goals":
     No. | Pos | Nat | Player | Apps(total) | Goals(total) | ...por prova
     ===================================================================== */
  function lerEstatisticas(doc){
    const t = [...doc.querySelectorAll('table')].find(x => {
      const cab = texto(x.querySelector('tr'));
      return /Player/.test(cab) && /Total/.test(cab) && /Apps|Goals/.test(x.textContent);
    });
    if(!t) return {};

    const stats = {};
    for(const tr of t.querySelectorAll('tr')){
      const c = [...tr.children].map(texto);
      if(c.length < 6) continue;
      if(!/^\d+$|^—$|^–$/.test(c[0])) continue;      // salta cabeçalhos e "Goalkeepers"
      const nome = c[3];
      if(!nome) continue;
      stats[nome] = { jogos: numero(c[4]), golos: numero(c[5]) };
    }
    return stats;
  }

  /* =====================================================================
     4. JOGOS E RESULTADOS
     Cada jogo é uma tabelinha: [data+jornada, casa, resultado, fora, cidade]
     ===================================================================== */
  const MESES = {january:0,february:1,march:2,april:3,may:4,june:5,
                 july:6,august:7,september:8,october:9,november:10,december:11};

  const dois = n => String(n).padStart(2,'0');
  const dataLocalISO = d =>
    `${d.getFullYear()}-${dois(d.getMonth()+1)}-${dois(d.getDate())}` +
    `T${dois(d.getHours())}:${dois(d.getMinutes())}:00`;

  /* "Pote 12', 45+2' Suárez 61' (g.p.)" → lista de marcadores.
     Quando o jogador marca mais do que uma vez, o nome só aparece à
     primeira — por isso guarda-se o último nome visto. */
  function lerMarcadores(txt){
    if(!txt) return [];
    const saida = [];
    let ultimo = '';
    const rx = /([^0-9]*?)\s*(\d+(?:\+\d+)?)\s*['′]\s*(\((?:pen\.?|p)\)|\(o\.g\.?\))?/gi;
    let m;
    while((m = rx.exec(txt)) !== null){
      let nome = (m[1] || '')
        .replace(/[,;·]/g,' ')
        .replace(/^[^\p{L}]+/u,'')      // tira lixo de template ("}", "|", etc.)
        .replace(/[^\p{L}\s'’.-]+$/u,'')
        .replace(/\s+/g,' ').trim();
      if(!nome) nome = ultimo; else ultimo = nome;
      if(!nome) continue;
      const extra = (m[3] || '').toLowerCase();
      saida.push({
        nome,
        minuto: m[2],
        tipo: extra.includes('o.g') ? 'ag' : extra ? 'gp' : ''
      });
    }
    return saida;
  }

  function lerJogos(doc){
    const tabelas = [...doc.querySelectorAll('table')]
      .filter(t => /^\d{1,2}\s+\w+\s+20\d\d/.test(texto(t).slice(0,40)));

    const jogos = [];
    for(const t of tabelas){
      const linhas = t.querySelectorAll('tr');
      const c = [...(linhas[0]?.children || [])].map(texto);
      if(c.length < 4) continue;

      const mData = c[0].match(/^(\d{1,2})\s+(\w+)\s+(20\d\d)\s*(.*)$/);
      if(!mData) continue;
      const mes = MESES[mData[2].toLowerCase()];
      if(mes === undefined) continue;

      /* hora vem na 2.ª linha: "20:30 WEST (UTC+01:00)" */
      const linha2 = [...(linhas[1]?.children || [])].map(texto);
      const mHora = (linha2[0] || '').match(/(\d{2}):(\d{2})/);
      const data = new Date(+mData[3], mes, +mData[1],
                            mHora ? +mHora[1] : 18, mHora ? +mHora[2] : 0);

      const casa = arrumaNome(c[1].replace(/\s*\(.*?\)\s*$/,''));
      const fora = arrumaNome(c[3].replace(/\s*\(.*?\)\s*$/,''));
      const mGolos = c[2].match(/^(\d+)\s*[–—-]\s*(\d+)/);

      const detalhes = linha2[4] || '';
      const estadio = detalhes.match(/Stadium:\s*(.*?)(?:Attendance:|Referee:|$)/);
      const publico = detalhes.match(/Attendance:\s*([\d.,]+)/);
      const arbitro = detalhes.match(/Referee:\s*(.+?)\s*$/);

      jogos.push({
        /* data local, sem passar por toISOString: isso convertia para UTC
           e depois era relida como hora local, perdendo uma hora */
        data: dataLocalISO(data),
        comp: rotuloCompeticao(mData[4], t),
        casa, fora,
        golosCasa: mGolos ? +mGolos[1] : undefined,
        golosFora: mGolos ? +mGolos[2] : undefined,
        local: estadio ? estadio[1].trim() : c[4] || '',
        marcadoresCasa: lerMarcadores(linha2[1]),
        marcadoresFora: lerMarcadores(linha2[3]),
        publico: publico ? publico[1] : '',
        arbitro: arbitro ? arbitro[1] : ''
      });
    }
    return jogos;
  }

  function rotuloCompeticao(sufixo, tabela){
    const s = (sufixo || '').trim();
    if(/^\d+$/.test(s)) return 'LIGA — J' + s;
    if(/quarter/i.test(s)) return 'TAÇA DA LIGA — QF';
    if(/semi/i.test(s))    return 'MEIA-FINAL';
    if(/final/i.test(s))   return 'FINAL';
    if(s) return s.toUpperCase();
    return 'JOGO';
  }

  /* =====================================================================
     API do módulo
     ===================================================================== */
  async function sincronizarSporting(){
    const doc = await pagina(CONFIG.wiki.epocaSCP);
    return {
      plantel: lerPlantel(doc),
      stats:   lerEstatisticas(doc),
      jogos:   lerJogos(doc)
    };
  }

  return { classificacao, sincronizarSporting };
})();
