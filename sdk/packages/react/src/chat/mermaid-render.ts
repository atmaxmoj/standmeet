// mermaid-render.ts —— dynamic import mermaid + render to SVG.
// Split out into a .ts file so MermaidBlock.tsx carries no try/catch / if
// branches (the presentation layer only reads state).
//
// mermaid is loaded from the instance at run time (/vendor/mermaid/, served by the app), never
// bundled: as a bundled lazy chunk it was a hundred-odd files every microsite build had to process
// (the builder's vite step went from ~2s to ~40s), and megabytes in the embed. A page that never
// shows a diagram never downloads it; one that does fetches the same file from the same place.
//
// Theme: mermaid's default blue-purple clashes with the design system
// (warm cream + ink + vermillion). Force the 'base' theme, then inject
// the design palette via themeVariables.
// Same hex set for dark / light (no dynamic switch; re-initializing
// mermaid is expensive, and the spec doesn't verify dark mode either).

import { chatBaseURL } from './api.js';

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

// MermaidModule —— the slice of mermaid's API this file calls.
interface MermaidModule {
	default: {
		initialize: (config: Record<string, unknown>) => void;
		render: (id: string, source: string) => Promise<{ svg: string }>;
	};
}

// loadMermaid —— the instance's copy (see the header), loaded by a module <script> rather than an
// import() in this code: an import() of a run-time URL is something every bundler on the way (this
// package's, a microsite's vite, the app's webpack) tries to resolve, and the comments that tell
// them not to do not survive minification. The instance's expose.mjs imports mermaid and hands it
// over on window.
let loading: Promise<MermaidModule> | null = null;

function loadMermaid(): Promise<MermaidModule> {
	const w = window as unknown as { __standmeetMermaid?: MermaidModule['default'] };
	loading ??= new Promise<MermaidModule>((resolve, reject) => {
		const s = document.createElement('script');
		s.type = 'module';
		s.src = `${chatBaseURL()}/vendor/mermaid/expose.mjs`;
		s.onload = () => (w.__standmeetMermaid === undefined
			? reject(new Error('mermaid did not load'))
			: resolve({ default: w.__standmeetMermaid }));
		s.onerror = () => { loading = null; reject(new Error('mermaid could not be fetched')); };
		document.head.append(s);
	});
	return loading;
}

export async function renderMermaidSVG(
	id: string, source: string,
): Promise<MermaidRenderResult> {
	try {
		const mermaid = await loadMermaid();
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
