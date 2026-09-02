// visitor_public.go —— public-tier + BYOAI-tier visitor session issuance. Split from
// visitor.go for max-lines (visitor.go's main body holds code-tier + the chat streaming
// pipeline).

package usecase

import (
	"context"
	"errors"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// IssuePublicSessionInput —— input for a public-tier visitor (no code) starting a
// session. BYOAI goes through the same use case: tier=public (recorded as byoai when
// BYOAIProvider is set), visibility forced to public. The BYOAI key itself never appears
// here —— the browser holds it, carried in the X-BYOAI-Key header envelope at chat time.
// The session only records the provider, for routing.
//
// No Handle field: v1 is a single-owner instance, a visitor landing on / is always this
// owner.
type IssuePublicSessionInput struct {
	VisitorName   string
	VisitorEmail  string // optional; the email the visitor filled in on entry → session profile
	BYOAIProvider string // 'anthropic' | 'openai' | '' (no BYOAI)
	ClientIP      string // the visitor's source IP (IP-awareness); empty = unknown
}

// IssuePublicSession —— public-tier session issuance.
func IssuePublicSession(
	ctx context.Context, deps *VisitorSessionDeps, in *IssuePublicSessionInput,
) (IssueCodeSessionResult, error) {
	soleOwner, err := loadSoleOwnerForVisitor(ctx, deps)
	if err != nil {
		return IssueCodeSessionResult{}, err
	}
	return finalizePublicSession(ctx, deps, in, &soleOwner)
}

// loadSoleOwnerForVisitor —— sole-owner resolution on the visitor.public path.
// usecases/page.go's LoadSoleOwner needs PageDeps; the visitor side only has
// VisitorDeps, so this small helper is duplicated to avoid deps depending on each
// other. Pre-claim → ErrOwnerNotFound, translated to 404 by the handler.
func loadSoleOwnerForVisitor(
	ctx context.Context, deps *VisitorSessionDeps,
) (owner.Owner, error) {
	handle, err := deps.Owners.FirstHandle(ctx)
	if err != nil {
		return owner.Owner{}, fmt.Errorf("first owner handle: %w", err)
	}
	if handle == "" {
		return owner.Owner{}, owner.ErrOwnerNotFound
	}
	soleOwner, oerr := deps.Owners.GetByHandle(ctx, handle)
	if oerr != nil {
		if errors.Is(oerr, owner.ErrOwnerNotFound) {
			return owner.Owner{}, owner.ErrOwnerNotFound
		}
		return owner.Owner{}, fmt.Errorf("get sole owner: %w", oerr)
	}
	return soleOwner, nil
}

func finalizePublicSession(
	ctx context.Context, deps *VisitorSessionDeps,
	in *IssuePublicSessionInput, o *owner.Owner,
) (IssueCodeSessionResult, error) {
	// Mode records byoai/public (functional, used by resolver/quota); BYOAI's specific
	// provider is a visitor/session-level property (frontend session-store +
	// per-request cred), not persisted on the conv row.
	mode := publicModeForBYOAI(in.BYOAIProvider)
	chat, err := deps.Chats.CreateChat(ctx, &repo.CreateChatInput{
		OwnerID:     o.ID,
		Mode:        mode,
		VisitorName: in.VisitorName,
		ClientIP:    in.ClientIP,
	})
	if err != nil {
		return IssueCodeSessionResult{}, fmt.Errorf("create chat: %w", err)
	}
	// A.3-IAM-5: public / byoai are also forced through RoleSnapshot —— freezing the
	// owner's public role. If the owner wants to narrow byoai, they change public's
	// corpus_uris, or issue a byoai-eligible code attached to a different role
	// (the latter is TODO).
	snapshot, sserr := buildRoleSnapshotForOwnerPublic(ctx, deps, o.ID)
	if sserr != nil {
		return IssueCodeSessionResult{}, fmt.Errorf("freeze public snapshot: %w", sserr)
	}
	// No code, so public/byoai follows the public role. If the role doesn't specify a
	// provider → freeze the owner's default one, don't freeze empty string: an empty
	// string would make this anonymous session's spending on the default key invisible
	// to gas accounting/gates (pentest 2026-09-01).
	providerID, perr := resolveSessionProviderID(ctx, deps, o.ID, snapshot.ProviderID())
	if perr != nil {
		return IssueCodeSessionResult{}, perr
	}
	issued, err := deps.Sessions.Issue(ctx, &access.VisitorSessionData{
		OwnerID:      o.ID,
		Mode:         mode,
		Visitor:      access.VisitorProfile{Name: in.VisitorName, Email: in.VisitorEmail},
		RoleSnapshot: &snapshot,
		ProviderID:   providerID,
		GasMetered:   snapshot.GasMetered(),
	})
	if err != nil {
		return IssueCodeSessionResult{}, fmt.Errorf("issue visitor session: %w", err)
	}
	return IssueCodeSessionResult{
		Session: issued, Chat: chat,
		VisitorName: in.VisitorName,
		// Code empty / Quota zero —— public/byoai has no turn cap; SessionStrip sees
		// max=0 and doesn't render a gauge, BYOAI shows the visitor-paid · unlimited copy.
	}, nil
}

func nullableProvider(p string) *string {
	if p == "" {
		return nil
	}
	return &p
}

// publicModeForBYOAI —— the browser declares "I'm bringing my own key" via the
// BYOAIProvider field at session create. Non-empty provider → mode=byoai; the
// distinction drives conv audit + billing.
func publicModeForBYOAI(provider string) string {
	if provider != "" {
		return "byoai"
	}
	return "public"
}
