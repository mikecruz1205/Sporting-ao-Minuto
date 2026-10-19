/* =========================================================================
   FANTASY DO SPORTING — a interface
   -------------------------------------------------------------------------
   Tudo o que conta vive no servidor (supabase/migrations/*fantasy*):
   plantel, orçamento, transferências e pontos. Aqui só se lê e se pede ao
   servidor que valide e grave — a equipa guarda-se com
   fantasy_guardar_onze() e os pontos nunca saem do browser.

   A equipa escolhe-se por lugares: uma formação (as de FORMACOES, em
   js/data.js), um jogador para cada lugar do onze — só quem lá pode jogar
   — e 3 suplentes.

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
  let rascunho = null;                  // { formacao, onze: [11 × id|null], banco: [ids], capitao, vice }
  let escolha = null;                   // a escolher no mercado: { tipo:'posto', i } | { tipo:'banco', sai? }
  let antiga = false;                   // equipa guardada com as regras antigas (15, sem lugares)
  let gravado = '';                     // assinatura do que está no servidor (para saber se há alterações)
  let herdada = false;                  // a equipa em vigor veio da jornada anterior
  let separador = 'equipa';
  let tocado = null;                    // jogador escolhido no campo
  let aTrocar = null;                   // à espera do segundo jogador da troca
  let filtroPos = 'todos', ordem = 'preco', busca = '';
  let jornadaPontos = null, jornadaClass = 'geral', ligaVista = null;
  let admin = false, adminJornada = null;
  let comEstatisticas = new Set();     // jogos com estatísticas introduzidas (para as jornadas em atraso)
  let estado = 'por-carregar';          // por-carregar · a-carregar · pronto · erro
  let erro = '';
  let relogio = null;
  let aGuardar = false;
  let aviso = null;                     // { tipo: 'ok'|'erro', texto }
  const recentes = new Set();           // acabaram de entrar ou de trocar (animação curta no campo)

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
    await Nuvem.garantir();
    db = Nuvem.cliente;
    /* mudou de conta (ou saiu): nada da conta anterior pode ficar à vista */
    if((Nuvem.perfil?.id || null) !== (eu?.id || null)){
      minhas = { equipas: [], escolhas: [], resultados: [], transferencias: [], historico: [], perfil: null, ligas: [] };
      admin = false; ligaVista = null; tocado = aTrocar = null; aviso = null;
      if(separador === 'admin') separador = 'equipa';
    }
    eu = Nuvem.perfil;
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
    antiga = false;
    if(base){
      const es = base.escolhas;
      rascunho = deEscolhas(base.formacao,
        es.filter(e => e.titular).sort((a, b) => (a.posto ?? 99) - (b.posto ?? 99)),
        es.filter(e => !e.titular).sort((a, b) => a.ordem_banco - b.ordem_banco).map(e => e.jogador_id));
      rascunho.capitao = es.find(e => e.capitao)?.jogador_id ?? null;
      rascunho.vice = es.find(e => e.vice)?.jogador_id ?? null;
      /* a equipa antiga tem de ser arrumada por lugares: conta como alterada */
      gravado = antiga ? '' : assinatura(rascunho);
      /* a equipa em vigor é da jornada anterior: mantém-se sozinha, não é preciso gravar */
      herdada = !!aberta && !minhas.equipas.some(e => e.jornada_id === aberta.id);
    }else{
      rascunho = rascunhoVazio();
      gravado = assinatura(rascunho);
      herdada = false;
    }
    const guardado = lerRascunho();
    if(guardado) rascunho = guardado;
    else if(eu){
      /* a equipa montada antes de entrar não se perde: passa para a conta */
      const doVisitante = lerRascunho('scp-fantasy-rascunho-v2-anonimo');
      if(doVisitante){
        rascunho = doVisitante;
        try{ localStorage.removeItem('scp-fantasy-rascunho-v2-anonimo'); }catch(e){}
        avisar('ok', minhas.equipas.length
          ? 'Esta é a equipa que montaste antes de entrar. Guarda-a, ou toca em Desfazer para voltares à equipa que tinhas guardada.'
          : 'Recuperámos a equipa que montaste antes de entrar. Já a podes guardar.', 15000);
      }
    }
  }
  const assinatura = r => JSON.stringify([r.formacao, r.onze, r.banco, r.capitao, r.vice]);

  /* rascunho por gravar: fica neste browser até ser gravado (conveniência —
     a equipa a sério é a do servidor) */
  const CHAVE_RASCUNHO = () => 'scp-fantasy-rascunho-v2-' + (eu?.id || 'anonimo');
  function guardarRascunho(){
    try{
      if(aberta && alterado()) localStorage.setItem(CHAVE_RASCUNHO(), JSON.stringify({ jornada: aberta.id, r: rascunho }));
      else localStorage.removeItem(CHAVE_RASCUNHO());
    }catch(e){}
  }
  function lerRascunho(chave = CHAVE_RASCUNHO()){
    try{
      const g = JSON.parse(localStorage.getItem(chave) || 'null');
      const r = g?.r;
      if(!r || !aberta || g.jornada !== aberta.id || !formacoes()[r.formacao]
         || !Array.isArray(r.onze) || r.onze.length !== 11 || !Array.isArray(r.banco)) return null;
      const ids = [...r.onze.filter(x => x != null), ...r.banco];
      /* jogadores que já não existem ou repetidos: o rascunho não serve */
      if(!ids.every(id => jog(id)) || new Set(ids).size !== ids.length || r.banco.length > SUPLENTES() + 1) return null;
      const novo = { formacao: r.formacao, onze: r.onze.map(x => x ?? null), banco: r.banco, capitao: r.capitao ?? null, vice: r.vice ?? null };
      if(!novo.onze.includes(novo.capitao)) novo.capitao = null;
      if(!novo.onze.includes(novo.vice) || novo.vice === novo.capitao) novo.vice = null;
      return novo;
    }catch(e){ return null; }
  }
  const alterado = () => !!rascunho && assinatura(rascunho) !== gravado;

  /* =====================================================================
     LUGARES — a formação e quem pode jogar em cada lugar
     Os lugares e o seu sítio no campo vêm de FORMACOES (js/data.js); o
     servidor tem a mesma lista em fantasy_config.jogo (formacoes, papeis).
     ===================================================================== */
  const PAPEIS_PADRAO = { GR: ['GR'], LD: ['DEF'], LE: ['DEF'], DC: ['DEF'], ALA: ['DEF', 'MED'],
                          MDC: ['MED'], MC: ['MED'], MO: ['MED'], EXT: ['MED', 'AVA'], PL: ['AVA'] };
  const DESENHO = typeof FORMACOES !== 'undefined' ? FORMACOES : {};
  const FORMACAO_INICIAL = '4-3-3';
  const formacoes = () => cfg?.jogo?.formacoes
    || Object.fromEntries(Object.entries(DESENHO).map(([k, v]) => [k, v.map(l => l.papel)]));
  const papeis = () => cfg?.jogo?.papeis || PAPEIS_PADRAO;
  const SUPLENTES = () => cfg?.jogo?.suplentes || 3;
  const papelDe = (f, i) => formacoes()[f]?.[i];
  const podeJogar = (papel, pos) => !!papeis()[papel]?.includes(pos);
  const ladoDe = (f, i) => { const x = DESENHO[f]?.[i]?.x ?? 50; return x < 40 ? 'e' : x > 60 ? 'd' : ''; };

  /* o nome do lugar; o lado (esquerdo/direito) sai do desenho da formação */
  function nomeLugar(f, i){
    const lado = { e: ' esquerdo', d: ' direito', '': '' }[ladoDe(f, i)];
    return ({ GR: 'Guarda-redes', LD: 'Defesa direito', LE: 'Defesa esquerdo', DC: 'Defesa central',
              ALA: 'Ala' + lado, MDC: 'Médio defensivo', MC: 'Médio centro', MO: 'Médio ofensivo',
              EXT: 'Extremo' + lado, PL: 'Ponta de lança' })[papelDe(f, i)] || papelDe(f, i) || '';
  }
  function siglaLugar(f, i){
    const p = papelDe(f, i), l = ladoDe(f, i).toUpperCase();
    if(p === 'ALA') return l ? 'A' + l : 'ALA';
    if(p === 'EXT') return l ? 'E' + l : 'EXT';
    return p || '';
  }
  const rascunhoVazio = () => ({ formacao: formacoes()[FORMACAO_INICIAL] ? FORMACAO_INICIAL : Object.keys(formacoes())[0],
                                 onze: Array(11).fill(null), banco: [], capitao: null, vice: null });

  /* o lugar livre onde o jogador cabe; primeiro os que só aceitam uma posição
     (um médio vai para o meio-campo antes de ocupar uma ala) */
  function lugarLivre(onze, f, id){
    const pos = jog(id)?.posicao;
    let melhor = -1;
    onze.forEach((x, i) => {
      if(x != null || !podeJogar(papelDe(f, i), pos)) return;
      if(melhor < 0 || papeis()[papelDe(f, i)].length < papeis()[papelDe(f, melhor)].length) melhor = i;
    });
    return melhor;
  }
  function arrumar(f, ids){
    const onze = Array(11).fill(null), fora = [];
    ids.forEach(id => { const i = lugarLivre(onze, f, id); if(i >= 0) onze[i] = id; else fora.push(id); });
    return { onze, fora };
  }
  /* a equipa do servidor; a guardada com as regras antigas (15, sem lugares)
     vai para a formação onde cabem mais titulares, e o resto para o banco */
  function deEscolhas(formacao, tit, banco){
    if(formacoes()[formacao] && tit.length === 11 && tit.every(e => e.posto != null)){
      const onze = Array(11).fill(null);
      tit.forEach(e => { onze[e.posto] = e.jogador_id; });
      return { formacao, onze, banco, capitao: null, vice: null };
    }
    antiga = tit.length > 0;
    const ids = tit.map(e => e.jogador_id);
    let melhor = null;
    Object.keys(formacoes()).forEach(f => {
      const a = arrumar(f, ids);
      if(!melhor || a.fora.length < melhor.fora.length) melhor = { f, ...a };
    });
    return melhor
      ? { formacao: melhor.f, onze: melhor.onze, banco: [...melhor.fora, ...banco], capitao: null, vice: null }
      : rascunhoVazio();
  }

  /* =====================================================================
     CONTAS (cópia das regras do servidor, para resposta imediata)
     ===================================================================== */
  const titulares = () => rascunho ? rascunho.onze.filter(x => x != null) : [];
  const plantel = () => rascunho ? [...titulares(), ...rascunho.banco] : [];
  const contar = (ids) => {
    const c = { GR: 0, DEF: 0, MED: 0, AVA: 0 };
    ids.forEach(id => { const j = jog(id); if(j) c[j.posicao]++; });
    return c;
  };
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
  /* as contas como ficariam depois de uma mudança (sem a fazer) */
  function simular(fn){
    const copia = JSON.parse(JSON.stringify(rascunho));
    try{ fn(); return contas(); } finally { rascunho = copia; }
  }

  /* o que falta para a equipa poder ser guardada */
  function problemas(){
    if(!cfg || !rascunho) return [];
    const p = [], f = rascunho.formacao, S = SUPLENTES();
    const vazios = rascunho.onze.map((x, i) => x == null ? nomeLugar(f, i) : null).filter(Boolean);
    if(vazios.length){
      const conta = new Map();
      vazios.forEach(n => conta.set(n, (conta.get(n) || 0) + 1));
      p.push('Falta escolher: ' + [...conta].map(([n, k]) => k > 1 ? `${n.toLowerCase()} (${k})` : n.toLowerCase()).join(', '));
    }
    rascunho.onze.forEach((x, i) => {
      if(x != null && !podeJogar(papelDe(f, i), jog(x)?.posicao)) p.push(`${jog(x)?.nome_curto} não joga a ${nomeLugar(f, i).toLowerCase()}`);
    });
    const nb = rascunho.banco.length;
    if(nb < S) p.push(`Falta${S - nb > 1 ? 'm' : ''} ${S - nb} suplente${S - nb > 1 ? 's' : ''}`);
    if(nb > S) p.push(`O banco leva ${S} suplentes: vende ${nb - S} ou põe no onze`);
    if(!vazios.length){
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
  /* onde entra um jogador novo: no lugar pedido, no primeiro lugar livre
     onde pode jogar, ou no banco */
  function lugarPara(id, alvo = null){
    const f = rascunho.formacao, pos = jog(id)?.posicao;
    if(alvo?.tipo === 'posto') return podeJogar(papelDe(f, alvo.i), pos) ? alvo : null;
    if(alvo?.tipo === 'banco') return (alvo.sai != null && rascunho.banco.includes(alvo.sai)) || rascunho.banco.length < SUPLENTES() ? alvo : null;
    const i = lugarLivre(rascunho.onze, f, id);
    if(i >= 0) return { tipo: 'posto', i };
    return rascunho.banco.length < SUPLENTES() ? { tipo: 'banco' } : null;
  }

  function podeEntrar(id, alvo = null){
    const j = jog(id);
    if(!j) return 'Jogador desconhecido';
    if(plantel().includes(id)) return 'Já está na tua equipa';
    if(!j.elegivel) return j.motivoInelegivel || 'Não elegível';
    if(j.preco == null) return 'Ainda sem preço Fantasy';
    const l = lugarPara(id, alvo);
    if(!l) return alvo?.tipo === 'posto' ? `Não joga a ${nomeLugar(rascunho.formacao, alvo.i).toLowerCase()}`
                : alvo?.tipo === 'banco' ? `O banco já tem ${SUPLENTES()}`
                : `Sem lugar livre para um ${NOME_POS_1[j.posicao]} nesta formação nem no banco`;
    const k = simular(() => colocarNovo(id, l));
    if(k.saldo < -0.001) return `Faltam ${fmt(-k.saldo)} M€`;
    return null;
  }

  /* tirar da equipa, sem mexer no resto do estado */
  function tirar(id){
    rascunho.onze = rascunho.onze.map(x => x === id ? null : x);
    rascunho.banco = rascunho.banco.filter(x => x !== id);
    if(rascunho.capitao === id) rascunho.capitao = null;
    if(rascunho.vice === id) rascunho.vice = null;
  }
  /* põe um jogador novo no lugar; quem lá estava sai da equipa (é vendido) */
  function colocarNovo(id, l){
    if(l.tipo === 'posto'){
      const sai = rascunho.onze[l.i];
      if(sai != null) tirar(sai);
      rascunho.onze[l.i] = id;
    }else if(l.sai != null && rascunho.banco.includes(l.sai)){
      rascunho.banco = rascunho.banco.map(x => x === l.sai ? id : x);
    }else{
      rascunho.banco.push(id);
    }
  }

  function adicionar(id, alvo = null){
    if(podeEntrar(id, alvo)) return false;
    const sai = alvo?.tipo === 'posto' ? rascunho.onze[alvo.i] : alvo?.sai;
    colocarNovo(id, lugarPara(id, alvo));
    if(sai != null){ if(tocado === sai) tocado = null; if(aTrocar === sai) aTrocar = null; }
    recentes.add(id);
    return true;
  }

  function remover(id){
    tirar(id);
    if(tocado === id) tocado = null;
    if(aTrocar === id) aTrocar = null;
  }

  /* outra formação: cada um vai para um lugar onde pode jogar; um lugar que
     fique vazio recebe do banco quem lá possa jogar; quem não cabe vai para
     o banco (se o banco passar de 3, diz-se o que falta resolver) */
  function mudarFormacao(f){
    if(!formacoes()[f] || !rascunho || f === rascunho.formacao) return;
    const { onze, fora } = arrumar(f, titulares());
    let banco = rascunho.banco.slice();
    onze.forEach((x, i) => {
      if(x != null) return;
      const sobe = banco.find(b => podeJogar(papelDe(f, i), jog(b)?.posicao));
      if(sobe != null){ onze[i] = sobe; banco = banco.filter(b => b !== sobe); }
    });
    rascunho.formacao = f;
    rascunho.onze = onze;
    rascunho.banco = [...banco, ...fora];
    const perdeu = fora.filter(id => id === rascunho.capitao || id === rascunho.vice);
    fora.forEach(id => { if(rascunho.capitao === id) rascunho.capitao = null; if(rascunho.vice === id) rascunho.vice = null; });
    if(fora.length){
      const nomes = fora.map(id => jog(id)?.nome_curto).join(', ');
      avisar('ok', `${nomes} ${fora.length > 1 ? 'passaram' : 'passou'} para o banco: não ${fora.length > 1 ? 'cabiam' : 'cabia'} na ${f}.`
        + (perdeu.length ? ' Escolhe outra vez o capitão e o vice.' : ''));
    }
  }

  /* troca de lugar: titular com suplente, ou dois titulares, se cada um
     puder jogar no lugar do outro; dois suplentes trocam de ordem */
  function trocar(a, b){
    if(a === b) return null;
    const f = rascunho.formacao, pos = id => jog(id)?.posicao, nome = id => jog(id)?.nome_curto || 'O jogador';
    const ia = rascunho.onze.indexOf(a), ib = rascunho.onze.indexOf(b);
    if(ia < 0 && ib < 0){
      const x = rascunho.banco.indexOf(a), y = rascunho.banco.indexOf(b);
      if(x < 0 || y < 0) return 'Escolhe dois jogadores da equipa';
      rascunho.banco[x] = b; rascunho.banco[y] = a;
      return null;
    }
    if(ia >= 0 && ib >= 0){
      if(!podeJogar(papelDe(f, ia), pos(b))) return `${nome(b)} não joga a ${nomeLugar(f, ia).toLowerCase()}`;
      if(!podeJogar(papelDe(f, ib), pos(a))) return `${nome(a)} não joga a ${nomeLugar(f, ib).toLowerCase()}`;
      rascunho.onze[ia] = b; rascunho.onze[ib] = a;
    }else{
      const [tit, sup, i] = ia >= 0 ? [a, b, ia] : [b, a, ib];
      if(!rascunho.banco.includes(sup)) return 'Escolhe dois jogadores da equipa';
      if(!podeJogar(papelDe(f, i), pos(sup))) return `${nome(sup)} não joga a ${nomeLugar(f, i).toLowerCase()}`;
      rascunho.onze[i] = sup;
      rascunho.banco = rascunho.banco.map(x => x === sup ? tit : x);
      tirarBracadeira(tit);
    }
    recentes.add(a); recentes.add(b);
    return null;
  }

  /* um jogador da equipa para um lugar vazio do onze */
  function colocar(id, i){
    const f = rascunho.formacao;
    if(rascunho.onze[i] != null) return trocar(id, rascunho.onze[i]);
    if(!podeJogar(papelDe(f, i), jog(id)?.posicao)) return `${jog(id)?.nome_curto || 'O jogador'} não joga a ${nomeLugar(f, i).toLowerCase()}`;
    const de = rascunho.onze.indexOf(id);
    if(de >= 0) rascunho.onze[de] = null;
    else rascunho.banco = rascunho.banco.filter(x => x !== id);
    rascunho.onze[i] = id;
    recentes.add(id);
    return null;
  }

  /* um titular para um lugar vazio do banco */
  function paraBanco(id){
    const de = rascunho.onze.indexOf(id);
    if(de < 0) return null;
    if(rascunho.banco.length >= SUPLENTES()) return `O banco já tem ${SUPLENTES()}: troca com um suplente`;
    rascunho.onze[de] = null;
    rascunho.banco.push(id);
    tirarBracadeira(id);
    return null;
  }

  /* capitão e vice têm de ser titulares: quem vai para o banco perde a
     braçadeira, e diz-se em vez de desaparecer sem aviso */
  function tirarBracadeira(id){
    const era = rascunho.capitao === id ? 'capitão' : rascunho.vice === id ? 'vice-capitão' : null;
    if(!era) return;
    if(rascunho.capitao === id) rascunho.capitao = null;
    if(rascunho.vice === id) rascunho.vice = null;
    avisar('ok', `${jog(id)?.nome_curto || 'O jogador'} foi para o banco e deixou de ser ${era}. Escolhe outro.`);
  }

  function moverBanco(id, delta){
    const i = rascunho.banco.indexOf(id), k = i + delta;
    if(i < 0 || k < 0 || k >= rascunho.banco.length) return;
    [rascunho.banco[i], rascunho.banco[k]] = [rascunho.banco[k], rascunho.banco[i]];
  }

  function capitao(id){
    if(!rascunho.onze.includes(id)) return;
    if(rascunho.vice === id) rascunho.vice = rascunho.capitao;
    rascunho.capitao = id;
  }
  function vice(id){
    if(!rascunho.onze.includes(id)) return;
    if(rascunho.capitao === id) rascunho.capitao = rascunho.vice;
    rascunho.vice = id;
  }

  /* =====================================================================
     GRAVAR — o servidor valida tudo outra vez
     ===================================================================== */
  async function guardar(){
    if(!eu){ window.Entrada?.exigirConta('Entra ou cria uma conta para guardares a tua equipa Fantasy.', 'formacao'); return; }
    if(problemas().length || aGuardar) return;
    const nome = $('#fan-nome-equipa')?.value?.trim() || null;
    aGuardar = true; pintar();
    let data = null, error = null;
    try{
      ({ data, error } = await db.rpc('fantasy_guardar_onze', {
        p_formacao: rascunho.formacao, p_onze: rascunho.onze, p_banco: rascunho.banco,
        p_capitao: rascunho.capitao, p_vice: rascunho.vice, p_nome_equipa: nome
      }));
    }catch(e){ error = e; }
    aGuardar = false;
    if(error){ avisar('erro', 'Não foi possível guardar: ' + mensagemErro(error)); pintar(); return; }
    if(!data?.ok){ avisar('erro', (data?.erros || ['Não foi possível guardar.']).join(' · ')); pintar(); return; }
    avisar('ok', data.penalizacao
      ? `Equipa guardada. ${data.transferencias} transferências: −${data.penalizacao} pontos nesta jornada.`
      : 'Equipa guardada.');
    try{ localStorage.removeItem(CHAVE_RASCUNHO()); }catch(e){}
    await carregarMinhas();
    montarRascunho();
    pintar();
  }

  /* as mensagens do servidor do Fantasy já vêm em português; as técnicas não se mostram */
  function mensagemErro(e){
    const m = String(e?.message || e || '');
    if(/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return 'sem ligação ao servidor. Verifica a internet e tenta outra vez.';
    if(/jwt|session|not authenticated|refresh token/i.test(m)) return 'a sessão expirou. Entra outra vez.';
    if(!m || /permission denied|violates|column|relation|function|syntax|timeout|schema|postgrest/i.test(m)) return 'o servidor não respondeu como esperado. Tenta outra vez daqui a pouco.';
    return m;
  }

  function avisar(tipo, texto, ms = 6000){
    aviso = { tipo, texto };
    clearTimeout(avisar._t);
    avisar._t = setTimeout(() => { aviso = null; pintarAviso(); }, ms);
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
    if(separador === 'equipa') recentes.clear();
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
    const S = SUPLENTES(), n = titulares().length, nb = rascunho ? rascunho.banco.length : 0;
    const lugares = `<span class="${n === 11 ? 'cheio' : ''}">Onze ${n}/11</span><span class="${nb === S ? 'cheio' : ''}">Suplentes ${nb}/${S}</span>`
      + (rascunho ? `<span>${rascunho.formacao}</span>` : '');
    return `<div class="fan-resumo" aria-label="Resumo da equipa">
      <div><span>Orçamento</span><b>${fmt(k.orcamento)}<i>M€</i></b></div>
      <div><span>Gasto</span><b>${fmt(k.gasto)}<i>M€</i></b></div>
      <div class="${k.saldo < -0.001 ? 'mau' : ''}"><span>Saldo</span><b>${fmt(k.saldo)}<i>M€</i></b></div>
      <div><span>Jogadores</span><b>${plantel().length}<i>/${11 + SUPLENTES()}</i></b></div>
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

  /* ---------- EQUIPA: a formação, o campo por lugares, a braçadeira e o banco */
  function equipa(){
    if(!rascunho) return '';
    const f = rascunho.formacao, S = SUPLENTES();
    const desenho = DESENHO[f] || [];
    const sitio = i => desenho[i] || { x: 50, y: 8 + i * 8 };
    const tit = rascunho.onze.map((id, i) => id != null ? { id, i } : null).filter(Boolean);
    const opcoes = atual => '<option value="">Escolher…</option>' + tit.map(({ id, i }) =>
      `<option value="${id}" ${atual === id ? 'selected' : ''}>${seguro(jog(id)?.nome_curto)} · ${siglaLugar(f, i)}</option>`).join('');
    const nBanco = Math.max(S, rascunho.banco.length);
    return `
      ${antiga ? `<p class="fan-nota fan-nota--info">A tua equipa foi guardada com as regras antigas (15 jogadores). Agora cada lugar do onze leva um jogador e há ${S} suplentes: confirma os lugares, o banco e a braçadeira, e guarda.</p>`
        : herdada && !alterado() ? '<p class="fan-nota fan-nota--info">A tua equipa da jornada anterior mantém-se nesta jornada. Só precisas de guardar se mudares alguma coisa.</p>' : ''}
      ${!plantel().length ? `<p class="fan-nota">Escolhe a formação e toca em cada lugar do campo para escolher o jogador. Depois, ${S} suplentes. Orçamento: ${fmt(cfg.jogo.orcamento)} M€ Fantasy.</p>` : ''}
      <div class="fan-formacoes" role="group" aria-label="Formação">
        <span class="fan-rotulo">Formação</span>
        ${Object.keys(formacoes()).map(k => `<button type="button" class="chip ${k === f ? 'is-on' : ''}" aria-pressed="${k === f}" data-fan-formacao="${k}">${k}</button>`).join('')}
      </div>
      <div class="fan-bracadeiras">
        <label><span><i class="fan-braco" aria-hidden="true">C</i>Capitão <small>pontos a dobrar</small></span>
          <select id="fan-capitao" ${tit.length ? '' : 'disabled'}>${opcoes(rascunho.capitao)}</select></label>
        <label><span><i class="fan-braco fan-braco--v" aria-hidden="true">V</i>Vice-capitão <small>se o capitão não jogar</small></span>
          <select id="fan-vice" ${tit.length ? '' : 'disabled'}>${opcoes(rascunho.vice)}</select></label>
      </div>
      <div class="fan-campo fan-campo--lugares" aria-label="O teu onze em ${f}">
        <div class="fan-campo__formacao" aria-hidden="true">${f}</div>
        ${rascunho.onze.map((id, i) => `<div class="fan-lugar" style="left:${sitio(i).x}%;top:${sitio(i).y}%">${id != null ? slot(id, null, i) : lugarVazio(i)}</div>`).join('')}
      </div>
      ${painelJogador()}
      <div class="fan-banco" aria-label="Suplentes, por ordem de entrada">
        <p class="fan-rotulo">Suplentes <span>— entram por esta ordem no lugar de quem não jogar, se puderem jogar nesse lugar</span></p>
        <ol class="fan-banco__lista" style="--n:${nBanco}">${Array.from({ length: nBanco }, (_, k) =>
          `<li>${rascunho.banco[k] != null ? slot(rascunho.banco[k], k) : bancoVazio(k)}</li>`).join('')}</ol>
      </div>
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

  /* um jogador no campo (posto = o lugar) ou no banco (iBanco = a ordem) */
  function slot(id, iBanco, posto){
    const j = jog(id);
    if(!j) return '';
    const f = rascunho.formacao;
    const c = rascunho.capitao === id, v = rascunho.vice === id;
    const sel = tocado === id || aTrocar === id;
    const alvo = aTrocar != null && aTrocar !== id && podeTrocar(aTrocar, id);
    const lugar = posto != null ? nomeLugar(f, posto) : `suplente ${iBanco + 1}`;
    return `<button type="button" class="fan-slot ${sel ? 'is-sel' : ''} ${alvo ? 'is-alvo' : ''} ${!j.elegivel ? 'is-inelegivel' : ''} ${recentes.has(id) ? 'is-novo' : ''}" data-fan-slot="${id}"
              aria-label="${seguro(j.nome)}, ${lugar}${c ? ', capitão' : v ? ', vice-capitão' : ''}${j.pontos != null ? ', ' + j.pontos + ' pontos' : ''}">
      ${cara(j)}
      ${c ? '<i class="fan-braco" aria-hidden="true">C</i>' : v ? '<i class="fan-braco fan-braco--v" aria-hidden="true">V</i>' : ''}
      <span class="fan-slot__nome"><i class="fan-slot__pos fan-pos--${j.posicao}" aria-hidden="true">${posto != null ? siglaLugar(f, posto) : j.posicao}</i><span class="fan-slot__txt">${seguro(rotuloCampo(j))}</span></span>
      <span class="fan-slot__info">${fmt(precoAnterior(id) ?? j.preco)} M€${j.pontos != null ? ` · <b>${j.pontos}</b> pts` : ''}</span>
    </button>`;
  }

  /* com um jogador à espera de troca: pode ir para o lugar de b? */
  function podeTrocar(a, b){
    const f = rascunho.formacao, ia = rascunho.onze.indexOf(a), ib = rascunho.onze.indexOf(b);
    if(ia < 0 && ib < 0) return true;
    if(ib >= 0 && !podeJogar(papelDe(f, ib), jog(a)?.posicao)) return false;
    if(ia >= 0 && ib >= 0 && !podeJogar(papelDe(f, ia), jog(b)?.posicao)) return false;
    if(ia >= 0 && ib < 0 && !podeJogar(papelDe(f, ia), jog(b)?.posicao)) return false;
    return true;
  }

  function lugarVazio(i){
    const f = rascunho.formacao;
    const sel = escolha?.tipo === 'posto' && escolha.i === i;
    const alvo = aTrocar != null && podeJogar(papelDe(f, i), jog(aTrocar)?.posicao);
    return `<button type="button" class="fan-slot fan-slot--vazio ${sel ? 'is-sel' : ''} ${alvo ? 'is-alvo' : ''}" data-fan-posto="${i}" aria-label="Escolher o ${nomeLugar(f, i).toLowerCase()}">
      <span class="fan-cara fan-cara--vazia" aria-hidden="true">+</span>
      <span class="fan-slot__nome"><i class="fan-slot__pos" aria-hidden="true">${siglaLugar(f, i)}</i><span class="fan-slot__txt">${seguro(nomeLugar(f, i))}</span></span>
    </button>`;
  }
  function bancoVazio(k){
    const alvo = aTrocar != null && rascunho.onze.includes(aTrocar);
    return `<button type="button" class="fan-slot fan-slot--vazio ${escolha?.tipo === 'banco' && escolha.sai == null ? 'is-sel' : ''} ${alvo ? 'is-alvo' : ''}" data-fan-banco-vazio="${k}" aria-label="Escolher o suplente ${k + 1}">
      <span class="fan-cara fan-cara--vazia" aria-hidden="true">+</span>
      <span class="fan-slot__nome"><span class="fan-slot__txt">Suplente ${k + 1}</span></span>
    </button>`;
  }

  /* o que se pode fazer ao jogador tocado — logo por baixo do campo */
  function painelJogador(){
    const id = aTrocar ?? tocado;
    const j = id != null && jog(id);
    if(!j) return '';
    const f = rascunho.formacao, i = rascunho.onze.indexOf(id), iBanco = rascunho.banco.indexOf(id);
    if(aTrocar != null) return `<div class="fan-painel" role="region" aria-label="Mudar de lugar">
      <p><b>${seguro(j.nome_curto)}</b>: toca no lugar ou no jogador com quem queres trocar${i >= 0 ? ', ou num lugar vazio do banco' : ''}. Os lugares onde pode jogar estão a piscar.</p>
      <button type="button" class="chip" data-fan="cancelar-troca">Cancelar</button></div>`;
    const hp = historicoPrecos.get(id) || [];
    return `<div class="fan-painel" role="region" aria-label="${seguro(j.nome)}">
      <div class="fan-painel__topo">${cara(j, 'g')}
        <div><b>${seguro(j.nome)}</b>
          <span>${i >= 0 ? nomeLugar(f, i) : 'Suplente ' + (iBanco + 1)} · ${NOME_POS_1[j.posicao]}${j.numero ? ' · n.º ' + j.numero : ''}${j.nacionalidade ? ' · ' + seguro(j.nacionalidade) : ''}${j.idade ? ' · ' + j.idade + ' anos' : ''}</span>
          <span>${epocaTexto(j)}</span>
          <span>Preço ${fmt(j.preco)} M€${precoAnterior(id) != null && Number(precoAnterior(id)) !== j.preco ? ` · compraste a ${fmt(precoAnterior(id))} M€` : ''}${hp.length > 1 ? ` · ${hp.length - 1} alteraç${hp.length > 2 ? 'ões' : 'ão'} de preço` : ''}</span>
        </div>
        <button type="button" class="fan-fechar" data-fan="fechar-painel" aria-label="Fechar">×</button>
      </div>
      <div class="fan-painel__acoes">
        <button type="button" class="chip" data-fan="mudar">${i >= 0 ? 'Mudar de lugar ou trocar com um suplente' : 'Pôr no onze'}</button>
        <button type="button" class="chip" data-fan="substituir">Trocar por outro jogador</button>
        ${iBanco > 0 ? '<button type="button" class="chip" data-fan="subir" aria-label="Subir na ordem do banco">↑ Subir</button>' : ''}
        ${iBanco >= 0 && iBanco < rascunho.banco.length - 1 ? '<button type="button" class="chip" data-fan="descer" aria-label="Descer na ordem do banco">↓ Descer</button>' : ''}
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
    const f = rascunho?.formacao;
    const papelAlvo = escolha?.tipo === 'posto' ? papelDe(f, escolha.i) : null;
    const sai = escolha?.tipo === 'posto' ? rascunho.onze[escolha.i] : escolha?.sai;
    const lista = [...jogadores.values()]
      .filter(j => j.no_plantel || plantel().includes(j.id))
      .filter(j => papelAlvo ? podeJogar(papelAlvo, j.posicao) : (filtroPos === 'todos' || j.posicao === filtroPos))
      .filter(j => !busca || semAcento(j.nome).includes(semAcento(busca)))
      .sort((a, b) => ordem === 'nome' ? a.nome.localeCompare(b.nome, 'pt')
                    : ordem === 'pontos' ? (b.pontos ?? -999) - (a.pontos ?? -999) || (b.preco - a.preco)
                    : (b.preco ?? 0) - (a.preco ?? 0) || a.nome.localeCompare(b.nome, 'pt'));
    return `
      ${escolha ? `<div class="fan-escolha" role="status">
        <p>A escolher: <b>${escolha.tipo === 'posto' ? seguro(nomeLugar(f, escolha.i)) : 'suplente'}</b>${sai != null ? ` — no lugar de ${seguro(jog(sai)?.nome_curto)}, que é vendido` : ''}${papelAlvo ? ` <small>(${papeis()[papelAlvo].map(p => NOME_POS[p].toLowerCase()).join(' ou ')})</small>` : ''}</p>
        <button type="button" class="chip" data-fan="cancelar-escolha">Cancelar</button></div>` : ''}
      <div class="fan-filtros">
        <div class="filtro-temas" role="group" aria-label="Posição" ${papelAlvo ? 'hidden' : ''}>
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
    const porque = tenho ? null : podeEntrar(j.id, escolha);
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
    /* a classificação de prognósticos da mesma liga (js/prognosticos.js) */
    let prog = '';
    try{
      await window.carregarModulo?.('prognosticos');
      const lp = await window.Prognosticos.classificacaoLiga(ligaVista);
      prog = `<h4 class="fan-sub">Prognósticos na liga</h4>
        <ol class="fan-class">${lp.map((l, i) => `<li class="${l.perfil_id === eu.id ? 'eu' : ''}">
          <span class="fan-class__pos">${i + 1}</span><span class="fan-class__nome"><b>@${seguro(l.utilizador)}</b><span>${l.exatos} ${l.exatos === 1 ? 'exato' : 'exatos'} em ${l.jogos} ${l.jogos === 1 ? 'jogo' : 'jogos'}</span></span>
          <b class="fan-class__pts">${l.pontos}</b></li>`).join('')}</ol>
        <p class="fan-nota">3 pontos pelo resultado exato e 1 por acertar no vencedor ou no empate. Os prognósticos fazem-se na página inicial ou no Centro de jogo, até ao início de cada jogo.</p>`;
    }catch(e){ prog = '<p class="fan-nota">Não foi possível ler a classificação de prognósticos da liga.</p>'; }
    alvo.innerHTML = `<h4 class="fan-sub">Fantasy na liga</h4><ol class="fan-class">${(c.data || []).map((l, i) => `<li class="${l.perfil_id === eu.id ? 'eu' : ''}">
      <span class="fan-class__pos">${i + 1}</span><span class="fan-class__nome"><b>${seguro(l.nome_equipa)}</b><span>@${seguro(l.utilizador)}</span></span>
      <b class="fan-class__pts">${l.total}</b></li>`).join('')}</ol>${prog}`;
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
        <li><b>Quem não joga</b> não pontua. Sai automaticamente para o primeiro suplente (pela ordem do banco) que jogou e pode jogar naquele lugar; guarda-redes só por guarda-redes. Cada substituição aplica-se uma vez — recalcular dá sempre o mesmo resultado.</li>
        <li><b>Capitão</b>: pontos a dobrar. Se não jogar, o vice-capitão fica com o bónus; se nenhum jogar, não há bónus.</li>
        <li><b>Estatística em falta</b> não vale zero: não dá pontos e fica assinalada como "sem dados" no detalhe.</li>
        <li><b>Provisória → final</b>: os pontos aparecem como provisórios assim que as estatísticas são introduzidas e podem ser corrigidos. Ao fim de ${g.horas_ate_final} horas (ou quando o administrador a fecha) a jornada passa a final e não muda mais.</li>
      </ul>
      <h4>Equipa, orçamento e transferências</h4>
      <ul>
        <li>${11 + SUPLENTES()} jogadores: escolhes a formação (${Object.keys(formacoes()).join(', ')}), um jogador para cada lugar do onze e ${SUPLENTES()} suplentes. Orçamento inicial: ${fmt(g.orcamento)} M€ Fantasy.</li>
        <li>Cada lugar só leva quem lá pode jogar: guarda-redes na baliza; defesas a defesa direito, esquerdo e central; nas alas, defesas ou médios; médios no meio-campo; nos extremos, médios ou avançados; avançados a ponta de lança. O site só sabe se um jogador é defesa, médio ou avançado — não o lado em que costuma jogar — por isso és tu quem escolhe quem joga a defesa direito ou esquerdo.</li>
        <li>Capitão e vice escolhem-se por cima do campo e têm de ser titulares.</li>
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

  /* ---------- GESTÃO: relatório colado e golos do calendário (funções puras, testadas) */
  /* Uma linha por jogador, copiada do relatório oficial do jogo:
       "Nome; minutos; golos; assistências; amarelos; vermelhos; defesas; golos sofridos"
     (separado por ; , ou tabulação) ou "Nome 90 1 0" (os números no fim).
     O que falta fica sem dados (null), nunca zero. */
  const ORDEM_RELATORIO = ['minutos', 'golos', 'assistencias', 'amarelos', 'vermelhos', 'defesas', 'golos_sofridos'];
  const normNome = t => semAcento(t).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  function indiceNomes(lista){
    const porNome = new Map();
    const juntar = (k, j) => { if(!k) return; porNome.set(k, porNome.has(k) && porNome.get(k)?.id !== j.id ? null : j); };
    lista.forEach(j => {
      juntar(normNome(j.nome), j);
      juntar(normNome(j.nome_curto), j);
      juntar(normNome(j.nome_curto).split(' ').pop(), j);
      juntar(normNome(j.nome).split(' ').pop(), j);
    });
    return porNome;                       // null = o nome serve a mais do que um jogador
  }
  function lerRelatorio(texto, lista){
    const porNome = indiceNomes(lista);
    const linhas = [], naoReconhecidos = [], ambiguos = [];
    String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(l => {
      let nome, nums;
      if(/[;\t]/.test(l) || /,\s*\d/.test(l)){
        const p = l.split(/[;\t,]/).map(x => x.trim());
        nome = p[0]; nums = p.slice(1);
      }else{
        const m = l.match(/^(.*?[^\d\s-])\s+([\d\s-]+)$/);
        if(!m){ naoReconhecidos.push(l); return; }
        nome = m[1]; nums = m[2].trim().split(/\s+/);
      }
      const j = porNome.get(normNome(nome));
      if(j === undefined){ naoReconhecidos.push(nome); return; }
      if(j === null){ ambiguos.push(nome); return; }
      const v = {};
      ORDEM_RELATORIO.forEach((campo, i) => {
        const x = nums[i];
        v[campo] = x == null || x === '' || x === '-' || isNaN(Number(x)) ? null : Number(x);
      });
      if(v.minutos == null){ naoReconhecidos.push(nome + ' (sem minutos)'); return; }
      if(j.posicao !== 'GR'){ v.defesas = null; v.golos_sofridos = v.golos_sofridos ?? null; }
      linhas.push({ jogador_id: j.id, nome: j.nome_curto, ...v });
    });
    return { linhas, naoReconhecidos, ambiguos };
  }
  /* Golos do jogo a partir do calendário (Wikipédia): os marcadores do lado do
     Sporting contam como golos (menos os autogolos do adversário); os
     autogolos na lista do adversário são de jogadores do Sporting. */
  function golosDoCalendario(jogo, lista){
    if(!jogo) return null;
    const nosCasa = /sporting cp/i.test(jogo.casa);
    const nossos = (nosCasa ? jogo.marcadoresCasa : jogo.marcadoresFora) || [];
    const deles = (nosCasa ? jogo.marcadoresFora : jogo.marcadoresCasa) || [];
    const porNome = indiceNomes(lista);
    const golos = new Map(), autogolos = new Map(), semDono = [];
    const contar = (mapa, nome) => {
      const j = porNome.get(normNome(nome));
      if(!j){ semDono.push(nome); return; }
      mapa.set(j.id, (mapa.get(j.id) || 0) + 1);
    };
    nossos.filter(m => m.tipo !== 'ag').forEach(m => contar(golos, m.nome));
    deles.filter(m => m.tipo === 'ag').forEach(m => contar(autogolos, m.nome));
    return { golos_casa: jogo.golosCasa ?? null, golos_fora: jogo.golosFora ?? null, golos, autogolos, semDono };
  }
  /* o jogo do calendário que corresponde a esta jornada (mesmo dia e mesmo adversário) */
  function jogoDoCalendario(j){
    const lista = window.DadosSite?.jogos?.() || [];
    const dia = new Date(j.jogo.data).toISOString().slice(0, 10);
    const adv = normNome(/sporting cp/i.test(j.jogo.casa) ? j.jogo.fora : j.jogo.casa).split(' ').pop();
    return lista.find(x => new Date(x.data).toISOString().slice(0, 10) === dia
      && normNome(`${x.casa} ${x.fora}`).includes(adv)) || null;
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
    const estadoAtraso = x => x.calculada_em ? ['provisória', 'ok'] : comEstatisticas.has(x.jogo_id) ? ['com estatísticas, por calcular', 'aviso'] : ['sem estatísticas', 'erro'];
    const porCalcular = candidatas.filter(x => !x.calculada_em && comEstatisticas.has(x.jogo_id));
    return `<section class="fan-atraso" aria-labelledby="fan-atraso-t">
      <h4 id="fan-atraso-t">Jornadas em atraso <span>${candidatas.length}</span></h4>
      <p class="fan-nota">Jornadas cujo jogo já começou e que ainda não estão finalizadas. Escolhe uma para introduzir as estatísticas.</p>
      <ul class="fan-atraso__lista">${candidatas.map(x => { const [t, c] = estadoAtraso(x); return `
        <li><button type="button" class="fan-atraso__item ${x.id === j.id ? 'is-on' : ''}" data-fan-atraso="${x.id}">
          <b>J${x.numero}</b> ${seguro(x.jogo.casa)} ${x.jogo.golos_casa ?? '–'}–${x.jogo.golos_fora ?? '–'} ${seguro(x.jogo.fora)}
          <span class="fan-estado fan-estado--${c}">${t}</span></button></li>`; }).join('')}</ul>
      ${porCalcular.length ? `<button type="button" class="botao-cta" data-fan="calcular-atraso">Calcular ${porCalcular.length} ${porCalcular.length > 1 ? 'jornadas' : 'jornada'} que já têm estatísticas</button>` : ''}
    </section>
    <form class="fan-gestao" data-fan-form="estatisticas">
      <div class="fan-filtros__linha">
        <label class="chip chip--fonte"><span>J${j.numero} · ${seguro(j.jogo.casa)} x ${seguro(j.jogo.fora)}</span>
          <select id="fan-admin-jornada" aria-label="Jornada">${candidatas.map(x => `<option value="${x.id}" ${x.id === j.id ? 'selected' : ''}>J${x.numero} · ${seguro(x.jogo.casa)} x ${seguro(x.jogo.fora)}</option>`).join('')}</select></label>
      </div>
      <p class="fan-nota">Introduz os números do relatório oficial do jogo. Só quem jogou leva minutos; campos vazios ficam "sem dados" (não contam como zero). GS = golos sofridos com o jogador em campo (opcional). Rec = recuperações (só se a fonte as der).</p>
      <details class="fan-relatorio">
        <summary>Colar o relatório do jogo (mais rápido)</summary>
        <p class="fan-nota">Uma linha por jogador que jogou: <code>nome; minutos; golos; assistências; amarelos; vermelhos; defesas; golos sofridos</code>.
          Basta o nome e os minutos; o que faltar fica "sem dados". Também serve <code>Nome 90 1</code>. Exemplo:<br>
          <code>Rui Silva; 90; 0; 0; 0; 0; 3; 1</code> · <code>Debast; 90</code> · <code>Suárez; 78; 2; 1; 1</code></p>
        <label class="so-leitor" for="fan-relatorio">Relatório do jogo</label>
        <textarea id="fan-relatorio" rows="7" spellcheck="false" placeholder="Rui Silva; 90; 0; 0; 0; 0; 3; 1"></textarea>
        <div class="fan-gestao__acoes">
          <button type="button" class="chip" data-fan="aplicar-relatorio">Passar para a tabela</button>
          <button type="button" class="chip" data-fan="golos-calendario">Golos e resultado da Wikipédia</button>
        </div>
        <p class="fan-nota" id="fan-relatorio-nota" role="status"></p>
      </details>
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
    if(!comEstatisticas.lido){
      const { data: ids, error } = await db.from('desporto_estatisticas_jogo').select('jogo_id');
      if(!error){ comEstatisticas = new Set((ids || []).map(x => x.jogo_id)); comEstatisticas.lido = true; pintar(); return; }
    }
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
    if(error){ avisar('erro', mensagemErro(error)); return; }
    avisar('ok', `Jornada ${j.numero} calculada (provisória): ${data?.calculo?.jogadores ?? 0} jogadores, ${data?.calculo?.equipas ?? 0} equipas.`);
    comEstatisticas.lido = false;
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
      if(d.fanSep){ separador = d.fanSep; tocado = aTrocar = null; escolha = null; pintar(); return; }
      if(d.fanPos){ filtroPos = d.fanPos; pintar(); return; }
      if(d.fanFormacao){ mudarFormacao(d.fanFormacao); tocado = aTrocar = null; pintar(); return; }
      if(d.fanEntra){
        const tinhaEscolha = !!escolha;
        if(adicionar(Number(d.fanEntra), escolha) && tinhaEscolha){
          /* escolhido o jogador para o lugar: volta ao campo */
          escolha = null; separador = 'equipa'; pintar();
          $('.fan-campo', raiz)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          return;
        }
        pintar(); return;
      }
      if(d.fanSai){ remover(Number(d.fanSai)); pintar(); return; }
      if('fanPosto' in d){
        const i = Number(d.fanPosto);
        if(aTrocar != null){
          const mau = colocar(aTrocar, i);
          if(mau) avisar('erro', mau); else aTrocar = null;
          pintar(); return;
        }
        escolha = { tipo: 'posto', i }; separador = 'mercado'; tocado = null; busca = '';
        pintar(); $('#fan-corpo', raiz)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      if('fanBancoVazio' in d){
        if(aTrocar != null){
          const mau = paraBanco(aTrocar);
          if(mau) avisar('erro', mau); else aTrocar = null;
          pintar(); return;
        }
        escolha = { tipo: 'banco' }; separador = 'mercado'; filtroPos = 'todos'; tocado = null; busca = '';
        pintar(); $('#fan-corpo', raiz)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      if(d.fanSlot){
        const id = Number(d.fanSlot);
        if(aTrocar){
          if(aTrocar === id){ aTrocar = null; pintar(); return; }
          const mau = trocar(aTrocar, id);
          if(mau) avisar('erro', mau);
          else { aTrocar = null; tocado = null; if(aviso?.tipo === 'erro') aviso = null; }
          pintar(); return;
        }
        tocado = tocado === id ? null : id; pintar();
        $('.fan-painel', raiz)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      if(d.fanLiga){ ligaVista = Number(d.fanLiga); pintar(); return; }
      if(d.fanAtraso){ adminJornada = Number(d.fanAtraso); pintar(); return; }
      if(d.fanPartilhar){
        const texto = `Junta-te à minha liga "${d.nome}" no Fantasy do Sporting ao Minuto. Código: ${d.fanPartilhar}`;
        try{ if(navigator.share) await navigator.share({ title: 'Liga Fantasy', text: texto, url: location.origin + '/fantasy' });
             else { await navigator.clipboard.writeText(texto); avisar('ok', 'Convite copiado.'); } }catch(e){}
        return;
      }
      if(d.fanSair){
        const { error } = await db.rpc('fantasy_sair_liga', { p_liga: Number(d.fanSair) });
        if(error) avisar('erro', mensagemErro(error)); else { avisar('ok', 'Saíste da liga.'); ligaVista = null; await carregarMinhas(); pintar(); }
        return;
      }
      switch(d.fan){
        case 'recarregar': carregar(); break;
        case 'fechar-painel': tocado = null; pintar(); break;
        case 'mudar': aTrocar = tocado; tocado = null; pintar(); break;
        case 'substituir': {
          const i = rascunho.onze.indexOf(tocado);
          escolha = i >= 0 ? { tipo: 'posto', i } : { tipo: 'banco', sai: tocado };
          separador = 'mercado'; filtroPos = 'todos'; tocado = null; busca = '';
          pintar(); $('#fan-corpo', raiz)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          break;
        }
        case 'cancelar-escolha': escolha = null; separador = 'equipa'; pintar(); break;
        case 'cancelar-troca': aTrocar = null; pintar(); break;
        case 'subir': moverBanco(tocado, -1); pintar(); break;
        case 'descer': moverBanco(tocado, 1); pintar(); break;
        case 'vender': remover(tocado); pintar(); break;
        case 'repor': try{ localStorage.removeItem(CHAVE_RASCUNHO()); }catch(e){} montarRascunho(); tocado = aTrocar = null; escolha = null; pintar(); break;
        case 'guardar': guardar(); break;
        case 'aplicar-relatorio': {
          const form = $('[data-fan-form="estatisticas"]', raiz);
          const lista = [...jogadores.values()].filter(x => x.no_plantel);
          const r = lerRelatorio($('#fan-relatorio', raiz).value, lista);
          r.linhas.forEach(l => {
            const tr = $(`tr[data-jogador="${l.jogador_id}"]`, form);
            ORDEM_RELATORIO.forEach(k => { const i = tr?.querySelector(`[name="${k}"]`); if(i && !i.disabled) i.value = l[k] ?? ''; });
          });
          $('#fan-relatorio-nota', raiz).textContent = `${r.linhas.length} ${r.linhas.length === 1 ? 'jogador passado' : 'jogadores passados'} para a tabela.`
            + (r.naoReconhecidos.length ? ` Não reconhecidos: ${r.naoReconhecidos.join(', ')}.` : '')
            + (r.ambiguos.length ? ` Nomes que servem a mais do que um jogador (escreve o nome completo): ${r.ambiguos.join(', ')}.` : '');
          break;
        }
        case 'golos-calendario': {
          const form = $('[data-fan-form="estatisticas"]', raiz);
          const j = jor(adminJornada);
          const lista = [...jogadores.values()].filter(x => x.no_plantel);
          const g = golosDoCalendario(jogoDoCalendario(j), lista);
          const nota = $('#fan-relatorio-nota', raiz);
          if(!g){ nota.textContent = 'O calendário ainda não tem este jogo (abre o site na página inicial para o ler e tenta outra vez).'; break; }
          if(g.golos_casa != null) form.golos_casa.value = g.golos_casa;
          if(g.golos_fora != null) form.golos_fora.value = g.golos_fora;
          g.golos.forEach((n, id) => { const i = $(`tr[data-jogador="${id}"] [name="golos"]`, form); if(i) i.value = n; });
          g.autogolos.forEach((n, id) => { const i = $(`tr[data-jogador="${id}"] [name="autogolos"]`, form); if(i) i.value = n; });
          nota.textContent = `Resultado e ${[...g.golos.values()].reduce((a, b) => a + b, 0)} golos preenchidos a partir da Wikipédia — confirma com o relatório oficial.`
            + (g.semDono.length ? ` Marcadores que não reconheci: ${g.semDono.join(', ')}.` : '');
          break;
        }
        case 'calcular-atraso': {
          const alvo = jornadas.filter(x => !x.finalizada_em && new Date(x.fecho) <= Date.now() && !x.calculada_em && comEstatisticas.has(x.jogo_id));
          let feitas = 0, erroCalc = null;
          for(const x of alvo){
            const { error } = await db.rpc('fantasy_calcular_jornada', { p_jornada: x.id });
            if(error){ erroCalc = mensagemErro(error); break; }
            feitas++;
          }
          avisar(erroCalc ? 'erro' : 'ok', erroCalc ? `Calculadas ${feitas}; parou com: ${erroCalc}` : `${feitas} ${feitas === 1 ? 'jornada calculada' : 'jornadas calculadas'} (provisórias).`);
          comEstatisticas.lido = false;
          await carregar();
          break;
        }
        case 'finalizar': {
          const j = jor(adminJornada);
          const { data, error } = await db.rpc('fantasy_finalizar_jornada', { p_jornada: j.id });
          if(error) avisar('erro', mensagemErro(error)); else { avisar('ok', `Jornada ${j.numero} finalizada; ${data.precos_alterados} preços mudaram.`); await carregar(); }
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
      if(t.id === 'fan-capitao' && t.value){ capitao(Number(t.value)); pintar(); }
      if(t.id === 'fan-vice' && t.value){ vice(Number(t.value)); pintar(); }
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
      if(error){ avisar('erro', mensagemErro(error)); return; }
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

  /* só para os testes automáticos (tests/fantasy_logica.test.js): as regras
     do rascunho, sem desenho nem servidor */
  const _teste = {
    adicionar, remover, trocar, colocar, paraBanco, mudarFormacao, podeEntrar, nomeLugar, siglaLugar,
    capitao, vice, problemas, contas, contar, guardarRascunho, mensagemErro, lerRelatorio, golosDoCalendario, gestao,
    get escolha(){ return escolha; }, set escolha(v){ escolha = v; },
    get rascunho(){ return rascunho; }, get aviso(){ return aviso; }, get minhas(){ return minhas; },
    get eu(){ return eu; }, get admin(){ return admin; }, get estado(){ return estado; }
  };

  return { abrir, recarregar: carregar, _teste };
})();
/* o app.js chega-lhe por window (um const global não fica em window) */
window.Fantasy = Fantasy;
