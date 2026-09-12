// system_prompt.go —— system prompt splicing: base + role persona + each
// block's SystemPromptFragment. The hash is used by the dev endpoint to
// verify determinism.

package registry

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// ComposeSystemPrompt —— assembles one complete system prompt.
//   - basePersona: comes from RoleSnapshot.PromptBody, resolved and passed in by
//     the caller.
//   - registry: walks registration order, calling SystemPromptFragment on each
//     fiber for its fragment. A fiber whose fragment is the empty string
//     contributes no text.
//
// Order: [basePersona] + [for fiber in register order: fragment(fiber)], joined
// with "\n\n".
func (r *Registry) ComposeSystemPrompt(
	ctx context.Context, basePersona string, in *AssembleInput,
) string {
	fibers := r.enabledFibers(ctx, in)
	parts := make([]string, 0, 1+len(fibers))
	if basePersona != "" {
		parts = append(parts, basePersona)
	}
	for _, c := range fibers {
		if frag := c.SystemPromptFragment(ctx, in); frag != "" {
			parts = append(parts, frag)
		}
	}
	return strings.Join(parts, "\n\n")
}

// SystemPromptHash —— the SHA-256 hex digest of ComposeSystemPrompt's output.
// Used by the dev endpoint: the same (basePersona, in) should always return the
// same hash — the invariants spec runs it 3 times to verify stability, catching
// any source of flakiness such as "assembly order / a fragment's content
// containing a timestamp / map iteration".
func (r *Registry) SystemPromptHash(
	ctx context.Context, basePersona string, in *AssembleInput,
) string {
	prompt := r.ComposeSystemPrompt(ctx, basePersona, in)
	sum := sha256.Sum256([]byte(prompt))
	return hex.EncodeToString(sum[:])
}
