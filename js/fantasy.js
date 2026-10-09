/* =========================================================================
   FANTASY DO SPORTING — a interface
   -------------------------------------------------------------------------
   Tudo o que conta vive no servidor (supabase/migrations/*fantasy*):
   plantel, orçamento, transferências e pontos. Aqui só se lê e se pede ao
   servidor que valide e grave — a equipa guarda-se com
   fantasy_guardar_equipa() e os pontos nunca saem do browser.

   As contas que se mostram enquanto se monta a equipa (orçamento, saldo,
   transferências) são uma cópia das regras do servidor, só para dar
   resposta imediata; quem decide é sempre o servidor.
   ========================================================================= */

const Fantasy = (() => {

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const seguro = t => Componentes.seguro(t);
  const POS = ['GR', 'DEF', 'MED', 'AVA'];
  const NOME_POS = { GR: 'Guarda-redes', DEF: 'Defesas', MED: 'Médios', AVA: 'Avançados' };
  const NOME_POS_1 = { GR: 'guarda-redes', DEF: 'defesa', MED: 'médio', AVA: 'avançado' };

  /* ---------------------------------------------------------------- estado */
  let raiz = null;
  let db = null, eu = null;
  let cfg = null;                       // { jogo, pontuacao, precos }
  let jogadores = new Map();            // id → jogador (com preço, época e pontos)
  let jornadas = [];                    // por número, com o jogo
  let pontosJog = [];                   // fantasy_pontos_jogador
  let historicoPrecos = new Map();      // id → [{preco, desde, motivo}]
  let aberta = null;                    // a jornada em que se pode mexer
  let minhas = { equipas: [], escolhas: [], resultados: [], transferencias: [], historico: [], perfil: null, ligas: [] };
  let anterior = null;                  // equipa em vigor antes da jornada aberta
  let rascunho = null;                  // { titulares:[], banco:[], capitao, vice }
  let gravado = '';                     // assinatura do que está no servidor (para saber se há alterações)
  let herdada = false;                  // a equipa em vigor veio da jornada anterior
  let separador = 'equipa';
  let tocado = null;                    // jogador escolhido no campo
  let aTrocar = null;                   // à espera do segundo jogador da troca
  let filtroPos = 'todos', ordem = 'preco', busca = '';
  let jornadaPontos = null, jornadaClass = 'geral', ligaVista = null;
  let admin = false, adminJornada = null;
  let estado = 'por-carregar';          // por-carregar · a-carregar · pronto · erro
  let erro = '';
  let relogio = null;
  let aGuardar = false;
  let aviso = null;                     // { tipo: 'ok'|'erro', texto }

  const fmt = v => v == null ? '—' : Number(v).toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const lisboa = d => new Date(d).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const jor = id => jornadas.find(j => j.id === id);
  const jog = id => jogadores.get(Number(id));
  const semAcento = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /* ---------------------------------------------------------------- estado de uma jornada (igual ao servidor) */
  function estadoJornada(j){
    if(!j) return null;
    if(j.finalizada_em) return 'finalizada';
    if(j.calculada_em) return 'provisoria';
    if(Date.now() >= new Date(j.fecho)) return 'em_curso';
    if(aberta && j.id === aberta.id) return 'aberta';
    return 'futura';
  }
  const ROTULO_ESTADO = { aberta: 'Aberta', futura: 'Futura', em_curso: 'Em curso', provisoria: 'Provisória', finalizada: 'Finalizada' };

  /* =====================================================================
     CARREGAR — tudo de uma vez, em paralelo
     ===================================================================== */
  async function carregar(){
    estado = 'a-carregar'; pintar();
    db = Nuvem.cliente; eu = Nuvem.perfil;
    if(!db){ estado = 'erro'; erro = 'Sem ligação ao servidor do site.'; pintar(); return; }
    try{
      const pedidos = await Promise.all([
        db.from('fantasy_config').select('chave, valor'),
        db.from('desporto_jogadores').select('*'),
        db.from('fantasy_jogadores').select('*'),
        db.from('fantasy_precos').select('*').order('desde'),
        db.from('desporto_estatisticas_epoca').select('*').eq('competicao', 'todas'),
        db.from('fantasy_jornadas').select('*, jogo:desporto_jogos(*)').order('numero'),
        db.from('fantasy_pontos_jogador').select('*')
      ]);
      const falhou = pedidos.find(p => p.error);
      if(falhou) throw falhou.error;
      const [c, js, fj, pr, ep, jr, pj] = pedidos.map(p => p.data || []);

      cfg = Object.fromEntries(c.map(x => [x.chave, x.valor]));
      historicoPrecos = new Map();
      pr.forEach(p => {
        if(!historicoPrecos.has(p.jogador_id)) historicoPrecos.set(p.jogador_id, []);
        historicoPrecos.get(p.jogador_id).push(p);
      });
      const elegivel = new Map(fj.map(x => [x.jogador_id, x]));
      const epoca = new Map(ep.map(x => [x.jogador_id, x]));
      pontosJog = pj;
      jogadores = new Map(js.map(j => {
        const hp = historicoPrecos.get(j.id) || [];
        const meus = pj.filter(p => p.jogador_id === j.id);
        return [j.id, {
          ...j,
          preco: hp.length ? Number(hp[hp.length - 1].preco) : null,
          elegivel: !!elegivel.get(j.id)?.elegivel && j.no_plantel,
          motivoInelegivel: elegivel.get(j.id)?.motivo || (!j.no_plantel ? 'saiu do plantel' : null),
          epoca: epoca.get(j.id) || null,
          pontos: meus.length ? meus.reduce((s, p) => s + p.pontos, 0) : null
        }];
      }));
      jornadas = jr;
      aberta = jornadas.filter(j => new Date(j.fecho) > Date.now() && !j.finalizada_em)
                       .sort((a, b) => new Date(a.fecho) - new Date(b.fecho))[0] || null;

      if(eu) await carregarMinhas();
      montarRascunho();
      estado = 'pronto';
    }catch(e){
      estado = 'erro';
      erro = /fetch|network/i.test(e?.message || '') ? 'Sem ligação à internet.' : 'Não foi possível ler o Fantasy do servidor.';
    }
    pintar();
  }

  async function carregarMinhas(){
    const pedidos = await Promise.all([
      db.from('fantasy_equipa_jornada').select('*').eq('perfil_id', eu.id),
      db.from('fantasy_escolhas').select('*').eq('perfil_id', eu.id),
      db.from('fantasy_resultados').select('*').eq('perfil_id', eu.id),
      db.from('fantasy_transferencias').select('*').eq('perfil_id', eu.id).order('criado_em', { ascending: false }),
      db.from('fantasy_historico').select('*').eq('perfil_id', eu.id).order('criado_em', { ascending: false }).limit(20),
      db.from('fantasy_perfis').select('*').eq('perfil_id', eu.id).maybeSingle(),
      db.from('fantasy_liga_membros').select('liga_id, liga:fantasy_ligas(id, nome, codigo, dono)').eq('perfil_id', eu.id),
      db.from('fantasy_admins').select('perfil_id').eq('perfil_id', eu.id).maybeSingle()
    ]);
    const falhou = pedidos.find(p => p.error);
    if(falhou) throw falhou.error;
    const [eq, es, rs, tr, hi, pf, lg, ad] = pedidos.map(p => p.data);
    minhas = { equipas: eq || [], escolhas: es || [], resultados: rs || [], transferencias: tr || [],
               historico: hi || [], perfil: pf || null, ligas: (lg || []).map(x => x.liga).filter(Boolean) };
    admin = !!ad;
  }

  /* a equipa em vigor numa jornada: a última guardada até lá (inclusive) */
  function equipaEm(numero, estrito = false){
    const candidatas = minhas.equipas
      .map(e => ({ ...e, j: jor(e.jornada_id) }))
      .filter(e => e.j && (estrito ? e.j.numero < numero : e.j.numero <= numero))
      .sort((a, b) => b.j.numero - a.j.numero);
    const e = candidatas[0];
    if(!e) return null;
    return { ...e, escolhas: minhas.escolhas.filter(x => x.jornada_id === e.jornada_id) };
  }

  function montarRascunho(){
    anterior = aberta ? equipaEm(aberta.numero, true) : null;
    const base = aberta ? (equipaEm(aberta.numero) || anterior) : (minhas.equipas.length ? equipaEm(9999) : null);
    if(base){
      const es = base.escolhas;
      rascunho = {
        titulares: es.filter(e => e.titular).map(e => e.jogador_id),
        banco: es.filter(e => !e.titular).sort((a, b) => a.ordem_banco - b.ordem_banco).map(e => e.jogador_id),
        capitao: es.find(e => e.capitao)?.jogador_id ?? null,
        vice: es.find(e => e.vice)?.jogador_id ?? null
      };
      gravado = assinatura(rascunho);
      /* a equipa em vigor é da jornada anterior: mantém-se sozinha, não é preciso gravar */
      herdada = !!aberta && !minhas.equipas.some(e => e.jornada_id === aberta.id);
    }else{
      rascunho = { titulares: [], banco: [], capitao: null, vice: null };
      gravado = assinatura(rascunho);
      herdada = false;
    }
    const guardado = lerRascunho();
    if(guardado) rascunho = guardado;
  }
  const assinatura = r => JSON.stringify([r.titulares.slice().sort(), r.banco, r.capitao, r.vice]);

  /* rascunho por gravar: fica neste browser até ser gravado (conveniência —
     a equipa a sério é a do servidor) */
  const CHAVE_RASCUNHO = () => 'scp-fantasy-rascunho-' + (eu?.id || 'anonimo');
  function guardarRascunho(){
    try{
      if(aberta && alterado()) localStorage.setItem(CHAVE_RASCUNHO(), JSON.stringify({ jornada: aberta.id, r: rascunho }));
      else localStorage.removeItem(CHAVE_RASCUNHO());
    }catch(e){}
  }
  function lerRascunho(){
    try{
      const g = JSON.parse(localStorage.getItem(CHAVE_RASCUNHO()) || 'null');
      if(!g || !aberta || g.jornada !== aberta.id) return null;
      const ids = [...g.r.titulares, ...g.r.banco];
      return ids.every(id => jog(id)) ? g.r : null;
    }catch(e){ return null; }
  }
  const alterado = () => !!rascunho && assinatura(rascunho) !== gravado;

  /* =====================================================================
     CONTAS (cópia das regras do servidor, para resposta imediata)
     ===================================================================== */
  const plantel = () => rascunho ? [...rascunho.titulares, ...rascunho.banco] : [];
  const contar = (ids) => {
    const c = { GR: 0, DEF: 0, MED: 0, AVA: 0 };
    ids.forEach(id => { const j = jog(id); if(j) c[j.posicao]++; });
    return c;
  };
  const formacaoValida = c => cfg && c.GR + c.DEF + c.MED + c.AVA === 11 &&
    POS.every(p => c[p] >= cfg.jogo.onze_min[p] && c[p] <= cfg.jogo.onze_max[p]);
  const precoAnterior = id => anterior?.escolhas.find(e => e.jogador_id === id)?.preco_compra;

  function contas(){
    const ids = plantel();
    const orcBase = anterior ? Number(anterior.orcamento) : Number(cfg.jogo.orcamento);
    const vendidos = anterior ? anterior.escolhas.filter(e => !ids.includes(e.jogador_id)) : [];
    const orcamento = orcBase + vendidos.reduce((s, e) => s + ((jog(e.jogador_id)?.preco ?? Number(e.preco_compra)) - Number(e.preco_compra)), 0);
    const gasto = ids.reduce((s, id) => s + Number(precoAnterior(id) ?? jog(id)?.preco ?? 0), 0);
    const entradas = anterior ? ids.filter(id => precoAnterior(id) == null).length : 0;
    const gratisInel = vendidos.filter(e => !jog(e.jogador_id)?.elegivel).length;
    const gratis = cfg.jogo.transferencias_gratis;
    const penalizacao = anterior ? Math.max(0, entradas - gratisInel - gratis) * cfg.jogo.custo_transferencia_extra : 0;
    return { orcamento, gasto, saldo: orcamento - gasto, entradas, gratis, penalizacao, primeira: !anterior };
  }

  /* o que falta para a equipa poder ser guardada */
  function problemas(){
    if(!cfg || !rascunho) return [];
    const p = [];
    const c = contar(plantel());
    POS.forEach(k => {
      const falta = cfg.jogo.plantel[k] - c[k];
      if(falta > 0) p.push(`Falta${falta > 1 ? 'm' : ''} ${falta} ${falta > 1 ? NOME_POS[k].toLowerCase() : NOME_POS_1[k]}`);
    });
    if(plantel().length === 15){
      if(rascunho.titulares.length !== 11 || !formacaoValida(contar(rascunho.titulares)))
        p.push('O onze tem de ter 1 guarda-redes, 3 a 5 defesas, 2 a 5 médios e 1 a 3 avançados');
      if(jog(rascunho.banco[0])?.posicao !== 'GR') p.push('O primeiro do banco tem de ser o guarda-redes suplente');
      if(!rascunho.capitao) p.push('Escolhe o capitão');
      if(!rascunho.vice) p.push('Escolhe o vice-capitão');
    }
    const k = contas();
    if(k.saldo < -0.001) p.push(`Passas o orçamento em ${fmt(-k.saldo)} M€`);
    const inel = plantel().filter(id => !jog(id)?.elegivel && precoAnterior(id) == null);
    if(inel.length) p.push('Há jogadores que já não podem ser escolhidos');
    return p;
  }

  /* =====================================================================
     MEXER NA EQUIPA (só no rascunho; gravar é outra coisa)
     ===================================================================== */
  function podeEntrar(id){
    const j = jog(id);
    if(!j) return 'Jogador desconhecido';
    if(plantel().includes(id)) return null;
    if(!j.elegivel) return j.motivoInelegivel || 'Não elegível';
    if(j.preco == null) return 'Ainda sem preço Fantasy';
    const c = contar(plantel());
    if(c[j.posicao] >= cfg.jogo.plantel[j.posicao]) return `Já tens ${cfg.jogo.plantel[j.posicao]} ${NOME_POS[j.posicao].toLowerCase()}`;
    if(plantel().length >= 15) return 'O plantel já tem 15';
    const custo = Number(precoAnterior(id) ?? j.preco);
    if(contas().saldo - custo < -0.001) return `Faltam ${fmt(custo - contas().saldo)} M€`;
    return null;
  }

  function adicionar(id){
    if(podeEntrar(id)) return;
    const j = jog(id);
    const c = contar(rascunho.titulares);
    c[j.posicao]++;
    const cabeNoOnze = rascunho.titulares.length < 11 && c[j.posicao] <= cfg.jogo.onze_max[j.posicao]
      && (j.posicao !== 'GR' || c.GR === 1);
    if(cabeNoOnze) rascunho.titulares.push(id); else rascunho.banco.push(id);
    equilibrar();
    corrigirOnze();
    arrumarBanco();
  }

  /* com o onze completo mas numa formação impossível (por exemplo sem
     avançados), sobe do banco quem falta e desce quem está a mais */
  function corrigirOnze(){
    for(let volta = 0; volta < 6 && rascunho.titulares.length === 11 && !formacaoValida(contar(rascunho.titulares)); volta++){
      const c = contar(rascunho.titulares);
      const falta = POS.find(p => c[p] < cfg.jogo.onze_min[p]);
      const sobra = POS.find(p => c[p] > cfg.jogo.onze_max[p])
                 || [...POS].reverse().find(p => p !== falta && p !== 'GR' && c[p] > cfg.jogo.onze_min[p]);
      const entra = rascunho.banco.find(x => jog(x).posicao === falta);
      const sai = [...rascunho.titulares].reverse().find(x => jog(x).posicao === sobra);
      if(!falta || !entra || !sai) break;
      rascunho.titulares = rascunho.titulares.map(x => x === sai ? entra : x);
      rascunho.banco = rascunho.banco.map(x => x === entra ? sai : x);
      if(rascunho.capitao === sai) rascunho.capitao = null;
      if(rascunho.vice === sai) rascunho.vice = null;
    }
  }

  /* banco com mais de 4: sobe ao onze o primeiro suplente que lá caiba */
  function equilibrar(){
    while(rascunho.banco.length > 4 && rascunho.titulares.length < 11){
      const c = contar(rascunho.titulares);
      const sobe = rascunho.banco.find(x => {
        const p = jog(x).posicao;
        return c[p] + 1 <= cfg.jogo.onze_max[p] && (p !== 'GR' || c.GR === 0);
      });
      if(!sobe) break;
      rascunho.banco = rascunho.banco.filter(x => x !== sobe);
      rascunho.titulares.push(sobe);
    }
  }

  function remover(id){
    rascunho.titulares = rascunho.titulares.filter(x => x !== id);
    rascunho.banco = rascunho.banco.filter(x => x !== id);
    if(rascunho.capitao === id) rascunho.capitao = null;
    if(rascunho.vice === id) rascunho.vice = null;
    if(tocado === id) tocado = null;
    if(aTrocar === id) aTrocar = null;
  }

  /* o guarda-redes suplente vai sempre à frente */
  function arrumarBanco(){
    rascunho.banco.sort((a, b) => (jog(a)?.posicao === 'GR' ? 0 : 1) - (jog(b)?.posicao === 'GR' ? 0 : 1));
  }

  /* troca entre um titular e um suplente, se a formação continuar válida */
  function trocar(a, b){
    const tA = rascunho.titulares.includes(a), tB = rascunho.titulares.includes(b);
    if(tA === tB) return 'Escolhe um titular e um suplente';
    const tit = tA ? a : b, sup = tA ? b : a;
    if((jog(tit).posicao === 'GR') !== (jog(sup).posicao === 'GR')) return 'Um guarda-redes só troca com outro guarda-redes';
    const novo = rascunho.titulares.map(x => x === tit ? sup : x);
    if(!formacaoValida(contar(novo))) return 'Essa troca deixava a formação inválida (3–5 defesas, 2–5 médios, 1–3 avançados)';
    rascunho.titulares = novo;
    rascunho.banco = rascunho.banco.map(x => x === sup ? tit : x);
    if(rascunho.capitao === tit) rascunho.capitao = null;
    if(rascunho.vice === tit) rascunho.vice = null;
    arrumarBanco();
    return null;
  }

  function moverBanco(id, delta){
    const i = rascunho.banco.indexOf(id), k = i + delta;
    if(i < 1 || k < 1 || k >= rascunho.banco.length) return;
    [rascunho.banco[i], rascunho.banco[k]] = [rascunho.banco[k], rascunho.banco[i]];
  }

  function capitao(id){
    if(!rascunho.titulares.includes(id)) return;
    if(rascunho.vice === id) rascunho.vice = rascunho.capitao;
    rascunho.capitao = id;
  }
  function vice(id){
    if(!rascunho.titulares.includes(id)) return;
    if(rascunho.capitao === id) rascunho.capitao = rascunho.vice;
    rascunho.vice = id;
  }

  /* =====================================================================
     GRAVAR — o servidor valida tudo outra vez
     ===================================================================== */
  async function guardar(){
    if(!eu){ window.Entrada?.exigirConta('Entra ou cria uma conta para guardares a tua equipa Fantasy.', 'formacao'); return; }
    if(problemas().length || aGuardar) return;
    aGuardar = true; pintar();
    const nome = $('#fan-nome-equipa')?.value?.trim() || null;
    const { data, error } = await db.rpc('fantasy_guardar_equipa', {
      p_titulares: rascunho.titulares, p_banco: rascunho.banco,
      p_capitao: rascunho.capitao, p_vice: rascunho.vice, p_nome_equipa: nome
    });
    aGuardar = false;
    if(error){ avisar('erro', 'O servidor não aceitou: ' + error.message); pintar(); return; }
    if(!data?.ok){ avisar('erro', (data?.erros || ['Não foi possível guardar.']).join(' · ')); pintar(); return; }
    avisar('ok', data.penalizacao
      ? `Equipa guardada. ${data.transferencias} transferências: −${data.penalizacao} pontos nesta jornada.`
      : 'Equipa guardada.');
    try{ localStorage.removeItem(CHAVE_RASCUNHO()); }catch(e){}
    await carregarMinhas();
    montarRascunho();
    pintar();
  }

  function avisar(tipo, texto){
    aviso = { tipo, texto };
    clearTimeout(avisar._t);
    avisar._t = setTimeout(() => { aviso = null; pintarAviso(); }, 6000);
    pintarAviso();
  }

  /* =====================================================================
     DESENHO
     ===================================================================== */
  function pintar(){
    if(!raiz) return;
    if(estado === 'a-carregar' || estado === 'por-carregar'){
      raiz.innerHTML = `<div class="fan-osso" aria-hidden="true">
        <div class="osso" style="height:120px;border-radius:18px"></div>
        <div class="osso" style="height:44px;border-radius:999px;margin-top:16px"></div>
        <div class="osso" style="height:420px;border-radius:18px;margin-top:16px"></div></div>
        <p class="so-leitor" role="status">A carregar o Fantasy…</p>`;
      return;
    }
    if(estado === 'erro'){
      raiz.innerHTML = `<div class="estado estado--erro" role="alert">
        <p class="estado__titulo">${seguro(erro)}</p>
        <p class="estado__texto">O Fantasy precisa do servidor para mostrar preços, equipas e pontos.</p>
        <button type="button" class="botao-largo botao-largo--fantasma" data-fan="recarregar">Tentar outra vez</button></div>`;
      return;
    }
    const sel = [['equipa', 'Equipa'], ['mercado', 'Mercado'], ['pontos', 'Pontos'], ['classificacao', 'Classificação'],
                 ['ligas', 'Ligas'], ['regras', 'Regras']].concat(admin ? [['admin', 'Gestão']] : []);
    raiz.innerHTML = `
      ${cabecalho()}
      ${resumo()}
      <div class="fan-sep" role="tablist" aria-label="Fantasy">
        ${sel.map(([k, n]) => `<button type="button" role="tab" class="chip ${separador === k ? 'is-on' : ''}" aria-selected="${separador === k}" data-fan-sep="${k}">${n}</button>`).join('')}
      </div>
      <div class="fan-aviso" id="fan-aviso" role="status" aria-live="polite"></div>
      <div class="fan-corpo" id="fan-corpo">${corpo()}</div>
      ${barraGuardar()}`;
    pintarAviso();
    ligarRelogio();
    guardarRascunho();
    if(separador === 'classificacao') pintarClassificacao();
    if(separador === 'ligas') pintarLiga();
    if(separador === 'admin') preencherGestao();
  }

  function pintarAviso(){
    const el = raiz && $('#fan-aviso', raiz);
    if(!el) return;
    el.className = 'fan-aviso' + (aviso ? ' fan-aviso--' + aviso.tipo : '');
    el.textContent = aviso ? aviso.texto : '';
  }

  /* ---------- cabeçalho: a jornada aberta e o fecho */
  function cabecalho(){
    if(!aberta){
      return `<header class="fan-topo sempre-escuro"><p class="fan-topo__sobre">Fantasy do Sporting</p>
        <h3 class="fan-topo__titulo">Sem jornada aberta</h3>
        <p class="fan-topo__nota">Quando houver jogos marcados no calendário, a próxima jornada abre aqui.</p></header>`;
    }
    const g = aberta.jogo;
    return `<header class="fan-topo sempre-escuro">
      <p class="fan-topo__sobre">Jornada ${aberta.numero} · ${seguro(g.competicao)}${g.fase ? ' · ' + seguro(g.fase) : ''}</p>
      <h3 class="fan-topo__titulo">${seguro(g.casa)} <span>x</span> ${seguro(g.fora)}</h3>
      <p class="fan-topo__nota">Fecha ${lisboa(aberta.fecho)} · <b id="fan-relogio" aria-live="off"></b></p>
    </header>`;
  }

  /* ---------- números da equipa: sempre à vista */
  function resumo(){
    if(!cfg) return '';
    const k = contas();
    const c = contar(plantel());
    const lugares = POS.map(p => `<span class="${c[p] === cfg.jogo.plantel[p] ? 'cheio' : ''}">${p} ${c[p]}/${cfg.jogo.plantel[p]}</span>`).join('');
    return `<div class="fan-resumo" aria-label="Resumo da equipa">
      <div><span>Orçamento</span><b>${fmt(k.orcamento)}<i>M€</i></b></div>
      <div><span>Gasto</span><b>${fmt(k.gasto)}<i>M€</i></b></div>
      <div class="${k.saldo < -0.001 ? 'mau' : ''}"><span>Saldo</span><b>${fmt(k.saldo)}<i>M€</i></b></div>
      <div><span>Jogadores</span><b>${plantel().length}<i>/15</i></b></div>
      <div><span>Transferências</span><b>${k.primeira ? '∞' : `${k.entradas}<i>/${k.gratis} grátis</i>`}</b>${k.penalizacao ? `<em>−${k.penalizacao} pts</em>` : ''}</div>
      <p class="fan-resumo__lugares">${lugares}</p>
    </div>`;
  }

  function corpo(){
    switch(separador){
      case 'mercado': return mercado();
      case 'pontos': return pontos();
      case 'classificacao': return '<div id="fan-class">' + Componentes.esqueletoCompacto(5) + '</div>';
      case 'ligas': return ligas();
      case 'regras': return regras();
      case 'admin': return gestao();
      default: return equipa();
    }
  }

  /* ---------- cara de um jogador: fotografia autorizada ou avatar neutro */
  function cara(j, tam = 'm'){
    const ini = j.nome_curto.replace(/^[A-Z]\.\s*/, '').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
    return `<span class="fan-cara fan-cara--${tam} fan-pos--${j.posicao}">
      ${j.foto_url ? `<img src="${seguro(j.foto_url)}" alt="${seguro(j.nome)}" loading="lazy" decoding="async" width="150" height="150"
            onerror="this.remove()">` : ''}
      <span class="fan-cara__ini" aria-hidden="true">${seguro(ini)}</span>
    </span>`;
  }

  /* ---------- EQUIPA: o campo e o banco */
  function equipa(){
    if(!rascunho || !plantel().length){
      return `<div class="fan-vazio">
        <p class="estado__titulo">Ainda não tens equipa</p>
        <p class="estado__texto">Escolhe 15 jogadores do Sporting (2 guarda-redes, 5 defesas, 5 médios e 3 avançados) com ${fmt(cfg.jogo.orcamento)} M€ Fantasy.</p>
        <button type="button" class="botao-cta" data-fan-sep="mercado">Ir ao mercado</button>
      </div>`;
    }
    const linha = p => {
      const ids = rascunho.titulares.filter(id => jog(id)?.posicao === p);
      return `<div class="fan-linha" data-linha="${p}">${ids.map(slot).join('')}</div>`;
    };
    const falta = POS.map(p => [p, cfg.jogo.plantel[p] - contar(plantel())[p]]).filter(([, n]) => n > 0);
    const c = contar(rascunho.titulares);
    return `
      ${herdada && !alterado() ? `<p class="fan-nota fan-nota--info">A tua equipa da jornada anterior mantém-se nesta jornada. Só precisas de guardar se mudares alguma coisa.</p>` : ''}
      <div class="fan-campo" aria-label="O teu onze">
        <div class="fan-campo__formacao">${c.DEF}-${c.MED}-${c.AVA}</div>
        ${['AVA', 'MED', 'DEF', 'GR'].map(linha).join('')}
      </div>
      <div class="fan-banco" aria-label="Banco, por ordem de entrada">
        <p class="fan-rotulo">Banco <span>— entram por esta ordem se um titular não jogar</span></p>
        <ol class="fan-banco__lista">${rascunho.banco.map((id, i) => `<li>${slot(id, i)}</li>`).join('')}</ol>
      </div>
      ${falta.length ? `<div class="fan-falta"><p class="fan-rotulo">Por preencher</p>
        ${falta.map(([p, n]) => `<button type="button" class="chip" data-fan-faltam="${p}">+ ${n} ${n > 1 ? NOME_POS[p].toLowerCase() : NOME_POS_1[p]}</button>`).join('')}</div>` : ''}
      ${painelJogador()}
      ${eu ? `<label class="fan-nome"><span>Nome da equipa</span>
        <input id="fan-nome-equipa" type="text" maxlength="30" minlength="3" autocomplete="off"
               value="${seguro(minhas.perfil?.nome_equipa || '')}" placeholder="Equipa de ${seguro(eu.utilizador)}"></label>` : ''}
      ${historico()}`;
  }

  /* no campo cabe pouco: o apelido, com a inicial se houver outro igual no plantel */
  function rotuloCampo(j){
    const ultimo = n => n.trim().split(/\s+/).pop();
    const apelido = ultimo(j.nome_curto);
    const repetido = plantel().some(x => x !== j.id && jog(x) && ultimo(jog(x).nome_curto) === apelido);
    return repetido && !/^[A-Z]\./.test(j.nome_curto) ? `${j.nome_curto.trim()[0]}. ${apelido}` : apelido;
  }

  function slot(id, iBanco){
    const j = jog(id);
    if(!j) return '';
    const c = rascunho.capitao === id, v = rascunho.vice === id;
    const sel = tocado === id || aTrocar === id;
    const alvo = aTrocar && aTrocar !== id && (rascunho.titulares.includes(aTrocar) !== rascunho.titulares.includes(id));
    return `<button type="button" class="fan-slot ${sel ? 'is-sel' : ''} ${alvo ? 'is-alvo' : ''} ${!j.elegivel ? 'is-inelegivel' : ''}" data-fan-slot="${id}"
              aria-label="${seguro(j.nome)}, ${NOME_POS_1[j.posicao]}${c ? ', capitão' : v ? ', vice-capitão' : ''}${iBanco != null ? ', suplente ' + (iBanco + 1) : ''}">
      ${cara(j)}
      ${c ? '<i class="fan-braco" aria-hidden="true">C</i>' : v ? '<i class="fan-braco fan-braco--v" aria-hidden="true">V</i>' : ''}
      <span class="fan-slot__nome">${seguro(rotuloCampo(j))}</span>
      <span class="fan-slot__info">${fmt(precoAnterior(id) ?? j.preco)} M€</span>
    </button>`;
  }

  /* o que se pode fazer ao jogador tocado */
  function painelJogador(){
    const id = aTrocar || tocado;
    const j = id && jog(id);
    if(!j) return '';
    if(aTrocar) return `<div class="fan-painel" role="region" aria-label="Troca">
      <p><b>${seguro(j.nome_curto)}</b>: toca agora no ${rascunho.titulares.includes(id) ? 'suplente' : 'titular'} com quem queres trocar.</p>
      <button type="button" class="chip" data-fan="cancelar-troca">Cancelar</button></div>`;
    const titular = rascunho.titulares.includes(id);
    const iBanco = rascunho.banco.indexOf(id);
    const hp = historicoPrecos.get(id) || [];
    return `<div class="fan-painel" role="region" aria-label="${seguro(j.nome)}">
      <div class="fan-painel__topo">${cara(j, 'g')}
        <div><b>${seguro(j.nome)}</b>
          <span>${NOME_POS_1[j.posicao]}${j.numero ? ' · n.º ' + j.numero : ''}${j.nacionalidade ? ' · ' + seguro(j.nacionalidade) : ''}${j.idade ? ' · ' + j.idade + ' anos' : ''}</span>
          <span>${epocaTexto(j)}</span>
          <span>Preço ${fmt(j.preco)} M€${precoAnterior(id) != null && Number(precoAnterior(id)) !== j.preco ? ` · compraste a ${fmt(precoAnterior(id))} M€` : ''}${hp.length > 1 ? ` · ${hp.length - 1} alteraç${hp.length > 2 ? 'ões' : 'ão'} de preço` : ''}</span>
        </div>
        <button type="button" class="fan-fechar" data-fan="fechar-painel" aria-label="Fechar">×</button>
      </div>
      <div class="fan-painel__acoes">
        ${titular ? `<button type="button" class="chip ${rascunho.capitao === id ? 'is-on' : ''}" data-fan="capitao">Capitão</button>
                     <button type="button" class="chip ${rascunho.vice === id ? 'is-on' : ''}" data-fan="vice">Vice-capitão</button>` : ''}
        <button type="button" class="chip" data-fan="trocar">${titular ? 'Mandar para o banco' : 'Pôr a titular'}</button>
        ${iBanco > 1 ? `<button type="button" class="chip" data-fan="subir" aria-label="Subir na ordem do banco">↑ Subir</button>` : ''}
        ${iBanco > 0 && iBanco < rascunho.banco.length - 1 ? `<button type="button" class="chip" data-fan="descer" aria-label="Descer na ordem do banco">↓ Descer</button>` : ''}
        <button type="button" class="chip chip--perigo" data-fan="vender">Vender</button>
      </div>
      ${!j.elegivel ? `<p class="fan-nota">Já não pode ser escolhido (${seguro(j.motivoInelegivel || 'não elegível')}). Trocá-lo não conta como transferência.</p>` : ''}
    </div>`;
  }

  const epocaTexto = j => j.epoca
    ? `Época ${j.epoca.epoca}: ${j.epoca.jogos ?? 'sem dados'} jogos · ${j.epoca.golos ?? 'sem dados'} golos <small>(fonte: ${seguro(j.epoca.fonte)})</small>`
    : 'Estatísticas da época: sem dados disponíveis';

  function historico(){
    if(!minhas.transferencias.length && !minhas.historico.length) return '';
    return `<details class="fan-hist"><summary>As tuas alterações</summary>
      ${minhas.transferencias.length ? `<p class="fan-rotulo">Transferências</p><ul>${minhas.transferencias.slice(0, 15).map(t => `
        <li>J${jor(t.jornada_id)?.numero ?? '?'} · sai <b>${seguro(jog(t.sai)?.nome_curto || '?')}</b> (${fmt(t.preco_sai)}) · entra <b>${seguro(jog(t.entra)?.nome_curto || '?')}</b> (${fmt(t.preco_entra)})${t.gratis_por_inelegivel ? ' · grátis' : ''}</li>`).join('')}</ul>` : ''}
      <p class="fan-rotulo">Gravações</p><ul>${minhas.historico.map(h => `
        <li>${new Date(h.criado_em).toLocaleString('pt-PT')} · J${jor(h.jornada_id)?.numero ?? '?'} · ${seguro(h.detalhe?.formacao || '')}${h.detalhe?.transferencias ? ` · ${h.detalhe.transferencias} transf.` : ''}${h.detalhe?.penalizacao ? ` · −${h.detalhe.penalizacao} pts` : ''}</li>`).join('')}</ul>
    </details>`;
  }

  /* ---------- MERCADO */
  function mercado(){
    const lista = [...jogadores.values()]
      .filter(j => j.no_plantel || plantel().includes(j.id))
      .filter(j => filtroPos === 'todos' || j.posicao === filtroPos)
      .filter(j => !busca || semAcento(j.nome).includes(semAcento(busca)))
      .sort((a, b) => ordem === 'nome' ? a.nome.localeCompare(b.nome, 'pt')
                    : ordem === 'pontos' ? (b.pontos ?? -999) - (a.pontos ?? -999) || (b.preco - a.preco)
                    : (b.preco ?? 0) - (a.preco ?? 0) || a.nome.localeCompare(b.nome, 'pt'));
    return `
      <div class="fan-filtros">
        <div class="filtro-temas" role="group" aria-label="Posição">
          ${['todos', ...POS].map(p => `<button type="button" class="chip ${filtroPos === p ? 'is-on' : ''}" aria-pressed="${filtroPos === p}" data-fan-pos="${p}">${p === 'todos' ? 'Todos' : NOME_POS[p]}</button>`).join('')}
        </div>
        <div class="fan-filtros__linha">
          <label class="fan-busca"><span class="so-leitor">Procurar jogador</span>
            <input type="search" id="fan-busca" placeholder="Procurar jogador" value="${seguro(busca)}" autocomplete="off"></label>
          <label class="chip chip--fonte"><span>Ordem: ${{ preco: 'preço', pontos: 'pontos', nome: 'nome' }[ordem]}</span>
            <select id="fan-ordem" aria-label="Ordenar por"><option value="preco" ${ordem === 'preco' ? 'selected' : ''}>Preço</option>
              <option value="pontos" ${ordem === 'pontos' ? 'selected' : ''}>Pontos Fantasy</option><option value="nome" ${ordem === 'nome' ? 'selected' : ''}>Nome</option></select></label>
        </div>
      </div>
      <ul class="fan-mercado">${lista.map(linhaMercado).join('') || '<li class="vazio">Nenhum jogador com estes filtros.</li>'}</ul>
      <p class="fan-nota">Preços Fantasy próprios do jogo — não são valores de mercado. Fotografias: API-Football; sem fotografia autorizada, mostra-se um avatar.</p>`;
  }

  function linhaMercado(j){
    const tenho = plantel().includes(j.id);
    const porque = tenho ? null : podeEntrar(j.id);
    return `<li class="fan-mj ${tenho ? 'is-meu' : ''}">
      ${cara(j)}
      <span class="fan-mj__corpo">
        <b>${seguro(j.nome)}</b>
        <span>${NOME_POS_1[j.posicao]}${j.numero ? ' · ' + j.numero : ''} · ${j.epoca ? `${j.epoca.jogos ?? '—'} J · ${j.epoca.golos ?? '—'} G` : 'sem dados da época'}${j.pontos != null ? ` · <b>${j.pontos} pts</b>` : ''}</span>
        ${porque && !tenho ? `<small>${seguro(porque)}</small>` : ''}
      </span>
      <span class="fan-mj__preco">${fmt(j.preco)}<i>M€</i></span>
      ${tenho
        ? `<button type="button" class="fan-mj__botao fan-mj__botao--sai" data-fan-sai="${j.id}" aria-label="Vender ${seguro(j.nome)}">−</button>`
        : `<button type="button" class="fan-mj__botao" data-fan-entra="${j.id}" ${porque ? 'disabled' : ''} aria-label="Comprar ${seguro(j.nome)}${porque ? ' (' + seguro(porque) + ')' : ''}">+</button>`}
    </li>`;
  }

  /* ---------- PONTOS */
  const ROTULO_REGRA = {
    jogou: 'Jogou', jogou_60: '60 minutos ou mais', golo: 'Golos', assistencia: 'Assistências',
    baliza_inviolada: 'Baliza inviolada', golos_sofridos: 'Golos sofridos', defesas: 'Defesas',
    recuperacoes: 'Recuperações de bola', amarelo: 'Cartão amarelo', vermelho: 'Cartão vermelho',
    penalti_falhado: 'Penálti falhado', penalti_defendido: 'Penálti defendido', autogolo: 'Autogolo',
    nao_jogou: 'Não jogou', sem_dados: 'Sem dados'
  };

  function pontos(){
    const calculadas = jornadas.filter(j => j.calculada_em);
    if(!calculadas.length){
      const prox = aberta ? `A primeira jornada é a ${aberta.numero} (${seguro(aberta.jogo.casa)} x ${seguro(aberta.jogo.fora)}), que fecha ${lisboa(aberta.fecho)}.` : '';
      return `<div class="fan-vazio"><p class="estado__titulo">Ainda não há pontos</p>
        <p class="estado__texto">${prox} Os pontos aparecem depois de as estatísticas do jogo serem introduzidas — primeiro como provisórios, depois finais.</p></div>`;
    }
    if(!jornadaPontos || !calculadas.some(j => j.id === jornadaPontos)) jornadaPontos = calculadas[calculadas.length - 1].id;
    const j = jor(jornadaPontos);
    const meu = minhas.resultados.find(r => r.jornada_id === j.id);
    const eq = eu ? equipaEm(j.numero) : null;
    const pts = new Map(pontosJog.filter(p => p.jornada_id === j.id).map(p => [p.jogador_id, p]));
    const entrou = new Set((meu?.substituicoes || []).map(s => s.entra));
    const saiu = new Set((meu?.substituicoes || []).map(s => s.sai));
    const linha = (e) => {
      const jj = jog(e.jogador_id); if(!jj) return '';
      const p = pts.get(e.jogador_id);
      const cap = meu?.capitao_efetivo === e.jogador_id;
      const conta = (e.titular && !saiu.has(e.jogador_id)) || entrou.has(e.jogador_id);
      return `<li class="fan-pj ${conta ? '' : 'fan-pj--fora'}">
        ${cara(jj, 'p')}
        <span class="fan-pj__corpo"><b>${seguro(jj.nome_curto)}${cap ? ' <i class="fan-braco">C</i>' : ''}</b>
          <span>${entrou.has(e.jogador_id) ? 'entrou do banco · ' : saiu.has(e.jogador_id) ? 'substituído (não jogou) · ' : !e.titular ? 'banco · ' : ''}${p ? detalheCurto(p) : 'não foi utilizado'}</span></span>
        <b class="fan-pj__pts">${p ? p.pontos * (cap ? cfg.jogo.multiplicador_capitao : 1) : 0}</b>
      </li>`;
    };
    return `
      <div class="fan-filtros__linha">
        <label class="chip chip--fonte"><span>Jornada ${j.numero} · ${ROTULO_ESTADO[estadoJornada(j)]}</span>
          <select id="fan-jornada-pontos" aria-label="Escolher jornada">${calculadas.map(x => `<option value="${x.id}" ${x.id === j.id ? 'selected' : ''}>J${x.numero} · ${seguro(x.jogo.casa)} x ${seguro(x.jogo.fora)}</option>`).join('')}</select></label>
      </div>
      <p class="fan-jogo">${seguro(j.jogo.casa)} <b>${j.jogo.golos_casa ?? '–'}–${j.jogo.golos_fora ?? '–'}</b> ${seguro(j.jogo.fora)} · ${seguro(j.jogo.competicao)}
        ${estadoJornada(j) === 'provisoria' ? '<span class="fan-chip-estado">Provisória — pode mudar se as estatísticas forem corrigidas</span>' : ''}</p>
      ${meu ? `<div class="fan-total">
        <div><span>Onze</span><b>${meu.pontos_onze}</b></div>
        <div><span>Capitão</span><b>+${meu.bonus_capitao}</b></div>
        <div><span>Transferências</span><b>${meu.penalizacao ? '−' + meu.penalizacao : '0'}</b></div>
        <div class="fan-total__soma"><span>Total</span><b>${meu.total}</b></div>
        <div><span>Banco (não conta)</span><b>${meu.pontos_banco}</b></div></div>`
        : `<p class="fan-nota">${eu ? 'Não tinhas equipa nesta jornada.' : 'Entra na tua conta para veres a tua pontuação.'}</p>`}
      ${eq ? `<ul class="fan-pontos">${eq.escolhas.sort((a, b) => (b.titular - a.titular) || ((a.ordem_banco || 0) - (b.ordem_banco || 0)) || POS.indexOf(jog(a.jogador_id)?.posicao) - POS.indexOf(jog(b.jogador_id)?.posicao)).map(linha).join('')}</ul>` : ''}
      <details class="fan-hist"><summary>Pontos de todos os jogadores nesta jornada</summary>
        <ul class="fan-pontos">${[...pts.values()].sort((a, b) => b.pontos - a.pontos).map(p => {
          const jj = jog(p.jogador_id); if(!jj) return '';
          return `<li class="fan-pj">${cara(jj, 'p')}<span class="fan-pj__corpo"><b>${seguro(jj.nome_curto)}</b><span>${detalheCurto(p)}</span></span><b class="fan-pj__pts">${p.pontos}</b></li>`;
        }).join('')}</ul></details>`;
  }

  const detalheCurto = p => (p.detalhe || []).map(d => d.regra === 'sem_dados'
      ? `sem dados: ${(d.campos || []).join(', ')}`
      : `${ROTULO_REGRA[d.regra] || d.regra}${d.valor != null && d.regra !== 'baliza_inviolada' ? ' ' + d.valor + (d.regra === 'jogou' ? '′' : '') : ''} ${d.pontos > 0 ? '+' : ''}${d.pontos}`)
    .join(' · ');

  /* ---------- CLASSIFICAÇÃO */
  async function pintarClassificacao(){
    const alvo = raiz && $('#fan-class', raiz);
    if(!alvo) return;
    const calculadas = jornadas.filter(j => j.calculada_em);
    let linhas = [], erroC = null;
    if(jornadaClass === 'geral'){
      const r = await db.from('fantasy_classificacao').select('*').order('posicao').limit(100);
      erroC = r.error; linhas = r.data || [];
    }else{
      const r = await db.from('fantasy_classificacao_jornada').select('*').eq('jornada_id', jornadaClass).order('posicao').limit(100);
      erroC = r.error; linhas = (r.data || []).map(x => ({ ...x, jornadas: 1 }));
    }
    if(!$('#fan-class', raiz)) return;
    alvo.innerHTML = `
      <div class="fan-filtros__linha">
        <label class="chip chip--fonte"><span>${jornadaClass === 'geral' ? 'Classificação geral' : 'Jornada ' + jor(Number(jornadaClass))?.numero}</span>
          <select id="fan-jornada-class" aria-label="Classificação"><option value="geral">Geral</option>
            ${calculadas.map(x => `<option value="${x.id}" ${String(x.id) === String(jornadaClass) ? 'selected' : ''}>Jornada ${x.numero}</option>`).join('')}</select></label>
      </div>
      ${erroC ? `<div class="estado estado--erro" role="alert"><p class="estado__titulo">Não foi possível ler do servidor</p>
        <button type="button" class="botao-largo botao-largo--fantasma" data-fan="recarregar">Tentar outra vez</button></div>` : !linhas.length
        ? `<div class="fan-vazio"><p class="estado__titulo">Ainda ninguém pontuou</p><p class="estado__texto">A classificação começa quando a primeira jornada tiver pontos. As equipas guardadas entram automaticamente.</p></div>`
        : `<ol class="fan-class">${linhas.map(l => `<li class="${eu && l.perfil_id === eu.id ? 'eu' : ''}">
            <span class="fan-class__pos">${l.posicao}</span>
            <span class="fan-class__nome"><b>${seguro(l.nome_equipa)}</b><span>@${seguro(l.utilizador)}</span></span>
            <b class="fan-class__pts">${l.total}</b></li>`).join('')}</ol>`}`;
  }

  /* ---------- LIGAS */
  function ligas(){
    if(!eu) return `<div class="fan-vazio"><p class="estado__titulo">Ligas privadas</p><p class="estado__texto">Entra na tua conta para criares uma liga ou entrares na de um amigo.</p></div>`;
    if(!minhas.perfil) return `<div class="fan-vazio"><p class="estado__titulo">Primeiro a equipa</p><p class="estado__texto">Guarda a tua equipa Fantasy e depois cria uma liga ou entra numa com um código.</p></div>`;
    return `
      <div class="fan-ligas">
        <form class="fan-form" data-fan-form="criar"><label><span>Criar uma liga</span>
          <input name="nome" type="text" minlength="3" maxlength="40" required placeholder="Nome da liga"></label>
          <button type="submit" class="botao-cta">Criar</button></form>
        <form class="fan-form" data-fan-form="entrar"><label><span>Entrar com um código</span>
          <input name="codigo" type="text" minlength="6" maxlength="6" required placeholder="ABC234" autocapitalize="characters" spellcheck="false"></label>
          <button type="submit" class="botao-cta">Entrar</button></form>
      </div>
      ${minhas.ligas.length ? `<ul class="fan-lista-ligas">${minhas.ligas.map(l => `<li>
          <button type="button" class="fan-liga ${ligaVista === l.id ? 'is-on' : ''}" data-fan-liga="${l.id}"><b>${seguro(l.nome)}</b><span>código ${seguro(l.codigo)}</span></button>
          <button type="button" class="chip" data-fan-partilhar="${seguro(l.codigo)}" data-nome="${seguro(l.nome)}">Convidar</button>
          <button type="button" class="chip chip--perigo" data-fan-sair="${l.id}">Sair</button></li>`).join('')}</ul>
        <div id="fan-liga-tabela"></div>`
        : '<p class="fan-nota">Ainda não estás em nenhuma liga.</p>'}`;
  }

  async function pintarLiga(){
    const alvo = raiz && $('#fan-liga-tabela', raiz);
    if(!alvo || !ligaVista) return;
    alvo.innerHTML = Componentes.esqueletoCompacto(3);
    const m = await db.from('fantasy_liga_membros').select('perfil_id').eq('liga_id', ligaVista);
    const ids = (m.data || []).map(x => x.perfil_id);
    const c = ids.length ? await db.from('fantasy_classificacao').select('*').in('perfil_id', ids).order('total', { ascending: false }) : { data: [] };
    if(m.error || c.error){ alvo.innerHTML = `<div class="estado estado--erro" role="alert"><p class="estado__titulo">Não foi possível ler do servidor</p>
        <button type="button" class="botao-largo botao-largo--fantasma" data-fan="recarregar">Tentar outra vez</button></div>`; return; }
    alvo.innerHTML = `<ol class="fan-class">${(c.data || []).map((l, i) => `<li class="${l.perfil_id === eu.id ? 'eu' : ''}">
      <span class="fan-class__pos">${i + 1}</span><span class="fan-class__nome"><b>${seguro(l.nome_equipa)}</b><span>@${seguro(l.utilizador)}</span></span>
      <b class="fan-class__pts">${l.total}</b></li>`).join('')}</ol>`;
  }

  /* ---------- REGRAS — lidas da configuração do servidor */
  function regras(){
    const p = cfg.pontuacao, g = cfg.jogo, pr = cfg.precos;
    const linha = (acao, v) => `<tr><td>${acao}</td><td>${v}</td></tr>`;
    const porPos = o => POS.map(k => `${k} ${o[k] > 0 ? '+' : ''}${o[k]}`).join(' · ');
    return `<div class="fan-regras">
      <h4>Pontuação</h4>
      <table class="tabela fan-tabela"><thead><tr><th>Ação</th><th>Pontos</th></tr></thead><tbody>
        ${linha('Jogar pelo menos 1 minuto', '+' + p.jogou_1_min)}
        ${linha('Jogar 60 minutos ou mais', '+' + p.jogou_60_min + ' (adicional)')}
        ${linha('Golo', porPos(p.golo))}
        ${linha('Assistência', '+' + p.assistencia)}
        ${linha(`Baliza inviolada (com ${p.baliza_inviolada_minutos}′ ou mais)`, porPos(p.baliza_inviolada))}
        ${linha('Cada ' + p.defesas_por_ponto + ' defesas do guarda-redes', '+1')}
        ${linha('Cada ' + p.recuperacoes_por_ponto + ' recuperações de bola', '+1 (só quando a fonte dá este número)')}
        ${linha('Penálti defendido', '+' + p.penalti_defendido)}
        ${linha('Cartão amarelo', p.amarelo)}
        ${linha('Cartão vermelho', p.vermelho)}
        ${linha('Penálti falhado', p.penalti_falhado)}
        ${linha('Autogolo', p.autogolo)}
        ${linha(`Golos sofridos (${p.golos_sofridos.posicoes.join(' e ')})`, `${p.golos_sofridos.pontos} por cada ${p.golos_sofridos.por_cada}`)}
        ${linha('Capitão', '×' + g.multiplicador_capitao)}
      </tbody></table>
      <h4>Como se conta</h4>
      <ul>
        <li><b>Assistência</b>: o passe ou toque de um colega que dá diretamente o golo, como a fonte de dados o regista. Num autogolo do adversário não há assistência.</li>
        <li><b>Autogolo</b>: ${p.autogolo} para quem o marca; conta como golo sofrido pela equipa.</li>
        <li><b>Golos sofridos</b>: os sofridos com o jogador em campo, quando a fonte os dá. Se só houver o total do jogo, conta para quem jogou ${p.baliza_inviolada_minutos} minutos ou mais.</li>
        <li><b>Cartões</b>: com vermelho (direto ou por acumulação) os amarelos não descontam.</li>
        <li><b>Quem não joga</b> não pontua. Sai automaticamente para o primeiro suplente (pela ordem do banco) que jogou e mantenha a formação válida; guarda-redes só por guarda-redes. Cada substituição aplica-se uma vez — recalcular dá sempre o mesmo resultado.</li>
        <li><b>Capitão</b>: pontos a dobrar. Se não jogar, o vice-capitão fica com o bónus; se nenhum jogar, não há bónus.</li>
        <li><b>Estatística em falta</b> não vale zero: não dá pontos e fica assinalada como "sem dados" no detalhe.</li>
        <li><b>Provisória → final</b>: os pontos aparecem como provisórios assim que as estatísticas são introduzidas e podem ser corrigidos. Ao fim de ${g.horas_ate_final} horas (ou quando o administrador a fecha) a jornada passa a final e não muda mais.</li>
      </ul>
      <h4>Equipa, orçamento e transferências</h4>
      <ul>
        <li>15 jogadores: ${POS.map(k => `${g.plantel[k]} ${NOME_POS[k].toLowerCase()}`).join(', ')}. Orçamento inicial: ${fmt(g.orcamento)} M€ Fantasy.</li>
        <li>Onze em formação válida: 1 guarda-redes, ${g.onze_min.DEF}–${g.onze_max.DEF} defesas, ${g.onze_min.MED}–${g.onze_max.MED} médios, ${g.onze_min.AVA}–${g.onze_max.AVA} avançados. Capitão e vice têm de ser titulares.</li>
        <li>Cada jogo oficial do Sporting é uma jornada. A equipa fecha ${g.fecho_minutos_antes ? g.fecho_minutos_antes + ' minutos antes do' : 'à hora do'} início do jogo; quem não mexer mantém a equipa anterior.</li>
        <li>A primeira equipa é livre. Depois, ${g.transferencias_gratis} transferências grátis por jornada; cada uma a mais custa ${g.custo_transferencia_extra} pontos. Trocar um jogador que saiu do plantel é grátis.</li>
        <li>Quem fica mantém o preço por que foi comprado; quem sai é vendido ao preço atual. Mudanças de preço nunca alteram jornadas já fechadas.</li>
      </ul>
      <h4>Preços</h4>
      <ul>
        <li>Preços do jogo, <b>não são valores de mercado</b>. Inicial = base da posição (${POS.map(k => `${k} ${fmt(pr.base[k])}`).join(', ')}) + ${pr.por_jogo} por jogo na época (até ${fmt(pr.max_por_jogos)}) + golos na época (até ${fmt(pr.max_por_golos)}), arredondado a ${pr.arredondar}.</li>
        <li>Depois de cada jornada final: média de ${pr.variacao.subir_media} pontos ou mais nas últimas ${pr.variacao.jornadas} jornadas sobe ${pr.variacao.passo}; quem jogou e teve média até ${pr.variacao.descer_media} desce ${pr.variacao.passo}. O histórico fica guardado.</li>
      </ul>
      <h4>De onde vêm os dados</h4>
      <ul>
        <li>Plantel: zerozero e Wikipédia (época atual). Fotografias: API-Football. Calendário, presenças e golos da época: Wikipédia.</li>
        <li>Estatísticas de cada jogo: introduzidas a partir do relatório oficial do jogo enquanto não houver uma fonte automática com a época atual. Nada é estimado.</li>
        <li>Os pontos são calculados no servidor; o browser nunca os envia.</li>
      </ul>
    </div>`;
  }

  /* ---------- GESTÃO (administradores) — estatísticas de um jogo */
  const CAMPOS = [['minutos', 'Min'], ['golos', 'G'], ['assistencias', 'A'], ['amarelos', 'AM'], ['vermelhos', 'VM'],
                  ['pen_falhados', 'PF'], ['autogolos', 'AG'], ['pen_defendidos', 'PD'], ['defesas', 'Def'],
                  ['golos_sofridos', 'GS'], ['recuperacoes', 'Rec']];
  function gestao(){
    const candidatas = jornadas.filter(j => !j.finalizada_em && new Date(j.fecho) <= Date.now());
    if(!candidatas.length) return `<div class="fan-vazio"><p class="estado__titulo">Nada para gerir agora</p><p class="estado__texto">As estatísticas introduzem-se depois do fecho da jornada (início do jogo).</p></div>`;
    if(!adminJornada || !candidatas.some(j => j.id === adminJornada)) adminJornada = candidatas[0].id;
    const j = jor(adminJornada);
    return `<form class="fan-gestao" data-fan-form="estatisticas">
      <div class="fan-filtros__linha">
        <label class="chip chip--fonte"><span>J${j.numero} · ${seguro(j.jogo.casa)} x ${seguro(j.jogo.fora)}</span>
          <select id="fan-admin-jornada" aria-label="Jornada">${candidatas.map(x => `<option value="${x.id}" ${x.id === j.id ? 'selected' : ''}>J${x.numero} · ${seguro(x.jogo.casa)} x ${seguro(x.jogo.fora)}</option>`).join('')}</select></label>
      </div>
      <p class="fan-nota">Introduz os números do relatório oficial do jogo. Só quem jogou leva minutos; campos vazios ficam "sem dados" (não contam como zero). GS = golos sofridos com o jogador em campo (opcional). Rec = recuperações (só se a fonte as der).</p>
      <div class="fan-res"><label>${seguro(j.jogo.casa)} <input name="golos_casa" type="number" min="0" max="20" inputmode="numeric" value="${j.jogo.golos_casa ?? ''}" required></label>
        <label>${seguro(j.jogo.fora)} <input name="golos_fora" type="number" min="0" max="20" inputmode="numeric" value="${j.jogo.golos_fora ?? ''}" required></label></div>
      <div class="fan-gestao__tabela"><table class="tabela fan-tabela"><thead><tr><th>Jogador</th>${CAMPOS.map(([, r]) => `<th>${r}</th>`).join('')}</tr></thead><tbody>
        ${[...jogadores.values()].filter(x => x.no_plantel).sort((a, b) => POS.indexOf(a.posicao) - POS.indexOf(b.posicao) || (a.numero || 99) - (b.numero || 99)).map(x => `
          <tr data-jogador="${x.id}"><th scope="row">${seguro(x.nome_curto)} <small>${x.posicao}</small></th>
          ${CAMPOS.map(([k]) => `<td><input type="number" min="0" max="${k === 'minutos' ? 130 : 30}" inputmode="numeric" name="${k}" aria-label="${seguro(x.nome_curto)} ${k}"
            ${['pen_defendidos', 'defesas'].includes(k) && x.posicao !== 'GR' ? 'disabled' : ''}></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="fan-gestao__acoes">
        <button type="submit" class="botao-cta">Guardar e calcular (provisória)</button>
        ${j.calculada_em ? `<button type="button" class="chip chip--perigo" data-fan="finalizar">Finalizar jornada ${j.numero}</button>` : ''}
      </div>
    </form>`;
  }

  /* o que já foi introduzido aparece nos campos, para se poder corrigir */
  async function preencherGestao(){
    const form = raiz && $('[data-fan-form="estatisticas"]', raiz);
    const j = adminJornada && jor(adminJornada);
    if(!form || !j) return;
    const { data } = await db.from('desporto_estatisticas_jogo').select('*').eq('jogo_id', j.jogo_id);
    (data || []).forEach(e => {
      const tr = $(`tr[data-jogador="${e.jogador_id}"]`, form);
      if(tr) CAMPOS.forEach(([k]) => { const i = tr.querySelector(`[name="${k}"]`); if(i && !i.disabled && e[k] != null) i.value = e[k]; });
    });
  }

  async function enviarEstatisticas(form){
    const j = jor(adminJornada);
    const linhas = $$('tr[data-jogador]', form).map(tr => {
      const v = Object.fromEntries(CAMPOS.map(([k]) => [k, tr.querySelector(`[name="${k}"]`).value]));
      if(v.minutos === '' || Number(v.minutos) === 0) return null;
      const o = { jogador_id: Number(tr.dataset.jogador), titular: null };
      CAMPOS.forEach(([k]) => { o[k] = v[k] === '' ? null : Number(v[k]); });
      return o;
    }).filter(Boolean);
    if(!linhas.length){ avisar('erro', 'Indica pelo menos os minutos de quem jogou.'); return; }
    const fd = new FormData(form);
    const { data, error } = await db.rpc('fantasy_importar_jogo', { p: {
      fonte: 'manual', substituir: true,
      jogo: { id: j.jogo_id, golos_casa: Number(fd.get('golos_casa')), golos_fora: Number(fd.get('golos_fora')), estado: 'terminado' },
      jogadores: linhas } });
    if(error){ avisar('erro', error.message); return; }
    avisar('ok', `Jornada ${j.numero} calculada (provisória): ${data?.calculo?.jogadores ?? 0} jogadores, ${data?.calculo?.equipas ?? 0} equipas.`);
    await carregar();
  }

  /* ---------- barra de gravar */
  function barraGuardar(){
    if(!rascunho || !aberta || !alterado() || !plantel().length) return '';
    const p = problemas();
    return `<div class="fan-guardar" role="region" aria-label="Guardar equipa">
      <p>${p.length ? `<b>${p.length} ${p.length > 1 ? 'coisas' : 'coisa'} por resolver:</b> ${seguro(p[0])}${p.length > 1 ? '…' : ''}`
          : `Tudo certo.${contas().penalizacao ? ` <b>−${contas().penalizacao} pontos</b> pelas transferências extra.` : ''}`}</p>
      ${minhas.equipas.length ? '<button type="button" class="chip" data-fan="repor">Desfazer</button>' : ''}
      <button type="button" class="botao-cta" data-fan="guardar" ${p.length || aGuardar ? 'disabled' : ''}>${aGuardar ? 'A guardar…' : eu ? 'Guardar equipa' : 'Entrar para guardar'}</button>
    </div>`;
  }

  /* ---------- relógio do fecho */
  function ligarRelogio(){
    clearInterval(relogio);
    const el = raiz && $('#fan-relogio', raiz);
    if(!el || !aberta) return;
    const tic = () => {
      const s = Math.floor((new Date(aberta.fecho) - Date.now()) / 1000);
      if(s <= 0){ clearInterval(relogio); el.textContent = 'fechou'; carregar(); return; }
      const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
      el.textContent = (d ? `${d} d ` : '') + `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    };
    tic();
    relogio = setInterval(tic, 1000);
  }

  /* =====================================================================
     EVENTOS — um só ouvinte para tudo
     ===================================================================== */
  function ligar(){
    raiz.addEventListener('click', async ev => {
      const b = ev.target.closest('button, [data-fan-slot]');
      if(!b || !raiz.contains(b)) return;
      const d = b.dataset;
      if(d.fanSep){ separador = d.fanSep; tocado = aTrocar = null; pintar(); return; }
      if(d.fanFaltam){ separador = 'mercado'; filtroPos = d.fanFaltam; pintar(); return; }
      if(d.fanPos){ filtroPos = d.fanPos; pintar(); return; }
      if(d.fanEntra){ adicionar(Number(d.fanEntra)); pintar(); return; }
      if(d.fanSai){ remover(Number(d.fanSai)); pintar(); return; }
      if(d.fanSlot){
        const id = Number(d.fanSlot);
        if(aTrocar){
          if(aTrocar === id){ aTrocar = null; pintar(); return; }
          const mau = trocar(aTrocar, id);
          if(mau) avisar('erro', mau); else { aTrocar = null; tocado = null; }
          pintar(); return;
        }
        tocado = tocado === id ? null : id; pintar();
        $('.fan-painel', raiz)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      if(d.fanLiga){ ligaVista = Number(d.fanLiga); pintar(); return; }
      if(d.fanPartilhar){
        const texto = `Junta-te à minha liga "${d.nome}" no Fantasy do Sporting ao Minuto. Código: ${d.fanPartilhar}`;
        try{ if(navigator.share) await navigator.share({ title: 'Liga Fantasy', text: texto, url: location.origin + '/fantasy' });
             else { await navigator.clipboard.writeText(texto); avisar('ok', 'Convite copiado.'); } }catch(e){}
        return;
      }
      if(d.fanSair){
        const { error } = await db.rpc('fantasy_sair_liga', { p_liga: Number(d.fanSair) });
        if(error) avisar('erro', error.message); else { avisar('ok', 'Saíste da liga.'); ligaVista = null; await carregarMinhas(); pintar(); }
        return;
      }
      switch(d.fan){
        case 'recarregar': carregar(); break;
        case 'fechar-painel': tocado = null; pintar(); break;
        case 'capitao': capitao(tocado); pintar(); break;
        case 'vice': vice(tocado); pintar(); break;
        case 'trocar': aTrocar = tocado; tocado = null; pintar(); break;
        case 'cancelar-troca': aTrocar = null; pintar(); break;
        case 'subir': moverBanco(tocado, -1); pintar(); break;
        case 'descer': moverBanco(tocado, 1); pintar(); break;
        case 'vender': remover(tocado); pintar(); break;
        case 'repor': try{ localStorage.removeItem(CHAVE_RASCUNHO()); }catch(e){} montarRascunho(); tocado = aTrocar = null; pintar(); break;
        case 'guardar': guardar(); break;
        case 'finalizar': {
          const j = jor(adminJornada);
          const { data, error } = await db.rpc('fantasy_finalizar_jornada', { p_jornada: j.id });
          if(error) avisar('erro', error.message); else { avisar('ok', `Jornada ${j.numero} finalizada; ${data.precos_alterados} preços mudaram.`); await carregar(); }
          break;
        }
      }
    });

    raiz.addEventListener('input', ev => {
      if(ev.target.id === 'fan-busca'){
        busca = ev.target.value;
        clearTimeout(ligar._t);
        ligar._t = setTimeout(() => {
          const pos = ev.target.selectionStart;
          pintar();
          const i = $('#fan-busca', raiz); if(i){ i.focus(); i.setSelectionRange(pos, pos); }
        }, 180);
      }
    });
    raiz.addEventListener('change', ev => {
      const t = ev.target;
      if(t.id === 'fan-ordem'){ ordem = t.value; pintar(); }
      if(t.id === 'fan-jornada-pontos'){ jornadaPontos = Number(t.value); pintar(); }
      if(t.id === 'fan-jornada-class'){ jornadaClass = t.value === 'geral' ? 'geral' : Number(t.value); pintarClassificacao(); }
      if(t.id === 'fan-admin-jornada'){ adminJornada = Number(t.value); pintar(); }
    });
    raiz.addEventListener('submit', async ev => {
      const f = ev.target.closest('[data-fan-form]');
      if(!f) return;
      ev.preventDefault();
      const tipo = f.dataset.fanForm;
      if(tipo === 'estatisticas'){ await enviarEstatisticas(f); return; }
      const fd = new FormData(f);
      const { data, error } = tipo === 'criar'
        ? await db.rpc('fantasy_criar_liga', { p_nome: fd.get('nome') })
        : await db.rpc('fantasy_entrar_liga', { p_codigo: fd.get('codigo') });
      if(error){ avisar('erro', error.message); return; }
      avisar('ok', tipo === 'criar' ? `Liga criada. Código para convidar: ${data.codigo}` : `Entraste na liga "${data.nome}".`);
      await carregarMinhas(); ligaVista = data.id; pintar();
    });
  }

  /* =====================================================================
     API — o app.js chama abrir() quando se entra na vista /fantasy
     ===================================================================== */
  function abrir(){
    raiz = raiz || document.getElementById('fantasy');
    if(!raiz) return;
    if(!raiz.dataset.ligado){ raiz.dataset.ligado = '1'; ligar(); }
    /* a conta pode ter mudado desde a última vez */
    if(estado === 'por-carregar' || estado === 'erro' || Nuvem.perfil?.id !== eu?.id) carregar();
    else pintar();
  }

  return { abrir, recarregar: carregar };
})();
/* o app.js chega-lhe por window (um const global não fica em window) */
window.Fantasy = Fantasy;
