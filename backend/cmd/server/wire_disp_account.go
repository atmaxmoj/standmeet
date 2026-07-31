// wire_disp_account.go —— owner 账号相关的普通函数 → 出站收口的窄口。
//
// 改邮箱 / 改密码要当前密码,生成恢复口令要发信 —— 这三个横跨 account 和 recovery 两套依赖,
// 拼在一起是组装根的事。收口只看见一个 account 资源。

package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

type accountOps struct {
	account  owner.AccountDeps
	recovery owner.RecoveryDeps
}

func newAccountOps(d *runtimeDeps) accountOps {
	return accountOps{
		account:  owner.AccountDeps{Owners: d.ownerRepo},
		recovery: recoveryDeps(d),
	}
}

func (a accountOps) Me(ctx context.Context, ownerID string) (dispatcher.Me, error) {
	profile, err := a.account.Owners.GetByID(ctx, ownerID)
	if err != nil {
		return dispatcher.Me{}, accountErr(err)
	}
	settings, serr := a.account.Owners.GetSettings(ctx, ownerID)
	if serr != nil {
		return dispatcher.Me{}, accountErr(serr)
	}
	return dispatcher.Me{
		Owner: dispatcher.OwnerProfile{
			OwnerID: profile.ID, Email: profile.Email, Handle: profile.Handle,
			FullName: profile.FullName, PublicURL: profile.PublicURL,
		},
		Settings: toDispatcherSettings(&settings),
	}, nil
}

func (a accountOps) SetFullName(
	ctx context.Context, ownerID, fullName string,
) (string, error) {
	updated, err := owner.UpdateOwnerFullName(ctx, a.account, ownerID, fullName)
	if err != nil {
		return "", accountErr(err)
	}
	return updated.FullName, nil
}

func (a accountOps) ChangeEmail(
	ctx context.Context, in *dispatcher.ChangeEmail,
) (string, error) {
	updated, err := owner.UpdateOwnerEmail(ctx, a.account, &owner.EmailUpdateInput{
		OwnerID: in.OwnerID, CurrentPassword: in.CurrentPassword, NewEmail: in.NewEmail,
	})
	if err != nil {
		return "", accountErr(err)
	}
	return updated.Email, nil
}

func (a accountOps) ChangePassword(ctx context.Context, in *dispatcher.ChangePassword) error {
	return accountErr(owner.UpdateOwnerPassword(ctx, a.account, &owner.PasswordUpdateInput{
		OwnerID:         in.OwnerID,
		CurrentPassword: in.CurrentPassword,
		NewPassword:     in.NewPassword,
	}))
}

// GenerateRecovery —— 发不出去就是**外部依赖**的问题(邮件连接器没配好),
// 这句话可以直接给 owner 看,而不是一句 internal error。
func (a accountOps) GenerateRecovery(ctx context.Context, ownerID string) error {
	if err := owner.GenerateRecovery(ctx, &a.recovery, ownerID); err != nil {
		//nolint:wrapcheck // 类别错误原样上抛
		return dispatcher.Coded(
			dispatcher.Upstream(
				"couldn't email the recovery phrase — verify your mail connector first"),
			"recovery_send_failed")
	}
	return nil
}

func accountErr(err error) error {
	if err == nil {
		return nil
	}
	if classed := classifyAccountErr(err); classed != nil {
		return classed
	}
	return fmt.Errorf("account op: %w", err)
}

func classifyAccountErr(err error) error {
	for _, c := range accountErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return nil
}

var accountErrClasses = []struct {
	sentinel error
	as       func() error
}{
	// owner 不存在 / 密码不对 → 401(前端据此跳登录);code 是已经发出去的契约。
	{owner.ErrOwnerNotFound, func() error {
		return dispatcher.Coded(dispatcher.Unauthed("owner not found"), "unauthorized")
	}},
	{owner.ErrUnauthorized, func() error {
		return dispatcher.Coded(dispatcher.Unauthed("invalid credentials"), "unauthorized")
	}},
	{owner.ErrEmailTaken, func() error {
		return dispatcher.Coded(dispatcher.Conflict("email already in use"), "email_taken")
	}},
	{owner.ErrPasswordTooShort, func() error {
		return dispatcher.BadInput("password must be at least 12 characters")
	}},
	{apierr.ErrEmptyField, func() error {
		return dispatcher.BadInput("required field is empty")
	}},
}
