// use-instance-hash —— DeployStrip 显示的"instance" fingerprint。
//
// 这是装饰性的（让 self-host 感觉真实），不是安全/鉴权用，所以前端 random
// + sessionStorage 即可。SSR-safe：初始 state 是空串，hydration 后填充。
//
// host 同理：SSR 拿不到 window.location，挂载后读。

'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'standmeet-instance-hash';
const CHARS = 'abcdef0123456789';
const HASH_LEN = 12;

export function useInstanceHash(): { hash: string; host: string } {
  const [hash, setHash] = useState('');
  const [host, setHost] = useState('');

  useEffect(() => {
    setHash(readOrGenerate());
    setHost(currentHost());
  }, []);

  return { hash, host };
}

function readOrGenerate(): string {
  const stored = safeStorageGet(STORAGE_KEY);
  return stored ?? generateAndStore();
}

function generateAndStore(): string {
  const fresh = makeHash();
  safeStorageSet(STORAGE_KEY, fresh);
  return fresh;
}

function makeHash(): string {
  let out = '';
  for (let i = 0; i < HASH_LEN; i += 1) {
    out += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return out;
}

function currentHost(): string {
  return typeof window === 'undefined' ? 'localhost' : window.location.host;
}

function safeStorageGet(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    typeof window === 'undefined' || window.sessionStorage.setItem(key, value);
  } catch {
    /* private mode etc — silent */
  }
}
