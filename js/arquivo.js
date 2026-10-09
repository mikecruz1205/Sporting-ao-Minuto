/* =========================================================================
   ARQUIVO — épocas anteriores do Sporting
   -------------------------------------------------------------------------
   Lê a página de cada época no Wikipédia (aberta, sem chave) com o mesmo
   leitor do site (js/wiki.js): resultados por competição, presenças e
   golos por jogador. É tudo o que essa fonte dá de forma estruturada —
   minutos, assistências, cartões e estatísticas de jogo não existem lá,
   e a página diz isso em vez de inventar números.

   Cada época fica em memória depois de lida (não se volta a pedir).
   ========================================================================= */

const Arquivo = (() => {

  const EPOCAS = ['2025–26', '2024–25', '2023–24', '2022–23', '2021–22', '2020–21', '2019–20'];
  const seguro = t => Componentes.seguro(t);
  const lidas = new Map();          // época → { dados, quando } ou { erro }
  let escolhida = EPOCAS[0];
  let raiz = null;

  const titulo = e => `${e} Sporting CP season`;
  const ehSporting = n => /^sporting( cp)?$/i.test((n || '').trim());

  /* "LIGA — J12" → "LIGA" · "TAÇA DA LIGA — QF" → "TAÇA DA LIGA".
     Particulares e torneios de pré-época ficam num grupo à parte; jogos
     sem prova reconhecível (páginas antigas) ficam à vista mas fora das
     contas — não se adivinha a competição. */
  const PARTICULARES = 'PARTICULARES';
  const SEM_PROVA = 'COMPETIÇÃO NÃO IDENTIFICADA';
  const semData = c => (c || '').replace(/^\([^)]*\)\s*/, '');
  const particular = c => /FRIENDLY|TROF|TROPH|AMIG/i.test(c);
  const oficial = c => /LIGA|TAÇA|SUPERTA|CHAMPIONS|EUROPA|CONFER|UEFA/i.test(c);
  const competicao = c => {
    const nome = semData(c).split(' — ')[0].trim();
    return particular(nome) ? PARTICULARES : oficial(nome) ? nome : SEM_PROVA;
  };
  const contaParaAEpoca = c => c !== PARTICULARES && c !== SEM_PROVA;
  /* "LIGA — J12" → "J12"; "(2019-08-11) 1" → "J1"; "FIRST LEG" fica */
  const fase = c => (c || '').split(' — ')[1] || semData(c).replace(/^(\d+)$/, 'J$1');

  function balanco(jogos){
    const b = { j: 0, v: 0, e: 0, d: 0, gm: 0, gs: 0 };
    jogos.forEach(g => {
      if(g.golosCasa == null || g.golosFora == null) return;
      const nos = ehSporting(g.casa) ? g.golosCasa : g.golosFora;
      const eles = ehSporting(g.casa) ? g.golosFora : g.golosCasa;
      b.j++; b.gm += nos; b.gs += eles;
      if(nos > eles) b.v++; else if(nos === eles) b.e++; else b.d++;
    });
    return b;
  }

  async function ler(epoca){
    if(lidas.has(epoca)) return lidas.get(epoca);
    try{
      const dados = await Wiki.epoca(titulo(epoca));
      const r = { dados, quando: new Date() };
      lidas.set(epoca, r);
      return r;
    }catch(e){
      return { erro: e?.message || 'erro' };
    }
  }

  async function pintar(){
    if(!raiz) return;
    const corpo = raiz.querySelector('#arquivo-corpo');
    corpo.innerHTML = `<div aria-hidden="true">${Componentes.esqueletoCompacto(6)}</div><p class="so-leitor" role="status">A ler a época ${seguro(escolhida)}…</p>`;
    const r = await ler(escolhida);
    if(raiz.querySelector('#arquivo-epoca').value !== escolhida) return;   // entretanto mudou

    if(r.erro){
      corpo.innerHTML = `<div class="estado estado--erro" role="alert">
        <p class="estado__titulo">Não foi possível ler a época ${seguro(escolhida)}</p>
        <p class="estado__texto">${navigator.onLine === false ? 'Sem ligação à internet.' : 'O Wikipédia não respondeu ou a página desta época não existe.'}</p>
        <button type="button" class="botao-largo botao-largo--fantasma" data-arquivo="repetir">Tentar outra vez</button></div>`;
      return;
    }
    const { jogos, stats } = r.dados;
    const grupos = new Map();
    [...jogos].sort((a, b) => new Date(a.data) - new Date(b.data)).forEach(g => {
      const c = competicao(g.comp);
      if(!grupos.has(c)) grupos.set(c, []);
      grupos.get(c).push(g);
    });
    const jogadores = Object.entries(stats || {})
      .map(([nome, s]) => ({ nome, ...s }))
      .sort((a, b) => (b.golos ?? -1) - (a.golos ?? -1) || (b.jogos ?? -1) - (a.jogos ?? -1));
    const total = balanco(jogos.filter(g => contaParaAEpoca(competicao(g.comp))));
    const semProva = jogos.filter(g => competicao(g.comp) === SEM_PROVA).length;

    corpo.innerHTML = `
      ${jogos.length ? `<p class="arq-fonte">Jogos oficiais com a competição identificada${semProva ? ` — ${semProva} jogos desta página não dizem a competição e ficam fora destas contas` : ''}:</p><div class="arq-total">
        <div><span>Jogos</span><b>${total.j}</b></div><div><span>Vitórias</span><b>${total.v}</b></div>
        <div><span>Empates</span><b>${total.e}</b></div><div><span>Derrotas</span><b>${total.d}</b></div>
        <div><span>Golos</span><b>${total.gm}–${total.gs}</b></div></div>` : ''}
      ${[...grupos.entries()].sort(([a], [b]) => (!contaParaAEpoca(a)) - (!contaParaAEpoca(b))).map(([c, lista]) => {
        const b = balanco(lista);
        return `<details class="arq-prova" ${c === 'LIGA' ? 'open' : ''}>
          <summary><b>${seguro(c)}</b><span>${b.j} jogos · ${b.v}V ${b.e}E ${b.d}D · ${b.gm}–${b.gs}</span></summary>
          <ol class="arq-jogos">${lista.map(g => {
            const temRes = g.golosCasa != null && g.golosFora != null;
            const nos = ehSporting(g.casa) ? g.golosCasa : g.golosFora, eles = ehSporting(g.casa) ? g.golosFora : g.golosCasa;
            const r = !temRes ? '' : nos > eles ? 'v' : nos === eles ? 'e' : 'd';
            return `<li class="arq-jogo ${r ? 'arq-jogo--' + r : ''}">
              <time datetime="${seguro(g.data)}">${new Date(g.data).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })}</time>
              <span class="arq-jogo__equipas"><span class="${ehSporting(g.casa) ? 'nos' : ''}">${seguro(g.casa)}</span>
                <b>${temRes ? `${g.golosCasa}–${g.golosFora}` : 'sem resultado'}</b>
                <span class="${ehSporting(g.fora) ? 'nos' : ''}">${seguro(g.fora)}</span></span>
              <small>${seguro(fase(g.comp))}</small>
            </li>`;
          }).join('')}</ol></details>`;
      }).join('') || '<p class="vazio">Esta página não tem a lista de jogos num formato que se consiga ler.</p>'}
      <h3 class="arq-sub">Jogadores · presenças e golos (todas as provas)</h3>
      ${jogadores.length ? `<div class="arq-tabela"><table class="tabela"><thead><tr><th>Jogador</th><th>Jogos</th><th>Golos</th></tr></thead><tbody>
        ${jogadores.map(j => `<tr><td>${seguro(j.nome)}</td><td>${j.jogos ?? '—'}</td><td>${j.golos ?? '—'}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="vazio">Sem estatísticas de jogadores nesta página.</p>'}
      <p class="arq-fonte">Fonte: Wikipédia (en), «${seguro(titulo(escolhida))}», lida às ${r.quando.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}.
        Só há resultados, marcadores, presenças e golos; minutos, assistências, cartões e estatísticas de jogo não estão disponíveis nesta fonte.</p>`;
  }

  function abrir(){
    raiz = raiz || document.getElementById('arquivo');
    if(!raiz) return;
    if(!raiz.dataset.ligado){
      raiz.dataset.ligado = '1';
      const sel = raiz.querySelector('#arquivo-epoca');
      sel.innerHTML = EPOCAS.map(e => `<option value="${e}">${e.replace('–', '/')}</option>`).join('');
      sel.addEventListener('change', () => { escolhida = sel.value; pintar(); });
      raiz.addEventListener('click', ev => {
        if(ev.target.closest('[data-arquivo="repetir"]')){ lidas.delete(escolhida); pintar(); }
      });
      pintar();
    }
  }

  return { abrir };
})();
window.Arquivo = Arquivo;
