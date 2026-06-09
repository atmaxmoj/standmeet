// thinking-words —— LLM 在想(没有具体 tool 在跑)时 throbber 的轮换词库。
//
// throbber 有真动作时显 "searching X" / "reading Y";动作之间、以及最后落笔
// 生成答案那几段,agent 只是在想,没有具体可报的动作 —— 这时从词库里每 3 秒
// 取一个词,比干巴巴一个静止的 "thinking" 活一点,长等待(真 LLM 一 turn 几十
// 秒)也不显得卡死。
//
// 词不是我拍脑袋凑的:取自 thesaurus.com 的 ponder / contemplate / deliberate
// 三个词头的同义动词,筛掉生僻(excogitate / cerebrate / perpend / woolgather)
// 和不贴调性的(speculating / brooding —— 一个 grounded-answer 工具不该显得在
// 瞎猜或郁结),再补上 compose 一支(composing / drafting,落笔写答案那层)。
// 全是「人在斟酌、组织一段有据回答」的动词,贴 StandMeet 沉静、反 hype 的调性。

'use client';

import { useEffect, useState } from 'react';

export const THINKING_WORDS = [
  'thinking',
  'considering',
  'contemplating',
  'deliberating',
  'pondering',
  'reflecting',
  'weighing',
  'mulling',
  'musing',
  'reasoning',
  'ruminating',
  'composing',
  'drafting',
] as const;

const ROTATE_MS = 3_000;

// useThinkingWord —— 挂载期间每 3 秒前进一个词,返回当前词。每段 pending 重新
// 挂载 → 从 'thinking' 起。组件卸载(答案出来 / turn 落地)清掉 interval。
export function useThinkingWord(): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => n + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, []);
  return THINKING_WORDS[i % THINKING_WORDS.length] ?? 'thinking';
}
