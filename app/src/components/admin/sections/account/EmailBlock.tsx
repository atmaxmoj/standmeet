// EmailBlock —— /admin/account 的改邮箱那一块。
//
// 它比另外两块厚，因为改邮箱不是一个字段的事：email 这一列同时是**登录身份**和
// **恢复短语的收件人**，改它把两样一起搬走。所以这里有三样东西是别处没有的 ——
//   1. 输两遍（改密码早就要求两遍；同一个面板上同等危险的这一个却不要求，那是缺陷）
//   2. 待确认那一行（有 SMTP 时后端寄确认信、身份先不动 —— 看不见的话 owner 会以为改完了）
//   3. 撤销（反悔之后那封信里的链接也跟着死）
//
// blurb 必须把后果说全。原来只写 "Your login identity."，漏了后半句。

'use client';

import { useState } from 'react';

import { AcctBlock, PasswordField, SaveBtn } from '@/components/admin/sections/account/atoms';
import { emailHintMessage, emailSaveDisabled, pendingEmailNote } from '@/lib/admin/account-form';
import type { AccountHook, EmailChangeResult } from '@/lib/admin/use-account';
import { useToast } from '@/lib/ui/toast';

interface EmailBlockProps {
  hook: AccountHook;
  initialValue: string;
  // pending —— **从 session 传进来，不在这里存**。
  //
  // 第一版把它放在 useState 里，于是：保存成功 → hook 调 sessionStore.reset() →
  // session 回到 loading → 父组件在 ready 之前不渲染这一块 → EmailBlock 卸载重挂 →
  // useState 拿着重新算的初值（那时 session 还没回来，是空的）→ 待确认那一行**不出现**。
  // 后端明明已经写好了 pending、信也发了，屏幕上却什么都没有。
  //
  // 这正是"事实归产生它的那一方，别处只查询不记忆"：pending 住在 owners 表里，
  // 这里只该显示它。存第二份的那一刻就有两个真相，而它们会在最不该的时候分叉。
  pending: string;
}

export function EmailBlock({ hook, initialValue, pending }: EmailBlockProps) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState(initialValue);
  const [confirm, setConfirm] = useState('');
  const toast = useToast();
  const disabled = emailSaveDisabled(hook.pending, current, next, confirm, initialValue);
  const save = (): void => {
    void runSaveEmail(hook, { current, next }, { setCurrent, setConfirm }, toast);
  };
  return (
    <AcctBlock title="email" testid="account-email-block"
      blurb={'Your login identity — and where your recovery phrase is sent. '
        + 'Changing it moves both, so it needs your current password and the '
        + 'address twice.'}>
      <div>
        <PendingEmailRow
          pending={pending}
          onCancel={() => void runCancelEmail(hook, toast)}
        />
        <PasswordField
          testid="account-email-current-password"
          value={current} onChange={setCurrent} label="current password"
        />
        <EmailField
          testid="account-email-new" value={next} onChange={setNext}
          placeholder="you@example.com"
        />
        <div className="flex items-baseline gap-3 mt-3">
          <EmailField
            testid="account-email-confirm" value={confirm} onChange={setConfirm}
            placeholder="repeat the new address"
          />
          <SaveBtn testid="account-email-save" disabled={disabled} label="save email"
            onClick={save} />
        </div>
        <FieldHint message={emailHintMessage(next, confirm)} />
      </div>
    </AcctBlock>
  );
}

function EmailField(
  { testid, value, onChange, placeholder }:
  { testid: string; value: string; onChange: (v: string) => void; placeholder: string },
) {
  return (
    <input
      type="email" value={value} spellCheck={false} autoComplete="email"
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={testid}
      className="sm-field-input sm-field-lg flex-1 min-w-0 mt-3"
    />
  );
}

function FieldHint({ message }: { message: string }) {
  return (
    <div className="mono text-[10px] text-(--color-accent) mt-1 min-h-[1em]">{message}</div>
  );
}

// PendingEmailRow —— 待确认那一行。**看不见的待确认状态 = owner 不知道自己按下的
// 那一下有没有生效**，然后他会以为改完了、把旧地址弃用掉。
function PendingEmailRow(
  { pending, onCancel }: { pending: string; onCancel: () => void },
) {
  return pending === '' ? null : (
    <div
      data-testid="account-email-pending"
      className="flex items-baseline justify-between gap-3 mb-3 p-2 border border-(--color-accent)/40 rounded-[3px]"
    >
      <span className="reading text-[12.5px] text-(--color-muted)">
        {pendingEmailNote(pending)}
      </span>
      <SaveBtn
        testid="account-email-pending-cancel" disabled={false} label="cancel"
        onClick={onCancel}
      />
    </div>
  );
}

interface EmailSaveSetters {
  setCurrent: (v: string) => void;
  setConfirm: (v: string) => void;
}

async function runSaveEmail(
  hook: AccountHook, input: { current: string; next: string },
  set: EmailSaveSetters, toast: { success: (m: string) => void },
): Promise<void> {
  const saved = await hook.updateEmail(input.current, input.next);
  saved && finishEmailSave(set, toast, saved);
}

// finishEmailSave —— 两种结局说两句不同的话。"Email updated" 用在只寄了一封信的时候
// 就是谎话，而 owner 会照着那句话把旧地址弃用掉。
//
// 只清输入框，不碰 pending：那一行的值从 session 来，而 hook 已经 reset 过 session。
function finishEmailSave(
  set: EmailSaveSetters,
  toast: { success: (m: string) => void },
  saved: EmailChangeResult,
): void {
  set.setCurrent('');
  set.setConfirm('');
  toast.success(saved.pending === ''
    ? `Email updated to ${saved.email}`
    : `Confirmation sent to ${saved.pending} — your login has not changed yet`);
}

async function runCancelEmail(
  hook: AccountHook, toast: { success: (m: string) => void },
): Promise<void> {
  const email = await hook.cancelEmailChange();
  email && toast.success(
    'Pending email change dropped — that confirmation link no longer works',
  );
}
