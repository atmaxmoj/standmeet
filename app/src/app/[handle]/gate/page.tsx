// /<handle>/gate —— 访客没拿到 code 或想 BYOAI 时的入口。
//
// 三栏：CodeInput (LABEL-XXX) / BYOAIPanel (provider + key) / RequestPanel
// (申请 access)。提交分别走不同 POST，参考 use-gate hook。

'use client';

import { use } from 'react';

import { BYOAIPanel } from '@/components/gate/BYOAIPanel';
import { CodePanel } from '@/components/gate/CodePanel';
import { RequestPanel } from '@/components/gate/RequestPanel';
import { useGate } from '@/lib/gate/use-gate';

export default function GatePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const hook = useGate();
  return (
    <main className="mx-auto max-w-[640px] px-6 py-16 space-y-16">
      <Header handle={handle} />
      <CodePanel handle={handle} hook={hook} />
      <Divider />
      <BYOAIPanel handle={handle} hook={hook} />
      <Divider />
      <RequestPanel handle={handle} hook={hook} />
      <GateError message={hook.state.error} />
    </main>
  );
}

function Header({ handle }: { handle: string }) {
  return (
    <header>
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3">
        {handle} · gated entry
      </div>
      <h1 className="reading-tight text-3xl font-normal">
        You need a way in<span className="text-(--color-accent)">.</span>
      </h1>
      <p className="reading italic text-(--color-muted) mt-3 text-base">
        Three options: a code the owner gave you, your own API key for the public slice, or a request.
      </p>
    </header>
  );
}

function Divider() {
  return <hr className="rule rule-soft" />;
}

function GateError({ message }: { message: string | null }) {
  return message
    ? <p className="mono text-xs text-(--color-accent)" data-testid="gate-error">{message}</p>
    : null;
}
