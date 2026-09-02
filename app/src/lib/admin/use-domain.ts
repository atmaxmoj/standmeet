// use-domain —— allowed_domains allow-list management (the app only owns the
// "which domains are allowed" half). GET /allowed-domains loads it; POST
// adds; DELETE /allowed-domains/{domain} removes. Once added to the
// allow-list, the deployment provider's reverse proxy (on-demand-TLS)
// confirms and issues the certificate on its own via /internal/tls-ask —
// **issuing the certificate is the provider's job, not the app's**
// (prod-deploy dropped). The frontend only shows "in allow-list"; there's no
// separate DNS verification step for the app to do.
//
// zustand refactor: domainsStore shares the allow-list (one copy app-wide);
// input + temporary status stay local (they're inherently form state).

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, AllowedDomainsRespSchema } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';

export type DomainStatus = 'unset' | 'pending' | 'verified';

export interface DomainHook {
  domain: string;
  status: DomainStatus;
  valid: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  allowed: readonly string[];
  setDomain: (v: string) => void;
  verify: () => Promise<void>;
  reset: () => void;
  remove: (dom: string) => Promise<void>;
}

const DNS_PATTERN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;

export const domainsStore = createResourceStore<string[]>({
  name: 'allowed-domains',
  fetcher: async () => {
    const resp = await adminAPI.get('/allowed-domains', AllowedDomainsRespSchema);
    return resp.domains;
  },
});

export function useDomain(initial: string = ''): DomainHook {
  const r = useResource(domainsStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  const [domain, setDomainRaw] = useState(initial);
  const [status, setStatus] = useState<DomainStatus>('unset');
  const [saving, setSaving] = useState(false);

  const allowed = r.data ?? [];
  const sanitized = sanitize(domain);
  const valid = isValid(sanitized);
  const effectiveStatus = computeStatus(sanitized, allowed, status);

  const setDomain = useCallback((v: string) => {
    setDomainRaw(v);
    setStatus('unset');
  }, []);
  const verify = useCallback(
    () => runVerify(sanitize(domain), setStatus, setSaving),
    [domain],
  );
  const reset = useCallback(() => { setDomainRaw(''); setStatus('unset'); }, []);
  const remove = useCallback((dom: string) => runRemove(dom, setSaving), []);

  return {
    domain,
    status: effectiveStatus,
    valid,
    loading: r.status === 'idle' || r.status === 'loading',
    saving,
    error: r.error, // verify/remove now throw → reflected inline in place (DomainEditor catches it itself), only the fetch error is kept here.
    allowed,
    setDomain, verify, reset, remove,
  };
}

function computeStatus(
  sanitized: string, allowed: readonly string[], local: DomainStatus,
): DomainStatus {
  return sanitized && allowed.includes(sanitized) ? 'verified' : local;
}

// runVerify —— throws (no longer swallowed into setError): status resets to 'unset' then rethrows, DomainEditor reflects it inline in place.
async function runVerify(
  sanitized: string,
  setStatus: (s: DomainStatus) => void,
  setSaving: (b: boolean) => void,
): Promise<void> {
  if (!isValid(sanitized)) return;
  setStatus('pending');
  setSaving(true);
  try {
    await adminAPI.postVoid('/allowed-domains', { domain: sanitized });
    domainsStore.getState().mutate((prev) =>
      (prev ?? []).includes(sanitized) ? (prev ?? []) : [...(prev ?? []), sanitized]);
    setStatus('verified');
  } catch (e) {
    setStatus('unset');
    throw e;
  } finally {
    setSaving(false);
  }
}

async function runRemove(
  dom: string,
  setSaving: (b: boolean) => void,
): Promise<void> {
  setSaving(true);
  try {
    await adminAPI.deleteVoid(`/allowed-domains/${encodeURIComponent(dom)}`);
    domainsStore.getState().mutate((prev) => (prev ?? []).filter((d) => d !== dom));
  } finally {
    setSaving(false);
  }
}

function sanitize(v: string): string {
  return v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function isValid(s: string): boolean {
  return s.length > 3 && DNS_PATTERN.test(s);
}

export interface DomainBadge { cls: string; text: string }

export function domainBadge(status: DomainStatus, hasDomain: boolean): DomainBadge {
  return !hasDomain ? { cls: 'text-(--color-faint)', text: '○ unset · using default' }
    : status === 'verified' ? { cls: 'text-(--color-accent)', text: '● verified · live' }
    : status === 'pending'  ? { cls: 'text-(--color-muted)',  text: '◐ adding to allow-list…' }
    : { cls: 'text-(--color-faint)', text: '○ not in allow-list' };
}

export function domainHint(valid: boolean, sanitized: string): string {
  return valid ? 'looks like a valid host · click verify to add to allow-list'
    : sanitized ? 'not a valid host yet'
    : 'e.g. yourdomain.com, talk.yourdomain.com';
}

// domainEffectiveHost —— the host the public page is actually reached at: the
// verified custom domain if set, otherwise this instance's own origin (the
// deployed host). No standmeet.com/<handle> — single-owner instances serve at
// the root of the owner's own domain. _handle kept for call-site compatibility.
export function domainEffectiveHost(_handle: string, domain: string, status: DomainStatus): string {
  if (domain && status === 'verified') return domain;
  return typeof window !== 'undefined' ? window.location.host : '';
}
