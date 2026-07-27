// role_validators.go —— composition-root 适配器:把 owner/marketplace repo 的 GetByID 按 kind
// 收窄成 access.RefValidator(存在性校验)。role 写入只需"引用是否存在",不需实体 —— 这层
// 适配让 access 既不为每种引用持类型化 surface,也不反依赖 owner/marketplace。

package main

import (
	"context"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

type roleRefValidator struct {
	prompts *owner.PromptRepo
	skills  *marketplace.SkillRepo
	servers *marketplace.MCPServerRepo
}

func (v roleRefValidator) RefExists(ctx context.Context, ownerID, kind, id string) error {
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

func (v roleRefValidator) promptExists(ctx context.Context, ownerID, id string) error {
	if _, err := v.prompts.GetByID(ctx, ownerID, id); err != nil {
		return fmt.Errorf("ref %s: %w", id, err)
	}
	return nil
}

func (v roleRefValidator) skillExists(ctx context.Context, ownerID, id string) error {
	if _, err := v.skills.GetByID(ctx, ownerID, id); err != nil {
		return fmt.Errorf("ref %s: %w", id, err)
	}
	return nil
}

func (v roleRefValidator) serverExists(ctx context.Context, ownerID, id string) error {
	if _, err := v.servers.GetByID(ctx, ownerID, id); err != nil {
		return fmt.Errorf("ref %s: %w", id, err)
	}
	return nil
}
