// PromptsSection —— /admin/prompts。design 源 docs/design/project/admin.js
// PromptsSection (1176-1209)。两栏卡片 list；public [system] pill 不可删；
// 创建弹层：name + description + body (serif textarea，body 是写作物)。

'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { Btn } from '@/components/admin/atoms/Btn';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { CardGridSkeleton } from '@/components/skeletons/CardGridSkeleton';
import {
  usePrompts, type PromptsHook, type PromptView, type WritePromptInput,
} from '@/lib/admin/use-prompts';
import { useAction } from '@/lib/ui/use-action';
import { useReportError } from '@/lib/ui/use-report-error';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function PromptsSection() {
  const hook = usePrompts();
  const [creating, setCreating] = useState(false);
  useEffectErrorToast(hook.error);
  return (
    <>
      <SectionHeader
        kicker="access · personas"
        title="prompts"
        count={titleCount(hook)}
        action={<NewPromptBtn onClick={() => setCreating(true)} />}
      />
      <Intro />
      <PromptsBody hook={hook} />
      {creating && (
        <PromptCreateModal onClose={() => setCreating(false)} onCreate={hook.createPrompt} />
      )}
    </>
  );
}

function NewPromptBtn({ onClick }: { onClick: () => void }) {
  const t = useTranslations('adminAccess');
  return (
    <button
      type="button"
      data-testid="prompt-new"
      onClick={onClick}
      className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors"
    >
      {t('prompts.new')}
    </button>
  );
}

function titleCount(hook: PromptsHook): string {
  return hook.status === 'ready' ? `${hook.prompts.length}` : '';
}

function Intro() {
  const t = useTranslations('adminAccess');
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      {t('prompts.intro')}
    </p>
  );
}

function PromptsBody({ hook }: { hook: PromptsHook }) {
  const loading = hook.status === 'idle' || hook.status === 'loading';
  return loading ? <CardGridSkeleton /> : <PromptList hook={hook} />;
}

function PromptList({ hook }: { hook: PromptsHook }) {
  return hook.prompts.length === 0
    ? <EmptyPrompts />
    : (
      <ul
        className="grid grid-cols-1 lg:grid-cols-2 gap-3.5"
        data-testid="prompt-list"
      >
        {hook.prompts.map((p) => (
          <li key={p.id} data-testid={`prompt-row-${p.name}`}>
            <PromptCard prompt={p} onDelete={hook.deletePrompt} />
          </li>
        ))}
      </ul>
    );
}

function EmptyPrompts() {
  const t = useTranslations('adminAccess');
  return (
    <p className="reading italic text-(--color-muted)" data-testid="prompt-list">
      {t('prompts.empty')}
    </p>
  );
}

function PromptCard({
  prompt, onDelete,
}: { prompt: PromptView; onDelete: (id: string) => Promise<void> }) {
  return (
    <article className="border border-(--color-rule) p-5 flex flex-col gap-2">
      <PromptCardHead prompt={prompt} onDelete={onDelete} />
      {prompt.description && (
        <p className="reading-tight text-[13.5px] text-(--color-muted)">{prompt.description}</p>
      )}
      <PromptCardBody body={prompt.body} />
    </article>
  );
}

function PromptCardHead({
  prompt, onDelete,
}: { prompt: PromptView; onDelete: (id: string) => Promise<void> }) {
  const t = useTranslations('adminAccess');
  return (
    <div className="flex justify-between items-baseline gap-2.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <h4 className="font-serif text-[18px]">{prompt.name}</h4>
        {prompt.is_builtin && (
          <span
            className="mono text-[9px] tracking-[0.18em] uppercase text-(--color-violet)"
            data-testid="prompt-system-pill"
          >
            {t('common.systemPill')}
          </span>
        )}
      </div>
      {!prompt.is_builtin && <PromptDeleteBtn prompt={prompt} onDelete={onDelete} />}
    </div>
  );
}

function PromptDeleteBtn({
  prompt, onDelete,
}: { prompt: PromptView; onDelete: (id: string) => Promise<void> }) {
  const t = useTranslations('adminAccess');
  const run = useAction();
  // 一键破坏性动作 → 成功/失败都用 toast 收尾（失败不再静默：删没生效 owner 必须知道）。
  const handleDelete = useCallback(
    () => run(() => onDelete(prompt.id), { success: `Prompt ${prompt.name} deleted` }),
    [onDelete, prompt.id, prompt.name, run],
  );
  return (
    <button
      type="button"
      data-testid={`prompt-delete-${prompt.name}`}
      onClick={() => void handleDelete()}
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
    >
      {t('common.delete')}
    </button>
  );
}

function PromptCardBody({ body }: { body: string }) {
  const preview = body.length > 220 ? `${body.slice(0, 220)}…` : body;
  return (
    <blockquote className="mt-2 pl-3.5 border-l-2 border-(--color-rule) font-serif italic text-[14px] leading-[1.5] text-(--color-ink)">
      {preview}
    </blockquote>
  );
}

function PromptCreateModal({
  onClose, onCreate,
}: {
  onClose: () => void;
  onCreate: (input: WritePromptInput) => Promise<PromptView>;
}) {
  const t = useTranslations('adminAccess');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  return (
    <div
      className="fixed inset-0 bg-[var(--sm-scrim)] flex items-center justify-center sm-z-modal"
      data-testid="prompt-create-modal"
    >
      <div className="bg-(--color-paper) border border-(--color-rule) max-w-[640px] w-[92vw] p-7 flex flex-col gap-4">
        <h2 className="font-serif text-[22px]">{t('prompts.modalTitle')}</h2>
        <PromptField label="name" value={name} onChange={setName} placeholder="e.g. recruiter-facing" />
        <PromptField
          label="description"
          value={description}
          onChange={setDescription}
          placeholder="when to use this persona"
        />
        <PromptBodyField value={body} onChange={setBody} />
        <PromptModalFooter
          name={name}
          description={description}
          body={body}
          onClose={onClose}
          onCreate={onCreate}
        />
      </div>
    </div>
  );
}

function PromptField({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{label}</span>
      <input
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14px]"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`prompt-field-${label}`}
      />
    </label>
  );
}

function PromptBodyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('adminAccess');
  return (
    <label className="flex flex-col gap-1">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{t('prompts.bodyLabel')}</span>
      <textarea
        className="border border-(--color-rule) px-3 py-2 bg-(--color-paper) text-[14.5px] font-serif min-h-[220px]"
        value={value}
        placeholder="You are an AI proxy for {owner}. Answer questions accurately…"
        onChange={(e) => onChange(e.target.value)}
        data-testid="prompt-field-body"
      />
    </label>
  );
}

function PromptModalFooter({
  name, description, body, onClose, onCreate,
}: {
  name: string;
  description: string;
  body: string;
  onClose: () => void;
  onCreate: (input: WritePromptInput) => Promise<PromptView>;
}) {
  const t = useTranslations('adminAccess');
  const toast = useToast();
  const report = useReportError();
  // 成功 → toast + 关；失败 → report + **保持开着**（让 owner 看见错、改了重试，不静默关掉像成功了）。
  const submit = useCallback(async () => {
    try {
      await onCreate({ name, description, body });
      toast.success(`Prompt ${name} created`);
      onClose();
    } catch (e) {
      report(e);
    }
  }, [name, description, body, onCreate, onClose, toast, report]);
  const disabled = name === '' || body === '';
  return (
    <div className="flex justify-end gap-3 mt-2">
      <Btn kind="ghost" onClick={onClose}>{t('common.cancel')}</Btn>
      <button
        type="button"
        data-testid="prompt-create-submit"
        disabled={disabled}
        onClick={() => void submit()}
        className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {t('common.create')}
      </button>
    </div>
  );
}
