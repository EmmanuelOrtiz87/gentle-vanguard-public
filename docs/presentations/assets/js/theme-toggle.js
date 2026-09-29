/* ==========================================================================
   Gentle-Vanguard — Light/Dark Mode Toggle (HOMOLOGADO con las apps)
   --------------------------------------------------------------------------
   Patrón canónico del stack (command-center / academy-web):
   - Storage key: gv-cc-theme (compartida con TODAS las apps)
   - Atributo: data-theme en <html> (no data-bs-theme)
   - Botón: .gv-icon-btn.gv-theme-toggle con SVGs .theme-sun / .theme-moon
   - Soporte prefers-color-scheme cuando no hay preferencia guardada
   - Sin inyección automática de botón (el topbar canónico ya lo incluye)
   ========================================================================== */

(function () {
  'use strict';

  const STORAGE_KEY = 'gv-cc-theme';
  const THEME_ATTR = 'data-theme';

  function getSavedTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function setSavedTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* localStorage no disponible (file:// o modo restringido) */
    }
  }

  function applyTheme(theme) {
    const html = document.documentElement;
    html.setAttribute(THEME_ATTR, theme);
    updateToggleButton(theme);
    document.dispatchEvent(
      new CustomEvent('themechange', { detail: { theme }, bubbles: true }),
    );
  }

  function updateToggleButton(theme) {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const sun = btn.querySelector('.theme-sun');
    const moon = btn.querySelector('.theme-moon');
    const isDark = theme === 'dark';
    if (sun) sun.hidden = !isDark;
    if (moon) moon.hidden = isDark;
    btn.setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    btn.setAttribute('title', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute(THEME_ATTR) || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setSavedTheme(next);
  }

  function initTheme() {
    const saved = getSavedTheme();
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const effective = saved || (systemDark ? 'dark' : 'light');
    applyTheme(effective);

    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', toggleTheme);

    // Si el usuario no eligió manualmente, seguir al sistema
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!getSavedTheme()) applyTheme(e.matches ? 'dark' : 'light');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }

  // API global (compatible con la anterior)
  window.GentleVanguardTheme = {
    getTheme: () => document.documentElement.getAttribute(THEME_ATTR) || 'dark',
    setTheme: (theme) => {
      if (theme !== 'light' && theme !== 'dark') return;
      applyTheme(theme);
      setSavedTheme(theme);
    },
    toggle: toggleTheme,
    reset: () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {
        /* ignore */
      }
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(systemDark ? 'dark' : 'light');
    },
  };
})();