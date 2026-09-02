// Package ops -- what the security domain can do, declared by the domain itself.
//
// One op here is a complete unit: id, description, input schema, semantic kind,
// exposure intent, implementation. The implementation just calls this domain's
// functions, no intermediate shape in between -- the collection point only
// aggregates, decorates, and projects onto each facade.
package ops

import (
	"context"
	"encoding/json"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/security/ban"
)

// IPBans -- the source-IP ban group: list / ban / unban.
//
// The payload shape is the contract, and both facades get the same one:
// expires_at is null for a permanent ban (the field never disappears),
// and unban returns {"ok":true}.
func IPBans(repo *ban.BannedIPRepo) []fp.Op {
	return []fp.Op{
		{
			ID:          "ip_bans.list",
			Description: "List all IPs the owner has banned, expired ones included.",
			InputSchema: emptyArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listIPBans(repo),
		},
		{
			ID:          "ip_bans.add",
			Description: "Ban a source IP. Re-banning the same IP overwrites the old row.",
			InputSchema: ipBanAddSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      addIPBan(repo),
		},
		{
			ID:          "ip_bans.remove",
			Description: "Lift a ban by its row id. Idempotent.",
			InputSchema: ipBanIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      removeIPBan(repo),
		},
	}
}

var (
	emptyArgs = json.RawMessage(`{"type":"object","properties":{}}`)

	ipBanAddSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"ip":{"type":"string","description":"Source IP to ban."},
			"reason":{"type":"string","description":"Optional note on why."},
			"expires_at":{"type":"string",
				"description":"Optional RFC3339 expiry. Empty means permanent."}
		},
		"required":["ip"]
	}`)

	ipBanIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"id":{"type":"string","description":"Ban row id."}},
		"required":["id"]
	}`)
)

// ipBanOut -- the outbound shape of one ban.
type ipBanOut struct {
	ExpiresAt *time.Time `json:"expires_at"`
	CreatedAt time.Time  `json:"created_at"`
	ID        string     `json:"id"`
	IP        string     `json:"ip"`
	Reason    string     `json:"reason"`
}

func toIPBanOut(b *ban.BannedIP) ipBanOut {
	return ipBanOut{
		ID: b.ID, IP: b.IP, Reason: b.Reason,
		CreatedAt: b.CreatedAt, ExpiresAt: b.ExpiresAt,
	}
}

func listIPBans(repo *ban.BannedIPRepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		bans, err := repo.List(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("list ip bans", err)
		}
		out := make([]ipBanOut, 0, len(bans))
		for i := range bans {
			out = append(out, toIPBanOut(&bans[i]))
		}
		return json.Marshal(out)
	}
}

type ipBanAddArgs struct {
	IP        string `json:"ip"`
	Reason    string `json:"reason"`
	ExpiresAt string `json:"expires_at"`
}

func addIPBan(repo *ban.BannedIPRepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeIPBanAdd(ownerID, raw)
		if perr != nil {
			return nil, perr
		}
		banned, err := repo.Ban(ctx, in)
		if err != nil {
			return nil, fp.OpErr("ban ip", err)
		}
		return json.Marshal(toIPBanOut(&banned))
	}
}

func decodeIPBanAdd(ownerID string, raw json.RawMessage) (*ban.IPInput, error) {
	var in ipBanAddArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs([2]string{"ip", in.IP}); err != nil {
		return nil, err
	}
	out := &ban.IPInput{OwnerID: ownerID, IP: in.IP, Reason: in.Reason}
	expires, perr := optionalRFC3339(in.ExpiresAt)
	if perr != nil {
		return nil, perr
	}
	out.ExpiresAt = expires
	return out, nil
}

// optionalRFC3339 -- empty means unset (permanent), not an error.
func optionalRFC3339(s string) (*time.Time, error) {
	if s == "" {
		return nil, nil //nolint:nilnil // empty = unset, not an error
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil, fp.BadInput("expires_at must be RFC3339 or empty")
	}
	return &t, nil
}

type ipBanIDArgs struct {
	ID string `json:"id"`
}

func removeIPBan(repo *ban.BannedIPRepo) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in ipBanIDArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
			return nil, err
		}
		if err := repo.Unban(ctx, ownerID, in.ID); err != nil {
			return nil, fp.OpErr("unban ip", err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}
