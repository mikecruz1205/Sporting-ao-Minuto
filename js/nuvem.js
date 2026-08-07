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
  let perfil = null;          // { id, utilizador, nome_mostrado }

  /* ---------------------------------------------------------------------
     Arranque
     --------------------------------------------------------------------- */
  async function iniciar(){
    if(!window.supabase?.createClient){ ligado = false; return false; }
    try{
      cliente = window.supabase.createClient(URL_PROJETO, CHAVE_PUBLICA, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      const { data } = await cliente.auth.getSession();
      if(data?.session) await carregarPerfil(data.session.user.id);
      ligado = true;
      return true;
    }catch(e){
      ligado = false;
      return false;
    }
  }

  /* Com "manter a sessão iniciada" desligado, a sessão fica só na memória
     do separador: fecha o separador, acabou. */
  let sessaoPersistente = true;
  function guardarSessaoLocal(lembrar){
    sessaoPersistente = lembrar !== false;
    if(!sessaoPersistente){
      addEventListener('beforeunload', () => {
        try{ Object.keys(localStorage)
          .filter(k => k.startsWith('sb-') && k.includes('auth-token'))
          .forEach(k => localStorage.removeItem(k)); }catch(e){}
      });
    }
  }

  async function carregarPerfil(id){
    const { data } = await cliente.from('perfis').select('*').eq('id', id).maybeSingle();
    perfil = data || null;
    return perfil;
  }

  /* ---------------------------------------------------------------------
     Contas
     --------------------------------------------------------------------- */
  const REGRA_UTILIZADOR = /^[a-zA-Z0-9._-]{3,20}$/;

  function validar(utilizador, palavra){
    const u = (utilizador || '').trim();
    if(!u) return 'Escreve um nome de utilizador.';
    if(!REGRA_UTILIZADOR.test(u))
      return 'Entre 3 e 20 caracteres, só letras, números, ponto, traço ou underscore.';
    if(!palavra) return 'Escreve uma palavra-passe.';
    if(palavra.length < 6) return 'A palavra-passe tem de ter pelo menos 6 caracteres.';
    return null;
  }

  /* o nome está livre? usado enquanto se escreve no registo */
  async function nomeLivre(utilizador){
    if(!ligado) return true;
    const { data } = await cliente.from('perfis')
      .select('utilizador').eq('utilizador', (utilizador||'').trim().toLowerCase()).maybeSingle();
    return !data;
  }

  async function registar(utilizador, palavra){
    if(!ligado) return { erro: 'Sem ligação ao servidor.' };
    const mau = validar(utilizador, palavra);
    if(mau) return { erro: mau };

    const nome = utilizador.trim();
    const id = nome.toLowerCase();

    /* o nome já está a ser usado? */
    const { data: existe } = await cliente
      .from('perfis').select('utilizador').eq('utilizador', id).maybeSingle();
    if(existe) return { erro: 'Esse nome de utilizador já está a ser usado. Escolhe outro.' };

    const { data, error } = await cliente.auth.signUp({
      email: emailDe(id), password: palavra
    });
    if(error){
      if(/already registered/i.test(error.message))
        return { erro: 'Esse nome de utilizador já está a ser usado. Escolhe outro.' };
      return { erro: traduzir(error.message) };
    }
    if(!data.session)
      return { erro: 'A conta foi criada mas falta confirmar o email. ' +
                     'Desliga a confirmação de email nas definições do Supabase.' };

    const { error: erroPerfil } = await cliente.from('perfis')
      .insert({ id: data.user.id, utilizador: id, nome_mostrado: nome });
    if(erroPerfil) return { erro: traduzir(erroPerfil.message) };

    await carregarPerfil(data.user.id);
    return { ok: true, nome };
  }

  async function entrar(utilizador, palavra, lembrar = true){
    if(!ligado) return { erro: 'Sem ligação ao servidor.' };
    guardarSessaoLocal(lembrar);
    const u = (utilizador || '').trim().toLowerCase();
    if(!u || !palavra) return { erro: 'Preenche os dois campos.' };

    const { data, error } = await cliente.auth.signInWithPassword({
      email: emailDe(u), password: palavra
    });
    if(error) return { erro: 'Utilizador ou palavra-passe errados.' };

    await carregarPerfil(data.user.id);
    return { ok: true, nome: perfil?.nome_mostrado || u };
  }

  async function sair(){
    if(cliente) await cliente.auth.signOut();
    perfil = null;
  }

  function traduzir(msg){
    if(/password/i.test(msg) && /6/.test(msg)) return 'A palavra-passe tem de ter pelo menos 6 caracteres.';
    if(/invalid/i.test(msg) && /email/i.test(msg)) return 'Nome de utilizador inválido.';
    if(/rate limit/i.test(msg)) return 'Demasiadas tentativas. Espera um pouco.';
    return msg;
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
      .select('id, texto, foto_url, jogo, criado_em, perfil_id, perfis(utilizador, nome_mostrado)')
      .order('criado_em', { ascending: false })
      .limit(quantas);
    return (data || []).reverse();
  }

  async function enviarMensagem(texto, fotoUrl, jogo){
    if(!ligado || !perfil) return { erro: 'Entra na tua conta para escrever.' };
    const t = (texto || '').trim();
    if(!t && !fotoUrl) return { erro: 'Escreve alguma coisa ou junta uma fotografia.' };
    if(t.length > 1000) return { erro: 'Mensagem demasiado longa (máximo 1000 caracteres).' };

    const { error } = await cliente.from('chat_mensagens').insert({
      perfil_id: perfil.id, texto: t || null,
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

  return {
    iniciar, registar, entrar, sair, validar, nomeLivre,
    guardarEquipa, lerEquipa, ranking,
    lerMensagens, enviarMensagem, apagarMensagem, enviarFoto, ouvirChat,
    get ligado(){ return ligado; },
    get perfil(){ return perfil; }
  };
})();
