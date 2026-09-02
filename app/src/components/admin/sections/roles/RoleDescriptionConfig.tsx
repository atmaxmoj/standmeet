// RoleDescriptionConfig —— the **description editor** on the role card. description used to
// be writable only once, in the "+ NEW ROLE" modal; once the role existed, the card printed
// it as a read-only line the owner could never edit again (found during a manual owner
// audit: a placeholder description named D was stuck unchangeable). Shape copied from
// RoleDockConfig/RoleGhostConfig: inline edit on the card → full PUT write-back (via
// roleUpdatePayload, expressing only the description change, every other field preserved
// as-is).

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { roleUpdatePayload, useRoles, type RoleView } from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

export function RoleDescriptionConfig({ role }: { role: RoleView }) {
  const t = useTranslations('adminAccess');
  const roles = useRoles();
  const run = useAction();
  const [text, setText] = useState<string>(role.description);
  const onSave = useCallback(
    () => run(
      () => roles.updateRole(role.id, roleUpdatePayload(role, { description: text.trim() })),
      { success: `About updated for ${role.name}` },
    ),
    [role, roles, run, text],
  );
  return (
    <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-1 items-start mt-0.5">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) pt-1.5">
        {t('roleDesc.label')}
      </span>
      <div className="flex flex-col gap-1.5 min-w-0">
        {/* rows=2 **plus** resize-none meant the owner could neither see the back half of
            what they wrote nor drag the box bigger. Both system roles' about text runs
            four or five lines of prose, so the card text cut off mid-sentence
            ("…the code that goes out when you" then nothing — seen live while taking
            screenshots). Same class of bug as UX-61: the edit box smaller than the thing
            it edits. */}
        <textarea
          className="w-full min-w-0 bg-transparent border-b border-(--color-rule) py-1 reading-tight text-[13.5px] text-(--color-muted) resize-y"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('roleDesc.placeholder')}
          data-testid={`role-desc-input-${role.name}`}
        />
        <button
          type="button"
          onClick={() => void onSave()}
          data-testid={`role-desc-save-${role.name}`}
          className="self-start mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
        >
          {t('roleDesc.save', { name: role.name })}
        </button>
      </div>
    </div>
  );
}
