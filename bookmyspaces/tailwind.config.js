/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#f5f7ff', 100: '#e8edff', 500: '#3b5bdb', 600: '#2f4ac0', 700: '#263d9e', 900: '#172554' },
      },
    },
  },
  plugins: [],
}
