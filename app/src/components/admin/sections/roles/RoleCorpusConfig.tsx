// RoleCorpusConfig —— the **corpus URI editor** on the role card (the owner's control panel
// for gate 1).
//
// Corpus admission is this product's core access control: a role = "a positive list of
// corpus URIs the agent can read" (in /admin/roles's own words). But this positive list
// **used to be writable only once, in the "+ NEW ROLE" modal** — once the role existed, the
// card kept only the read-only number `CORPUS · N URIs`, and the owner could never edit it
// again (F-A-11).
//
// The consequence isn't "inconvenient": the owner had no way to narrow an over-broad grant.
// `subjectivity://**` grants record notes (CV: real name / education / employer) alongside
// stance notes together, and the only fix is to make it per-entry — that edit action didn't
// exist in the GUI.
//
// All genres are treated the same (wiki / output / writing / subjectivity share one glob
// syntax, none is special):
//   wiki://thinking/**            an entire branch
//   subjectivity://standpoint     grants just this one entry (a match-any positive list,
//                                 granularity as fine as needed)
//
// Shape copied from RoleDockConfig: inline edit on the card → full PUT write-back (only
// corpus_uris changes), frozen into subsequent sessions.

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { CorpusScopePicker } from '@/components/admin/sections/corpus/CorpusScopePicker';
import { roleUpdatePayload, useRoles, type RoleView } from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

// PUBLIC_ROLE_NAME —— the builtin public role's name (backend access.PublicRoleName, must
// not be renamed).
const PUBLIC_ROLE_NAME = 'public';

// RoleCorpusConfig —— the public identity **has no positive list**, so this slot isn't an
// editor, it's a statement.
//
// It used to show the same row of checkboxes as other roles, with `wiki — all of it` lit
// up. Those three entries were default values seeded at claim time that the owner never
// chose — but sitting on the settings page, checked, saying "all of it", they read like a
// decision. So the same fact ended up with two copies of data: the per-entry `published`
// toggle, and this glob list. Neither side knew about the other, and the result was a
// stranger with no code reading notes marked PRIVATE (F-D-7).
//
// Now this slot just states where the one true source of that data lives: **the toggle the
// owner flips on each entry's own card**.
export function RoleCorpusConfig({ role }: { role: RoleView }) {
  return role.name === PUBLIC_ROLE_NAME
    ? <PublicCorpusNote />
    : <EditableCorpusConfig role={role} />;
}

function PublicCorpusNote() {
  const t = useTranslations('adminAccess');
  return (
    <div className="mt-2 grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-2 items-start">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) pt-1.5">
        {t('common.corpus')}
      </span>
      <p
        className="reading-tight text-[11px] text-(--color-muted)"
        data-testid="role-corpus-public-note"
      >
        {t('roleCorpus.publicIsPublished')}
      </p>
    </div>
  );
}

function EditableCorpusConfig({ role }: { role: RoleView }) {
  const t = useTranslations('adminAccess');
  const roles = useRoles();
  const run = useAction();
  const [text, setText] = useState(() => role.corpus_uris.join('\n'));
  const onSave = useCallback(
    () => run(
      () => roles.updateRole(role.id, roleUpdatePayload(role, { corpus_uris: parseURIs(text) })),
      { success: `Corpus URIs updated for ${role.name}` },
    ),
    [role, roles, run, text],
  );
  return (
    <div className="mt-2 grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-2 items-start">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) pt-1.5">
        {t('common.corpus')}
      </span>
      <div className="flex flex-col gap-2">
        <p className="reading-tight text-[11px] text-(--color-muted)" data-testid="role-corpus-help">
          {t('roleCorpus.help')}
        </p>
        {/*
          Check boxes on the real tree (F-A-14). The hand-typed box stays and stays synced
          side-by-side — a glob the picker can't recognize (no tree row corresponds to it)
          can only be edited there, and the owner needs to see the full text of the grant.
        */}
        <CorpusScopePicker
          value={parseURIs(text)}
          onChange={(next) => setText(next.join('\n'))}
          testid={`role-corpus-picker-${role.name}`}
        />
        <span className="mono text-[9.5px] text-(--color-faint) mt-1">
          {t('common.byHand')}
        </span>
        <textarea
          className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[13px] font-mono min-h-[84px]"
          value={text}
          placeholder={'wiki://thinking/**\nsubjectivity://standpoint\noutput://public/**'}
          onChange={(e) => setText(e.target.value)}
          data-testid={`role-corpus-uris-${role.name}`}
          spellCheck={false}
        />
        <span className="mono text-[9.5px] text-(--color-faint)">
          {t('common.rawDenied')}
        </span>
        <CorpusSaveBtn role={role} onSave={onSave} />
      </div>
    </div>
  );
}

// parseURIs —— textarea → positive list (one entry per line, trimmed, blank lines dropped).
// Same parsing as RoleCreateModal.
function parseURIs(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter((s) => s !== '');
}

function CorpusSaveBtn({ role, onSave }: { role: RoleView; onSave: () => void }) {
  const t = useTranslations('adminAccess');
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onSave}
        data-testid={`role-corpus-save-${role.name}`}
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent)"
      >
        {t('common.saveCorpus')}
      </button>
    </div>
  );
}
