// res_account.go —— 资源 account:owner 自己的账号(读 me、改名、改邮箱、改密码、生成恢复口令)。
//
// 后三个都带**当前密码**或**新生成的密钥**,所以是写下来的单面决定:只在 admin 上。
// MCP 是纯 JSON 工具面,不承载原始凭据。
//
// 迁移前 MCP 的 `me` 是**手拼字符串**出来的 JSON,只有四个字段,而且没有转义 ——
// 名字里带一个引号就会拼出非法 JSON。现在跟 admin 的 GET /me 同一份形状、同一个序列化器。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// AccountStore —— account 这组操作所需的最小口。
type AccountStore interface {
	Me(ctx context.Context, ownerID string) (Me, error)
	SetFullName(ctx context.Context, ownerID, fullName string) (string, error)
	ChangeEmail(ctx context.Context, in *ChangeEmail) (string, error)
	ChangePassword(ctx context.Context, in *ChangePassword) error
	GenerateRecovery(ctx context.Context, ownerID string) error
}

// Me —— owner 自己 + 他的推理设置(admin 的 GET /me 一直是这个信封)。
type Me struct {
	Owner    OwnerProfile
	Settings Settings
}

// OwnerProfile —— owner 的公开档案字段。没有密码、没有任何凭据。
type OwnerProfile struct {
	OwnerID   string
	Email     string
	Handle    string
	FullName  string
	PublicURL string
}

// ChangeEmail —— 改登录邮箱的入参(要当前密码)。
type ChangeEmail struct {
	OwnerID         string
	CurrentPassword string
	NewEmail        string
}

// ChangePassword —— 改密码的入参(要当前密码)。
type ChangePassword struct {
	OwnerID         string
	CurrentPassword string
	NewPassword     string
}

// Account —— account 资源:me / set_full_name / change_email / change_password /
// generate_recovery。
func Account(store AccountStore) Resource {
	// credentialed —— 带凭据的动作只在 admin 面(MCP 是纯 JSON 工具面,不承载原始凭据)。
	credentialed := func(why string) fp.Reach { return fp.Only(why, "admin") }
	return Resource{Name: "account", Ops: []Op{
		{
			ID:          "me",
			Description: "Return the currently authenticated StandMeet owner and their settings.",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      accountMe(store),
		},
		{
			ID:          "account.set_full_name",
			Description: "Change the owner's display name.",
			InputSchema: json.RawMessage(`{
				"type":"object",
				"properties":{"full_name":{"type":"string","description":"New display name."}},
				"required":["full_name"]
			}`),
			Kind:   fp.Action,
			Reach:  fp.OwnerAction(),
			Invoke: accountSetFullName(store),
		},
		{
			ID: "account.change_email",
			Description: "Change the login email. Requires the current password; " +
				"admin-only because it carries a raw credential.",
			InputSchema: changeEmailSchema,
			Kind:        fp.Action,
			Reach: credentialed(
				"verifies + changes the login email (current-password gated)"),
			Invoke: accountChangeEmail(store),
		},
		{
			ID: "account.change_password",
			Description: "Change the login password. Requires the current password; " +
				"admin-only because it carries raw credentials.",
			InputSchema: changePasswordSchema,
			Kind:        fp.Action,
			Reach:       credentialed("raw password; current-password gated"),
			Invoke:      accountChangePassword(store),
		},
		{
			ID: "account.generate_recovery",
			Description: "Mint a new account-recovery phrase. Only its hash is stored; " +
				"the phrase itself is mailed to the owner.",
			InputSchema: emptyArgsSchema,
			Kind:        fp.Action,
			Reach:       credentialed("mints a recovery secret"),
			Invoke:      accountGenerateRecovery(store),
		},
	}}
}

var changeEmailSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"current_password":{"type":"string"},
		"new_email":{"type":"string"}
	},
	"required":["current_password","new_email"]
}`)

var changePasswordSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"current_password":{"type":"string"},
		"new_password":{"type":"string","description":"At least 12 characters."}
	},
	"required":["current_password","new_password"]
}`)

// meOut / ownerOut —— 出站载荷形状(两个面同一份)。
type ownerOut struct {
	OwnerID   string `json:"owner_id"`
	Email     string `json:"email"`
	Handle    string `json:"handle"`
	FullName  string `json:"full_name"`
	PublicURL string `json:"public_url"`
}

type meOut struct {
	Owner    ownerOut    `json:"owner"`
	Settings settingsOut `json:"settings"`
}

func accountMe(store AccountStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		me, err := store.Me(ctx, ownerID)
		if err != nil {
			return nil, fmt.Errorf("read owner: %w", err)
		}
		return marshalOut(meOut{
			Owner: ownerOut{
				OwnerID: me.Owner.OwnerID, Email: me.Owner.Email, Handle: me.Owner.Handle,
				FullName: me.Owner.FullName, PublicURL: me.Owner.PublicURL,
			},
			Settings: toSettingsOut(&me.Settings),
		})
	}
}

// ownerFieldOut —— 改完一个字段之后回它的新值(admin 一直是这个形状)。
type ownerFieldOut struct {
	FullName string `json:"full_name,omitempty"`
	Email    string `json:"email,omitempty"`
}

type fullNameArgs struct {
	FullName string `json:"full_name"`
}

func accountSetFullName(store AccountStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in fullNameArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		name, err := store.SetFullName(ctx, ownerID, in.FullName)
		if err != nil {
			return nil, fmt.Errorf("set full name: %w", err)
		}
		return marshalOut(ownerFieldOut{FullName: name})
	}
}

type changeEmailArgs struct {
	CurrentPassword string `json:"current_password"`
	NewEmail        string `json:"new_email"`
}

func accountChangeEmail(store AccountStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in changeEmailArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		email, err := store.ChangeEmail(ctx, &ChangeEmail{
			OwnerID: ownerID, CurrentPassword: in.CurrentPassword, NewEmail: in.NewEmail,
		})
		if err != nil {
			return nil, fmt.Errorf("change email: %w", err)
		}
		return marshalOut(ownerFieldOut{Email: email})
	}
}

type changePasswordArgs struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func accountChangePassword(store AccountStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in changePasswordArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		in2 := &ChangePassword{
			OwnerID: ownerID, CurrentPassword: in.CurrentPassword, NewPassword: in.NewPassword,
		}
		if err := store.ChangePassword(ctx, in2); err != nil {
			return nil, fmt.Errorf("change password: %w", err)
		}
		return marshalOut(map[string]bool{"ok": true})
	}
}

func accountGenerateRecovery(store AccountStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		if err := store.GenerateRecovery(ctx, ownerID); err != nil {
			return nil, fmt.Errorf("generate recovery: %w", err)
		}
		// {"sent":true} 是 admin 已经发出去的形状 —— 说的是"寄出去了",不是"存好了"。
		return marshalOut(map[string]bool{"sent": true})
	}
}
