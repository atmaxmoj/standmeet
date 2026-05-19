// page-renderers —— insight / project 行的 renderRow + empty 工厂。
// 拆出来才不让 PageSection 涉及 if / 长函数。

import type { ListEditorRender } from '@/components/admin/sections/page/ListEditor';
import { EditField } from '@/components/admin/sections/page/EditField';
import { StringListEditor } from '@/components/admin/sections/page/StringListEditor';

// Reuse the page editor's mutable types directly.
import type { MutableInsight, MutableProject } from '@/lib/admin/use-page-editor';

export type InsightDraft = MutableInsight;
export type ProjectDraft = MutableProject;

export const insightRender: ListEditorRender<InsightDraft> = {
  empty: () => ({ id: 'i-' + Date.now().toString(36), thesis: '', context: '', body: '' }),
  row: (item, patch) => <InsightRow item={item} patch={patch} />,
};

function InsightRow({
  item, patch,
}: { item: InsightDraft; patch: (p: Partial<InsightDraft>) => void }) {
  return (
    <div className="space-y-3">
      <EditField label="thesis · one bold sentence" value={item.thesis}
        onChange={(v) => patch({ thesis: v })}
        placeholder="The one-line claim someone could screenshot." multiline={2} />
      <EditField label="context · where it came up" value={item.context}
        onChange={(v) => patch({ context: v })}
        placeholder="e.g. from a discussion on hiring" />
      <EditField label="expanded body" value={item.body}
        onChange={(v) => patch({ body: v })}
        placeholder="2–3 sentences." multiline={4} />
    </div>
  );
}

export const projectRender: ListEditorRender<ProjectDraft> = {
  empty: () => ({ id: 'p-' + Date.now().toString(36), name: '', tagline: '', lines: [''], url: '' }),
  row: (item, patch) => <ProjectRow item={item} patch={patch} />,
};

function ProjectRow({
  item, patch,
}: { item: ProjectDraft; patch: (p: Partial<ProjectDraft>) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <EditField label="name" value={item.name} onChange={(v) => patch({ name: v })} />
        <EditField label="tagline" value={item.tagline} onChange={(v) => patch({ tagline: v })} />
      </div>
      <StringListEditor label="status lines · honest details"
        items={item.lines}
        onChange={(lines) => patch({ lines })}
        placeholder="e.g. ~12 new users/day. D30 retention 6%."
      />
      <EditField label="url · optional" value={item.url ?? ''}
        onChange={(v) => patch({ url: v })}
        placeholder="e.g. lucerna.dev (no protocol)" />
    </div>
  );
}
