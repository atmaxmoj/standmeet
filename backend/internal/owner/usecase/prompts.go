// prompts.go — owner-curated Prompt (persona library) CRUD.
//
// Prompt = a persona / instruction fragment that can attach to a Role so a visitor
// session's system prompt is assembled from it. The owner does CRUD via admin / MCP;
// public ones (is_builtin=true) are seeded in by SeedPublicRole at claim time, and
// can't be deleted / can't have their name changed (guarded doubly, by both repo and
// usecase).

package usecase

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// PromptsDeps — the repo prompts CRUD needs.
type PromptsDeps struct {
	Prompts *repo.PromptRepo
}

// CreatePromptInputReq — input for prompt.create.
type CreatePromptInputReq struct {
	OwnerID     string
	Name        string
	Description string
	Body        string
}

// CreatePrompt creates a new prompt.
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

// ListPrompts — for admin / MCP prompt.list.
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

// GetPrompt — a single prompt's detail, for admin / MCP prompt.get.
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

// UpdatePromptInputReq — input for prompt.update.
type UpdatePromptInputReq struct {
	OwnerID     string
	PromptID    string
	Name        string
	Description string
	Body        string
}

// UpdatePrompt — a builtin (public) prompt can have body / description changed, but
// not name. repo Update doesn't block this, so this layer does a GetByID check first.
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

// validateUpdatePromptInput — required-field check + blocks builtin renames. Pulled
// out to lower UpdatePrompt's cyclo.
func validateUpdatePromptInput(
	ctx context.Context, deps PromptsDeps, in *UpdatePromptInputReq,
) error {
	if in.OwnerID == "" || in.PromptID == "" || in.Name == "" {
		return apierr.ErrEmptyField
	}
	return checkPromptRenameAllowed(ctx, deps, in)
}

// checkPromptRenameAllowed — a builtin prompt can't be renamed; everything else is fine.
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

// DeletePrompt — builtin can't be deleted; repo Delete's SQL predicate blocks it too,
// but the usecase checks IsBuiltin first to give a clear error.
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

// validatePromptDeletable — three checks: required fields + exists + not builtin.
// Pulled out to lower DeletePrompt's cyclo.
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
