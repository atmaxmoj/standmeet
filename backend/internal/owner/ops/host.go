// host.go —— what this domain exposes to **sandboxed capabilities** (inbound direction).
//
// Just one thing: reading the owner's **whitelisted** fields. Anything not whitelisted is
// refused — a sandbox can ask "what timezone is the owner in", it can't scoop up the whole
// owner record along the way. The whitelist is hardcoded here; adding a field means editing
// this one line, visible to review.

package ops

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// MetaLookup —— fetches the owner record (whitelisted fields only, read-only).
type MetaLookup interface {
	GetByID(ctx context.Context, ownerID string) (entity.Owner, error)
}

// FullNameOf —— the owner's full name, best-effort: no lookup wired / lookup fails → empty
// string.
//
// "Who is behind this instance" is persona's opening line (UX-66), and **every** path that
// assembles a persona has to ask the same question: /sessions assembling the one for a real
// visitor, /diag/session assembling the one it self-verifies against. It lives here so both
// sides ask the same thing — if one quietly swaps a field, the hash the other reports
// stops matching what actually went out.
func FullNameOf(ctx context.Context, owners MetaLookup, ownerID string) string {
	if owners == nil || ownerID == "" {
		return ""
	}
	row, err := owners.GetByID(ctx, ownerID)
	if err != nil {
		return ""
	}
	return row.FullName
}

// HostOps —— owner.meta.
func HostOps(owners MetaLookup) []hostop.Op {
	return []hostop.Op{{
		Name: "owner.meta",
		Description: "Read one whitelisted owner field (timezone / full_name / email). " +
			"Anything else is refused — this is not a way to read the owner row.",
		Invoke: readOwnerMeta(owners),
	}}
}

func readOwnerMeta(owners MetaLookup) hostop.Invoke {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req struct {
			OwnerID string `json:"owner_id"`
			Field   string `json:"field"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("owner.meta: decode: %w", err)
		}
		row, err := owners.GetByID(ctx, req.OwnerID)
		if err != nil {
			return nil, fmt.Errorf("owner.meta: %w", err)
		}
		return whitelistedField(&row, req.Field)
	}
}

// whitelistedField —— the whitelist lives here, one single copy. A name not in the table →
// refuse, don't return an empty value: a sandbox asking for something the host won't give
// should hear "not allowed", not be left thinking the owner just never filled it in.
func whitelistedField(row *entity.Owner, field string) (json.RawMessage, error) {
	served := map[string]string{
		"timezone":  row.ProfileTimezone,
		"full_name": row.FullName,
		"email":     row.Email,
	}
	val, ok := served[field]
	if !ok {
		return nil, fmt.Errorf("owner.meta: field %q not allowed", field)
	}
	out, err := json.Marshal(map[string]string{"value": val})
	if err != nil {
		return nil, fmt.Errorf("owner.meta: marshal: %w", err)
	}
	return out, nil
}
