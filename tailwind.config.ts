import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'serif'],
        body: ['var(--font-body)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      colors: {
        forest: {
          50: '#f0f7f0',
          100: '#dceddc',
          200: '#bcdabd',
          300: '#8fbf91',
          400: '#5e9e61',
          500: '#3d7f41',
          600: '#2d6331',
          700: '#254f29',
          800: '#1f3f22',
          900: '#1a341d',
        },
        water: {
          50: '#eff9ff',
          100: '#def2ff',
          200: '#b6e8ff',
          300: '#75d8ff',
          400: '#2cc4ff',
          500: '#00a8ef',
          600: '#0085cc',
          700: '#006aa5',
          800: '#005988',
          900: '#064a70',
        },
        sand: {
          50: '#fdf8f0',
          100: '#faeedd',
          200: '#f4d9b5',
          300: '#ebbf82',
          400: '#e09f4d',
          500: '#d4832a',
          600: '#b8691f',
          700: '#98511c',
          800: '#7c411d',
          900: '#67371a',
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.4s ease-out forwards',
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'slide-in': 'slideIn 0.35s ease-out forwards',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
}
export default config
