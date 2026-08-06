/* =========================================================================
   CONTAS — registo e entrada
   -------------------------------------------------------------------------
   AVISO HONESTO: isto vive todo no browser. As contas ficam guardadas neste
   computador, neste browser, e não há servidor nenhum a validar nada. Quem
   souber abrir as ferramentas de programador consegue ver e mexer.

   Serve para o site ter contas e sessões — não serve para guardar segredos.
   Por isso: NÃO uses aqui uma palavra-passe que uses noutro sítio.

   O que se faz mesmo assim, por higiene: a palavra-passe nunca é guardada.
   Guarda-se SHA-256(sal + palavra-passe), com um sal diferente por conta.
   ========================================================================= */

const Contas = (() => {

  const CHAVE_CONTAS = 'scp-contas-v1';
  const CHAVE_SESSAO = 'scp-sessao-v2';

  const disponivel = () => !!(window.crypto && crypto.subtle && crypto.getRandomValues);

  /* ---------- utilitários ---------- */
  const hex = buf => [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2, '0')).join('');

  function salNovo(){
    return hex(crypto.getRandomValues(new Uint8Array(16)));
  }

  async function resumo(palavra, sal){
    const dados = new TextEncoder().encode(sal + ':' + palavra);
    return hex(await crypto.subtle.digest('SHA-256', dados));
  }

  /* nome de utilizador normalizado: é assim que se garante que não há dois
     iguais só por causa de maiúsculas ou acentos */
  const normaliza = u => (u || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  function lerContas(){
    try { return JSON.parse(localStorage.getItem(CHAVE_CONTAS) || '{}'); }
    catch(e){ return {}; }
  }

  function gravarContas(c){
    localStorage.setItem(CHAVE_CONTAS, JSON.stringify(c));
  }

  /* ---------- regras ---------- */
  const REGRAS = {
    utilizador: /^[a-zA-Z0-9._-]{3,20}$/,
    minimoPalavra: 6
  };

  function validarUtilizador(u){
    const limpo = (u || '').trim();
    if(!limpo) return 'Escreve um nome de utilizador.';
    if(!REGRAS.utilizador.test(limpo))
      return 'Entre 3 e 20 caracteres, só letras, números, ponto, traço ou underscore.';
    return null;
  }

  function validarPalavra(p){
    if(!p) return 'Escreve uma palavra-passe.';
    if(p.length < REGRAS.minimoPalavra)
      return `A palavra-passe tem de ter pelo menos ${REGRAS.minimoPalavra} caracteres.`;
    return null;
  }

  const existe = u => !!lerContas()[normaliza(u)];

  /* ---------- registo ---------- */
  async function registar(utilizador, palavra){
    if(!disponivel())
      return { erro: 'O browser não deixa criar contas nesta página. Abre por http://localhost.' };

    const eu = validarUtilizador(utilizador);
    if(eu) return { erro: eu };
    const ep = validarPalavra(palavra);
    if(ep) return { erro: ep };

    const contas = lerContas();
    const id = normaliza(utilizador);
    if(contas[id]) return { erro: 'Esse nome de utilizador já está a ser usado. Escolhe outro.' };

    const sal = salNovo();
    contas[id] = {
      nome: utilizador.trim(),          // como foi escrito, para mostrar
      sal,
      resumo: await resumo(palavra, sal),
      criada: new Date().toISOString()
    };
    gravarContas(contas);
    return { ok: true, nome: contas[id].nome };
  }

  /* ---------- entrada ---------- */
  async function entrar(utilizador, palavra, lembrar){
    if(!disponivel())
      return { erro: 'O browser não deixa entrar nesta página. Abre por http://localhost.' };

    const contas = lerContas();
    const conta = contas[normaliza(utilizador)];
    /* mensagem igual nos dois casos: não se diz se o nome existe ou não */
    const falhou = { erro: 'Utilizador ou palavra-passe errados.' };
    if(!conta) return falhou;
    if(await resumo(palavra, conta.sal) !== conta.resumo) return falhou;

    const sessao = JSON.stringify({ id: normaliza(utilizador), nome: conta.nome });
    (lembrar ? localStorage : sessionStorage).setItem(CHAVE_SESSAO, sessao);
    if(!lembrar) localStorage.removeItem(CHAVE_SESSAO);

    return { ok: true, nome: conta.nome };
  }

  /* ---------- sessão ---------- */
  function sessao(){
    const bruto = localStorage.getItem(CHAVE_SESSAO)
               || sessionStorage.getItem(CHAVE_SESSAO);
    if(!bruto) return null;
    try{
      const s = JSON.parse(bruto);
      return lerContas()[s.id] ? s : null;   // conta apagada = sessão inválida
    }catch(e){ return null; }
  }

  function sair(){
    localStorage.removeItem(CHAVE_SESSAO);
    sessionStorage.removeItem(CHAVE_SESSAO);
  }

  const quantas = () => Object.keys(lerContas()).length;

  /* identificador da conta — serve de chave para o que for guardado por
     utilizador. Ao contrário do chaveNome() do app.js, mantém os números:
     senão "mike1" e "mike2" davam a mesma chave. */
  const idDe = normaliza;

  return { registar, entrar, sessao, sair, existe, quantas, idDe,
           validarUtilizador, validarPalavra, REGRAS, disponivel };
})();
