// CodeCardGhost — the ghost-evidence control on a code card, split out of CodeCard (which was at its
// line budget). F-A-10 per-code override of the ghost-evidence rule, 3 states: inherit (from role,
// null) / require (true) / allow (false). Code overrides role. Save → PATCH /ghost-evidence.

import { useTranslations } from 'next-intl';

import { MetaPair } from '@/components/admin/atoms/MetaPair';
import { SelectField } from '@/components/atoms/SelectField';
import { ghostFromSelect, ghostToSelect } from '@/lib/admin/code-ghost';
import { useCodes, type CodeView } from '@/lib/admin/use-codes';
import { useAction } from '@/lib/ui/use-action';

export function GhostEvidenceCol({ code }: { code: CodeView }) {
  const t = useTranslations('adminAccess');
  const { setGhostEvidence } = useCodes();
  const run = useAction();
  const onPick = (v: string) => run(
    () => setGhostEvidence(code.id, ghostFromSelect(v)),
    { success: t('codeCard.toast.ghostUpdated', { code: code.code }) },
  );
  return (
    <MetaPair label={<GhostEvidenceLabel />}>
      <SelectField
        className="min-w-0 max-w-full"
        mono
        value={ghostToSelect(code.require_ghost_evidence)}
        onChange={(e) => void onPick(e.target.value)}
        testid={`code-ghost-evidence-${code.code}`}
      >
        <option value="inherit">{t('codeGhost.inherit')}</option>
        <option value="on">{t('codeGhost.on')}</option>
        <option value="off">{t('codeGhost.off')}</option>
      </SelectField>
    </MetaPair>
  );
}

// GhostEvidenceLabel — the "ghost evidence" name + a "?" help dot whose tooltip reuses the roles
// panel's explanation (roleGhost.help), so the two can't drift (owner: "不然不清楚是什么").
function GhostEvidenceLabel() {
  const t = useTranslations('adminAccess');
  return (
    <span className="inline-flex items-center gap-1.5">
      {t('codeGhost.label')}
      <span
        data-testid="code-ghost-evidence-help"
        title={t('roleGhost.help')}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-(--color-muted)/50 text-(--color-muted) mono text-[8px] leading-none cursor-help normal-case tracking-normal"
      >
        ?
      </span>
    </span>
  );
}
