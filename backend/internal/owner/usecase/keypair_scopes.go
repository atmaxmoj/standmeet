// keypair_scopes.go —— what an owner MCP key may do (refactor ledger R7). A key's scopes are danger
// classes (facadeparity.Danger, declared on every op by R8); the owner MCP face lists and runs only
// the tools whose class is in the key's scopes.

package usecase

import (
	"errors"
	"slices"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// ErrUnknownScope —— a requested scope is not a danger class.
var ErrUnknownScope = errors.New("keypair: unknown scope")

// VerifiedKey —— who signed a request, and what that key may do: the classes, and when set, the
// only tools (job-loop roadmap 8.5.a).
type VerifiedKey struct {
	OwnerID string
	Scopes  []string
	Tools   []string
}

// normalizeTools —— trimmed, without blanks or repeats, in the order given; never nil (the column
// is NOT NULL, and empty means "every tool in scope").
func normalizeTools(in []string) []string {
	out := make([]string, 0, len(in))
	for _, t := range in {
		if t = strings.TrimSpace(t); t != "" && !slices.Contains(out, t) {
			out = append(out, t)
		}
	}
	return out
}

// normalizeScopes —— none asked for = every class (what a key always was); otherwise each must be a
// known class. Kept in the vocabulary's own order, without repeats, so the list reads the same
// wherever it is shown.
func normalizeScopes(in []string) ([]string, error) {
	if !allKnown(in) {
		return nil, ErrUnknownScope
	}
	out := make([]string, 0, len(fp.AllDangers()))
	for _, d := range fp.AllDangers() {
		if len(in) == 0 || slices.Contains(in, string(d)) {
			out = append(out, string(d))
		}
	}
	return out, nil
}

func allKnown(scopes []string) bool {
	for _, s := range scopes {
		if !fp.ValidDanger(fp.Danger(s)) {
			return false
		}
	}
	return true
}

// checkCreateInput —— a key needs an owner and a label; its scopes come back normalized.
func checkCreateInput(in *CreateKeypairInputReq) ([]string, error) {
	if in.OwnerID == "" || in.Label == "" {
		return nil, apierr.ErrEmptyField
	}
	return normalizeScopes(in.Scopes)
}
