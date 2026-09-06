// typst-preview —— compile a résumé draft to SVG in the browser with typst.ts (WASM), for the
// composer's live preview (docs/design/composer-visual-editor.md, Phase 2).
//
// Parity with the server: it compiles the SAME .typ template the `typst` binary uses (served at
// /typst/templates/<name>.typ, staged by copy-typst-assets), feeding the SAME VFS the server stages
// in resumepdf/render.go — `main.typ` + `data.json` (the marshalled ResumeContent) + a `qr.png`,
// with `sys.inputs` qr/role/company. Fonts are typst's defaults on both sides (the backend installs
// no custom fonts). The committed PDF stays server-authoritative; this is preview/edit only, so the
// QR here is a fixed placeholder (never a live code) — exactly like the server's PDF preview.
//
// Everything is client-only: typst.ts is dynamically imported inside the call so it never enters the
// SSR bundle, and the 28 MB compiler WASM loads lazily on first preview.

import qrcode from 'qrcode-generator';

const WASM_BASE = '/typst';

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

// qrPngBytes —— a REAL, scannable QR for `url`, as PNG bytes (the résumé always carries a real code;
// no placeholder). Drawn on a canvas from qrcode-generator's module matrix, then encoded to PNG.
function qrPngBytes(url: string): Uint8Array {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const count = qr.getModuleCount();
  const scale = 8;
  const size = count * scale;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('no 2d context for QR');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (qr.isDark(r, c)) ctx.fillRect(c * scale, r * scale, scale, scale);
    }
  }
  return b64ToBytes(canvas.toDataURL('image/png').split(',')[1] ?? '');
}

const templateCache = new Map<string, string>();
async function fetchTemplateSource(name: string): Promise<string> {
  const key = name === '' ? 'classic' : name;
  const cached = templateCache.get(key);
  if (cached !== undefined) return cached;
  const res = await fetch(`${WASM_BASE}/templates/${key}.typ`);
  if (!res.ok) throw new Error(`typst template ${key} not found (${res.status})`);
  const src = await res.text();
  templateCache.set(key, src);
  return src;
}

// typst —— init the WASM compiler+renderer once (the modules are large; reuse the instance). The
// dynamic import keeps typst.ts out of the SSR bundle; the singleton promise is inferred (no
// `import()` type annotation, which the lint forbids).
async function initTypst() {
  const { $typst } = await import('@myriaddreamin/typst.ts');
  $typst.setCompilerInitOptions({ getModule: () => `${WASM_BASE}/typst_ts_web_compiler_bg.wasm` });
  $typst.setRendererInitOptions({ getModule: () => `${WASM_BASE}/typst_ts_renderer_bg.wasm` });
  return $typst;
}

let typstReady: ReturnType<typeof initTypst> | null = null;
function typst(): ReturnType<typeof initTypst> {
  typstReady ??= initTypst();
  return typstReady;
}

export interface TypstRenderInput {
  template: string;
  dataJSON: string; // JSON.stringify(draftToAPIContent(model))
  role: string;
  company: string;
  qrURL: string; // the real code URL the QR encodes; '' → no QR (template draws an empty box)
}

// EditAnchor —— where an editable field sits on the rendered page, emitted by the template's
// `edit-anchor` metadata (Phase 3). x/y are pt from the page's top-left; page is 1-based.
export interface EditAnchor {
  field: string;
  x: number;
  y: number;
  page: number;
}

export interface ResumeRender {
  svg: string;
  anchors: readonly EditAnchor[];
}

// renderResume —— compile the draft to SVG + the edit anchors (throws if WASM/compile fails; the
// caller falls back to the server-PDF iframe). The QR is the REAL code the owner picked, drawn
// client-side.
export async function renderResume(input: TypstRenderInput): Promise<ResumeRender> {
  const $typst = await typst();
  const src = await fetchTemplateSource(input.template);
  const inputs = { qr: input.qrURL, role: input.role, company: input.company };
  await $typst.resetShadow();
  await $typst.addSource('/main.typ', src);
  await $typst.mapShadow('/data.json', new TextEncoder().encode(input.dataJSON));
  // Only map qr.png when there's a code — the template reads it only when the qr input is non-empty.
  if (input.qrURL !== '') await $typst.mapShadow('/qr.png', qrPngBytes(input.qrURL));
  const svg = await $typst.svg({ mainFilePath: '/main.typ', inputs });
  return { svg, anchors: await queryAnchors($typst, inputs) };
}

// queryAnchors —— read the template's edit-anchor metadata (Phase 3). typst.ts's `compiler.query`
// throws "document is not compiled" (it queries a world that was never compiled — Myriad-Dreamin/
// typst.ts#832); the working form is runWithWorld → world.compile() → world.query. `field: 'value'`
// returns the metadata values ({field,x,y,page}). Any failure → [] (no overlays; preview still renders).
async function queryAnchors(
  $typst: Awaited<ReturnType<typeof typst>>, inputs: Record<string, string>,
): Promise<EditAnchor[]> {
  const none: EditAnchor[] = [];
  return (await $typst.getCompiler())
    .runWithWorld({ mainFilePath: '/main.typ', inputs }, async (world) => {
      await world.compile();
      return world.query<EditAnchor[]>({ selector: '<sm-edit>', field: 'value' });
    })
    .catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[typst-preview] anchor query failed:', e);
      return none;
    });
}
