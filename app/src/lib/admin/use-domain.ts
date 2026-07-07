// use-domain —— allowed_domains 白名单管理(app 只拥有「哪些域名放行」这半边)。
// GET /allowed-domains 加载；POST 加；DELETE /allowed-domains/{domain} 删。
// 加进白名单后,部署 provider 的反代(on-demand-TLS)自己经 /internal/tls-ask 确认并签证书
// —— **签证书是 provider 的活,不是 app 的**(prod-deploy dropped)。前端只显示 "in allow-list",
// 没有独立的 DNS 验证步骤要 app 做。
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
  const r = readResource(domainsStore);
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
    error: r.error, // verify/remove 现在抛错 → 就地内联反显（DomainEditor 自己 catch），这里只留 fetch error。
    allowed,
    setDomain, verify, reset, remove,
  };
}

function computeStatus(
  sanitized: string, allowed: readonly string[], local: DomainStatus,
): DomainStatus {
  return sanitized && allowed.includes(sanitized) ? 'verified' : local;
}

// runVerify —— 抛错（不再吞进 setError）：状态回 'unset' 后 rethrow，DomainEditor 就地内联反显。
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
