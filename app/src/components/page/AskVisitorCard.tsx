// AskVisitorCard —— I.1: ask_visitor tool 的 widget。AI 抛一段结构化问
// 题，visitor 一键回 (radio / multi / yes_no + 可选 free chat 叠加)。
//
// 选了 → 把选中项序列化成一段普通 user message 喂 onAsk()，agent loop
// 自然进入下一轮；这张卡 lock 住 (按钮 disabled + 显已选)，老 dialog
// 重渲也保持 locked (ask-visitor-store 记 dialogID)。

'use client';

import { useState } from 'react';

import type { ToolCallView } from '@/lib/page/use-chat';
import { pickAskVisitor, type AskVisitorPayload } from '@/lib/page/tool-call-shape';
import { useAskVisitorStore } from '@/lib/visitor/ask-visitor-store';
import styles from '@/components/page/AskVisitorCard.module.css';

interface Props {
  call: ToolCallView;
  dialogID: string;
  onAsk: (q: string) => void;
}

export function AskVisitorCard({ call, dialogID, onAsk }: Props) {
  const payload = pickAskVisitor(call.result);
  return payload === null ? null : (
    <AskVisitorBody payload={payload} dialogID={dialogID} onAsk={onAsk} />
  );
}

function AskVisitorBody({
  payload, dialogID, onAsk,
}: { payload: AskVisitorPayload; dialogID: string; onAsk: (q: string) => void }) {
  const answer = useAskVisitorStore((s) => s.pickAnswer(dialogID));
  const markAnswered = useAskVisitorStore((s) => s.markAnswered);
  return (
    <div
      className={styles['card']}
      data-testid="tool-card-ask_visitor"
      data-kind={payload.kind}
      data-answered={answer === null ? 'false' : 'true'}
    >
      <div className={styles['kicker']}>question · {payload.kind}</div>
      <div className={styles['question']} data-testid="ask-visitor-question">
        {payload.question}
      </div>
      <AskVisitorWidget
        payload={payload} answered={answer !== null}
        onSubmit={(snapshot) => commitAnswer(snapshot, dialogID, markAnswered, onAsk)}
      />
      {answer !== null && <div className={styles['answered']}>you · {answer}</div>}
    </div>
  );
}

function commitAnswer(
  snapshot: string, dialogID: string,
  mark: (id: string, s: string) => void, onAsk: (q: string) => void,
): void {
  mark(dialogID, snapshot);
  onAsk(snapshot);
}

interface WidgetProps {
  payload: AskVisitorPayload;
  answered: boolean;
  onSubmit: (snapshot: string) => void;
}

function AskVisitorWidget(p: WidgetProps) {
  const widgets = {
    yes_no: <YesNoWidget {...p} />,
    radio: <RadioWidget {...p} />,
    multi: <MultiWidget {...p} />,
  } as const;
  return widgets[p.payload.kind];
}

function YesNoWidget(p: WidgetProps) {
  return (
    <div className={`${styles['options']} ${styles['optionsYesNo']}`}>
      <OptionButton
        label="Yes" testid="ask-visitor-opt-yes" answered={p.answered}
        onClick={() => p.onSubmit('Yes')}
      />
      <OptionButton
        label="No" testid="ask-visitor-opt-no" answered={p.answered}
        onClick={() => p.onSubmit('No')}
      />
    </div>
  );
}

function RadioWidget(p: WidgetProps) {
  return (
    <div className={styles['options']}>
      {p.payload.options.map((opt, i) => (
        <OptionButton
          key={opt} label={opt}
          testid={`ask-visitor-opt-${i}`} answered={p.answered}
          onClick={() => p.onSubmit(opt)}
        />
      ))}
    </div>
  );
}

function MultiWidget(p: WidgetProps) {
  const [picked, setPicked] = useState<readonly string[]>([]);
  return (
    <>
      <div className={styles['options']}>
        {p.payload.options.map((opt, i) => (
          <MultiOption
            key={opt} opt={opt} i={i} picked={picked} setPicked={setPicked}
            answered={p.answered}
          />
        ))}
      </div>
      <button
        type="button" className={styles['submitMulti']}
        data-testid="ask-visitor-submit-multi"
        disabled={p.answered || picked.length === 0}
        onClick={() => p.onSubmit(picked.join(', '))}
      >
        submit ↵
      </button>
    </>
  );
}

function MultiOption({ opt, i, picked, setPicked, answered }: {
  opt: string; i: number; picked: readonly string[];
  setPicked: (next: readonly string[]) => void; answered: boolean;
}) {
  const on = picked.includes(opt);
  return (
    <OptionButton
      label={`${on ? '✓ ' : ''}${opt}`}
      testid={`ask-visitor-opt-${i}`} answered={answered}
      onClick={() => setPicked(on ? picked.filter((p) => p !== opt) : [...picked, opt])}
    />
  );
}

function OptionButton({ label, testid, answered, onClick }: {
  label: string; testid: string; answered: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button" className={styles['optionBtn']}
      data-testid={testid} disabled={answered} onClick={onClick}
    >
      {label}
    </button>
  );
}
