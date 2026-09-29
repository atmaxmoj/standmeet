// loader —— what `<script src="https://alice.dev/embed.js">` runs on someone else's page: a classic
// script (no bundler, no type="module" needed) that imports the chat itself from the same instance,
// beside it (/embed/embed.js). The chat is an ES module with code splitting, so a host page only
// downloads the heavy parts (diagrams, pre-baked HTML) when an answer carries one.

const script = document.currentScript;
const here = script instanceof HTMLScriptElement && script.src !== '' ? script.src : window.location.href;
void import(new URL('embed/embed.js', here).href);

export {};
