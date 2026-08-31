/* ==========================================================================
   Gentle-Vanguard — Light/Dark Mode Toggle with System Preference Support
   Version: 1.0.0
   --------------------------------------------------------------------------
   Features:
   - System preference detection
   - Manual toggle with persistence
   - Smooth transitions between modes
   - Accessibility compliant
   - Respects prefers-color-scheme
   ========================================================================== */

(function () {
  'use strict';

  const STORAGE_KEY = 'gv-theme-preference';
  const THEME_ATTRIBUTE = 'data-bs-theme';

  /**
   * Initialize theme system
   */
  function initTheme() {
    // Check for saved preference or system preference
    const savedTheme = localStorage.getItem(STORAGE_KEY);
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // Default to dark, but respect system if no saved preference
    const effectiveTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');

    // Apply theme
    applyTheme(effectiveTheme);

    // Setup toggle button if present
    setupToggleButton();

    // Listen for system changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  /**
   * Apply theme to document
   * @param {string} theme - 'light' or 'dark'
   */
  function applyTheme(theme) {
    const html = document.documentElement;
    const body = document.body;

    // Set attribute for Bootstrap
    html.setAttribute(THEME_ATTRIBUTE, theme);

    // Add class for custom CSS
    html.classList.remove('light-mode', 'dark-mode');
    html.classList.add(`${theme}-mode`);

    // Optional: Update CSS custom properties for smooth transitions
    updateCSSVariables(theme);

    // Update toggle button appearance if exists
    updateToggleButton(theme);

    // Fire custom event for other components
    document.dispatchEvent(
      new CustomEvent('themechange', {
        detail: { theme },
        bubbles: true,
      }),
    );

    // Log for debugging
    console.log(`[Theme] Applied ${theme} mode`);
  }

  /**
   * Update CSS variables based on theme
   * @param {string} theme - 'light' or 'dark'
   */
  function updateCSSVariables(theme) {
    const isDark = theme === 'dark';

    // These would be defined in your CSS
    const colors = isDark
      ? {
          '--bg': 'oklch(0.17 0.03 262)',
          '--bg2': 'oklch(0.19 0.03 262)',
          '--card': 'oklch(0.22 0.03 262)',
          '--text': '#e2e8f0',
          '--text-dim': '#94a3b8',
          '--text-faint': '#64748b',
          '--br': 'oklch(0.3 0.03 262)',
          '--br-soft': 'color-mix(in oklab, white 8%, transparent)',
        }
      : {
          '--bg': '#f8fafc',
          '--bg2': '#f1f5f9',
          '--card': '#ffffff',
          '--text': '#1e293b',
          '--text-dim': '#64748b',
          '--text-faint': '#94a3b8',
          '--br': '#e2e8f0',
          '--br-soft': 'color-mix(in oklab, black 8%, transparent)',
        };

    // Apply CSS variables
    const root = document.documentElement;
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
  }

  /**
   * Setup theme toggle button
   */
  function setupToggleButton() {
    const toggleBtn = document.getElementById('theme-toggle');
    if (!toggleBtn) {
      createToggleButton();
      return;
    }

    // Create button from a template placeholder if a page provides one.
    if (toggleBtn.tagName === 'TEMPLATE') {
      createToggleButton();
      return;
    }

    toggleBtn.addEventListener('click', toggleTheme);

    // Set initial state
    const currentTheme = document.documentElement.getAttribute(THEME_ATTRIBUTE) || 'dark';
    updateToggleButton(currentTheme);
  }

  /**
   * Create theme toggle button programmatically
   */
  function createToggleButton() {
    // Find insertion point (usually navbar)
    const nav = document.querySelector('.navbar-nav');
    if (!nav) return;

    const li = document.createElement('li');
    li.className = 'nav-item ms-2';

    li.innerHTML = `
      <button id="theme-toggle" 
              class="btn btn-sm nav-link d-flex align-items-center gap-2"
              aria-label="Toggle dark mode"
              title="Toggle dark/light mode">
        <i class="bi bi-moon-fill" id="theme-icon"></i>
        <span class="d-none d-md-inline small">Theme</span>
      </button>
    `;

    nav.appendChild(li);

    // Add event listener
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', toggleTheme);
      updateToggleButton(document.documentElement.getAttribute(THEME_ATTRIBUTE) || 'dark');
    }
  }

  /**
   * Toggle between light and dark themes
   */
  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute(THEME_ATTRIBUTE) || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    applyTheme(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);

    // Announce for screen readers
    announce(`Switched to ${newTheme} mode`);
  }

  /**
   * Update toggle button appearance
   * @param {string} theme - current theme
   */
  function updateToggleButton(theme) {
    const btn = document.getElementById('theme-toggle');
    const icon = document.getElementById('theme-icon');

    if (!btn || !icon) return;

    const isDark = theme === 'dark';

    // Update icon
    icon.className = isDark ? 'bi bi-moon-fill' : 'bi bi-sun-fill';

    // Update color
    icon.style.color = isDark ? 'var(--p)' : '#fbbf24';

    // Update label
    btn.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} mode`);
  }

  /**
   * Announce theme change to screen readers
   * @param {string} message
   */
  function announce(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.className = 'sr-only';
    announcement.style.cssText = `
      position: absolute;
      left: -10000px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    `;
    announcement.textContent = message;

    document.body.appendChild(announcement);
    setTimeout(() => document.body.removeChild(announcement), 1000);
  }

  /**
   * Get current theme preference
   * @returns {string} 'light' or 'dark'
   */
  function getCurrentTheme() {
    return document.documentElement.getAttribute(THEME_ATTRIBUTE) || 'dark';
  }

  /**
   * Set theme preference (exposed API)
   * @param {string} theme - 'light' or 'dark'
   */
  function setTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') {
      console.error(`[Theme] Invalid theme: ${theme}`);
      return;
    }

    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }

  /**
   * Reset to system preference
   */
  function resetToSystem() {
    localStorage.removeItem(STORAGE_KEY);
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(systemPrefersDark ? 'dark' : 'light');
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }

  // Expose API globally
  window.GentleVanguardTheme = {
    getTheme: getCurrentTheme,
    setTheme: setTheme,
    toggle: toggleTheme,
    reset: resetToSystem,
  };

  console.log('[Theme] Module loaded. Use GentleVanguardTheme.toggle() to switch modes.');
})();
