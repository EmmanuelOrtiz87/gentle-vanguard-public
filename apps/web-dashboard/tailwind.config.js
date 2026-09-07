/** @type {import('tailwindcss').Config} */
// LOCAL v2 override (etapa 2, 2026-09-01): the shared adapter
// packages/gv-design-system/src/adapters/tailwind.v3.cjs uses ESM `export const`
// inside a .cjs file, which breaks CommonJS loading (sucrase/postcss pipeline).
// Until the shared package is fixed, the gv-* mappings are inlined here verbatim.
const gvColors = {
  'gv-purple': 'var(--gv-purple)',
  'gv-purple-deep': 'var(--gv-purple-deep)',
  'gv-purple-soft': 'var(--gv-purple-soft)',
  'gv-cyan': 'var(--gv-cyan)',
  'gv-cyan-deep': 'var(--gv-cyan-deep)',
  'gv-cyan-soft': 'var(--gv-cyan-soft)',
  'gv-bg': 'var(--gv-bg)',
  'gv-bg-deep': 'var(--gv-bg-deep)',
  'gv-surface': 'var(--gv-surface)',
  'gv-surface-raised': 'var(--gv-surface-raised)',
  'gv-surface-overlay': 'var(--gv-surface-overlay)',
  'gv-text': 'var(--gv-text)',
  'gv-muted': 'var(--gv-muted)',
  'gv-text-inverse': 'var(--gv-text-inverse)',
  'gv-amber': 'var(--gv-amber)',
  'gv-red': 'var(--gv-red)',
  'gv-green': 'var(--gv-green)',
  'gv-info': 'var(--gv-info)',
  'gv-border': 'var(--gv-border)',
  'gv-border-accent': 'var(--gv-border-accent)',
  'gv-border-accent-strong': 'var(--gv-border-accent-strong)',
  'gv-gradient': 'linear-gradient(135deg, var(--gv-purple) 0%, var(--gv-cyan) 100%)',
  'gv-glow': 'var(--gv-elev-glow)',
};

const gvSpacing = {
  'gv-1': 'var(--gv-space-1)',
  'gv-2': 'var(--gv-space-2)',
  'gv-3': 'var(--gv-space-3)',
  'gv-4': 'var(--gv-space-4)',
  'gv-5': 'var(--gv-space-5)',
  'gv-6': 'var(--gv-space-6)',
  'gv-8': 'var(--gv-space-8)',
  'gv-10': 'var(--gv-space-10)',
  'gv-12': 'var(--gv-space-12)',
  'gv-16': 'var(--gv-space-16)',
  'gv-20': 'var(--gv-space-20)',
  'gv-24': 'var(--gv-space-24)',
};

const gvRadius = {
  'gv-sm': 'var(--gv-radius-sm)',
  'gv-md': 'var(--gv-radius-md)',
  'gv-lg': 'var(--gv-radius-lg)',
  'gv-xl': 'var(--gv-radius-xl)',
  'gv-2xl': 'var(--gv-radius-2xl)',
  'gv-pill': 'var(--gv-radius-pill)',
};

const gvShadow = {
  'gv-sm': 'var(--gv-elev-sm)',
  'gv-md': 'var(--gv-elev-md)',
  'gv-lg': 'var(--gv-elev-lg)',
  'gv-xl': 'var(--gv-elev-xl)',
  'gv-glow': 'var(--gv-elev-glow)',
};

const gvFontFamily = {
  'gv-display': ['var(--gv-font-display)'],
  'gv-body': ['var(--gv-font-body)'],
  'gv-mono': ['var(--gv-font-mono)'],
};

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ...gvColors,
        // Legacy primary kept as alias for migration period
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: 'var(--gv-cyan)',
          600: 'var(--gv-cyan)',
          700: 'var(--gv-cyan-soft)',
        },
        // Dash-* aliases for surface migration
        'dash-surface': 'var(--gv-surface)',
        'dash-surface-raised': 'var(--gv-surface-raised)',
        'dash-text': 'var(--gv-text)',
        'dash-muted': 'var(--gv-muted)',
        'dash-primary': 'var(--gv-cyan)',
        'dash-accent': 'var(--gv-purple)',
      },
      spacing: gvSpacing,
      borderRadius: gvRadius,
      boxShadow: gvShadow,
      fontFamily: gvFontFamily,
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'fade-out': 'fadeOut 0.2s ease-in both',
        'slide-up': 'slideUp 0.32s cubic-bezier(0.2, 0, 0, 1) both',
        'slide-down': 'slideDown 0.32s cubic-bezier(0, 0, 0.2, 1) both',
        'scale-pop': 'scalePop 0.26s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'bounce-slow': 'bounceSlow 0.6s ease-in-out infinite',
        shimmer: 'shimmer 1.4s linear infinite',
        'gv-viewIn': 'gv-viewIn 0.28s ease-out forwards',
        'gv-fadeIn': 'gv-fadeIn 0.2s ease-out forwards',
        'gv-slideUp': 'gv-slideUp 0.28s cubic-bezier(0.4, 0, 0.2, 1) forwards',
        'gv-scaleIn': 'gv-scaleIn 0.15s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scalePop: {
          '0%': { opacity: '0', transform: 'scale(0.6)' },
          '60%': { opacity: '1', transform: 'scale(1.08)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        bounceSlow: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-25%)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'gv-viewIn': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'gv-fadeIn': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'gv-slideUp': {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'gv-scaleIn': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
