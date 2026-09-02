// CodeCorpusConfig — the **corpus narrowing panel** on a code card (the code-layer piece of
// the corpus category among the three ACL categories).
//
// A role grants an allow-list of what "this audience" can read (shown read-only here); this
// code can further **narrow** it — things "this particular invite" shouldn't see. Typical
// case: a general role grants the whole subjectivity (every stance included), but the code
// handed to an external party takes back `subjectivity://cv` (record notes: real name,
// education, employer).
//
// **Narrowing only**: a glob written here can only make this code read less, never open up
// something the role didn't already grant (pure AND, A.4). So a mistaken entry can at worst
// under-read, never leak.

'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';

import { CorpusScopePicker } from '@/components/admin/sections/corpus/CorpusScopePicker';
import { fetchCodeCorpus, saveCodeCorpus } from '@/lib/admin/use-code-corpus';
import { useAction } from '@/lib/ui/use-action';

// CorpusLoadFailed — say so when the fetch fails, **and don't render the editor**: with
// granted unknown, that list would only mislead, and with denied unknown, saving would wipe
// out a take-back list the owner never even saw. Better to leave this card missing a piece
// than to show a fake one.
function CorpusLoadFailed({ codeLabel }: { codeLabel: string }) {
  const t = useTranslations('adminAccess');
  return (
    <div className="mt-2 flex flex-col gap-1" data-testid={`code-corpus-error-${codeLabel}`}>
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint)">
        {t('common.corpus')}
      </span>
      <p className="reading-tight text-[11px] text-(--color-accent)">
        {t('codeCorpus.loadError')}
      </p>
    </div>
  );
}

// CorpusState — this card's load state. `error` is a **third** state, not a hollow value of
// loaded: "the role grants nothing" and "the fetch failed" must read differently in the UI
// (F-A-13).
interface CorpusState {
  granted: string[];
  publishedOnly: boolean;
  text: string;
  setText: (v: string) => void;
  loaded: boolean;
  error: boolean;
}

// Sinks — the bundle of setters for useCodeCorpusState (no branching inside the component:
// the presentation layer bans `if`, so the apply* helpers live outside it).
interface Sinks {
  setGranted: (v: string[]) => void;
  setPublishedOnly: (v: boolean) => void;
  setText: (v: string) => void;
  setLoaded: (v: boolean) => void;
  setError: (v: boolean) => void;
}

// applyCorpus — applies the GET result.
function applyCorpus(
  c: { granted: string[]; denied: string[]; publishedOnly: boolean }, s: Sinks,
): void {
  s.setGranted(c.granted);
  s.setPublishedOnly(c.publishedOnly);
  s.setText(c.denied.join('\n'));
  s.setLoaded(true);
}

// applyLoadError — the fetch failed. Does **not** touch granted/text: at this point they're
// meaningless initial values, and rendering them would tell that same lie.
function applyLoadError(s: Sinks): void {
  s.setError(true);
  s.setLoaded(true);
}

// useCodeCorpusState — GETs a code's corpus panel. A load failure must not silently collapse
// to empty (same pattern as use-latest-list's loadError).
function useCodeCorpusState(codeID: string): CorpusState {
  const [granted, setGranted] = useState<string[]>([]);
  const [publishedOnly, setPublishedOnly] = useState(false);
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const live = { on: true };
    const sinks: Sinks = { setGranted, setPublishedOnly, setText, setLoaded, setError };
    void fetchCodeCorpus(codeID)
      .then((c) => { live.on && applyCorpus(c, sinks); })
      .catch(() => { live.on && applyLoadError(sinks); });
    return () => { live.on = false; };
  }, [codeID]);
  return { granted, publishedOnly, text, setText, loaded, error };
}

// GrantedList — what the inherited role grants. Renders only when the fetch has **actually
// succeeded**, so what it says here is true (see useCodeCorpusState's error branch).
//
// An empty list has **two** distinct meanings that must read differently: the `public`
// identity has no allow-list at all (it reads whatever the owner has published), while an
// empty list on any other role genuinely means it grants nothing. This used to just say
// `(role grants nothing)` — so a code with public attached was wrongly written up as reading
// nothing, when it plainly reads published entries (a false statement that surfaced after
// F-D-7).
function GrantedList({
  granted, publishedOnly,
}: { granted: readonly string[]; publishedOnly: boolean }) {
  const t = useTranslations('adminAccess');
  return (
    <ul className="mono text-[10.5px] text-(--color-muted) flex flex-wrap gap-x-3">
      {publishedOnly
        ? <li className="italic">{t('codeCorpus.publishedSlice')}</li>
        : <GrantedGlobs granted={granted} />}
    </ul>
  );
}

// TakenBackHelp — that ~60-word explanation is **collapsed into a disclosure** (UX-88).
//
// It used to be printed fully open on every card: 13 codes on this page meant the same
// paragraph printed 13 times, burying "who can still get in" inside a manual. It explains
// this control itself, so it stays next to the control (not moved to the page header); but a
// person only needs to read it once, so it's collapsed by default. `<details>` is an existing
// disclosure pattern in this product (same as the skills panel's show-prompt).
function TakenBackHelp() {
  const t = useTranslations('adminAccess');
  return (
    <details className="reading-tight text-[11px] text-(--color-muted)">
      <summary className="mono text-[10px] text-(--color-faint) cursor-pointer hover:text-(--color-ink)">
        {t('codeCorpus.helpSummary')}
      </summary>
      <p className="mt-1">{t('codeCorpus.help')}</p>
    </details>
  );
}

function GrantedGlobs({ granted }: { granted: readonly string[] }) {
  const t = useTranslations('adminAccess');
  return granted.length === 0
    ? <li className="italic">{t('codeCorpus.grantsNothing')}</li>
    : <>{granted.map((g) => <li key={g}>{g}</li>)}</>;
}

export function CodeCorpusConfig({ codeID, codeLabel }: { codeID: string; codeLabel: string }) {
  const t = useTranslations('adminAccess');
  const run = useAction();
  const { granted, publishedOnly, text, setText, loaded, error } = useCodeCorpusState(codeID);
  const onSave = useCallback(
    () => run(
      () => saveCodeCorpus(codeID, text.split('\n').map((s) => s.trim()).filter((s) => s !== '')),
      { success: `Corpus narrowed for ${codeLabel}` },
    ),
    [codeID, codeLabel, run, text],
  );
  return error ? <CorpusLoadFailed codeLabel={codeLabel} /> : loaded ? (
    <div className="mt-2 flex flex-col gap-1.5" data-testid={`code-corpus-${codeLabel}`}>
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint)">
        {t('codeCorpus.inherited')}
      </span>
      <GrantedList granted={granted} publishedOnly={publishedOnly} />
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) mt-1">
        {t('codeCorpus.takenBack')}
      </span>
      <TakenBackHelp />
      {/* Taking back and granting speak the same language (a set of globs), so they share
          the same picker (F-A-14). */}
      <CorpusScopePicker
        value={text.split('\n').map((s) => s.trim()).filter((s) => s !== '')}
        onChange={(next) => setText(next.join('\n'))}
        testid={`code-corpus-picker-${codeLabel}`}
      />
      <span className="mono text-[9.5px] text-(--color-faint) mt-1">{t('common.byHand')}</span>
      <textarea
        className="border border-(--color-rule) px-2.5 py-1.5 bg-(--color-paper) text-[12.5px] font-mono min-h-[54px]"
        value={text}
        placeholder={'subjectivity://cv'}
        onChange={(e) => setText(e.target.value)}
        data-testid={`code-corpus-denied-${codeLabel}`}
        spellCheck={false}
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSave}
          data-testid={`code-corpus-save-${codeLabel}`}
          className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent)"
        >
          {t('common.saveCorpus')}
        </button>
      </div>
    </div>
  ) : null;
}
