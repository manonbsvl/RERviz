/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        sand: {
          50: '#faf8f3',
          100: '#f3edd8',
          200: '#e8dcb8',
          300: '#d9c48a',
          400: '#c9a85c',
          500: '#b8913a',
        },
        sage: {
          50: '#f4f7f4',
          100: '#e2ebe2',
          200: '#c4d6c4',
          300: '#97b897',
          400: '#6a9a6a',
          500: '#4d7d4d',
          600: '#3a6b3a',
        },
      },
    },
  },
  plugins: [],
};
