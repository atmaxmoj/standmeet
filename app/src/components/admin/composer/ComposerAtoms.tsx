// ComposerAtoms —— ResumeComposer 那八个面板共用的小件：段、字段、空态说明、加一条。
// 从 ComposerPanels 拆出来守 350 行上限；它们本来就是被每个面板复用的东西。

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

// EmptyHint —— 这一段为什么是空的，以及空着会怎样。
//
// 起草那一步只会从语料里**带日期的条目**填 experience / education，而 owner 的履历
// 只以散文形态活着，于是它交回来的是空数组（F-E-22）。以前这里什么都不显示：owner
// 看到一个空面板，没有任何东西告诉他这一跳归他，也没有地方可以做 —— 连「加一条」
// 的按钮都不存在。
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
