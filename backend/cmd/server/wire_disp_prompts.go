// wire_disp_prompts.go —— owner 域的 prompt 普通函数 → 出站收口的窄口。

package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

type promptOps struct{ deps owner.PromptsDeps }

func newPromptOps(d *runtimeDeps) promptOps {
	return promptOps{deps: owner.PromptsDeps{Prompts: d.promptRepo}}
}

func (a promptOps) List(ctx context.Context, ownerID string) ([]dispatcher.Prompt, error) {
	rows, err := owner.ListPrompts(ctx, a.deps, ownerID)
	if err != nil {
		return nil, promptErr(err)
	}
	out := make([]dispatcher.Prompt, 0, len(rows))
	for i := range rows {
		out = append(out, toDispatcherPrompt(&rows[i]))
	}
	return out, nil
}

func (a promptOps) Get(ctx context.Context, ownerID, id string) (dispatcher.Prompt, error) {
	p, err := owner.GetPrompt(ctx, a.deps, ownerID, id)
	if err != nil {
		return dispatcher.Prompt{}, promptErr(err)
	}
	return toDispatcherPrompt(&p), nil
}

func (a promptOps) Create(
	ctx context.Context, in *dispatcher.WritePrompt,
) (dispatcher.Prompt, error) {
	p, err := owner.CreatePrompt(ctx, a.deps, &owner.CreatePromptInputReq{
		OwnerID: in.OwnerID, Name: in.Name, Body: in.Body, Description: in.Description,
	})
	if err != nil {
		return dispatcher.Prompt{}, promptErr(err)
	}
	return toDispatcherPrompt(&p), nil
}

func (a promptOps) Update(
	ctx context.Context, in *dispatcher.WritePrompt,
) (dispatcher.Prompt, error) {
	p, err := owner.UpdatePrompt(ctx, a.deps, &owner.UpdatePromptInputReq{
		OwnerID: in.OwnerID, PromptID: in.ID, Name: in.Name,
		Body: in.Body, Description: in.Description,
	})
	if err != nil {
		return dispatcher.Prompt{}, promptErr(err)
	}
	return toDispatcherPrompt(&p), nil
}

func (a promptOps) Delete(ctx context.Context, ownerID, id string) error {
	return promptErr(owner.DeletePrompt(ctx, a.deps, ownerID, id))
}

func toDispatcherPrompt(p *owner.Prompt) dispatcher.Prompt {
	return dispatcher.Prompt{
		ID: p.ID(), Name: p.Name(), Description: p.Description(), Body: p.Body(),
		IsBuiltin: p.IsBuiltin(), CreatedAt: p.CreatedAt(), UpdatedAt: p.UpdatedAt(),
	}
}

// promptErr —— 域的错误哨兵 → 收口的类别。内置 prompt 不许改名/删,是 403 而不是 400:
// 请求没写错,东西也在,就是不许这么动。
func promptErr(err error) error {
	if err == nil {
		return nil
	}
	if classed := classifyPromptErr(err); classed != nil {
		return classed
	}
	return fmt.Errorf("prompt op: %w", err)
}

func classifyPromptErr(err error) error {
	for _, c := range promptErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return nil
}

var promptErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error { return dispatcher.BadInput("name is required") }},
	{owner.ErrPromptNotFound, func() error { return dispatcher.NotFound("prompt not found") }},
	{owner.ErrPromptNameTaken, func() error {
		return dispatcher.Conflict("prompt name already taken")
	}},
	{owner.ErrPromptBuiltinImmutable, func() error {
		return dispatcher.Forbidden("builtin prompt cannot be renamed or deleted")
	}},
}
