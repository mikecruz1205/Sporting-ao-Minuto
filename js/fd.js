/* =========================================================================
   FOOTBALL-DATA.ORG — dados estruturados de jogo
   -------------------------------------------------------------------------
   Aqui fica só a CLASSIFICAÇÃO da Liga (o plano gratuito dá-a, com
   atraso). O jogo em si — estado, resultado, eventos — passou para a
   camada única do servidor (api/_jogo.py, pedida por js/centro.js).
   Nota: o plano gratuito NÃO tem onzes, marcadores nem cartões; isso é
   do plano pago "Deep Data".

   Porque passa pelo servidor: a API deles não manda cabeçalhos de CORS, e
   o token não pode viver no browser. Ver api/fd.py e servidor.py.

   Sem token, tudo aqui devolve null sem se queixar e o site continua a ler
   as notícias como antes. Nada disto é obrigatório para o site funcionar.
   ========================================================================= */

const FD = (() => {

  const BASE = '/api/fd?p=';
  const LIGA = 'PPL';                 // Primeira Liga, no escalão gratuito

  /* Quando não há token o proxy responde 503. Descobre-se uma vez e depois
     nem se tenta, para não encher a consola de erros a cada sincronização. */
  const CHAVE = 'scp-fd-indisponivel';
  let disponivel = (() => {
    try{ return Date.now() - Number(sessionStorage.getItem(CHAVE) || 0) < 30 * 60e3 ? false : null; }catch(e){ return null; }
  })();

  async function pedir(caminho){
    if(disponivel === false) return null;
    try{
      const r = await fetch(BASE + encodeURIComponent(caminho), {cache:'no-store'});
      if(r.status === 503){
        disponivel = false;
        /* lembra-se durante 30 minutos nesta sessão, também ao recarregar */
        try{ sessionStorage.setItem(CHAVE, String(Date.now())); }catch(e){}
        return null;
      }
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
     Traduções
     --------------------------------------------------------------------- */
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

  return { classificacao, temToken };
})();
