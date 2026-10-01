// InstanceSettingsPanel —— the owner's instance settings on /admin/system: the internal hosts this
// instance may reach, the skill catalogue the marketplace reads, the Turnstile login check.
//
// Owner, 2026-10-01, on the deployment template: "3应该留 … 12都给我弄没". These were env vars in
// the compose file; changing one meant editing it and redeploying. Each takes effect on Save.

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { SecretInput } from '@/components/atoms/SecretInput';
import {
  draftOf, useInstanceSettings,
  type InstanceSettings, type InstanceSettingsDraft, type InstanceSettingsHook,
} from '@/lib/admin/use-instance-settings';
import { useAction } from '@/lib/ui/use-action';

export function InstanceSettingsPanel() {
  const t = useTranslations('adminShell.instanceSettings');
  const hook = useInstanceSettings();
  // Lives here, outside the keyed form: a save remounts the form, and "saved" must survive it.
  const [saved, setSaved] = useState(false);
  return (
    <div className="sm-settings-panel" data-testid="instance-settings">
      <AdminSectionHead className="mb-3">{t('title')}</AdminSectionHead>
      {hook.settings === null ? null : (
        // Keyed by the stored settings: after a save the form starts again from what was stored.
        <SettingsForm
          key={JSON.stringify(hook.settings)} hook={hook} stored={hook.settings}
          saved={saved} setSaved={setSaved}
        />
      )}
    </div>
  );
}

function SettingsForm({ hook, stored, saved, setSaved }: {
  hook: InstanceSettingsHook; stored: InstanceSettings;
  saved: boolean; setSaved: (v: boolean) => void;
}) {
  const t = useTranslations('adminShell.instanceSettings');
  const [draft, setDraft] = useState<InstanceSettingsDraft>(() => draftOf(stored));
  const run = useAction();
  const set = useCallback((k: keyof InstanceSettingsDraft) => (v: string) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [k]: v }));
  }, [setSaved]);
  const onSave = useCallback(
    () => run(async () => { await hook.save(draft); setSaved(true); }),
    [run, hook, draft, setSaved],
  );
  return (
    <div className="sm-settings-form">
      <HostsField value={draft.hosts} onChange={set('hosts')} />
      <TextField
        testid="instance-skill-catalogue" label={t('catalogue')} hint={t('catalogueHint')}
        value={draft.catalogue} onChange={set('catalogue')}
      />
      <CaptchaFields draft={draft} set={set} stored={stored} />
      <div className="sm-settings-actions">
        <button
          type="button" className="sm-btn sm-btn-solid sm-btn-sm"
          data-testid="instance-settings-save" onClick={onSave}
        >
          {t('save')}
        </button>
        {saved ? <span className="sm-settings-note" data-testid="instance-settings-saved">{t('saved')}</span> : null}
      </div>
    </div>
  );
}

function HostsField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('adminShell.instanceSettings');
  return (
    <label className="sm-field">
      <span className="sm-field-label">{t('internalHosts')}</span>
      <textarea
        data-testid="instance-internal-hosts" value={value} rows={3} spellCheck={false}
        onChange={(e) => onChange(e.target.value)} placeholder="caldav.lan"
        className="sm-field-input sm-mono"
      />
      <span className="sm-settings-note">{t('internalHostsHint')}</span>
    </label>
  );
}

function CaptchaFields({ draft, set, stored }: {
  draft: InstanceSettingsDraft;
  set: (k: keyof InstanceSettingsDraft) => (v: string) => void;
  stored: InstanceSettings;
}) {
  const t = useTranslations('adminShell.instanceSettings');
  return (
    <div className="sm-settings-group">
      <span className="sm-field-label">{t('captcha')}</span>
      <span className="sm-settings-note">{t('captchaHint')}</span>
      <TextField
        testid="instance-captcha-site-key" label={t('siteKey')}
        value={draft.siteKey} onChange={set('siteKey')}
      />
      <label className="sm-field">
        <span className="sm-field-label">{t('secret')}</span>
        <SecretInput
          testid="instance-captcha-secret" value={draft.secret} onChange={set('secret')}
          className="sm-field-input sm-mono"
        />
      </label>
      {stored.captcha_secret_configured ? (
        <span className="sm-settings-note" data-testid="instance-captcha-secret-stored">
          {t('secretStored')}
        </span>
      ) : null}
    </div>
  );
}

function TextField({ testid, label, hint, value, onChange }: {
  testid: string; label: string; hint?: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <label className="sm-field">
      <span className="sm-field-label">{label}</span>
      <input
        type="text" data-testid={testid} value={value} spellCheck={false}
        onChange={(e) => onChange(e.target.value)} className="sm-field-input sm-mono"
      />
      {hint === undefined ? null : <span className="sm-settings-note">{hint}</span>}
    </label>
  );
}
