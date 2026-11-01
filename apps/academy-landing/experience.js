// Academy experience — capa de experiencia homologada a la landing corporativa.
// Patrones de corporate-web/public/experience.js adaptados a Academy:
// spotlight en cards, difuminado por scroll (estilo E) y anillo de progreso
// del back-to-top. Respeta prefers-reduced-motion y no redefine tokens.
(() => {
  'use strict';
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const backTop = document.querySelector('#academy-top');

  // === Spotlight: las cards del catálogo siguen el puntero ===
  const precise = matchMedia('(hover:hover) and (pointer:fine)');
  let pointerFrame = false;
  document.addEventListener('pointermove', event => {
    if (!precise.matches || reduced.matches || pointerFrame) return;
    const card = event.target.closest('.catalog-grid .card');
    if (!card) return;
    pointerFrame = true;
    requestAnimationFrame(() => {
      const rect = card.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      card.style.setProperty('--mx', `${x * 100}%`);
      card.style.setProperty('--my', `${y * 100}%`);
      pointerFrame = false;
    });
  }, { passive: true });

  // === Difuminado continuo ligado al scroll (estilo E) ===
  // Nitidez al centro, blur + desvanecido hacia los bordes. Solo bloques de
  // contenido: los fondos y las portadas no participan.
  const scrubBlocksGroups = [
    '.academy-hero-copy',
    '.catalog-intro h2, .catalog-intro p',
    '.catalog-grid .card',
    '.academy-closing p',
    '.academy-footer-meta'
  ];
  var scrubBlocks = [];
  if (!reduced.matches) {
    scrubBlocks = scrubBlocksGroups.flatMap(sel => [...document.querySelectorAll(sel)]);
    scrubBlocks.forEach(el => el.classList.add('gv-scrub'));
  }
  function scrubSet(el, o, b, t) {
    el.style.setProperty('--sc-o', String(o));
    el.style.setProperty('--sc-b', b.toFixed(2) + 'px');
    el.style.setProperty('--sc-t', t.toFixed(1) + 'px');
  }
  function scrubReset() {
    scrubBlocks.forEach(el => {
      el.style.removeProperty('--sc-o');
      el.style.removeProperty('--sc-b');
      el.style.removeProperty('--sc-t');
    });
  }
  function updateScrub() {
    if (!scrubBlocks.length) return;
    const h = window.innerHeight, band = h * 0.14, fade = h * 0.62;
    for (const el of scrubBlocks) {
      const rect = el.getBoundingClientRect();
      if (!rect.height) { scrubSet(el, 1, 0, 0); continue; }
      if (rect.bottom < -140) { scrubSet(el, 0.04, 10, -28); continue; }
      if (rect.top > h + 140) { scrubSet(el, 0.04, 10, 28); continue; }
      const center = rect.top + rect.height / 2;
      const dist = Math.abs(center - h / 2);
      let p = dist <= band ? 1 : Math.max(0, 1 - (dist - band) / fade);
      p = 1 - Math.pow(1 - p, 3);
      const side = center < h / 2 ? -1 : 1;
      scrubSet(el, 0.05 + 0.95 * p, (1 - p) * 9, side * (1 - p) * 26);
    }
  }

  // === Back-to-top: visibilidad + anillo de progreso ===
  function updateBackTop() {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    root.style.setProperty('--page-progress', String(scrollable > 0 ? window.scrollY / scrollable : 0));
  }
  function update() {
    if (!reduced.matches) updateScrub();
    updateBackTop();
  }
  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  }, { passive: true });
  addEventListener('resize', update, { passive: true });
  reduced.addEventListener('change', () => { if (reduced.matches) scrubReset(); });
  update();
})();
