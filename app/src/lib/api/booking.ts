// booking.ts —— 约成卡上的两个确定性 POST(都不经 AI):
//   - #122 postBookingConfirmation:把确认信发到所选地址(引用/透传)。
//   - #123 postBookingCancellation:取消自己约的会议(隔离全在后端)。
// 从 public.ts 拆出来守 350-line cap;共用那边的 baseURL。

import { baseURL } from '@/lib/api/public';

// BookingConfirmOutcome —— 约成确认信的发送结果。sent/already_sent 都该锁卡;
// 其余按后端错误码区分给 UI 提示。
export type BookingConfirmOutcome =
  | 'sent' | 'already_sent' | 'no_recipient' | 'mail_unavailable' | 'error';

// postBookingConfirmation —— #122: 访客在约成卡上选好(引用/透传)后,把确认信发到
// 所选地址。前端不持 booking_id —— 只告诉后端 conversation_id + 可选 email + 浏览器
// 时区;后端按 session→conversation 定位最近一笔预约、硬控收件人、走 owner SMTP。
export async function postBookingConfirmation(
  conversationID: string, email: string, sessionToken: string,
): Promise<BookingConfirmOutcome> {
  try {
    const res = await fetch(`${baseURL()}/api/v1/booking-confirmation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({
        conversation_id: conversationID,
        email,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    if (res.ok) return 'sent';
    return bookingConfirmErrorFor(res.status);
  } catch {
    return 'error';
  }
}

function bookingConfirmErrorFor(status: number): BookingConfirmOutcome {
  if (status === 409) return 'already_sent';
  if (status === 422) return 'no_recipient';
  if (status === 503) return 'mail_unavailable';
  return 'error';
}

// BookingCancelOutcome —— 取消结果。cancelled=删成功(卡片落 cancelled 态);
// not_found=不是你约的/已不在(隔离门 404,UI 当作已没了);error=其它。
export type BookingCancelOutcome = 'cancelled' | 'not_found' | 'error';

// postBookingCancellation —— #123: 访客取消自己约的会议。只传 event_id;后端用
// session(owner+code+member)做隔离,不属于本 member → 404。
export async function postBookingCancellation(
  eventID: string, sessionToken: string,
): Promise<BookingCancelOutcome> {
  try {
    const res = await fetch(`${baseURL()}/api/v1/booking-cancellation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ event_id: eventID }),
    });
    if (res.ok) return 'cancelled';
    return res.status === 404 ? 'not_found' : 'error';
  } catch {
    return 'error';
  }
}
