// use-domain —— "custom domain" 输入 + DNS verify 状态机。
// backend instance_settings.allowed_domains 尚未暴露给 admin 路由 ——
// 这里完全 client-side stub：domain 改后状态变 'pending'，1.1s 后变 'verified'
// （模拟 DNS check）。后端接口接通后只换 verify() 内部即可。

import { useCallback, useState } from 'react';

export type DomainStatus = 'unset' | 'pending' | 'verified';

export interface DomainHook {
  domain: string;
  status: DomainStatus;
  valid: boolean;
  setDomain: (v: string) => void;
  verify: () => void;
  reset: () => void;
}

const DNS_PATTERN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;

export function useDomain(initial: string = ''): DomainHook {
  const [domain, setDomainRaw] = useState(initial);
  const [status, setStatus] = useState<DomainStatus>(initial ? 'unset' : 'unset');

  const sanitized = sanitize(domain);
  const valid = isValid(sanitized);

  const setDomain = useCallback((v: string) => {
    setDomainRaw(v);
    // typing invalidates a prior verification
    setStatus((cur) => cur === 'verified' ? 'unset' : cur);
  }, []);

  const verify = useCallback(() => {
    isValid(sanitize(domain)) && fakeVerify(setStatus);
  }, [domain]);

  const reset = useCallback(() => {
    setDomainRaw('');
    setStatus('unset');
  }, []);

  return { domain, status, valid, setDomain, verify, reset };
}

function fakeVerify(setStatus: (s: DomainStatus) => void): void {
  setStatus('pending');
  setTimeout(() => setStatus('verified'), 1100);
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
    : status === 'pending'  ? { cls: 'text-(--color-muted)',  text: '◐ checking dns…' }
    : { cls: 'text-(--color-faint)', text: '○ not verified' };
}

export function domainHint(valid: boolean, sanitized: string): string {
  return valid ? 'looks like a valid host · verify dns to go live'
    : sanitized ? 'not a valid host yet'
    : 'e.g. sijiewang.com, talk.sijiewang.com';
}

export function domainEffectiveHost(handle: string, domain: string, status: DomainStatus): string {
  return (domain && status === 'verified') ? domain : `standmeet.com/${handle}`;
}
