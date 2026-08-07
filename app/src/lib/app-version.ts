// app-version —— 徽标上那个版本号从哪来。
//
// 答案是:**跑着的那个进程**。前端不许自己带一份常量。
//
// F-C-4 当初的修法是把两份手打的拷贝合成一份(`APP_VERSION = 'v1.0.0'`),矛盾因此从
// "两张脸互相矛盾"降级成"一张脸跟事实矛盾" —— 那台机器上真正跑着的是 0.1.0,而
// /admin/system 的 DEPLOYMENT 一直诚实地这么写着。版本号存在的唯一意义是出事时说得清
// 自己在哪个 build;一个跟 build 无关的字面量把这个意义整个抵消掉(F-C-10)。
//
// 所以这里去 /api/v1/instance 拿后端报的那一份。没拿到就什么都不显示 ——
// 一个空位说明"不知道",一个假数字说明"我知道",后者更糟。

'use client';

import { useEffect, useState } from 'react';

// display —— 后端报 "0.1.0",徽标写 "v0.1.0"。加 v 这件事只做在这一处,
// 于是登录页和 admin 顶栏不可能一个带 v 一个不带。
function display(raw: string): string {
  return raw === '' ? '' : `v${raw.replace(/^v/i, '')}`;
}

export function useAppVersion(): string {
  const [version, setVersion] = useState('');

  useEffect(() => {
    let alive = true;
    void fetch('/api/v1/instance', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { version: '' })
      .then((data: { version?: string }) => {
        alive && setVersion(display(data.version ?? ''));
      })
      .catch(() => { /* 拿不到就留空:宁可没有,不要一个编出来的数 */ });
    return () => { alive = false; };
  }, []);

  return version;
}
