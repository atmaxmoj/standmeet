// ComposerAtoms —— small pieces shared by ResumeComposer's eight panels: section,
// field, empty-state note, add-one button.
// Split out of ComposerPanels to keep it under the 350-line cap; these were
// already reused by every panel.

'use client';

import type { DraftEducation, DraftExperience } from '@/lib/admin/draft-model';

export function Section({
  title, hint, children,
}: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <header>
        <div className="sm-smallcaps">{title}</div>
        <p className="sm-reading text-(--color-muted) text-[13.5px] mt-1">{hint}</p>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="sm-field">
      <span className="sm-field-label">
        {label}
        {hint && <span className="sm-field-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

// EmptyHint —— why this section is empty, and what leaving it empty does.
//
// The draft step only fills experience / education from **dated entries** in the
// corpus, and an owner's history often lives purely as prose, so it comes back as
// an empty array (F-E-22). Previously this rendered nothing: the owner saw a blank
// panel with no hint that this step was theirs to do, and no way to do it — not
// even an "add one" button existed.
export function EmptyHint(
  { show, what, testid }: { show: boolean; what: string; testid: string },
) {
  return show ? (
    <p data-testid={testid} className="sm-empty reading-tight text-[13px] text-(--color-muted)">
      {`No ${what} here. The drafter fills this in only from dated entries it can find in your `
       + 'corpus, and it found none — so this one is yours to write. Add them here and they '
       + 'print in the PDF; leave it empty and the section is left out of the document entirely.'}
    </p>
  ) : null;
}

export function AddBtn(
  { label, testid, onClick }: { label: string; testid: string; onClick: () => void },
) {
  return (
    <button
      type="button" data-testid={testid} onClick={onClick}
      className="sm-btn sm-btn-ghost sm-btn-sm"
    >
      {label}
    </button>
  );
}

export function blankExperience(n: number): DraftExperience {
  return { id: `e-new-${String(n)}`, org: '', role: '', range: '', loc: '', bullets: [] };
}

export function blankEducation(n: number): DraftEducation {
  return { id: `ed-new-${String(n)}`, school: '', degree: '', range: '' };
}
