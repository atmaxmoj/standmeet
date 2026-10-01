// use-instance-settings —— the owner's instance settings on /admin/system: internal hosts, the
// skill catalogue, the Turnstile login check. GET/PUT /api/admin/instance-settings and
// PUT /api/admin/captcha. They were env vars in the deployment file; the owner's rule is that a
// deployment carries wiring, not settings (2026-10-01).

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export const InstanceSettingsSchema = z.object({
  internal_hosts: z.array(z.string()),
  skill_catalogue_url: z.string(),
  captcha_site_key: z.string(),
  captcha_secret_configured: z.boolean(),
  captcha_on: z.boolean(),
});
export type InstanceSettings = z.infer<typeof InstanceSettingsSchema>;

// The form as the owner types it. Hosts are one per line (or comma-separated); an empty secret
// keeps the stored one.
export interface InstanceSettingsDraft {
  hosts: string;
  catalogue: string;
  siteKey: string;
  secret: string;
}

export interface InstanceSettingsHook {
  status: ResourceStatus;
  settings: InstanceSettings | null;
  save: (d: InstanceSettingsDraft) => Promise<void>;
}

export const instanceSettingsStore = createResourceStore<InstanceSettings>({
  name: 'instance-settings',
  fetcher: () => adminAPI.get('/instance-settings', InstanceSettingsSchema),
});

export function useInstanceSettings(): InstanceSettingsHook {
  const r = useResource(instanceSettingsStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { status: r.status, settings: r.data ?? null, save };
}

// draftOf —— the form's starting values from the stored settings.
export function draftOf(s: InstanceSettings): InstanceSettingsDraft {
  return {
    hosts: s.internal_hosts.join('\n'), catalogue: s.skill_catalogue_url,
    siteKey: s.captcha_site_key, secret: '',
  };
}

export function splitHosts(raw: string): string[] {
  return raw.split(/[\s,]+/).map((h) => h.trim()).filter((h) => h !== '');
}

// save —— both writes, then the stored settings back into the store. Throws on failure (the
// caller reports it).
async function save(d: InstanceSettingsDraft): Promise<void> {
  await adminAPI.put('/instance-settings', {
    internal_hosts: splitHosts(d.hosts), skill_catalogue_url: d.catalogue,
  }, InstanceSettingsSchema);
  const secretChange = d.secret.trim() === '' ? 'keep' : 'set';
  const next = await adminAPI.put('/captcha', {
    site_key: d.siteKey, secret_change: secretChange, secret: d.secret,
  }, InstanceSettingsSchema);
  instanceSettingsStore.getState().mutate(next);
}
