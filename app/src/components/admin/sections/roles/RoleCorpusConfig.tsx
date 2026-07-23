// RoleCorpusConfig —— role 卡上的 **corpus URI 编辑器**（gate 1 的 owner 控制面）。
//
// corpus 准入是这个产品的核心访问控制：role = "a positive list of corpus URIs the agent can read"
// （/admin/roles 自己的原话）。但这个正列表**过去只能在「+ NEW ROLE」弹窗里写一次** —— role 建好
// 之后卡片上只剩 `CORPUS · N URIs` 这个只读数字，owner 再也改不了（F-A-11）。
//
// 后果不是"不方便"：owner 无法收窄一条过宽的授权。`subjectivity://**` 会把 record 笔记（CV：真名/
// 学历/雇主）跟 stance 一起授出去，而唯一的修法就是把它改成逐条 —— 那个编辑动作在 GUI 上不存在。
//
// 所有 genre 一视同仁（wiki / output / writing / subjectivity 是同一套 glob，没有谁特殊）：
//   wiki://thinking/**            某个 branch 整棵
//   subjectivity://standpoint     只授这一条（match-any 的正列表，粒度任意细）
//
// 形态照抄 RoleDockConfig：卡上 inline 编辑 → 全量 PUT 回写（只有 corpus_uris 变），冻进后续 session。

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { CorpusScopePicker } from '@/components/admin/sections/corpus/CorpusScopePicker';
import { roleUpdatePayload, useRoles, type RoleView } from '@/lib/admin/use-roles';
import { useAction } from '@/lib/ui/use-action';

export function RoleCorpusConfig({ role }: { role: RoleView }) {
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
          从真树上勾（F-A-14）。手写框留着并并排同步显示 —— picker 认不出来的 glob（树上没有哪一行
          对应它的那种）只能在那里改，而且 owner 得看得见这份授权的全文。
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

// parseURIs —— textarea → 正列表（一行一条，trim，丢空行）。同 RoleCreateModal 的解析。
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
