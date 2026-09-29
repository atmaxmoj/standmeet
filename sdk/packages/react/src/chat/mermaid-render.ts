// mermaid-render.ts —— dynamic import mermaid + render to SVG.
// Split out into a .ts file so MermaidBlock.tsx carries no try/catch / if
// branches (the presentation layer only reads state).
//
// Theme: mermaid's default blue-purple clashes with the design system
// (warm cream + ink + vermillion). Force the 'base' theme, then inject
// the design palette via themeVariables.
// Same hex set for dark / light (no dynamic switch; re-initializing
// mermaid is expensive, and the spec doesn't verify dark mode either).

export type MermaidRenderResult =
	| { kind: 'ok'; svg: string }
	| { kind: 'error'; message: string };

// MERMAID_THEME —— maps the design palette onto mermaid themeVariables.
// 'base' theme + themeVariables is mermaid's recommended "fully custom" path.
const MERMAID_THEME = {
	background: '#F3EFE6',        // --color-paper
	primaryColor: '#F3EFE6',      // node fill
	primaryTextColor: '#1B1814',  // node text
	primaryBorderColor: '#1B1814',
	secondaryColor: '#E8E0CE',    // sub-graph fill
	tertiaryColor: '#F3EFE6',
	lineColor: '#5C5045',         // edge stroke
	textColor: '#1B1814',
	mainBkg: '#F3EFE6',
	clusterBkg: '#E8E0CE',
	clusterBorder: '#1B1814',
	noteBkg: '#FAEED7',
	noteBorder: '#B5391C',        // --color-accent (vermillion)
	noteTextColor: '#1B1814',
} as const;

let initialized = false;

export async function renderMermaidSVG(
	id: string, source: string,
): Promise<MermaidRenderResult> {
	try {
		const mermaid = await import('mermaid');
		if (!initialized) {
			mermaid.default.initialize({
				startOnLoad: false,
				theme: 'base',
				themeVariables: MERMAID_THEME,
				fontFamily: 'Newsreader, Georgia, serif',
				// suppressErrorRendering —— when a diagram fails to compile, **don't let it
				// draw itself onto the page** (F-R-8).
				//
				// When mermaid parsing fails, it pastes its own error graphic onto
				// document.body: `Syntax error in text` + `mermaid version 11.15.0`.
				// Our gate (FailedDiagram: show visitors nothing) only blocks **our own**
				// message — the library's path walks right past it, so the owner's public
				// page body ends up printing a JS library's version number in Newsreader
				// (caught in the real environment, `sdk-embed/shots/se3-12`). The "must not
				// appear in front of visitors" criterion has to cover both canvases, or the
				// gate is only there for show ([[gate-after-early-return-is-walkable]]).
				suppressErrorRendering: true,
			});
			initialized = true;
		}
		const { svg } = await mermaid.default.render(id, source);
		return { kind: 'ok', svg };
	} catch (e) {
		return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
	}
}
