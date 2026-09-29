// no-mermaid —— stands in for the mermaid library in the embed bundle (tsup alias). An IIFE cannot
// load a chunk lazily, so the real library (megabytes) would ride along on every host page. A
// diagram in an answer fails to render here, and MermaidBlock shows a visitor nothing for a
// failed diagram, exactly as on the owner's site when mermaid can't parse it.
export default {
  initialize(): void { /* nothing to configure */ },
  render(): Promise<never> {
    return Promise.reject(new Error('diagrams are not rendered in the embed'));
  },
};
