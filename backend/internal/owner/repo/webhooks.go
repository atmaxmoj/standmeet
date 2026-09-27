// webhooks.go —— webhook_endpoints: the owner's receivers, plus the two pieces of delivery state
// that live on the row: the per-endpoint lease (busy_until: at most one delivery in flight, held
// across processes) and the failure streak (failing_since: the cooldown and the 5-day disable).
//
// The secret is sealed here (cryptobox, AAD = owner id) and never unsealed: the one opener lives
// in cmd/server/unseal.go (§1.5).

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

const webhookCols = `id::text, owner_id::text, url, description, event_types,
	coalesce(embed_id::text, ''), enabled, disabled_reason, failing_since, created_at, updated_at`

func scanWebhook(row pgx.Row) (entity.WebhookEndpoint, error) {
	var e entity.WebhookEndpoint
	err := row.Scan(&e.ID, &e.OwnerID, &e.URL, &e.Description, &e.EventTypes, &e.EmbedID,
		&e.Enabled, &e.DisabledReason, &e.FailingSince, &e.CreatedAt, &e.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return e, entity.ErrWebhookNotFound
	}
	if err != nil {
		return e, fmt.Errorf("scan webhook endpoint: %w", err)
	}
	e.EventTypes = pgstore.NilSafeStrings(e.EventTypes)
	return e, nil
}

func collectWebhooks(rows pgx.Rows, err error) ([]entity.WebhookEndpoint, error) {
	if err != nil {
		return nil, fmt.Errorf("list webhook endpoints: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (entity.WebhookEndpoint, error) {
		return scanWebhook(r)
	})
	if err != nil {
		return nil, fmt.Errorf("list webhook endpoints: %w", err)
	}
	return out, nil
}

func sealWebhookSecret(ownerID, secret string) ([]byte, error) {
	enc, err := cryptobox.Encrypt([]byte(secret), []byte(ownerID))
	if err != nil {
		return nil, fmt.Errorf("seal webhook secret: %w", err)
	}
	return enc, nil
}

// CreateWebhook —— a new endpoint with its (plaintext) secret, sealed before it is stored.
// in.EmbedID attaches it to that embed ("" = standalone).
func (r *Repo) CreateWebhook(
	ctx context.Context, ownerID string, in *entity.WebhookEndpoint, secret string,
) (entity.WebhookEndpoint, error) {
	enc, err := sealWebhookSecret(ownerID, secret)
	if err != nil {
		return entity.WebhookEndpoint{}, err
	}
	return scanWebhook(r.pool.QueryRow(ctx, `INSERT INTO webhook_endpoints
		(owner_id, url, description, event_types, secret_enc, embed_id)
		VALUES ($1, $2, $3, $4, $5, nullif($6, '')::uuid)
		RETURNING `+webhookCols, ownerID, in.URL, in.Description, in.EventTypes, enc, in.EmbedID))
}

// ListWebhooks —— the owner's endpoints, oldest first.
func (r *Repo) ListWebhooks(ctx context.Context, ownerID string) ([]entity.WebhookEndpoint, error) {
	return collectWebhooks(r.pool.Query(ctx, `SELECT `+webhookCols+` FROM webhook_endpoints
		WHERE owner_id = $1 ORDER BY created_at, id`, ownerID))
}

// EnabledWebhooks —— the endpoints a fan-out may deliver to.
func (r *Repo) EnabledWebhooks(
	ctx context.Context, ownerID string,
) ([]entity.WebhookEndpoint, error) {
	return collectWebhooks(r.pool.Query(ctx, `SELECT `+webhookCols+` FROM webhook_endpoints
		WHERE owner_id = $1 AND enabled ORDER BY created_at, id`, ownerID))
}

// GetWebhook —— one of the owner's endpoints.
func (r *Repo) GetWebhook(ctx context.Context, ownerID, id string) (entity.WebhookEndpoint, error) {
	if !pgstore.IsUUID(id) {
		return entity.WebhookEndpoint{}, entity.ErrWebhookNotFound
	}
	return scanWebhook(r.pool.QueryRow(ctx, `SELECT `+webhookCols+` FROM webhook_endpoints
		WHERE owner_id = $1 AND id = $2`, ownerID, id))
}

// UpdateWebhook —— applies p. Turning an endpoint back on clears its failure streak.
func (r *Repo) UpdateWebhook(
	ctx context.Context, ownerID, id string, p *entity.WebhookPatch,
) (entity.WebhookEndpoint, error) {
	if !pgstore.IsUUID(id) {
		return entity.WebhookEndpoint{}, entity.ErrWebhookNotFound
	}
	return scanWebhook(r.pool.QueryRow(ctx, `UPDATE webhook_endpoints SET
		url = coalesce($3, url), description = coalesce($4, description),
		event_types = coalesce($5, event_types), enabled = coalesce($6, enabled),
		disabled_reason = CASE WHEN $6 THEN '' ELSE disabled_reason END,
		failing_since = CASE WHEN $6 THEN NULL ELSE failing_since END,
		updated_at = now()
		WHERE owner_id = $1 AND id = $2 RETURNING `+webhookCols,
		ownerID, id, p.URL, p.Description, p.EventTypes, p.Enabled))
}

// DeleteWebhook —— removes the endpoint. Its queued deliveries find it gone and discard.
func (r *Repo) DeleteWebhook(ctx context.Context, ownerID, id string) error {
	if !pgstore.IsUUID(id) {
		return entity.ErrWebhookNotFound
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM webhook_endpoints WHERE owner_id = $1 AND id = $2`,
		ownerID, id)
	if err != nil {
		return fmt.Errorf("delete webhook endpoint: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return entity.ErrWebhookNotFound
	}
	return nil
}

// RotateWebhookSecret —— replaces the sealed secret.
func (r *Repo) RotateWebhookSecret(ctx context.Context, ownerID, id, secret string) error {
	if !pgstore.IsUUID(id) {
		return entity.ErrWebhookNotFound
	}
	enc, err := sealWebhookSecret(ownerID, secret)
	if err != nil {
		return err
	}
	tag, err := r.pool.Exec(ctx, `UPDATE webhook_endpoints SET secret_enc = $3, updated_at = now()
		WHERE owner_id = $1 AND id = $2`, ownerID, id, enc)
	if err != nil {
		return fmt.Errorf("rotate webhook secret: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return entity.ErrWebhookNotFound
	}
	return nil
}

// SealedSecret —— a stored secret and the owner it is sealed to.
type SealedSecret struct {
	OwnerID string
	Enc     []byte
}

// SealedWebhookSecret —— the unseal adapter's one read.
func (r *Repo) SealedWebhookSecret(ctx context.Context, id string) (SealedSecret, error) {
	var s SealedSecret
	if !pgstore.IsUUID(id) {
		return s, entity.ErrWebhookNotFound
	}
	err := r.pool.QueryRow(ctx, `SELECT owner_id::text, secret_enc FROM webhook_endpoints
		WHERE id = $1`, id).Scan(&s.OwnerID, &s.Enc)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, entity.ErrWebhookNotFound
	}
	if err != nil {
		return s, fmt.Errorf("read webhook secret: %w", err)
	}
	return s, nil
}

// LeaseWebhook —— takes the endpoint's delivery lease for d. ErrWebhookBusy: another delivery
// holds it; ErrWebhookDisabled: turned off; ErrWebhookNotFound: deleted.
func (r *Repo) LeaseWebhook(
	ctx context.Context, id string, d time.Duration,
) (entity.WebhookEndpoint, error) {
	if !pgstore.IsUUID(id) {
		return entity.WebhookEndpoint{}, entity.ErrWebhookNotFound
	}
	e, err := scanWebhook(r.pool.QueryRow(ctx, `UPDATE webhook_endpoints
		SET busy_until = now() + $2 * interval '1 second'
		WHERE id = $1 AND enabled AND (busy_until IS NULL OR busy_until < now())
		RETURNING `+webhookCols, id, d.Seconds()))
	if !errors.Is(err, entity.ErrWebhookNotFound) {
		return e, err // nil: leased
	}
	e, err = scanWebhook(r.pool.QueryRow(ctx, `SELECT `+webhookCols+` FROM webhook_endpoints
		WHERE id = $1`, id))
	err = whyNotLeased(&e, err)
	return e, err
}

func whyNotLeased(e *entity.WebhookEndpoint, err error) error {
	switch {
	case err != nil:
		return err
	case !e.Enabled:
		return entity.ErrWebhookDisabled
	default:
		return entity.ErrWebhookBusy
	}
}

// settleFailure —— the right-hand sides read the row as it was: a streak older than $2 seconds
// turns the endpoint off.
const settleFailure = `UPDATE webhook_endpoints SET busy_until = NULL,
	failing_since = coalesce(failing_since, now()),
	enabled = enabled AND coalesce(failing_since > now() - $2 * interval '1 second', true),
	disabled_reason = CASE
		WHEN enabled AND failing_since <= now() - $2 * interval '1 second' THEN $3
		ELSE disabled_reason END,
	updated_at = CASE
		WHEN enabled AND failing_since <= now() - $2 * interval '1 second' THEN now()
		ELSE updated_at END
	WHERE id = $1`

// WebhookSucceeded —— releases the lease and ends the failure streak.
func (r *Repo) WebhookSucceeded(ctx context.Context, id string) error {
	if _, err := r.pool.Exec(ctx, `UPDATE webhook_endpoints
		SET busy_until = NULL, failing_since = NULL WHERE id = $1`, id); err != nil {
		return fmt.Errorf("settle webhook endpoint: %w", err)
	}
	return nil
}

// WebhookFailed —— releases the lease and starts (or continues) the failure streak; once the
// streak is older than disableAfter, the endpoint is turned off with reason.
func (r *Repo) WebhookFailed(
	ctx context.Context, id string, disableAfter time.Duration, reason string,
) error {
	if _, err := r.pool.Exec(ctx, settleFailure, id, disableAfter.Seconds(), reason); err != nil {
		return fmt.Errorf("settle webhook endpoint: %w", err)
	}
	return nil
}
