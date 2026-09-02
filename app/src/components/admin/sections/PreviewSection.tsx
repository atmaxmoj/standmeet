// PreviewSection —— /admin/preview. Design source: admin.js PreviewSection
// (1154-1219). Left sidebar = code picker (one card per code + BYOAI); right panel
// = a simulated visitor view (banner + welcome prose + suggested questions).
// What a real visitor sees is the / surface + SessionStrip; this simulates that
// experience inline so the owner can preview a scoped view without a real session.

'use client';

import { useState } from 'react';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { useCodes, type CodesHook, type CodeView } from '@/lib/admin/use-codes';
import { useRoles, type RoleView } from '@/lib/admin/use-roles';

export function PreviewSection() {
  const t = useTranslations('adminPages.preview');
  const hook = useCodes();
  const firstCode = deriveFirstCode(hook);
  const [selected, setSelected] = useState<string>(firstCode);
  return (
    <>
      <SectionHeader
        kicker="access · external view"
        slug="preview"
        action={
          <Link href="/" target="_blank" className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)">
            {t('openPublic')} ↗
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
  const t = useTranslations('adminPages.preview');
  return hook.status === 'ready' ? (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
      <CodePicker codes={hook.codes} selected={selected} onPick={setSelected} />
      <PreviewFrame codes={hook.codes} selected={selected} />
    </div>
  ) : (
    <div className="mono text-[11px] text-(--color-muted)">{t('loading')}</div>
  );
}

function CodePicker({ codes, selected, onPick }: {
  codes: readonly CodeView[]; selected: string; onPick: (s: string) => void;
}) {
  const t = useTranslations('adminPages.preview');
  return (
    <div className="flex flex-col gap-1.5" data-testid="code-picker">
      <div className="sm-smallcaps mb-1">{t('seeAsCode')}</div>
      {codes.map((c) => (
        <CodePickerCard key={c.id} code={c} active={selected === c.id} onClick={() => onPick(c.id)} />
      ))}
      <ByoaiPickerCard active={selected === 'byoai'} onClick={() => onPick('byoai')} />
    </div>
  );
}

// roleLabel —— the role's **name**; falls back to a truncated id only when the name
// isn't available.
//
// This card used to print `role 0863240e…` — a truncated UUID, while every other
// place in the product uses the role name (`invited` / `public` / `ext-mcp-probe`).
// The owner would see two codes displaying the same string `0863240e…` and know they
// shared a role, without knowing which one (UX-78). The name was always at hand:
// `useRoles()` is already fetched in this admin page, and `RoleView.name` is it.
//
// Falls back to the id rather than leaving it blank when unavailable — a code
// pointing at a deleted role is a real state that happens; making it visible is
// better than making it disappear.
function roleLabel(roleId: string, roles: readonly RoleView[]): string {
  return roles.find((r) => r.id === roleId)?.name ?? `${roleId.slice(0, 8)}…`;
}

function CodePickerCard({ code, active, onClick }: { code: CodeView; active: boolean; onClick: () => void }) {
  const t = useTranslations('adminPages.preview');
  const roles = useRoles();
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
        {t('cardCodeRole', { code: code.code, role: roleLabel(code.assumed_role_id, roles.roles) })}
      </div>
    </button>
  );
}

function ByoaiPickerCard({ active, onClick }: { active: boolean; onClick: () => void }) {
  const t = useTranslations('adminPages.preview');
  return (
    <button
      type="button" onClick={onClick}
      className={`border rounded-[3px] p-3 text-left cursor-pointer transition-colors ${
        active
          ? 'border-(--color-ink) bg-(--color-surface)'
          : 'border-(--color-rule) bg-transparent hover:border-(--color-ink)/40'
      }`}
    >
      <div className="font-serif text-[15px] text-(--color-ink)">{t('byoaiCardTitle')}</div>
      <div className="mono text-[10px] text-(--color-muted) mt-0.5">{t('byoaiCardScope')}</div>
    </button>
  );
}

function PreviewFrame({ codes, selected }: { codes: readonly CodeView[]; selected: string }) {
  const t = useTranslations('adminPages.preview');
  return (
    <div className="border border-(--color-rule) rounded-[3px] bg-(--color-paper) p-6 min-h-[240px]" data-testid="preview-frame">
      <div className="sm-smallcaps mb-4">{t('frameTitle')}</div>
      {selected === 'byoai'
        ? <ByoaiPreview />
        : <CodedPreview code={codes.find((c) => c.id === selected) ?? null} />}
    </div>
  );
}

function ByoaiPreview() {
  const t = useTranslations('adminPages.preview');
  return (
    <>
      <PreviewBanner>
        <span className="text-(--color-accent)">{t('byoaiBannerMode')}</span>
        <BannerDot />
        <span>{t('byoaiBannerModel')}</span>
        <BannerDot />
        <span>{t('byoaiBannerScope')}</span>
      </PreviewBanner>
      <p className="font-serif text-[17px] text-(--color-ink) mt-4 leading-[1.55] max-w-[48em]">
        {t('byoaiWelcome')}
      </p>
    </>
  );
}

// CodedPreview —— this panel is labeled "PREVIEW · VISITOR VIEW", so it must render **the
// visitor's actual copy**.
//
// The previous version assembled it itself from adminPages.preview.codedWelcome*, and printed
// the first 8 chars of assumed_role_id in the sentence — a visitor never sees the internal id,
// and the owner would then never see what this code actually presents (F-C-9).
// It now reads visitor.codedWelcome: the same copy the visitor gets, with a real handle and code label.
function CodedPreview({ code }: { code: CodeView | null }) {
  const t = useTranslations('adminPages.preview');
  const tv = useTranslations('visitor.chatRoom');
  const session = useAdminSession();
  const handle = session.kind === 'ready' ? session.session.handle : '';
  return code === null ? (
    <p className="mono text-[11px] text-(--color-faint)">{t('selectCode')}</p>
  ) : (
    <>
      <PreviewBanner>
        <span className="text-(--color-accent)">{code.label}</span>
        <BannerDot />
        <span>{t('codedBannerCode', { code: code.code })}</span>
      </PreviewBanner>
      <p className="font-serif text-[17px] text-(--color-ink) mt-4 leading-[1.55] max-w-[48em]">
        {tv.rich('codedWelcome', {
          // greeting —— on the visitor side it's "Hi, {name}"; there's no one in the preview yet,
          // so this puts a neutral phrase in the role's greeting slot, the rest of the sentence
          // follows the visitor copy as-is.
          greeting: t('previewGreeting'),
          handle,
          codeLabel: code.label,
          accent: (chunks) => <span className="text-(--color-accent)">{chunks}</span>,
        })}
      </p>
      {/* The visitor reads three parts: welcome + this redaction note + a lead-in. What the owner
          most needs to see in preview is the second part — whether this code actually tells the
          visitor "some things aren't shown to you". */}
      <p className="font-serif text-[15px] text-(--color-muted) mt-2 leading-[1.55] max-w-[48em]">
        {tv('codedRedaction', { handle })}
      </p>
      <SuggestedBlock questions={code.ghosts} />
    </>
  );
}

function SuggestedBlock({ questions }: { questions?: string[] }) {
  const t = useTranslations('adminPages.preview');
  return questions && questions.length > 0 ? (
    <div className="mt-5">
      <div className="sm-smallcaps mb-1.5">{t('suggestedByYou')}</div>
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
