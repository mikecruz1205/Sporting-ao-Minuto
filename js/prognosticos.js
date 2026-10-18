/* =========================================================================
   PROGNÓSTICOS E HOMEM DO JOGO
   -------------------------------------------------------------------------
   Prognóstico: até ao apito inicial, cada conta prevê o resultado do jogo
   do Sporting. O servidor fecha à hora do jogo e conta os pontos quando o
   resultado está na base de dados: 3 pelo resultado exato, 1 por acertar
   no vencedor ou no empate (prognostico_guardar, prognostico_pontos).
   Homem do jogo: depois do fim (1h45 após o início) e até 3 dias depois,
   cada conta vota num jogador do plantel (homem_do_jogo_votar).
   Ninguém vê os prognósticos ou votos dos outros: só totais.
   Aparece no bloco "Jogar e conversar", no Centro de jogo e nas ligas da
   Fantasy (classificação de prognósticos da liga).
   ========================================================================= */
const Prognosticos = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const seguro = t => Componentes.seguro(t);
  const FIM_JOGO = 105 * 60e3, FECHO_VOTO = 3 * 86400e3;

  let jogos = null, plantel = null;

  /* ---------------------------------------------------------------- regras (puras, testadas) */
  function pontos(prev, jogo){
    if(!prev || jogo.golos_casa == null || jogo.golos_fora == null) return null;
    const nos = jogo.sporting_casa ? jogo.golos_casa : jogo.golos_fora;
    const eles = jogo.sporting_casa ? jogo.golos_fora : jogo.golos_casa;
    if(prev.golos_sporting === nos && prev.golos_adversario === eles) return 3;
    return Math.sign(prev.golos_sporting - prev.golos_adversario) === Math.sign(nos - eles) ? 1 : 0;
  }
  const proximoJogo = (lista, agora = Date.now()) =>
    lista.filter(j => new Date(j.data).getTime() > agora).sort((a, b) => new Date(a.data) - new Date(b.data))[0] || null;
  const jogoParaVotar = (lista, agora = Date.now()) =>
    lista.filter(j => { const t = new Date(j.data).getTime(); return agora >= t + FIM_JOGO && agora <= t + FECHO_VOTO; })
         .sort((a, b) => new Date(b.data) - new Date(a.data))[0] || null;
  const adversario = j => j.sporting_casa ? j.fora : j.casa;
  /* o jogo da base de dados que corresponde a um jogo do calendário (mesmo dia e adversário) */
  const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim();
  function correspondente(lista, j){
    if(!j) return null;
    const dia = new Date(j.data).toISOString().slice(0, 10);
    const adv = norm(/sporting cp/i.test(j.casa) ? j.fora : j.casa).split(' ').filter(p => p.length > 2).pop() || '';
    return lista.find(x => new Date(x.data).toISOString().slice(0, 10) === dia && norm(adversario(x)).includes(adv)) || null;
  }

  /* ---------------------------------------------------------------- dados */
  async function ler(){
    await Nuvem.garantir();
    const db = Nuvem.cliente;
    if(!db) throw new Error('sem ligação');
    if(!jogos){
      const { data, error } = await db.from('desporto_jogos')
        .select('id, data, competicao, fase, casa, fora, sporting_casa, golos_casa, golos_fora, estado').order('data');
      if(error) throw error;
      jogos = data || [];
    }
    return db;
  }
  async function lerPlantel(db){
    if(plantel) return plantel;
    const { data, error } = await db.from('desporto_jogadores').select('id, nome_curto, posicao, numero').eq('no_plantel', true).order('numero');
    if(error) throw error;
    return (plantel = data || []);
  }
  const quando = d => new Date(d).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  /* ---------------------------------------------------------------- desenho */
  async function blocoPrognostico(db, j){
    const eu = Nuvem.perfil;
    const [meu, resumo] = await Promise.all([
      eu ? db.from('prognosticos').select('golos_sporting, golos_adversario').eq('jogo_id', j.id).maybeSingle() : { data: null },
      db.rpc('prognosticos_resumo', { p_jogo: j.id })
    ]);
    const m = meu.data, r = resumo.data || { total: 0 };
    const nosCasa = j.sporting_casa;
    const vCasa = m ? (nosCasa ? m.golos_sporting : m.golos_adversario) : '';
    const vFora = m ? (nosCasa ? m.golos_adversario : m.golos_sporting) : '';
    const pct = k => r.total ? Math.round(r[k] / r.total * 100) : 0;
    return `<div class="prog__bloco" data-prog-jogo="${j.id}" data-sporting-casa="${nosCasa}">
      <p class="prog__titulo"><b>Prognóstico</b> · ${seguro(j.competicao)}${j.fase ? ' · ' + seguro(j.fase) : ''}</p>
      ${eu ? `<form class="prog__form" data-prog-form>
        <label><span>${seguro(j.casa)}</span><input type="number" name="casa" min="0" max="20" inputmode="numeric" required value="${vCasa}" aria-label="Golos do ${seguro(j.casa)}"></label>
        <span class="prog__x" aria-hidden="true">–</span>
        <label><input type="number" name="fora" min="0" max="20" inputmode="numeric" required value="${vFora}" aria-label="Golos do ${seguro(j.fora)}"><span>${seguro(j.fora)}</span></label>
        <button type="submit" class="p1">${m ? 'Mudar' : 'Guardar'}</button>
      </form>
      <p class="prog__nota" role="status">${m ? 'O teu prognóstico está guardado. Podes mudá-lo até' : 'Fecha'} ${quando(j.data)}. Exato: 3 pontos · vencedor certo: 1.</p>`
      : `<p class="prog__nota">${seguro(j.casa)} – ${seguro(j.fora)} · fecha ${quando(j.data)}.</p>
         <div class="comu__acoes"><button type="button" class="p1" data-auth="entrar">Entrar para prever</button></div>`}
      ${r.total ? `<p class="prog__adeptos">Os adeptos preveem (${r.total}): vitória ${pct('vitoria')}% · empate ${pct('empate')}% · derrota ${pct('derrota')}%</p>` : ''}
    </div>`;
  }

  async function blocoVoto(db, j){
    const eu = Nuvem.perfil;
    const [meu, res, jogadores] = await Promise.all([
      eu ? db.from('homem_do_jogo_votos').select('jogador_id').eq('jogo_id', j.id).maybeSingle() : { data: null },
      db.rpc('homem_do_jogo_resultados', { p_jogo: j.id }),
      lerPlantel(db)
    ]);
    const votos = res.data || [];
    const total = votos.reduce((s, v) => s + Number(v.votos), 0);
    const meuVoto = meu.data?.jogador_id;
    return `<div class="prog__bloco" data-voto-jogo="${j.id}">
      <p class="prog__titulo"><b>Homem do jogo</b> · ${seguro(j.casa)} ${j.golos_casa ?? '–'}–${j.golos_fora ?? '–'} ${seguro(j.fora)}</p>
      ${eu ? `<form class="prog__voto" data-voto-form>
          <label class="so-leitor" for="voto-${j.id}">Escolhe o melhor jogador</label>
          <select id="voto-${j.id}" name="jogador" required>
            <option value="">Escolhe o melhor jogador…</option>
            ${jogadores.map(p => `<option value="${p.id}" ${p.id === meuVoto ? 'selected' : ''}>${p.numero ? p.numero + ' · ' : ''}${seguro(p.nome_curto)}</option>`).join('')}
          </select>
          <button type="submit" class="p1">${meuVoto ? 'Mudar o voto' : 'Votar'}</button>
        </form>`
        : `<div class="comu__acoes"><button type="button" class="p1" data-auth="entrar">Entrar para votar</button></div>`}
      ${total ? `<ol class="prog__votos">${votos.slice(0, 5).map(v => `<li><span>${seguro(v.nome_curto)}</span>
          <i style="--p:${Math.round(v.votos / total * 100)}%" aria-hidden="true"></i><b>${Math.round(v.votos / total * 100)}%</b></li>`).join('')}</ol>
          <p class="prog__nota">${total} ${total === 1 ? 'voto' : 'votos'} · a votação fecha ${quando(new Date(new Date(j.data).getTime() + FECHO_VOTO))}.</p>`
        : `<p class="prog__nota">Ainda ninguém votou. Fecha ${quando(new Date(new Date(j.data).getTime() + FECHO_VOTO))}.</p>`}
    </div>`;
  }

  async function meusPontos(db){
    if(!Nuvem.perfil) return '';
    const { data, error } = await db.from('prognosticos').select('jogo_id, golos_sporting, golos_adversario');
    if(error || !data?.length) return '';
    const porId = new Map(jogos.map(j => [j.id, j]));
    const comResultado = data.map(p => pontos(p, porId.get(p.jogo_id) || {})).filter(x => x != null);
    if(!comResultado.length) return '';
    const soma = comResultado.reduce((a, b) => a + b, 0);
    return `<p class="prog__meus">Os teus prognósticos: <b>${soma} ${soma === 1 ? 'ponto' : 'pontos'}</b> em ${comResultado.length} ${comResultado.length === 1 ? 'jogo' : 'jogos'} · ${comResultado.filter(x => x === 3).length} exatos</p>`;
  }

  /* cartão do bloco "Jogar e conversar": o próximo jogo e, se houver, a votação do último */
  async function pintarCartao(){
    const alvo = document.getElementById('comu-prog-corpo');
    if(!alvo) return;
    try{
      const db = await ler();
      const prox = proximoJogo(jogos), votar = jogoParaVotar(jogos);
      const partes = [];
      if(votar) partes.push(await blocoVoto(db, votar));
      if(prox) partes.push(await blocoPrognostico(db, prox));
      alvo.innerHTML = (partes.join('') || '<p class="comu__linha">Não há jogos marcados para prever neste momento.</p>') + await meusPontos(db);
    }catch(e){
      alvo.innerHTML = `<div class="estado-falha estado-falha--curto" role="alert"><p>Não foi possível ler os prognósticos.</p>
        <button type="button" class="botao-tentar" data-prog-tentar>Tentar outra vez</button></div>`;
    }
  }

  /* no Centro de jogo: o jogo que está a ser visto */
  async function pintarNoCentro(jogoCalendario){
    const alvo = document.getElementById('prog-centro');
    if(!alvo) return;
    try{
      const db = await ler();
      const j = correspondente(jogos, jogoCalendario);
      if(!j){ alvo.hidden = true; return; }
      const t = new Date(j.data).getTime(), agora = Date.now();
      const html = agora < t ? await blocoPrognostico(db, j)
                 : agora >= t + FIM_JOGO && agora <= t + FECHO_VOTO ? await blocoVoto(db, j) : '';
      alvo.hidden = !html;
      alvo.innerHTML = html ? `<h3 class="prog__h">Jogar com o jogo</h3>${html}` : '';
    }catch(e){ alvo.hidden = true; }
  }

  /* classificação de prognósticos de uma liga privada (Fantasy → Ligas) */
  async function classificacaoLiga(liga){
    const db = await ler();
    const { data, error } = await db.rpc('prognosticos_classificacao_liga', { p_liga: liga });
    if(error) throw error;
    return data || [];
  }

  async function guardar(form){
    const bloco = form.closest('[data-prog-jogo]');
    const nosCasa = bloco.dataset.sportingCasa === 'true';
    const casa = Number(form.casa.value), fora = Number(form.fora.value);
    const nota = bloco.querySelector('.prog__nota');
    const { error } = await Nuvem.cliente.rpc('prognostico_guardar', {
      p_jogo: Number(bloco.dataset.progJogo), p_nos: nosCasa ? casa : fora, p_eles: nosCasa ? fora : casa });
    if(nota) nota.textContent = error ? (error.message || 'Não foi possível guardar.') : 'Guardado. Podes mudar até ao início do jogo.';
    if(!error) setTimeout(() => { pintarCartao(); const c = document.getElementById('prog-centro'); if(c && !c.hidden) pintarNoCentro(ultimoCentro); }, 600);
  }
  async function votar(form){
    const bloco = form.closest('[data-voto-jogo]');
    const { error } = await Nuvem.cliente.rpc('homem_do_jogo_votar', { p_jogo: Number(bloco.dataset.votoJogo), p_jogador: Number(form.jogador.value) });
    if(error){ const n = bloco.querySelector('.prog__nota'); if(n) n.textContent = error.message || 'Não foi possível votar.'; return; }
    pintarCartao();
    if(ultimoCentro) pintarNoCentro(ultimoCentro);
  }

  let ultimoCentro = null;
  document.addEventListener('submit', e => {
    const f = e.target;
    if(f.matches?.('[data-prog-form]')){ e.preventDefault(); guardar(f); }
    if(f.matches?.('[data-voto-form]')){ e.preventDefault(); votar(f); }
  });
  document.addEventListener('click', e => { if(e.target.closest('[data-prog-tentar]')){ jogos = null; pintarCartao(); } });

  return {
    pintarCartao, classificacaoLiga,
    pintarNoCentro: j => { ultimoCentro = j; return pintarNoCentro(j); },
    _teste: { pontos, proximoJogo, jogoParaVotar, correspondente }
  };
})();
window.Prognosticos = Prognosticos;
