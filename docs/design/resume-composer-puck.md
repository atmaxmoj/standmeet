# Resume composer → Puck (rebuild)

Status: **design / decided 2026-09-06.** Owner: "算了,就全改成 puck 吧,但是现在的这几项当作固定模板
吧(有 skills education 这些的),重新设计一下这边的 ui。" The hand-rolled drag composer
(RowDragOverlay / ColumnDivider) is fragile in both UX and E2E — replace it with **Puck**
(@measured/puck), the proven data-driven page builder youteacher ships. Reference:
`youteacher_web/src/features/content/components/puck-editor/` (puckConfig / PuckPageEditor /
PuckRenderer), data stored as `aboutPageData` JSON, saved via `PATCH admin/me`.

## Why Puck (over the custom composer)
- Data-driven: the layout IS JSON (Puck data) → an agent edits by writing JSON (MCP), no UI needed.
- Proven engine: Puck uses `@dnd-kit/react`; the drag is not our code to keep un-flaky.
- **PW-testable (verified, not assumed):** Puck emits stable `data-puck-*` selectors
  (`-component / -dnd / -dropzone / -dragging / -entry / -drawer-item`) and dnd-kit ships a
  **keyboard sensor** (Space pick up · Arrow move · Space drop) that is deterministic under
  Playwright — no pointer-timing flake. youteacher chose seed+render only; that was a choice, not a
  limit. We can do both (see Test matrix).

## The fixed section templates = Puck components
The résumé's sections become a small **fixed** Puck component set (owner arranges/duplicates them,
does not invent new component types): `Header` (name/contact/role), `Summary`, `Skills`,
`Experience` (repeatable entry: org/role/period/bullets), `Education` (repeatable), `Social`,
`Custom` (label+value / divider). Each maps 1:1 to a `resume_content` section. Field-level content is
edited in each component's Puck fields panel (the left form), arrangement/order via Puck drag.

## Data wiring + the upgrade scenario  ⟵ owner flagged "数据怎么 wire 升级才 ok"
`resume_content` (the typed sections the typst templates + MCP `resume.draft` already use) stays the
**canonical** shape and the render source. Puck data is a **view/editor projection** of it, not a
second source of truth (十条 #1/#2):
- **resume_content → Puck data** (`toPuckData`): pure, deterministic; drives the editor + preview.
- **Puck data → resume_content** (`fromPuckData`): on save; only known component types map, unknown
  ignored → the canonical stays clean and the typst render is unchanged.
- **Upgrade / existing drafts**: every existing draft/application already has `resume_content`; since
  Puck data is derived at edit time from it, **old rows just open** — no stored Puck blob to migrate.
  If we later persist Puck data for fidelity, it is additive + rebuildable from resume_content, and
  needs a migration + an **upgrade-path test** ([[schema-lives-in-the-volume-not-the-image]]): a row
  written pre-Puck opens and renders identically post-Puck.
- Round-trip invariant (test): `fromPuckData(toPuckData(rc)) ≈ rc` for every section type.

## Render
Keep **typst** as the authoritative PDF renderer from `resume_content` (unchanged). The composer
preview stays the WASM typst preview. Puck is editor-only; it does not become the render path. (So
font-size / accent / left_order / left_width already shipped keep working — they are resume_content
fields the section components expose as Puck fields.)

## UI redesign
Puck's standard 3-pane: left = component drawer (the fixed section templates) + selected component's
fields; center = the résumé canvas (drag/reorder, the typst-styled section blocks); right/preview =
the committed-PDF-parity view. Replace ResumeComposer's custom grid + RowDragOverlay/ColumnDivider.

## Test plan

Surfaces (where truth is read): **PDF** (typst, authoritative) · **resume_content** (canonical JSON) ·
**puck_data** (editor state JSON) · **Puck editor UI** (`data-puck-*` selectors). Axes to cover:
section present/absent · repeatable (Experience/Education) 0/1/many · order default vs reordered ·
content empty/partial/full/CJK/long(→page2) · fields font-size/accent/left_width · provenance new
(puck_data stored) vs old (resume_content only) · template classic/compact.

### Group U — pure mapping (unit, fast, no UI, no Puck runtime)
- **U1 round-trip:** `fromPuckData(toPuckData(rc)) ≈ rc` — parametrized over each section type, over
  repeatable 0/1/many, over empty/partial/full. The core "no silent divergence" guard (十条#2).
- **U2 toPuckData:** rc → `content[]` with the correct component types **in section order**; each
  section's fields land in its component props (sentinel per field).
- **U3 fromPuckData:** an arbitrary owner-ordered `content[]` → resume_content whose sections follow
  that order; **N Experience components collect into works[]** (order kept); **unknown component
  types are ignored** (canonical stays clean).
- **U4 order subsumes left_order:** reordering components in puck_data is what sets section order —
  assert fromPuckData reflects Puck arrangement (the old left_order field's job moves here).

### Group A — artifact (render is authoritative; Go render_test + e2e inspectPDF)
- **A1 full-field sweep:** a unique sentinel in EVERY field of EVERY section (via seeded puck_data →
  fromPuckData → commit) appears in the committed PDF text. Catches a dropped field/adapter gap.
- **A2 arranged order:** a non-default section arrangement in puck_data → the PDF renders sections in
  that exact order.
- **A3 empty/partial:** absent sections suppress their headings; PDF has no literal "undefined"/"null".
- **A4 carry-over:** CJK glyphs; long experience → page 2; compact template renders full content;
  font-size/accent/left_width still take effect (they remain resume_content fields).

### Group C — upgrade path ([[schema-lives-in-the-volume-not-the-image]])
- **C1 old row opens:** a pre-Puck draft (resume_content, no puck_data) opens in the new composer
  (toPuckData derives) and renders a PDF **identical** to before.
- **C2 no-op save is lossless:** opening an old draft and Saving without edits yields a
  resume_content **equal to the original** (Puck round-trip loses nothing).
- **C3 migration:** the `puck_data` column is added **nullable**; existing rows are untouched; run the
  upgrade against a seeded pre-Puck volume, not an empty one (green on empty proves nothing).

### Group D — editor interaction (Puck, DETERMINISTIC — the PW-testability the owner asked to verify)
- **D1 real drag:** focus a section's `data-puck-*` handle → **dnd-kit keyboard DnD** (Space pick up ·
  Arrow move · Space drop) → assert resume_content order changed + preview/PDF reflects it. This is
  the "真拖拽" guard on a proven engine (no custom overlays, no pointer-timing flake).
- **D2 field edit → persisted + rendered:** edit a field in Puck's panel → Save → reopen shows it +
  the committed PDF has it.
- **D3 add / remove / duplicate** a repeatable component (Experience) → works[] + PDF reflect it.
- **D4 Save semantics:** state lives in Puck until **Save**; clicking Save persists puck_data +
  derived resume_content; reopen shows the saved state (and an un-Saved edit does NOT persist).

### Group E — agent edit (data path, no UI)
- **E1** MCP `resume.draft` writes resume_content → renders (already true; keep).
- **E2** an agent writing structured data produces the same artifact a human's Puck edit would —
  proves the editor is not the only door.

### Method notes
- **Primary = Group A/U** (seed data, assert artifact) — fast + deterministic, the youteacher lesson.
- **Group D drives the REAL editor** but via keyboard DnD + `data-puck-*` (deterministic), so we still
  guard the interaction without the flake that killed the custom-drag specs.
- **Retire** `draft-composer-layout-drag` / `draft-composer-canvas-drag` (custom-overlay drag) once D
  covers reorder; fold their intent into D1/D3.
- **RED-reachability:** every guard must be shown to fail on the corresponding defect (a dropped
  field, an ignored order, a lost upgrade) — not just pass on the happy path ([[guard-must-fail-on-the-bug]]).

## Staged build (each stage its own green before the next)
1. `toPuckData` / `fromPuckData` + round-trip unit tests (B) — no UI yet.
2. puckConfig with the fixed section components (fields map to resume_content).
3. Swap ResumeComposer body to PuckPageEditor; preview unchanged; wire save through fromPuckData.
4. Tests A/C/D/E; retire the custom-drag specs (layout-drag / canvas-drag) as their coverage moves to D.
5. Vendor @measured/puck into the app (+ builder vendor if a microsite needs it).

## Resolved (owner 2026-09-06): Puck owns its state; Save persists
"puck 的应该由自己的 redux,点 save 就 save。" → the Puck editor holds its own `data` (its store) while
editing; an explicit **Save** persists it. So:
- **Persist the Puck data** as the draft's stored editor state (new `puck_data` field on the draft).
  On Save: `fromPuckData(puckData)` → derive `resume_content` and persist it too (typst renders from
  resume_content — the canonical render source stays). puck_data = editor fidelity; resume_content =
  render/canonical, always rederivable from puck_data.
- **No auto-save churn**: state lives in Puck; the Save button is the commit-to-storage moment.
- **Upgrade path (this is "数据怎么 wire 升级才 ok"):** an existing draft/application has only
  `resume_content`, no `puck_data`. On open: `puck_data` present → load it into Puck; absent (old row)
  → `toPuckData(resume_content)` derives it on the fly → owner edits → Save writes `puck_data`. So old
  rows open + render unchanged, and adopt puck_data on first save. Needs: the `puck_data` column
  (migration, nullable) + an **upgrade-path test** (a pre-Puck row opens, renders identically, and a
  no-op Save produces a resume_content equal to the original) ([[schema-lives-in-the-volume-not-the-image]]).
- Invariant tests: `fromPuckData(toPuckData(rc)) ≈ rc` (round-trip), and puck_data is always
  rebuildable from resume_content so the two never silently diverge (十条 #2).
