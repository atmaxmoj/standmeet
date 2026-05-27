// use-domain —— allowed_domains 白名单管理。
// GET /allowed-domains 加载；POST 加；DELETE /allowed-domains/{domain} 删。
// 真正的 DNS 验证由 Caddy on-demand TLS (/internal/tls-ask) 兜，前端只
// 显示 "in allow-list" / "verified" 状态（命中白名单 + Caddy 已签证书 =
// verified；这里简化只看 allow-list 命中与否）。
//
// zustand 重构：domainsStore 共享 allow-list（全 app 一份）；input + 临时
// status 留 local（form-state 本质）。

import { useCallback, useEffect, useState } from 'react';

import { adminAPI, AllowedDomainsRespSchema } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';

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
  verify: () => void;
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
  const r = readResource(domainsStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  const [domain, setDomainRaw] = useState(initial);
  const [status, setStatus] = useState<DomainStatus>('unset');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowed = r.data ?? [];
  const sanitized = sanitize(domain);
  const valid = isValid(sanitized);
  const effectiveStatus = computeStatus(sanitized, allowed, status);

  const setDomain = useCallback((v: string) => {
    setDomainRaw(v);
    setStatus('unset');
  }, []);
  const verify = useCallback(
    () => void runVerify(sanitize(domain), setStatus, setSaving, setError),
    [domain],
  );
  const reset = useCallback(() => { setDomainRaw(''); setStatus('unset'); }, []);
  const remove = useCallback((dom: string) => runRemove(dom, setSaving, setError), []);

  return {
    domain,
    status: effectiveStatus,
    valid,
    loading: r.status === 'idle' || r.status === 'loading',
    saving,
    error: error ?? r.error,
    allowed,
    setDomain, verify, reset, remove,
  };
}

function computeStatus(
  sanitized: string, allowed: readonly string[], local: DomainStatus,
): DomainStatus {
  return sanitized && allowed.includes(sanitized) ? 'verified' : local;
}

async function runVerify(
  sanitized: string,
  setStatus: (s: DomainStatus) => void,
  setSaving: (b: boolean) => void,
  setErr: (m: string | null) => void,
): Promise<void> {
  if (!isValid(sanitized)) return;
  setStatus('pending');
  setSaving(true);
  setErr(null);
  try {
    await adminAPI.postVoid('/allowed-domains', { domain: sanitized });
    domainsStore.getState().mutate((prev) =>
      (prev ?? []).includes(sanitized) ? (prev ?? []) : [...(prev ?? []), sanitized]);
    setStatus('verified');
  } catch (e) {
    setErr(e instanceof Error ? e.message : 'verify failed');
    setStatus('unset');
  } finally {
    setSaving(false);
  }
}

async function runRemove(
  dom: string,
  setSaving: (b: boolean) => void,
  setErr: (m: string | null) => void,
): Promise<void> {
  setSaving(true);
  setErr(null);
  try {
    await adminAPI.deleteVoid(`/allowed-domains/${encodeURIComponent(dom)}`);
    domainsStore.getState().mutate((prev) => (prev ?? []).filter((d) => d !== dom));
  } catch (e) {
    setErr(e instanceof Error ? e.message : 'remove failed');
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

export function domainEffectiveHost(handle: string, domain: string, status: DomainStatus): string {
  return (domain && status === 'verified') ? domain : `standmeet.com/${handle}`;
}
