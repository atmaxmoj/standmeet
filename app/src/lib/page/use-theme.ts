// use-theme —— `<html>` 上挂 / 摘 .dark 类。首次访问读 prefers-color-scheme，
// 之后 TopBar 切换写 localStorage 锁定，避免回到 prefers 默认。
//
// SSR 安全：useEffect 才碰 document / localStorage / matchMedia，初始 state
// 默认 false（亮色），客户端 hydrate 后再修正，避免 hydration mismatch。

'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'standmeet-dark';

export function useTheme(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(readInitial());
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      writeStored(next);
      return next;
    });
  }, []);

  return { dark, toggle };
}

function readInitial(): boolean {
  const stored = readStored();
  return stored ?? prefersDark();
}

function readStored(): boolean | null {
  const v = safeStorageGet(STORAGE_KEY);
  return v === '1' ? true : v === '0' ? false : null;
}

function writeStored(dark: boolean): void {
  safeStorageSet(STORAGE_KEY, dark ? '1' : '0');
}

function prefersDark(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function safeStorageGet(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    typeof window === 'undefined' || window.localStorage.setItem(key, value);
  } catch {
    /* private mode etc — silent */
  }
}
