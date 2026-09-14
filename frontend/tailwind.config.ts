import type { Config } from 'tailwindcss';

/**
 * A deliberately small design system: one neutral ramp, one accent, and a
 * status colour per document state. Status colours are defined here rather than
 * inline so that a status renders identically in a table row, a tile and a
 * timeline without three copies of the mapping drifting apart.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'slide-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        'slide-in': 'slide-in 160ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
