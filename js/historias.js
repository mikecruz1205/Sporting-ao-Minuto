/* =========================================================================
   HISTÓRIAS — a mesma notícia em vários jornais, o selo "Oficial" e a
   linha do tempo dos rumores de cada jogador do plantel.

   Tudo se lê dos títulos que os jornais publicam: agrupam-se os que falam
   do mesmo (as mesmas palavras raras, perto no tempo) e não se escreve
   texto novo. Funções puras — testadas em tests/historias.test.js.
   ========================================================================= */
(function(){
  const semAcentos = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /* palavras que aparecem em quase todos os títulos sobre o Sporting e não
     dizem de que história se trata */
  const VAZIAS = new Set(('sporting leoes leao leonino leonina leoninos alvalade clube equipa jogo jogos jogador jogadores ' +
    'treinador mister futebol liga taca epoca epocas primeira segunda depois antes ainda sobre entre contra para pelo pela ' +
    'pelos pelas como mais menos muito muita quando onde porque tambem esta este estes estas isso isto aqui agora hoje ontem ' +
    'amanha ser sera foram fica ficou tem teve vai vao pode deve diz disse dizem revela revelou garante explica conta quer ' +
    'sobre todo toda todos todas outro outra seus suas nosso nossa minha meu dois tres frente final noite tarde semana ' +
    'grande grandes novo nova novos novas melhor pior ultima ultimo ultimas ultimos video videos fotos imagens veja ' +
    'portugal portugues portuguesa nacional europa europeu europeia champions cp scp verde verdes branco brancos').split(' '));

  /* o plural simples conta como a mesma palavra (conquistas = conquista) */
  const singular = p => p.length > 4 && p.endsWith('s') && !p.endsWith('ss') ? p.slice(0, -1) : p;
  function palavras(titulo){
    return new Set(semAcentos(titulo).replace(/([a-z])-(?=[a-z])/g, '$1').split(/[^a-z0-9]+/)    // guarda-redes é uma palavra
      .filter(p => (p.length >= 4 || /^\d+$/.test(p) && p.length >= 2) && !VAZIAS.has(p))
      .map(singular).filter(p => !VAZIAS.has(p)));
  }

  /* duas notícias contam a mesma história quando partilham pelo menos duas
     palavras raras e essas palavras são boa parte do título mais curto */
  function mesmaHistoria(a, b){
    let comuns = 0;
    a.forEach(p => { if(b.has(p)) comuns++; });
    const menor = Math.min(a.size, b.size);
    return menor > 0 && comuns >= 2 && comuns / menor >= 0.5;
  }

  const JANELA = 36 * 3600e3;          // a mesma história conta-se num dia e meio

  /* lista (mais recente primeiro) → histórias pela mesma ordem:
     { principal, todas: [...] (da mais antiga à mais recente), canais, oficial }
     Uma palavra que aparece em títulos de três ou mais dias (o treinador, o
     adversário da semana) não diz de que história se trata e não conta; a
     palavra de uma notícia grande aparece muitas vezes, mas no mesmo dia ou
     dois. Para entrar numa história, uma notícia tem de se parecer com
     metade das que lá estão (assim não se encadeiam assuntos diferentes). */
  const DIAS_COMUM = 3;
  function agrupar(lista, { janela = JANELA } = {}){
    const conjuntos = lista.map(n => palavras(n.titulo));
    const dias = new Map();
    conjuntos.forEach((c, i) => {
      const dia = new Date(lista[i].data).toDateString();
      c.forEach(p => { if(!dias.has(p)) dias.set(p, new Set()); dias.get(p).add(dia); });
    });
    const grupos = [];
    lista.forEach((n, i) => {
      const p = new Set([...conjuntos[i]].filter(x => dias.get(x).size < DIAS_COMUM));
      const t = +n.data;
      const g = grupos.find(g => g.inicio - t <= janela &&
        g.palavras.filter(q => mesmaHistoria(p, q)).length * 2 >= g.palavras.length);
      if(g){ g.itens.push(n); g.palavras.push(p); g.inicio = Math.min(g.inicio, t); }
      else grupos.push({ itens: [n], palavras: [p], inicio: t });
    });
    return grupos.map(g => ({
      principal: g.itens[0],
      todas: g.itens.slice().sort((a, b) => a.data - b.data),
      canais: [...new Set(g.itens.map(n => n.canal))],
      oficial: g.itens.some(eOficial)
    }));
  }

  /* o jornal escreve no título que é oficial (anunciado pelo clube) */
  const RX_OFICIAL = /\boficial(iza|izou|izado|izada|izam|mente)?\b|comunicado (oficial|do clube|do sporting)/i;
  const RX_NAO_OFICIAL = /n[ãa]o (é |e |foi |ainda )?oficial|oficios|ainda sem confirma/i;
  const eOficial = n => RX_OFICIAL.test(n.titulo || '') && !RX_NAO_OFICIAL.test(n.titulo || '');

  /* ---------------------------------------------------------------------
     RUMORES POR JOGADOR — as notícias de mercado que nomeiam um jogador
     do plantel. O nome completo conta sempre; o apelido sozinho só quando
     é único no plantel e não é um apelido comum (Silva, Santos…).
     --------------------------------------------------------------------- */
  const APELIDOS_COMUNS = new Set(('silva santos costa pereira ferreira oliveira rodrigues martins sousa fernandes ' +
    'goncalves gomes lopes marques alves almeida ribeiro pinto carvalho teixeira moreira correia mendes nunes soares ' +
    'vieira monteiro cardoso rocha neves coelho cruz cunha pires ramos reis simoes antunes matos fonseca machado ' +
    'castro freitas jesus dias lima barbosa henrique junior filho neto').split(' '));
  const escaparRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function regraDoNome(nome, apelidosNoPlantel){
    const chave = semAcentos(nome).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    const partes = chave.split(' ');
    const formas = [chave];
    const ultimo = partes[partes.length - 1];
    if(partes.length > 1 && ultimo.length >= 4 && !APELIDOS_COMUNS.has(ultimo) && apelidosNoPlantel.get(ultimo) === 1)
      formas.push(ultimo);
    if(partes.length === 1 && chave.length < 4) return null;     // alcunha curta demais para procurar
    return new RegExp(`(^|[^a-z])(${formas.map(escaparRx).join('|')})([^a-z]|$)`);
  }

  /* noticias: só as de mercado; nomes: o plantel. → [{ nome, noticias (antiga→recente), canais, desde, ultima }] */
  function rumoresPorJogador(noticias, nomes, { minimo = 2 } = {}){
    const apelidos = new Map();
    nomes.forEach(n => {
      const u = semAcentos(n).replace(/[^a-z ]/g, ' ').trim().split(/\s+/).pop();
      apelidos.set(u, (apelidos.get(u) || 0) + 1);
    });
    const textos = noticias.map(n => semAcentos(n.titulo + ' ' + (n.resumo || '')));
    return nomes.map(nome => {
      const rx = regraDoNome(nome, apelidos);
      if(!rx) return null;
      const delas = noticias.filter((n, i) => rx.test(textos[i])).sort((a, b) => a.data - b.data);
      if(delas.length < minimo) return null;
      return { nome, noticias: delas, canais: [...new Set(delas.map(n => n.canal))],
               desde: delas[0].data, ultima: delas[delas.length - 1].data };
    }).filter(Boolean)
      .sort((a, b) => b.canais.length - a.canais.length || b.ultima - a.ultima);
  }

  window.Historias = { agrupar, eOficial, rumoresPorJogador, _teste: { palavras, mesmaHistoria, regraDoNome } };
})();
