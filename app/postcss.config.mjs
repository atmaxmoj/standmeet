// Tailwind v4 goes through the PostCSS plugin (no more tailwind.config.js);
// theme tokens are declared with @theme in src/app/globals.css.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
