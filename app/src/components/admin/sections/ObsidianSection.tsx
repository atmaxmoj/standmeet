// ObsidianSection —— /admin/obsidian. The real, working import/export lives in the shared
// ObsidianBar (a vault-folder picker → POST /obsidian/import, and export → GET /obsidian/export) —
// the same component the writings section uses. This page used to be a dead mockup (a fake vault
// path + hardcoded stats + two buttons with no onClick); it now renders the real actions (F-L-1).
// No live sync / file watcher by design — two manual actions.

'use client';

import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ObsidianBar } from '@/components/admin/sections/writings/ObsidianBar';

export function ObsidianSection() {
  const t = useTranslations('adminCorpus.obsidian');
  return (
    <>
      <SectionHeader
        kicker="integrations · vault"
        slug="obsidian"
        action={
          <span className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-faint)">
            {t('manualMode')}
          </span>
        }
      />
      {/* 这段说明以前在卡**里面**、10px mono、最淡的灰、42em 里再折一次 —— 而全页最重要的
          那句就在里头：*"No live sync / file watcher — two manual actions."* 那是产品主动说
          自己不做什么，也是 owner 判断「我是不是该等它自动同步」的唯一依据，它不该是全页最小
          的字（UX-63 的后一半）。
          隔壁 /admin/sources 描述同一类事情用的是衬线正文（`reading text-[14.5px]`）——
          两个兄弟页对同一类东西说话，声音要一样。这里照抄那一处的写法，不是新发明一种。 */}
      <p className="reading text-[14.5px] text-(--color-muted) mb-2 max-w-[54em]"
        data-testid="obsidian-intro">
        {t('help')}
      </p>
      {/* 「不做实时同步」单独一句、墨色：它是这一页最该被读到的一句，而不是说明的尾巴。 */}
      <p className="reading text-[14.5px] text-(--color-ink) mb-6 max-w-[54em]"
        data-testid="obsidian-no-sync">
        {t('noSync')}
      </p>
      <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50 max-w-[640px]">
        <div className="sm-smallcaps mb-3">{t('importExport')}</div>
        <ObsidianBar onImported={() => { /* no corpus list to refresh on this page */ }} />
      </div>
    </>
  );
}
