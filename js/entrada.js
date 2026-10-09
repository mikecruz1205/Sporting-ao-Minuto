/* =========================================================================
   ENTRADA — boas-vindas, entrar / criar conta / recuperar, perfil, visitante
   -------------------------------------------------------------------------
   As contas são as do Supabase (js/nuvem.js), com nome de utilizador. Se o
   servidor não responder, o site continua a abrir com as contas locais de
   sempre (js/contas.js) — mas aí sem chat nem Fantasy partilhados.

   Modo visitante: quem não quer conta lê tudo o que é público (notícias,
   jogos, resultados, classificação, estatísticas). O que é privado — o chat,
   a equipa Fantasy, o perfil — pede para entrar. Esconder botões não é a
   proteção: quem guarda os dados são as regras RLS do Supabase.

   O app.js chama Entrada.iniciar({ aoEntrar, aoSair, irPara }).
   ========================================================================= */

const Entrada = (() => {

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const CHAVE_VISITANTE = 'scp-visitante';

  let opcoes = { aoEntrar(){}, aoSair(){}, irPara(){} };
  let nome = null;               // quem está com sessão (null = visitante)
  let depoisDeEntrar = null;     // vista a abrir depois de entrar (ex.: 'chat')

  const naNuvem = () => Nuvem.ligado;
  const lsGet = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
  const lsSet = (k, v) => { try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }catch(e){} };

  /* =====================================================================
     Estado: com conta ou visitante
     ===================================================================== */
  function quemEsta(){
    if(naNuvem()) return Nuvem.perfil ? (Nuvem.perfil.nome_mostrado || Nuvem.perfil.utilizador) : null;
    return Contas.sessao()?.nome || null;
  }

  function pintarCabecalho(){
    const comConta = !!nome;
    document.body.classList.toggle('com-conta', comConta);
    document.body.classList.toggle('visitante', !comConta);
    const conta = $('#btn-conta'), entrar = $('#btn-entrar');
    if(conta) conta.hidden = !comConta;
    if(entrar) entrar.hidden = comConta;
    const quem = $('#quem');
    if(quem) quem.textContent = comConta ? '@' + nome : '';
    if(conta) conta.setAttribute('aria-label', comConta ? `A minha conta (@${nome})` : 'A minha conta');
    $('#btn-entrar-gaveta') && ($('#btn-entrar-gaveta').hidden = comConta);
    $('#btn-sair-gaveta') && ($('#btn-sair-gaveta').hidden = !comConta);
  }

  /* a página de boas-vindas sai e o site fica à vista */
  function abrirSite(animar){
    const ecra = $('#acesso');
    document.body.classList.remove('trancado');
    if(!ecra || ecra.hidden) return;
    if(animar && !matchMedia('(prefers-reduced-motion: reduce)').matches){
      ecra.classList.add('a-sair');
      setTimeout(() => { ecra.hidden = true; ecra.classList.remove('a-sair'); }, 460);
    }else{
      ecra.hidden = true;
    }
  }

  function mudouConta(novoNome){
    nome = novoNome;
    pintarCabecalho();
    document.dispatchEvent(new CustomEvent('conta:mudou', { detail: { nome } }));
  }

  /* =====================================================================
     Painel de autenticação
     ===================================================================== */
  const dlg = () => $('#auth');
  const TITULOS = { entrar: 'Entrar', criar: 'Criar conta', recuperar: 'Recuperar palavra-passe',
                    codigo: 'Guarda o teu código', feito: '' };
  const VISTAS = { entrar: '#form-entrar', criar: '#form-criar', recuperar: '#form-recuperar',
                   codigo: '#auth-codigo', feito: '#auth-feito' };

  function mostrarVista(qual){
    Object.entries(VISTAS).forEach(([k, sel]) => { const el = $(sel); if(el) el.hidden = k !== qual; });
    const comAbas = qual === 'entrar' || qual === 'criar';
    $('.auth__abas').hidden = !comAbas;
    $('#aba-entrar').classList.toggle('is-on', qual === 'entrar');
    $('#aba-criar').classList.toggle('is-on', qual === 'criar');
    $('#aba-entrar').setAttribute('aria-selected', qual === 'entrar');
    $('#aba-criar').setAttribute('aria-selected', qual === 'criar');
    $('#aba-entrar').tabIndex = qual === 'entrar' ? 0 : -1;
    $('#aba-criar').tabIndex = qual === 'criar' ? 0 : -1;
    $('#auth-titulo').textContent = TITULOS[qual] || 'Conta';
    dlg().dataset.vista = qual;
    /* o primeiro campo vazio fica com o foco (não no telemóvel ao abrir:
       o teclado tapava metade do ecrã antes de a pessoa decidir) */
    const primeiro = $(VISTAS[qual])?.querySelector('input:not([type=checkbox]):not([hidden])');
    if(primeiro && matchMedia('(pointer: fine)').matches){
      const vazio = [...$(VISTAS[qual]).querySelectorAll('input:not([type=checkbox]):not([hidden])')].find(i => !i.value) || primeiro;
      setTimeout(() => vazio.focus(), 40);
    }
  }

  /* abrir o painel numa vista; a mensagem explica porque se pediu (ex.: chat) */
  function abrirAuth(qual = 'entrar', motivo = '', vista = null){
    const d = dlg();
    if(!d) return;
    depoisDeEntrar = vista;
    limparErros();
    const aviso = $('#auth-offline');
    if(!naNuvem()){
      aviso.hidden = false;
      aviso.textContent = 'Sem ligação ao servidor: as contas ficam só neste browser e o chat e a Fantasy não funcionam.';
    }else if(motivo){
      aviso.hidden = false; aviso.textContent = motivo;
    }else{
      aviso.hidden = true;
    }
    if(!d.open) d.showModal();
    mostrarVista(qual);
  }

  function fecharAuth(){
    const d = dlg();
    if(!d?.open) return;
    /* o código só aparece uma vez: não se fecha sem a pessoa dizer que o guardou */
    if(d.dataset.vista === 'codigo' && !$('#codigo-confirmo').checked){
      $('#codigo-aviso').textContent = 'Confirma que guardaste o código antes de fechar.';
      return;
    }
    d.close();
  }

  function limparErros(raiz = dlg()){
    raiz?.querySelectorAll('.fcampo__erro, .auth__erro').forEach(e => e.textContent = '');
    raiz?.querySelectorAll('[aria-invalid]').forEach(e => e.removeAttribute('aria-invalid'));
  }

  function erroNoCampo(input, texto){
    if(!input) return;
    input.setAttribute('aria-invalid', 'true');
    const alvo = document.getElementById((input.getAttribute('aria-describedby') || '').split(' ').find(id => id.startsWith('erro-')));
    if(alvo) alvo.textContent = texto;
    input.focus();
  }

  function aCarregar(botao, sim, texto){
    if(!botao) return;
    botao.disabled = sim;
    botao.classList.toggle('a-carregar', sim);
    botao.setAttribute('aria-busy', sim);
    const span = botao.querySelector('span');
    if(span){
      if(sim){ botao.dataset.texto = span.textContent; span.textContent = texto; }
      else if(botao.dataset.texto){ span.textContent = botao.dataset.texto; }
    }
  }

  /* confirmação curta no próprio painel; depois fecha (ou mostra botões) */
  function feito(html, { fechaEm = 0, acoes = '' } = {}){
    $('#auth-feito-texto').innerHTML = html;
    $('#auth-feito').querySelectorAll('.auth__botao').forEach(b => b.remove());
    if(acoes) $('#auth-feito').insertAdjacentHTML('beforeend', acoes);
    mostrarVista('feito');
    if(fechaEm) setTimeout(() => { if(dlg().dataset.vista === 'feito') fecharAuth(); }, fechaEm);
  }

  function seguro(t){ return Componentes.seguro(t); }

  /* depois de entrar ou criar conta */
  function entrou(novoNome, { animar = true } = {}){
    lsSet(CHAVE_VISITANTE, null);
    mudouConta(novoNome);
    abrirSite(animar);
    opcoes.aoEntrar(novoNome);
    if(depoisDeEntrar){ opcoes.irPara(depoisDeEntrar); depoisDeEntrar = null; }
  }

  function ligarAuth(){
    const d = dlg();
    if(!d) return;

    /* abrir a partir de qualquer botão com data-auth (entrada, cabeçalho, gaveta, portões) */
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-auth]');
      if(!b) return;
      e.preventDefault();
      if(b.closest('.menu')) document.getElementById('menu-abrir')?.getAttribute('aria-expanded') === 'true' && document.getElementById('menu-abrir').click();
      abrirAuth(b.dataset.auth, b.dataset.authMotivo || '', b.dataset.authVista || null);
    });
    $$('[data-auth-fechar]').forEach(b => b.addEventListener('click', fecharAuth));
    /* toque fora da caixa fecha (no telemóvel a folha ocupa o ecrã todo) */
    d.addEventListener('click', e => { if(e.target === d) fecharAuth(); });

    /* separadores com setas, como manda o padrão ARIA */
    $('.auth__abas').addEventListener('keydown', e => {
      if(!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const ir = $('#aba-entrar').classList.contains('is-on') ? 'criar' : 'entrar';
      mostrarVista(ir);
      $(ir === 'entrar' ? '#aba-entrar' : '#aba-criar').focus();
    });
    $('#aba-entrar').addEventListener('click', () => { limparErros(); mostrarVista('entrar'); });
    $('#aba-criar').addEventListener('click', () => { limparErros(); mostrarVista('criar'); });

    /* olho da palavra-passe */
    $$('.ver-palavra', d).forEach(b => b.addEventListener('click', () => {
      const campo = document.getElementById(b.dataset.alvo);
      const mostrar = campo.type === 'password';
      campo.type = mostrar ? 'text' : 'password';
      b.classList.toggle('is-on', mostrar);
      b.setAttribute('aria-pressed', mostrar);
      b.setAttribute('aria-label', mostrar ? 'Esconder palavra-passe' : 'Mostrar palavra-passe');
    }));

    /* ao escrever, o erro daquele campo sai */
    d.addEventListener('input', e => {
      const i = e.target;
      if(i.matches('[aria-invalid]')){
        i.removeAttribute('aria-invalid');
        const alvo = document.getElementById((i.getAttribute('aria-describedby') || '').split(' ').find(id => id.startsWith('erro-')));
        if(alvo) alvo.textContent = '';
      }
    });

    /* ---------- nome livre, enquanto se escreve ---------- */
    const novo = $('#criar-utilizador');
    const estado = $('#estado-utilizador');
    novo.addEventListener('input', () => {
      const v = novo.value.trim();
      clearTimeout(novo._espera);
      if(!v){ estado.textContent = ''; estado.className = 'fcampo__estado'; return; }
      const erro = Nuvem.validarUtilizador(v);
      if(erro){ estado.textContent = erro; estado.className = 'fcampo__estado mau'; return; }
      if(!naNuvem()){
        const usado = Contas.existe(v);
        estado.textContent = usado ? 'Já está a ser usado.' : 'Está livre.';
        estado.className = 'fcampo__estado ' + (usado ? 'mau' : 'bom');
        return;
      }
      estado.textContent = 'A verificar…'; estado.className = 'fcampo__estado';
      novo._espera = setTimeout(async () => {
        let livre = null;
        try{ livre = await Nuvem.nomeLivre(v); }catch(e){}
        if(novo.value.trim() !== v) return;
        if(livre === null){ estado.textContent = ''; return; }
        estado.textContent = livre ? 'Está livre.' : 'Já está a ser usado.';
        estado.className = 'fcampo__estado ' + (livre ? 'bom' : 'mau');
      }, 450);
    });

    /* ---------- entrar ---------- */
    $('#form-entrar').addEventListener('submit', async e => {
      e.preventDefault();
      limparErros();
      const u = $('#entrar-utilizador'), p = $('#current-password');
      if(!u.value.trim()) return erroNoCampo(u, 'Escreve o teu nome de utilizador.');
      if(!p.value) return erroNoCampo(p, 'Escreve a tua palavra-passe.');
      const botao = e.target.querySelector('[type=submit]');
      aCarregar(botao, true, 'A entrar…');
      try{
        const r = naNuvem()
          ? await Nuvem.entrar(u.value, p.value, $('#lembrar').checked)
          : await Contas.entrar(u.value, p.value, $('#lembrar').checked);
        if(r.erro){
          if(r.campo === 'utilizador') erroNoCampo(u, r.erro);
          else{ $('#erro-entrar').textContent = r.erro; p.value = ''; p.focus(); }
          return;
        }
        p.value = '';
        const temCodigo = naNuvem() ? await Nuvem.estadoRecuperacao() : null;
        entrou(r.nome);
        if(temCodigo && !temCodigo.temCodigo){
          /* contas antigas não têm código: pede-se uma vez, sem obrigar */
          feito(`Bem-vindo de volta, @${seguro(r.nome)}.<small>A tua conta ainda não tem código de recuperação.
            Sem ele, se esqueceres a palavra-passe não há forma de a mudar.</small>`, {
            acoes: `<button type="button" class="auth__botao" data-feito="gerar"><span>Gerar código agora</span></button>
                    <button type="button" class="auth__botao auth__botao--fantasma" data-auth-fechar-feito>Mais tarde</button>`
          });
        }else{
          feito(`Bem-vindo de volta, @${seguro(r.nome)}.`, { fechaEm: 900 });
        }
      }finally{
        aCarregar(botao, false);
      }
    });

    /* ---------- criar conta ---------- */
    $('#form-criar').addEventListener('submit', async e => {
      e.preventDefault();
      limparErros();
      const u = $('#criar-utilizador'), p = $('#new-password');
      const eu = Nuvem.validarUtilizador(u.value);
      if(eu) return erroNoCampo(u, eu);
      const ep = Nuvem.validarNova(p.value);
      if(ep) return erroNoCampo(p, ep);
      const botao = e.target.querySelector('[type=submit]');
      aCarregar(botao, true, 'A criar a conta…');
      try{
        const r = naNuvem()
          ? await Nuvem.registar(u.value, p.value, true)
          : await Contas.registar(u.value, p.value);
        if(r.erro){
          if(r.campo === 'utilizador'){ erroNoCampo(u, r.erro); estado.textContent = ''; }
          else if(r.campo === 'palavra') erroNoCampo(p, r.erro);
          else $('#erro-criar').textContent = r.erro;
          return;
        }
        if(!naNuvem()) await Contas.entrar(u.value, p.value, true);
        p.value = '';
        entrou(r.nome);
        if(naNuvem()){
          const c = await Nuvem.gerarCodigo();
          if(c.ok) return mostrarCodigo(c.codigo, r.nome);
          feito(`Conta criada. Bem-vindo, @${seguro(r.nome)}!<small>Não foi possível gerar já o código de recuperação —
            gera-o no teu perfil.</small>`, { fechaEm: 2600 });
        }else{
          feito(`Conta criada neste browser, @${seguro(r.nome)}.`, { fechaEm: 1400 });
        }
      }finally{
        aCarregar(botao, false);
      }
    });

    /* ---------- recuperar ---------- */
    $('#form-recuperar').addEventListener('submit', async e => {
      e.preventDefault();
      limparErros();
      const u = $('#rec-utilizador'), c = $('#rec-codigo'), p = $('#rec-palavra');
      if(!naNuvem()){ $('#erro-recuperar').textContent = 'Sem ligação ao servidor. Verifica a internet e tenta outra vez.'; return; }
      const botao = e.target.querySelector('[type=submit]');
      aCarregar(botao, true, 'A verificar…');
      try{
        const r = await Nuvem.recuperar(u.value, c.value, p.value);
        if(r.erro){
          const campo = { utilizador: u, codigo: c, palavra: p }[r.campo];
          if(campo) erroNoCampo(campo, r.erro); else $('#erro-recuperar').textContent = r.erro;
          return;
        }
        $('#entrar-utilizador').value = u.value.trim();
        c.value = ''; p.value = '';
        feito('Palavra-passe alterada.<small>O código que usaste já não serve: depois de entrares, gera outro no perfil. As sessões noutros aparelhos terminaram.</small>', {
          acoes: `<button type="button" class="auth__botao" data-auth="entrar"><span>Entrar com a nova</span></button>`
        });
      }finally{
        aCarregar(botao, false);
      }
    });

    /* ---------- código de recuperação ---------- */
    $('#codigo-confirmo').addEventListener('change', e => { $('#codigo-continuar').disabled = !e.target.checked; });
    $('#codigo-continuar').addEventListener('click', () => {
      $('#codigo-valor').textContent = '';
      fecharAuth();
    });
    $('#codigo-copiar').addEventListener('click', async () => {
      const t = $('#codigo-valor').textContent;
      try{ await navigator.clipboard.writeText(t); $('#codigo-aviso').textContent = 'Copiado. Cola-o num gestor de palavras-passe ou numa nota segura.'; }
      catch(err){ $('#codigo-aviso').textContent = 'Não deu para copiar automaticamente — seleciona o código e copia à mão.'; }
    });
    $('#codigo-guardar').addEventListener('click', () => {
      const t = $('#codigo-valor').textContent;
      const quem = $('#codigo-valor').dataset.nome || '';
      const texto = `Sporting ao Minuto — código de recuperação\n\nNome de utilizador: ${quem}\nCódigo: ${t}\n\n` +
        `Usa-o em "Esqueceste-te da palavra-passe?" para escolher uma palavra-passe nova.\n` +
        `Cada código só serve uma vez. Não o partilhes com ninguém.\n`;
      const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `sporting-ao-minuto-codigo-${quem}.txt` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      $('#codigo-aviso').textContent = 'Ficheiro guardado. Mantém-no num sítio só teu.';
    });

    /* botões da confirmação */
    d.addEventListener('click', async e => {
      if(e.target.closest('[data-auth-fechar-feito]')) fecharAuth();
      if(e.target.closest('[data-feito="gerar"]')){
        const b = e.target.closest('button');
        aCarregar(b, true, 'A gerar…');
        const c = await Nuvem.gerarCodigo();
        aCarregar(b, false);
        if(c.ok) mostrarCodigo(c.codigo, Nuvem.perfil?.utilizador || nome);
        else $('#auth-feito-texto').insertAdjacentHTML('beforeend', `<small>${seguro(c.erro)}</small>`);
      }
    });
    /* fechar sem ter confirmado que guardou o código: pergunta-se */
    d.addEventListener('cancel', e => {
      if(d.dataset.vista === 'codigo' && !$('#codigo-confirmo').checked){
        e.preventDefault();
        $('#codigo-aviso').textContent = 'Confirma que guardaste o código antes de fechar.';
      }
    });
  }

  function mostrarCodigo(codigo, quem){
    const d = dlg();
    if(!d.open) d.showModal();
    $('#auth-offline').hidden = true;
    $('#codigo-valor').textContent = codigo;
    $('#codigo-valor').dataset.nome = quem || '';
    $('#codigo-confirmo').checked = false;
    $('#codigo-continuar').disabled = true;
    $('#codigo-aviso').textContent = '';
    mostrarVista('codigo');
  }

  /* =====================================================================
     Perfil
     ===================================================================== */
  async function abrirPerfil(){
    const d = $('#perfil');
    if(!d) return;
    if(!nome) return abrirAuth('entrar');
    const p = Nuvem.perfil;
    $('#perfil-titulo').textContent = '@' + nome;
    $('#perfil-avatar').textContent = (nome || '?').slice(0, 2);
    $('#perfil-desde').textContent = p?.criado_em
      ? 'Conta criada a ' + new Date(p.criado_em).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' })
      : (naNuvem() ? '' : 'Conta guardada só neste browser');
    $('#mudar-utilizador').value = p?.utilizador || nome;
    limparErros(d);
    $('#form-mudar').hidden = !naNuvem();
    $('#perfil-gerar').closest('.perfil__bloco').hidden = !naNuvem();
    if(!d.open) d.showModal();
    if(naNuvem()) pintarEstadoCodigo();
  }

  async function pintarEstadoCodigo(){
    const alvo = $('#perfil-rec-estado');
    alvo.textContent = 'A verificar…';
    const e = await Nuvem.estadoRecuperacao();
    if(!e){ alvo.textContent = 'Não foi possível saber se tens código (sem ligação?).'; return; }
    if(e.temCodigo){
      alvo.innerHTML = `Tens um código guardado desde <b>${e.criadoEm.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long', year: 'numeric' })}</b>.
        Gerar outro faz o anterior deixar de servir.`;
      $('#perfil-gerar span').textContent = 'Gerar código novo';
    }else{
      alvo.innerHTML = '<b>Ainda não tens código de recuperação.</b> Sem ele, se esqueceres a palavra-passe não há forma de a mudar.';
      $('#perfil-gerar span').textContent = 'Gerar código';
    }
  }

  function ligarPerfil(){
    const d = $('#perfil');
    if(!d) return;
    $('#btn-conta')?.addEventListener('click', abrirPerfil);
    $$('[data-perfil-fechar]').forEach(b => b.addEventListener('click', () => d.close()));
    d.addEventListener('click', e => { if(e.target === d) d.close(); });
    $$('[data-perfil-ir]').forEach(b => b.addEventListener('click', () => { d.close(); opcoes.irPara(b.dataset.perfilIr); }));

    $('#perfil-gerar').addEventListener('click', async () => {
      const b = $('#perfil-gerar');
      $('#erro-perfil-rec').textContent = '';
      aCarregar(b, true, 'A gerar…');
      const c = await Nuvem.gerarCodigo();
      aCarregar(b, false);
      if(!c.ok){ $('#erro-perfil-rec').textContent = c.erro; return; }
      d.close();
      mostrarCodigo(c.codigo, Nuvem.perfil?.utilizador || nome);
    });

    $('#form-mudar').addEventListener('submit', async e => {
      e.preventDefault();
      limparErros(d);
      const atual = $('#mudar-atual'), nova = $('#mudar-nova');
      const b = e.target.querySelector('[type=submit]');
      aCarregar(b, true, 'A guardar…');
      try{
        const r = await Nuvem.mudarPalavra(atual.value, nova.value);
        if(r.erro){
          $('#erro-mudar').textContent = r.erro;
          (r.campo === 'nova' ? nova : atual).setAttribute('aria-invalid', 'true');
          return;
        }
        atual.value = ''; nova.value = '';
        $('#erro-mudar').textContent = '';
        $('#dica-mudar').textContent = 'Palavra-passe alterada.';
        setTimeout(() => { $('#dica-mudar').textContent = 'Pelo menos 8 caracteres.'; }, 4000);
      }finally{
        aCarregar(b, false);
      }
    });

    const sair = async () => {
      d.open && d.close();
      if(naNuvem()) await Nuvem.sair();
      Contas.sair();
      lsSet(CHAVE_VISITANTE, null);
      mudouConta(null);
      opcoes.aoSair();
      /* recomeça limpo: sem restos da sessão em memória */
      location.href = '/';
    };
    $('#perfil-sair').addEventListener('click', sair);
    $('#btn-sair-gaveta')?.addEventListener('click', sair);
  }

  /* =====================================================================
     Pré-visualização na página de boas-vindas (só dados reais)
     ===================================================================== */
  function pintarPrevia({ jogo, ultimo, noticias, fantasy, emblema, nomeProva, quando } = {}){
    const ecra = $('#acesso');
    if(!ecra || ecra.hidden) return;

    if(jogo !== undefined){
      const alvo = $('#pv-jogo .pv__corpo');
      if(!jogo && !ultimo){
        alvo.innerHTML = '<p class="pv__vazio">O calendário ainda está a carregar.</p>';
      }else{
        const eq = (n, lado) => `<span class="pv-jogo__eq">${lado === 'fora' ? `<span>${seguro(n)}</span>` : ''}<img src="${emblema(n)}" alt="" width="28" height="28">${lado === 'casa' ? `<span>${seguro(n)}</span>` : ''}</span>`;
        alvo.innerHTML = (jogo ? `
          <div class="pv-jogo">${eq(jogo.casa, 'casa')}<b class="pv-jogo__meio">${seguro(quando(jogo).hora)}</b>${eq(jogo.fora, 'fora')}</div>
          <p class="pv__meta"><b>${seguro(quando(jogo).dia)}</b> · ${seguro(nomeProva(jogo.comp).completo)}</p>` : '<p class="pv__vazio">Sem jogos marcados no calendário.</p>')
          + (ultimo ? `<p class="pv__linha">Último resultado: ${seguro(ultimo.casa)} ${ultimo.golosCasa}–${ultimo.golosFora} ${seguro(ultimo.fora)}</p>` : '');
        $('#pv-jogo .pv__rotulo').innerHTML = 'Jogos <small>calendário: Wikipédia</small>';
      }
    }
    if(noticias !== undefined){
      const alvo = $('#pv-noticias .pv__corpo');
      alvo.innerHTML = noticias?.length
        ? `<ul class="pv-noticias">${noticias.slice(0, 3).map(n =>
            `<li><span class="sigla ${n.classe || ''}">${seguro(n.sigla)}</span><p>${seguro(n.titulo)}</p></li>`).join('')}</ul>`
        : '<p class="pv__vazio">As notícias aparecem assim que os jornais responderem.</p>';
      if(noticias?.length) $('#pv-noticias .pv__rotulo').innerHTML = `Notícias <small>${noticias.length > 3 ? 'as mais recentes' : ''}</small>`;
    }
    if(fantasy !== undefined){
      const alvo = $('#pv-fantasy .pv__corpo');
      const regras = '<p class="pv__meta">Plantel de 15 · orçamento de 100 M€ · capitão a dobrar · ligas entre amigos</p>';
      alvo.innerHTML = fantasy
        ? `<p class="pv-fantasy__j"><b>Jornada ${fantasy.numero}</b> · ${seguro(fantasy.texto)}</p>${regras}`
        : regras;
    }
  }

  /* =====================================================================
     Arranque
     ===================================================================== */
  function iniciar(o = {}){
    opcoes = { ...opcoes, ...o };
    ligarAuth();
    ligarPerfil();

    nome = quemEsta();
    pintarCabecalho();

    /* a sessão guardada podia estar caducada: aí fica-se como visitante */
    const ecra = $('#acesso');
    if(nome){
      abrirSite(false);
    }else if(ecra && !ecra.hidden){
      $('#entrar-visitante')?.addEventListener('click', () => {
        lsSet(CHAVE_VISITANTE, '1');
        abrirSite(true);
        document.getElementById('vista-inicio')?.focus?.({ preventScroll: true });
      });
    }else{
      abrirSite(false);
    }

    /* sessão que termina ou começa noutro separador */
    if(naNuvem()) Nuvem.aoMudarSessao(p => {
      const novo = p ? (p.nome_mostrado || p.utilizador) : null;
      if(novo !== nome) mudouConta(novo);
    });
  }

  /* para quem precisa de conta (chat, Fantasy): devolve true se pode seguir */
  function exigirConta(motivo, vista){
    if(nome) return true;
    abrirAuth('entrar', motivo, vista);
    return false;
  }

  /* bloco "precisas de conta" para pôr no lugar do conteúdo privado */
  function portao({ titulo, texto, vista }){
    return `<div class="portao">
      <span class="portao__ico" aria-hidden="true"><svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>
      <h3>${seguro(titulo)}</h3><p>${seguro(texto)}</p>
      <div class="portao__acoes">
        <button type="button" class="p1" data-auth="entrar" data-auth-vista="${vista || ''}">Entrar</button>
        <button type="button" class="p2" data-auth="criar" data-auth-vista="${vista || ''}">Criar conta</button>
      </div></div>`;
  }

  return {
    iniciar, abrirAuth, abrirPerfil, exigirConta, portao, pintarPrevia,
    get nome(){ return nome; },
    get comConta(){ return !!nome; }
  };
})();
window.Entrada = Entrada;
