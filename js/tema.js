/* =========================================================================
   TEMA — claro / escuro
   -------------------------------------------------------------------------
   O tema inicial é posto por um script mínimo no <head>, antes da primeira
   pintura (sem piscar). Aqui fica o botão do cabeçalho:
     · guarda a escolha (localStorage 'scp-tema');
     · sem escolha guardada, acompanha o sistema, também se ele mudar;
     · a cor da barra do browser/telemóvel (theme-color) acompanha.
   ========================================================================= */

const Tema = (() => {
  const CHAVE = 'scp-tema';
  const COR_BARRA = { escuro: '#0a0c0b', claro: '#f3f5f4' };
  const sistemaClaro = matchMedia('(prefers-color-scheme: light)');

  const atual = () => document.documentElement.dataset.tema === 'claro' ? 'claro' : 'escuro';
  function guardado(){
    try{ const t = localStorage.getItem(CHAVE); return t === 'claro' || t === 'escuro' ? t : null; }
    catch(e){ return null; }
  }

  function pintarBotoes(){
    const t = atual();
    const outro = t === 'claro' ? 'escuro' : 'claro';
    document.querySelectorAll('[data-tema-botao]').forEach(b => {
      b.setAttribute('aria-label', `Tema ${t}. Mudar para tema ${outro}`);
      b.title = `Mudar para tema ${outro}`;
      b.setAttribute('aria-pressed', t === 'claro');
      const r = b.querySelector('[data-tema-rotulo]');
      if(r) r.textContent = t === 'claro' ? 'Tema escuro' : 'Tema claro';
    });
  }

  function aplicar(t, guardar){
    document.documentElement.dataset.tema = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.content = COR_BARRA[t];
    if(guardar){ try{ localStorage.setItem(CHAVE, t); }catch(e){} }
    pintarBotoes();
    document.dispatchEvent(new CustomEvent('tema', { detail: t }));
  }

  /* a troca faz-se de uma vez: sem isto, cada elemento com transição de
     cor mudava ao seu ritmo e a página "escorria" de um tema para o outro */
  function trocar(t, guardar){
    /* troca instantânea: a View Transitions API ficava às vezes pendente
       (separador em segundo plano) e o clique parecia não fazer nada */
    const raiz = document.documentElement;
    raiz.classList.add('sem-transicoes');
    aplicar(t, guardar);
    requestAnimationFrame(() => requestAnimationFrame(() => raiz.classList.remove('sem-transicoes')));
  }

  const alternar = () => trocar(atual() === 'claro' ? 'escuro' : 'claro', true);

  /* sem escolha guardada, o site segue o sistema */
  sistemaClaro.addEventListener?.('change', e => { if(!guardado()) trocar(e.matches ? 'claro' : 'escuro', false); });

  function ligar(){
    document.querySelectorAll('[data-tema-botao]').forEach(b => b.addEventListener('click', alternar));
    pintarBotoes();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar); else ligar();

  return { atual, alternar, aplicar: t => trocar(t, true) };
})();
