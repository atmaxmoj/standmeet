// mermaid-render.ts —— mermaid source to SVG, through Pele (github.com/obsidianmd/pele).
// Split out into a .ts file so MermaidBlock.tsx carries no try/catch / if
// branches (the presentation layer only reads state).
//
// Pele is synchronous, has no dependencies and is one file, so it ships inside MermaidBlock's lazy
// chunk: a page that never shows a diagram never downloads it. (mermaid.js was a hundred-odd chunks
// served from /vendor/mermaid/ and handed over on window, because bundling it took a microsite
// build from ~2s to ~40s.)
//
// Theme: the SVG paints with --pele-* CSS variables, set from the page's tokens in
// chat-markdown.css, so a diagram follows light / dark without being drawn again. On a parse
// error Pele throws and draws nothing anywhere — the gate in MermaidBlock decides who sees it.

import { render } from 'pele';

export type MermaidRenderResult =
	| { kind: 'ok'; svg: string }
	| { kind: 'error'; message: string };

// FONT —— what Pele measures labels with; the same family chat-markdown.css paints them in.
const FONT = 'Newsreader, Georgia, serif';

export function renderMermaidSVG(id: string, source: string): MermaidRenderResult {
	try {
		return { kind: 'ok', svg: render(source, { idPrefix: id, fontFamily: FONT }).svg };
	} catch (e) {
		return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
	}
}
