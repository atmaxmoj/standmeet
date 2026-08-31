// account.go —— owner 自己的账号:读 me、改名、改时区、改邮箱、改密码、生成恢复口令。
//
// 带**当前密码**或**新生成的密钥**的那三个是写下来的单面决定:只在面板上。MCP 是纯 JSON
// 工具面,不承载原始凭据。
//
// 迁移前 MCP 的 `me` 是**手拼字符串**出来的 JSON,只有四个字段,而且没有转义 —— 名字里带
// 一个引号就会拼出非法 JSON。现在跟面板的 GET /me 同一份形状、同一个序列化器。

package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// AccountDeps —— 这一组要的依赖。改邮箱 / 改密码要当前密码,生成恢复口令要发信,
// 所以横跨 account 和 recovery 两套。
type AccountDeps struct {
	Account  usecase.AccountDeps
	Recovery usecase.RecoveryDeps
	// EmailChange —— 改邮箱要问"发得出信吗"(有 mail connector 就走待确认,没有就当场换),
	// 所以它比 Account 多一个出站口。
	EmailChange usecase.EmailChangeDeps
}

// Account —— me / set_full_name / set_timezone / change_email / change_password /
// generate_recovery。
func Account(deps AccountDeps) []fp.Op {
	return append(accountReadOps(deps), accountCredentialOps(deps)...)
}

func accountReadOps(deps AccountDeps) []fp.Op {
	return []fp.Op{
		{
			ID:          "me",
			Description: "Return the authenticated StandMeet owner and their settings.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      readMe(deps.Account),
		},
		{
			ID:          "account.set_full_name",
			Description: "Change the owner's display name.",
			InputSchema: fullNameSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setFullName(deps.Account),
		},
		{
			ID: "account.set_timezone",
			Description: "Set the owner's IANA timezone (e.g. America/New_York). Capabilities " +
				"that reason about time of day — booking hours, for one — read it from here; " +
				"it is the owner's profile, not any one capability's setting.",
			InputSchema: timezoneSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setTimezone(deps.Account),
		},
	}
}

// accountCredentialOps —— 带凭据的三个:只在面板上,理由写在每条的 Reach 里。
func accountCredentialOps(deps AccountDeps) []fp.Op {
	credentialed := func(why string) fp.Reach { return fp.Only(why, "admin") }
	return []fp.Op{
		{
			ID: "account.change_email",
			Description: "Change the login email. Requires the current password; panel-only " +
				"because it carries a raw credential.",
			InputSchema: changeEmailSchema,
			Kind:        fp.Action,
			Reach: credentialed(
				"verifies + changes the login email (current-password gated)"),
			Invoke: changeEmail(deps.EmailChange),
		},
		{
			ID: "account.cancel_email_change",
			Description: "Drop a pending email change. The confirmation link in the message " +
				"that was already sent stops working.",
			InputSchema: noArgs,
			Kind:        fp.Action,
			Reach:       credentialed("touches the login identity"),
			Invoke:      cancelEmailChange(deps.EmailChange),
		},
		{
			ID: "account.change_password",
			Description: "Change the login password. Requires the current password; " +
				"panel-only because it carries raw credentials.",
			InputSchema: changePasswordSchema,
			Kind:        fp.Action,
			Reach:       credentialed("raw password; current-password gated"),
			Invoke:      changePassword(deps.Account),
		},
		{
			ID: "account.generate_recovery",
			Description: "Mint a new account-recovery phrase. Only its hash is stored; the " +
				"phrase itself is sent to the owner.",
			InputSchema: noArgs,
			Kind:        fp.Action,
			Reach:       credentialed("mints a recovery secret"),
			Invoke:      generateRecovery(deps.Recovery),
		},
	}
}

var (
	fullNameSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"full_name":{"type":"string","description":"New display name."}},
		"required":["full_name"]
	}`)

	timezoneSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"timezone":{"type":"string","description":"IANA tz name."}},
		"required":["timezone"]
	}`)

	changeEmailSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"current_password":{"type":"string"},
			"new_email":{"type":"string"}
		},
		"required":["current_password","new_email"]
	}`)

	changePasswordSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"current_password":{"type":"string"},
			"new_password":{"type":"string","description":"At least 12 characters."}
		},
		"required":["current_password","new_password"]
	}`)
)

// accountErr —— 域的哨兵 → 协议无关的类别。owner 不存在 / 密码不对 = 这次会话的身份不成立
// → Unauthed(前端据此跳登录);code 是已经发出去的契约。
func accountErr(err error) error {
	for _, c := range accountErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("account op", err)
}

var accountErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{entity.ErrOwnerNotFound, func() error {
		return fp.Coded(fp.Unauthed("owner not found"), "unauthorized")
	}},
	// 这一族 op 里 ErrUnauthorized 只有一个来源：**当前密码填错了**。owner 已经带着
	// session 进来了，他在这一步唯一提供的凭据就是那一个字段。所以说"invalid credentials"
	// 是把一句他能照着做的话，换成了一句他得猜的话 —— 而 CLAUDE.md 要求错误是人话。
	// 这里也没有枚举风险：能走到这一步的人本来就已经登录了。
	{entity.ErrUnauthorized, func() error {
		return fp.Coded(fp.Unauthed("current password is incorrect"), "unauthorized")
	}},
	{entity.ErrEmailTaken, func() error {
		return fp.Coded(fp.Conflict("email already in use"), "email_taken")
	}},
	{usecase.ErrPasswordTooShort, func() error {
		return fp.BadInput("password must be at least 12 characters")
	}},
	{apierr.ErrEmptyField, func() error {
		return fp.BadInput("required field is empty")
	}},
}

// ownerFieldOut —— 改完一个字段之后回它的新值(面板一直是这个形状)。
type ownerFieldOut struct {
	FullName string `json:"full_name,omitempty"`
	Email    string `json:"email,omitempty"`
}

func setFullName(deps usecase.AccountDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			FullName string `json:"full_name"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		updated, err := usecase.UpdateOwnerFullName(ctx, deps, ownerID, in.FullName)
		if err != nil {
			return nil, accountErr(err)
		}
		return json.Marshal(ownerFieldOut{FullName: updated.FullName})
	}
}

// setTimezone —— 空串 = UTC(域那侧的约定)。
func setTimezone(deps usecase.AccountDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			Timezone string `json:"timezone"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := deps.Owners.UpdateProfileTimezone(ctx, ownerID, in.Timezone); err != nil {
			return nil, accountErr(err)
		}
		profile, gerr := deps.Owners.GetByID(ctx, ownerID)
		if gerr != nil {
			return nil, accountErr(gerr)
		}
		return json.Marshal(map[string]string{"timezone": profile.ProfileTimezone})
	}
}
