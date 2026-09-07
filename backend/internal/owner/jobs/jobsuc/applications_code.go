// applications_code.go —— the composer's code picker, usecase side. The résumé's QR always carries
// an invitation (AccessCode === invitation), so the choice is WHICH code: issue a fresh one
// (default), or reuse an existing active code. There is no "no code". Split from applications.go to
// keep that file's exported-type count under the per-file cap.

package jobsuc

import (
	"context"
	"errors"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// CommitOptions — the code choice from the composer's picker.
//   - Mode "existing" reuses the active code ExistingCodeID (the QR carries it, no new code
//     issued);
//   - anything else ("" / "new") issues a fresh application code, today's default behavior.
type CommitOptions struct {
	Mode           string
	ExistingCodeID string
}

// ErrCodeNotUsable — the picked existing code isn't this owner's, or isn't active.
var ErrCodeNotUsable = errors.New("code not usable for this application")

// CodeLookup — the narrow read the "reuse an existing code" path needs (satisfied by the access
// CodeRepo). Kept minimal so jobs doesn't take a wide dependency on the access domain.
type CodeLookup interface {
	GetByID(ctx context.Context, codeID string) (access.Code, error)
}

// resolvedCode —— the code the commit will use: its plaintext (for the QR) + whether it's an
// existing code to reuse (reuse != nil) or a fresh one to issue (reuse == nil).
type resolvedCode struct {
	reuse     *access.Code
	qrURL     string
	plaintext string
}

// resolveCommitCode —— honor the picker: reuse the chosen active code, or generate a fresh one.
func resolveCommitCode(
	ctx context.Context, deps *ApplicationsDeps, ownerID, publicURL string, opts CommitOptions,
) (resolvedCode, error) {
	if opts.Mode == "existing" {
		c, err := usableExistingCode(ctx, deps, ownerID, opts.ExistingCodeID)
		if err != nil {
			return resolvedCode{}, err
		}
		return resolvedCode{qrURL: BuildQRURL(publicURL, c.Code), plaintext: c.Code, reuse: &c}, nil
	}
	code, err := generateApplicationCode()
	if err != nil {
		return resolvedCode{}, err
	}
	return resolvedCode{qrURL: BuildQRURL(publicURL, code), plaintext: code}, nil
}

// usableExistingCode —— the picked code must exist, be this owner's, and be active.
func usableExistingCode(
	ctx context.Context, deps *ApplicationsDeps, ownerID, codeID string,
) (access.Code, error) {
	if deps.Codes == nil || codeID == "" {
		return access.Code{}, ErrCodeNotUsable
	}
	c, err := deps.Codes.GetByID(ctx, codeID)
	if err != nil {
		return access.Code{}, fmt.Errorf("load existing code: %w", err)
	}
	if !codeUsable(&c, ownerID) {
		return access.Code{}, ErrCodeNotUsable
	}
	return c, nil
}

// codeUsable — an existing code is usable for an application only if it's this owner's and active.
func codeUsable(c *access.Code, ownerID string) bool {
	return c.OwnerID == ownerID && c.Status == "active"
}
