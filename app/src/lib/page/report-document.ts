// report-document —— wrap an AI-generated report HTML fragment in a full,
// StandMeet-styled document for the /report/[id] iframe. The fragment itself
// carries no CSS (the summarize prompt forbids <style>/<script>), so without
// this it renders in browser-default Times New Roman. Here we give it the design
// language: warm cream paper, ink + vermillion, Newsreader serif body, and
// JetBrains Mono uppercase section kickers — matching the rest of the product.
//
// The iframe stays sandboxed (allow-same-origin, no allow-scripts), so this
// trusted <style> is injected while any script in the fragment is inert.

const REPORT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=JetBrains+Mono:wght@400;500&display=swap');
:root{
  --paper:#F3EFE6; --ink:#1B1814; --accent:#B5391C;
  --muted:#6B6256; --rule:#DAD3C4;
}
*{box-sizing:border-box;}
html,body{margin:0;}
body{
  background:var(--paper); color:var(--ink);
  font-family:'Newsreader',Georgia,serif;
  font-size:17px; line-height:1.65;
  padding:56px 32px 80px; max-width:48em; margin:0 auto;
  -webkit-font-smoothing:antialiased;
}
h1{
  font-family:'Newsreader',Georgia,serif;
  font-size:30px; font-weight:500; line-height:1.2;
  letter-spacing:-0.012em; margin:0 0 .2em;
}
h1+*{margin-top:1.4em;}
h2{
  font-family:'JetBrains Mono',ui-monospace,monospace;
  font-size:11px; font-weight:500; text-transform:uppercase;
  letter-spacing:0.18em; color:var(--accent);
  margin:2.2em 0 .9em; padding-top:.9em;
  border-top:1px solid var(--rule);
}
h3{font-family:'Newsreader',Georgia,serif;font-size:19px;font-weight:500;margin:1.6em 0 .5em;}
p{margin:0 0 1em;}
ul,ol{padding-left:1.15em;margin:0 0 1em;}
li{margin:.4em 0;}
strong{font-weight:600;color:var(--ink);}
em{font-style:italic;}
a{color:var(--accent);text-underline-offset:2px;}
blockquote{
  border-left:2px solid var(--accent); margin:1.2em 0; padding:.2em 0 .2em 1.1em;
  color:var(--muted); font-style:italic;
}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:15px;}
th,td{border:1px solid var(--rule);padding:.4em .7em;text-align:left;}
th{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;
  text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);}

/* ── report component kit (the AI composes these; never authors its own CSS) ── */
.lede{font-size:20px;line-height:1.5;color:var(--ink);margin:0 0 1.5em;}
.callout{border-left:2px solid var(--accent);background:rgba(181,57,28,.05);
  padding:.9em 1.1em;margin:1.3em 0;}
.callout :last-child{margin-bottom:0;}
ul.checks{list-style:none;padding-left:0;margin:0 0 1em;}
ul.checks li{position:relative;padding-left:1.5em;margin:.5em 0;}
ul.checks li::before{content:"\\2192";position:absolute;left:0;color:var(--accent);
  font-family:'JetBrains Mono',ui-monospace,monospace;}
.tags{display:flex;flex-wrap:wrap;gap:.4em;margin:.4em 0 1.4em;}
.tag{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;
  text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);
  border:1px solid var(--rule);padding:.2em .6em;}
.kv{display:flex;gap:1em;padding:.4em 0;border-bottom:1px solid var(--rule);}
.kv .k{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;
  text-transform:uppercase;letter-spacing:0.12em;color:var(--muted);min-width:9em;}
.kv .v{flex:1;}

/* STAR block — strong per-experience structure (Situation/Task/Action/Result),
   a labelled two-column grid with row dividers, not loose bullets. */
.exp{margin:.4em 0 2em;}
.star{margin:.6em 0 0;}
.star-row{display:grid;grid-template-columns:7.5em 1fr;gap:1.2em;align-items:start;
  padding:.65em 0;border-bottom:1px solid var(--rule);}
.star-row:first-child{border-top:1px solid var(--rule);}
.star-k{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;font-weight:500;
  text-transform:uppercase;letter-spacing:0.14em;color:var(--accent);padding-top:.25em;}
.star-v{margin:0;}
`;

// reportDocument —— report html → full styled HTML document for the iframe. Idempotent: a report
// generated after the unified-render change is ALREADY a self-contained styled document (the backend
// wraps it at generation so the inline card, /report page, and PDF all render the identical artifact)
// — pass it through untouched. Only a legacy bare fragment (pre-change, stored without <style>) gets
// wrapped here with the same design language. REPORT_CSS is kept solely for that legacy fallback and
// can be dropped once old reports age out.
export function reportDocument(html: string): string {
  const t = html.trimStart().toLowerCase();
  if (t.startsWith('<!doctype') || t.startsWith('<html')) return html;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<style>${REPORT_CSS}</style></head><body>${html}</body></html>`;
}
