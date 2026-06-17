// VisitorNamePicker —— code-mode visitor 第一次进 chat-capable surface 时
// 弹窗问名字。owner 在 /admin/conversations 看 transcript 时需要知道是谁。
//
// 触发条件 / 持久化逻辑全在 lib/visitor/visitor-name.ts；这里纯渲染。
//
// 设计源 docs/design/project/app.js VisitorNamePicker。expected[] prop 留位 ——
// 现在 store 没存 code members 列表，先不渲染候选；以后 server 返了再开。

'use client';

import { useState } from 'react';

import { usePendingCodeStore } from '@/lib/gate/use-pending-code-store';
import {
  dismissPicker,
  submitPickerName,
  useIssuePendingCode,
  type IssueOutcome,
} from '@/lib/gate/use-issue-pending-code';
import { memberCapacityLine, useCodeIntro } from '@/lib/gate/use-code-intro';
import {
  loadVisitorName,
  loadVisitorEmail,
  useShouldAskVisitorName,
} from '@/lib/visitor/visitor-name';

export function VisitorNamePicker() {
  const should = useShouldAskVisitorName();
  return should ? <Modal /> : null;
}

function Modal() {
  // 初值从 localStorage load 上次用的名字 + 可选邮箱(同一个人再开自动带出来)。
  const [name, setName] = useState(loadVisitorName);
  const [email, setEmail] = useState(loadVisitorEmail);
  const [full, setFull] = useState(false);
  const code = usePendingCodeStore((s) => s.code);
  const intro = useCodeIntro();
  const { issue, busy } = useIssuePendingCode();
  const onSubmit = () => { void settleOutcome(submitPickerName(name, email, issue), setFull); };
  const onDismiss = () => { void settleOutcome(dismissPicker(issue), setFull); };
  return (
    // 点窗外(backdrop,非 card)= dismiss:换人窗取消保持原 session,首次则 skip。
    <div
      className="sm-fadein sm-visitor-name-overlay"
      data-testid="visitor-name-overlay"
      onClick={(e) => { (e.target === e.currentTarget) && onDismiss(); }}
    >
      <div className="sm-visitor-name-card sm-rise">
        <PickerHeader code={code} greeting={intro?.greeting ?? ''} />
        <PickerBody
          name={name} onName={setName} email={email} onEmail={setEmail}
          going={busy} full={full}
          capacityLine={memberCapacityLine(intro)}
          onSubmit={onSubmit}
          onDismiss={onDismiss}
        />
      </div>
    </div>
  );
}

// settleOutcome —— 提交/dismiss 的收尾:'full' → 显满额。'ok' 已 consume pending
// → picker 自动隐藏;'error' → busy 复位可重试。
async function settleOutcome(
  p: Promise<IssueOutcome>, setFull: (v: boolean) => void,
): Promise<void> {
  const outcome = await p;
  (outcome === 'full') && setFull(true);
}

// PickerHeader —— access kicker → owner 设的「这是什么」greeting → "Who's reading?"。
function PickerHeader({ code, greeting }: { code: string | null; greeting: string }) {
  return (
    <div className="sm-visitor-name-head">
      <div className="sm-smallcaps">
        {code ? `access granted · code ${code}` : 'before we begin'}
      </div>
      {greeting !== '' && (
        <p className="sm-visitor-name-greeting" data-testid="visitor-name-greeting">
          {greeting}
        </p>
      )}
      <div className="sm-visitor-name-h1">Who&apos;s reading?</div>
    </div>
  );
}

interface BodyProps {
  name: string;
  onName: (v: string) => void;
  email: string;
  onEmail: (v: string) => void;
  going: boolean;
  full: boolean;
  capacityLine: string;
  onSubmit: () => void;
  onDismiss: () => void;
}

function PickerBody(props: BodyProps) {
  return (
    <div className="sm-visitor-name-body">
      {props.full ? <PickerFull /> : <PickerPrompt {...props} />}
    </div>
  );
}

// PickerFull —— 这张码名字数满了:进不来,讲清楚 + 让 visitor 找分享码的人。
function PickerFull() {
  return (
    <p className="sm-reading sm-visitor-name-blurb" data-testid="visitor-name-full">
      This code is full — it&rsquo;s reached its limit of names. Ask whoever
      shared it with you for a fresh one.
    </p>
  );
}

function PickerPrompt(props: BodyProps) {
  return (
    <>
      <p className="sm-reading sm-visitor-name-blurb">
        One last thing before the chat starts — the owner sees this on your
        transcript later. Pick a short name; a handle is fine.
      </p>
      <p
        className="sm-reading sm-visitor-name-blurb sm-visitor-name-note"
        data-testid="visitor-name-capacity"
      >
        {props.capacityLine !== ''
          ? props.capacityLine
          : 'More than one person can use this code.'}{' '}
        Keep using the <strong>same name</strong> and your chats stay grouped as
        you; a <strong>different name</strong> reads as a new person and starts a
        separate conversation. Passing the code to someone else? Have them scan
        it and pick their own name.
      </p>
      <PickerForm {...props} />
      {props.going && <PickerGoing />}
    </>
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
      <input
        type="email"
        value={props.email}
        onChange={(e) => props.onEmail(e.target.value)}
        placeholder="email (optional, for meeting invites)"
        className="sm-visitor-name-input"
        data-testid="visitor-email-input"
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
