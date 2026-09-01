// codes_write.go —— 发码 / 撤码 / 改配额 / 改证据开关的解参与转交(声明在 codes.go)。
//
// 规则本身在 usecase/codes.go:不指定 role 用 public role、撤码连着清 session、
// 没提到的配额保持原值。这里只把线上的 JSON 翻成域的入参,再把结果翻回去。

package ops

import (
	"context"
	"encoding/json"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

type codeCreateArgs struct {
	MaxMembers         *int32              `json:"max_members"`
	MaxTurnsPerSession *int32              `json:"max_turns_per_session"`
	PromptID           *string             `json:"prompt_id"`
	LimitPerPeriod     *entity.PeriodLimit `json:"limit_per_period"`
	Code               string              `json:"code"`
	Label              string              `json:"label"`
	Purpose            string              `json:"purpose"`
	AssumedRoleID      string              `json:"assumed_role_id"`
	ExpiresAt          string              `json:"expires_at"`
	ProviderID         string              `json:"provider_id"`
	Ghosts             []string            `json:"ghosts"`
}

func createCode(deps usecase.CodesDeps, extras CodeExtras) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCodeCreate(raw, ownerID)
		if perr != nil {
			return nil, perr
		}
		code, err := usecase.IssueCode(ctx, deps, in)
		if err != nil {
			return nil, codeErr(err)
		}
		extras.Write(ctx, code.ID, raw)
		return marshalCode(ctx, extras, &code, countMembers(ctx, deps, code.ID))
	}
}

// decodeCodeCreate —— 解参。code 留空、assumed_role_id 留空都合法:前者由域派生,
// 后者由域兜到 public role。
func decodeCodeCreate(raw json.RawMessage, ownerID string) (*repo.CreateCodeInput, error) {
	var in codeCreateArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, fp.BadInput("invalid arguments: " + err.Error())
	}
	expires, eerr := parseOptionalRFC3339(in.ExpiresAt)
	if eerr != nil {
		return nil, eerr
	}
	return &repo.CreateCodeInput{
		OwnerID: ownerID, Code: in.Code, Label: in.Label,
		Purpose: in.Purpose, Ghosts: nonNilStrings(in.Ghosts),
		AssumedRoleID: in.AssumedRoleID, PromptID: in.PromptID,
		MaxMembers: in.MaxMembers, MaxTurnsPerSession: in.MaxTurnsPerSession,
		ExpiresAt: expires,
		// 空 = 没指:继承 role 的,再退 owner 默认那条。
		ProviderID:     in.ProviderID,
		LimitPerPeriod: in.LimitPerPeriod,
	}, nil
}

// parseOptionalRFC3339 —— 空 = 不设(永不过期),不是错。
func parseOptionalRFC3339(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil //nolint:nilnil // 空 = 没设,不是错误
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil, fp.BadInput("expires_at must be RFC3339 or empty")
	}
	return &t, nil
}

// revokedOut —— 撤销的回执。它不是一行码,是"对哪张码做完了什么",所以字段跟**入参**同名
// (code_id),不是行里的 id。
type revokedOut struct {
	CodeID  string `json:"code_id"`
	Revoked bool   `json:"revoked"`
}

func revokeCode(deps usecase.CodesDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseCodeID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.RevokeCode(ctx, deps, ownerID, id); err != nil {
			return nil, codeErr(err)
		}
		return json.Marshal(revokedOut{CodeID: id, Revoked: true})
	}
}

// codePageArgs —— codes.set_custom_page 的入参。slug 空串 = 解绑。
type codePageArgs struct {
	CodeID string `json:"code_id"`
	Slug   string `json:"slug"`
}

// setCodeCustomPage —— 把这张码指向某一页，或清掉。
//
// **绑定住在码上**（access_codes.custom_page_id），所以「一张码至多一页」是结构保证的，
// 不靠校验；而页那一侧看到的是「哪些码开我」，同一个事实两处读、谁也不存第二份。
func setCodeCustomPage(deps usecase.CodesDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codePageArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if perr := fp.RequireArgs([2]string{"code_id", in.CodeID}); perr != nil {
			return nil, perr
		}
		code, err := usecase.SetCodeCustomPage(ctx, deps, ownerID, in.CodeID, in.Slug)
		if err != nil {
			return nil, codeErr(err)
		}
		return json.Marshal(codePageOut{CodeID: code.ID, CustomPageSlug: code.CustomPageSlug})
	}
}

// codePageOut —— 绑定的回执：**回读到的那个 slug**，不是入参回声。
// 回声只能证明「我收到了」，回读才证明「它现在就是这样」（[[write-with-no-receipt]]）。
type codePageOut struct {
	CodeID         string `json:"code_id"`
	CustomPageSlug string `json:"custom_page_slug"`
}

type codeQuotaArgs struct {
	MaxMembers         fp.OptionalInt32 `json:"max_members"`
	MaxTurnsPerSession fp.OptionalInt32 `json:"max_turns_per_session"`
	CodeID             string           `json:"code_id"`
}

func updateCodeQuotas(deps usecase.CodesDeps, extras CodeExtras) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCodeQuotas(raw, ownerID)
		if perr != nil {
			return nil, perr
		}
		code, err := usecase.UpdateCodeQuotas(ctx, deps, in)
		if err != nil {
			return nil, codeErr(err)
		}
		extras.Write(ctx, in.CodeID, raw)
		return marshalCode(ctx, extras, &code, countMembers(ctx, deps, code.ID))
	}
}

func decodeCodeQuotas(raw json.RawMessage, ownerID string) (*usecase.CodeQuotaUpdate, error) {
	var in codeQuotaArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs([2]string{"code_id", in.CodeID}); err != nil {
		return nil, err
	}
	return &usecase.CodeQuotaUpdate{
		OwnerID: ownerID, CodeID: in.CodeID,
		MaxMembers: usecase.OptionalQuota{
			Value: in.MaxMembers.Value, Set: in.MaxMembers.Set,
		},
		MaxTurnsPerSession: usecase.OptionalQuota{
			Value: in.MaxTurnsPerSession.Value, Set: in.MaxTurnsPerSession.Set,
		},
	}, nil
}

type codeGhostArgs struct {
	RequireGhostEvidence *bool  `json:"require_ghost_evidence"`
	CodeID               string `json:"code_id"`
}

func setCodeGhostEvidence(deps usecase.CodesDeps, extras CodeExtras) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in codeGhostArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"code_id", in.CodeID}); err != nil {
			return nil, err
		}
		code, err := deps.Codes.SetGhostEvidence(ctx, ownerID, in.CodeID, in.RequireGhostEvidence)
		if err != nil {
			return nil, codeErr(err)
		}
		return marshalCode(ctx, extras, &code, countMembers(ctx, deps, code.ID))
	}
}
