import type { Config } from 'tailwindcss';

/**
 * A deliberately small design system, expressed entirely in CSS variables
 * defined in `globals.css`. Nothing here hard-codes a colour: this file only
 * maps tokens onto utility names, which is what keeps light and dark mode a
 * single definition rather than a `dark:` variant on every component.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: token('canvas'),
        surface: {
          DEFAULT: token('surface'),
          2: token('surface-2'),
        },
        line: {
          DEFAULT: token('line'),
          strong: token('line-strong'),
        },
        ink: {
          DEFAULT: token('ink'),
          2: token('ink-2'),
        },
        muted: token('muted'),
        accent: {
          DEFAULT: token('accent'),
          hover: token('accent-hover'),
          wash: token('accent-wash'),
          ink: token('accent-ink'),
        },
        // Status colours, each with a wash for badge and banner backgrounds.
        success: { DEFAULT: token('success'), wash: token('success-wash') },
        warning: { DEFAULT: token('warning'), wash: token('warning-wash') },
        danger: { DEFAULT: token('danger'), wash: token('danger-wash') },
        info: { DEFAULT: token('info'), wash: token('info-wash') },
        neutral: { DEFAULT: token('neutral'), wash: token('neutral-wash') },
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // A tighter heading scale than Tailwind's default, which is built for
        // marketing pages rather than dense operational screens.
        'display': ['1.75rem', { lineHeight: '2.125rem', letterSpacing: '-0.021em', fontWeight: '650' }],
        'title': ['1.0625rem', { lineHeight: '1.5rem', letterSpacing: '-0.011em' }],
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'slide-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        /* A ring that breathes, for the "still processing" indicator. Softer
           than `animate-pulse`, which flattens to invisible at its trough. */
        breathe: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.85)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        'slide-in': 'slide-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fade-in 200ms ease-out',
        'rise-in': 'rise-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both',
        breathe: 'breathe 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
