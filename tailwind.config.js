/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Move quality palette used for badges and the eval bar.
        quality: {
          best: '#22c55e',
          excellent: '#34d399',
          good: '#84cc16',
          book: '#a3a3a3',
          inaccuracy: '#eab308',
          mistake: '#f97316',
          blunder: '#ef4444',
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s ease-in-out infinite',
      },
      keyframes: {
        'pulse-ring': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(148, 163, 184, 0.5)' },
          '50%': { boxShadow: '0 0 0 6px rgba(148, 163, 184, 0)' },
        },
      },
    },
  },
  plugins: [],
};
