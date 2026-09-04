// CorpusScopePicker —— check off a set of URIs from the **real corpus tree**,
// instead of making the owner type them from memory (F-A-14).
//
// A role's grants and a code's revocations use the same language (a set of
// globs), so they share the same picker: callers just supply value / onChange.
//
// Three design decisions, each with a reason:
//
// 1. **What gets checked is a row that really exists on the tree**; the URI comes
//    from the backend's `path` (server-side slug). The owner never needs to know
//    what `subjectivity://cv` looks like — they just check the "cv" row.
// 2. **Checking a row with children = two globs** (`g://p` + `g://p/**`). In the
//    glob dialect, `g://p/**` does not match `g://p` itself; sending only the
//    subtree glob would make the owner think they granted the whole thing while
//    actually missing the folder-note itself. This pitfall is the component's
//    job to handle, not the matcher's.
// 3. **A glob the picker doesn't recognize is kept as-is**, never swallowed. The
//    owner may have hand-written `wiki://**/draft` — no row on the tree
//    corresponds to it. A picker that round-trips the value through its own
//    translation would **silently drop it** on save. So: the tree only handles
//    what it recognizes; everything else is carried through unchanged and
//    listed honestly below.

'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { useAdminTreeLayer } from '@/lib/admin/use-admin-tree-layer';
import {
  SCOPE_GENRES, foreignGlobs, genreGlob, globsFor, loadScopeLayer, uriOf,
  type ScopeGenre, type ScopeNode,
} from '@/lib/admin/use-corpus-scope-tree';

interface PickerProps {
  value: readonly string[];
  onChange: (next: string[]) => void;
  testid: string;
}

export function CorpusScopePicker({ value, onChange, testid }: PickerProps) {
  const selected = new Set(value);
  const toggle = useCallback((globs: string[], on: boolean) => {
    const next = new Set(value);
    globs.forEach((g) => (on ? next.add(g) : next.delete(g)));
    onChange([...next]);
  }, [value, onChange]);
  // Whatever the tree doesn't recognize (a hand-written odd glob, a typo, a
  // future genre) — kept as-is, never silently dropped.
  const foreign = foreignGlobs(value);
  return (
    <div className="flex flex-col gap-2" data-testid={testid}>
      {SCOPE_GENRES.map((genre) => (
        <GenreBlock key={genre} genre={genre} selected={selected} toggle={toggle} prefix={testid} />
      ))}
      <ForeignGlobs globs={foreign} prefix={testid} />
    </div>
  );
}

// ForeignGlobs —— the globs the tree cannot express. Listed (not hidden): the
// owner needs to see what else is in this grant.
function ForeignGlobs({ globs, prefix }: { globs: readonly string[]; prefix: string }) {
  const t = useTranslations('adminCorpus.scope');
  return globs.length === 0 ? null : (
    <div
      className="mono text-[10px] text-(--color-muted) mt-1"
      data-testid={`${prefix}-foreign-globs`}
    >
      <span className="text-(--color-faint)">{t('kept')}</span>
      {globs.join('  ')}
    </div>
  );
}

interface BlockProps {
  genre: ScopeGenre;
  selected: Set<string>;
  toggle: (globs: string[], on: boolean) => void;
  // prefix —— the testid namespace for this picker instance. Each role card on
  // a page has its own picker; an unprefixed `scope-genre-wiki` would match
  // several at once (that's how the first version behaved).
  prefix: string;
}

// GenreBlock —— one genre: the checkbox for the whole tree + an expandable tree.
function GenreBlock({ genre, selected, toggle, prefix }: BlockProps) {
  const t = useTranslations('adminCorpus.scope');
  const [open, setOpen] = useState(false);
  const whole = genreGlob(genre);
  return (
    <div className="border-l border-(--color-rule) pl-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mono text-[10px] text-(--color-faint) w-3"
          aria-expanded={open}
          data-testid={`${prefix}-toggle-${genre}`}
        >
          {open ? '▾' : '▸'}
        </button>
        <label className="mono text-[11px] flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.has(whole)}
            onChange={(e) => toggle([whole], e.target.checked)}
            data-testid={`${prefix}-genre-${genre}`}
          />
          <span className="text-(--color-ink)">{genre}</span>
          <span className="text-(--color-faint)">{t('allOfIt', { glob: whole })}</span>
        </label>
      </div>
      {open ? (
        <ScopeLevel genre={genre} parentID="" selected={selected} toggle={toggle} prefix={prefix} />
      ) : null}
    </div>
  );
}

interface LevelProps extends BlockProps {
  parentID: string;
}

// ScopeLevel —— lazily load one level (reuses the admin tree machinery: one
// level at a time, so a large corpus never gets pulled down whole).
function ScopeLevel({ genre, parentID, selected, toggle, prefix }: LevelProps) {
  const t = useTranslations('adminCorpus.common');
  const load = useCallback((p: string) => loadScopeLayer(genre, p), [genre]);
  const nodes = useAdminTreeLayer(load, parentID, true, 0);
  return nodes === null ? (
    <p className="mono text-[10px] text-(--color-faint) pl-5">{t('loading')}</p>
  ) : (
    <ul className="pl-5">
      {nodes.map((n) => (
        <ScopeRow key={n.id} genre={genre} node={n} selected={selected} toggle={toggle}
          prefix={prefix} />
      ))}
    </ul>
  );
}

// ScopeRow —— one row. Checking it = itself (plus its whole subtree when it
// has children, see decision 2 at the top of this file).
function ScopeRow({ genre, node, selected, toggle, prefix }: BlockProps & { node: ScopeNode }) {
  const t = useTranslations('adminCorpus.scope');
  const [open, setOpen] = useState(false);
  const globs = globsFor(genre, node);
  const hasKids = node.has_children === true;
  return (
    <li>
      <div className="flex items-center gap-2">
        <Expander open={open} hasKids={hasKids} onToggle={() => setOpen((o) => !o)}
          id={`${prefix}-${node.id}`} />
        <label className="mono text-[11px] flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.has(uriOf(genre, node))}
            onChange={(e) => toggle(globs, e.target.checked)}
            data-testid={`${prefix}-node-${uriOf(genre, node)}`}
          />
          <span className="text-(--color-ink)">{node.title}</span>
          <ReferableMark show={node.show_as_source} prefix={`${prefix}-${node.id}`} />
          {hasKids ? <span className="text-(--color-faint)">{t('everythingUnder')}</span> : null}
        </label>
      </div>
      {open ? (
        <ScopeLevel genre={genre} parentID={node.id} selected={selected} toggle={toggle}
          prefix={prefix} />
      ) : null}
    </li>
  );
}

// REFERABLE_MARK —— the glyph per referability state, keyed by String(show_as_source). A missing
// axis (writing) → String(undefined) = 'undefined', absent from the map → no mark rendered.
const REFERABLE_MARK: Record<string, { glyph: string; cls: string; key: string }> = {
  true: { glyph: '◆', cls: 'text-(--color-accent)', key: 'referable' },
  false: { glyph: '◇', cls: 'text-(--color-faint)', key: 'notReferable' },
};

// ReferableMark —— a per-node glyph telling the owner, while they pick read-scope, whether this
// entry is *referable* (can surface as a cited source: `show_as_source`). A separate axis from
// read-scope — a role may read a note that is never cited — so it is shown, not made checkable.
// ◆ (accent) = referable, ◇ (faint) = readable-but-never-cited; writing has no such axis → nothing.
function ReferableMark({ show, prefix }: { show?: boolean; prefix: string }) {
  const t = useTranslations('adminCorpus.scope');
  const m = REFERABLE_MARK[String(show)];
  return m ? (
    <span
      title={t(m.key)}
      aria-label={t(m.key)}
      data-testid={`${prefix}-referable`}
      data-referable={String(show)}
      className={`mono text-[10px] ${m.cls}`}
    >
      {m.glyph}
    </span>
  ) : null;
}

function Expander(
  { open, hasKids, onToggle, id }:
  { open: boolean; hasKids: boolean; onToggle: () => void; id: string },
) {
  return hasKids ? (
    <button
      type="button" onClick={onToggle} aria-expanded={open}
      className="mono text-[10px] text-(--color-faint) w-3"
      data-testid={`${id}-expand`}
    >
      {open ? '▾' : '▸'}
    </button>
  ) : <span className="w-3" aria-hidden="true" />;
}
