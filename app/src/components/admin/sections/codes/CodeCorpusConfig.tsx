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

import { CorpusScopePicker } from '@/components/admin/sections/corpus/CorpusScopePicker';
import { fetchCodeCorpus, saveCodeCorpus } from '@/lib/admin/use-code-corpus';
import { useAction } from '@/lib/ui/use-action';

const CORPUS_HELP =
  '这张码在 role 授权基础上**收回**的 URI，一行一条。只能减不能加 —— role 没授的，这里写什么都不会开。'
  + '典型用法：role 授了 subjectivity://**（观点都给），这张码收回 subjectivity://cv（履历不给）。'
  + '改动只影响之后新发的 session（role 在发码时冻结）。';

// CorpusLoadFailed —— 没拉到就说没拉到，**并且不出编辑器**：granted 未知时那个列表只会误导，而
// denied 未知时保存会把 owner 没看见的收回列表清掉。宁可这张卡少一块，不可给一块假的。
function CorpusLoadFailed({ codeLabel }: { codeLabel: string }) {
  return (
    <div className="mt-2 flex flex-col gap-1" data-testid={`code-corpus-error-${codeLabel}`}>
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint)">
        corpus
      </span>
      <p className="reading-tight text-[11px] text-(--color-accent)">
        Couldn’t load this code’s corpus scope. Reload and retry.
      </p>
    </div>
  );
}

// CorpusState —— 这张卡的加载态。`error` 是**第三种**状态，不是 loaded 的一个空值：
// 「role 什么都没授」和「没拉到」在 UI 上必须分得开（F-A-13）。
interface CorpusState {
  granted: string[];
  text: string;
  setText: (v: string) => void;
  loaded: boolean;
  error: boolean;
}

// Sinks —— useCodeCorpusState 的 setter 束（组件里不写分支：presentation 层禁 if，故 apply* 提到外面）。
interface Sinks {
  setGranted: (v: string[]) => void;
  setText: (v: string) => void;
  setLoaded: (v: boolean) => void;
  setError: (v: boolean) => void;
}

// applyCorpus —— 落 GET 的结果。
function applyCorpus(c: { granted: string[]; denied: string[] }, s: Sinks): void {
  s.setGranted(c.granted);
  s.setText(c.denied.join('\n'));
  s.setLoaded(true);
}

// applyLoadError —— 没拉到。**不**碰 granted/text：它们此刻是无意义的初值，渲染出去就是那句谎。
function applyLoadError(s: Sinks): void {
  s.setError(true);
  s.setLoaded(true);
}

// useCodeCorpusState —— GET 一张码的 corpus 面。加载失败别静默成空（同 use-latest-list 的 loadError）。
function useCodeCorpusState(codeID: string): CorpusState {
  const [granted, setGranted] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const live = { on: true };
    const sinks: Sinks = { setGranted, setText, setLoaded, setError };
    void fetchCodeCorpus(codeID)
      .then((c) => { live.on && applyCorpus(c, sinks); })
      .catch(() => { live.on && applyLoadError(sinks); });
    return () => { live.on = false; };
  }, [codeID]);
  return { granted, text, setText, loaded, error };
}

// GrantedList —— 继承来的 role 正列表。只有在**确实拉到了**的时候才会渲染，所以
// 「(role grants nothing)」在这里永远是真话（见 useCodeCorpusState 的 error 分支）。
function GrantedList({ granted }: { granted: readonly string[] }) {
  return (
    <ul className="mono text-[10.5px] text-(--color-muted) flex flex-wrap gap-x-3">
      {granted.length === 0
        ? <li className="italic">(role grants nothing)</li>
        : granted.map((g) => <li key={g}>{g}</li>)}
    </ul>
  );
}

export function CodeCorpusConfig({ codeID, codeLabel }: { codeID: string; codeLabel: string }) {
  const run = useAction();
  const { granted, text, setText, loaded, error } = useCodeCorpusState(codeID);
  const onSave = useCallback(
    () => run(
      () => saveCodeCorpus(codeID, text.split('\n').map((s) => s.trim()).filter((s) => s !== '')),
      { success: `Corpus narrowed for ${codeLabel}` },
    ),
    [codeID, codeLabel, run, text],
  );
  return error ? <CorpusLoadFailed codeLabel={codeLabel} /> : loaded ? (
    <div className="mt-2 flex flex-col gap-1.5" data-testid={`code-corpus-${codeLabel}`}>
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint)">
        corpus · inherited from role
      </span>
      <GrantedList granted={granted} />
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) mt-1">
        taken back on this code
      </span>
      <p className="reading-tight text-[11px] text-(--color-muted)">{CORPUS_HELP}</p>
      {/* 收回和授权是同一种语言（一组 glob），所以是同一个 picker（F-A-14）。 */}
      <CorpusScopePicker
        value={text.split('\n').map((s) => s.trim()).filter((s) => s !== '')}
        onChange={(next) => setText(next.join('\n'))}
        testid={`code-corpus-picker-${codeLabel}`}
      />
      <span className="mono text-[9.5px] text-(--color-faint) mt-1">or write them by hand:</span>
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
