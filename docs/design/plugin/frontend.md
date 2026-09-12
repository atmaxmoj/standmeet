# The frontend

Status: **2026-09-09.** What changes in `app/` and `sdk/`. Assumes `architecture.md`.

## The admin has the same star topology as the backend

Counted 2026-09-09. Every concrete integration owns a bespoke panel:

```
ConnectorsSection.tsx + connectors/     7 files, connector-specific
    AssembleView · ConnectorCard · ConnectorList · ConnectorOps
    CalendarConnectorPanel · CalendarBookingPolicy      ← two of them calendar-specific
    CapabilitiesPanel
ObsidianSection.tsx                     a whole section, Obsidian only
SkillsSection / AgentSkillsSection      skills only
roles/RoleToolsConfig.tsx               per-role tool selection
codes/ + CodesSection.tsx               per-code denials
```

**Add a calendar provider → add a panel. Add Obsidian → add a section.** That is the same defect as
the backend's five registries, and if it is left alone the backend can be fully decoupled while
adding one block still means writing React.

## 1. One block list replaces the bespoke panels

The owner's reference is WordPress's plugin screen, and the four states map exactly
(`microsite-build.md`): install · activate · place on a page · deactivate.

`CalendarBookingPolicy`, `ObsidianSection`, `AssembleView` should not exist as separate things —
each is "the settings of one block".

## 2. A block declares its settings; the admin renders them generically

This is the load-bearing piece. Without it the block list is a directory of links to hand-written
forms and nothing is gained.

**Settled**: every block carries a `Config` JSON Schema on its manifest (`block-model.md`), the same
schema that validates a bundle at write. `credform` — which today derives owner-facing fields from
an OpenAPI spec — becomes the OpenAPI block's way of producing that schema, one case of a general
rule rather than the only mechanism.

One renderer covers everything: a type, an enum and a range are all a form needs.

**The acceptance test for this whole document: adding a block must require no frontend code.**

> **Held, 2026-09-10.** `BlockConfigForm.tsx` renders any block's settings from its declaration and
> contains no block's name; `block-costs-no-code` installs a fixture block that is nothing but a
> manifest and reads its form — the field's type, label, default and range all arrive from the
> manifest. Two things had to move for that to be true rather than nearly true: the config
> declarations are read at call time instead of snapshotted from the shipped tree at boot (a block
> installed after startup had no form at all), and a block's schema is provisioned when it is
> installed rather than only during startup (the form rendered, then failed on read).

## 3. Access control: a subtractive UI becomes an additive one

| today | after |
|---|---|
| `roles/RoleToolsConfig.tsx` — pick tools per role | — |
| `codes/` denial editors, `codes_add_denial`, `codes_set_corpus_denials` | — |
| answering "what can this code do" means reading three screens | pick a bundle; read its list |

Replaced by a **bundle assembler** — choose blocks, name the group — and a bundle picker on each
code.

> **Built 2026-09-10, alongside the old model rather than in place of it.** `BundlePanel.tsx` is the
> assembler; `CodeBundlePicker` is the picker; `CodeBundleBlock` is the read-off-one-screen answer.
> `access_codes.bundle_id` is nullable and **a code with no bundle behaves exactly as before** —
> `BundleGrants` reports `bound=false` and the frozen three-tier judgement answers untouched. That is
> deliberate and is what let this land without rewriting the 600-odd specs that encode the old rule;
> the rows above are struck through as the *destination*, not as something already removed.
>
> The gate is read inside `enabledCaps`, which every assembly walks, so the bundle is the grant
> **live**: taking a block out reaches a session already open. It fails **closed** — unlike the
> owner-enable gate beside it, a failed read reports "bound, to nothing" rather than falling back to
> the role, because the role's grant may be wider than the bundle the owner actually chose.

Not a new kind of interface for us: `PuckComposer.tsx` / `PuckResumeEditor.tsx` is already visual
block assembly, and its trap carries over — every item needs a unique `props.id` or the page
collapses into one section and white-screens.

## 4. The microsite editor places blocks

A page becomes a composition of blocks rather than source, so the editor gains "add a block here"
and loses nothing else.

## 5. SDK: the widget boundary

Third-party page blocks are allowed (`isolation.md`), and widgets are confined by an iframe. The
primitive is in the tree — `McpAppCard.tsx:45`, `sandbox="allow-scripts"` with no
`allow-same-origin` — and the missing half is annotated in the code itself, `WidgetBlock.tsx:10`:
*"a postMessage protocol is deferred."*

**What a widget may ask the page to do across that boundary is the browser-side `ctx`**, and it is
unwritten. It is on the critical path now that third-party page blocks are allowed.

## The shape of the change, in one line

The backend collapses five registries into one service. The frontend must collapse a pile of
bespoke panels into **one block list plus a form the block itself describes** — otherwise adding a
block still costs React.
