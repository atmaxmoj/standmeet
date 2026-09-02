// visitor_code_prompt.go —— how to resolve the prompt segment an access code carries.
//
// Split out of visitor_role_snapshot.go: that file is the snapshot's **assembly**, while
// this is a single resolution rule — and this rule has its own story (below), worth its
// own place.

package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// resolveCodePrompt —— the two layers **stack**, they aren't an either/or choice.
//
// They're different layers, not two ways of writing the same thing:
//   - prompt_id  = the owner's centrally-managed prompt shared across this class of
//     visitor (change it once, every not-yet-redeemed code benefits)
//   - inline     = the sentence the issuer attached to **this one** code ("this is
//     for the GitLab Staff Backend role")
//
// It used to be "inline wins if non-empty." But the job loop needs both: the hiring
// context **and** which specific role this is. Forcing an either/or meant an
// auto-issued code ended up with either no hiring context or no idea which role it was
// for —— that "either" was itself the defect. role persona and code prompt already stack;
// this follows the same pattern.
//
// The stacking order matters: the shared one comes first, the code-specific one after.
// The later sentence **narrows** the earlier one; reversed, the specific one would get
// buried under the generic one.
func resolveCodePrompt(
	ctx context.Context, deps *VisitorSessionDeps, code *access.Code,
) (string, error) {
	shared, err := promptBodyByID(ctx, deps, code.OwnerID, code.PromptID)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(strings.Join(
		nonEmptyParts(shared, code.InlinePrompt), "\n\n",
	)), nil
}

// nonEmptyParts —— filters out empties before joining, so we don't leave a run of blank
// lines.
func nonEmptyParts(parts ...string) []string {
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			out = append(out, p)
		}
	}
	return out
}

// promptBodyByID —— fetches the body for an optional prompt id (shared by role prompt +
// per-code prompt). nil / not found (deleted via SET NULL) → empty string (that persona
// segment is simply absent, session proceeds as normal).
func promptBodyByID(
	ctx context.Context, deps *VisitorSessionDeps, ownerID string, promptID *string,
) (string, error) {
	if promptID == nil {
		return "", nil
	}
	prompt, err := deps.Prompts.GetByID(ctx, ownerID, *promptID)
	if err != nil {
		if errors.Is(err, owner.ErrPromptNotFound) {
			return "", nil
		}
		return "", fmt.Errorf("get prompt for snapshot: %w", err)
	}
	return prompt.Body(), nil
}
