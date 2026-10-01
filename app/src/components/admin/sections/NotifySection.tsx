// NotifySection —— /admin/notify. When something happens (someone starts talking through a code, a
// microsite's data changes), send a card: by email, to a webhook endpoint, or to the owner's own
// chat on Telegram. Linking a chat is done here too: the page shows a code, the owner sends it to
// the bot (docs/design/notify-rules-and-live-transcript.md). Decisions live in use-notify; this file
// places strings.

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ListPane } from '@/components/admin/ListPane';
import { SectionHeader } from '@/components/admin/SectionHeader';
import { SelectField } from '@/components/atoms/SelectField';
import {
  EMPTY_DRAFT, channelOptions, filtersByCode, notifyStore, ruleSummary, useNotify,
  type NotifyHook, type Rule, type RuleDraft,
} from '@/lib/admin/use-notify';
import { useEffectErrorToast } from '@/lib/ui/toast';
import { useAction } from '@/lib/ui/use-action';

export function NotifySection() {
  const t = useTranslations('adminShell.notify');
  const hook = useNotify();
  useEffectErrorToast(hook.error);
  return (
    <>
      <SectionHeader kicker={t('kicker')} slug="notify" />
      <p className="sm-notify-intro">{t('intro')}</p>
      <ChatsPanel hook={hook} />
      <AdminSectionHead className="sm-notify-head">{t('rulesHeading')}</AdminSectionHead>
      <RuleForm hook={hook} />
      <ListPane
        status={hook.rules.status}
        count={hook.rules.data.length}
        empty={<p className="sm-notify-empty">{t('empty')}</p>}
      >
        <ul className="sm-notify-list">
          {hook.rules.data.map((r) => <RuleRow key={r.id} rule={r} hook={hook} />)}
        </ul>
      </ListPane>
    </>
  );
}

function ChatsPanel({ hook }: { hook: NotifyHook }) {
  const t = useTranslations('adminShell.notify');
  const run = useAction();
  return (
    <div className="sm-notify-box">
      <AdminSectionHead>{t('chatsHeading')}</AdminSectionHead>
      <p className="sm-notify-help">{t('chatsHelp')}</p>
      <ul className="sm-notify-list">
        {hook.links.map((l) => (
          <li key={l.id} className="sm-notify-row">
            <span className="sm-notify-mono">{l.platform}</span>
            <span data-testid="notify-im-status" className="sm-notify-status">
              {l.linked ? t('linked') : t('waiting')}
            </span>
            <button type="button" className="sm-btn sm-btn-ghost sm-btn-sm" onClick={() => run(() => notifyStore.getState().unlinkIM(l.id))}>
              {t('unlink')}
            </button>
          </li>
        ))}
      </ul>
      {hook.pairing !== null && (
        <div className="sm-notify-pairing">
          <code data-testid="notify-im-pairing-code" className="sm-notify-code">{hook.pairing}</code>
          <p data-testid="notify-im-instructions" className="sm-notify-help">
            {t('pairInstructions', { command: `/pair ${hook.pairing}` })}
          </p>
        </div>
      )}
      <button type="button" data-testid="notify-im-link" className="sm-btn sm-btn-outline sm-btn-sm" onClick={() => run(() => notifyStore.getState().linkIM())}>
        {t('linkTelegram')}
      </button>
    </div>
  );
}

function RuleForm({ hook }: { hook: NotifyHook }) {
  const t = useTranslations('adminShell.notify');
  const [open, setOpen] = useState(false);
  return open ? <RuleEditor hook={hook} onDone={() => setOpen(false)} /> : (
    <button type="button" data-testid="notify-rule-new" className="sm-btn sm-btn-solid sm-btn-sm" onClick={() => setOpen(true)}>
      {t('newRule')}
    </button>
  );
}

function RuleEditor({ hook, onDone }: { hook: NotifyHook; onDone: () => void }) {
  const t = useTranslations('adminShell.notify');
  const run = useAction();
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);
  const put = (p: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...p }));
  const save = useCallback(() => run(async () => {
    await notifyStore.getState().createRule(draft, hook.types);
    onDone();
  }), [run, draft, hook.types, onDone]);
  return (
    <div className="sm-notify-box">
      <label className="sm-notify-field">
        <span className="sm-notify-label">{t('event')}</span>
        <SelectField testid="notify-rule-event" mono value={draft.eventType} onChange={(e) => put({ eventType: e.target.value, filterValue: '' })}>
          <option value="">{t('chooseEvent')}</option>
          {hook.types.map((ty) => <option key={ty.type} value={ty.type}>{ty.type}</option>)}
        </SelectField>
      </label>
      {filtersByCode(hook.types, draft.eventType) && (
        <label className="sm-notify-field">
          <span className="sm-notify-label">{t('onlyCode')}</span>
          <SelectField testid="notify-rule-code" mono value={draft.filterValue} onChange={(e) => put({ filterValue: e.target.value })}>
            <option value="">{t('anyCode')}</option>
            {hook.codes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </SelectField>
        </label>
      )}
      <label className="sm-notify-check">
        <input type="checkbox" data-testid="notify-rule-first-only" checked={draft.firstOnly} onChange={(e) => put({ firstOnly: e.target.checked })} />
        <span>{t('firstOnly')}</span>
      </label>
      <label className="sm-notify-field">
        <span className="sm-notify-label">{t('sendTo')}</span>
        <SelectField testid="notify-rule-channel" value={draft.channel} onChange={(e) => put({ channel: e.target.value })}>
          {channelOptions(hook.links, hook.endpoints, t('email')).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </SelectField>
      </label>
      <label className="sm-notify-field">
        <span className="sm-notify-label">{t('card')}</span>
        <input data-testid="notify-rule-template" className="sm-field-input" value={draft.template} placeholder={t('cardPlaceholder')} onChange={(e) => put({ template: e.target.value })} />
        <span className="sm-notify-help">{t('cardHelp')}</span>
      </label>
      <div>
        <button type="button" data-testid="notify-rule-save" className="sm-btn sm-btn-solid sm-btn-sm" onClick={save}>
          {t('save')}
        </button>
      </div>
    </div>
  );
}

function RuleRow({ rule, hook }: { rule: Rule; hook: NotifyHook }) {
  const t = useTranslations('adminShell.notify');
  const run = useAction();
  const v = ruleSummary(rule, hook.codes, hook.links, hook.endpoints);
  const s = notifyStore.getState;
  return (
    <li data-testid="notify-rule-row" data-enabled={rule.enabled} className="sm-notify-row">
      <span className="sm-notify-mono">{v.watches}</span>
      <span className="sm-notify-mono">{v.keeps}</span>
      <span className="sm-notify-status">{rule.first_only ? t('firstOnlyShort') : ''}</span>
      <span className="sm-notify-mono">→ {v.to}</span>
      <span className="sm-notify-template">{rule.template}</span>
      <button type="button" className="sm-btn sm-btn-outline sm-btn-sm" onClick={() => run(() => s().setEnabled(rule.id, !rule.enabled))}>
        {rule.enabled ? t('disable') : t('enable')}
      </button>
      <button type="button" className="sm-btn sm-btn-ghost sm-btn-sm" onClick={() => run(() => s().removeRule(rule.id))}>
        {t('delete')}
      </button>
    </li>
  );
}
