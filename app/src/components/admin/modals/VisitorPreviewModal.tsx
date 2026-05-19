// VisitorPreviewModal —— 让 owner 看到 visitor 拿这个 code 落地时的样子。
// 纯展示，不操作 session（owner 只是 preview）。

'use client';

import { ModalShell } from '@/components/admin/modals/ModalShell';

import type { CodeView } from '@/lib/admin/use-codes';

type Props = { code: CodeView; onClose: () => void };

export function VisitorPreviewModal({ code, onClose }: Props) {
  return (
    <ModalShell
      onClose={onClose}
      kicker={`visitor preview · code ${code.code}`}
      title={code.label}
      maxWidth={680}
    >
      <div className="px-7 py-8 space-y-6">
        <Greeting label={code.label} />
        <SuggestedList items={code.suggested_questions ?? []} />
        <ScopeNote
          included={code.included_tags}
          excluded={code.excluded_tags}
          code={code.code}
        />
      </div>
    </ModalShell>
  );
}

function Greeting({ label }: { label: string }) {
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-3">
        owner&apos;s ai · ready
      </div>
      <p className="reading-tight text-(--color-ink) text-[17px]">
        Welcome. You&apos;ve come in on <span className="text-(--color-accent)">{label}</span>.
        Before we start — is this you, or someone new?
      </p>
    </div>
  );
}

function SuggestedList({ items }: { items: readonly string[] }) {
  return items.length === 0
    ? <EmptySuggested />
    : (
      <div>
        <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
          suggested questions
        </div>
        <ul className="space-y-1 font-serif italic text-(--color-muted) text-[15px]">
          {items.slice(0, 5).map((q, i) => <li key={i}>&ldquo;{q}&rdquo;</li>)}
        </ul>
      </div>
    );
}

function EmptySuggested() {
  return (
    <div className="mono text-[11px] text-(--color-faint) border border-dashed border-(--color-rule) px-4 py-3 rounded-sm">
      no suggested questions set for this code
    </div>
  );
}

function ScopeNote({
  included, excluded, code,
}: { included: readonly string[]; excluded: readonly string[]; code: string }) {
  return (
    <div className="pt-4 border-t border-(--color-rule)/70 mono text-[10px] tracking-[0.12em] text-(--color-faint) leading-[1.7]">
      <ScopeLine label="this code gives access to" tags={included} tone="muted" />
      <ScopeLine label="excluded" tags={excluded} tone="accent" />
      <div>code · {code}</div>
    </div>
  );
}

function ScopeLine({
  label, tags, tone,
}: { label: string; tags: readonly string[]; tone: 'muted' | 'accent' }) {
  const cls = tone === 'accent' ? 'text-(--color-accent)' : 'text-(--color-muted)';
  return tags.length > 0
    ? <div>{label}: <span className={cls}>{tags.join(' · ')}</span></div>
    : null;
}
