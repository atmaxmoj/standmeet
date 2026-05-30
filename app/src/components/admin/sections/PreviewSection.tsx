// PreviewSection —— /admin/preview。design 源 admin.js PreviewSection
// (1154-1219)。左 sidebar = code picker（每张 code 卡 + BYOAI）；右 panel
// = 模拟 visitor view（banner + welcome prose + suggested questions）。
// 实际 visitor 看到的是 / surface + SessionStrip；这里 inline 模拟那个
// 体验让 owner 预览 scoped view 而不需要真切 session。

'use client';

import { useState } from 'react';

import Link from 'next/link';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { useCodes, type CodesHook, type CodeView } from '@/lib/admin/use-codes';

export function PreviewSection() {
  const hook = useCodes();
  const firstCode = deriveFirstCode(hook);
  const [selected, setSelected] = useState<string>(firstCode);
  return (
    <>
      <SectionHeader
        kicker="access · external view"
        title="preview"
        action={
          <Link href="/" target="_blank" className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)">
            open public ↗
          </Link>
        }
      />
      <PreviewBody hook={hook} selected={selected} setSelected={setSelected} />
    </>
  );
}

function deriveFirstCode(hook: CodesHook): string {
  return hook.status === 'ready' && hook.codes.length > 0 ? hook.codes[0]!.id : 'byoai';
}

function PreviewBody({ hook, selected, setSelected }: {
  hook: CodesHook; selected: string; setSelected: (s: string) => void;
}) {
  return hook.status === 'ready' ? (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
      <CodePicker codes={hook.codes} selected={selected} onPick={setSelected} />
      <PreviewFrame codes={hook.codes} selected={selected} />
    </div>
  ) : (
    <div className="mono text-[11px] text-(--color-muted)">loading codes…</div>
  );
}

function CodePicker({ codes, selected, onPick }: {
  codes: readonly CodeView[]; selected: string; onPick: (s: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="code-picker">
      <div className="sm-smallcaps mb-1">see-as · code</div>
      {codes.map((c) => (
        <CodePickerCard key={c.id} code={c} active={selected === c.id} onClick={() => onPick(c.id)} />
      ))}
      <ByoaiPickerCard active={selected === 'byoai'} onClick={() => onPick('byoai')} />
    </div>
  );
}

function CodePickerCard({ code, active, onClick }: { code: CodeView; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`border rounded-[3px] p-3 text-left cursor-pointer transition-colors ${
        active
          ? 'border-(--color-ink) bg-(--color-surface)'
          : 'border-(--color-rule) bg-transparent hover:border-(--color-ink)/40'
      }`}
    >
      <div className="font-serif text-[15px] text-(--color-ink)">{code.label}</div>
      <div className="mono text-[10px] text-(--color-muted) mt-0.5">
        {code.code} · role {code.assumed_role_id.slice(0, 8)}…
      </div>
    </button>
  );
}

function ByoaiPickerCard({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`border rounded-[3px] p-3 text-left cursor-pointer transition-colors ${
        active
          ? 'border-(--color-ink) bg-(--color-surface)'
          : 'border-(--color-rule) bg-transparent hover:border-(--color-ink)/40'
      }`}
    >
      <div className="font-serif text-[15px] text-(--color-ink)">BYOAI · anonymous</div>
      <div className="mono text-[10px] text-(--color-muted) mt-0.5">public scope only</div>
    </button>
  );
}

function PreviewFrame({ codes, selected }: { codes: readonly CodeView[]; selected: string }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] bg-(--color-paper) p-6 min-h-[240px]" data-testid="preview-frame">
      <div className="sm-smallcaps mb-4">preview · visitor view</div>
      {selected === 'byoai'
        ? <ByoaiPreview />
        : <CodedPreview code={codes.find((c) => c.id === selected) ?? null} />}
    </div>
  );
}

function ByoaiPreview() {
  return (
    <>
      <PreviewBanner>
        <span className="text-(--color-accent)">byoai mode</span>
        <BannerDot />
        <span>model · visitor-supplied</span>
        <BannerDot />
        <span>public scope</span>
      </PreviewBanner>
      <p className="font-serif text-[17px] text-(--color-ink) mt-4 leading-[1.55] max-w-[48em]">
        Hi. You&apos;re running on your own API key — pay for inference, public slice only.
        Private topics return a &ldquo;need a code&rdquo; response.
      </p>
    </>
  );
}

function CodedPreview({ code }: { code: CodeView | null }) {
  return code === null ? (
    <p className="mono text-[11px] text-(--color-faint)">select a code from the left</p>
  ) : (
    <>
      <PreviewBanner>
        <span className="text-(--color-accent)">{code.label}</span>
        <BannerDot />
        <span>code · {code.code}</span>
      </PreviewBanner>
      <p className="font-serif text-[17px] text-(--color-ink) mt-4 leading-[1.55] max-w-[48em]">
        Welcome. You&apos;ve come in on <span className="text-(--color-accent)">{code.label}</span>.
        {' '}This code assumes role <span className="mono text-[14px]">{code.assumed_role_id.slice(0, 8)}…</span>.
      </p>
      <SuggestedBlock questions={code.suggested_questions} />
    </>
  );
}

function SuggestedBlock({ questions }: { questions?: string[] }) {
  return questions && questions.length > 0 ? (
    <div className="mt-5">
      <div className="sm-smallcaps mb-1.5">suggested by you</div>
      <ul className="flex flex-col gap-1 list-none p-0 m-0">
        {questions.slice(0, 4).map((q, i) => (
          <li key={i} className="font-serif italic text-[15px] text-(--color-muted)">
            &ldquo;{q}&rdquo;
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}

function PreviewBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mono text-[10.5px] tracking-[0.06em] text-(--color-muted) flex items-baseline gap-2 flex-wrap py-2 px-3 border border-(--color-rule) rounded-[3px] bg-(--color-surface)/40">
      <span className="inline-block w-[6px] h-[6px] rounded-full bg-(--color-accent) shrink-0 relative top-[-1px]" />
      {children}
    </div>
  );
}

function BannerDot() {
  return <span className="text-(--color-faint)">·</span>;
}
