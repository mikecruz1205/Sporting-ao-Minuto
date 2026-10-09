/* =========================================================================
   CENTRO DE JOGO — um serviço central e a vista "Centro de jogo"
   -------------------------------------------------------------------------
   Um único serviço pede /api/jogo (camada normalizada no servidor, ver
   api/_jogo.py) e avisa quem estiver a ouvir: a faixa do topo, o cartaz da
   página inicial e esta vista. Cada jogo seguido tem um só pedido em curso,
   por muitos sítios que o mostrem.

   Regras (não negociáveis):
     · o minuto e o estado "Em direto" só aparecem se a FONTE os der; não
       há cronómetro local a andar sozinho;
     · os eventos substituem-se em bloco a cada leitura (nada se duplica);
     · se a fonte falhar, mostra-se a última leitura com a hora dela e o
       aviso de que está desatualizada;
     · sem fonte: "Dados em direto indisponíveis" e ligações para fora.

   Ritmo: o servidor diz quando voltar (20 s em direto, 60 s perto da
   hora, 6 h depois do fim). Com o separador escondido não se pede nada;
   sem rede, espera-se pela rede; com erros, espera-se cada vez mais.
   ========================================================================= */

const CentroJogo = (() => {

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const seguro = t => Componentes.seguro(t == null ? '' : String(t));
  const H = 3600e3;

  let ctx = null;                 // ligações ao app.js (emblemas, notícias, tabela…)

  /* =====================================================================
     1. SERVIÇO — um "seguimento" por jogo
     ===================================================================== */
  const seguimentos = new Map();   // chave → { jogo, dados, lidoEm, erro, falhas, aLer, timer, idFonte, ouvintes }
  const chave = j => j ? `${j.data}|${j.casa}|${j.fora}` : '';
  const jogado = j => j && j.golosCasa != null && j.golosFora != null;

  function observar(jogo, ouvinte){
    if(!jogo) return () => {};
    const k = chave(jogo);
    let s = seguimentos.get(k);
    if(!s){
      s = { jogo, dados: null, lidoEm: null, erro: null, falhas: 0, aLer: false, timer: null, idFonte: null, ouvintes: new Set() };
      seguimentos.set(k, s);
      agendar(s, true);
    }else{
      s.jogo = jogo;            // o calendário pode ter trazido o resultado entretanto
    }
    s.ouvintes.add(ouvinte);
    ouvinte(situacao(s));
    return () => {
      s.ouvintes.delete(ouvinte);
      if(!s.ouvintes.size){ clearTimeout(s.timer); seguimentos.delete(k); }
    };
  }

  const avisar = s => s.ouvintes.forEach(f => { try{ f(situacao(s)); }catch(e){ console.error('centro:', e); } });

  async function ler(s){
    if(s.aLer) return;
    if(navigator.onLine === false){ s.erro = 'offline'; avisar(s); return; }
    s.aLer = true; avisar(s);
    const ctrl = new AbortController();
    const limite = setTimeout(() => ctrl.abort(), 15000);
    try{
      const q = new URLSearchParams({ data: new Date(s.jogo.data).toISOString(), casa: s.jogo.casa, fora: s.jogo.fora });
      if(s.idFonte) q.set('id', s.idFonte);
      const r = await fetch('/api/jogo?' + q, { signal: ctrl.signal });
      if(!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      s.dados = d; s.lidoEm = new Date(); s.erro = null; s.falhas = 0;
      s.idFonte = d.ids?.af || d.ids?.fd || s.idFonte;
    }catch(e){
      s.erro = navigator.onLine === false ? 'offline' : e.name === 'AbortError' ? 'tempo' : 'servidor';
      s.falhas++;
    }finally{
      clearTimeout(limite);
      s.aLer = false;
      if(seguimentos.get(chave(s.jogo)) === s){ avisar(s); agendar(s); }
    }
  }

  function agendar(s, primeiro = false){
    clearTimeout(s.timer); s.timer = null;
    if(document.hidden) return;
    const falta = new Date(s.jogo.data) - Date.now();
    /* longe do jogo não há nada para pedir: acorda-se 3 h antes */
    if(falta > 3 * H){
      s.timer = setTimeout(() => ler(s), Math.min(falta - 3 * H, 2 ** 31 - 1));
      return;
    }
    if(primeiro){ ler(s); return; }
    const fim = s.dados?.estado?.codigo === 'terminado' ||
                (falta < -4 * H && !s.erro && s.dados);            // já passou e já se perguntou
    if(fim) return;
    let ms = (s.dados?.proxima_atualizacao_s || 60) * 1000;
    if(s.erro) ms = s.erro === 'offline' ? 0 : Math.min(300e3, 15e3 * 2 ** Math.min(s.falhas, 5));
    if(ms) s.timer = setTimeout(() => ler(s), Math.max(10e3, ms));
  }

  /* separador escondido: pára; volta a aparecer: lê logo se já passou a hora */
  document.addEventListener('visibilitychange', () => {
    seguimentos.forEach(s => {
      if(document.hidden){ clearTimeout(s.timer); s.timer = null; return; }
      const intervalo = (s.dados?.proxima_atualizacao_s || 60) * 1000;
      if(!s.lidoEm || Date.now() - s.lidoEm > intervalo) agendar(s, true); else agendar(s);
    });
  });
  addEventListener('online', () => seguimentos.forEach(s => agendar(s, true)));
  addEventListener('offline', () => seguimentos.forEach(s => { s.erro = 'offline'; avisar(s); }));

  /* =====================================================================
     2. SITUAÇÃO — o que se pode afirmar, e com que fonte
     ===================================================================== */
  const ROTULOS = {
    agendado: 'Agendado', direto: 'Em direto', intervalo: 'Intervalo', terminado: 'Resultado final',
    adiado: 'Adiado', suspenso: 'Suspenso', interrompido: 'Interrompido', cancelado: 'Cancelado',
    abandonado: 'Abandonado', desconhecido: 'Estado desconhecido',
    sem_direto: 'Dados em direto indisponíveis', por_confirmar: 'Resultado por confirmar'
  };

  function situacao(s){
    const j = s.jogo;
    const falta = new Date(j.data) - Date.now();
    const d = s.dados?.disponivel ? s.dados : null;
    const base = { jogo: j, dados: s.dados, lidoEm: s.lidoEm, erro: s.erro, aLer: s.aLer, falta };
    if(d){
      const e = d.estado;
      return { ...base, tipo: e.codigo, fonte: e.fonte, minuto: e.minuto, acrescimo: e.acrescimo,
               fase: e.fase, atraso: e.atraso, atualizado: e.atualizado_em ? new Date(e.atualizado_em) : s.lidoEm,
               resultado: d.resultado, desatualizado: !!d.desatualizado || !!s.erro, aviso: d.aviso };
    }
    if(jogado(j)) return { ...base, tipo: 'terminado', fonte: 'Wikipédia', origem: 'calendario',
                           resultado: { casa: j.golosCasa, fora: j.golosFora } };
    if(falta > 0) return { ...base, tipo: 'agendado', fonte: 'calendário (Wikipédia)', origem: 'calendario' };
    if(falta > -4 * H) return { ...base, tipo: 'sem_direto' };
    return { ...base, tipo: 'por_confirmar' };
  }

  const minutoTexto = sit => sit.minuto == null ? '' :
    sit.acrescimo ? `${sit.minuto}+${sit.acrescimo}'` : `${sit.minuto}'`;

  /* o rótulo curto (pílula): "Em direto · 67'", "Intervalo", "Resultado final"… */
  function rotulo(sit){
    if(!sit) return { texto: '', classe: '' };
    const texto = sit.tipo === 'direto' && sit.minuto != null
      ? `${ROTULOS.direto} · ${minutoTexto(sit)}` : (ROTULOS[sit.tipo] || '');
    return { texto, classe: 'cj-estado--' + sit.tipo, aoVivo: sit.tipo === 'direto' || sit.tipo === 'intervalo' };
  }

  const hora = d => d ? d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : '';

  /* linha de fonte e frescura: "Fonte: API-Football · Atualizado às 21:03 · Com atraso" */
  function linhaFonte(sit){
    const partes = [];
    if(sit.fonte) partes.push(`Fonte: ${seguro(sit.fonte)}`);
    if(sit.atualizado && !sit.origem) partes.push(`Atualizado às ${hora(sit.atualizado)}`);
    else if(sit.lidoEm && sit.origem !== 'calendario') partes.push(`Lido às ${hora(sit.lidoEm)}`);
    if(sit.atraso) partes.push('<span class="cj-selo cj-selo--atraso">Com atraso</span>');
    if(sit.desatualizado) partes.push('<span class="cj-selo cj-selo--velho">Desatualizado</span>');
    return partes.join(' · ');
  }

  /* =====================================================================
     3. VISTA — placar, separadores e painéis
     ===================================================================== */
  let atual = null;             // situação do jogo aberto na vista
  let largar = null;            // deixar de ouvir o jogo anterior
  let aba = 'lances';
  let ladoJogadores = 'nos';

  const ehSporting = n => /sporting cp/i.test(n || '');

  function abrir(jogo){
    if(!jogo) return;
    if(atual && chave(atual.jogo) === chave(jogo) && largar){ pintar(atual); return; }
    largar?.();
    atual = null;
    largar = observar(jogo, sit => { atual = sit; pintar(sit); });
  }

  const ICONES = {
    golo: '<circle cx="12" cy="12" r="9"/><path d="m12 7 4 3-1.5 4.5h-5L8 10Z"/><path d="m12 3v4M21 10.5l-5 -.5M3 10.5l5-.5M16.5 20l-2-5.5M7.5 20l2-5.5"/>',
    penalti: '<circle cx="12" cy="12" r="9"/><path d="m12 7 4 3-1.5 4.5h-5L8 10Z"/>',
    autogolo: '<circle cx="12" cy="12" r="9"/><path d="M8 8l8 8M16 8l-8 8"/>',
    penalti_falhado: '<circle cx="12" cy="12" r="9"/><path d="M8 8l8 8M16 8l-8 8"/>',
    amarelo: '<rect x="7" y="4" width="10" height="16" rx="2" class="cj-ico-amarelo"/>',
    segundo_amarelo: '<rect x="5" y="5" width="9" height="14" rx="2" class="cj-ico-amarelo"/><rect x="10" y="6" width="9" height="14" rx="2" class="cj-ico-vermelho"/>',
    vermelho: '<rect x="7" y="4" width="10" height="16" rx="2" class="cj-ico-vermelho"/>',
    substituicao: '<path d="M7 4v13M3 13l4 4 4-4"/><path d="M17 20V7M13 11l4-4 4 4"/>',
    var: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
    apito: '<circle cx="9" cy="14" r="5"/><path d="M13 11 21 6v4l-6 3"/>'
  };
  const icone = tipo => `<svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[tipo] || ICONES.apito}</svg>`;

  function pintar(sit){
    if(!$('#cj-placar')) return;
    pintarPlacar(sit);
    pintarLances(sit);
    pintarEstatisticas(sit);
    pintarEquipas(sit);
    pintarClassificacao(sit);
    pintarNoticias(sit);
  }

  /* ---------- placar ---------- */
  function ligacoesFora(j){
    const q = encodeURIComponent(`${j.casa} ${j.fora}`);
    const prova = ctx.nomeProva(j.comp).prova;
    const oficial = /liga portugal/i.test(prova) ? '<a href="https://www.ligaportugal.pt" target="_blank" rel="noopener">Liga Portugal</a>'
      : /campe/i.test(prova) ? '<a href="https://www.uefa.com/uefachampionsleague/" target="_blank" rel="noopener">UEFA</a>' : '';
    return `<a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Pesquisar no Google</a>
      <a href="https://www.zerozero.pt/equipa/sporting" target="_blank" rel="noopener">zerozero</a>${oficial}
      <button type="button" data-ir-centro="aominuto">Ao minuto (notícias)</button>`;
  }

  function pintarPlacar(sit){
    const alvo = $('#cj-placar');
    const j = sit.jogo;
    const d = new Date(j.data);
    const prova = ctx.nomeProva(j.comp);
    const r = rotulo(sit);
    const res = sit.resultado && sit.resultado.casa != null ? sit.resultado : null;
    const quando = d.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' }) +
      (j.semHora ? ' · hora a marcar' : ' · ' + hora(d));
    const eq = (nome, lado) => `
      <div class="cj-eq cj-eq--${lado} ${ehSporting(nome) ? 'e-nos' : ''}">
        <span class="cj-eq__escudo"><img src="${ctx.emblema(nome)}" alt="" width="56" height="56"></span>
        <b class="cj-eq__nome">${seguro(nome)}</b>
      </div>`;
    const centro = res
      ? `<span class="cj-res" aria-label="${res.casa} a ${res.fora}">${res.casa}<i>–</i>${res.fora}</span>`
      : `<span class="cj-hora">${j.semHora ? '—' : hora(d)}</span>`;
    const extra = res && sit.resultado?.intervalo ? `<span class="cj-intervalo">Intervalo ${sit.resultado.intervalo.home}–${sit.resultado.intervalo.away}</span>` : '';

    let faixa = '';
    if(sit.tipo === 'sem_direto' || (sit.tipo === 'agendado' && sit.falta < 3 * H && sit.dados && !sit.dados.disponivel)){
      faixa = `<div class="cj-aviso">
        <p><b>Dados em direto indisponíveis.</b> Nenhuma fonte com dados em direto está ligada para este jogo,
        por isso não mostramos minuto, resultado nem lances inventados.</p>
        <p class="cj-aviso__ligacoes">Acompanhar noutro sítio: ${ligacoesFora(j)}</p></div>`;
    }else if(sit.tipo === 'por_confirmar'){
      faixa = `<div class="cj-aviso"><p><b>Resultado por confirmar.</b> O jogo já devia ter acabado, mas nenhuma fonte deu ainda o resultado final.</p>
        <p class="cj-aviso__ligacoes">${ligacoesFora(j)}</p></div>`;
    }
    if(sit.desatualizado && sit.dados?.disponivel){
      faixa += `<div class="cj-aviso cj-aviso--velho" role="status"><p>${sit.erro === 'offline'
        ? 'Sem ligação à internet.' : 'A fonte não respondeu na última tentativa.'}
        Estes dados são das <b>${hora(sit.atualizado || sit.lidoEm)}</b> e podem já não estar certos.</p></div>`;
    }

    alvo.innerHTML = `
      <div class="cj-placar__topo">
        <span class="cj-prova">${seguro(prova.prova)}${prova.fase ? ` · ${seguro(prova.fase)}` : ''}</span>
        <span class="cj-quando">${seguro(quando)}</span>
      </div>
      <div class="cj-placar__jogo">
        ${eq(j.casa, 'casa')}
        <div class="cj-centro">
          ${centro}
          <span class="cj-estado ${r.classe}">${r.aoVivo ? '<i class="cj-pulso" aria-hidden="true"></i>' : ''}${seguro(r.texto)}</span>
          ${sit.fase && sit.tipo !== 'terminado' && sit.tipo !== 'intervalo' ? `<span class="cj-fase">${seguro(sit.fase)}</span>` : ''}
          ${extra}
        </div>
        ${eq(j.fora, 'fora')}
      </div>
      <p class="cj-placar__fonte">${linhaFonte(sit)}${sit.aLer ? ' · <span class="cj-a-ler">a atualizar…</span>'
        : (sit.erro || sit.tipo === 'sem_direto') && sit.falta < 3 * H ? ' · <button type="button" class="cj-atualizar" data-cj-atualizar>Tentar outra vez</button>' : ''}</p>
      ${j.local ? `<p class="cj-placar__local">${seguro(j.local)}${sit.dados?.jogo?.arbitro ? ' · Árbitro: ' + seguro(sit.dados.jogo.arbitro) : j.arbitro ? ' · Árbitro: ' + seguro(j.arbitro) : ''}</p>` : ''}
      ${faixa}`;
    const mini = $('#cj-mini');
    if(mini) mini.innerHTML = `<span class="cj-mini__eq"><img src="${ctx.emblema(j.casa)}" alt="" width="20" height="20">${seguro(curto(j.casa))}</span>
      <b>${res ? `${res.casa}–${res.fora}` : hora(d)}</b>
      <span class="cj-mini__eq">${seguro(curto(j.fora))}<img src="${ctx.emblema(j.fora)}" alt="" width="20" height="20"></span>
      <em class="cj-estado ${r.classe}">${seguro(r.texto)}</em>`;
  }
  const curto = n => (n || '').replace(/^(SC|FC|CD|GD|CF|SL|UD)\s+/i, '').replace(/\s+CP$/i, '');

  /* ---------- lances ---------- */
  const NOMES_EVENTO = {
    golo: 'Golo', penalti: 'Golo de penálti', autogolo: 'Autogolo', penalti_falhado: 'Penálti falhado',
    amarelo: 'Cartão amarelo', segundo_amarelo: 'Segundo amarelo', vermelho: 'Cartão vermelho',
    substituicao: 'Substituição', var: 'VAR'
  };

  function pintarLances(sit){
    const alvo = $('#cj-lances');
    const j = sit.jogo;
    const ev = sit.dados?.disponivel && sit.dados.eventos?.disponivel ? sit.dados.eventos : null;
    let lista = [], fonte = '', origem = '';
    if(ev){
      lista = ev.lista.slice();
      fonte = ev.fonte;
    }else if(jogado(j) && ((j.marcadoresCasa || []).length || (j.marcadoresFora || []).length)){
      /* jogo terminado sem fonte de eventos: os golos que o Wikipédia lista */
      const conv = (m, lado) => {
        const [min, acr] = String(m.minuto).split('+').map(Number);
        return { id: `${lado}-${m.nome}-${m.minuto}`, tipo: m.tipo === 'ag' ? 'autogolo' : m.tipo === 'gp' ? 'penalti' : 'golo',
                 minuto: min, acrescimo: acr || null, equipa: lado, jogador: m.nome };
      };
      lista = [...(j.marcadoresCasa || []).map(m => conv(m, 'casa')), ...(j.marcadoresFora || []).map(m => conv(m, 'fora'))]
        .sort((a, b) => a.minuto - b.minuto || (a.acrescimo || 0) - (b.acrescimo || 0));
      fonte = 'Wikipédia'; origem = 'só os golos';
    }

    /* início, intervalo e fim: só se o estado da fonte o disser */
    const marcos = [];
    const t = sit.tipo;
    if(ev && ['direto', 'intervalo', 'terminado', 'suspenso', 'interrompido'].includes(t))
      marcos.push({ id: 'inicio', marco: 'Início do jogo', minuto: 0 });
    const intervalo = sit.resultado?.intervalo;
    if(ev && (t === 'intervalo' || (t === 'direto' && /2\.ª|prolong|penal/i.test(sit.fase || '')) || (t === 'terminado' && intervalo)))
      marcos.push({ id: 'intervalo', marco: 'Intervalo' + (intervalo ? ` · ${intervalo.home}–${intervalo.away}` : ''), minuto: 45, acrescimo: 99 });
    if(ev && t === 'terminado')
      marcos.push({ id: 'fim', marco: 'Fim do jogo' + (sit.resultado ? ` · ${sit.resultado.casa}–${sit.resultado.fora}` : ''), minuto: 999 });

    const tudo = [...lista, ...marcos].sort((a, b) => (a.minuto - b.minuto) || ((a.acrescimo || 0) - (b.acrescimo || 0)));
    const aoVivo = t === 'direto' || t === 'intervalo';
    if(aoVivo) tudo.reverse();          // em direto, o mais recente em cima

    if(!tudo.length){
      alvo.innerHTML = vazio(
        sit.dados?.disponivel ? (aoVivo ? 'Ainda sem lances' : t === 'agendado' ? 'O jogo ainda não começou' : 'Sem lances registados')
          : t === 'agendado' ? 'O jogo ainda não começou' : 'Lances indisponíveis',
        sit.dados?.disponivel ? (sit.dados.eventos?.motivo || 'Os golos, cartões e substituições aparecem aqui quando a fonte os publicar.')
          : 'Nenhuma fonte com eventos em direto está ligada. Quando estiver, os golos, cartões e substituições aparecem aqui com o minuto certo.');
      return;
    }

    const nomeEquipa = lado => lado === 'casa' ? j.casa : j.fora;
    alvo.innerHTML = `
      <p class="cj-origem">Fonte: ${seguro(fonte)}${origem ? ` (${origem})` : ''}${aoVivo ? ' · o mais recente em cima' : ''}</p>
      <ol class="cj-linha">${tudo.map(e => {
        if(e.marco) return `<li class="lc lc--marco"><span class="lc__min"></span><span class="lc__ico">${icone('apito')}</span><span class="lc__txt"><b>${seguro(e.marco)}</b></span></li>`;
        const min = e.minuto == null ? '' : e.acrescimo ? `${e.minuto}+${e.acrescimo}'` : `${e.minuto}'`;
        let detalhe = '';
        if(e.tipo === 'substituicao'){
          detalhe = e.entrou ? `Entra <b>${seguro(e.entrou)}</b>, sai ${seguro(e.saiu)}` : `${seguro((e.jogadores || []).join(' ↔ '))} <i>(a fonte não diz quem entrou)</i>`;
        }else if(e.tipo === 'var'){
          detalhe = `${seguro(e.detalhe || 'Decisão do VAR')}${e.jogador ? ' — ' + seguro(e.jogador) : ''}`;
        }else{
          detalhe = `<b>${seguro(e.jogador || 'jogador não indicado')}</b>${e.assistencia ? ` · assistência de ${seguro(e.assistencia)}` : ''}`;
        }
        const nosso = ehSporting(nomeEquipa(e.equipa));
        return `<li class="lc lc--${e.tipo} lc--${e.equipa} ${nosso ? 'lc--nos' : ''}">
          <span class="lc__min">${min}</span>
          <span class="lc__ico">${icone(e.tipo)}</span>
          <span class="lc__txt"><span class="lc__tipo">${NOMES_EVENTO[e.tipo] || 'Lance'} · ${seguro(curto(nomeEquipa(e.equipa)))}</span><span>${detalhe}</span></span>
        </li>`;
      }).join('')}</ol>`;
  }

  function vazio(titulo, texto){
    return `<div class="cj-vazio"><p class="cj-vazio__titulo">${seguro(titulo)}</p><p>${seguro(texto)}</p></div>`;
  }

  /* ---------- estatísticas ---------- */
  function pintarEstatisticas(sit){
    const alvo = $('#cj-estatisticas');
    const j = sit.jogo;
    const st = sit.dados?.disponivel ? sit.dados.estatisticas : null;
    const jg = sit.dados?.disponivel ? sit.dados.jogadores : null;
    let html = '';
    if(st?.disponivel && st.linhas.length){
      const fmt = (v, u) => v == null ? '—' : `${String(v).replace('.', ',')}${u}`;
      html += `<p class="cj-origem">Estatísticas da partida · Fonte: ${seguro(st.fonte)}${st.atualizado_em ? ' · ' + hora(new Date(st.atualizado_em)) : ''}</p>
        <div class="cj-comp-cab"><span class="${ehSporting(j.casa) ? 'e-nos' : ''}">${seguro(curto(j.casa))}</span><span class="${ehSporting(j.fora) ? 'e-nos' : ''}">${seguro(curto(j.fora))}</span></div>
        <ul class="cj-comp">${st.linhas.map(l => {
          const a = l.casa, b = l.fora;
          const total = (a || 0) + (b || 0);
          const pa = a == null || b == null || !total ? null : Math.round(a / total * 100);
          const lider = a == null || b == null || a === b ? '' : a > b ? 'casa' : 'fora';
          return `<li class="cj-comp__linha">
            <span class="cj-comp__v ${lider === 'casa' ? 'lidera' : ''}">${fmt(a, l.unidade)}</span>
            <span class="cj-comp__rot">${seguro(l.rotulo)}</span>
            <span class="cj-comp__v ${lider === 'fora' ? 'lidera' : ''}">${fmt(b, l.unidade)}</span>
            ${pa == null ? '' : `<span class="cj-comp__barra" aria-hidden="true"><i class="${ehSporting(j.casa) ? 'e-nos' : ''}" style="--p:${pa}%"></i><i class="${ehSporting(j.fora) ? 'e-nos' : ''}" style="--p:${100 - pa}%"></i></span>`}
          </li>`;
        }).join('')}</ul>`;
    }else{
      html += vazio('Estatísticas da partida indisponíveis',
        st?.motivo || (sit.dados?.disponivel ? 'A fonte ligada não dá estatísticas deste jogo.'
          : 'Nenhuma fonte de estatísticas está ligada. Não calculamos posse, remates ou cantos a partir do resultado.'));
    }

    if(jg?.disponivel && jg.lista.length){
      const lado = ladoJogadores === 'nos' ? (ehSporting(j.casa) ? 'casa' : 'fora') : (ehSporting(j.casa) ? 'fora' : 'casa');
      const linhas = jg.lista.filter(p => p.equipa === lado);
      const COLS = [['minutos', 'Min'], ['golos', 'G'], ['assistencias', 'A'], ['remates', 'Rem'], ['remates_baliza', 'À bal.'],
                    ['passes', 'Passes'], ['passes_certos', 'Certos'], ['desarmes', 'Desarmes'], ['intercecoes', 'Interc.'],
                    ['faltas_cometidas', 'F. com.'], ['faltas_sofridas', 'F. sof.'], ['amarelos', 'Am.'], ['vermelhos', 'Verm.'],
                    ['defesas', 'Defesas'], ['nota', 'Nota']];
      const usadas = COLS.filter(([k]) => linhas.some(p => p[k] != null));
      html += `<h4 class="cj-sub">Jogadores</h4>
        <div class="cj-lados" role="group" aria-label="Equipa">
          <button type="button" class="${ladoJogadores === 'nos' ? 'is-on' : ''}" aria-pressed="${ladoJogadores === 'nos'}" data-cj-lado="nos">Sporting</button>
          <button type="button" class="${ladoJogadores === 'eles' ? 'is-on' : ''}" aria-pressed="${ladoJogadores === 'eles'}" data-cj-lado="eles">Adversário</button>
        </div>
        <div class="cj-tabela-rolo" tabindex="0"><table class="cj-tabela">
          <caption class="so-leitor">Estatísticas individuais neste jogo</caption>
          <thead><tr><th scope="col">Jogador</th>${usadas.map(([, r]) => `<th scope="col">${r}</th>`).join('')}</tr></thead>
          <tbody>${linhas.map(p => `<tr><th scope="row">${seguro(p.nome)}${p.posicao ? ` <small>${seguro(p.posicao)}</small>` : ''}</th>${
            usadas.map(([k]) => `<td>${p[k] == null ? '—' : String(p[k]).replace('.', ',')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <p class="cj-nota">Fonte: ${seguro(jg.fonte)}. «—» = a fonte não deu esse valor. A nota é a da fonte.</p>`;
    }else if(sit.dados?.disponivel){
      html += `<p class="cj-nota">${seguro(jg?.motivo || 'Sem estatísticas individuais desta fonte.')}</p>`;
    }
    alvo.innerHTML = html;
  }

  /* ---------- equipas ---------- */
  function pintarEquipas(sit){
    const alvo = $('#cj-equipas');
    const j = sit.jogo;
    const eq = sit.dados?.disponivel ? sit.dados.equipas : null;
    if(eq?.disponivel && (eq.casa || eq.fora)){
      const trocas = (sit.dados.eventos?.lista || []).filter(e => e.tipo === 'substituicao');
      const bloco = (lado, nome) => {
        const e = eq[lado];
        if(!e) return `<div class="cj-onze"><h4>${seguro(nome)}</h4><p class="cj-nota">Onze ainda não publicado.</p></div>`;
        const linha = p => `<li><span class="cj-onze__n">${p.numero ?? '–'}</span><span>${seguro(p.nome)}</span><small>${seguro(p.posicao || '')}</small></li>`;
        const minhas = trocas.filter(t => t.equipa === lado && t.entrou);
        return `<div class="cj-onze ${ehSporting(nome) ? 'e-nos' : ''}">
          <h4><img src="${ctx.emblema(nome)}" alt="" width="22" height="22">${seguro(nome)}</h4>
          <p class="cj-onze__meta">${e.formacao ? `Formação <b>${seguro(e.formacao)}</b>` : 'Formação não indicada'}${e.treinador ? ` · Treinador: ${seguro(e.treinador)}` : ''}</p>
          <h5>Onze inicial</h5><ol class="cj-onze__lista">${e.titulares.map(linha).join('')}</ol>
          ${e.suplentes?.length ? `<h5>Banco</h5><ol class="cj-onze__lista cj-onze__lista--banco">${e.suplentes.map(linha).join('')}</ol>` : ''}
          ${minhas.length ? `<h5>Substituições</h5><ul class="cj-onze__trocas">${minhas.map(t => `<li><span>${t.minuto}'</span> ${seguro(t.entrou)} <i>por</i> ${seguro(t.saiu)}</li>`).join('')}</ul>` : ''}
        </div>`;
      };
      alvo.innerHTML = `<p class="cj-origem">Fonte: ${seguro(eq.fonte)}</p><div class="cj-onzes">${bloco('casa', j.casa)}${bloco('fora', j.fora)}</div>`;
      return;
    }
    const noticia = ctx.noticiaOnze(j);
    alvo.innerHTML = vazio('Onzes indisponíveis',
      eq?.motivo || (sit.dados?.disponivel ? 'A fonte ainda não publicou os onzes.' : 'Nenhuma fonte com os onzes oficiais está ligada.'))
      + (noticia ? `<p class="cj-nota cj-nota--ligacao">O onze foi anunciado numa notícia: <a href="${seguro(noticia.link)}" target="_blank" rel="noopener">${seguro(noticia.titulo)}</a> (${seguro(noticia.fonte)}). Não copiamos os nomes do texto: lê na fonte.</p>` : '');
  }

  /* ---------- classificação ---------- */
  function pintarClassificacao(sit){
    const alvo = $('#cj-classificacao');
    const j = sit.jogo;
    const prova = ctx.nomeProva(j.comp).prova;
    if(!/liga portugal/i.test(prova)){
      alvo.innerHTML = vazio('Impacto na classificação', `Só calculamos o impacto para a Liga Portugal. Este jogo é da competição ${prova}.`);
      return;
    }
    const tabela = ctx.tabela();
    if(!tabela?.length){ alvo.innerHTML = vazio('Classificação indisponível', 'A tabela da Liga ainda não carregou.'); return; }
    const linhaDe = nome => tabela.find(t => ctx.mesmaEquipa(t.equipa, nome));
    const lc = linhaDe(j.casa), lf = linhaDe(j.fora);
    const res = sit.resultado && sit.resultado.casa != null ? sit.resultado : null;
    const nos = ehSporting(j.casa) ? lc : lf;

    /* a tabela já conta com este jogo? compara-se o número de jogos do
       Sporting com os jogos da Liga já acabados ANTES deste */
    const antes = ctx.jogos().filter(x => /^LIGA\b/.test(x.comp || '') && jogado(x) && new Date(x.data) < new Date(j.data)).length;
    let estado = 'desconhecido';
    if(nos && nos.j === antes) estado = 'antes';
    else if(nos && nos.j === antes + 1) estado = 'inclui';

    let tab = tabela.map(t => ({ ...t }));
    let nota = '';
    if(res && estado === 'antes' && lc && lf){
      const aplicar = (linha, gm, gs) => {
        const t = tab.find(x => x.equipa === linha.equipa);
        t.j++; t.gm += gm; t.gs += gs;
        if(gm > gs){ t.v++; t.p += 3; } else if(gm === gs){ t.e++; t.p += 1; } else t.d++;
      };
      aplicar(lc, res.casa, res.fora); aplicar(lf, res.fora, res.casa);
      tab.sort((a, b) => b.p - a.p || (b.gm - b.gs) - (a.gm - a.gs) || b.gm - a.gm);
      tab.forEach((t, i) => { t.provisoria = i + 1; });
      nota = sit.tipo === 'terminado'
        ? 'Classificação depois deste resultado, calculada por nós a partir da tabela anterior e do resultado final (fonte do resultado: ' + seguro(sit.fonte) + ').'
        : 'Classificação provisória «se acabasse agora», calculada a partir da tabela antes do jogo e do resultado atual (fonte: ' + seguro(sit.fonte) + ').';
      nota += ' Em caso de empate em pontos a Liga desempata primeiro pelo confronto direto, que não entra nesta conta.';
    }else if(res && estado === 'inclui'){
      nota = 'A tabela já inclui este jogo.';
    }else if(res){
      nota = 'Não dá para saber com segurança se a tabela já inclui este jogo, por isso mostramos a tabela tal como está.';
    }else{
      nota = 'Tabela antes do jogo. Quando houver resultado de uma fonte, mostramos como fica.';
    }
    const destaques = [lc?.equipa, lf?.equipa].filter(Boolean);
    const linhas = tab.filter((t, i) => {
      const pos = tab.indexOf(t);
      return destaques.some(d => Math.abs(tab.findIndex(x => x.equipa === d) - pos) <= 2) || pos < 4;
    });
    alvo.innerHTML = `<p class="cj-origem">${nota}</p>
      <div class="cj-tabela-rolo" tabindex="0"><table class="cj-tabela cj-tabela--class">
        <caption class="so-leitor">Classificação da Liga Portugal</caption>
        <thead><tr><th scope="col">#</th><th scope="col">Equipa</th><th scope="col">J</th><th scope="col">DG</th><th scope="col">Pts</th></tr></thead>
        <tbody>${linhas.map(t => {
          const pos = tab.indexOf(t) + 1;
          const antiga = tabela.findIndex(x => x.equipa === t.equipa) + 1;
          const mov = t.provisoria && antiga !== pos ? (pos < antiga ? `<i class="sobe" title="Sobe">▲${antiga - pos}</i>` : `<i class="desce" title="Desce">▼${pos - antiga}</i>`) : '';
          return `<tr class="${destaques.includes(t.equipa) ? 'destaque' : ''} ${ehSporting(t.equipa) ? 'e-nos' : ''}">
            <td>${pos}${mov}</td><th scope="row">${seguro(t.equipa)}</th><td>${t.j}</td><td>${t.gm - t.gs > 0 ? '+' : ''}${t.gm - t.gs}</td><td><b>${t.p}</b></td></tr>`;
        }).join('')}</tbody></table></div>
      <p class="cj-nota">Tabela: ${seguro(ctx.fonteTabela())}.</p>`;
  }

  /* ---------- notícias do jogo ---------- */
  function pintarNoticias(sit){
    const alvo = $('#cj-noticias');
    if(!alvo) return;
    const j = sit.jogo;
    const adversario = ehSporting(j.casa) ? j.fora : j.casa;
    const lista = ctx.noticiasDoJogo(j, adversario).slice(0, 8);
    alvo.innerHTML = lista.length
      ? lista.map(n => `<li><a href="${seguro(n.link)}" target="_blank" rel="noopener">${seguro(n.titulo)}</a>
          <span>${seguro(n.fonte)} · ${Componentes.haQuanto(n.data)}</span></li>`).join('')
      : '<li class="cj-nota">Ainda não há notícias sobre este jogo.</li>';
  }

  /* ---------- separadores ---------- */
  function mudarAba(nova, foco = false){
    aba = nova;
    $$('.cj-aba').forEach(b => {
      const on = b.dataset.cjAba === nova;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
      if(on && foco) b.focus();
    });
    $$('.cj-painel').forEach(p => { p.hidden = p.id !== 'cj-' + nova; });
  }

  function ligar(){
    const abas = $('.cj-abas');
    if(!abas) return;
    abas.addEventListener('click', e => {
      const b = e.target.closest('[data-cj-aba]');
      if(b) mudarAba(b.dataset.cjAba);
    });
    abas.addEventListener('keydown', e => {
      const ordem = $$('.cj-aba').map(b => b.dataset.cjAba);
      let i = ordem.indexOf(aba);
      if(e.key === 'ArrowRight') i = (i + 1) % ordem.length;
      else if(e.key === 'ArrowLeft') i = (i - 1 + ordem.length) % ordem.length;
      else if(e.key === 'Home') i = 0;
      else if(e.key === 'End') i = ordem.length - 1;
      else return;
      e.preventDefault();
      mudarAba(ordem[i], true);
    });
    $('#vista-aovivo').addEventListener('click', e => {
      const lado = e.target.closest('[data-cj-lado]');
      if(lado){ ladoJogadores = lado.dataset.cjLado; if(atual) pintarEstatisticas(atual); }
      if(e.target.closest('[data-cj-atualizar]')) atualizar();
      const ir = e.target.closest('[data-ir-centro]');
      if(ir) ctx.irPara(ir.dataset.irCentro);
    });
    /* quando o placar sai do ecrã, o resultado fica numa linha colada aos separadores */
    const placar = $('#cj-placar');
    if(placar && 'IntersectionObserver' in window){
      const topo = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--altura-topo')) || 64;
      new IntersectionObserver(([e]) => $('.cj')?.classList.toggle('compacto', !e.isIntersecting && e.boundingClientRect.top < topo),
        { rootMargin: `-${topo}px 0px 0px 0px` }).observe(placar);
    }
  }

  function iniciar(contexto){
    ctx = contexto;
    ligar();
  }

  const repintar = () => { if(atual) pintar(atual); };
  /* "Tentar outra vez": lê já o jogo aberto */
  function atualizar(){
    const s = atual && seguimentos.get(chave(atual.jogo));
    if(s){ clearTimeout(s.timer); ler(s); }
  }

  return { iniciar, observar, abrir, repintar, atualizar, rotulo, linhaFonte, minutoTexto, ROTULOS,
           get atual(){ return atual; } };
})();
window.CentroJogo = CentroJogo;
