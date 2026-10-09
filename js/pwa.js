/* =========================================================================
   PWA — instalar a aplicação, funcionar sem rede, avisar de versões novas
   -------------------------------------------------------------------------
   · Regista o service worker (sw.js) e avisa quando há uma versão nova.
   · Instalação:
       Android e computador (Chrome, Edge…) — o browser dispara o evento
         beforeinstallprompt; guarda-se e o botão "Instalar aplicação" usa-o.
         Sem esse evento NÃO se mostra botão: seria um botão falso.
       iPhone e iPad — o Safari não tem instalação automática. Mostra-se
         como adicionar ao ecrã principal, passo a passo.
       Já instalada (a correr em modo aplicação, ou depois do appinstalled)
         — não se volta a convidar.
   · Google Play: quando CONFIG.app.googlePlay tiver o endereço real da
     ficha da loja, o Android passa a mostrar "Disponível na Google Play".
     Enquanto for null, nada de links inventados — fica a PWA.
   ========================================================================= */

const PWA = (() => {

  const CHAVE_INSTALADA = 'scp-pwa-instalada';
  const ua = navigator.userAgent;
  /* o iPadOS diz-se "Macintosh" — distingue-se pelo ecrã tátil */
  const ehIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const ehIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const ehAndroid = /Android/i.test(ua);
  const plataforma = ehIOS ? 'ios' : ehAndroid ? 'android' : 'computador';

  let pedidoInstalacao = null;     // o beforeinstallprompt guardado
  const ouvintes = new Set();

  const emModoApp = () =>
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: minimal-ui)').matches ||
    matchMedia('(display-mode: window-controls-overlay)').matches ||
    navigator.standalone === true;

  function instalada(){
    if(emModoApp()) return true;
    try{ return localStorage.getItem(CHAVE_INSTALADA) === '1'; }catch(e){ return false; }
  }

  const playUrl = () => {
    const u = (typeof CONFIG !== 'undefined' && CONFIG.app?.googlePlay) || null;
    return u && /^https:\/\/play\.google\.com\/store\/apps\/details\?id=/.test(u) ? u : null;
  };

  /* o que se pode oferecer neste dispositivo, agora */
  function oferta(){
    if(instalada()) return { tipo: 'instalada' };
    if(plataforma === 'android' && playUrl()) return { tipo: 'play', url: playUrl() };
    if(pedidoInstalacao) return { tipo: 'prompt' };
    if(plataforma === 'ios') return { tipo: 'ios' };
    return { tipo: 'nenhuma' };
  }

  const avisar = () => ouvintes.forEach(f => { try{ f(oferta()); }catch(e){} });

  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();               // o convite é nosso, no sítio certo
    pedidoInstalacao = e;
    try{ localStorage.removeItem(CHAVE_INSTALADA); }catch(err){}
    avisar();
  });

  addEventListener('appinstalled', () => {
    pedidoInstalacao = null;
    try{ localStorage.setItem(CHAVE_INSTALADA, '1'); }catch(e){}
    aviso('Aplicação instalada. Já a encontras no ecrã principal.');
    avisar();
  });

  matchMedia('(display-mode: standalone)').addEventListener?.('change', avisar);

  async function instalar(){
    const o = oferta();
    if(o.tipo === 'play'){ window.open(o.url, '_blank', 'noopener'); return; }
    if(o.tipo === 'ios'){ abrirInstrucoesIOS(); return; }
    if(!pedidoInstalacao) return;
    pedidoInstalacao.prompt();
    try{ await pedidoInstalacao.userChoice; }catch(e){}
    pedidoInstalacao = null;          // só se pode usar uma vez
    avisar();
  }

  /* ---------------------------------------------------------------------
     iPhone / iPad — instruções
     --------------------------------------------------------------------- */
  function abrirInstrucoesIOS(){
    const d = document.getElementById('instalar-ios');
    if(!d) return;
    d.querySelector('[data-onde]').textContent = ehIPad
      ? 'no canto superior direito'
      : 'na barra de baixo do Safari';
    if(typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  }

  /* ---------------------------------------------------------------------
     Avisos curtos (versão nova, instalada…)
     --------------------------------------------------------------------- */
  function aviso(texto, acao){
    let el = document.getElementById('aviso-app');
    if(!el){
      el = document.createElement('div');
      el.id = 'aviso-app';
      el.className = 'aviso-app';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = texto;
    el.appendChild(p);
    if(acao){
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'aviso-app__acao';
      b.textContent = acao.rotulo;
      b.addEventListener('click', acao.fazer);
      el.appendChild(b);
    }
    const fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.className = 'aviso-app__fechar';
    fechar.setAttribute('aria-label', 'Fechar aviso');
    fechar.innerHTML = '<svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    fechar.addEventListener('click', () => el.classList.remove('aparece'));
    el.appendChild(fechar);
    requestAnimationFrame(() => el.classList.add('aparece'));
    clearTimeout(el._t);
    if(!acao) el._t = setTimeout(() => el.classList.remove('aparece'), 5000);
  }

  /* ---------------------------------------------------------------------
     Service worker
     --------------------------------------------------------------------- */
  function registar(){
    if(!('serviceWorker' in navigator) || !isSecureContext) return;
    /* em desenvolvimento (servidor.py) a cache escondia cada alteração;
       para testar a aplicação instalada localmente, abre com ?sw=1 */
    if(/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !/[?&]sw=1\b/.test(location.search)) return;
    addEventListener('load', async () => {
      let reg;
      try{ reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' }); }
      catch(e){ return; }

      const oferecer = sw => aviso('Há uma versão nova do site.', {
        rotulo: 'Atualizar',
        fazer: () => sw.postMessage('ativar-ja')
      });
      if(reg.waiting && navigator.serviceWorker.controller) oferecer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const novo = reg.installing;
        novo?.addEventListener('statechange', () => {
          if(novo.state === 'installed' && navigator.serviceWorker.controller) oferecer(novo);
        });
      });
      let recarregou = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if(recarregou) return;
        recarregou = true;
        location.reload();
      });
      /* quem deixa a aplicação aberta dias a fio também recebe as novidades */
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    });
  }

  /* ---------------------------------------------------------------------
     Interface: botão no cabeçalho, entrada na gaveta e a secção
     "Leva o Sporting contigo"
     --------------------------------------------------------------------- */
  const ICONE = d => `<svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I_BAIXAR = ICONE('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>');
  const I_TELEMOVEL = ICONE('<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>');
  const I_COMPUTADOR = ICONE('<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>');
  const I_MAIS = ICONE('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>');

  function pintarBotoes(o){
    const topo = document.getElementById('instalar-topo');
    const gaveta = document.getElementById('instalar-gaveta');
    const visivel = o.tipo === 'prompt' || o.tipo === 'ios' || o.tipo === 'play';
    const rotulo = o.tipo === 'play' ? 'Google Play' : o.tipo === 'ios' ? 'Adicionar ao ecrã' : 'Instalar';
    [topo, gaveta].forEach(b => {
      if(!b) return;
      b.hidden = !visivel;
      const r = b.querySelector('[data-rotulo]');
      if(r) r.textContent = b === gaveta ? (o.tipo === 'ios' ? 'Adicionar ao ecrã principal' : o.tipo === 'play' ? 'Disponível na Google Play' : 'Instalar aplicação') : rotulo;
    });
  }

  function pintarSeccao(o){
    const s = document.getElementById('levar');
    if(!s) return;
    if(o.tipo === 'instalada'){ s.hidden = true; return; }
    s.hidden = false;

    const android = playUrl()
      ? { rotulo: 'Disponível na Google Play', acao: 'play', ativo: true }
      : plataforma === 'android' && pedidoInstalacao
        ? { rotulo: 'Instalar aplicação', acao: 'instalar', ativo: true }
        : { rotulo: 'Instalar aplicação', nota: plataforma === 'android'
              ? 'Abre no Chrome e escolhe «Instalar aplicação» no menu ⋮.'
              : 'No telemóvel Android, abre este site no Chrome.', ativo: false };
    const iphone = { rotulo: 'Adicionar ao ecrã principal', acao: 'ios', ativo: true,
                     nota: plataforma === 'ios' ? null : 'No iPhone, abre este site no Safari.' };
    const computador = plataforma === 'computador' && pedidoInstalacao
      ? { rotulo: 'Instalar aplicação', acao: 'instalar', ativo: true }
      : { rotulo: 'Instalar aplicação', ativo: false,
          nota: plataforma === 'computador' ? 'Disponível no Chrome e no Edge — procura o ícone de instalar na barra do endereço.' : 'No computador, abre este site no Chrome ou no Edge.' };

    const cartoes = [
      { id: 'android', nome: 'Android', icone: I_TELEMOVEL, ...android },
      { id: 'ios', nome: 'iPhone e iPad', icone: I_TELEMOVEL, ...iphone },
      { id: 'computador', nome: 'Computador', icone: I_COMPUTADOR, ...computador }
    ].sort((a, b) => (b.id === plataforma) - (a.id === plataforma));

    s.innerHTML = `
      <div class="levar__texto">
        <p class="seccao__sobre">Aplicação</p>
        <h2 class="levar__titulo" id="tit-levar">Leva o Sporting contigo</h2>
        <p class="levar__sub">Acede rapidamente às notícias, jogos, resultados e ao minuto no teu telemóvel.</p>
        <ul class="levar__vantagens">
          <li>Abre num toque, a partir do ecrã principal</li>
          <li>Funciona com rede fraca — e sem rede mostra o que já leste</li>
          <li>Sem anúncios da loja, sem ocupar espaço</li>
        </ul>
      </div>
      <div class="levar__opcoes">
        ${cartoes.map(c => `
          <div class="levar__op ${c.id === plataforma ? 'levar__op--teu' : ''}">
            <span class="levar__icone">${c.icone}</span>
            <span class="levar__nome">${c.nome}${c.id === plataforma ? '<em>O teu dispositivo</em>' : ''}</span>
            ${c.ativo
              ? `<button type="button" class="levar__botao" data-acao="${c.acao}">${c.acao === 'ios' ? I_MAIS : I_BAIXAR}${c.rotulo}</button>`
              : `<span class="levar__botao levar__botao--off">${c.rotulo}</span>`}
            ${c.nota ? `<span class="levar__nota">${c.nota}</span>` : ''}
          </div>`).join('')}
      </div>`;

    s.querySelectorAll('[data-acao]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.acao;
      if(a === 'ios') abrirInstrucoesIOS();
      else instalar();
    }));
  }

  function ligarInterface(){
    document.getElementById('instalar-topo')?.addEventListener('click', instalar);
    document.getElementById('instalar-gaveta')?.addEventListener('click', instalar);
    const d = document.getElementById('instalar-ios');
    d?.querySelector('[data-fechar]')?.addEventListener('click', () => d.close?.());
    d?.addEventListener('click', e => { if(e.target === d) d.close?.(); });   // clique fora
    const desenhar = o => { pintarBotoes(o); pintarSeccao(o); };
    ouvintes.add(desenhar);
    desenhar(oferta());
    document.documentElement.classList.toggle('modo-app', emModoApp());
    document.documentElement.dataset.plataforma = plataforma;
  }

  registar();
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligarInterface);
  else ligarInterface();

  return { instalar, oferta, plataforma, emModoApp, aviso, abrirInstrucoesIOS, aoMudar: f => ouvintes.add(f) };
})();
