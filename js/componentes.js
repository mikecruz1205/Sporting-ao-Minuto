/* =========================================================================
   COMPONENTES REUTILIZÁVEIS
   -------------------------------------------------------------------------
   Peças de interface que aparecem em mais do que um sítio. Cada uma recebe
   dados e devolve HTML — não toca no DOM nem sabe onde vai ser usada.

   Quem desenha é o app.js; aqui só se constrói.
   ========================================================================= */

const Componentes = (() => {

  /* ---------------------------------------------------------------------
     Utilitários
     --------------------------------------------------------------------- */

  /* escapa texto que vai para dentro de HTML */
  const seguro = t => String(t ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');

  /* destaca os termos procurados dentro de um texto */
  function destacar(texto, termo){
    const limpo = seguro(texto);
    if(!termo) return limpo;

    const semAcento = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    const alvo = semAcento(limpo);
    const busca = semAcento(termo.trim());
    if(!busca) return limpo;

    let saida = '', i = 0;
    let pos = alvo.indexOf(busca);
    while(pos !== -1){
      saida += limpo.slice(i, pos)
             + '<mark class="achado">' + limpo.slice(pos, pos + busca.length) + '</mark>';
      i = pos + busca.length;
      pos = alvo.indexOf(busca, i);
    }
    return saida + limpo.slice(i);
  }

  /* "há 5 min", "ontem", … */
  function haQuanto(d){
    const s = Math.floor((Date.now() - d.getTime())/1000);
    if(s < 60)     return 'agora mesmo';
    if(s < 3600)   return `há ${Math.floor(s/60)} min`;
    if(s < 86400)  return `há ${Math.floor(s/3600)} h`;
    if(s < 172800) return 'ontem';
    return `há ${Math.floor(s/86400)} dias`;
  }

  const MESES = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  const dataCurta = d => `${String(d.getDate()).padStart(2,'0')} ${MESES[d.getMonth()]}`;

  const horaCurta = d =>
    d.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});

  /* Muitos feeds dão a miniatura em vez da imagem grande. Vários jornais
     guardam o tamanho no próprio endereço, por isso vale a pena pedir a
     versão maior — se não existir, o onerror do <img> trata do resto. */
  function imagemGrande(url){
    if(!url) return url;

    /* Casas que põem a largura no próprio caminho. São regras à medida
       porque trocar um número qualquer do endereço parte imagens boas. */
    if(/img\.iol\.pt/i.test(url))                       // .../id/abc123/250
      return url.replace(/\/\d{2,4}(\/?)$/, '/1200$1');
    if(/noticiasaominuto\.com/i.test(url))              // .../640/naom_x.webp
      return url.replace(/\/\d{3,4}\/(naom_)/i, '/1200/$1');
    if(/(sicnoticias|expresso)\.pt/i.test(url))
      return url.replace(/\/\d{3,4}x\d{3,4}\//, '/1200x675/');

    return url
      /* .../imagem-300x200.jpg → .../imagem.jpg */
      .replace(/-\d{2,4}x\d{2,4}(\.[a-z]{3,4})(\?|$)/i, '$1$2')
      /* ?w=300&h=200 ou ?width=300 → pede-se maior */
      .replace(/([?&])(w|width)=\d+/i, '$1$2=1200')
      .replace(/([?&])(h|height)=\d+/i, '$1$2=675')
      /* /thumbs/ ou /thumb/ → /  */
      .replace(/\/thumb(s)?\//i, '/')
      /* resize=300x200 */
      .replace(/resize=\d+x\d+/i, 'resize=1200x675');
  }

  /* resumo cortado a meio de uma palavra fica feio */
  function resumir(texto, maximo = 150){
    const t = String(texto || '').trim();
    if(t.length <= maximo) return t;
    const corte = t.slice(0, maximo);
    return corte.slice(0, corte.lastIndexOf(' ')) + '…';
  }

  /* Imagem de uma notícia, com capa da marca por baixo. Se a fotografia
     não existir ou falhar, fica a capa (listas verdes + emblema), que é
     da casa e não parece um buraco. */
  /* botão de partilhar — fica fora do <a> (botão dentro de link não é válido) */
  const botaoPartilhar = n => /^https?:\/\//i.test(n.link || '') ? `
    <button type="button" class="partilhar" data-partilhar="${seguro(n.link)}" data-titulo="${seguro(n.titulo)}" aria-label="Partilhar: ${seguro(n.titulo)}">
      <svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>
    </button>` : '';

  /* os links vêm dos feeds: só http(s) chega a um href */
  const ligacao = u => /^https?:\/\//i.test(u || '') ? seguro(u) : '#';

  function capa(n, { grande = false, prioridade = false } = {}){
    const src = n.imagem ? (grande ? imagemGrande(n.imagem) : n.imagem) : '';
    const reserva = n.imagem ? seguro(n.imagem) : '';
    return `
      <div class="capa ${n.imagem ? '' : 'capa--vazia'}">
        <span class="capa__marca" aria-hidden="true"></span>
        ${src ? `<img src="${seguro(src)}" alt="" decoding="async"
             ${prioridade ? 'fetchpriority="high"' : 'loading="lazy"'}
             onerror="if('${reserva}'&&this.src!=='${reserva}'){this.src='${reserva}'}else{this.closest('.capa').classList.add('capa--vazia')}">` : ''}
      </div>`;
  }

  /* ---------------------------------------------------------------------
     CARTÃO EDITORIAL — a página inicial
     variante: 'principal' (grande) · 'secundaria' · 'curta'
     --------------------------------------------------------------------- */
  function cartaoEditorial(n, variante = 'curta', destaque = ''){
    const tamanhoResumo = { principal: 220, secundaria: 0, curta: 0 }[variante];
    const resumo = tamanhoResumo ? destacar(resumir(n.resumo, tamanhoResumo), destaque) : '';
    /* uma principal sem fotografia não fica com um bloco vazio enorme:
       passa a cartão tipográfico, com o título grande sobre as listas */
    const tipografico = variante === 'principal' && !n.imagem;
    /* sem fotografia não se inventa uma: o cartão fica só com texto */
    const semFoto = !n.imagem && !tipografico;
    return `
    <article class="ed ed--${variante} ${tipografico ? 'ed--tipografico sempre-escuro' : ''} ${semFoto ? 'ed--sem-foto' : ''}">
      <a class="ed__ligacao" href="${ligacao(n.link)}" target="_blank" rel="noopener"
         data-link="${seguro(n.link)}">
        ${n.imagem ? capa(n, { grande: variante === 'principal' }) : ''}
        <div class="ed__corpo">
          <div class="ed__meta">
            <span class="etiqueta etiqueta--${categoriaClasse(n.categoria)}">${seguro(n.categoria)}</span>
            <time datetime="${n.data.toISOString()}">${haQuanto(n.data)}</time>
          </div>
          <h3 class="ed__titulo">${destacar(n.titulo, destaque)}</h3>
          ${resumo ? `<p class="ed__resumo">${resumo}</p>` : ''}
          <span class="ed__fonte">${seguro(n.fonte)}</span>
        </div>
      </a>
      ${variante === 'principal' ? botaoPartilhar(n) : ''}
    </article>`;
  }

  /* ---------------------------------------------------------------------
     FONTE — a cor e a sigla de cada jornal
     A cor vem da classe f-<canal> (editorial.css). Serve para reconhecer
     a fonte de relance e dar cara às notícias sem fotografia; não são as
     cores oficiais das marcas.
     --------------------------------------------------------------------- */
  const SIGLAS = { leonino:'L', record:'R', mf:'MF', nam:'NM', zz:'zz', rtp:'RTP',
                   obs:'O', bnr:'BR', f365:'365', cm:'CM', publico:'P', abola:'AB' };
  const classeFonte = n => SIGLAS[n.canal] ? 'f-' + n.canal : 'f-outra';
  const sigla = n => SIGLAS[n.canal] ||
    String(n.fonte || '?').trim().split(/\s+/).map(p => p[0]).join('').slice(0, 3).toUpperCase();
  /* bolinha com a cor do jornal e o nome */
  const etiquetaFonte = n =>
    `<span class="fonte-tag ${classeFonte(n)}"><i aria-hidden="true"></i>${seguro(n.fonte)}</span>`;
  /* a sigla num quadrado com a cor do jornal */
  const siglaFonte = (n, extra = '') =>
    `<span class="sigla ${classeFonte(n)} ${extra}" aria-hidden="true">${seguro(sigla(n))}</span>`;

  /* ---------------------------------------------------------------------
     NOTÍCIA EM CARTÃO — vista Notícias, Mercado e Formação
     imagem (ou a sigla do jornal) · categoria · título · resumo ·
     jornal com a sua cor · hora discreta
     grande: imagem em cima, larga — a primeira com foto de cada dia
     agrupado: a lista já tem o dia no cabeçalho, chega a hora
     --------------------------------------------------------------------- */
  const RECENTE_MIN = 45;   // até quantos minutos uma notícia leva "Novo"
  function itemLista(n, destaque = '', { grande = false, agrupado = false } = {}){
    const minutos = (Date.now() - n.data.getTime()) / 60000;
    const recente = minutos >= 0 && minutos < RECENTE_MIN;
    const hoje = n.data.toDateString() === new Date().toDateString();
    const hora = minutos >= 0 && minutos < 60 ? haQuanto(n.data)
               : (hoje || agrupado) ? horaCurta(n.data) : dataCurta(n.data);
    const comFoto = !!n.imagem;
    const resumo = resumir(n.resumo, grande ? 220 : 180);
    return `
    <li class="nl ${grande && comFoto ? 'nl--grande' : ''} ${comFoto ? '' : 'nl--sem-foto'} ${recente ? 'nl--recente' : ''}">
      <a class="nl__ligacao" href="${ligacao(n.link)}" target="_blank" rel="noopener" data-link="${seguro(n.link)}">
        <span class="nl__capa">${comFoto ? capa(n, { grande }) : siglaFonte(n, 'sigla--capa')}</span>
        <span class="nl__corpo">
          <span class="nl__meta">
            <span class="etiqueta etiqueta--${categoriaClasse(n.categoria)}">${seguro(n.categoria)}</span>
            ${recente ? '<span class="nl__novo">Novo</span>' : ''}
          </span>
          <span class="nl__titulo">${destacar(n.titulo, destaque)}</span>
          ${resumo ? `<span class="nl__resumo">${destacar(resumo, destaque)}</span>` : ''}
          <span class="nl__rodape">
            ${etiquetaFonte(n)}
            <time datetime="${n.data.toISOString()}" title="${seguro(n.data.toLocaleString('pt-PT'))}">${hora}</time>
          </span>
        </span>
      </a>
    </li>`;
  }

  /* manchete numa lista: hora, título e jornal — para as que não têm foto */
  function manchete(n, destaque = ''){
    return `
    <li class="manchete">
      <a href="${ligacao(n.link)}" target="_blank" rel="noopener" data-link="${seguro(n.link)}" class="manchete__ligacao">
        <time datetime="${n.data.toISOString()}">${n.data.toDateString() === new Date().toDateString() ? horaCurta(n.data) : dataCurta(n.data)}</time>
        <span class="manchete__corpo">
          <span class="manchete__titulo ed__titulo">${destacar(n.titulo, destaque)}</span>
          <span class="manchete__meta"><i class="manchete__cat manchete__cat--${categoriaClasse(n.categoria)}" aria-hidden="true"></i>${seguro(n.categoria)} · <span class="ed__fonte">${seguro(n.fonte)}</span></span>
        </span>
      </a>
    </li>`;
  }

  /* ---------------------------------------------------------------------
     CARTÃO DE NOTÍCIA
     modo: 'lista' (imagem à esquerda) · 'grelha' (imagem em cima)
     --------------------------------------------------------------------- */
  function cartaoNoticia(n, opcoes = {}){
    const { modo = 'lista', destaque = '', semImagem = false } = opcoes;
    const titulo = destacar(n.titulo, destaque);
    const resumo = destacar(resumir(n.resumo, modo === 'grelha' ? 110 : 150), destaque);

    const imagem = semImagem ? '' : `
      <div class="ncartao__foto">
        ${n.imagem
          ? `<img src="${seguro(n.imagem)}" alt="" loading="lazy" decoding="async"
                  onerror="this.closest('.ncartao__foto').classList.add('sem-foto')">`
          : ''}
        <span class="ncartao__sem">SCP</span>
      </div>`;

    return `
    <article class="ncartao ncartao--${modo}">
      <a class="ncartao__ligacao" href="#noticia/${encodeURIComponent(n.link)}"
         data-link="${seguro(n.link)}" aria-label="${seguro(n.titulo)}">
        ${imagem}
        <div class="ncartao__corpo">
          <div class="ncartao__meta">
            <span class="etiqueta etiqueta--${categoriaClasse(n.categoria)}">${seguro(n.categoria)}</span>
            <span class="ncartao__fonte">${seguro(n.fonte)}</span>
            <time datetime="${n.data.toISOString()}">${haQuanto(n.data)}</time>
          </div>
          <h3 class="ncartao__titulo">${titulo}</h3>
          ${resumo ? `<p class="ncartao__resumo">${resumo}</p>` : ''}
          <span class="ncartao__ler">Ler mais <i aria-hidden="true">→</i></span>
        </div>
      </a>
    </article>`;
  }

  const categoriaClasse = c => ({
    'MERCADO':'mercado', 'FORMAÇÃO':'formacao', 'DESTAQUE':'destaque',
    'FEMININO':'feminino', 'MODALIDADES':'modalidades'
  })[c] || 'equipa';

  /* ---------------------------------------------------------------------
     HERO — a notícia principal
     --------------------------------------------------------------------- */
  function hero(n, destaque = '', ordem = 0){
    if(!n) return esqueletoHero();
    return `
    <article class="hero">
      <a class="hero__ligacao" href="${ligacao(n.link)}" target="_blank" rel="noopener" data-link="${seguro(n.link)}">
        <div class="hero__foto">
          ${n.imagem ? `<img src="${seguro(imagemGrande(n.imagem))}" alt=""
                 ${ordem === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"
                 onerror="if(this.src!=='${seguro(n.imagem)}'){this.src='${seguro(n.imagem)}'}else{this.closest('.hero__foto').classList.add('sem-foto')}"
                 onload="if(this.naturalWidth<520)this.closest('.hero__foto').classList.add('sem-foto')">` : ''}
        </div>
        <div class="hero__veu"></div>
        <div class="hero__txt">
          <div class="hero__meta">
            <span class="etiqueta etiqueta--${categoriaClasse(n.categoria)}">${seguro(n.categoria)}</span>
            <span class="hero__fonte">${seguro(n.fonte)}</span>
            <time datetime="${n.data.toISOString()}">${haQuanto(n.data)}</time>
          </div>
          <h2 class="hero__titulo">${destacar(n.titulo, destaque)}</h2>
          ${n.resumo ? `<p class="hero__resumo">${destacar(resumir(n.resumo, 200), destaque)}</p>` : ''}
          <span class="botao botao--hero">Ler notícia
            <svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </span>
        </div>
      </a>
      ${botaoPartilhar(n)}
    </article>`;
  }

  /* ---------------------------------------------------------------------
     LISTA COMPACTA — "Mais lidas", widgets da barra lateral
     --------------------------------------------------------------------- */
  function itemCompacto(n, indice = null){
    return `
    <li class="compacto">
      <a href="#noticia/${encodeURIComponent(n.link)}" data-link="${seguro(n.link)}">
        ${indice !== null ? `<span class="compacto__n">${indice}</span>` : ''}
        <span class="compacto__txt">
          <b>${seguro(n.titulo)}</b>
          <span>${seguro(n.fonte)} · ${haQuanto(n.data)}</span>
        </span>
      </a>
    </li>`;
  }

  /* ---------------------------------------------------------------------
     ESQUELETOS
     --------------------------------------------------------------------- */
  const esqueletoCartao = (quantos = 4) => Array.from({length:quantos}, () => `
    <div class="esqueleto-cartao" aria-hidden="true">
      <div class="osso osso--imagem"></div>
      <div class="esqueleto-cartao__txt">
        <div class="osso osso--linha osso--curto"></div>
        <div class="osso osso--titulo"></div>
        <div class="osso osso--linha"></div>
        <div class="osso osso--linha osso--curto"></div>
      </div>
    </div>`).join('');

  const esqueletoEditorial = () => `
    <div class="editorial__topo" aria-hidden="true">
      <div class="osso ed-osso ed-osso--principal"></div>
      <div class="editorial__lado">
        ${'<div class="osso ed-osso"></div>'.repeat(3)}
      </div>
    </div>`;

  const esqueletoHero = () => `
    <div class="hero hero--osso" aria-hidden="true"><div class="osso osso--hero"></div></div>`;

  /* cartões de notícia a carregar — o mesmo desenho do cartão final */
  const esqueletoLista = (quantos = 4) => Array.from({length:quantos}, () => `
    <li class="nl nl--osso" aria-hidden="true">
      <span class="nl__ligacao">
        <span class="nl__capa"><span class="osso"></span></span>
        <span class="nl__corpo">
          <span class="osso osso--linha osso--curto"></span>
          <span class="osso osso--titulo"></span>
          <span class="osso osso--titulo osso--curto"></span>
          <span class="osso osso--linha osso--curto"></span>
        </span>
      </span>
    </li>`).join('');

  /* atualizações do ao minuto a carregar: hora, marcador e duas linhas */
  const esqueletoMinuto = (quantos = 5) => Array.from({length:quantos}, () => `
    <li class="ev ev--osso" aria-hidden="true">
      <span class="ev__ligacao">
        <span class="ev__hora"><span class="osso"></span></span>
        <span class="ev__marca"><span class="osso ev__sigla"></span><i class="ev__linha"></i></span>
        <span class="ev__txt">
          <span class="osso osso--titulo"></span>
          <span class="osso osso--titulo osso--curto"></span>
          <span class="osso osso--linha osso--curto"></span>
        </span>
      </span>
    </li>`).join('');

  /* nenhum jornal respondeu: diz porquê e deixa tentar outra vez */
  const erroLeitura = (semLigacao = false, tag = 'li') => `
    <${tag} class="estado estado--erro" role="alert">
      <span class="estado__icone" aria-hidden="true">
        <svg class="icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${semLigacao
          ? '<path d="M2 8.8a15 15 0 0 1 4.2-2.6M9.6 5.3A15 15 0 0 1 22 8.8M5 12.9a10 10 0 0 1 5.2-2.7M14.9 10.6A10 10 0 0 1 19 12.9M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M2 2l20 20"/>'
          : '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/>'}</svg>
      </span>
      <p class="estado__titulo">${semLigacao ? 'Sem ligação à internet' : 'Não foi possível ler os jornais'}</p>
      <p class="estado__texto">${semLigacao
        ? 'Quando a ligação voltar, as notícias aparecem sozinhas.'
        : 'Os jornais não responderam desta vez. Tenta outra vez daqui a pouco.'}</p>
      <button type="button" class="botao-largo botao-largo--fantasma" data-repetir-leitura>Tentar outra vez</button>
    </${tag}>`;

  const esqueletoCompacto = (quantos = 5) => Array.from({length:quantos}, () => `
    <li class="compacto" aria-hidden="true">
      <div style="display:flex;gap:.75rem;width:100%;padding:.5rem 0">
        <div class="osso osso--redondo" style="width:22px;height:22px"></div>
        <div style="flex:1">
          <div class="osso osso--linha"></div>
          <div class="osso osso--linha osso--curto"></div>
        </div>
      </div>
    </li>`).join('');

  /* ---------------------------------------------------------------------
     ESTADO VAZIO
     --------------------------------------------------------------------- */
  const vazio = (titulo, texto, icone = '○') => `
    <div class="estado-vazio">
      <div class="estado-vazio__icone" aria-hidden="true">${icone}</div>
      <p class="estado-vazio__titulo">${seguro(titulo)}</p>
      ${texto ? `<p class="estado-vazio__texto">${texto}</p>` : ''}
    </div>`;

  return {
    seguro, destacar, haQuanto, dataCurta, horaCurta, resumir,
    cartaoNoticia, cartaoEditorial, manchete, itemLista, capa, hero, itemCompacto, categoriaClasse, imagemGrande,
    esqueletoCartao, esqueletoEditorial, esqueletoHero, esqueletoCompacto, esqueletoLista, esqueletoMinuto, erroLeitura, vazio,
    etiquetaFonte, siglaFonte, sigla, classeFonte
  };
})();
