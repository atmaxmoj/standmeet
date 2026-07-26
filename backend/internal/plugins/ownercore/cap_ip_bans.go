package ownercore

// cap_ip_bans.go —— owner IP-ban registry CRUD via Capability. 3 tools:
// ip_bans.list / ip_bans.add / ip_bans.remove. owner-only. Mirrors the
// /api/admin/ip-bans/* surface (BannedIPRepo.List / Ban / Unban).

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/mcputil"
	"github.com/atmaxmoj/standmeet/internal/security"
)

const capIPBansBundle = "ip_bans.bundle"

// ipBansStore —— narrow dep matching *security.BannedIPRepo's owner-CRUD
// methods exactly (List / Ban / Unban).
type ipBansStore interface {
	List(ctx context.Context, ownerID string) ([]security.BannedIP, error)
	Ban(ctx context.Context, ownerID, ip string, expiresAt *time.Time) (security.BannedIP, error)
	Unban(ctx context.Context, ownerID, id string) error
}

type ipBansCapability struct {
	store ipBansStore
	log   *slog.Logger
}

func newIPBansCapability(store ipBansStore, log *slog.Logger) *ipBansCapability {
	return &ipBansCapability{store: store, log: log}
}

func (*ipBansCapability) ID() string          { return capIPBansBundle }
func (*ipBansCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }

func (*ipBansCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*ipBansCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*ipBansCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *ipBansCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.listBinding(), c.addBinding(), c.removeBinding(),
	}
}

// ───── ip_bans.list ─────────────────────────────────────────────

func (c *ipBansCapability) listBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "ip_bans.list",
		Description: "List all IPs the owner has banned (includes expired ones).",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleList,
	}
}

type ipBanRow struct {
	ExpiresAt string `json:"expires_at,omitempty"`
	CreatedAt string `json:"created_at"`
	ID        string `json:"id"`
	IP        string `json:"ip"`
	Reason    string `json:"reason,omitempty"`
}

func (c *ipBansCapability) handleList(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	bans, err := c.store.List(ctx, ownerID)
	if err != nil {
		c.log.Error("cap ip_bans.list", "err", err)
		return capreg.MCPError("list ip bans failed")
	}
	out := make([]ipBanRow, 0, len(bans))
	for i := range bans {
		row := ipBanRow{
			ID: bans[i].ID, IP: bans[i].IP, Reason: bans[i].Reason,
			CreatedAt: bans[i].CreatedAt.Format(mcpTimeFmt),
		}
		if bans[i].ExpiresAt != nil {
			row.ExpiresAt = bans[i].ExpiresAt.Format(mcpTimeFmt)
		}
		out = append(out, row)
	}
	return mcputil.MarshalResult(c.log, "ip_bans.list", out)
}

// ───── ip_bans.add ──────────────────────────────────────────────

func (c *ipBansCapability) addBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "ip_bans.add",
		Description: "Ban a source IP. Upserts (re-banning the same IP overwrites).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"ip":{"type":"string","description":"Source IP to ban."},
				"expires_at":{"type":"string",
					"description":"Optional RFC3339 expiry. Empty = permanent."}
			},
			"required":["ip"]
		}`),
		Handler: c.handleAdd,
	}
}

type ipBanAddArgsWire struct {
	ExpiresAt *time.Time
	IP        string
}

type ipBanAddArgsRaw struct {
	IP        string `json:"ip"`
	ExpiresAt string `json:"expires_at"`
}

func parseIPBanAddArgs(raw json.RawMessage) (ipBanAddArgsWire, error) {
	var in ipBanAddArgsRaw
	if err := json.Unmarshal(raw, &in); err != nil {
		return ipBanAddArgsWire{}, errors.New("invalid arguments: " + err.Error())
	}
	if in.IP == "" {
		return ipBanAddArgsWire{}, errors.New("ip is required")
	}
	args := ipBanAddArgsWire{IP: in.IP}
	if in.ExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, in.ExpiresAt)
		if err != nil {
			return ipBanAddArgsWire{}, errors.New("expires_at must be RFC3339 or empty")
		}
		args.ExpiresAt = &t
	}
	return args, nil
}

func (c *ipBansCapability) handleAdd(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseIPBanAddArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	ban, err := c.store.Ban(ctx, ownerID, args.IP, args.ExpiresAt)
	if err != nil {
		c.log.Error("cap ip_bans.add", "err", err)
		return capreg.MCPError("ban ip failed")
	}
	return mcputil.MarshalResult(c.log, "ip_bans.add", map[string]string{
		"id": ban.ID, "ip": ban.IP,
	})
}

// ───── ip_bans.remove ───────────────────────────────────────────

func (c *ipBansCapability) removeBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "ip_bans.remove",
		Description: "Unban a previously banned IP by its ban id. Idempotent.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"id":{"type":"string","description":"Ban row id."}
			},
			"required":["id"]
		}`),
		Handler: c.handleRemove,
	}
}

type ipBanRemoveArgsWire struct {
	ID string `json:"id"`
}

func (c *ipBansCapability) handleRemove(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args ipBanRemoveArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.ID == "" {
		return capreg.MCPError("id is required")
	}
	if err := c.store.Unban(ctx, ownerID, args.ID); err != nil {
		c.log.Error("cap ip_bans.remove", "err", err)
		return capreg.MCPError("unban ip failed")
	}
	return mcputil.MarshalResult(c.log, "ip_bans.remove", map[string]string{
		"id": args.ID,
	})
}
