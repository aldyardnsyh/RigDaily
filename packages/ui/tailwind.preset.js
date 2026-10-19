/** @type {import('tailwindcss').Config} Preset - jangan edit hex di sini, semua dari tokens.css */
module.exports = {
  theme: {
    extend: {
      colors: {
        app: 'var(--bg-app)',
        surface: 'var(--bg-surface)',
        surface2: 'var(--bg-surface-2)',
        sidebar: {
          DEFAULT: 'var(--bg-sidebar)',
          active: 'var(--bg-sidebar-active)',
        },
        navy: {
          DEFAULT: 'var(--bg-sidebar)',
          hover: 'var(--bg-sidebar-active)',
        },
        teal: {
          DEFAULT: 'var(--accent-teal)',
          hover: 'var(--accent-teal-hover)',
        },
        ink: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        card: 'var(--radius-card)',
        input: 'var(--radius-input)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
      },
      height: {
        control: 'var(--control-h)',
        'control-lg': 'var(--control-h-lg)',
        topbar: 'var(--topbar-h)',
      },
      width: {
        sidebar: 'var(--sidebar-w)',
      },
      maxWidth: {
        content: 'var(--content-max)',
      },
    },
  },
  plugins: [],
};
