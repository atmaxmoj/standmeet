// notify.go —— notify_rules, notify_rule_marks and im_links
// (docs/design/notify-rules-and-live-transcript.md).

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

const ruleCols = `id::text, owner_id::text, event_type, filter_key, filter_value, first_only,
	channel, channel_ref, template, enabled, created_at`

func scanRule(row pgx.Row) (entity.NotifyRule, error) {
	var r entity.NotifyRule
	err := row.Scan(&r.ID, &r.OwnerID, &r.EventType, &r.FilterKey, &r.FilterValue, &r.FirstOnly,
		&r.Channel, &r.ChannelRef, &r.Template, &r.Enabled, &r.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, entity.ErrNotifyRuleNotFound
	}
	if err != nil {
		return r, fmt.Errorf("scan notify rule: %w", err)
	}
	return r, nil
}

func collectRules(rows pgx.Rows, err error) ([]entity.NotifyRule, error) {
	if err != nil {
		return nil, fmt.Errorf("list notify rules: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (entity.NotifyRule, error) {
		return scanRule(r)
	})
	if err != nil {
		return nil, fmt.Errorf("list notify rules: %w", err)
	}
	return out, nil
}

// CreateNotifyRule —— stores a validated rule.
func (r *Repo) CreateNotifyRule(
	ctx context.Context, in *entity.NotifyRule,
) (entity.NotifyRule, error) {
	return scanRule(r.pool.QueryRow(ctx, `INSERT INTO notify_rules
		(owner_id, event_type, filter_key, filter_value, first_only, channel, channel_ref, template)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+ruleCols,
		in.OwnerID, in.EventType, in.FilterKey, in.FilterValue, in.FirstOnly, in.Channel,
		in.ChannelRef, in.Template))
}

// ListNotifyRules —— the owner's rules, oldest first.
func (r *Repo) ListNotifyRules(ctx context.Context, ownerID string) ([]entity.NotifyRule, error) {
	return collectRules(r.pool.Query(ctx, `SELECT `+ruleCols+` FROM notify_rules
		WHERE owner_id = $1 ORDER BY created_at, id`, ownerID))
}

// EnabledNotifyRules —— the rules a fan-out matches events against.
func (r *Repo) EnabledNotifyRules(
	ctx context.Context, ownerID string,
) ([]entity.NotifyRule, error) {
	return collectRules(r.pool.Query(ctx, `SELECT `+ruleCols+` FROM notify_rules
		WHERE owner_id = $1 AND enabled ORDER BY created_at, id`, ownerID))
}

// NotifyRule —— one rule by id (any owner: the delivery job reads by id; the event names the
// owner).
func (r *Repo) NotifyRule(ctx context.Context, id string) (entity.NotifyRule, error) {
	if !pgstore.IsUUID(id) {
		return entity.NotifyRule{}, entity.ErrNotifyRuleNotFound
	}
	return scanRule(r.pool.QueryRow(ctx, `SELECT `+ruleCols+` FROM notify_rules WHERE id = $1`, id))
}

// SetNotifyRuleEnabled —— turns a rule off or back on.
func (r *Repo) SetNotifyRuleEnabled(
	ctx context.Context, ownerID, id string, enabled bool,
) (entity.NotifyRule, error) {
	if !pgstore.IsUUID(id) {
		return entity.NotifyRule{}, entity.ErrNotifyRuleNotFound
	}
	return scanRule(r.pool.QueryRow(ctx, `UPDATE notify_rules SET enabled = $3
		WHERE owner_id = $1 AND id = $2 RETURNING `+ruleCols, ownerID, id, enabled))
}

// DeleteNotifyRule —— removes the rule; its queued deliveries find it gone and discard.
func (r *Repo) DeleteNotifyRule(ctx context.Context, ownerID, id string) error {
	if !pgstore.IsUUID(id) {
		return entity.ErrNotifyRuleNotFound
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM notify_rules WHERE owner_id = $1 AND id = $2`,
		ownerID, id)
	if err != nil {
		return fmt.Errorf("delete notify rule: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return entity.ErrNotifyRuleNotFound
	}
	return nil
}

// ClaimNotifyMark —— on q (the fan-out's transaction): true the first time (rule, mark) is seen.
func ClaimNotifyMark(ctx context.Context, q pgstore.DBTX, ruleID, mark string) (bool, error) {
	tag, err := q.Exec(ctx, `INSERT INTO notify_rule_marks (rule_id, mark) VALUES ($1, $2)
		ON CONFLICT DO NOTHING`, ruleID, mark)
	if err != nil {
		return false, fmt.Errorf("claim notify mark: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

const imLinkCols = `id::text, owner_id::text, platform, pairing_code, chat_id, created_at,
	paired_at`

func scanIMLink(row pgx.Row) (entity.IMLink, error) {
	var l entity.IMLink
	err := row.Scan(&l.ID, &l.OwnerID, &l.Platform, &l.PairingCode, &l.ChatID, &l.CreatedAt,
		&l.PairedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return l, entity.ErrIMLinkNotFound
	}
	if err != nil {
		return l, fmt.Errorf("scan im link: %w", err)
	}
	return l, nil
}

// CreateIMLink —— a new, not yet linked chat carrying its pairing code.
func (r *Repo) CreateIMLink(ctx context.Context, ownerID, code string) (entity.IMLink, error) {
	return scanIMLink(r.pool.QueryRow(ctx, `INSERT INTO im_links (owner_id, pairing_code)
		VALUES ($1, $2) RETURNING `+imLinkCols, ownerID, code))
}

// ListIMLinks —— the owner's chats, oldest first.
func (r *Repo) ListIMLinks(ctx context.Context, ownerID string) ([]entity.IMLink, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+imLinkCols+` FROM im_links WHERE owner_id = $1
		ORDER BY created_at, id`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list im links: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (entity.IMLink, error) {
		return scanIMLink(row)
	})
	if err != nil {
		return nil, fmt.Errorf("list im links: %w", err)
	}
	return out, nil
}

// IMLink —— one of the owner's chats.
func (r *Repo) IMLink(ctx context.Context, ownerID, id string) (entity.IMLink, error) {
	if !pgstore.IsUUID(id) {
		return entity.IMLink{}, entity.ErrIMLinkNotFound
	}
	return scanIMLink(r.pool.QueryRow(ctx, `SELECT `+imLinkCols+` FROM im_links
		WHERE owner_id = $1 AND id = $2`, ownerID, id))
}

// PairIMLink —— the bridge saw `code` from chat `chatID` on `platform`: record the chat on the
// link carrying that code, while it is not linked yet and younger than maxAgeMinutes.
func (r *Repo) PairIMLink(
	ctx context.Context, code, platform, chatID string, maxAgeMinutes int,
) (entity.IMLink, error) {
	return scanIMLink(r.pool.QueryRow(ctx, `UPDATE im_links
		SET chat_id = $3, platform = $2, paired_at = now()
		WHERE pairing_code = $1 AND chat_id = ''
		  AND created_at > now() - make_interval(mins => $4)
		RETURNING `+imLinkCols, code, platform, chatID, maxAgeMinutes))
}

// DeleteIMLink —— unlinks a chat. Rules pointing at it stop finding it and send nothing.
func (r *Repo) DeleteIMLink(ctx context.Context, ownerID, id string) error {
	if !pgstore.IsUUID(id) {
		return entity.ErrIMLinkNotFound
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM im_links WHERE owner_id = $1 AND id = $2`,
		ownerID, id)
	if err != nil {
		return fmt.Errorf("delete im link: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return entity.ErrIMLinkNotFound
	}
	return nil
}
