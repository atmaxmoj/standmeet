// access.go — composition root adapts owner.Repo into access module's narrow port.
// access only needs "the sole owner's id", not a dependency on the whole owner.Repo;
// this satisfies access.SoleOwnerLookup.

package port

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// SoleOwnerLookup — implementation of access.SoleOwnerLookup: reuses owner.LoadSoleOwner
// to get the sole owner's id.
type SoleOwnerLookup struct {
	owners *owner.Repo
}

// NewSoleOwnerLookup — constructor. The field is unexported: elsewhere should only get
// a port that can ask "who is the sole owner".
func NewSoleOwnerLookup(d *deps.Runtime) SoleOwnerLookup {
	return SoleOwnerLookup{owners: d.OwnerRepo}
}

// SoleOwnerID — single-owner instance: returns the claimed sole owner's id; passes
// through owner's error when not yet claimed.
func (s SoleOwnerLookup) SoleOwnerID(ctx context.Context) (string, error) {
	o, err := owner.LoadSoleOwner(ctx, owner.PageDeps{Owners: s.owners})
	if err != nil {
		return "", fmt.Errorf("load sole owner: %w", err)
	}
	return o.ID, nil
}

// RecoveryDeps — #100 account recovery's narrow deps (owner repo + session store +
// mail proxy).
func RecoveryDeps(d *deps.Runtime) owner.RecoveryDeps {
	return owner.RecoveryDeps{
		Owners: d.OwnerRepo, Sessions: d.SessionStore, Proxy: OutboundSender(d),
	}
}

// EmailChangeDeps — narrow deps for changing email. Has one more outbound port than
// AccountDeps: it first asks "can mail be sent?" (goes through pending-confirmation
// if a mail connector exists, changes immediately otherwise), then uses it to send
// the confirmation email to the **new** address.
func EmailChangeDeps(d *deps.Runtime) owner.EmailChangeDeps {
	return owner.EmailChangeDeps{Owners: d.OwnerRepo, Proxy: OutboundSender(d)}
}

// PromptsByName — narrow port that looks up a prompt id by name. The job loop uses it
// to attach the builtin `hiring` prompt to auto-issued codes; the domain only sees
// this interface, never PromptRepo.
func PromptsByName(d *deps.Runtime) PromptNameLookup {
	return PromptNameLookup{repo: d.PromptRepo}
}

// PromptNameLookup — exported because PromptsByName returns it (revive unexported-return:
// returning an unnamed type would leave the caller unable to even declare a variable
// for it).
type PromptNameLookup struct{ repo *owner.PromptRepo }

// IDByName — looks up one prompt's id by name. The job loop uses it to attach the
// builtin `hiring` prompt to auto-issued codes.
func (p PromptNameLookup) IDByName(ctx context.Context, ownerID, name string) (string, error) {
	prompt, err := p.repo.GetByName(ctx, ownerID, name)
	if err != nil {
		return "", fmt.Errorf("prompt by name %q: %w", name, err)
	}
	return prompt.ID(), nil
}

// SubjectivityPresence — "does this subjectivity note exist". The job loop asks this
// when issuing a code: the hiring role scopes in `subjectivity://cv`, and that's a
// **conventional name**, not something the product guarantees exists. If the owner
// names the note something else, that glob silently fails to match, and the recruiter
// path quietly ends up missing a CV.
func SubjectivityPresence(d *deps.Runtime) SubjectivityLookup {
	return SubjectivityLookup{repo: d.SubjectivityRepo}
}

// SubjectivityLookup — exported because SubjectivityPresence returns it (revive
// unexported-return).
type SubjectivityLookup struct{ repo *corpus.NoteRepo }

// Exists — uri looks like `subjectivity://cv`; compares against the slugified title.
//
// **Returns true when the lookup fails (= no warning).** Say nothing when unsure:
// a wrong warning costs more than no warning — the owner would go fix something that
// was never broken.
func (s SubjectivityLookup) Exists(ctx context.Context, ownerID, uri string) bool {
	if s.repo == nil {
		return true
	}
	want := strings.TrimPrefix(uri, "subjectivity://")
	notes, err := s.repo.ListByOwner(ctx, ownerID, subjectivityScanLimit)
	if err != nil {
		return true
	}
	for i := range notes {
		if corpus.SlugifyTitle(notes[i].Title) == want {
			return true
		}
	}
	return false
}

// subjectivityScanLimit — subjectivity is the owner's hand-written self-model; entries
// are on the order of tens.
const subjectivityScanLimit = 500
