// prompts.go —— owner-curated Prompt (persona library) CRUD。
//
// Prompt = persona / instruction 片段，可挂到 Role 让 visitor session 拼
// system prompt。owner 通过 admin / MCP CRUD；vanilla（is_builtin=true）由
// claim 时 SeedVanillaRole 种入，不可删 / 不可改 name（repo + usecase 双护栏）。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
)

// PromptsDeps —— prompts CRUD 需要的 repo。
type PromptsDeps struct {
	Prompts *postgres.PromptRepo
}

// CreatePromptInput —— prompt.create 入参。
type CreatePromptInput struct {
	OwnerID     string
	Name        string
	Description string
	Body        string
}

// CreatePrompt 新建 prompt。
func CreatePrompt(
	ctx context.Context, deps PromptsDeps, in *CreatePromptInput,
) (domain.Prompt, error) {
	if in.OwnerID == "" || in.Name == "" {
		return domain.Prompt{}, ErrEmptyField
	}
	prompt, err := deps.Prompts.Create(ctx, &postgres.CreatePromptInput{
		OwnerID: in.OwnerID, Name: in.Name,
		Description: in.Description, Body: in.Body,
	})
	if err != nil {
		if errors.Is(err, domain.ErrPromptNameTaken) {
			return domain.Prompt{}, domain.ErrPromptNameTaken
		}
		return domain.Prompt{}, fmt.Errorf("create prompt: %w", err)
	}
	return prompt, nil
}

// ListPrompts —— admin / MCP prompt.list。
func ListPrompts(
	ctx context.Context, deps PromptsDeps, ownerID string,
) ([]domain.Prompt, error) {
	if ownerID == "" {
		return nil, ErrEmptyField
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
) (domain.Prompt, error) {
	if ownerID == "" || promptID == "" {
		return domain.Prompt{}, ErrEmptyField
	}
	prompt, err := deps.Prompts.GetByID(ctx, ownerID, promptID)
	if err != nil {
		return domain.Prompt{}, fmt.Errorf("get prompt: %w", err)
	}
	return prompt, nil
}

// UpdatePromptInput —— prompt.update 入参。
type UpdatePromptInput struct {
	OwnerID     string
	PromptID    string
	Name        string
	Description string
	Body        string
}

// UpdatePrompt —— builtin (vanilla) 可改 body / description，不可改 name。
// repo Update 不挡，本层先 GetByID 校验。
func UpdatePrompt(
	ctx context.Context, deps PromptsDeps, in *UpdatePromptInput,
) (domain.Prompt, error) {
	if uerr := validateUpdatePromptInput(ctx, deps, in); uerr != nil {
		return domain.Prompt{}, uerr
	}
	prompt, err := deps.Prompts.Update(ctx, &postgres.UpdatePromptInput{
		OwnerID: in.OwnerID, PromptID: in.PromptID,
		Name: in.Name, Description: in.Description, Body: in.Body,
	})
	if err != nil {
		return domain.Prompt{}, fmt.Errorf("update prompt: %w", err)
	}
	return prompt, nil
}

// validateUpdatePromptInput —— 必填检查 + builtin rename 拦。提出来降
// UpdatePrompt 的 cyclo。
func validateUpdatePromptInput(
	ctx context.Context, deps PromptsDeps, in *UpdatePromptInput,
) error {
	if in.OwnerID == "" || in.PromptID == "" || in.Name == "" {
		return ErrEmptyField
	}
	return checkPromptRenameAllowed(ctx, deps, in)
}

// checkPromptRenameAllowed —— builtin prompt 不能 rename；其它都行。
func checkPromptRenameAllowed(
	ctx context.Context, deps PromptsDeps, in *UpdatePromptInput,
) error {
	existing, err := deps.Prompts.GetByID(ctx, in.OwnerID, in.PromptID)
	if err != nil {
		return fmt.Errorf("get prompt for rename check: %w", err)
	}
	if existing.IsBuiltin() && existing.Name() != in.Name {
		return domain.ErrPromptBuiltinImmutable
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
		return ErrEmptyField
	}
	prompt, gerr := deps.Prompts.GetByID(ctx, ownerID, promptID)
	if gerr != nil {
		return fmt.Errorf("get prompt: %w", gerr)
	}
	if prompt.IsBuiltin() {
		return domain.ErrPromptBuiltinImmutable
	}
	return nil
}
