/* ==========================================================================
   Gentle-Vanguard — Unified Effects Layer (v2.0)
   --------------------------------------------------------------------------
   Shared micro-interactions for ALL presentations. Vanilla JS, no deps.
   - Scroll progress bar (JS fallback para browsers sin animation-timeline)
   - Spotlight hover cards (luz que sigue al cursor)
   - Count-up numbers ([data-count])
   - Tilt 3D cards (.tilt)
   - SVG diagram interactivity (tooltips + highlight linked nodes)
   - Navbar scroll state (.scrolled)
   - IntersectionObserver reveal (.fade-in)
   - Respeto a prefers-reduced-motion
   ========================================================================== */
(function () {
  'use strict';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- 1. Navbar scroll state ------------------------------------------ */
  function initNavbar() {
    var nav = document.querySelector('.nav-blur');
    if (!nav) return;
    var onScroll = function () {
      nav.classList.toggle('scrolled', window.scrollY > 24);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* --- 2. Scroll progress bar (fallback JS) ------------------------------ */
  function initScrollProgress() {
    var bar = document.querySelector('.scroll-progress');
    if (!bar) return;
    var supports = CSS.supports('animation-timeline: scroll(root)');
    if (supports && !REDUCED) return; // CSS nativo se encarga
    if (REDUCED) {
      bar.style.display = 'none';
      return;
    }
    var ticking = false;
    function update() {
      var h = document.documentElement;
      var max = h.scrollHeight - h.clientHeight;
      var p = max > 0 ? h.scrollTop / max : 0;
      bar.style.transform = 'scaleX(' + p + ')';
      bar.style.scale = p + ' 1';
      ticking = false;
    }
    function request() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }
    update();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request, { passive: true });
  }

  /* --- 3. Fade-in reveal ------------------------------------------------ */
  function initReveal() {
    var els = document.querySelectorAll(
      '.fade-in, .slide-in-left, .slide-in-right, .scale-in, .bounce-in',
    );
    if (!els.length) return;
    if (REDUCED) {
      els.forEach(function (el) {
        el.classList.add('visible');
      });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add('visible');
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
    );
    els.forEach(function (el) {
      io.observe(el);
    });
  }

  /* --- 4. Spotlight hover cards ------------------------------------------ */
  function initSpotlight() {
    if (!window.matchMedia('(hover: hover)').matches) return;
    document.querySelectorAll('.section-card, .spotlight').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--sx', e.clientX - r.left + 'px');
        card.style.setProperty('--sy', e.clientY - r.top + 'px');
      });
    });
  }

  /* --- 5. Count-up numbers ------------------------------------------------ */
  function initCountUp() {
    var els = document.querySelectorAll('[data-count]');
    if (!els.length) return;
    if (REDUCED) {
      els.forEach(function (el) {
        el.textContent = Number(el.dataset.count).toLocaleString();
      });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var el = en.target;
          var target = Number(el.dataset.count);
          var suffix = el.dataset.suffix || '';
          var dur = Number(el.dataset.dur || 1300);
          var t0 = performance.now();
          function tick(now) {
            var p = Math.min((now - t0) / dur, 1);
            var eased = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(target * eased).toLocaleString() + suffix;
            if (p < 1) requestAnimationFrame(tick);
            else el.textContent = target.toLocaleString() + suffix;
          }
          requestAnimationFrame(tick);
          io.unobserve(el);
        });
      },
      { threshold: 0.4 },
    );
    els.forEach(function (el) {
      io.observe(el);
    });
  }

  /* --- 6. Tilt 3D cards ---------------------------------------------------- */
  function initTilt() {
    if (REDUCED || !window.matchMedia('(hover: hover)').matches) return;
    document.querySelectorAll('.tilt').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - 0.5;
        var y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform =
          'perspective(900px) rotateY(' +
          (x * 8).toFixed(2) +
          'deg) rotateX(' +
          (-y * 8).toFixed(2) +
          'deg)';
      });
      card.addEventListener('pointerleave', function () {
        card.style.transform = '';
      });
    });
  }

  /* --- 7. SVG diagrams: tooltips + node highlighting ------------------------ */
  function initDiagrams() {
    document.querySelectorAll('.svg-diagram').forEach(function (svg) {
      var tip = document.createElement('div');
      tip.className = 'gv-tooltip';
      tip.setAttribute('aria-hidden', 'true');
      document.body.appendChild(tip);

      var interactive = svg.querySelectorAll('[data-tip], .gv-node[data-group]');
      if (!interactive.length) return;

      interactive.forEach(function (node) {
        node.addEventListener('pointerenter', function () {
          var key = node.dataset.group;
          if (key) {
            // highlight mismo grupo, dim resto
            svg.querySelectorAll('.gv-node').forEach(function (n) {
              n.classList.toggle('highlight', n.dataset.group === key);
              n.classList.toggle('dim', n.dataset.group !== key);
            });
            svg.querySelectorAll('.gv-link').forEach(function (l) {
              var linked = l.dataset.from === key || l.dataset.to === key;
              l.classList.toggle('highlight', linked);
              l.classList.toggle('dim', !linked);
            });
          }
          var t = node.dataset.tip || node.getAttribute('aria-label');
          if (t) {
            tip.textContent = t;
            tip.classList.add('show');
          }
        });
        node.addEventListener('pointermove', function (e) {
          tip.style.left = e.clientX + 14 + 'px';
          tip.style.top = e.clientY + 14 + 'px';
        });
        node.addEventListener('pointerleave', function () {
          tip.classList.remove('show');
          svg.querySelectorAll('.gv-node').forEach(function (n) {
            n.classList.remove('highlight', 'dim');
          });
          svg.querySelectorAll('.gv-link').forEach(function (l) {
            l.classList.remove('highlight', 'dim');
          });
        });
      });
    });
  }

  /* --- 8. Terminal typing effect ------------------------------------------- */
  function initTyping() {
    document.querySelectorAll('[data-type]').forEach(function (el) {
      if (REDUCED) {
        el.textContent = el.dataset.type;
        return;
      }
      var text = el.dataset.type;
      var speed = Number(el.dataset.speed || 28);
      var i = 0;
      var interval = setInterval(function () {
        el.textContent = text.slice(0, ++i);
        if (i >= text.length) clearInterval(interval);
      }, speed);
    });
  }

  /* --- 9. Active nav link highlight on scroll ------------------------------- */
  function initActiveNav() {
    var sections = document.querySelectorAll('section[id], [id].nav-target');
    var links = document.querySelectorAll('.nav-blur a.nav-link[href^="#"]');
    if (!sections.length || !links.length) return;
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            links.forEach(function (l) {
              l.classList.toggle('active', l.getAttribute('href') === '#' + en.target.id);
            });
          }
        });
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    sections.forEach(function (s) {
      io.observe(s);
    });
  }

  /* --- 9b. Diagram modal (click en diagrama → imagen ampliada) --------------- */
  function initDiagramModal() {
    var imgs = document.querySelectorAll('.svg-diagram');
    if (!imgs.length) return;

    // Lightbox con pan/zoom nativo (patrón estándar Google Photos / MapLibre)
    var overlay = document.createElement('div');
    overlay.className = 'gv-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="gv-lightbox-backdrop"></div>' +
      '<div class="gv-lightbox-stage">' +
      '<img class="gv-lightbox-img" alt="" draggable="false" />' +
      '<div class="gv-lightbox-svg" hidden></div>' +
      '</div>' +
      '<div class="gv-lightbox-toolbar">' +
      '<button class="gv-lightbox-btn" data-zoom="out" aria-label="Zoom out">−</button>' +
      '<button class="gv-lightbox-btn" data-zoom="reset" aria-label="Reset zoom">⟲</button>' +
      '<button class="gv-lightbox-btn" data-zoom="in" aria-label="Zoom in">+</button>' +
      '</div>' +
      '<button class="gv-lightbox-close" aria-label="Close">✕</button>' +
      '<div class="gv-lightbox-cap"></div>' +
      '<div class="gv-lightbox-hint">' +
      '<span data-i18n="lbox_hint_wheel">Scroll to zoom</span> · ' +
      '<span data-i18n="lbox_hint_drag">Drag to pan</span> · ' +
      '<span data-i18n="lbox_hint_dbl">Double-click to toggle</span>' +
      '</div>';
    document.body.appendChild(overlay);

    var stage = overlay.querySelector('.gv-lightbox-stage');
    var img = overlay.querySelector('.gv-lightbox-img');
    var svgBox = overlay.querySelector('.gv-lightbox-svg');
    var cap = overlay.querySelector('.gv-lightbox-cap');

    // Estado de pan/zoom
    var scale = 1,
      tx = 0,
      ty = 0;
    var minScale = 0.5,
      maxScale = 12;
    var dragging = false,
      startX = 0,
      startY = 0,
      origTx = 0,
      origTy = 0;
    var moved = false;

    // Hotspots del SVG inline (delegación de eventos)
    svgBox.addEventListener('click', function (e) {
      var hot = e.target.closest ? e.target.closest('.gv-hotspot') : null;
      if (hot && !moved && window.__gvShowInfo) {
        e.preventDefault();
        e.stopPropagation();
        window.__gvShowInfo(hot.getAttribute('data-i18n-title'));
      }
    });

    function clamp(v, lo, hi) {
      return Math.max(lo, Math.min(hi, v));
    }

    // El transform se aplica al elemento activo (img o svg inline)
    function activeEl() {
      return svgBox.hidden ? img : svgBox;
    }

    function apply() {
      activeEl().style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
    }

    function measure() {
      var el = activeEl();
      if (el === img) {
        return { w: img.naturalWidth || img.width || 0, h: img.naturalHeight || img.height || 0 };
      }
      var svg = svgBox.querySelector('svg');
      if (!svg) return { w: 0, h: 0 };
      var vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat);
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { w: vb[2], h: vb[3] };
      var rect = svg.getBoundingClientRect();
      return { w: rect.width || 0, h: rect.height || 0 };
    }

    function fitToStage() {
      var sw = stage.clientWidth,
        sh = stage.clientHeight;
      var m = measure();
      if (!m.w || !m.h) {
        scale = 1;
        tx = 0;
        ty = 0;
        apply();
        return;
      }
      // Ajustar imagen a la vista (sin overflow) y permitir zoom hasta 12x
      scale = Math.min(sw / m.w, sh / m.h, 1);
      minScale = scale * 0.8;
      tx = (sw - m.w * scale) / 2;
      ty = (sh - m.h * scale) / 2;
      apply();
    }

    function zoomAt(px, py, factor) {
      var newScale = clamp(scale * factor, minScale, maxScale);
      var k = newScale / scale;
      // Mantener el punto bajo el cursor fijo (zoom centrado en cursor)
      tx = px - (px - tx) * k;
      ty = py - (py - ty) * k;
      scale = newScale;
      apply();
    }

    function resetZoom() {
      fitToStage();
    }

    function open(el) {
      var src = el.currentSrc || el.src || el.getAttribute('src');
      var alt = el.getAttribute('alt') || '';
      // Resetear transform para evitar parpadeo mientras carga
      activeEl().style.transform = 'none';
      scale = 1;
      tx = 0;
      ty = 0;
      moved = false;
      dragging = false;
      cap.textContent = alt;
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';

      var isSvg = /\.svg(\?|#|$)/.test(src || '');
      if (isSvg) {
        // Cargar inline: permite hotspots interactivos (.gv-hotspot)
        fetch(src)
          .then(function (r) {
            return r.text();
          })
          .then(function (svgText) {
            img.hidden = true;
            svgBox.hidden = false;
            svgBox.innerHTML = svgText;
            // Asegurar que los hotspots con data-i18n-title se abren con el modal
            fitToStage();
          })
          .catch(function () {
            // Fallback a imagen estática si fetch falla (file:// etc.)
            img.hidden = false;
            svgBox.hidden = true;
            img.src = src;
            afterImgLoad();
          });
        return;
      }

      img.hidden = false;
      svgBox.hidden = true;
      img.style.transform = 'none';
      img.src = src;
      afterImgLoad();

      // Ajustar una vez la imagen esté realmente decodificada (funciona también
      // con imágenes cacheadas, donde naturalWidth puede tardar en estar listo).
      function afterImgLoad() {
        function afterLoad() {
          fitToStage();
        }
        if (img.complete && img.naturalWidth > 0) {
          afterLoad();
        } else if (typeof img.decode === 'function') {
          img.decode().then(afterLoad).catch(afterLoad);
        } else {
          img.addEventListener('load', afterLoad, { once: true });
        }
      }
    }

    function close() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    // Click en diagrama → abrir lightbox
    imgs.forEach(function (el) {
      el.style.cursor = 'zoom-in';
      el.addEventListener('click', function () {
        open(el);
      });
    });

    // Cerrar con backdrop (solo si no hubo drag) o botón.
    // El stage ocupa todo el overlay; su área vacía alrededor de la imagen
    // se comporta como backdrop: click ahí cierra, click sobre la imagen no.
    overlay.addEventListener('click', function (e) {
      if (moved) return;
      var t = e.target;
      if (t === overlay || t === stage || t.classList.contains('gv-lightbox-backdrop')) {
        close();
      }
    });
    overlay.querySelector('.gv-lightbox-close').addEventListener('click', close);

    // Rueda → zoom centrado en cursor
    stage.addEventListener(
      'wheel',
      function (e) {
        e.preventDefault();
        var rect = stage.getBoundingClientRect();
        var factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
      },
      { passive: false },
    );

    // Botones +/−/reset
    overlay.querySelectorAll('[data-zoom]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var rect = stage.getBoundingClientRect();
        var cx = rect.left + rect.width / 2,
          cy = rect.top + rect.height / 2;
        if (btn.getAttribute('data-zoom') === 'in') zoomAt(rect.left, rect.top, 1.6);
        else if (btn.getAttribute('data-zoom') === 'out') zoomAt(rect.left, rect.top, 1 / 1.6);
        else resetZoom();
      });
    });

    // Drag → panear
    stage.addEventListener('pointerdown', function (e) {
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      origTx = tx;
      origTy = ty;
      stage.setPointerCapture(e.pointerId);
      stage.style.cursor = 'grabbing';
    });
    stage.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX,
        dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      tx = origTx + dx;
      ty = origTy + dy;
      apply();
    });
    stage.addEventListener('pointerup', function () {
      dragging = false;
      stage.style.cursor = 'grab';
    });
    stage.style.cursor = 'grab';

    // Doble click → alternar zoom 2x / ajustar
    stage.addEventListener('dblclick', function (e) {
      var rect = stage.getBoundingClientRect();
      if (scale > 1.01) resetZoom();
      else zoomAt(e.clientX - rect.left, e.clientY - rect.top, 2.2);
    });

    // ESC → cerrar
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  /* --- 9c. Info modal (click en la "i" → modal con detalle) ---------------------- */
  function initInfoModal() {
    var triggers = document.querySelectorAll('.info-trigger');
    var diagrams = document.querySelectorAll('.svg-diagram');
    // El modal también lo necesitan los hotspots SVG (páginas sin info-trigger)
    if (!triggers.length && !diagrams.length) return;

    var overlay = document.createElement('div');
    overlay.className = 'gv-info-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="gv-info-backdrop"></div>' +
      '<div class="gv-info-box" role="document">' +
      '<button class="gv-info-close" aria-label="Close">✕</button>' +
      '<div class="gv-info-head">' +
      '<span class="gv-info-ico" aria-hidden="true">i</span>' +
      '<div class="gv-info-titles">' +
      '<div class="gv-info-kicker" data-i18n="info_kicker">More information</div>' +
      '<div class="gv-info-title" data-i18n="info_title">About this feature</div>' +
      '</div>' +
      '</div>' +
      '<div class="gv-info-body"></div>' +
      '<div class="gv-info-foot">' +
      '<span data-i18n="info_hint">Press ESC or click outside to close</span>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var box = overlay.querySelector('.gv-info-box');
    var body = overlay.querySelector('.gv-info-body');

    function close() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    function resolveText(trigger) {
      var key = trigger.getAttribute('data-i18n-title');
      if (key) {
        var dict = window.__i18n && window.__i18n.getDict ? window.__i18n.getDict() : null;
        if (dict && dict[key] !== undefined) return dict[key];
      }
      // Fallback: atributo title real (inyectado en el HTML) o aria-label
      return trigger.getAttribute('title') || trigger.getAttribute('aria-label') || '';
    }

    // API global: abre el modal con la clave del diccionario (usada por hotspots SVG)
    window.__gvShowInfo = function (key) {
      var dict = window.__i18n && window.__i18n.getDict ? window.__i18n.getDict() : null;
      var text = dict && dict[key] !== undefined ? dict[key] : key || '';
      body.textContent = text;
      if (window.__i18n && window.__i18n.translate) {
        window.__i18n.translate(window.__i18n.getCurrentLang());
      }
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    };

    triggers.forEach(function (trigger) {
      trigger.style.cursor = 'pointer';
      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        body.textContent = resolveText(trigger);
        // Re-traducir el encabezado al idioma actual
        if (window.__i18n && window.__i18n.translate) {
          window.__i18n.translate(window.__i18n.getCurrentLang());
        }
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
      });
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.classList.contains('gv-info-backdrop')) close();
    });
    overlay.querySelector('.gv-info-close').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });

    // Cerrar al cambiar idioma (el contenido se refresca)
    document.addEventListener('langchange', function () {
      if (overlay.classList.contains('open')) close();
    });
  }

  /* --- 10. Init all ---------------------------------------------------------- */
  function init() {
    initNavbar();
    initScrollProgress();
    initReveal();
    initSpotlight();
    initCountUp();
    initTilt();
    initDiagrams();
    initTyping();
    initActiveNav();
    initDiagramModal();
    initInfoModal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
