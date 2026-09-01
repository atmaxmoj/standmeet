// EmbedsSection —— /admin/embeds。owner 把某张码作为 <standmeet-chat> widget
// 暴露到别人的网站上，配来源白名单（embed 规划 2026-09-01）。
//
// 邻居是 codes / custom-pages（都在 access 组）：一个 embed 挂一张码，跟 custom page
// 挂一张码是同一件事的两种落地。写操作**在 admin 里做**（不像 custom-pages 那样只在 MCP）——
// 因为白名单是安全边界，owner 要在能看见全部 embed 的地方一处管完。

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Btn } from '@/components/admin/atoms/Btn';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListPane } from '@/components/admin/ListPane';
import { EmbedCreateModal } from '@/components/admin/modals/EmbedCreateModal';
import { ModalShell } from '@/components/admin/modals/ModalShell';
import { useCodes, type CodeView } from '@/lib/admin/use-codes';
import {
  useEmbeds, widgetSnippet, type CreatedEmbed, type EmbedsHook, type EmbedView,
} from '@/lib/admin/use-embeds';
import { useAction } from '@/lib/ui/use-action';
import { useReportError } from '@/lib/ui/use-report-error';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';
import { stampDay } from '@/lib/ui/format-time';

// codeStringFor —— embed 存的是 code_id（uuid），但贴进网站的标签要人读的码串（LABEL-XXX）。
// 码列表在这一页本来就为「新建时挑码」加载了，顺手拿它反查。查不到（码被删了）→ ''，
// 由调用方显示"code removed"。
function codeStringFor(codeID: string, codes: readonly CodeView[]): string {
  return codes.find((c) => c.id === codeID)?.code ?? '';
}

// unembeddedCodes —— 还没被任何 embed 挂着的码。一张码只能挂一个 embed（code_id 唯一）——
// 所以新建时的挑码器只列没挂过的，owner 挑不到一张已经挂了的码（后端那道唯一约束是 race 兜底）。
function unembeddedCodes(
  codes: readonly CodeView[], embeds: readonly EmbedView[],
): readonly CodeView[] {
  const taken = new Set(embeds.map((e) => e.code_id));
  return codes.filter((c) => !taken.has(c.id));
}

export function EmbedsSection() {
  const hook = useEmbeds();
  const codesHook = useCodes();
  const [editing, setEditing] = useState<EmbedView | null>(null);
  const [creating, setCreating] = useState(false);
  // revealed —— 刚建好的 embed（带只此一次的私钥）。设上就弹出完整 snippet 让 owner 复制走。
  const [revealed, setRevealed] = useState<CreatedEmbed | null>(null);
  useEffectErrorToast(hook.error);
  const openEdit = useCallback((e: EmbedView) => { setCreating(false); setEditing(e); }, []);
  const closeModal = useCallback(() => { setCreating(false); setEditing(null); }, []);
  return (
    <>
      <SectionHeader
        kicker="access · widgets"
        slug="embeds"
        count={hook.embeds.length > 0 ? String(hook.embeds.length) : ''}
        action={<NewEmbedBtn open={() => setCreating(true)} />}
      />
      <Intro />
      <EmbedsBody hook={hook} codes={codesHook.codes} onEdit={openEdit} />
      <ModalSlot
        open={creating || editing !== null}
        existing={editing}
        codes={codesHook.codes}
        available={unembeddedCodes(codesHook.codes, hook.embeds)}
        hook={hook}
        onClose={closeModal}
        onRevealed={setRevealed}
      />
      <RevealSlot embed={revealed} onClose={() => setRevealed(null)} />
    </>
  );
}

function RevealSlot({ embed, onClose }: { embed: CreatedEmbed | null; onClose: () => void }) {
  return embed ? <SnippetReveal embed={embed} onClose={onClose} /> : null;
}

function NewEmbedBtn({ open }: { open: () => void }) {
  const t = useTranslations('adminAccess.embeds');
  return <Btn kind="solid" onClick={() => open()}>{t('new')}</Btn>;
}

function Intro() {
  const t = useTranslations('adminAccess.embeds');
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      {t('intro')}
    </p>
  );
}

function EmbedsBody({
  hook, codes, onEdit,
}: { hook: EmbedsHook; codes: readonly CodeView[]; onEdit: (e: EmbedView) => void }) {
  return (
    <ListPane status={hook.status} count={hook.embeds.length} empty={<EmptyState />}>
      <EmbedTable rows={hook.embeds} codes={codes} onEdit={onEdit} />
    </ListPane>
  );
}

function EmptyState() {
  const t = useTranslations('adminAccess.embeds');
  return (
    <p className="reading italic text-(--color-muted)" data-testid="embed-list">{t('empty')}</p>
  );
}

function EmbedTable({
  rows, codes, onEdit,
}: { rows: readonly EmbedView[]; codes: readonly CodeView[]; onEdit: (e: EmbedView) => void }) {
  return (
    <div
      data-testid="embed-list"
      className="border border-(--color-rule) rounded-[3px] overflow-hidden"
    >
      <table className="w-full border-collapse">
        <TableHead />
        <tbody>
          {rows.map((e) => <EmbedRows key={e.id} embed={e} codes={codes} onEdit={onEdit} />)}
        </tbody>
      </table>
    </div>
  );
}

function TableHead() {
  const t = useTranslations('adminAccess.embeds');
  return (
    <thead className="bg-(--color-surface)/60 mono text-[9.5px] tracking-[0.16em] uppercase text-(--color-muted)">
      <tr>
        <Th text="embed" align="left" />
        <Th text={t('exposesCode')} align="left" />
        <Th text="origins" align="left" />
        <Th text="created" align="left" />
        <Th text="" align="right" />
      </tr>
    </thead>
  );
}

function Th({ text, align }: { text: string; align: 'left' | 'right' }) {
  const a = align === 'right' ? 'text-right' : 'text-left';
  return (
    <th className={`${a} px-4 py-2.5 border-b border-(--color-rule) font-normal`}>{text}</th>
  );
}

// EmbedRows —— 一个 embed 两行：一行元数据 + 动作，一行**贴进网站的那段代码**。
// 代码跟它属于同一个 embed，所以不另开抽屉：owner 建完当场就能复制走。
function EmbedRows({
  embed, codes, onEdit,
}: { embed: EmbedView; codes: readonly CodeView[]; onEdit: (e: EmbedView) => void }) {
  const code = codeStringFor(embed.code_id, codes);
  return (
    <>
      <MetaRow embed={embed} code={code} onEdit={onEdit} />
      <SnippetRow embed={embed} />
    </>
  );
}

function MetaRow({
  embed, code, onEdit,
}: { embed: EmbedView; code: string; onEdit: (e: EmbedView) => void }) {
  return (
    <tr
      data-testid={`embed-row-${embed.id}`}
      className="border-b border-(--color-rule)/40"
    >
      <LabelCell label={embed.label} />
      <CodeCell code={code} />
      <OriginsCell origins={embed.allowed_origins} />
      <DateCell iso={embed.created_at} />
      <ActionsCell embed={embed} onEdit={onEdit} />
    </tr>
  );
}

function LabelCell({ label }: { label: string }) {
  return (
    <td className="px-4 py-3 font-serif text-[16px] text-(--color-ink)">
      {label !== '' ? label : <span className="text-(--color-faint) italic">—</span>}
    </td>
  );
}

function CodeCell({ code }: { code: string }) {
  const t = useTranslations('adminAccess.embeds');
  return (
    <td className="px-4 py-3 mono text-[11px]">
      {code !== ''
        ? <span className="text-(--color-accent)">{code}</span>
        : <span className="text-(--color-faint) italic">{t('unknownCode')}</span>}
    </td>
  );
}

// OriginsCell —— 空 = 任何来源（安全上最松，明说而不是留白，免得读成"还没设"）。
function OriginsCell({ origins }: { origins: readonly string[] }) {
  const t = useTranslations('adminAccess.embeds');
  return (
    <td className="px-4 py-3 mono text-[10px] text-(--color-muted)" data-testid="embed-origins-cell">
      {origins.length > 0
        ? <OriginList origins={origins} />
        : <span className="text-(--color-amber)">{t('originsAny')}</span>}
    </td>
  );
}

function OriginList({ origins }: { origins: readonly string[] }) {
  return (
    <span className="text-(--color-ink)">
      {origins.map((o) => <span key={o} className="block">{o}</span>)}
    </span>
  );
}

function DateCell({ iso }: { iso: string }) {
  return <td className="px-4 py-3 mono text-[10px] text-(--color-muted)">{stampDay(iso)}</td>;
}

function ActionsCell({
  embed, onEdit,
}: { embed: EmbedView; onEdit: (e: EmbedView) => void }) {
  const t = useTranslations('adminAccess.embeds');
  const { removeEmbed } = useEmbeds();
  const run = useAction();
  return (
    <td className="px-4 py-3 text-right whitespace-nowrap">
      <button
        type="button" data-testid={`embed-edit-${embed.id}`}
        onClick={() => onEdit(embed)}
        className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      >
        {t('edit')}
      </button>
      <button
        type="button" data-testid={`embed-delete-${embed.id}`}
        onClick={() => void run(() => removeEmbed(embed.id), { success: t('deleted') })}
        className="ml-3 mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
      >
        {t('delete')}
      </button>
    </td>
  );
}

// SnippetRow —— 一行说明：完整 snippet（含私钥）只在**创建时**给一次（[[write-with-no-receipt]]
// 反过来：私钥是给一次的秘密）。列表里拿不到私钥，所以这里不复现可用 snippet，只标出 kid、
// 提示"要新的就删了重建"。真正贴走那段在创建后的一次性弹窗里。
function SnippetRow({ embed }: { embed: EmbedView }) {
  const t = useTranslations('adminAccess.embeds');
  return (
    <tr className="border-b border-(--color-rule)/40 last:border-b-0">
      <td colSpan={5} className="px-4 py-2.5 bg-(--color-surface)/30">
        <p className="mono text-[10px] text-(--color-faint)" data-testid={`embed-keynote-${embed.id}`}>
          {t('keyNote')}{' '}
          <span className="text-(--color-muted)">{t('kidLabel', { kid: embed.key_id.slice(0, 8) })}</span>
        </p>
      </td>
    </tr>
  );
}

// CopyButton —— 复制任意文本 + toast。reveal 弹窗复用它。
function CopyButton({ testid, text }: { testid: string; text: string }) {
  const t = useTranslations('adminAccess.embeds');
  const toast = useToast();
  const copy = useCallback(() => {
    typeof navigator !== 'undefined' && void navigator.clipboard?.writeText(text);
    toast.success(t('copied'));
  }, [text, toast, t]);
  return (
    <button
      type="button" data-testid={testid} onClick={copy}
      className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-accent) hover:underline"
    >
      {t('copySnippet')}
    </button>
  );
}

// SnippetReveal —— 创建后一次性弹出：完整可贴的 widget snippet（含私钥），复制走。
// 私钥只在这一刻拿得到，关掉就没了 —— 措辞要说清"现在复制，之后不再显示"。
function SnippetReveal({ embed, onClose }: { embed: CreatedEmbed; onClose: () => void }) {
  const t = useTranslations('adminAccess.embeds');
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const text = widgetSnippet(origin, embed.id, embed.key_id, embed.private_key);
  return (
    <ModalShell onClose={onClose} kicker={t('revealKicker')} title={t('revealTitle')} maxWidth={640}>
      <div className="px-7 py-6 space-y-4">
        <p className="reading-tight text-[13.5px] text-(--color-accent)">{t('revealWarning')}</p>
        <div className="flex items-center justify-between gap-4">
          <span className="mono text-[9px] tracking-[0.18em] uppercase text-(--color-faint)">
            {t('snippetLabel')}
          </span>
          <CopyButton testid="embed-reveal-copy" text={text} />
        </div>
        <pre
          data-testid="embed-reveal-snippet"
          className="mono text-[11.5px] text-(--color-ink) bg-(--color-surface)/40 border border-(--color-rule) rounded-[3px] p-3 overflow-x-auto whitespace-pre-wrap break-all"
        >{text}</pre>
      </div>
    </ModalShell>
  );
}

function ModalSlot({
  open, existing, codes, available, hook, onClose, onRevealed,
}: {
  open: boolean;
  existing: EmbedView | null;
  codes: readonly CodeView[];
  available: readonly CodeView[];
  hook: EmbedsHook;
  onClose: () => void;
  onRevealed: (e: CreatedEmbed) => void;
}) {
  const toast = useToast();
  const report = useReportError();
  const t = useTranslations('adminAccess.embeds');
  const onCreate = useCallback(async (codeID: string, label: string, origins: string[]) => {
    try {
      // 回执带着只此一次的私钥 → 立刻交给 reveal 弹窗（关掉列表就再也拿不到它）。
      const created = await hook.createEmbed({ code_id: codeID, label, allowed_origins: origins });
      onClose();
      onRevealed(created);
    } catch (e) { report(e); }
  }, [hook, report, onClose, onRevealed]);
  const onUpdate = useCallback(async (id: string, label: string, origins: string[]) => {
    try {
      await hook.updateEmbed(id, { label, allowed_origins: origins });
      toast.success(t('updated'));
      onClose();
    } catch (e) { report(e); }
  }, [hook, toast, report, t, onClose]);
  // 编辑：码锁死，picker 要含它自己那张（用全量 codes）。新建：只列没挂过的（available）。
  return open ? (
    <EmbedCreateModal
      existing={existing} codes={existing ? codes : available} onClose={onClose}
      onCreate={onCreate} onUpdate={onUpdate}
    />
  ) : null;
}
