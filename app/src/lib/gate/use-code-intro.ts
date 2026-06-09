// use-code-intro —— 名字选择器 pre-issue 拿当前 pending code 的介绍
// (greeting「这是什么」+ 名字上限/已用),给 picker 渲。code 变就重拉;
// 没 pending code / 拉失败 → null,picker 优雅回落。

'use client';

import { useEffect, useState } from 'react';

import { fetchCodeIntro, type CodeIntro } from '@/lib/api/public';
import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';

// memberCapacityLine —— "Up to N people can use this code — M already in"。
// max_members=0(不限)/ 无 intro → 空串,picker 退回默认"More than one person"。
export function memberCapacityLine(intro: CodeIntro | null): string {
  if (intro === null || intro.max_members <= 0) return '';
  const noun = intro.max_members === 1 ? 'person' : 'people';
  return `Up to ${intro.max_members} ${noun} can use this code — ${intro.member_count} already in.`;
}

export function useCodeIntro(): CodeIntro | null {
  const code = usePendingCodeStore((s) => s.code);
  const [intro, setIntro] = useState<CodeIntro | null>(null);
  useEffect(() => {
    if (code === null) {
      setIntro(null);
      return;
    }
    let alive = true;
    void fetchCodeIntro(code).then((r) => {
      if (alive) setIntro(r);
    });
    return () => {
      alive = false;
    };
  }, [code]);
  return intro;
}
