/* =========================================================================
   NUVEM — contas, fantasy e chat online (Supabase)
   -------------------------------------------------------------------------
   Ao contrário do js/contas.js (que só guardava no browser), isto é
   partilhado: a tua equipa entra no ranking de toda a gente e o chat é
   o mesmo para todos.

   A chave que está aqui é a PUBLICÁVEL. É suposto estar no browser — quem
   protege os dados são as regras de acesso (RLS) definidas na base de
   dados, não o segredo da chave. Não confundir com a chave da API-Football,
   essa sim privada.
   ========================================================================= */

const Nuvem = (() => {

  const URL_PROJETO = 'https://wuayudgmkbiipwucblvi.supabase.co';
  const CHAVE_PUBLICA = 'sb_publishable_LChLhrz6yKfPHzm89xingA_SkIuaIKB';

  /* O Supabase precisa de um email. Como aqui só se usa nome de utilizador,
     constrói-se um endereço interno a partir dele. Nunca é mostrado. */
  const DOMINIO = 'utilizador.sportingaominuto.pt';
  const emailDe = u => `${u.toLowerCase().trim()}@${DOMINIO}`;

  let cliente = null;
  let ligado = false;
  let perfil = null;          // { id, utilizador, nome_mostrado, criado_em }

  /* ---------------------------------------------------------------------
     "Manter a sessão iniciada"
     Ligado: a sessão fica no localStorage e sobrevive a fechar o browser.
     Desligado: fica no sessionStorage, que morre com o separador. O
     Supabase lê e escreve por este armazém; a escolha é guardada à parte.
     --------------------------------------------------------------------- */
  const CHAVE_LEMBRAR = 'scp-lembrar';
  const lembrarAtivo = () => { try{ return localStorage.getItem(CHAVE_LEMBRAR) !== '0'; }catch(e){ return true; } };
  const armazem = {
    getItem(k){ try{ return sessionStorage.getItem(k) ?? localStorage.getItem(k); }catch(e){ return null; } },
    setItem(k, v){
      try{
        const [usa, limpa] = lembrarAtivo() ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
        usa.setItem(k, v); limpa.removeItem(k);
      }catch(e){}
    },
    removeItem(k){ try{ localStorage.removeItem(k); sessionStorage.removeItem(k); }catch(e){} }
  };
  function guardarSessaoLocal(lembrar){
    try{ localStorage.setItem(CHAVE_LEMBRAR, lembrar === false ? '0' : '1'); }catch(e){}
  }

  /* ---------------------------------------------------------------------
     Arranque
     --------------------------------------------------------------------- */
  const ouvintes = new Set();
  async function iniciar(){
    if(!window.supabase?.createClient){ ligado = false; return false; }
    try{
      cliente = window.supabase.createClient(URL_PROJETO, CHAVE_PUBLICA, {
        auth: { persistSession: true, autoRefreshToken: true, storage: armazem }
      });
      const { data } = await cliente.auth.getSession();
      if(data?.session) await carregarPerfil(data.session.user.id);
      ligado = true;
      /* sessão que expira ou termina noutro separador: quem está a ouvir
         (o cabeçalho, o chat, a Fantasy) fica a saber */
      cliente.auth.onAuthStateChange((evento, sessao) => {
        if(evento === 'SIGNED_OUT' && perfil){ perfil = null; ouvintes.forEach(f => f(null)); }
        else if(evento === 'SIGNED_IN' && sessao && !perfil){
          carregarPerfil(sessao.user.id).then(p => ouvintes.forEach(f => f(p)));
        }
      });
      return true;
    }catch(e){
      ligado = false;
      return false;
    }
  }
  const aoMudarSessao = f => { ouvintes.add(f); return () => ouvintes.delete(f); };

  async function carregarPerfil(id){
    const { data } = await cliente.from('perfis').select('*').eq('id', id).maybeSingle();
    perfil = data || null;
    return perfil;
  }

  /* ---------------------------------------------------------------------
     Contas
     --------------------------------------------------------------------- */
  const REGRA_UTILIZADOR = /^[a-zA-Z0-9._-]{3,20}$/;
  /* contas novas e palavras-passe novas: 8 (as contas antigas, de quando o
     mínimo era 6, continuam a entrar com a que têm) */
  const MINIMO_NOVA = 8;

  function validarUtilizador(utilizador){
    const u = (utilizador || '').trim();
    if(!u) return 'Escreve o teu nome de utilizador.';
    if(!REGRA_UTILIZADOR.test(u))
      return 'Entre 3 e 20 caracteres, só letras, números, ponto, traço ou _.';
    return null;
  }
  function validarNova(palavra){
    if(!palavra) return 'Escreve uma palavra-passe.';
    if(palavra.length < MINIMO_NOVA) return `A palavra-passe tem de ter pelo menos ${MINIMO_NOVA} caracteres.`;
    if(new TextEncoder().encode(palavra).length > 72) return 'A palavra-passe é demasiado longa (máximo 72 caracteres).';
    return null;
  }
  function validar(utilizador, palavra){
    return validarUtilizador(utilizador) || validarNova(palavra);
  }

  /* o nome está livre? usado enquanto se escreve no registo */
  async function nomeLivre(utilizador){
    if(!ligado) return true;
    const { data } = await cliente.from('perfis')
      .select('utilizador').eq('utilizador', (utilizador||'').trim().toLowerCase()).maybeSingle();
    return !data;
  }

  /* devolve { erro, campo } para o formulário saber onde pôr a mensagem */
  async function registar(utilizador, palavra, lembrar = true){
    if(!ligado) return { erro: 'Sem ligação ao servidor. Verifica a internet e tenta outra vez.' };
    const mu = validarUtilizador(utilizador);
    if(mu) return { erro: mu, campo: 'utilizador' };
    const mp = validarNova(palavra);
    if(mp) return { erro: mp, campo: 'palavra' };
    guardarSessaoLocal(lembrar);

    const nome = utilizador.trim();
    const id = nome.toLowerCase();

    try{
      /* o nome já está a ser usado? */
      const { data: existe } = await cliente
        .from('perfis').select('utilizador').eq('utilizador', id).maybeSingle();
      if(existe) return { erro: 'Esse nome de utilizador já está a ser usado. Escolhe outro.', campo: 'utilizador' };

      const { data, error } = await cliente.auth.signUp({
        email: emailDe(id), password: palavra
      });
      if(error){
        if(/already registered|already exists/i.test(error.message))
          return { erro: 'Esse nome de utilizador já está a ser usado. Escolhe outro.', campo: 'utilizador' };
        return { erro: traduzir(error) };
      }
      if(!data.session)
        return { erro: 'A conta foi criada mas o servidor pede confirmação por email, que estas contas não têm. ' +
                       'Avisa o administrador do site.' };

      const { error: erroPerfil } = await cliente.from('perfis')
        .insert({ id: data.user.id, utilizador: id, nome_mostrado: nome });
      if(erroPerfil) return { erro: traduzir(erroPerfil) };

      await carregarPerfil(data.user.id);
      return { ok: true, nome };
    }catch(e){
      return { erro: traduzir(e) };
    }
  }

  async function entrar(utilizador, palavra, lembrar = true){
    if(!ligado) return { erro: 'Sem ligação ao servidor. Verifica a internet e tenta outra vez.' };
    const u = (utilizador || '').trim().toLowerCase();
    if(!u) return { erro: 'Escreve o teu nome de utilizador.', campo: 'utilizador' };
    if(!palavra) return { erro: 'Escreve a tua palavra-passe.', campo: 'palavra' };
    guardarSessaoLocal(lembrar);

    try{
      const { data, error } = await cliente.auth.signInWithPassword({
        email: emailDe(u), password: palavra
      });
      /* a mesma mensagem para nome inexistente e palavra-passe errada:
         não se diz a ninguém que contas existem */
      if(error) return { erro: /invalid login|credentials/i.test(error.message)
        ? 'Nome de utilizador ou palavra-passe errados.' : traduzir(error) };

      await carregarPerfil(data.user.id);
      return { ok: true, nome: perfil?.nome_mostrado || u };
    }catch(e){
      return { erro: traduzir(e) };
    }
  }

  async function sair(){
    try{ if(cliente) await cliente.auth.signOut(); }catch(e){}
    perfil = null;
  }

  /* ---------------------------------------------------------------------
     Recuperação (ver supabase/migrations/20261009180000_contas_recuperacao.sql)
     As contas não têm email: recupera-se com o código guardado.
     --------------------------------------------------------------------- */
  const ERROS_RECUPERAR = {
    codigo_invalido: 'O nome de utilizador ou o código não estão certos.',
    demasiadas_tentativas: 'Demasiadas tentativas falhadas. Espera 15 minutos e tenta outra vez.',
    palavra_curta: `A palavra-passe nova tem de ter pelo menos ${MINIMO_NOVA} caracteres.`,
    palavra_longa: 'A palavra-passe é demasiado longa (máximo 72 caracteres).'
  };
  async function recuperar(utilizador, codigo, nova){
    if(!ligado) return { erro: 'Sem ligação ao servidor. Verifica a internet e tenta outra vez.' };
    const mu = validarUtilizador(utilizador);
    if(mu) return { erro: mu, campo: 'utilizador' };
    const limpo = (codigo || '').replace(/[^A-Za-z0-9]/g, '');
    if(limpo.length !== 16) return { erro: 'O código tem 16 letras e números (XXXX-XXXX-XXXX-XXXX).', campo: 'codigo' };
    const mp = validarNova(nova);
    if(mp) return { erro: mp, campo: 'palavra' };
    try{
      const { data, error } = await cliente.rpc('conta_recuperar', {
        p_utilizador: utilizador.trim(), p_codigo: limpo, p_nova: nova
      });
      if(error) return { erro: traduzir(error) };
      if(data !== 'ok') return { erro: ERROS_RECUPERAR[data] || 'Não foi possível mudar a palavra-passe.' };
      return { ok: true };
    }catch(e){
      return { erro: traduzir(e) };
    }
  }

  async function gerarCodigo(){
    if(!ligado || !perfil) return { erro: 'Entra na tua conta primeiro.' };
    try{
      const { data, error } = await cliente.rpc('conta_gerar_codigo');
      if(error) return { erro: traduzir(error) };
      return { ok: true, codigo: data };
    }catch(e){ return { erro: traduzir(e) }; }
  }

  async function estadoRecuperacao(){
    if(!ligado || !perfil) return null;
    try{
      const { data, error } = await cliente.rpc('conta_estado_recuperacao');
      if(error) return null;
      const r = Array.isArray(data) ? data[0] : data;
      return { temCodigo: !!r?.tem_codigo, criadoEm: r?.criado_em ? new Date(r.criado_em) : null };
    }catch(e){ return null; }
  }

  /* confirma a atual (entrando outra vez com ela) e só depois muda */
  async function mudarPalavra(atual, nova){
    if(!ligado || !perfil) return { erro: 'Entra na tua conta primeiro.' };
    if(!atual) return { erro: 'Escreve a palavra-passe atual.', campo: 'atual' };
    const mp = validarNova(nova);
    if(mp) return { erro: mp, campo: 'nova' };
    if(atual === nova) return { erro: 'A palavra-passe nova tem de ser diferente da atual.', campo: 'nova' };
    try{
      const { error: e1 } = await cliente.auth.signInWithPassword({ email: emailDe(perfil.utilizador), password: atual });
      if(e1) return { erro: /invalid login|credentials/i.test(e1.message) ? 'A palavra-passe atual não está certa.' : traduzir(e1), campo: 'atual' };
      const { error: e2 } = await cliente.auth.updateUser({ password: nova });
      if(e2) return { erro: traduzir(e2) };
      return { ok: true };
    }catch(e){ return { erro: traduzir(e) }; }
  }

  /* mensagens do Supabase e da rede, em português de Portugal */
  function traduzir(e){
    const msg = String(e?.message || e || '');
    if(/failed to fetch|networkerror|load failed|network request failed/i.test(msg))
      return 'Sem ligação ao servidor. Verifica a internet e tenta outra vez.';
    if(/rate limit|too many/i.test(msg)) return 'Demasiadas tentativas. Espera um pouco e tenta outra vez.';
    if(/weak|pwned|leaked/i.test(msg)) return 'Essa palavra-passe é fraca ou já apareceu numa fuga de dados. Escolhe outra.';
    if(/should be at least|password.*characters/i.test(msg)) return `A palavra-passe tem de ter pelo menos ${MINIMO_NOVA} caracteres.`;
    if(/same.*password|different from the old/i.test(msg)) return 'A palavra-passe nova tem de ser diferente da atual.';
    if(/reauthenticat/i.test(msg)) return 'Por segurança, sai e volta a entrar antes de mudares a palavra-passe.';
    if(/invalid/i.test(msg) && /email/i.test(msg)) return 'Nome de utilizador inválido.';
    if(/duplicate key|unique/i.test(msg)) return 'Esse nome de utilizador já está a ser usado. Escolhe outro.';
    if(/jwt|session/i.test(msg)) return 'A sessão expirou. Entra outra vez.';
    return 'Algo correu mal do lado do servidor. Tenta outra vez daqui a pouco.';
  }

  /* ---------------------------------------------------------------------
     Fantasy
     --------------------------------------------------------------------- */
  async function guardarEquipa(equipa){
    if(!ligado || !perfil) return { erro: 'sem sessão' };
    const { error } = await cliente.from('fantasy_equipas').upsert({
      perfil_id: perfil.id,
      desenho: equipa.desenho,
      onze: equipa.onze,
      capitao: equipa.capitao ?? null,
      pontos: equipa.pontos | 0,
      jogadores: equipa.jogadores | 0,
      trancada: !!equipa.trancada,
      jornada: equipa.jornada | 0,
      substituicoes_usadas: equipa.substituicoes | 0,
      atualizado_em: new Date().toISOString()
    });
    return error ? { erro: error.message } : { ok: true };
  }

  async function lerEquipa(){
    if(!ligado || !perfil) return null;
    const { data } = await cliente.from('fantasy_equipas')
      .select('*').eq('perfil_id', perfil.id).maybeSingle();
    if(!data) return null;
    return {
      desenho: data.desenho, onze: data.onze, capitao: data.capitao,
      pontos: data.pontos, jogadores: data.jogadores,
      trancada: data.trancada, jornada: data.jornada,
      substituicoes: data.substituicoes_usadas
    };
  }

  async function ranking(quantos = 10){
    if(!ligado) return [];
    const { data } = await cliente.from('fantasy_equipas')
      .select('pontos, jogadores, desenho, perfis(utilizador, nome_mostrado)')
      .order('pontos', { ascending: false })
      .limit(quantos);
    return (data || []).map(e => ({
      nome: e.perfis?.nome_mostrado || e.perfis?.utilizador || '—',
      utilizador: e.perfis?.utilizador,
      pontos: e.pontos, jogadores: e.jogadores, desenho: e.desenho
    }));
  }

  /* ---------------------------------------------------------------------
     Chat
     --------------------------------------------------------------------- */
  async function lerMensagens(quantas = 60){
    if(!ligado) return [];
    const { data } = await cliente.from('chat_mensagens')
      .select('id, texto, foto_url, jogo, criado_em, perfil_id, autor, perfis(utilizador, nome_mostrado)')
      .order('criado_em', { ascending: false })
      .limit(quantas);
    return (data || []).reverse();
  }

  async function enviarMensagem(texto, fotoUrl, jogo){
    if(!ligado || !perfil) return { erro: 'Entra na tua conta para escrever.' };
    const t = (texto || '').trim();
    if(!t && !fotoUrl) return { erro: 'Escreve alguma coisa ou junta uma fotografia.' };
    if(t.length > 1000) return { erro: 'Mensagem demasiado longa (máximo 1000 caracteres).' };

    /* o nome fica gravado na própria mensagem: se um dia a conta
       desaparecer, o que foi escrito continua a ter dono */
    const { error } = await cliente.from('chat_mensagens').insert({
      perfil_id: perfil.id, autor: perfil.utilizador, texto: t || null,
      foto_url: fotoUrl || null, jogo: jogo || null
    });
    if(error){
      if(/row-level security/i.test(error.message))
        return { erro: 'Estás a escrever depressa de mais. Espera um pouco.' };
      return { erro: error.message };
    }
    return { ok: true };
  }

  async function apagarMensagem(id){
    if(!ligado || !perfil) return { erro: 'sem sessão' };
    const { error } = await cliente.from('chat_mensagens').delete().eq('id', id);
    return error ? { erro: error.message } : { ok: true };
  }

  /* fotografia: vai para a pasta do próprio utilizador */
  async function enviarFoto(ficheiro){
    if(!ligado || !perfil) return { erro: 'Entra na tua conta.' };
    if(!/^image\//.test(ficheiro.type)) return { erro: 'Isso não é uma imagem.' };
    if(ficheiro.size > 5 * 1024 * 1024) return { erro: 'A imagem tem de ter menos de 5 MB.' };

    const extensao = (ficheiro.name.split('.').pop() || 'jpg').toLowerCase().slice(0,4);
    const caminho = `${perfil.id}/${Date.now()}.${extensao}`;

    const { error } = await cliente.storage.from('chat-fotos')
      .upload(caminho, ficheiro, { cacheControl: '3600', upsert: false });
    if(error) return { erro: error.message };

    const { data } = cliente.storage.from('chat-fotos').getPublicUrl(caminho);
    return { ok: true, url: data.publicUrl };
  }

  /* mensagens novas em tempo real */
  function ouvirChat(aoChegar){
    if(!ligado) return () => {};
    const canal = cliente.channel('chat-ao-vivo')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'chat_mensagens' },
          () => aoChegar())
      .subscribe();
    return () => cliente.removeChannel(canal);
  }

  /* ---------------------------------------------------------------------
     Notificações push — guarda a subscrição do browser (ver
     docs/NOTIFICACOES.md; a tabela subscricoes_push ainda não existe)
     --------------------------------------------------------------------- */
  async function guardarSubscricaoPush(sub, tipos){
    if(!cliente) throw new Error('sem ligação');
    const { error } = await cliente.from('subscricoes_push').upsert({
      utilizador: perfil?.id || null,
      endpoint: sub.endpoint, p256dh: sub.keys?.p256dh, auth: sub.keys?.auth,
      tipos, vista_em: new Date().toISOString()
    }, { onConflict: 'endpoint' });
    if(error) throw error;
  }
  async function apagarSubscricaoPush(endpoint){
    if(!cliente) return;
    await cliente.from('subscricoes_push').delete().eq('endpoint', endpoint);
  }

  return {
    iniciar, registar, entrar, sair, validar, validarUtilizador, validarNova, nomeLivre,
    recuperar, gerarCodigo, estadoRecuperacao, mudarPalavra, aoMudarSessao,
    MINIMO_NOVA,
    guardarSubscricaoPush, apagarSubscricaoPush,
    guardarEquipa, lerEquipa, ranking,
    lerMensagens, enviarMensagem, apagarMensagem, enviarFoto, ouvirChat,
    get ligado(){ return ligado; },
    get perfil(){ return perfil; },
    /* o Fantasy (js/fantasy.js) lê e chama as funções do servidor com o
       mesmo cliente — a sessão é a mesma */
    get cliente(){ return ligado ? cliente : null; }
  };
})();
