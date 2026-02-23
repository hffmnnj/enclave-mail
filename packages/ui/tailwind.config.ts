import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: 'hsl(var(--color-background) / <alpha-value>)',
          alt: 'hsl(var(--color-background-alt) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'hsl(var(--color-surface) / <alpha-value>)',
          raised: 'hsl(var(--color-surface-raised) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--color-primary) / <alpha-value>)',
          muted: 'hsl(var(--color-primary-muted) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--color-secondary) / <alpha-value>)',
          muted: 'hsl(var(--color-secondary-muted) / <alpha-value>)',
        },
        'text-primary': 'hsl(var(--color-text-primary) / <alpha-value>)',
        'text-secondary': 'hsl(var(--color-text-secondary) / <alpha-value>)',
        success: 'hsl(var(--color-success) / <alpha-value>)',
        danger: 'hsl(var(--color-danger) / <alpha-value>)',
        border: 'hsl(var(--color-border) / <alpha-value>)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'ui-xs': ['11px', { lineHeight: '1.5', letterSpacing: '0.01em' }],
        'ui-sm': ['12px', { lineHeight: '1.5' }],
        'ui-base': ['13px', { lineHeight: '1.5' }],
        'ui-md': ['14px', { lineHeight: '1.5' }],
        'ui-lg': ['16px', { lineHeight: '1.4' }],
      },
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '4px',
        md: '4px',
        lg: '6px',
        xl: '6px',
        full: '9999px',
      },
      boxShadow: {
        none: 'none',
        modal: '0 8px 32px rgba(0, 0, 0, 0.5)',
        'modal-light': '0 8px 32px rgba(0, 0, 0, 0.15)',
      },
      transitionDuration: {
        fast: '100ms',
        DEFAULT: '150ms',
        slow: '200ms',
      },
      borderWidth: {
        px: '1px',
      },
      ringColor: {
        DEFAULT: 'hsl(var(--color-primary) / 1)',
      },
      ringOffsetWidth: {
        DEFAULT: '2px',
      },
    },
  },
  plugins: [animate],
};

export default config;
