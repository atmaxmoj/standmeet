// booking_owner_notify.go —— #130: per-role「约成通知 owner」。访客在某 role 下约成
// 后,若该 role 开了开关,给 **owner 自己** 发一封 owner 视角的通知邮件(区别于 #122
// 发给访客的确认信)。AI 不参与:booking commit 后确定性触发,best-effort —— role 关 /
// 没配 mail connector → 静默跳过,绝不挡 booking。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mailer"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// OwnerNotifyDeps —— 窄依赖:role 开关(实时读)+ owner mail。
type OwnerNotifyDeps struct {
	Mail   *postgres.MailRepo
	Owners *postgres.OwnerRepo
	Roles  *postgres.RoleRepo
}

// NotifyOwnerOfBookingInput —— OwnerID/RoleID 来自 session(RoleSnapshot);其余来自
// 这笔 booking(访客名 / 主题 / 起止)。
type NotifyOwnerOfBookingInput struct {
	StartAt     time.Time
	EndAt       time.Time
	OwnerID     string
	RoleID      string
	VisitorName string
	Topic       string
}

// NotifyOwnerOfBooking —— 实时查 role 开关 → 开了且配了 mail → 给 owner 发通知。
func NotifyOwnerOfBooking(
	ctx context.Context, deps OwnerNotifyDeps, in *NotifyOwnerOfBookingInput,
) error {
	want, err := ownerWantsBookingNotify(ctx, deps, in.RoleID)
	if err != nil {
		return err
	}
	if !want {
		return nil // 无 role / owner 没开这个 role 的通知
	}
	return sendOwnerNotify(ctx, deps, in)
}

// ownerWantsBookingNotify —— 这个 role 是否开了 owner 通知(无 role → false)。
func ownerWantsBookingNotify(
	ctx context.Context, deps OwnerNotifyDeps, roleID string,
) (bool, error) {
	if roleID == "" {
		return false, nil
	}
	on, err := deps.Roles.NotifiesOwnerOnBooking(ctx, roleID)
	if err != nil {
		return false, fmt.Errorf("role notify flag: %w", err)
	}
	return on, nil
}

// sendOwnerNotify —— 走 owner SMTP 发 owner 视角的通知。没配 connector → best-effort
// 跳过(不报错)。
func sendOwnerNotify(
	ctx context.Context, deps OwnerNotifyDeps, in *NotifyOwnerOfBookingInput,
) error {
	conn, cerr := loadConfiguredConnector(ctx,
		MailDeps{Mail: deps.Mail, Owners: deps.Owners}, in.OwnerID)
	if cerr != nil {
		if errors.Is(cerr, ErrMailNotConfigured) {
			return nil // 没配 connector → 发不了,跳过
		}
		return cerr
	}
	owner, oerr := deps.Owners.GetByID(ctx, in.OwnerID)
	if oerr != nil {
		return fmt.Errorf("get owner: %w", oerr)
	}
	msg := buildOwnerNotifyEmail(in, &owner)
	if serr := mailer.Compose(connectorConfig(&conn)).
		To(owner.Email).Subject(msg.Subject).Body(msg.Body).Send(); serr != nil {
		return fmt.Errorf("send owner notify: %w", serr)
	}
	return nil
}

// buildOwnerNotifyEmail —— owner 视角:谁在什么时候约了什么。时间按 owner 自己的 tz 渲。
func buildOwnerNotifyEmail(
	in *NotifyOwnerOfBookingInput, owner *domain.Owner,
) mailer.Message {
	loc := confirmationLocation("", owner.ProfileTimezone) // owner tz,缺省退 UTC
	when := in.StartAt.In(loc).Format("Monday, Jan 2, 2006 · 3:04 PM MST")
	who := in.VisitorName
	if who == "" {
		who = "A visitor"
	}
	body := fmt.Sprintf("New booking on your calendar:\n\n  %s\n  with %s\n  %s\n",
		in.Topic, who, when)
	return mailer.Message{Subject: "New booking: " + in.Topic, Body: body}
}
