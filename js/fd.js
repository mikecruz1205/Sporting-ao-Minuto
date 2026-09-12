/* =========================================================================
   FOOTBALL-DATA.ORG — dados estruturados de jogo
   -------------------------------------------------------------------------
   O que isto traz e que mais nenhuma fonte gratuita dá de forma fiável:
     · onze inicial e banco, com número de camisola e formação
     · golos com marcador E assistente
     · cartões e substituições ao minuto
     · classificação da Liga

   Porque passa pelo servidor: a API deles não manda cabeçalhos de CORS, e
   o token não pode viver no browser. Ver api/fd.py e servidor.py.

   Sem token, tudo aqui devolve null sem se queixar e o site continua a ler
   as notícias como antes. Nada disto é obrigatório para o site funcionar.
   ========================================================================= */

const FD = (() => {

  const BASE = '/api/fd?p=';
  const LIGA = 'PPL';                 // Primeira Liga, no escalão gratuito
  const SPORTING = 5613;              // id do Sporting CP no football-data

  /* Quando não há token o proxy responde 503. Descobre-se uma vez e depois
     nem se tenta, para não encher a consola de erros a cada sincronização. */
  let disponivel = null;

  async function pedir(caminho){
    if(disponivel === false) return null;
    try{
      const r = await fetch(BASE + encodeURIComponent(caminho), {cache:'no-store'});
      if(r.status === 503){ disponivel = false; return null; }
      if(!r.ok) return null;
      disponivel = true;
      return await r.json();
    }catch(e){
      return null;
    }
  }

  const temToken = () => disponivel === true;

  /* ---------------------------------------------------------------------
     Classificação da Liga
     --------------------------------------------------------------------- */
  async function classificacao(){
    const d = await pedir('competitions/' + LIGA + '/standings');
    const total = d?.standings?.find(s => s.type === 'TOTAL');
    if(!total?.table?.length) return null;

    return total.table.map(l => ({
      pos: l.position,
      equipa: nomeCurto(l.team),
      j: l.playedGames, v: l.won, e: l.draw, d: l.lost,
      gm: l.goalsFor, gs: l.goalsAgainst, p: l.points
    }));
  }

  /* ---------------------------------------------------------------------
     Jogos do Sporting na época
     --------------------------------------------------------------------- */
  async function jogos(){
    const d = await pedir('teams/' + SPORTING + '/matches?limit=100');
    if(!d?.matches?.length) return null;
    return d.matches.map(resumir);
  }

  /* o jogo que está a decorrer; se não houver, o próximo */
  async function jogoAgora(){
    const d = await pedir('teams/' + SPORTING + '/matches?status=LIVE,IN_PLAY,PAUSED');
    if(d?.matches?.length) return resumir(d.matches[0]);
    const p = await pedir('teams/' + SPORTING + '/matches?status=SCHEDULED&limit=1');
    return p?.matches?.length ? resumir(p.matches[0]) : null;
  }

  function resumir(m){
    return {
      id: m.id,
      data: m.utcDate,
      estado: m.status,                       // SCHEDULED, IN_PLAY, FINISHED…
      minuto: m.minute ?? null,
      comp: m.competition?.name || '',
      casa: nomeCurto(m.homeTeam), fora: nomeCurto(m.awayTeam),
      golosCasa: m.score?.fullTime?.home ?? null,
      golosFora: m.score?.fullTime?.away ?? null,
      jornada: m.matchday ?? null
    };
  }

  /* ---------------------------------------------------------------------
     FICHA DO JOGO — onze, banco, golos com assistência, cartões, trocas
     É aqui que isto ganha às notícias: nada disto precisa de ser adivinhado
     a partir de títulos de jornal.
     --------------------------------------------------------------------- */
  async function ficha(idJogo){
    const m = await pedir('matches/' + idJogo);
    if(!m?.id) return null;

    const nosSomosCasa = ehSporting(m.homeTeam);
    const nos  = nosSomosCasa ? m.homeTeam : m.awayTeam;
    const eles = nosSomosCasa ? m.awayTeam : m.homeTeam;

    return {
      id: m.id,
      estado: m.status,
      minuto: m.minute ?? null,
      emCasa: nosSomosCasa,
      adversario: nomeCurto(eles),
      formacao: nos?.formation || null,
      treinador: nos?.coach?.name || null,
      titulares: (nos?.lineup || []).map(jogador),
      suplentes: (nos?.bench  || []).map(jogador),
      lances: lances(m, nosSomosCasa),
      arbitro: (m.referees || [])[0]?.name || null
    };
  }

  const jogador = j => ({
    nome: j.name,
    n: j.shirtNumber ?? null,
    pos: traduzPosicao(j.position)
  });

  /* golos, cartões e substituições numa lista só, do mais recente para trás */
  function lances(m, nosSomosCasa){
    const nossoId = nosSomosCasa ? m.homeTeam?.id : m.awayTeam?.id;
    const saida = [];

    for(const g of (m.goals || [])){
      saida.push({
        tipo: 'golo', icone: '⚽',
        minuto: g.minute, extra: g.injuryTime ?? null,
        nosso: g.team?.id === nossoId,
        quem: g.scorer?.name || null,
        assistiu: g.assist?.name || null,
        detalhe: traduzGolo(g.type),
        resultado: g.score ? g.score.home + '-' + g.score.away : null
      });
    }
    for(const c of (m.bookings || [])){
      const vermelho = c.card === 'RED_CARD' || c.card === 'SECOND_YELLOW_CARD';
      saida.push({
        tipo: vermelho ? 'vermelho' : 'amarelo',
        icone: vermelho ? '🟥' : '🟨',
        minuto: c.minute, nosso: c.team?.id === nossoId,
        quem: c.player?.name || null
      });
    }
    for(const s of (m.substitutions || [])){
      saida.push({
        tipo: 'troca', icone: '🔄',
        minuto: s.minute, nosso: s.team?.id === nossoId,
        entrou: s.playerIn?.name || null,
        saiu: s.playerOut?.name || null
      });
    }
    return saida.sort((a,b) => (b.minuto || 0) - (a.minuto || 0));
  }

  /* ---------------------------------------------------------------------
     Traduções
     --------------------------------------------------------------------- */
  const POSICOES = {
    'Goalkeeper':'GR',
    'Defence':'DEF', 'Centre-Back':'DEF', 'Left-Back':'DEF', 'Right-Back':'DEF',
    'Midfield':'MED', 'Defensive Midfield':'MED', 'Central Midfield':'MED',
    'Attacking Midfield':'MED',
    'Offence':'AVA', 'Left Winger':'AVA', 'Right Winger':'AVA',
    'Centre-Forward':'AVA'
  };
  const traduzPosicao = p => POSICOES[p] || (p || '—');

  const GOLOS = { 'REGULAR':'', 'OWN':'na própria baliza', 'PENALTY':'de grande penalidade' };
  const traduzGolo = t => GOLOS[t] ?? '';

  /* "Sporting Clube de Portugal" → "Sporting CP" */
  const CURTOS = {
    'Sporting Clube de Portugal':'Sporting CP',
    'Sport Lisboa e Benfica':'Benfica',
    'Futebol Clube do Porto':'FC Porto',
    'Sporting Clube de Braga':'SC Braga',
    'Vitória Sport Clube':'V. Guimarães',
    'Clube Desportivo Nacional':'Nacional',
    'Gil Vicente Futebol Clube':'Gil Vicente',
    'Futebol Clube de Famalicão':'Famalicão',
    'Moreirense Futebol Clube':'Moreirense',
    'Rio Ave Futebol Clube':'Rio Ave',
    'Casa Pia Atlético Clube':'Casa Pia'
  };
  const nomeCurto = eq => {
    const n = eq?.name || '';
    return CURTOS[n] || eq?.shortName || n;
  };

  const ehSporting = eq =>
    eq?.id === SPORTING || /sporting clube de portugal/i.test(eq?.name || '');

  return { classificacao, jogos, jogoAgora, ficha, temToken };
})();
