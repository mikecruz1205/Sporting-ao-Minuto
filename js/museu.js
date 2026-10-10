/* =========================================================================
   MUSEU DO SPORTING CP — o palmarés como uma sala de troféus
   -------------------------------------------------------------------------
   Os números vêm de PALMARES (js/data.js), verificados na Wikipédia em
   português e em inglês. Aqui só se desenha: a entrada, a sala dos troféus
   por competição, a linha do tempo com filtros e a ficha de cada conquista.

   Na ficha só aparece o que a lista garante: a época, a competição e contas
   feitas com a própria lista (n.º da conquista, anos desde a anterior,
   dobradinhas, o que mais se ganhou nessa época). Treinadores e plantéis de
   cada conquista não aparecem enquanto não houver fonte verificada para
   todas.
   ========================================================================= */

const Museu = (() => {

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const seguro = t => Componentes.seguro(t);
  const semAcento = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const wiki = titulo => 'https://pt.wikipedia.org/wiki/' + encodeURIComponent(String(titulo).replace(/ /g, '_'));

  /* filtros da linha do tempo */
  const FILTROS = [
    ['todas', 'Todas'], ['liga', 'Campeonato'], ['taca', 'Taça de Portugal'], ['supertaca', 'Supertaça'],
    ['ligacup', 'Taça da Liga'], ['europa', 'Europa'], ['extintas', 'Extintas'], ['regionais', 'Regionais']
  ];
  let filtro = 'todas', decada = 'todas', busca = '';
  let aberta = null;                    // competição aberta na sala dos troféus
  let lista = [];                       // conquistas visíveis na linha do tempo (para andar na ficha)
  let ligado = false;

  /* ---------------------------------------------------------------- contas */
  const comps = () => PALMARES.competicoes;
  const comp = id => comps().find(c => c.id === id);
  const ano = epoca => parseInt(epoca, 10);
  const decadaDe = epoca => Math.floor(ano(epoca) / 10) * 10;
  const nomeDecada = d => d < 1920 ? `${d}–${d + 9}` : `Anos ${String(d).slice(2)}`;
  /* "2024–25" ou "2024": o que se mostra */
  const epocaBonita = e => e.replace('–', '/');

  function todas(){
    return comps().flatMap(c => c.epocas.map(([epoca, artigo], i) =>
      ({ c, epoca, artigo, i, chave: `${c.id}:${epoca}` })))
      .sort((a, b) => ano(a.epoca) - ano(b.epoca) || comps().indexOf(a.c) - comps().indexOf(b.c));
  }
  const acharConquista = chave => todas().find(x => x.chave === chave);

  /* Campeonato e Taça de Portugal na mesma época */
  const temDobradinha = epoca => comp('liga').epocas.some(([e]) => e === epoca) && comp('taca').epocas.some(([e]) => e === epoca);

  /* o que mais se ganhou na mesma época (a Supertaça e as provas de um só ano
     contam-se pelo ano em que se jogaram, por isso não entram aqui) */
  const mesmaEpoca = x => !x.epoca.includes('–') ? [] :
    todas().filter(y => y.epoca === x.epoca && y.c.id !== x.c.id && y.c.grupo !== 'regional');

  const totalPrincipal = () => comps().filter(c => c.grupo === 'principal').reduce((s, c) => s + c.epocas.length, 0);

  function passaFiltro(x){
    if(filtro === 'regionais'){ if(x.c.grupo !== 'regional') return false; }
    else if(x.c.grupo === 'regional') return false;
    if(filtro === 'extintas' && !x.c.extinta) return false;
    if(['liga', 'taca', 'supertaca', 'ligacup'].includes(filtro) && x.c.id !== filtro) return false;
    if(filtro === 'europa' && x.c.ambito !== 'europeu') return false;
    if(decada !== 'todas' && decadaDe(x.epoca) !== Number(decada)) return false;
    if(busca){
      /* um ano sozinho apanha as épocas que passam por ele: 1990 → 1989/90 e 1990/91 */
      if(/^\d{4}$/.test(busca.trim())){
        const y = Number(busca.trim());
        return ano(x.epoca) === y || (x.epoca.includes('–') && ano(x.epoca) + 1 === y);
      }
      const q = semAcento(busca).replace('/', '–');
      const alvo = semAcento(`${x.epoca} ${epocaBonita(x.epoca)} ${x.c.nome} ${x.c.curto} ${temDobradinha(x.epoca) && ['liga', 'taca'].includes(x.c.id) ? 'dobradinha' : ''}`);
      if(!alvo.includes(q)) return false;
    }
    return true;
  }

  const taca = (c, classe = '') => `<span class="mu-taca mu-c--${c.id} ${classe}" aria-hidden="true">${tacaSVG(c.taca, 'currentColor')}</span>`;
  const selo = c => c.grupo === 'regional' ? 'Regional' : c.ambito === 'europeu' ? (c.extinta ? 'Europeia · extinta' : 'Europeia') : c.extinta ? 'Extinta' : 'Em disputa';

  /* =====================================================================
     ENTRADA
     ===================================================================== */
  function entrada(){
    const im = PALMARES.imagem;
    const n = id => comp(id).epocas.length;
    const numeros = [['liga', comp('liga').plural], ['taca', comp('taca').plural], ['supertaca', comp('supertaca').plural],
                     ['ligacup', comp('ligacup').plural], ['europa', comp('europa').plural]];
    return `<section class="mu-entrada sempre-escuro" aria-labelledby="mu-titulo">
      <img class="mu-entrada__foto" src="${im.src}" srcset="${im.src800} 800w, ${im.src} 1280w"
           sizes="(max-width: 900px) 100vw, 1180px" alt="${seguro(im.alt)}" width="1280" height="960" loading="lazy" decoding="async">
      <div class="mu-entrada__veu" aria-hidden="true"></div>
      <div class="mu-entrada__texto">
        <p class="mu-entrada__sobre">Museu do Sporting CP</p>
        <h2 class="mu-entrada__titulo" id="mu-titulo">Uma história de conquistas</h2>
        <p class="mu-entrada__lead">Os troféus do futebol sénior masculino, época a época, desde o primeiro Campeonato de Portugal em 1922/23.</p>
        <dl class="mu-numeros">
          ${numeros.map(([id, nome]) => `<div class="mu-c--${id}"><dt>${seguro(nome)}</dt><dd>${n(id)}</dd></div>`).join('')}
        </dl>
        <p class="mu-entrada__total"><b>${totalPrincipal()}</b> títulos nacionais e europeus
          <span>— inclui os ${n('cpt')} Campeonatos de Portugal (1922–1938); não inclui provas regionais nem outras extintas.</span></p>
        <a class="mu-entrada__ir" href="#mu-sala">Entrar na sala dos troféus</a>
      </div>
      <p class="mu-credito">${seguro(im.legenda)}. Foto: <a href="${im.origem}" target="_blank" rel="noopener">${seguro(im.autor)}</a>,
        <a href="${im.licencaUrl}" target="_blank" rel="noopener license">${seguro(im.licenca)}</a>, via Wikimedia Commons (${seguro(im.alteracao)}).</p>
    </section>`;
  }

  /* =====================================================================
     SALA DOS TROFÉUS — uma vitrine por competição
     ===================================================================== */
  function vitrine(c, i){
    const n = c.epocas.length;
    const primeira = c.epocas[0][0], ultima = c.epocas[n - 1][0];
    const estaAberta = aberta === c.id;
    return `<article class="mu-vitrine mu-c--${c.id} ${estaAberta ? 'is-aberta' : ''}" style="--i:${i}">
      <button type="button" class="mu-vitrine__botao" data-mu-vitrine="${c.id}" aria-expanded="${estaAberta}" aria-controls="mu-v-${c.id}">
        <span class="mu-vitrine__brilho" aria-hidden="true"></span>
        ${taca(c)}
        <b class="mu-vitrine__n">${n}</b>
        <span class="mu-vitrine__nome">${seguro(n > 1 ? c.plural : c.nome)}</span>
        <span class="mu-selo">${selo(c)}</span>
        <span class="mu-vitrine__periodo">${n > 1 ? `${epocaBonita(primeira)} → ${epocaBonita(ultima)}` : epocaBonita(primeira)}</span>
      </button>
      <div class="mu-vitrine__mais" id="mu-v-${c.id}" ${estaAberta ? '' : 'hidden'}>
        <p>${seguro(c.sobre)}</p>
        <ul class="mu-epocas" aria-label="Conquistas de ${seguro(c.nome)}">
          ${c.epocas.map(([e]) => `<li><button type="button" class="mu-epoca" data-mu-ver="${c.id}:${e}">${epocaBonita(e)}${temDobradinha(e) && ['liga', 'taca'].includes(c.id) ? '<i title="Dobradinha">D</i>' : ''}</button></li>`).join('')}
        </ul>
        <p class="mu-vitrine__acoes">
          <button type="button" class="chip" data-mu-filtrar="${['liga', 'taca', 'supertaca', 'ligacup'].includes(c.id) ? c.id : c.grupo === 'regional' ? 'regionais' : c.ambito === 'europeu' ? 'europa' : 'extintas'}">Ver na linha do tempo</button>
          <a href="${wiki(c.artigo)}" target="_blank" rel="noopener">Sobre a competição (Wikipédia)</a>
        </p>
      </div>
    </article>`;
  }

  function sala(){
    const principais = comps().filter(c => c.grupo === 'principal');
    const outras = comps().filter(c => c.grupo !== 'principal');
    return `<section class="mu-bloco" id="mu-sala" aria-labelledby="mu-sala-t">
      <header class="mu-bloco__topo">
        <h3 id="mu-sala-t">Sala dos troféus</h3>
        <p>Toca numa vitrine para ver todas as conquistas e abrir a ficha de cada uma.</p>
      </header>
      <div class="mu-galeria">${principais.map(vitrine).join('')}</div>
      <details class="mu-outras" ${outras.some(c => c.id === aberta) ? 'open' : ''}>
        <summary>Outras conquistas e títulos regionais <span>${outras.reduce((s, c) => s + c.epocas.length, 0)}</span></summary>
        <p class="mu-nota">Competições extintas e regionais que constam do palmarés da Wikipédia em português, mas não de todas as listas. Mostram-se à parte e não entram no total.</p>
        <div class="mu-galeria mu-galeria--pequena">${outras.map(vitrine).join('')}</div>
      </details>
    </section>`;
  }

  /* =====================================================================
     LINHA DO TEMPO
     ===================================================================== */
  function linhaTempo(){
    const decadas = [...new Set(todas().filter(x => filtro === 'regionais' ? x.c.grupo === 'regional' : x.c.grupo !== 'regional').map(x => decadaDe(x.epoca)))];
    return `<section class="mu-bloco" id="mu-linha" aria-labelledby="mu-linha-t">
      <header class="mu-bloco__topo">
        <h3 id="mu-linha-t">Linha do tempo</h3>
        <p id="mu-resumo" role="status" aria-live="polite"></p>
      </header>
      <div class="mu-filtros">
        <div class="mu-chips" role="group" aria-label="Competição">
          ${FILTROS.map(([k, n]) => `<button type="button" class="chip ${filtro === k ? 'is-on' : ''}" aria-pressed="${filtro === k}" data-mu-filtro="${k}">${n}</button>`).join('')}
        </div>
        <div class="mu-filtros__linha">
          <label class="chip chip--fonte"><span>${decada === 'todas' ? 'Todas as décadas' : nomeDecada(Number(decada))}</span>
            <select id="mu-decada" aria-label="Década">
              <option value="todas">Todas as décadas</option>
              ${decadas.map(d => `<option value="${d}" ${String(d) === String(decada) ? 'selected' : ''}>${nomeDecada(d)}</option>`).join('')}
            </select></label>
          <label class="mu-busca"><span class="so-leitor">Procurar uma época ou competição</span>
            <input type="search" id="mu-busca" placeholder="Procurar: 1974, Taça, dobradinha…" value="${seguro(busca)}" autocomplete="off"></label>
        </div>
      </div>
      <div id="mu-tempo"></div>
    </section>`;
  }

  function pintarTempo(){
    const alvo = $('#mu-tempo');
    if(!alvo) return;
    lista = todas().filter(passaFiltro);
    const porDecada = new Map();
    lista.forEach(x => {
      const d = decadaDe(x.epoca);
      if(!porDecada.has(d)) porDecada.set(d, []);
      porDecada.get(d).push(x);
    });
    const maximo = Math.max(1, ...[...porDecada.values()].map(v => v.length));
    const resumo = $('#mu-resumo');
    if(resumo) resumo.textContent = lista.length
      ? `${lista.length} ${lista.length === 1 ? 'conquista' : 'conquistas'} em ${porDecada.size} ${porDecada.size === 1 ? 'década' : 'décadas'}${filtro === 'todas' && !busca && decada === 'todas' ? ' · sem os títulos regionais' : ''}`
      : 'Nenhuma conquista com estes filtros';
    if(!lista.length){
      alvo.innerHTML = `<div class="mu-vazio">
        <p><b>Nenhuma conquista com estes filtros.</b></p>
        <p>Experimenta outra década ou competição, ou procura só o ano (por exemplo 1974).</p>
        <button type="button" class="chip" data-mu-limpar>Limpar filtros</button></div>`;
      return;
    }
    alvo.innerHTML = `<ol class="mu-tempo">
      ${[...porDecada.entries()].map(([d, xs], i) => `
        <li class="mu-decada" style="--i:${i}">
          <div class="mu-decada__cab">
            <b>${nomeDecada(d)}</b>
            <span>${xs.length} ${xs.length === 1 ? 'conquista' : 'conquistas'}</span>
            <i class="mu-decada__barra" style="--p:${xs.length / maximo}" aria-hidden="true"></i>
          </div>
          <ul class="mu-marcos">
            ${xs.map(x => `<li><button type="button" class="mu-marco mu-c--${x.c.id}" data-mu-ver="${x.chave}">
              <i class="mu-marco__ponto" aria-hidden="true"></i>
              <span class="mu-marco__ep">${epocaBonita(x.epoca)}</span>
              <span class="mu-marco__comp">${seguro(x.c.curto)}</span>
              ${temDobradinha(x.epoca) && ['liga', 'taca'].includes(x.c.id) ? '<span class="mu-marco__extra">dobradinha</span>' : ''}
            </button></li>`).join('')}
          </ul>
        </li>`).join('')}
    </ol>`;
  }

  /* =====================================================================
     FICHA DE UMA CONQUISTA
     ===================================================================== */
  function dialogo(){
    let d = $('#mu-ficha');
    if(d) return d;
    d = document.createElement('dialog');
    d.id = 'mu-ficha';
    d.className = 'mu-ficha';
    d.setAttribute('aria-labelledby', 'mu-ficha-t');
    document.body.appendChild(d);
    d.addEventListener('click', ev => {
      if(ev.target === d){ d.close(); return; }
      const b = ev.target.closest('button');
      if(!b) return;
      if(b.dataset.muFechar != null) d.close();
      if(b.dataset.muVer) ficha(b.dataset.muVer);
    });
    d.addEventListener('close', () => { ficha.origem?.focus?.(); });
    return d;
  }

  function ficha(chave){
    const x = acharConquista(chave);
    if(!x) return;
    const d = dialogo();
    const c = x.c, n = c.epocas.length;
    const ant = x.i > 0 ? c.epocas[x.i - 1][0] : null;
    const seg = x.i < n - 1 ? c.epocas[x.i + 1][0] : null;
    const anos = ant ? ano(x.epoca) - ano(ant) : 0;
    const junto = mesmaEpoca(x);
    const dobradinha = ['liga', 'taca'].includes(c.id) && temDobradinha(x.epoca);
    /* andar pela linha do tempo com os filtros que estão escolhidos */
    const onde = lista.findIndex(y => y.chave === x.chave);
    const antes = onde > 0 ? lista[onde - 1] : null, depois = onde >= 0 && onde < lista.length - 1 ? lista[onde + 1] : null;
    d.innerHTML = `
      <div class="mu-ficha__topo mu-c--${c.id}">
        ${taca(c, 'mu-taca--grande')}
        <div>
          <p class="mu-ficha__comp">${seguro(c.nome)}</p>
          <h3 class="mu-ficha__epoca" id="mu-ficha-t">${epocaBonita(x.epoca)}</h3>
          <p class="mu-ficha__selos"><span class="mu-selo">${selo(c)}</span>${dobradinha ? '<span class="mu-selo mu-selo--ouro">Dobradinha: Campeonato e Taça</span>' : ''}</p>
        </div>
        <button type="button" class="mu-ficha__fechar" data-mu-fechar aria-label="Fechar">×</button>
      </div>
      <dl class="mu-ficha__factos">
        <div><dt>Conquista</dt><dd>${n > 1 ? `${x.i + 1}.ª de ${n}` : 'a única'}</dd></div>
        <div><dt>Anterior</dt><dd>${ant ? `${epocaBonita(ant)} <small>(${anos} ${anos === 1 ? 'ano' : 'anos'} antes)</small>` : n > 1 ? 'é a primeira' : '—'}</dd></div>
        <div><dt>Seguinte</dt><dd>${seg ? epocaBonita(seg) : n > 1 ? 'é a mais recente' : '—'}</dd></div>
        ${junto.length ? `<div><dt>Na mesma época</dt><dd>${junto.map(y => `<button type="button" class="mu-ligacao" data-mu-ver="${y.chave}">${seguro(y.c.nome)}</button>`).join(', ')}</dd></div>` : ''}
      </dl>
      <p class="mu-ficha__sobre">${seguro(c.sobre)}</p>
      <p class="mu-ficha__wiki"><a href="${wiki(x.artigo || c.artigo)}" target="_blank" rel="noopener">${x.artigo ? `Ler sobre ${seguro(c.curto)} ${epocaBonita(x.epoca)} na Wikipédia` : `Ler sobre a ${seguro(c.nome)} na Wikipédia`}</a></p>
      <p class="mu-ficha__nota">Treinador, plantel e jogos desta conquista não aparecem aqui: ainda não há uma fonte verificada para todas. Fonte: Wikipédia${c.so_pt ? ' em português' : ' (pt e en)'}, verificada a ${PALMARES.verificado}.</p>
      <div class="mu-ficha__nav">
        ${antes ? `<button type="button" class="chip" data-mu-ver="${antes.chave}">← ${epocaBonita(antes.epoca)} · ${seguro(antes.c.curto)}</button>` : '<span></span>'}
        ${depois ? `<button type="button" class="chip" data-mu-ver="${depois.chave}">${epocaBonita(depois.epoca)} · ${seguro(depois.c.curto)} →</button>` : ''}
      </div>`;
    if(!d.open){
      ficha.origem = document.activeElement;
      d.showModal();
    }
    $('.mu-ficha__fechar', d)?.focus();
  }

  /* =====================================================================
     FONTES
     ===================================================================== */
  function fontes(){
    return `<section class="mu-fontes" aria-labelledby="mu-fontes-t">
      <h3 id="mu-fontes-t">Fontes do museu</h3>
      <ul>
        ${PALMARES.fontes.map(([n, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${seguro(n)}</a></li>`).join('')}
        <li>Títulos dos jogadores do plantel: secção de palmarés de cada jogador na Wikipédia.</li>
        <li>Fotografia: <a href="${PALMARES.imagem.origem}" target="_blank" rel="noopener">${seguro(PALMARES.imagem.autor)}, Wikimedia Commons</a>, ${seguro(PALMARES.imagem.licenca)}.</li>
      </ul>
      <p>Verificado a ${PALMARES.verificado}. Só futebol sénior masculino; sem equipas B nem torneios particulares. Encontraste um erro? Diz-nos no chat.</p>
    </section>`;
  }

  /* =====================================================================
     EVENTOS e API
     ===================================================================== */
  function ligar(raiz){
    raiz.addEventListener('click', ev => {
      const b = ev.target.closest('button, a[href="#mu-sala"]');
      if(!b) return;
      const d = b.dataset;
      if(b.matches('a[href="#mu-sala"]')){ ev.preventDefault(); $('#mu-sala')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if(d.muVitrine){
        aberta = aberta === d.muVitrine ? null : d.muVitrine;
        $$('.mu-vitrine', raiz).forEach(v => {
          const id = v.querySelector('[data-mu-vitrine]').dataset.muVitrine, sim = id === aberta;
          v.classList.toggle('is-aberta', sim);
          v.querySelector('[data-mu-vitrine]').setAttribute('aria-expanded', sim);
          v.querySelector('.mu-vitrine__mais').hidden = !sim;
        });
        return;
      }
      if(d.muVer){ ficha(d.muVer); return; }
      if(d.muFiltrar){ filtro = d.muFiltrar; decada = 'todas'; busca = ''; repintarLinha(); $('#mu-linha')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if(d.muFiltro){ filtro = d.muFiltro; if(decada !== 'todas' && !todas().some(x => passaFiltro(x))) decada = 'todas'; repintarLinha(); return; }
      if(d.muLimpar != null){ filtro = 'todas'; decada = 'todas'; busca = ''; repintarLinha(); return; }
    });
    raiz.addEventListener('change', ev => {
      if(ev.target.id === 'mu-decada'){ decada = ev.target.value; repintarLinha(); $('#mu-decada')?.focus(); }
    });
    raiz.addEventListener('input', ev => {
      if(ev.target.id !== 'mu-busca') return;
      busca = ev.target.value.trim();
      clearTimeout(ligar._t);
      ligar._t = setTimeout(pintarTempo, 150);
    });
  }

  /* os filtros mudaram: o cabeçalho da linha (chips, década) e a lista */
  function repintarLinha(){
    const sec = $('#mu-linha');
    if(!sec) return;
    const foco = document.activeElement?.dataset?.muFiltro;
    sec.outerHTML = linhaTempo();
    pintarTempo();
    if(foco) $(`[data-mu-filtro="${foco}"]`)?.focus();
  }

  function pintar(){
    const raiz = $('#museu');
    if(!raiz || typeof PALMARES === 'undefined') return;
    raiz.innerHTML = entrada() + sala() + linhaTempo();
    const f = $('#museu-fontes');
    if(f) f.innerHTML = fontes();
    pintarTempo();
    if(!ligado){ ligado = true; ligar(raiz); }
  }

  /* para os testes */
  const _teste = { todas, passaFiltro, temDobradinha, mesmaEpoca, totalPrincipal,
    filtrar(f, d = 'todas', b = ''){ filtro = f; decada = d; busca = b; return todas().filter(passaFiltro); } };

  return { pintar, abrir: ficha, _teste };
})();
window.Museu = Museu;
