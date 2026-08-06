/* =========================================================================
   ARTE VETORIAL
   -------------------------------------------------------------------------
   EMBLEMA_SVG   — desenhado em código, no estilo do símbolo que enviaste:
                   escudo a traço branco com o leão e "SCP" por cima.
                   Se puseres o TEU ficheiro em img/crest.png, é esse que
                   aparece — este fica só como reserva.
   avatarJogador — retrato de reserva para quem não tiver fotografia.
   ========================================================================= */

const EMBLEMA_SVG = `
<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sporting CP">
  <!-- SCP -->
  <text x="60" y="34" text-anchor="middle" fill="#ffffff"
        font-family="Barlow Condensed, Arial Narrow, sans-serif"
        font-size="34" font-weight="700" letter-spacing="1">SCP</text>

  <!-- escudo -->
  <path d="M60 48c-11-5-24-5-33-1v10c0 4-3 7-7 8v33c0 19 17 32 40 40 23-8 40-21 40-40V65c-4-1-7-4-7-8V47c-9-4-22-4-33 1z"
        fill="none" stroke="#ffffff" stroke-width="6" stroke-linejoin="round"/>

  <!-- leão rampante, silhueta simples -->
  <g fill="#ffffff">
    <path d="M63 63c6 0 11 4 12 10l5 3-5 3 3 5-5 1v5l-5-3-3 5-3-5-5 3v-5l-5-1 3-5-5-3 5-3c1-6 6-10 12-10z"/>
    <path d="M55 84c-4 5-6 12-5 19l3 15h6l-3-14 6 12 5-2-4-12 9 11 4-4-9-11 6-3-8-9z"/>
    <path d="M74 86l9-2 3 6-8 2z"/>
  </g>
  <circle cx="66" cy="70" r="2" fill="#0a7d4a"/>
</svg>`;

/* -------------------------------------------------------------------------
   Retrato de reserva (só para quem não tiver fotografia da API)
   ------------------------------------------------------------------------- */
const PELES   = ['#f2cba3','#e3ac7d','#c98a52','#9c6035','#6f4126','#4e2d1b'];
const CABELOS = ['#12100e','#2b1d12','#4a2c14','#7a4a1c','#101010','#3b2314'];

function somaNome(nome){
  let h = 0;
  for(const c of nome) h = (h*31 + c.charCodeAt(0)) >>> 0;
  return h;
}

function avatarJogador(p){
  const h = somaNome(p.nome || '?');
  const t = Object.assign({
    pele:   PELES[h % PELES.length],
    cabelo: CABELOS[(h >> 3) % CABELOS.length],
    estilo: (h >> 6) % 4,
    barba:  ((h >> 9) % 3) === 0
  }, p.visual || {});

  const gr = p.posGrupo === 'GR';
  const kit   = gr ? '#1d4d6b' : '#0a7d4a';
  const barra = gr ? '#3b8fbd' : '#ffffff';

  const cabelo = {
    0: `<path d="M74 46c0-16 12-26 26-26s26 10 26 26c-6-8-15-11-26-11s-20 3-26 11z" fill="${t.cabelo}"/>`,
    1: `<g fill="${t.cabelo}"><circle cx="82" cy="42" r="11"/><circle cx="100" cy="35" r="12"/>
        <circle cx="118" cy="42" r="11"/><circle cx="91" cy="32" r="9"/><circle cx="109" cy="32" r="9"/></g>`,
    2: `<path d="M74 48c0-17 12-28 26-28s26 11 26 28c-5-9-15-12-26-12s-21 3-26 12z" fill="${t.cabelo}"/>
        <circle cx="100" cy="22" r="10" fill="${t.cabelo}"/>`,
    3: `<path d="M76 44c2-13 12-21 24-21s22 8 24 21c-7-5-15-7-24-7s-17 2-24 7z" fill="${t.cabelo}" opacity=".5"/>`
  }[t.estilo];

  const barba = t.barba
    ? `<path d="M78 64c2 16 10 25 22 25s20-9 22-25c-4 10-12 15-22 15s-18-5-22-15z" fill="${t.cabelo}" opacity=".85"/>`
    : '';

  return `data:image/svg+xml;charset=utf-8,` + encodeURIComponent(`
<svg viewBox="0 0 200 200" width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="200" fill="#16181a"/>
  <path d="M56 200c0-26 20-44 44-44s44 18 44 44z" fill="${kit}"/>
  <rect x="56" y="168" width="88" height="10" fill="${barra}" opacity=".9"/>
  <rect x="86" y="76" width="28" height="26" fill="${t.pele}"/>
  <ellipse cx="100" cy="54" rx="27" ry="30" fill="${t.pele}"/>
  <ellipse cx="91" cy="52" rx="2.6" ry="3" fill="#1a1a1a"/>
  <ellipse cx="109" cy="52" rx="2.6" ry="3" fill="#1a1a1a"/>
  <path d="M92 68c3 4 13 4 16 0" stroke="#1a1a1a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  ${barba}${cabelo}
</svg>`);
}

/* -------------------------------------------------------------------------
   CAMISOLA — usada no campo da aba FORMAÇÃO
   ------------------------------------------------------------------------- */
function camisolaSVG(numero, tipo){
  const cores = {
    campo:  { corpo:'#0a7d4a', barra:'#ffffff', gola:'#ffffff', num:'#ffffff', linha:'#05502f' },
    gr:     { corpo:'#f2c14e', barra:'#e0ad2e', gola:'#2b2b2b', num:'#2b2b2b', linha:'#c99a1f' },
    suplente:{ corpo:'#1c2b24', barra:'#2f6b4d', gola:'#9fe3bd', num:'#9fe3bd', linha:'#12201a' }
  }[tipo || 'campo'];

  return `
<svg viewBox="0 0 100 92" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <clipPath id="c${tipo || 'campo'}${numero}">
      <path d="M32 10 L14 18 L6 40 L20 46 L20 88 h60 V46 l14-6 -8-22 -18-8 -9 8 -9 0z"/>
    </clipPath>
  </defs>
  <path d="M32 10 L14 18 L6 40 L20 46 L20 88 h60 V46 l14-6 -8-22 -18-8 -9 8 -9 0z"
        fill="${cores.corpo}" stroke="${cores.linha}" stroke-width="2.5" stroke-linejoin="round"/>
  <g clip-path="url(#c${tipo || 'campo'}${numero})" opacity=".95">
    <rect x="0" y="30" width="100" height="9" fill="${cores.barra}"/>
    <rect x="0" y="54" width="100" height="9" fill="${cores.barra}"/>
  </g>
  <path d="M41 10 q9 11 18 0" fill="none" stroke="${cores.gola}" stroke-width="5" stroke-linecap="round"/>
  <text x="50" y="72" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif"
        font-size="42" font-weight="700" fill="${cores.num}">${numero ?? ''}</text>
</svg>`;
}

/* emblema de equipa em falta: círculo com as iniciais */
function escudoIniciais(nome){
  const ini = nome.replace(/^(FC|SC|SL|CD|CF|GD)\s+/i,'')
                  .split(/\s+/).map(p => p[0]).join('').slice(0,3).toUpperCase();
  return `data:image/svg+xml;charset=utf-8,` + encodeURIComponent(`
<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
  <circle cx="20" cy="20" r="18" fill="#1c2620" stroke="#2f6b4d" stroke-width="2"/>
  <text x="20" y="25" text-anchor="middle" font-family="Arial,sans-serif"
        font-size="13" font-weight="700" fill="#9fe3bd">${ini}</text>
</svg>`);
}
