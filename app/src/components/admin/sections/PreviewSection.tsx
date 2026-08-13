// PreviewSection —— /admin/preview。design 源 admin.js PreviewSection
// (1154-1219)。左 sidebar = code picker（每张 code 卡 + BYOAI）；右 panel
// = 模拟 visitor view（banner + welcome prose + suggested questions）。
// 实际 visitor 看到的是 / surface + SessionStrip；这里 inline 模拟那个
// 体验让 owner 预览 scoped view 而不需要真切 session。

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
        title="preview"
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

// roleLabel —— 角色的**名字**，拿不到才退回截断的 id。
//
// 这张卡原本印的是 `role 0863240e…` —— 一个截断的 UUID，而产品其他每一处都用角色名
// （`invited` / `public` / `ext-mcp-probe`）。owner 看着两张码显示同一串 `0863240e…`，
// 知道它们共用一个角色，却不知道是哪个（UX-78）。名字一直在手边：`useRoles()` 已经在
// 这个 admin 里拉过，`RoleView.name` 就是它。
//
// 拿不到时退回 id 而不是留空 —— 一张码指向已删除的角色是真会发生的状态，
// 让它可见比让它消失好。
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

// CodedPreview —— 这个面写着 "PREVIEW · VISITOR VIEW",所以它必须渲染**访客那句话**。
//
// 上一版是 admin 自己用 adminPages.preview.codedWelcome* 拼的,还把 assumed_role_id 前 8 位
// 印在句子里 —— 一个访客永远不会看到内部 id,而 owner 也就永远看不到这张码真正呈现什么(F-C-9)。
// 现在读 visitor.codedWelcome:跟访客同一份文案,handle 和 code label 都是真的。
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
          // greeting —— 访客那边是 "Hi, {名字}";预览里还没有人,所以用 role 的问候语位置
          // 放一句中性的,其余整句照访客那份走。
          greeting: t('previewGreeting'),
          handle,
          codeLabel: code.label,
          accent: (chunks) => <span className="text-(--color-accent)">{chunks}</span>,
        })}
      </p>
      {/* 访客读到的是三段:欢迎 + 这一句脱敏说明 + 引导。owner 预览时最该看见的正是第二句 ——
          这张码到底会不会告诉对方"有些话不给看"。 */}
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
