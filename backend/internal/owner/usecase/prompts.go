// prompts.go —— owner-curated Prompt (persona library) CRUD。
//
// Prompt = persona / instruction 片段，可挂到 Role 让 visitor session 拼
// system prompt。owner 通过 admin / MCP CRUD；public（is_builtin=true）由
// claim 时 SeedPublicRole 种入，不可删 / 不可改 name（repo + usecase 双护栏）。

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// PromptsDeps —— prompts CRUD 需要的 repo。
type PromptsDeps struct {
	Prompts *repo.PromptRepo
}

// CreatePromptInputReq —— prompt.create 入参。
type CreatePromptInputReq struct {
	OwnerID     string
	Name        string
	Description string
	Body        string
}

// CreatePrompt 新建 prompt。
func CreatePrompt(
	ctx context.Context, deps PromptsDeps, in *CreatePromptInputReq,
) (entity.Prompt, error) {
	if in.OwnerID == "" || in.Name == "" {
		return entity.Prompt{}, apierr.ErrEmptyField
	}
	prompt, err := deps.Prompts.Create(ctx, &repo.CreatePromptInput{
		OwnerID: in.OwnerID, Name: in.Name,
		Description: in.Description, Body: in.Body,
	})
	if err != nil {
		if errors.Is(err, entity.ErrPromptNameTaken) {
			return entity.Prompt{}, entity.ErrPromptNameTaken
		}
		return entity.Prompt{}, fmt.Errorf("create prompt: %w", err)
	}
	return prompt, nil
}

// ListPrompts —— admin / MCP prompt.list。
func ListPrompts(
	ctx context.Context, deps PromptsDeps, ownerID string,
) ([]entity.Prompt, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	rows, err := deps.Prompts.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list prompts: %w", err)
	}
	return rows, nil
}

// GetPrompt —— admin / MCP prompt.get 单条详情。
func GetPrompt(
	ctx context.Context, deps PromptsDeps, ownerID, promptID string,
) (entity.Prompt, error) {
	if ownerID == "" || promptID == "" {
		return entity.Prompt{}, apierr.ErrEmptyField
	}
	prompt, err := deps.Prompts.GetByID(ctx, ownerID, promptID)
	if err != nil {
		return entity.Prompt{}, fmt.Errorf("get prompt: %w", err)
	}
	return prompt, nil
}

// UpdatePromptInputReq —— prompt.update 入参。
type UpdatePromptInputReq struct {
	OwnerID     string
	PromptID    string
	Name        string
	Description string
	Body        string
}

// UpdatePrompt —— builtin (public) 可改 body / description，不可改 name。
// repo Update 不挡，本层先 GetByID 校验。
func UpdatePrompt(
	ctx context.Context, deps PromptsDeps, in *UpdatePromptInputReq,
) (entity.Prompt, error) {
	if uerr := validateUpdatePromptInput(ctx, deps, in); uerr != nil {
		return entity.Prompt{}, uerr
	}
	prompt, err := deps.Prompts.Update(ctx, &repo.UpdatePromptInput{
		OwnerID: in.OwnerID, PromptID: in.PromptID,
		Name: in.Name, Description: in.Description, Body: in.Body,
	})
	if err != nil {
		return entity.Prompt{}, fmt.Errorf("update prompt: %w", err)
	}
	return prompt, nil
}

// validateUpdatePromptInput —— 必填检查 + builtin rename 拦。提出来降
// UpdatePrompt 的 cyclo。
func validateUpdatePromptInput(
	ctx context.Context, deps PromptsDeps, in *UpdatePromptInputReq,
) error {
	if in.OwnerID == "" || in.PromptID == "" || in.Name == "" {
		return apierr.ErrEmptyField
	}
	return checkPromptRenameAllowed(ctx, deps, in)
}

// checkPromptRenameAllowed —— builtin prompt 不能 rename；其它都行。
func checkPromptRenameAllowed(
	ctx context.Context, deps PromptsDeps, in *UpdatePromptInputReq,
) error {
	existing, err := deps.Prompts.GetByID(ctx, in.OwnerID, in.PromptID)
	if err != nil {
		return fmt.Errorf("get prompt for rename check: %w", err)
	}
	if existing.IsBuiltin() && existing.Name() != in.Name {
		return entity.ErrPromptBuiltinImmutable
	}
	return nil
}

// DeletePrompt —— builtin 不能删；repo Delete SQL 谓词也挡，但 usecase 先
// 检查 IsBuiltin 给清晰错。
func DeletePrompt(
	ctx context.Context, deps PromptsDeps, ownerID, promptID string,
) error {
	if verr := validatePromptDeletable(ctx, deps, ownerID, promptID); verr != nil {
		return verr
	}
	if err := deps.Prompts.Delete(ctx, ownerID, promptID); err != nil {
		return fmt.Errorf("delete prompt: %w", err)
	}
	return nil
}

// validatePromptDeletable —— 必填 + 存在 + 非 builtin 三件事。提出来降
// DeletePrompt 的 cyclo。
func validatePromptDeletable(
	ctx context.Context, deps PromptsDeps, ownerID, promptID string,
) error {
	if ownerID == "" || promptID == "" {
		return apierr.ErrEmptyField
	}
	prompt, gerr := deps.Prompts.GetByID(ctx, ownerID, promptID)
	if gerr != nil {
		return fmt.Errorf("get prompt: %w", gerr)
	}
	if prompt.IsBuiltin() {
		return entity.ErrPromptBuiltinImmutable
	}
	return nil
}
