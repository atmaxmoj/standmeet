// booking_confirmation.go —— #122: 访客约成后,确定性地把一封确认信发到所选地址
// (引用 session email / 透传现填地址)。**AI 不参与** —— 访客点卡片 → HTTP → 这段
// 代码确定性执行。走窄依赖(不胖 VisitorDeps),复用 OTP 那条 owner-SMTP mailer。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"net/mail"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

var (
	// ErrBookingNoRecipient —— 没有可用收件人(引用但 session 没 email,或透传非法)。
	ErrBookingNoRecipient = errors.New("booking confirmation: no valid recipient")
	// ErrBookingConfirmationSent —— 这笔已发过确认信(一笔一次)。
	ErrBookingConfirmationSent = errors.New("booking confirmation: already sent")
)

// BookingConfirmDeps —— 只装这段 usecase 真用的(窄依赖,不胖 VisitorDeps)。
// Proxy = 出站发信(连接器代调，凭据不出 vault；未配 → ErrMailNotConfigured)。
type BookingConfirmDeps struct {
	Calendar ConfirmationCalendar // 查这笔 booking + 标记已发
	Owners   ownerByIDGetter      // owner tz/名字 (窄口子 → deliverConfirmation 可单测)
	Proxy    MailProxy            // owner SMTP 发信（连接器代调）
	Mail     *postgres.MailRepo   // 只读 connector 状态（can-email gate）
}

// ownerByIDGetter —— deliverConfirmation 只用 owner 的 GetByID(tz/名字)。窄接口让并发安全逻辑
// (claim-before-send)能用 fake owner 单测，不绑具体 *postgres.OwnerRepo。
type ownerByIDGetter interface {
	GetByID(ctx context.Context, ownerID string) (domain.Owner, error)
}

// ConfirmationCalendar —— SendBookingConfirmation 只用 calendar 的两样:定位该对话
// 最近一笔预约 + 标记已发。窄接口(不绑 *postgres.CalendarRepo)让 resolveConfirmation
// 的归属/幂等/收件人逻辑能用 fake 单测。*postgres.CalendarRepo 满足它。
type ConfirmationCalendar interface {
	LatestBookingForConversation(
		ctx context.Context, conversationID string,
	) (domain.CodeBooking, error)
	// MarkBookingConfirmed —— CLAIM atomically; ErrBookingAlreadyConfirmed if already claimed.
	MarkBookingConfirmed(ctx context.Context, bookingID string) error
	// ClearBookingConfirmed —— release the claim when the send failed (so a retry can re-send).
	ClearBookingConfirmed(ctx context.Context, bookingID string) error
}

// SendBookingConfirmationInput —— OwnerID/ConversationID/CodeID 来自 session;
// Recipient 是透传地址(空则用 SessionEmail 引用);TZ 是访客浏览器时区(正文时间按它渲)。
type SendBookingConfirmationInput struct {
	OwnerID        string
	ConversationID string
	CodeID         string
	Recipient      string
	SessionEmail   string
	TZ             string
}

// SendBookingConfirmation —— 定位该对话最近一笔预约 → 校归属 + 幂等 → 挑收件人 →
// 走 owner SMTP 发 → 标记已发。两段拆开守 cognitive-complexity:resolve 做定位+校验,
// deliver 做发信+标记。
func SendBookingConfirmation(
	ctx context.Context, deps BookingConfirmDeps, in *SendBookingConfirmationInput,
) error {
	tgt, err := resolveConfirmation(ctx, deps, in)
	if err != nil {
		return err
	}
	return deliverConfirmation(ctx, deps, &tgt.Booking, tgt.Recipient, in.TZ)
}

// confirmationTarget —— resolveConfirmation 的产出:这笔预约 + 已校好的收件人。
type confirmationTarget struct {
	Booking   domain.CodeBooking
	Recipient string
}

// resolveConfirmation —— 拿该对话最近一笔预约,校归属(owner+code)、幂等(没发过)、
// 挑收件人。任一不过 → 对应 sentinel error。
func resolveConfirmation(
	ctx context.Context, deps BookingConfirmDeps, in *SendBookingConfirmationInput,
) (confirmationTarget, error) {
	booking, err := deps.Calendar.LatestBookingForConversation(ctx, in.ConversationID)
	if err != nil {
		return confirmationTarget{}, fmt.Errorf("latest booking: %w", err)
	}
	if verr := validateBookingScope(&booking, in); verr != nil {
		return confirmationTarget{}, verr
	}
	to, rerr := pickConfirmationRecipient(in)
	if rerr != nil {
		return confirmationTarget{}, rerr
	}
	return confirmationTarget{Booking: booking, Recipient: to}, nil
}

// validateBookingScope —— 这笔必须属于本 session(owner+code 都对)且没发过确认信。
func validateBookingScope(b *domain.CodeBooking, in *SendBookingConfirmationInput) error {
	if b.OwnerID != in.OwnerID || b.CodeID != in.CodeID {
		return domain.ErrBookingNotFound // 不属于本 session,不泄露存在性
	}
	if b.ConfirmationSentAt != nil {
		return ErrBookingConfirmationSent
	}
	return nil
}

// deliverConfirmation —— 走 owner SMTP 发确认信,成功后标记已发(一笔一次)。
func deliverConfirmation(
	ctx context.Context, deps BookingConfirmDeps,
	booking *domain.CodeBooking, to, tz string,
) error {
	owner, oerr := deps.Owners.GetByID(ctx, booking.OwnerID)
	if oerr != nil {
		return fmt.Errorf("get owner: %w", oerr)
	}
	msg := buildConfirmationEmail(booking, &owner, tz)
	msg.To = to
	// CLAIM before send (atomic): if already claimed → don't send (idempotent + concurrent-safe;
	// two simultaneous requests can't both pass the claim, so no double-send).
	if cerr := claimConfirmation(ctx, deps, booking.ID); cerr != nil {
		return cerr
	}
	return sendOrReleaseConfirmation(ctx, deps, booking.OwnerID, booking.ID, msg)
}

// claimConfirmation —— atomic claim; already-claimed → ErrBookingConfirmationSent (don't send).
func claimConfirmation(ctx context.Context, deps BookingConfirmDeps, bookingID string) error {
	merr := deps.Calendar.MarkBookingConfirmed(ctx, bookingID)
	if merr == nil {
		return nil
	}
	if errors.Is(merr, domain.ErrBookingAlreadyConfirmed) {
		return ErrBookingConfirmationSent
	}
	return fmt.Errorf("claim booking confirmation: %w", merr)
}

// sendOrReleaseConfirmation —— send after claiming; on send failure release the claim so a retry
// can re-send (no email went out).
func sendOrReleaseConfirmation(
	ctx context.Context, deps BookingConfirmDeps, ownerID, bookingID string, msg MailMessage,
) error {
	serr := deps.Proxy.Send(ctx, ownerID, msg)
	if serr == nil {
		return nil
	}
	if cerr := deps.Calendar.ClearBookingConfirmed(ctx, bookingID); cerr != nil {
		_ = cerr
	}
	// 未配 connector → proxy 返 ErrMailNotConfigured（%w 保留给 route 翻译）。
	return fmt.Errorf("send booking confirmation: %w", serr)
}

// pickConfirmationRecipient —— 透传优先,否则引用 session email;校验邮箱格式。
func pickConfirmationRecipient(in *SendBookingConfirmationInput) (string, error) {
	to := in.Recipient
	if to == "" {
		to = in.SessionEmail
	}
	if _, perr := mail.ParseAddress(to); to == "" || perr != nil {
		return "", ErrBookingNoRecipient
	}
	return to, nil
}

// buildConfirmationEmail / confirmationLocation 见 booking_confirmation_email.go
// (HTML + schema.org JSON-LD 模板拆出去守 350-line cap)。
