// CodePanel —— gate Hero 里的 code 输入栏。
//
// 设计稿那种 7 字 cell 分格 + 自动 fan-out + shake on error 是更高品质，但
// backend code 格式是 LABEL-NNN（可变长），所以这里实现一个折中版：单个
// 输入框，mono 大字 + accent caret + 上下 ink 双横线，submit 后边上挂"checking…"。
// 满足"have a code? drop it in"那行字下方的视觉重量。

'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { GateHook } from '@/lib/gate/use-gate';

type Props = {
  handle: string;
  hook: GateHook;
};

export function CodePanel({ handle, hook }: Props) {
  const router = useRouter();
  const [code, setCode] = useState('');

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    trimmed !== '' && (await runCodeSubmit(handle, trimmed, hook, router));
  }, [code, handle, hook, router]);

  return (
    <section data-testid="code-panel">
      <form onSubmit={onSubmit}>
        <div className="flex items-baseline gap-4 py-3 border-t-[1.5px] border-b-[1.5px] border-(--color-ink) relative">
          <span
            className="text-(--color-accent) font-serif shrink-0"
            style={{ fontSize: '28px', lineHeight: 1 }}
          >›</span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="LABEL–NNN"
            data-testid="gate-code"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 bg-transparent mono text-(--color-ink) placeholder:text-(--color-faint) min-w-0"
            style={{ fontSize: '24px', letterSpacing: '0.08em', textTransform: 'uppercase' }}
          />
          <CodeSubmit busy={hook.state.busy} />
        </div>
      </form>
      <p className="mono text-[10.5px] tracking-[0.12em] text-(--color-faint) mt-4 leading-[1.7]" style={{ maxWidth: '40em' }}>
        codes look like <span className="text-(--color-muted)">INTRO–001</span>. they arrive by
        email from the owner directly · case doesn&rsquo;t matter · paste the whole thing.
      </p>
    </section>
  );
}

function CodeSubmit({ busy }: { busy: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy}
      data-testid="gate-code-submit"
      className="mono text-[11.5px] tracking-[0.18em] uppercase text-(--color-muted) hover:text-(--color-accent) disabled:text-(--color-faint) transition-colors shrink-0 pt-1"
    >
      {busy ? 'checking…' : <>enter <span className="text-[14px]">↵</span></>}
    </button>
  );
}

async function runCodeSubmit(
  handle: string,
  code: string,
  hook: GateHook,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  const ok = await hook.submitCode(handle, code);
  ok && router.push(`/${handle}`);
}
