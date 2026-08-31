// account_credentials.go —— 读 me,以及带凭据的那三个动作的实现。
//
// me 的载荷 = owner 档案 + 他的推理设置。设置那半边复用 settings.go 里那**唯一一处**构造:
// 迁移前它有两份,于是同一个面内部都不一致(GET /me 的 ai 有 endpoint/model,写完回的那份没有,
// 前端拿响应换缓存就把两个字段抹空了)。

package ops

import (
	"context"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// ownerOut / meOut —— 出站形状(两个面同一份)。没有密码、没有任何凭据。
type ownerOut struct {
	OwnerID   string `json:"owner_id"`
	Email     string `json:"email"`
	Handle    string `json:"handle"`
	FullName  string `json:"full_name"`
	PublicURL string `json:"public_url"`
	// Timezone —— IANA 时区名。它是 owner 的档案,不是哪个能力的设置。
	Timezone string `json:"timezone"`
	// PendingEmail —— 已请求、还没被确认的新邮箱。空 = 没有待确认的改动。
	// **必须发出来**:看不见的待确认状态,等于 owner 不知道自己按下的那一下有没有生效。
	PendingEmail string `json:"pending_email,omitempty"`
}

type meOut struct {
	Owner    ownerOut    `json:"owner"`
	Settings settingsOut `json:"settings"`
}

func readMe(deps usecase.AccountDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		profile, err := deps.Owners.GetByID(ctx, ownerID)
		if err != nil {
			return nil, accountErr(err)
		}
		settings, serr := deps.Owners.GetSettings(ctx, ownerID)
		if serr != nil {
			return nil, accountErr(serr)
		}
		return json.Marshal(meOut{
			Owner: ownerOut{
				OwnerID: profile.ID, Email: profile.Email, Handle: profile.Handle,
				FullName: profile.FullName, PublicURL: profile.PublicURL,
				Timezone: profile.ProfileTimezone, PendingEmail: profile.PendingEmail,
			},
			Settings: settingsPayload(&settings),
		})
	}
}

// emailChangeOut —— 回执要说清**发生了什么**,不是"成功了"。
// pending 非空 = 寄了一封确认信、身份没动;空 = 当场换好了。界面上那两句话不一样,
// 而一个说不出区别的回执会让 owner 以为已经改完了(non-unique signal)。
type emailChangeOut struct {
	Email   string `json:"email"`
	Pending string `json:"pending_email,omitempty"`
}

func changeEmail(deps usecase.EmailChangeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			CurrentPassword string `json:"current_password"`
			NewEmail        string `json:"new_email"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		out, err := usecase.RequestEmailChange(ctx, deps, &usecase.EmailChangeInput{
			OwnerID: ownerID, CurrentPassword: in.CurrentPassword, NewEmail: in.NewEmail,
		})
		if err != nil {
			return nil, accountErr(err)
		}
		return json.Marshal(emailChangeOut{Email: out.Email, Pending: out.Pending})
	}
}

func cancelEmailChange(deps usecase.EmailChangeDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		owner, err := usecase.CancelEmailChange(ctx, deps, ownerID)
		if err != nil {
			return nil, accountErr(err)
		}
		return json.Marshal(emailChangeOut{Email: owner.Email})
	}
}

func changePassword(deps usecase.AccountDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			CurrentPassword string `json:"current_password"`
			NewPassword     string `json:"new_password"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		err := usecase.UpdateOwnerPassword(ctx, deps, &usecase.PasswordUpdateInput{
			OwnerID:         ownerID,
			CurrentPassword: in.CurrentPassword,
			NewPassword:     in.NewPassword,
		})
		if err != nil {
			return nil, accountErr(err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

// generateRecovery —— 发不出去就是**外部依赖**的问题(邮件连接器没配好),这句话可以直接
// 给 owner 看,而不是一句 internal error。回 {"sent":true} 说的是"寄出去了",不是"存好了"。
func generateRecovery(deps usecase.RecoveryDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		if err := usecase.GenerateRecovery(ctx, &deps, ownerID); err != nil {
			// 名字由装配根经 Proxy 转述:界面上那个连接器叫什么,这句就说什么。
			return nil, fp.Coded(fp.Upstream(
				"couldn't send the recovery phrase — connect and verify a "+
					deps.Proxy.ChannelName()+" connector first"),
				"recovery_send_failed")
		}
		return json.Marshal(map[string]bool{"sent": true})
	}
}
