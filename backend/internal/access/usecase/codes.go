// codes.go —— 发码 / 撤码 / 改配额这三件事**本身**的规则。
//
// 它们以前散在面和组装根上:
//
//   - "不指定 role 就用 owner 的 public role" 只长在 admin 那条路由上,于是同一件事
//     从 MCP 打过来必须显式给 role_id。
//   - "撤码要连着清掉这张码已经发出去的 visitor session" 也只长在 admin 那条路由上。
//     从 MCP 撤码,持码人手里的 token 还活着,要等下一 turn 的 per-turn 检查才被挡。
//   - "改配额时没提到的字段保持原值" 只长在 MCP 那边(它自己先读回来再合并),因为底下
//     那条 SQL 是盲写两列;面板每次发全量所以没事,任何只发一个字段的调用方会把另一个
//     悄悄清成"不限"。
//
// 三条都是**这件事怎么算**,不是某个面怎么表达,所以住在域里:哪个入口来都一样。

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
)

// CodesDeps —— 发码这组用例需要的 repos。Roles 用来兜 public role;
// Sessions 用来在撤码时清掉已发出的 visitor session。
type CodesDeps struct {
	Codes    *repo.CodeRepo
	Roles    *repo.RoleRepo
	Sessions *VisitorSessionStore
}

// IssueCode —— 发一张码。AssumedRoleID 留空 = 用 owner 的 public role
// (claim 那一刻种下的那张)。
func IssueCode(
	ctx context.Context, d CodesDeps, in *repo.CreateCodeInput,
) (entity.Code, error) {
	roleID, err := assumedRoleOrInvited(ctx, d, in.OwnerID, in.AssumedRoleID)
	if err != nil {
		return entity.Code{}, err
	}
	in.AssumedRoleID = roleID
	code, cerr := d.Codes.Create(ctx, in)
	if cerr != nil {
		return entity.Code{}, fmt.Errorf("issue code: %w", cerr)
	}
	return code, nil
}

// assumedRoleOrInvited —— owner 没在这张码上指定 role 时的默认档。
//
// 默认是 `invited`，不是 public。**发一张码就是一次邀请** —— 这是 owner 定的那条规则的另一半：
// 「private 的没有码就读不到」，反过来说，有码的人读得到 owner 策展的语料。public 是留给
// **没有码**的那条路的（BYOAI / gate），它只读已发布的（F-D-7）。
//
// 想给某个人只开公开面，仍然做得到：在码上显式挑 `public`。区别是那成了一个**被选中**的
// 决定，而不是替 owner 做的假设。
func assumedRoleOrInvited(
	ctx context.Context, d CodesDeps, ownerID, requested string,
) (string, error) {
	if requested != "" {
		return requested, nil
	}
	invited, err := d.Roles.GetByName(ctx, ownerID, entity.InvitedRoleName)
	if err != nil {
		return "", fmt.Errorf("invited role: %w", err)
	}
	return invited.ID(), nil
}

// RevokeCode —— 撤一张码,并清掉它已经发出去的 visitor session。
//
// 清 session 是撤销的另一半:不清,持码人手里的 token 还活着,要等到下一 turn 的
// per-turn 检查才被挡。清不掉只回报错误的前半段 —— 码本身已经撤了,那一层仍然会挡住。
func RevokeCode(ctx context.Context, d CodesDeps, ownerID, codeID string) error {
	if err := d.Codes.Revoke(ctx, ownerID, codeID); err != nil {
		return fmt.Errorf("revoke code: %w", err)
	}
	if err := d.Sessions.DeleteByCode(ctx, codeID); err != nil {
		return fmt.Errorf("revoke code: purge visitor sessions: %w", err)
	}
	return nil
}

// SetCodeCustomPage —— 这张码开哪一页。slug 空串 = 解绑，退回默认的访客对话。
//
// **不撤会话**（跟 RevokeCode 不同）：换渲染不是撤授权，正在对话的人不该被踢出去。
// 下一次带这张码进来才落到新地方。
func SetCodeCustomPage(
	ctx context.Context, d CodesDeps, ownerID, codeID, slug string,
) (entity.Code, error) {
	code, err := d.Codes.SetCustomPage(ctx, ownerID, codeID, slug)
	if err != nil {
		return entity.Code{}, fmt.Errorf("set code custom page: %w", err)
	}
	return code, nil
}

// CodeQuotaUpdate —— 改配额。每个字段三态:没提到 = 保持原值,显式空 = 不限。
//
// 底下那条 SQL 盲写两列,所以"没提到"必须在这里读回原值填上 —— 少发一个字段等于把它
// 清空,那是调用方绝不会预期的。
type CodeQuotaUpdate struct {
	MaxTurnsPerSession OptionalQuota
	MaxMembers         OptionalQuota
	OwnerID            string
	CodeID             string
}

// OptionalQuota —— 三态配额:Set=false 表示调用方没提这个字段。
type OptionalQuota struct {
	Value *int32
	Set   bool
}

// or —— 没提到就用当前值顶上。
func (o OptionalQuota) or(current *int32) *int32 {
	if o.Set {
		return o.Value
	}
	return current
}

// UpdateCodeQuotas —— 合并后写入。两个字段都提到了就不用回读。
func UpdateCodeQuotas(
	ctx context.Context, d CodesDeps, in *CodeQuotaUpdate,
) (entity.Code, error) {
	merged, err := mergedQuotas(ctx, d, in)
	if err != nil {
		return entity.Code{}, err
	}
	code, uerr := d.Codes.UpdateQuotas(
		ctx, in.OwnerID, in.CodeID, merged.turns, merged.members,
	)
	if uerr != nil {
		return entity.Code{}, fmt.Errorf("update code quotas: %w", uerr)
	}
	return code, nil
}

// quotaPair —— 要写进那条盲写 SQL 的两个值。
type quotaPair struct {
	turns   *int32
	members *int32
}

func mergedQuotas(
	ctx context.Context, d CodesDeps, in *CodeQuotaUpdate,
) (quotaPair, error) {
	if in.MaxTurnsPerSession.Set && in.MaxMembers.Set {
		return quotaPair{
			turns: in.MaxTurnsPerSession.Value, members: in.MaxMembers.Value,
		}, nil
	}
	cur, gerr := d.Codes.GetByID(ctx, in.CodeID)
	if gerr != nil {
		return quotaPair{}, fmt.Errorf("update code quotas: %w", gerr)
	}
	if cur.OwnerID != in.OwnerID {
		return quotaPair{}, entity.ErrCodeInvalid
	}
	return quotaPair{
		turns:   in.MaxTurnsPerSession.or(cur.MaxTurnsPerSession),
		members: in.MaxMembers.or(cur.MaxMembers),
	}, nil
}
