// CSS imports: esbuild bundles them into dist/index.css; *.module.css become scoped class maps.
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
declare module '*.css';
