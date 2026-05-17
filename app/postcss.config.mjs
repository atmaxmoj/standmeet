// Tailwind v4 走 PostCSS 插件（不再用 tailwind.config.js）；
// theme tokens 在 src/app/globals.css 里用 @theme 声明。
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
