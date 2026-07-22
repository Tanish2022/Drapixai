import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        surface: 'var(--surface)',
        elevated: 'var(--elevated)',
        border: 'var(--border-soft)',
        primary: {
          DEFAULT: '#31725b',
          light: '#b8d8c7',
          dark: '#183f32',
        },
        secondary: {
          DEFAULT: '#68736b',
          light: '#eef2ec',
          dark: '#344038',
        },
      },
    },
  },
  plugins: [],
}
export default config
