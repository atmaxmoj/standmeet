// EmbedsSection —— /admin/embeds. Owner exposes a given code as a
// <standmeet-chat> widget on someone else's website, with an origin allowlist
// (embed plan 2026-09-01).
//
// Its neighbors are codes / microsites (all in the access group): an embed
// attaching a code and a microsite attaching a code are two shapes of the same
// idea. Writes happen **in admin** (unlike microsites, which is MCP-only) — because
// the allowlist is a security boundary, and the owner needs to manage it all in one
// place where every embed is visible.

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

// codeStringFor —— an embed stores code_id (a uuid), but the tag pasted into a
// website needs the human-readable code string (LABEL-XXX). The code list is
// already loaded on this page for "pick a code when creating", so reuse it for the
// reverse lookup. Not found (the code was deleted) → '', and the caller shows
// "code removed".
function codeStringFor(codeID: string, codes: readonly CodeView[]): string {
  return codes.find((c) => c.id === codeID)?.code ?? '';
}

// unembeddedCodes —— codes not yet attached to any embed. One code can only be
// attached to one embed (code_id is unique) — so the code picker at creation time
// only lists unattached ones, and the owner can't pick a code that's already
// attached (the backend's uniqueness constraint is the race-condition backstop).
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
  // revealed —— an embed just created (carrying its one-time private key). Setting
  // it pops up the full snippet for the owner to copy.
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

// EmbedRows —— two rows per embed: one metadata + actions row, one for **the code
// snippet pasted into the website**. The snippet belongs to the same embed, so it
// doesn't get its own drawer: the owner can copy it right away once it's created.
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

// OriginsCell —— empty = any origin (the loosest security setting; state it
// explicitly rather than leaving it blank, so it doesn't read as "not set yet").
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

// SnippetRow —— one line of explanation: the full snippet (with the private key) is
// given only once, **at creation time** ([[write-with-no-receipt]] in reverse: the
// private key is a secret given once). The private key can't be retrieved from the
// list, so no usable snippet is reproduced here — just the kid, with a note to
// "delete and recreate for a new one". The actual snippet to paste lives in the
// one-time popup right after creation.
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

// CopyButton —— copies arbitrary text + toasts. Reused by the reveal popup.
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

// SnippetReveal —— pops up once after creation: the full paste-ready widget snippet
// (with the private key), to copy. The private key is only obtainable at this
// moment — closing the dialog loses it, so the copy must say "copy now, this won't
// show again".
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
      // The response carries the one-time private key → hand it straight to the
      // reveal popup (closing the list loses it for good).
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
  // Edit: the code is locked in, so the picker must include its own code (use the
  // full codes list). Create: only list unattached ones (available).
  return open ? (
    <EmbedCreateModal
      existing={existing} codes={existing ? codes : available} onClose={onClose}
      onCreate={onCreate} onUpdate={onUpdate}
    />
  ) : null;
}
