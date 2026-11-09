// Auditoria de interface do Sporting ao Minuto — para colar no javascript_tool
// da pré-visualização "sporting-hud" (depois de "Continuar como visitante").
//
// Define:
//   window.__auditar()        → audita a vista que está aberta
//   window.__auditarSite(o)   → percorre as vistas nos dois temas e devolve um resumo
//
// Mede: contraste do texto (WCAG AA: 4.5:1, 3:1 em texto grande), alvos de
// toque < 24 px, botões/ligações sem nome, imagens sem alt, largura da página
// maior do que a janela e texto < 12 px (este só informativo: rótulos em
// maiúsculas podem ir a 11 px). Texto semi-transparente ou sobre imagem/gradiente
// fica de fora do contraste (não dá para medir assim) — ver esses à mão.
//
// A última expressão corre a auditoria completa; o resultado é o valor devolvido.

window.__auditar = function () {
  const lum = c => {
    const m = c && c.match(/[\d.]+/g); if (!m) return null;
    const [r, g, b, a = 1] = m.map(Number);
    const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    return { L: .2126 * f(r) + .7152 * f(g) + .0722 * f(b), a };
  };
  // fundo opaco mais próximo; null se houver imagem ou gradiente pelo caminho
  const fundo = el => {
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage !== 'none') return null;
      const c = lum(s.backgroundColor);
      if (c && c.a >= .95) return c;
    }
    return lum(getComputedStyle(document.body).backgroundColor);
  };
  const visivel = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0' &&
      !el.closest('[hidden],[aria-hidden="true"]');
  };
  const id = el => (el.id ? '#' + el.id : el.tagName.toLowerCase()) +
    (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');

  const vista = document.querySelector('.vista.is-on') || document.body;
  const contraste = [], pequeno = [];
  for (const el of vista.querySelectorAll('*')) {
    if (!visivel(el)) continue;
    const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
    if (!txt) continue;
    const s = getComputedStyle(el), tam = parseFloat(s.fontSize);
    if (tam < 12) pequeno.push(id(el) + ' ' + tam + 'px «' + txt.slice(0, 30) + '»');
    const fg = lum(s.color), bg = fundo(el);
    if (!fg || !bg || fg.a * parseFloat(s.opacity || 1) < 1) continue;
    const r = (Math.max(fg.L, bg.L) + .05) / (Math.min(fg.L, bg.L) + .05);
    const grande = tam >= 24 || (tam >= 18.66 && +s.fontWeight >= 700);
    if (r < (grande ? 3 : 4.5)) contraste.push({ el: id(el), txt: txt.slice(0, 35), r: +r.toFixed(2), cor: s.color, tam });
  }

  const alvos = [], semNome = [];
  for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, summary, [role=button], [tabindex="0"]')) {
    if (!visivel(el)) continue;
    const r = el.getBoundingClientRect();
    // ligações dentro de texto corrido estão isentas da regra dos 24 px
    if ((r.width < 24 || r.height < 24) && !el.closest('p')) {
      alvos.push(id(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) +
        ' «' + (el.textContent.trim() || el.getAttribute('aria-label') || '').slice(0, 20) + '»');
    }
    const nome = (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.textContent ||
      el.title || el.value || el.querySelector('img[alt]')?.alt || '').trim();
    const comRotulo = (el.tagName === 'INPUT' || el.tagName === 'SELECT') &&
      (el.labels?.length || el.getAttribute('aria-label') || el.placeholder);
    if (!nome && !comRotulo) semNome.push(id(el));
  }
  const semAlt = [...document.querySelectorAll('img')]
    .filter(i => visivel(i) && !i.hasAttribute('alt')).map(i => i.src.split('/').pop().slice(0, 40));

  return {
    vista: vista.id, larguraDoc: document.documentElement.scrollWidth, janela: innerWidth,
    nContraste: contraste.length, contraste: contraste.sort((a, b) => a.r - b.r).slice(0, 15),
    nPequeno: pequeno.length, pequeno: pequeno.slice(0, 10),
    nAlvos: alvos.length, alvos: alvos.slice(0, 12),
    semNome: semNome.slice(0, 8), semAlt: semAlt.slice(0, 6),
  };
};

window.__auditarSite = async function (opcoes = {}) {
  const espera = ms => new Promise(r => setTimeout(r, ms));
  // as vistas que existem no index.html (sem as de contas, que pedem sessão)
  const vistas = opcoes.vistas || [...document.querySelectorAll('main.vista[id^="vista-"]')]
    .map(m => m.id.slice(6)).filter(v => !/^(conta|entrar|admin|gestao)/.test(v));
  const temas = opcoes.temas || ['escuro', 'claro'];
  const lentas = new Set(['formacao', 'quiz', 'clube', 'fantasy', 'museu', 'arquivo']); // módulos carregados a pedido
  if (typeof window.irParaVista !== 'function') return { erro: 'irParaVista não existe — o site acabou de carregar? passa o ecrã de boas-vindas' };

  const temaAntes = document.documentElement.dataset.tema;
  const vistaAntes = (document.querySelector('.vista.is-on') || {}).id;
  const resumo = { janela: innerWidth, temas: {} };
  for (const tema of temas) {
    document.documentElement.dataset.tema = tema;
    const porVista = {};
    for (const v of vistas) {
      window.irParaVista(v);
      await espera(lentas.has(v) ? 3500 : 1300);
      const a = window.__auditar();
      if (a.vista !== 'vista-' + v) { porVista[v] = { nota: 'não abriu (' + a.vista + ')' }; continue; }
      const r = {};
      if (a.larguraDoc > a.janela) r.largura = a.larguraDoc + 'px > ' + a.janela + 'px';
      if (a.nContraste) r.contraste = a.contraste.slice(0, 5).map(c => `${c.el} «${c.txt}» ${c.r}:1 (${c.cor}, ${c.tam}px)`);
      if (a.nAlvos) r.alvos = a.alvos.slice(0, 5);
      if (a.semNome.length) r.semNome = a.semNome.slice(0, 3);
      if (a.semAlt.length) r.semAlt = a.semAlt.slice(0, 3);
      r.textoPequeno = a.nPequeno;
      porVista[v] = r;
    }
    const falhas = Object.values(porVista).filter(r => r.largura || r.contraste || r.alvos || r.semNome || r.semAlt).length;
    resumo.temas[tema] = { vistasComFalhas: falhas, porVista };
  }
  if (temaAntes) document.documentElement.dataset.tema = temaAntes; else delete document.documentElement.dataset.tema;
  if (vistaAntes) window.irParaVista(vistaAntes.slice(6));
  return resumo;
};

// A volta completa (≈17 vistas × 2 temas) demora mais de um minuto, mais do
// que o javascript_tool espera: corre em segundo plano e o resultado fica em
// window.__auditoria. Ler depois com `window.__auditoria` (null = ainda a correr).
window.__auditoria = null;
window.__auditarSite().then(r => { window.__auditoria = r; }, e => { window.__auditoria = { erro: String(e) }; });
'a correr — ler window.__auditoria daqui a ~90 s';
