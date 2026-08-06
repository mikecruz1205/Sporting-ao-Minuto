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

  const dataCurta = d =>
    d.toLocaleDateString('pt-PT',{day:'2-digit',month:'short'}).toUpperCase().replace('.','');

  const horaCurta = d =>
    d.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'});

  /* resumo cortado a meio de uma palavra fica feio */
  function resumir(texto, maximo = 150){
    const t = String(texto || '').trim();
    if(t.length <= maximo) return t;
    const corte = t.slice(0, maximo);
    return corte.slice(0, corte.lastIndexOf(' ')) + '…';
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
  function hero(n, destaque = ''){
    if(!n) return esqueletoHero();
    return `
    <article class="hero">
      <a class="hero__ligacao" href="#noticia/${encodeURIComponent(n.link)}" data-link="${seguro(n.link)}">
        <div class="hero__foto">
          ${n.imagem ? `<img src="${seguro(n.imagem)}" alt="" fetchpriority="high" decoding="async">` : ''}
        </div>
        <div class="hero__veu"></div>
        <div class="hero__txt">
          <div class="hero__meta">
            <span class="etiqueta etiqueta--${categoriaClasse(n.categoria)}">${seguro(n.categoria)}</span>
            <span>${seguro(n.fonte)}</span>
            <time datetime="${n.data.toISOString()}">${haQuanto(n.data)}</time>
          </div>
          <h2 class="hero__titulo">${destacar(n.titulo, destaque)}</h2>
          ${n.resumo ? `<p class="hero__resumo">${destacar(resumir(n.resumo, 190), destaque)}</p>` : ''}
          <span class="botao botao--principal">Ler notícia <i aria-hidden="true">→</i></span>
        </div>
      </a>
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

  const esqueletoHero = () => `
    <div class="hero hero--osso" aria-hidden="true"><div class="osso osso--hero"></div></div>`;

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
    cartaoNoticia, hero, itemCompacto, categoriaClasse,
    esqueletoCartao, esqueletoHero, esqueletoCompacto, vazio
  };
})();
