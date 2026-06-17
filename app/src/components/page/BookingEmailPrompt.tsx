// BookingEmailPrompt —— #122: 约成后 BookCard 里的"发确认邮件吗"那一截。
//
// 三个选择,**全是访客点、后端确定性执行,AI 不参与**:
//   - 引用(booking-email-use-profile):发到进入时填的 session email(后端硬控,
//     前端不传地址);仅当 session 真有 email 时渲染。
//   - 透传(booking-email-other + booking-email-send):访客现填一个地址再发。
//   - 不发(booking-email-skip):什么都不发,直接锁卡。
//
// 一笔 booking 只发一次:发出/已发都进 sent 态(锁卡,动作消失)。owner 没配 mail
// connector 或缺 conversationID → 整截不渲染。状态机在 use-booking-email,本文件纯渲。

'use client';

import { useState } from 'react';

import { useBookingEmail, type BookingEmailControl } from '@/lib/page/use-booking-email';
import styles from '@/components/page/BookingEmailPrompt.module.css';

export function BookingEmailPrompt({ conversationID }: { conversationID?: string }) {
  const ctl = useBookingEmail(conversationID);
  return !ctl.visible ? null : (
    <div
      className={styles['prompt']} data-testid="booking-email-prompt"
      data-sent={ctl.phase === 'sent'}
    >
      {ctl.phase === 'sent'
        ? <div className={styles['done']} data-testid="booking-email-done">noted ✓</div>
        : <BookingEmailChoices ctl={ctl} />}
    </div>
  );
}

function BookingEmailChoices({ ctl }: { ctl: BookingEmailControl }) {
  const [other, setOther] = useState('');
  const busy = ctl.phase === 'sending';
  return (
    <>
      <div className={styles['kicker']}>email a confirmation?</div>
      <UseProfileButton sessionEmail={ctl.sessionEmail} busy={busy} onSend={ctl.send} />
      <OtherAddressRow other={other} setOther={setOther} busy={busy} onSend={ctl.send} />
      <button
        type="button" className={styles['skip']} disabled={busy}
        data-testid="booking-email-skip" onClick={ctl.skip}
      >
        don&rsquo;t send
      </button>
      <ErrorLine error={ctl.error} />
    </>
  );
}

function UseProfileButton({ sessionEmail, busy, onSend }: {
  sessionEmail: string; busy: boolean; onSend: (email: string) => void;
}) {
  return sessionEmail === '' ? null : (
    <button
      type="button" className={styles['choice']} disabled={busy}
      data-testid="booking-email-use-profile" onClick={() => onSend('')}
    >
      send to {sessionEmail}
    </button>
  );
}

function OtherAddressRow({ other, setOther, busy, onSend }: {
  other: string; setOther: (v: string) => void;
  busy: boolean; onSend: (email: string) => void;
}) {
  return (
    <div className={styles['otherRow']}>
      <input
        type="email" className={styles['otherInput']} placeholder="another address"
        value={other} onChange={(e) => setOther(e.target.value)}
        disabled={busy} data-testid="booking-email-other"
      />
      <button
        type="button" className={styles['choice']} disabled={busy || other.trim() === ''}
        data-testid="booking-email-send" onClick={() => onSend(other.trim())}
      >
        send
      </button>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error === null ? null : (
    <div className={styles['error']} data-testid="booking-email-error">{error}</div>
  );
}
