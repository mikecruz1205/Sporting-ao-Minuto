/* =========================================================================
   NOTIFICAÇÕES PUSH — a parte do browser
   -------------------------------------------------------------------------
   Arquitetura pronta, servidor por ligar. Para funcionar falta:
     1. um par de chaves VAPID (a pública vai para CONFIG.push.chavePublica);
     2. a tabela onde se guardam as subscrições (SQL em docs/NOTIFICACOES.md);
     3. quem envia (uma Edge Function do Supabase, por exemplo), disparada
        pelos golos, pelo início/fim do jogo, pelas notícias…
   Enquanto CONFIG.push.chavePublica for null, isto não pede autorização
   nenhuma a ninguém — suportado() devolve false e a interface não aparece.

   O service worker (sw.js) já recebe e mostra as mensagens e abre o site
   no sítio certo quando se toca na notificação.
   ========================================================================= */

const Notificacoes = (() => {

  /* tipos que o servidor pode enviar — o mesmo nome vai no campo "tipo" */
  const TIPOS = {
    GOLO:      { nome: 'Golos',            descricao: 'Cada golo do Sporting, no momento', omissao: true },
    INICIO:    { nome: 'Começou o jogo',   descricao: 'O apito inicial',                   omissao: true },
    FIM:       { nome: 'Fim do jogo',      descricao: 'O apito final',                     omissao: false },
    RESULTADO: { nome: 'Resultado final',  descricao: 'O resultado e os marcadores',       omissao: true },
    ONZE:      { nome: 'Escalação',        descricao: 'O onze inicial, quando sai',        omissao: true },
    NOTICIA:   { nome: 'Notícias',         descricao: 'Só as grandes: oficial, lesões…',   omissao: false },
    MERCADO:   { nome: 'Mercado',          descricao: 'Entradas e saídas confirmadas',     omissao: false }
  };

  const CHAVE_PREFS = 'scp-notificacoes-prefs';

  const chavePublica = () => (typeof CONFIG !== 'undefined' && CONFIG.push?.chavePublica) || null;

  function suportado(){
    return !!chavePublica() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function preferencias(){
    try{
      const g = JSON.parse(localStorage.getItem(CHAVE_PREFS) || 'null');
      if(g) return g;
    }catch(e){}
    return Object.fromEntries(Object.entries(TIPOS).map(([k, t]) => [k, t.omissao]));
  }
  function guardarPreferencias(p){
    try{ localStorage.setItem(CHAVE_PREFS, JSON.stringify(p)); }catch(e){}
  }

  /* a chave VAPID vem em base64url; o pushManager quer bytes */
  function bytesDaChave(b64){
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }

  /* Pede autorização (só depois de um gesto do utilizador), subscreve e
     entrega a subscrição a quem a guarda no servidor. */
  async function ativar(prefs = preferencias(), guardarNoServidor = null){
    if(!suportado()) return { ok: false, motivo: 'indisponivel' };
    const permissao = await Notification.requestPermission();
    if(permissao !== 'granted') return { ok: false, motivo: 'recusada' };

    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ||
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDaChave(chavePublica()) });

    guardarPreferencias(prefs);
    if(guardarNoServidor){
      try{ await guardarNoServidor(sub.toJSON(), prefs); }
      catch(e){ return { ok: false, motivo: 'servidor', erro: e }; }
    }
    return { ok: true, subscricao: sub.toJSON() };
  }

  async function desativar(apagarNoServidor = null){
    if(!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if(!sub) return;
    if(apagarNoServidor){ try{ await apagarNoServidor(sub.endpoint); }catch(e){} }
    await sub.unsubscribe();
  }

  return { TIPOS, suportado, preferencias, guardarPreferencias, ativar, desativar };
})();
