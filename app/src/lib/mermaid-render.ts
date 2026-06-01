// mermaid-render.ts —— dynamic import mermaid + render to SVG。
// 拆出 .ts 让 MermaidBlock.tsx 不带 try/catch / if 分支 (presentation
// 层只 read state)。
//
// Theme：mermaid 默认蓝紫色跟设计系统 (warm cream + ink + vermillion)
// 撞色。强制 'base' theme 然后用 themeVariables 注入 design palette。
// dark / light 同一组 hex (不动态切；mermaid 重 init 代价高，spec 也
// 不验深色)。

export type MermaidRenderResult =
	| { kind: 'ok'; svg: string }
	| { kind: 'error'; message: string };

// MERMAID_THEME —— design palette 映射到 mermaid themeVariables。
// 'base' theme + themeVariables 是 mermaid 推荐的"完全自定义"通路。
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
			});
			initialized = true;
		}
		const { svg } = await mermaid.default.render(id, source);
		return { kind: 'ok', svg };
	} catch (e) {
		return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
	}
}
