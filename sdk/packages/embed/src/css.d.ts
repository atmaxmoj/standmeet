// The SDK's stylesheet, imported as text (tsup loader) and injected into the shadow root.
declare module '*.css' {
  const text: string;
  export default text;
}
