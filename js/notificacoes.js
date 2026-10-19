/* =========================================================================
   NOTIFICAÇÕES PUSH — a parte do browser
   -------------------------------------------------------------------------
   Os avisos são só os que os dados confirmam (quem decide é a Edge Function
   supabase/functions/notificar/decidir.mjs):
     INICIO    — o jogo está a começar (hora marcada)
     RESULTADO — o resultado final, quando fica escrito
     OFICIAL   — notícia que o jornal dá como oficial (no máximo 1 em 2 h)
     JORNADA   — a jornada da Fantasy fecha daqui a 2 horas

   POR LIGAR: enquanto CONFIG.push.chavePublica for null, o cartão da
   Agenda fica escondido e nada pede autorização a ninguém. Passos para
   ligar em docs/NOTIFICACOES.md.

   A subscrição é anónima: guarda-se o endereço de envio deste browser e os
   tipos escolhidos (funções push_subscrever / push_cancelar), sem conta.
   O service worker (sw.js) mostra as mensagens e abre o sítio certo.
   ========================================================================= */

const Notificacoes = (() => {

  const TIPOS = {
    INICIO:    { nome: 'Começa o jogo',       descricao: 'À hora marcada de cada jogo da equipa principal', omissao: true },
    RESULTADO: { nome: 'Resultado final',     descricao: 'Quando o resultado fica registado no site',       omissao: true },
    OFICIAL:   { nome: 'Notícias oficiais',   descricao: 'Quando um jornal dá uma notícia como oficial (no máximo uma a cada 2 horas)', omissao: false },
    JORNADA:   { nome: 'Fecho da jornada da Fantasy', descricao: 'Duas horas antes, para confirmares a equipa',  omissao: false }
  };

  const CHAVE_PREFS = 'scp-notificacoes-prefs-v2';
  const $ = s => document.querySelector(s);

  const chavePublica = () => (typeof CONFIG !== 'undefined' && CONFIG.push?.chavePublica) || null;
  const temApi = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  function suportado(){ return !!chavePublica() && temApi(); }

  function preferencias(){
    try{
      const g = JSON.parse(localStorage.getItem(CHAVE_PREFS) || 'null');
      if(g) return Object.fromEntries(Object.keys(TIPOS).map(k => [k, !!g[k]]));
    }catch(e){}
    return Object.fromEntries(Object.entries(TIPOS).map(([k, t]) => [k, t.omissao]));
  }
  function guardarPreferencias(p){
    try{ localStorage.setItem(CHAVE_PREFS, JSON.stringify(p)); }catch(e){}
  }
  const escolhidos = p => Object.keys(TIPOS).filter(k => p[k]);

  /* a chave VAPID vem em base64url; o pushManager quer bytes */
  function bytesDaChave(b64){
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }

  /* as funções do Supabase chamam-se sem o supabase-js: um pedido simples */
  async function rpc(nome, corpo){
    const p = Nuvem.PROJETO;
    const r = await fetch(`${p.url}/rest/v1/rpc/${nome}`, {
      method: 'POST',
      headers: { apikey: p.chave, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo)
    });
    if(!r.ok) throw new Error(`${nome}: ${r.status}`);
  }
  const guardarNoServidor = (sub, tipos) =>
    rpc('push_subscrever', { p_endpoint: sub.endpoint, p_p256dh: sub.keys.p256dh, p_auth: sub.keys.auth, p_tipos: tipos });

  /* getRegistration responde logo (ready esperaria para sempre num sítio
     onde o service worker não se regista, como o servidor local) */
  async function subscricaoAtual(){
    if(!temApi()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }
  /* para ligar é preciso o service worker ativo: espera-se por ele, com limite */
  const registoAtivo = () => Promise.race([
    navigator.serviceWorker.ready,
    new Promise(r => setTimeout(() => r(null), 8000))
  ]);

  /* Pede autorização (só depois de um toque no botão), subscreve e guarda */
  async function ativar(prefs = preferencias()){
    if(!suportado()) return { ok: false, motivo: 'indisponivel' };
    const tipos = escolhidos(prefs);
    if(!tipos.length) return { ok: false, motivo: 'sem-tipos' };
    const permissao = await Notification.requestPermission();
    if(permissao !== 'granted') return { ok: false, motivo: 'recusada' };

    const reg = await registoAtivo();
    if(!reg) return { ok: false, motivo: 'indisponivel' };
    const sub = (await reg.pushManager.getSubscription()) ||
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDaChave(chavePublica()) });
    guardarPreferencias(prefs);
    try{ await guardarNoServidor(sub.toJSON(), tipos); }
    catch(e){ return { ok: false, motivo: 'servidor', erro: e }; }
    return { ok: true };
  }

  async function desativar(){
    const sub = await subscricaoAtual();
    if(!sub) return;
    try{ await rpc('push_cancelar', { p_endpoint: sub.endpoint }); }catch(e){}
    await sub.unsubscribe();
  }

  /* ---------------------------------------------------------------------
     O CARTÃO "Avisos no telemóvel" (na Agenda)
     --------------------------------------------------------------------- */
  const IOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const APP_INSTALADA = matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

  async function pintar(alvo){
    if(!alvo) return;
    alvo.hidden = !chavePublica();
    if(alvo.hidden) return;

    const corpo = alvo.querySelector('[data-push-corpo]');
    if(!temApi()){
      corpo.innerHTML = IOS && !APP_INSTALADA
        ? '<p class="avisos__nota">No iPhone e no iPad os avisos só funcionam com o site adicionado ao ecrã principal (no Safari: Partilhar → Adicionar ao ecrã principal), a partir do iOS 16.4.</p>'
        : '<p class="avisos__nota">Este browser não recebe avisos de sites.</p>';
      return;
    }
    const sub = await subscricaoAtual().catch(() => null);
    const ligado = !!sub && Notification.permission === 'granted';
    const bloqueado = Notification.permission === 'denied';
    const p = preferencias();
    corpo.innerHTML = `
      <fieldset class="avisos__tipos">
        <legend class="so-leitor">Que avisos queres receber</legend>
        ${Object.entries(TIPOS).map(([k, t]) => `
          <label class="avisos__tipo">
            <input type="checkbox" data-push-tipo="${k}" ${p[k] ? 'checked' : ''}>
            <span><b>${t.nome}</b><small>${t.descricao}</small></span>
          </label>`).join('')}
      </fieldset>
      <div class="avisos__acoes">
        ${ligado
          ? '<button type="button" class="botao-tentar" data-push-desligar>Desligar os avisos</button>'
          : `<button type="button" class="botao-tentar avisos__ligar" data-push-ligar ${bloqueado ? 'disabled' : ''}>Ligar os avisos</button>`}
      </div>
      <p class="avisos__estado" data-push-estado aria-live="polite">${
        ligado ? 'Os avisos estão ligados neste browser.'
        : bloqueado ? 'Os avisos estão bloqueados nas definições do browser para este site.'
        : 'O browser vai pedir autorização quando tocares em «Ligar os avisos».'}</p>`;
  }

  /* toques e escolhas no cartão */
  document.addEventListener('click', async e => {
    const ligar = e.target.closest('[data-push-ligar]'), desligar = e.target.closest('[data-push-desligar]');
    if(!ligar && !desligar) return;
    const alvo = e.target.closest('#avisos-push');
    const estado = alvo?.querySelector('[data-push-estado]');
    const botao = ligar || desligar;
    botao.disabled = true;
    if(ligar){
      if(estado) estado.textContent = 'A ligar…';
      const r = await ativar().catch(erro => ({ ok: false, motivo: 'servidor', erro }));
      if(!r.ok && estado){
        estado.textContent = {
          'sem-tipos': 'Escolhe pelo menos um tipo de aviso.',
          recusada: 'Sem autorização do browser, os avisos não podem chegar.',
          servidor: 'Não foi possível guardar a subscrição. Tenta outra vez daqui a pouco.'
        }[r.motivo] || 'Os avisos não estão disponíveis.';
        botao.disabled = false;
        return;
      }
    }else{
      await desativar().catch(() => {});
    }
    pintar(alvo);
  });

  document.addEventListener('change', async e => {
    const caixa = e.target.closest('[data-push-tipo]');
    if(!caixa) return;
    const alvo = caixa.closest('#avisos-push');
    const p = Object.fromEntries([...alvo.querySelectorAll('[data-push-tipo]')].map(c => [c.dataset.pushTipo, c.checked]));
    guardarPreferencias(p);
    const estado = alvo.querySelector('[data-push-estado]');
    const sub = await subscricaoAtual().catch(() => null);
    if(!sub) return;                                    // ainda desligado: fica para quando ligar
    if(!escolhidos(p).length){
      await desativar().catch(() => {});
      pintar(alvo);
      return;
    }
    try{
      await guardarNoServidor(sub.toJSON(), escolhidos(p));
      if(estado) estado.textContent = 'Escolhas guardadas.';
    }catch(err){
      if(estado) estado.textContent = 'Não foi possível guardar as escolhas. Tenta outra vez.';
    }
  });

  return { TIPOS, suportado, preferencias, ativar, desativar, pintar, _teste: { bytesDaChave, escolhidos } };
})();
