// CodeCorpusConfig —— code 卡上的 **corpus 收窄面**（ACL 三类里的 corpus 那类的 code 层）。
//
// role 授的是「这个受众」能读的正列表（这里只读地列出来）；这张码可以再**减** ——「这一次邀约」
// 不该看的。典型：一个通用 role 授了整个 subjectivity（stance 都要给），但发给外部的那张码收回
// `subjectivity://cv`（record 笔记：真名/学历/雇主）。
//
// **只能减**：写在这里的 glob 只会让这张码读到的更少，开不了 role 没给的（纯 AND，A.4）。所以写错
// 一条最多是少读到东西，不会泄露。

'use client';

import { useCallback, useEffect, useState } from 'react';

import { fetchCodeCorpus, saveCodeCorpus } from '@/lib/admin/use-code-corpus';
import { useAction } from '@/lib/ui/use-action';

const CORPUS_HELP =
  '这张码在 role 授权基础上**收回**的 URI，一行一条。只能减不能加 —— role 没授的，这里写什么都不会开。'
  + '典型用法：role 授了 subjectivity://**（观点都给），这张码收回 subjectivity://cv（履历不给）。'
  + '改动只影响之后新发的 session（role 在发码时冻结）。';

// applyCorpus —— 落 GET 的结果（组件里不写分支：presentation 层禁 if）。
function applyCorpus(
  c: { granted: string[]; denied: string[] },
  setGranted: (v: string[]) => void,
  setText: (v: string) => void,
  setLoaded: (v: boolean) => void,
): void {
  setGranted(c.granted);
  setText(c.denied.join('\n'));
  setLoaded(true);
}

export function CodeCorpusConfig({ codeID, codeLabel }: { codeID: string; codeLabel: string }) {
  const run = useAction();
  const [granted, setGranted] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const live = { on: true };
    void fetchCodeCorpus(codeID).then((c) => {
      live.on && applyCorpus(c, setGranted, setText, setLoaded);
    }).catch(() => setLoaded(true));
    return () => { live.on = false; };
  }, [codeID]);
  const onSave = useCallback(
    () => run(
      () => saveCodeCorpus(codeID, text.split('\n').map((s) => s.trim()).filter((s) => s !== '')),
      { success: `Corpus narrowed for ${codeLabel}` },
    ),
    [codeID, codeLabel, run, text],
  );
  return loaded ? (
    <div className="mt-2 flex flex-col gap-1.5" data-testid={`code-corpus-${codeLabel}`}>
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint)">
        corpus · inherited from role
      </span>
      <ul className="mono text-[10.5px] text-(--color-muted) flex flex-wrap gap-x-3">
        {granted.length === 0
          ? <li className="italic">(role grants nothing)</li>
          : granted.map((g) => <li key={g}>{g}</li>)}
      </ul>
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) mt-1">
        taken back on this code
      </span>
      <p className="reading-tight text-[11px] text-(--color-muted)">{CORPUS_HELP}</p>
      <textarea
        className="border border-(--color-rule) px-2.5 py-1.5 bg-(--color-paper) text-[12.5px] font-mono min-h-[54px]"
        value={text}
        placeholder={'subjectivity://cv'}
        onChange={(e) => setText(e.target.value)}
        data-testid={`code-corpus-denied-${codeLabel}`}
        spellCheck={false}
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSave}
          data-testid={`code-corpus-save-${codeLabel}`}
          className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent)"
        >
          save corpus
        </button>
      </div>
    </div>
  ) : null;
}
