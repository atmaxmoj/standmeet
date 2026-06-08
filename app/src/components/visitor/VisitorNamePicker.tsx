// VisitorNamePicker —— code-mode visitor 第一次进 chat-capable surface 时
// 弹窗问名字。owner 在 /admin/conversations 看 transcript 时需要知道是谁。
//
// 触发条件 / 持久化逻辑全在 lib/visitor/visitor-name.ts；这里纯渲染。
//
// 设计源 docs/design/project/app.js VisitorNamePicker。expected[] prop 留位 ——
// 现在 store 没存 code members 列表，先不渲染候选；以后 server 返了再开。

'use client';

import { useState } from 'react';

import { useVisitorSessionStore } from '@/lib/visitor/session-store';
import {
  dismissNamePicker,
  submitNameAndStart,
  useShouldAskVisitorName,
} from '@/lib/visitor/visitor-name';

export function VisitorNamePicker() {
  const should = useShouldAskVisitorName();
  return should ? <Modal /> : null;
}

function Modal() {
  const [name, setName] = useState('');
  const [going, setGoing] = useState(false);
  const setVisitor = useVisitorSessionStore((s) => s.setVisitor);
  const code = useVisitorSessionStore((s) => s.session?.code ?? null);
  return (
    <div className="sm-fadein sm-visitor-name-overlay">
      <div className="sm-visitor-name-card sm-rise">
        <PickerHeader code={code} />
        <PickerBody
          name={name} onName={setName} going={going}
          onSubmit={() => onSubmit(name, setGoing, setVisitor)}
          onDismiss={() => dismissNamePicker(setVisitor)}
        />
      </div>
    </div>
  );
}

function onSubmit(
  name: string,
  setGoing: (v: boolean) => void,
  setVisitor: (n: string) => void,
): void {
  const ok = submitNameAndStart(name, setVisitor);
  ok && setGoing(true);
}

function PickerHeader({ code }: { code: string | null }) {
  return (
    <div className="sm-visitor-name-head">
      <div className="sm-smallcaps">
        {code ? `access granted · code ${code}` : 'before we begin'}
      </div>
      <div className="sm-visitor-name-h1">Who&apos;s reading?</div>
    </div>
  );
}

interface BodyProps {
  name: string;
  onName: (v: string) => void;
  going: boolean;
  onSubmit: () => void;
  onDismiss: () => void;
}

function PickerBody(props: BodyProps) {
  return (
    <div className="sm-visitor-name-body">
      <p className="sm-reading sm-visitor-name-blurb">
        One last thing before the chat starts — the owner sees this on your
        transcript later. Pick a short name; a handle is fine.
      </p>
      <p className="sm-reading sm-visitor-name-blurb sm-visitor-name-note">
        More than one person can use this code. Keep using the{' '}
        <strong>same name</strong> and your chats stay grouped as you; a{' '}
        <strong>different name</strong> reads as a new person and starts a
        separate conversation. Passing the code to someone else? Have them
        scan it and pick their own name.
      </p>
      <PickerForm {...props} />
      {props.going && <PickerGoing />}
    </div>
  );
}

function PickerForm(props: BodyProps) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); props.onSubmit(); }}
      className="sm-visitor-name-form"
    >
      <span className="sm-visitor-name-prompt">›</span>
      <input
        type="text"
        value={props.name}
        onChange={(e) => props.onName(e.target.value)}
        placeholder="your name"
        autoFocus
        className="sm-visitor-name-input"
        data-testid="visitor-name-input"
      />
      <button
        type="submit"
        disabled={props.going || !props.name.trim()}
        className="sm-btn sm-btn-ghost"
        data-testid="visitor-name-submit"
      >
        start ↵
      </button>
      <button
        type="button"
        onClick={props.onDismiss}
        className="sm-btn sm-btn-danger"
        data-testid="visitor-name-skip"
      >
        skip
      </button>
    </form>
  );
}

function PickerGoing() {
  return (
    <div className="sm-visitor-name-going sm-smallcaps">
      starting chat
      <span className="sm-dot">·</span>
      <span className="sm-dot">·</span>
      <span className="sm-dot">·</span>
    </div>
  );
}
