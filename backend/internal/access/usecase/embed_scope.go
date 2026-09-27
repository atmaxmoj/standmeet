// embed_scope.go —— an embed's corpus scope: what its update hook may hear about
// (docs/design/event-bus-outbox-webhooks.md, *Relay and delivery › Scope*).

package usecase

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
)

// EmbedScopeDeps —— where an embed's scope is read from.
type EmbedScopeDeps struct {
	Embeds  *repo.EmbedRepo
	Codes   *repo.CodeRepo
	Denials *repo.CodeDenialRepo
	Roles   *repo.RoleRepo
}

// errAdmitsNothing —— the embed is gone, or its code is revoked or expired.
var errAdmitsNothing = errors.New("embed admits nothing")

// EmbedAdmits —— whether entry is inside embedID's scope: its code's role globs minus the code's
// corpus denials, judged by the one predicate (entity.AllowsCorpusEntry). Everything is read on
// each call: a code can be revoked or re-scoped at any time. A deleted embed, or a revoked or
// expired code, admits nothing.
func EmbedAdmits(
	ctx context.Context, d EmbedScopeDeps, ownerID, embedID string, entry entity.CorpusEntryRef,
) (bool, error) {
	scope, err := embedScope(ctx, d, ownerID, embedID)
	if errors.Is(err, errAdmitsNothing) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return entity.AllowsCorpusEntry(scope, entry), nil
}

// embedScope —— the scope of the embed's live code, as a session on that code would get it.
func embedScope(
	ctx context.Context, d EmbedScopeDeps, ownerID, embedID string,
) (entity.CorpusScope, error) {
	code, err := liveEmbedCode(ctx, d, ownerID, embedID)
	if err != nil {
		return entity.CorpusScope{}, err
	}
	role, err := d.Roles.GetByID(ctx, ownerID, code.AssumedRoleID)
	if err != nil {
		return entity.CorpusScope{}, fmt.Errorf("embed scope: role: %w", err)
	}
	denied, err := d.Denials.ListCorpusURIs(ctx, code.ID)
	if err != nil {
		return entity.CorpusScope{}, fmt.Errorf("embed scope: denials: %w", err)
	}
	return entity.CorpusScope{
		Granted: role.CorpusURIs(), Denied: denied,
		PublishedOnly: entity.ReadsPublishedSlice(role.Name()),
	}, nil
}

// liveEmbedCode —— the code the embed exposes; errAdmitsNothing when the embed or the code is
// gone, or the code is revoked or expired.
func liveEmbedCode(
	ctx context.Context, d EmbedScopeDeps, ownerID, embedID string,
) (entity.Code, error) {
	e, err := d.Embeds.Get(ctx, ownerID, embedID)
	if err != nil {
		return entity.Code{}, admitsNothingIf(err, entity.ErrEmbedNotFound)
	}
	code, err := d.Codes.GetByID(ctx, e.CodeID)
	if err != nil {
		return code, admitsNothingIf(err, entity.ErrCodeInvalid)
	}
	if !codeLive(&code) {
		return code, errAdmitsNothing
	}
	return code, nil
}

// admitsNothingIf —— errAdmitsNothing when err is gone, else err named.
func admitsNothingIf(err, gone error) error {
	if errors.Is(err, gone) {
		return errAdmitsNothing
	}
	return fmt.Errorf("embed scope: %w", err)
}

// codeLive —— active and not past its expiry.
func codeLive(c *entity.Code) bool {
	return c.Status == entity.CodeStatusActive &&
		(c.ExpiresAt == nil || c.ExpiresAt.After(time.Now()))
}
