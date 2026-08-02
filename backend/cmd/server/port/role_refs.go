// role_refs.go —— composition-root 适配器:把 owner/marketplace repo 的 GetByID 按 kind
// 收窄成 access.RefValidator(存在性校验)。role 写入只需"引用是否存在",不需实体 —— 这层
// 适配让 access 既不为每种引用持类型化 surface,也不反依赖 owner/marketplace。
//
// "找不到"要翻成 access 那个口子自己的哨兵:调用方(access 的 role ops)据此说人话,而不必
// 认识 owner / marketplace 的错误名字 —— 认了就是反向依赖。

package port

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// RoleRefValidator —— role 引用的存在性校验:prompt / skill / mcp server 各按 kind 查一下在不在。
type RoleRefValidator struct {
	prompts *owner.PromptRepo
	skills  *marketplace.SkillRepo
	servers *marketplace.MCPServerRepo
}

// NewRoleRefValidator —— 构造。role 写入只要"这个引用在不在",不要实体。
func NewRoleRefValidator(d *deps.Runtime) RoleRefValidator {
	return RoleRefValidator{
		prompts: d.PromptRepo, skills: d.SkillRepo, servers: d.MCPServerRepo,
	}
}

// RefExists —— 这个 kind 下的这个 id 在不在。只回存在性,不回实体。
func (v RoleRefValidator) RefExists(ctx context.Context, ownerID, kind, id string) error {
	byKind := map[string]func(context.Context, string, string) error{
		access.RefPrompt:    v.promptExists,
		access.RefSkill:     v.skillExists,
		access.RefMCPServer: v.serverExists,
	}
	probe, ok := byKind[kind]
	if !ok {
		return fmt.Errorf("unknown role ref kind %q", kind)
	}
	return probe(ctx, ownerID, id)
}

func (v RoleRefValidator) promptExists(ctx context.Context, ownerID, id string) error {
	if _, err := v.prompts.GetByID(ctx, ownerID, id); err != nil {
		return fmt.Errorf("%w (%s): %w", access.ErrRefPromptNotFound, id, err)
	}
	return nil
}

func (v RoleRefValidator) skillExists(ctx context.Context, ownerID, id string) error {
	if _, err := v.skills.GetByID(ctx, ownerID, id); err != nil {
		return fmt.Errorf("%w (%s): %w", access.ErrRefSkillNotFound, id, err)
	}
	return nil
}

func (v RoleRefValidator) serverExists(ctx context.Context, ownerID, id string) error {
	if _, err := v.servers.GetByID(ctx, ownerID, id); err != nil {
		return fmt.Errorf("%w (%s): %w", access.ErrRefMCPServerNotFound, id, err)
	}
	return nil
}
