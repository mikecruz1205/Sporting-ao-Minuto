/* =========================================================================
   QUIZ LEONINO e DESAFIO DO DIA
   -------------------------------------------------------------------------
   As perguntas estão em dados/quiz.json, cada uma com a fonte de onde o
   facto foi tirado (verificar com scripts/validar_quiz.py). Nada aqui
   inventa factos: o jogo só baralha, conta pontos e mostra a explicação.

   Quiz: 15 perguntas a subir de dificuldade (1–5 fáceis, 6–10 médias,
   11–15 difíceis), três ajudas, escada de pontos com patamares seguros
   nas perguntas 5 e 10 e a opção de parar com o que já se ganhou.
   O recorde fica neste browser e, com conta, também na conta
   (quiz_guardar_recorde no Supabase).

   Desafio do Dia: uma pergunta por dia, igual para todos, escolhida pela
   data de Lisboa; uma resposta por dia, sequência de dias certos e
   partilha do resultado sem a resposta.
   ========================================================================= */

/* ---------------------------------------------------------------- o motor (sem página) */
const QuizMotor = (() => {
  const ESCADA = [10, 20, 30, 50, 100, 150, 200, 300, 450, 600, 800, 1000, 1250, 1500, 1906];
  const PATAMARES = [4, 9];                       // perguntas 5 e 10 (índices)
  const NIVEIS = ['facil', 'media', 'dificil'];
  const POR_NIVEL = 5;
  const nivelDe = i => NIVEIS[Math.floor(i / POR_NIVEL)];

  /* gerador com semente (mulberry32): o Desafio do Dia tem de dar o mesmo a toda a gente */
  function semente(n){
    let a = n >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function baralhar(lista, aleatorio = Math.random){
    const a = [...lista];
    for(let i = a.length - 1; i > 0; i--){
      const j = Math.floor(aleatorio() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* as opções aparecem por ordem aleatória; a certa acompanha-as */
  function prepararPergunta(p, aleatorio = Math.random){
    const ordem = baralhar([0, 1, 2, 3], aleatorio);
    return { ...p, opcoes: ordem.map(k => p.opcoes[k]), correta: ordem.indexOf(p.correta) };
  }

  function novoJogo(banco, aleatorio = Math.random){
    const porNivel = Object.fromEntries(NIVEIS.map(n => [n, baralhar(banco.filter(p => p.dificuldade === n), aleatorio)]));
    NIVEIS.forEach(n => { if(porNivel[n].length < POR_NIVEL) throw new Error(`faltam perguntas ${n}`); });
    const perguntas = NIVEIS.flatMap(n => porNivel[n].slice(0, POR_NIVEL)).map(p => prepararPergunta(p, aleatorio));
    const reservas = Object.fromEntries(NIVEIS.map(n => [n, porNivel[n].slice(POR_NIVEL)]));
    return { perguntas, reservas, i: 0, estado: 'a-jogar', pontos: 0, escondidas: [], publico: null,
             ajudas: { metade: true, trocar: true, publico: true }, certas: 0, ultima: null };
  }

  const atual = jogo => jogo.perguntas[jogo.i];
  const garantidos = i => [...PATAMARES].reverse().find(k => i > k) != null ? ESCADA[[...PATAMARES].reverse().find(k => i > k)] : 0;
  const ganhos = i => i > 0 ? ESCADA[i - 1] : 0;

  /* responder: certa → sobe um degrau (na 15.ª ganha o jogo); errada → fica com o último patamar seguro */
  function responder(jogo, escolha){
    if(jogo.estado !== 'a-jogar') return jogo;
    const p = atual(jogo);
    const certo = escolha === p.correta;
    jogo.ultima = { pergunta: p, escolha, certo };
    if(certo){
      jogo.certas++;
      jogo.pontos = ESCADA[jogo.i];
      if(jogo.i === ESCADA.length - 1){ jogo.estado = 'ganhou'; }
      else { jogo.estado = 'certa'; }
    }else{
      jogo.pontos = garantidos(jogo.i);
      jogo.estado = 'errou';
    }
    return jogo;
  }
  function seguinte(jogo){
    if(jogo.estado !== 'certa') return jogo;
    jogo.i++;
    jogo.estado = 'a-jogar';
    jogo.escondidas = [];
    jogo.publico = null;
    return jogo;
  }
  /* parar: leva os pontos da última pergunta certa */
  function desistir(jogo){
    if(jogo.estado !== 'a-jogar') return jogo;
    jogo.pontos = ganhos(jogo.i);
    jogo.estado = 'desistiu';
    return jogo;
  }

  /* 50:50 — tira duas das erradas */
  function usarMetade(jogo, aleatorio = Math.random){
    if(!jogo.ajudas.metade || jogo.estado !== 'a-jogar') return jogo;
    const p = atual(jogo);
    const erradas = [0, 1, 2, 3].filter(k => k !== p.correta);
    jogo.escondidas = baralhar(erradas, aleatorio).slice(0, 2);
    jogo.ajudas.metade = false;
    if(jogo.publico) jogo.publico = votosDoPublico(p, jogo.escondidas, nivelDe(jogo.i), aleatorio);
    return jogo;
  }
  /* trocar — outra pergunta da mesma dificuldade */
  function usarTrocar(jogo, aleatorio = Math.random){
    if(!jogo.ajudas.trocar || jogo.estado !== 'a-jogar') return jogo;
    const nivel = nivelDe(jogo.i);
    const nova = jogo.reservas[nivel].shift();
    if(!nova) return jogo;
    jogo.perguntas[jogo.i] = prepararPergunta(nova, aleatorio);
    jogo.ajudas.trocar = false;
    jogo.escondidas = [];
    jogo.publico = null;
    return jogo;
  }
  /* ajuda do público — percentagens plausíveis (simuladas): a certa costuma
     ganhar, mais nas fáceis do que nas difíceis, mas nem sempre por muito */
  function votosDoPublico(p, escondidas = [], nivel = 'facil', aleatorio = Math.random){
    const visiveis = [0, 1, 2, 3].filter(k => !escondidas.includes(k));
    const [min, max] = { facil: [55, 80], media: [40, 65], dificil: [30, 52] }[nivel];
    const votos = [0, 0, 0, 0];
    const certa = Math.round(min + aleatorio() * (max - min));
    const resto = 100 - certa;
    const outras = visiveis.filter(k => k !== p.correta);
    const pesos = outras.map(() => 0.2 + aleatorio());
    const soma = pesos.reduce((s, x) => s + x, 0);
    let dados = 0;
    outras.forEach((k, j) => {
      votos[k] = j === outras.length - 1 ? resto - dados : Math.round(resto * pesos[j] / soma);
      dados += votos[k];
    });
    votos[p.correta] = certa;
    return votos;
  }
  function usarPublico(jogo, aleatorio = Math.random){
    if(!jogo.ajudas.publico || jogo.estado !== 'a-jogar') return jogo;
    jogo.publico = votosDoPublico(atual(jogo), jogo.escondidas, nivelDe(jogo.i), aleatorio);
    jogo.ajudas.publico = false;
    return jogo;
  }

  /* ---------------------------------------------------------------- Desafio do Dia */
  const INICIO_DESAFIO = '2026-10-16';                       // Desafio n.º 1
  const SEMENTE_DESAFIO = 1906;
  /* a data de hoje em Lisboa, no formato AAAA-MM-DD */
  const dataLisboa = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
  const numeroDoDesafio = iso => diasEntre(INICIO_DESAFIO, iso) + 1;
  /* todos os dias do mesmo ciclo usam uma ordem baralhada com semente fixa:
     igual para toda a gente, sem repetir antes de o banco acabar */
  function perguntaDoDia(banco, iso){
    const lista = [...banco].sort((a, b) => a.id.localeCompare(b.id));
    const n = diasEntre(INICIO_DESAFIO, iso);
    const ciclo = Math.floor(n / lista.length), dentro = ((n % lista.length) + lista.length) % lista.length;
    const ordem = baralhar(lista, semente(SEMENTE_DESAFIO + ciclo));
    return ordem[dentro];
  }
  /* dias seguidos certos, a contar de hoje (ou de ontem, se hoje ainda não respondeu) */
  function sequencia(registos, hoje){
    let dia = hoje, n = 0;
    if(!(dia in registos)) dia = diaAntes(dia);
    while(registos[dia] === true){ n++; dia = diaAntes(dia); }
    return n;
  }
  const diaAntes = iso => new Date(Date.parse(iso + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  /* texto para partilhar: diz se acertou, não diz a resposta */
  function textoPartilha({ numero, certo, seq, url }){
    return `Desafio do Dia n.º ${numero} do Sporting ao Minuto: ${certo ? '✅ acertei' : '❌ desta vez não'}`
      + `${seq > 1 ? ` · ${seq} dias seguidos` : ''} 🦁\nConsegues? ${url}`;
  }

  return { ESCADA, PATAMARES, NIVEIS, nivelDe, semente, baralhar, prepararPergunta, novoJogo, responder, seguinte, desistir,
           usarMetade, usarTrocar, usarPublico, votosDoPublico, garantidos, ganhos,
           INICIO_DESAFIO, dataLisboa, numeroDoDesafio, perguntaDoDia, sequencia, diaAntes, textoPartilha };
})();

/* ---------------------------------------------------------------- banco e recorde (comuns) */
const QuizDados = (() => {
  let banco = null, aLer = null;
  const CATEGORIAS = { historia: 'História', titulos: 'Títulos', jogadores: 'Jogadores', estadio: 'Estádio',
                       modalidades: 'Modalidades', presidentes: 'Presidentes' };
  async function ler(){
    if(banco) return banco;
    aLer ||= fetch('dados/quiz.json?v=' + (document.querySelector('script[src*="quiz.js"]')?.src.split('v=')[1] || '1'))
      .then(r => { if(!r.ok) throw new Error('banco de perguntas'); return r.json(); })
      .then(d => (banco = d.perguntas))
      .finally(() => { aLer = null; });
    return aLer;
  }
  /* recorde: o maior entre o deste browser e o da conta */
  const CHAVE = 'scp-quiz-recorde';
  const local = () => { try{ return Number(JSON.parse(localStorage.getItem(CHAVE) || 'null')?.pontos) || 0; }catch(e){ return 0; } };
  async function recorde(){
    let melhor = local(), daConta = null;
    const db = window.Nuvem?.cliente, eu = window.Nuvem?.perfil;
    if(db && eu){
      try{
        const { data, error } = await db.from('quiz_recordes').select('melhor').eq('perfil_id', eu.id).maybeSingle();
        if(!error) daConta = data?.melhor ?? 0;
      }catch(e){}
    }
    if(daConta != null) melhor = Math.max(melhor, daConta);
    return { melhor, naConta: daConta != null };
  }
  async function guardar(pontos){
    try{ if(pontos > local()) localStorage.setItem(CHAVE, JSON.stringify({ pontos, data: new Date().toISOString() })); }catch(e){}
    const db = window.Nuvem?.cliente, eu = window.Nuvem?.perfil;
    if(!db || !eu) return { conta: false };
    try{
      const { data, error } = await db.rpc('quiz_guardar_recorde', { p_pontos: pontos });
      return error ? { conta: false, erro: true } : { conta: true, melhor: data?.melhor };
    }catch(e){ return { conta: false, erro: true }; }
  }
  return { ler, recorde, guardar, CATEGORIAS };
})();

/* ---------------------------------------------------------------- QUIZ (página) */
const Quiz = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const seguro = t => Componentes.seguro(t);
  const M = QuizMotor;
  const LETRAS = ['A', 'B', 'C', 'D'];
  const NOME_NIVEL = { facil: 'Fácil', media: 'Média', dificil: 'Difícil' };
  let raiz = null, jogo = null, melhor = 0, naConta = false, ligado = false, aviso = '';

  const pontos = n => `${n.toLocaleString('pt-PT')} pts`;

  function escada(){
    return `<ol class="qz-escada" aria-label="Escada de pontos">
      ${M.ESCADA.map((v, i) => ({ v, i })).reverse().map(({ v, i }) => {
        const seguro = M.PATAMARES.includes(i);
        const estado = !jogo ? '' : i < jogo.i || (i === jogo.i && ['certa', 'ganhou'].includes(jogo.estado)) ? 'is-feito'
          : i === jogo.i ? 'is-agora' : '';
        return `<li class="qz-degrau ${seguro ? 'is-seguro' : ''} ${estado}" ${estado === 'is-agora' ? 'aria-current="step"' : ''}>
          <span class="qz-degrau__n">${i + 1}</span><span class="qz-degrau__v">${pontos(v)}</span>${seguro ? '<span class="qz-degrau__seg" title="Patamar seguro">seguro</span>' : ''}</li>`;
      }).join('')}
    </ol>`;
  }

  function inicio(){
    return `<div class="qz-inicio">
      <div class="qz-inicio__texto">
        <p class="qz-sobre">Minijogo do Sporting ao Minuto</p>
        <h2 class="qz-titulo" id="qz-titulo">Quiz Leonino</h2>
        <p class="qz-lead">15 perguntas sobre o Sporting CP, das fáceis às difíceis: história, títulos, jogadores, estádio, modalidades e presidentes.</p>
        <ul class="qz-regras">
          <li><b>Escada de pontos</b>: cada resposta certa sobe um degrau, até aos ${pontos(M.ESCADA[14])}.</li>
          <li><b>Patamares seguros</b> nas perguntas 5 (${pontos(M.ESCADA[4])}) e 10 (${pontos(M.ESCADA[9])}): se errares depois, ficas com eles.</li>
          <li><b>Três ajudas</b>, uma vez cada: 50:50, trocar a pergunta e ajuda do público.</li>
          <li><b>Podes parar</b> antes de responder e ficar com o que já ganhaste.</li>
        </ul>
        <button type="button" class="qz-botao qz-botao--forte" data-qz="comecar">Começar</button>
        <p class="qz-recorde">O teu recorde: <b>${pontos(melhor)}</b>${naConta ? ' · guardado na tua conta' : ' · guardado neste browser'}</p>
        ${aviso ? `<p class="qz-aviso" role="alert">${seguro(aviso)}</p>` : ''}
      </div>
      ${escada()}
    </div>`;
  }

  function cartaoPergunta(){
    const p = jogo.perguntas[jogo.i];
    const nivel = M.nivelDe(jogo.i);
    const respondida = jogo.estado !== 'a-jogar';
    return `<div class="qz-jogo">
      <div class="qz-jogo__principal">
        <div class="qz-topo">
          <span class="qz-n">Pergunta ${jogo.i + 1} de 15</span>
          <span class="qz-etiqueta qz-etiqueta--${nivel}">${NOME_NIVEL[nivel]}</span>
          <span class="qz-etiqueta">${seguro(QuizDados.CATEGORIAS[p.categoria] || p.categoria)}</span>
          <span class="qz-vale">vale ${pontos(M.ESCADA[jogo.i])}</span>
        </div>
        <h2 class="qz-pergunta" id="qz-pergunta" tabindex="-1">${seguro(p.pergunta)}</h2>
        <div class="qz-opcoes" role="group" aria-labelledby="qz-pergunta">
          ${p.opcoes.map((o, k) => {
            const escondida = jogo.escondidas.includes(k);
            const classe = !respondida ? '' : k === p.correta ? 'is-certa' : k === jogo.ultima?.escolha ? 'is-errada' : 'is-apagada';
            return `<button type="button" class="qz-opcao ${classe}" data-qz-opcao="${k}" ${escondida || respondida ? 'disabled' : ''}
                      ${escondida ? 'aria-hidden="true"' : ''} aria-keyshortcuts="${k + 1} ${LETRAS[k]}">
              <span class="qz-opcao__letra" aria-hidden="true">${LETRAS[k]}</span>
              <span class="qz-opcao__texto">${escondida ? '' : seguro(o)}</span>
              ${jogo.publico && !escondida ? `<span class="qz-opcao__voto" style="--p:${jogo.publico[k]}%" aria-hidden="true"></span><span class="qz-opcao__pct">${jogo.publico[k]}%<span class="so-leitor"> do público</span></span>` : ''}
            </button>`;
          }).join('')}
        </div>
        ${jogo.publico ? `<p class="qz-nota">Ajuda do público (simulada): as percentagens estão em cada resposta.</p>` : ''}
        ${respondida ? retorno() : `<div class="qz-ajudas" role="group" aria-label="Ajudas">
          <button type="button" class="qz-ajuda" data-qz="metade" ${jogo.ajudas.metade ? '' : 'disabled'}>50:50</button>
          <button type="button" class="qz-ajuda" data-qz="trocar" ${jogo.ajudas.trocar && jogo.reservas[nivel].length ? '' : 'disabled'}>Trocar pergunta</button>
          <button type="button" class="qz-ajuda" data-qz="publico" ${jogo.ajudas.publico ? '' : 'disabled'}>Ajuda do público</button>
          <button type="button" class="qz-ajuda qz-ajuda--parar" data-qz="desistir">Parar com ${pontos(M.ganhos(jogo.i))}</button>
        </div>`}
      </div>
      ${escada()}
    </div>`;
  }

  /* depois de responder: certo/errado, a explicação e a fonte */
  function retorno(){
    const { pergunta: p, certo } = jogo.ultima;
    const fim = jogo.estado !== 'certa';
    return `<div class="qz-retorno ${certo ? 'is-certo' : 'is-errado'}" role="status">
      <p class="qz-retorno__titulo">${certo ? (jogo.estado === 'ganhou' ? 'Certo — e chegaste ao topo da escada!' : 'Certo!') : `Errado. A resposta certa era «${seguro(p.opcoes[p.correta])}».`}</p>
      ${p.explicacao ? `<p>${seguro(p.explicacao)}</p>` : ''}
      <p class="qz-fonte">Fonte: <a href="${seguro(p.fonte.url)}" target="_blank" rel="noopener">${seguro(p.fonte.nome)}</a></p>
      <button type="button" class="qz-botao qz-botao--forte" data-qz="${fim ? 'fim' : 'seguinte'}">${fim ? 'Ver o resultado' : 'Pergunta seguinte'}</button>
    </div>`;
  }

  function fimDeJogo(){
    const titulo = jogo.estado === 'ganhou' ? 'Chegaste ao topo da escada!'
      : jogo.estado === 'desistiu' ? 'Paraste a tempo' : 'Fim do jogo';
    return `<div class="qz-fim" role="status">
      <p class="qz-sobre">Quiz Leonino</p>
      <h2 class="qz-titulo" id="qz-titulo" tabindex="-1">${titulo}</h2>
      <p class="qz-fim__pontos"><b>${pontos(jogo.pontos)}</b></p>
      <p>Acertaste ${jogo.certas} de ${Math.min(15, jogo.i + (['certa', 'ganhou'].includes(jogo.estado) ? 1 : jogo.estado === 'desistiu' ? 0 : 1))} perguntas.
        ${jogo.pontos > 0 && jogo.pontos >= melhor ? '<b>Novo recorde!</b>' : `O teu recorde: ${pontos(melhor)}.`}</p>
      ${aviso ? `<p class="qz-aviso">${seguro(aviso)}</p>` : ''}
      <div class="qz-fim__acoes">
        <button type="button" class="qz-botao qz-botao--forte" data-qz="comecar">Jogar outra vez</button>
        <button type="button" class="qz-botao" data-ir="desafio">Desafio do Dia</button>
      </div>
    </div>`;
  }

  function pintar({ foco = false } = {}){
    if(!raiz) return;
    raiz.innerHTML = !jogo ? inicio()
      : ['a-jogar', 'certa'].includes(jogo.estado) || (jogo.ultima && !jogo.terminado) ? cartaoPergunta()
      : fimDeJogo();
    if(foco) ($('#qz-pergunta', raiz) || $('#qz-titulo', raiz))?.focus();
  }

  async function terminar(){
    jogo.terminado = true;
    const antes = melhor;
    melhor = Math.max(melhor, jogo.pontos);
    aviso = '';
    pintar({ foco: true });
    const r = await QuizDados.guardar(jogo.pontos);
    if(r.erro) aviso = 'O recorde ficou guardado neste browser, mas não foi possível guardá-lo na tua conta.';
    else if(r.conta) naConta = true;
    if(r.melhor != null) melhor = Math.max(melhor, r.melhor);
    if(aviso || melhor !== antes) pintar();
  }

  function ligar(){
    raiz.addEventListener('click', async ev => {
      const b = ev.target.closest('button');
      if(!b || b.disabled) return;
      if(b.dataset.qzOpcao != null){
        M.responder(jogo, Number(b.dataset.qzOpcao));
        if(jogo.estado === 'ganhou' || jogo.estado === 'errou'){ melhor = Math.max(melhor, 0); }
        pintar();
        $('.qz-retorno button', raiz)?.focus();
        return;
      }
      switch(b.dataset.qz){
        case 'comecar':
          try{ jogo = M.novoJogo(await QuizDados.ler()); aviso = ''; }
          catch(e){ aviso = 'Não foi possível carregar as perguntas. Verifica a ligação e tenta outra vez.'; jogo = null; }
          pintar({ foco: true });
          break;
        case 'seguinte': M.seguinte(jogo); pintar({ foco: true }); break;
        case 'fim': terminar(); break;
        case 'metade': M.usarMetade(jogo); pintar(); $('.qz-opcao:not([disabled])', raiz)?.focus(); break;
        case 'trocar': M.usarTrocar(jogo); pintar({ foco: true }); break;
        case 'publico': M.usarPublico(jogo); pintar(); break;
        case 'desistir': M.desistir(jogo); terminar(); break;
      }
    });
    /* teclado: 1–4 ou A–D escolhem a resposta */
    document.addEventListener('keydown', e => {
      if(!raiz?.offsetParent || !jogo || jogo.estado !== 'a-jogar') return;
      if(e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select')) return;
      const k = '1234'.indexOf(e.key) >= 0 ? '1234'.indexOf(e.key) : 'abcd'.indexOf(e.key.toLowerCase());
      if(k < 0 || e.key.length !== 1) return;
      const b = raiz.querySelector(`[data-qz-opcao="${k}"]`);
      if(b && !b.disabled){ e.preventDefault(); b.click(); }
    });
  }

  async function abrir(){
    raiz = raiz || document.getElementById('quiz');
    if(!raiz) return;
    if(!ligado){ ligado = true; ligar(); }
    if(!jogo || jogo.terminado){
      const r = await QuizDados.recorde();
      melhor = r.melhor; naConta = r.naConta;
      if(jogo?.terminado) jogo = null;
    }
    pintar();
  }

  return { abrir, recorde: () => melhor };
})();

/* ---------------------------------------------------------------- DESAFIO DO DIA (página e cartão) */
const Desafio = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const seguro = t => Componentes.seguro(t);
  const M = QuizMotor;
  const CHAVE = 'scp-desafio';
  const LETRAS = ['A', 'B', 'C', 'D'];
  let raiz = null, ligado = false;

  const registos = () => { try{ return JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; }catch(e){ return {}; } };
  const respostas = () => { try{ return JSON.parse(localStorage.getItem(CHAVE + '-escolhas') || '{}') || {}; }catch(e){ return {}; } };
  function gravar(iso, certo, escolha){
    try{
      const r = registos(); r[iso] = certo; localStorage.setItem(CHAVE, JSON.stringify(r));
      const e = respostas(); e[iso] = escolha; localStorage.setItem(CHAVE + '-escolhas', JSON.stringify(e));
    }catch(e){}
  }
  /* as opções do dia baralhadas de forma igual para todos (semente = n.º do desafio) */
  function doDia(banco, iso){
    const p = M.perguntaDoDia(banco, iso);
    return M.prepararPergunta(p, M.semente(M.numeroDoDesafio(iso) * 7919));
  }
  const URL_DESAFIO = () => location.origin + '/desafio';

  async function pintar(){
    if(!raiz) return;
    let banco;
    try{ banco = await QuizDados.ler(); }
    catch(e){
      raiz.innerHTML = `<div class="estado-falha" role="alert"><p><b>Não foi possível carregar o desafio de hoje.</b></p>
        <p>Verifica a ligação à internet e tenta outra vez.</p><button type="button" class="botao-tentar" data-dz="tentar">Tentar outra vez</button></div>`;
      return;
    }
    const hoje = M.dataLisboa();
    const numero = M.numeroDoDesafio(hoje);
    const p = doDia(banco, hoje);
    const reg = registos();
    const respondido = hoje in reg;
    const escolha = respostas()[hoje];
    const seq = M.sequencia(reg, hoje);
    raiz.innerHTML = `<div class="dz">
      <div class="dz__topo">
        <span class="qz-etiqueta">Desafio n.º ${numero}</span>
        <span class="qz-etiqueta">${seguro(QuizDados.CATEGORIAS[p.categoria] || p.categoria)}</span>
        <time datetime="${hoje}">${new Date(hoje + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' })}</time>
        <span class="dz__seq" title="Dias seguidos com a resposta certa">🔥 ${seq} ${seq === 1 ? 'dia seguido' : 'dias seguidos'}</span>
      </div>
      <h2 class="qz-pergunta" id="dz-pergunta" tabindex="-1">${seguro(p.pergunta)}</h2>
      <div class="qz-opcoes" role="group" aria-labelledby="dz-pergunta">
        ${p.opcoes.map((o, k) => {
          const classe = !respondido ? '' : k === p.correta ? 'is-certa' : k === escolha ? 'is-errada' : 'is-apagada';
          return `<button type="button" class="qz-opcao ${classe}" data-dz-opcao="${k}" ${respondido ? 'disabled' : ''}>
            <span class="qz-opcao__letra" aria-hidden="true">${LETRAS[k]}</span><span class="qz-opcao__texto">${seguro(o)}</span></button>`;
        }).join('')}
      </div>
      ${respondido ? `<div class="qz-retorno ${reg[hoje] ? 'is-certo' : 'is-errado'}" role="status">
          <p class="qz-retorno__titulo">${reg[hoje] ? 'Certo!' : `Desta vez não. A resposta certa era «${seguro(p.opcoes[p.correta])}».`}</p>
          ${p.explicacao ? `<p>${seguro(p.explicacao)}</p>` : ''}
          <p class="qz-fonte">Fonte: <a href="${seguro(p.fonte.url)}" target="_blank" rel="noopener">${seguro(p.fonte.nome)}</a></p>
          <div class="qz-fim__acoes">
            <button type="button" class="qz-botao qz-botao--forte" data-dz="partilhar">Partilhar o resultado</button>
            <button type="button" class="qz-botao" data-ir="quiz">Jogar o Quiz Leonino</button>
          </div>
          <p class="qz-nota" id="dz-partilha" aria-live="polite">A partilha diz se acertaste, não diz a resposta. Amanhã há outra pergunta.</p>
        </div>`
        : `<p class="qz-nota">Uma resposta por dia. A pergunta muda à meia-noite (hora de Lisboa) e é igual para toda a gente.</p>
           <button type="button" class="qz-botao" data-dz="convidar">Desafiar um amigo</button>
           <p class="qz-nota" id="dz-partilha" aria-live="polite"></p>`}
    </div>`;
  }

  async function partilhar(texto){
    const aviso = $('#dz-partilha', raiz);
    try{
      if(navigator.share){ await navigator.share({ text: texto }); return; }
      await navigator.clipboard.writeText(texto);
      if(aviso) aviso.textContent = 'Copiado — já podes colar onde quiseres.';
    }catch(e){ /* cancelado */ }
  }

  function ligar(){
    raiz.addEventListener('click', async ev => {
      const b = ev.target.closest('button');
      if(!b || b.disabled) return;
      if(b.dataset.dzOpcao != null){
        const banco = await QuizDados.ler();
        const hoje = M.dataLisboa();
        if(hoje in registos()) return;                         // uma resposta por dia
        const p = doDia(banco, hoje);
        const k = Number(b.dataset.dzOpcao);
        gravar(hoje, k === p.correta, k);
        await pintar();
        $('.qz-retorno', raiz)?.focus?.();
        pintarCartao();
        return;
      }
      if(b.dataset.dz === 'tentar'){ pintar(); return; }
      if(b.dataset.dz === 'partilhar' || b.dataset.dz === 'convidar'){
        const hoje = M.dataLisboa(), reg = registos();
        const texto = b.dataset.dz === 'convidar'
          ? `Desafio do Dia n.º ${M.numeroDoDesafio(hoje)} do Sporting ao Minuto: uma pergunta sobre o Sporting por dia 🦁 ${URL_DESAFIO()}`
          : M.textoPartilha({ numero: M.numeroDoDesafio(hoje), certo: reg[hoje], seq: M.sequencia(reg, hoje), url: URL_DESAFIO() });
        partilhar(texto);
      }
    });
  }

  /* cartão da página inicial: a pergunta de hoje (sem a resposta) e o estado */
  async function pintarCartao(){
    const alvo = document.getElementById('comu-desafio-corpo');
    if(!alvo) return;
    try{
      const banco = await QuizDados.ler();
      const hoje = M.dataLisboa();
      const p = doDia(banco, hoje), reg = registos();
      const seq = M.sequencia(reg, hoje);
      alvo.innerHTML = `
        <p class="comu__linha"><b>N.º ${M.numeroDoDesafio(hoje)}</b> · ${seguro(QuizDados.CATEGORIAS[p.categoria] || p.categoria)}</p>
        <p class="comu__pergunta">${seguro(p.pergunta)}</p>
        <p class="comu__linha">${hoje in reg ? (reg[hoje] ? '✅ Já acertaste hoje' : '❌ Já respondeste hoje') : 'Ainda não respondeste hoje'}${seq ? ` · 🔥 ${seq} ${seq === 1 ? 'dia seguido' : 'dias seguidos'}` : ''}</p>
        <div class="comu__acoes"><button type="button" class="p1" data-ir="desafio">${hoje in reg ? 'Ver a explicação' : 'Responder'}</button></div>`;
    }catch(e){
      alvo.innerHTML = `<div class="estado-falha estado-falha--curto" role="alert"><p>Não foi possível carregar o desafio de hoje.</p>
        <button type="button" class="botao-tentar" data-tentar="desafio">Tentar outra vez</button></div>`;
    }
    alvo.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => window.irParaVista?.(b.dataset.ir)));
  }

  function abrir(){
    raiz = raiz || document.getElementById('desafio');
    if(!raiz) return;
    if(!ligado){ ligado = true; ligar(); }
    pintar();
  }

  return { abrir, pintarCartao };
})();

window.QuizMotor = QuizMotor;
window.QuizDados = QuizDados;
window.Quiz = Quiz;
window.Desafio = Desafio;
