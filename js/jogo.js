/* =========================================================================
   DIA DE JOGO — estado do jogo, onze e acontecimentos
   -------------------------------------------------------------------------
   AVISO SOBRE A ORIGEM DOS DADOS

   Não há aqui nenhuma ligação oficial ao jogo. A API-Football tem eventos
   ao vivo, mas o plano gratuito não os dá. Por isso:

     · o MINUTO é calculado pelo relógio, a partir da hora de início.
       É uma estimativa — não sabe de descontos nem de interrupções.
     · os LANCES (golos, cartões, substituições) são lidos das notícias
       que os jornais publicam ao minuto. Aparecem com algum atraso e
       dependem de quem escreve.
     · o ONZE é extraído da notícia que anuncia a equipa inicial,
       cruzando o texto com os nomes do plantel.

   Tudo o que sai daqui vai identificado como estimativa, para não passar
   por informação oficial.
   ========================================================================= */

const Jogo = (() => {

  /* ---------------------------------------------------------------------
     Em que ponto está o jogo
     --------------------------------------------------------------------- */
  const MINUTO = 60000;

  /* devolve null quando não há jogo à vista */
  function estado(jogos, agora = Date.now()){
    const proximo = [...jogos]
      .filter(j => j.data)
      .map(j => ({ ...j, quando: new Date(j.data).getTime() }))
      .sort((a,b) => a.quando - b.quando)
      .find(j => agora < j.quando + 150 * MINUTO);   // até 2h30 depois do início

    if(!proximo) return null;

    const faltam = proximo.quando - agora;
    const decorrido = -faltam;

    /* ainda longe */
    if(faltam > CONFIG.antecedenciaJogo * MINUTO)
      return { jogo: proximo, fase: 'longe', faltam };

    /* aquecimento: onze já deve estar a sair */
    if(faltam > 0)
      return { jogo: proximo, fase: 'antes', faltam };

    /* a decorrer — minuto estimado pelo relógio */
    const m = Math.floor(decorrido / MINUTO);
    if(m < 45)  return { jogo: proximo, fase: 'parte1', minuto: m + 1 };
    if(m < 60)  return { jogo: proximo, fase: 'intervalo', minuto: 45 };
    if(m < 105) return { jogo: proximo, fase: 'parte2', minuto: m - 15 + 1 };
    if(m < 150) return { jogo: proximo, fase: 'fim', minuto: 90 };
    return null;
  }

  const emJogo = e => e && ['parte1','intervalo','parte2'].includes(e.fase);

  function rotuloMinuto(e){
    if(!e) return '';
    if(e.fase === 'intervalo') return 'INTERVALO';
    if(e.fase === 'fim') return 'FIM';
    if(e.fase === 'antes' || e.fase === 'longe') return '';
    return e.minuto + "'";
  }

  /* ---------------------------------------------------------------------
     O onze, lido da notícia que o anuncia
     --------------------------------------------------------------------- */

  /* A notícia do onze costuma listar os nomes por ordem, do guarda-redes
     para a frente. Procuram-se os nomes do plantel dentro do texto e
     ficam pela ordem em que aparecem. */
  const semAcentos = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');

  /* Por que nome se pode procurar cada jogador.
     O apelido sozinho só serve se for único no plantel: com dois Silva e
     dois Gonçalves, "Silva" apanhava o jogador errado. Nesses casos exige-se
     o nome completo. */
  function chavesDe(plantel){
    const contagem = new Map();
    for(const p of plantel){
      const partes = p.nome.split(' ').filter(Boolean);
      const ap = semAcentos(partes[partes.length-1]);
      contagem.set(ap, (contagem.get(ap) || 0) + 1);
    }
    return plantel.map(p => {
      const partes = p.nome.split(' ').filter(Boolean);
      const ap = semAcentos(partes[partes.length-1]);
      const chaves = [semAcentos(p.nome)];
      if(ALCUNHAS[p.nome]) chaves.push(semAcentos(ALCUNHAS[p.nome]));
      if(contagem.get(ap) === 1) chaves.push(ap);
      /* do mais longo para o mais curto: prefere-se a correspondência exata */
      return { jogador: p, chaves: chaves.filter(c => c.length >= 4)
                                        .sort((a,b) => b.length - a.length) };
    });
  }

  function extrairOnze(texto, plantel){
    if(!texto || !plantel?.length) return [];

    const limpo = ' ' + texto
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ') + ' ';
    const alvo = semAcentos(limpo);

    const achados = [];
    for(const { jogador, chaves } of chavesDe(plantel)){
      let posicao = -1;
      for(const chave of chaves){
        const i = alvo.indexOf(' ' + chave);
        if(i >= 0){ posicao = i; break; }
      }
      if(posicao >= 0) achados.push({ jogador, posicao });
    }

    achados.sort((a,b) => a.posicao - b.posicao);
    return achados.map(a => a.jogador);
  }

  /* separa os que jogam de início dos suplentes, se o texto disser */
  function repartirOnze(texto, plantel){
    const todos = extrairOnze(texto, plantel);
    if(todos.length < 11) return { titulares: todos, suplentes: [] };

    /* muitas notícias escrevem "Suplentes:" a meio */
    const marca = texto.search(/suplentes\s*:|banco\s*:|no banco/i);
    if(marca > 0){
      const antes = texto.slice(0, marca);
      const depois = texto.slice(marca);
      const titulares = extrairOnze(antes, plantel).slice(0, 11);
      const suplentes = extrairOnze(depois, plantel)
        .filter(p => !titulares.includes(p));
      if(titulares.length >= 10) return { titulares, suplentes };
    }
    return { titulares: todos.slice(0, 11), suplentes: todos.slice(11) };
  }

  /* ---------------------------------------------------------------------
     Lances, a partir das notícias
     --------------------------------------------------------------------- */
  /* A ordem conta: o primeiro que bater ganha. O golo vem à frente porque
     um golo de penálti é sobretudo um golo. */
  const TIPOS = [
    { tipo: 'golo',      rx: /gola[çc]o|\bgolo\b|autogolo|marcou|marca o|bisa|hat.?trick|amplia|aumenta a vantagem|empata|reduz|inaugura o marcador|faz o \d\s*[-–x]\s*\d|coloca o sporting/i, icone: '⚽' },
    { tipo: 'vermelho',  rx: /cart[ãa]o vermelho|vermelho direto|expuls/i,            icone: '🟥' },
    { tipo: 'amarelo',   rx: /cart[ãa]o amarelo|amarelo para|ve o amarelo|v[êe] o amarelo/i, icone: '🟨' },
    { tipo: 'troca',     rx: /substitui|entra .{0,30}sai |sai .{0,30}entra |rende/i,  icone: '🔄' },
    { tipo: 'penalti',   rx: /pen[áa]lti|grande penalidade/i,                         icone: '◎' },
    { tipo: 'apito',     rx: /apito final|fim do jogo|intervalo|come[çc]a o jogo|rola a bola/i, icone: '⏱' }
  ];

  function classificarLance(titulo){
    for(const t of TIPOS) if(t.rx.test(titulo)) return t;
    return null;
  }

  /* quem marcou, se o título disser — mesma regra de apelidos únicos */
  function quemMarcou(titulo, plantel){
    if(!plantel?.length) return null;
    const alvo = semAcentos(titulo);
    let melhor = null;
    for(const { jogador, chaves } of chavesDe(plantel)){
      for(const chave of chaves){
        if(!alvo.includes(chave)) continue;
        /* entre vários que batam, fica o nome mais longo: é o mais preciso */
        if(!melhor || chave.length > melhor.tamanho)
          melhor = { jogador, tamanho: chave.length };
        break;
      }
    }
    return melhor?.jogador || null;
  }

  /* Filtra as notícias que falam do jogo em curso e transforma-as em
     lances. Só entram as publicadas depois do apontapé de saída. */
  function lances(noticias, e, plantel){
    if(!e || !emJogo(e)) return [];
    const inicio = new Date(e.jogo.data).getTime();

    return noticias
      .filter(n => n.data.getTime() >= inicio - 5 * MINUTO)
      .filter(n => CONFIG.filtroLance.test(n.titulo))
      .map(n => {
        const t = classificarLance(n.titulo);
        if(!t) return null;
        const minuto = Math.max(1, Math.floor((n.data.getTime() - inicio) / MINUTO));
        return {
          tipo: t.tipo, icone: t.icone, minuto,
          titulo: n.titulo, fonte: n.fonte, link: n.link, data: n.data,
          jogador: t.tipo === 'golo' ? quemMarcou(n.titulo, plantel) : null
        };
      })
      .filter(Boolean)
      .sort((a,b) => b.data - a.data);
  }

  return { estado, emJogo, rotuloMinuto, extrairOnze, repartirOnze, lances, classificarLance };
})();
