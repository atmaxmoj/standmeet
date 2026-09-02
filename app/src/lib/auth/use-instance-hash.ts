// use-instance-hash —— the "instance" fingerprint shown by DeployStrip.
//
// This is purely decorative (makes self-host feel real), not for
// security/auth, so client-side random + sessionStorage is enough.
// SSR-safe: initial state is an empty string, filled in after hydration.
//
// Same reasoning for host: SSR can't reach window.location, so it's read
// after mount.

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
