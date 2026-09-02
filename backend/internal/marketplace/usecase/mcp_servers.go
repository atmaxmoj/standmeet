// mcp_servers.go —— CRUD for external MCP servers the owner registers. The auth header
// value is stored cryptobox-encrypted (same pattern as the BYOAI key). Once an InviteCode
// selects this group, visitor chat pulls the servers' tools into the ToolSpec list.

package usecase

import (
	"context"
	"errors"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/marketplace/entity"
	"github.com/atmaxmoj/standmeet/internal/marketplace/repo"
)

// MCPServersDeps —— the repo bundle for mcp servers CRUD + per-code association.
//
// Prober is a **port, not a repository**: the domain declares "go ask it one question",
// the outbound side implements it (see below).
type MCPServersDeps struct {
	Servers *repo.MCPServerRepo
	Codes   *access.CodeRepo
	Prober  MCPServerProber
}

// MCPServerProber —— ask a registered server one question: **does it answer, and what
// tools does it have** (F-D-8).
//
// Why a port: that server's auth header is ciphertext in the store, and **this side never
// decrypts it** (the same rule as ext-mcp assembly — what you get back should be "something
// you can dial directly", not "the key that unlocks it"). The implementation lives at the
// composition root: it holds both the unsealer (`dialableMCPServers` in
// `cmd/server/unseal.go`) and the dial + list calls (`mcpclient.Dial` + `ListTools`) —
// assembling a session takes that same path; here we're just letting the owner
// **actively ask once**, the same shape as the connector's read-only probe (F-C-16).
//
// When no implementation is wired (nil), `mcp_server_check` says plainly that this instance
// lacks the capability, instead of pretending it probed.
type MCPServerProber interface {
	Probe(ctx context.Context, ownerID, serverID string) (MCPProbeResult, error)
}

// MCPProbeResult —— what the probe brings back. Tool names, not a count: the owner needs to
// recognize whether this is the server he meant to attach — "3 tools" doesn't let him
// recognize it, `ext_deepwiki_ask` does.
type MCPProbeResult struct {
	Tools []string
}

// CreateMCPServerReq —— create input. AuthHeaderValue is plaintext; this function
// cryptobox.Encrypt's it once before persisting.
type CreateMCPServerReq struct {
	OwnerID         string
	Name            string
	URL             string
	AuthHeaderName  string
	AuthHeaderValue string
}

// CreateMCPServer —— create a new mcp_server. A name collision surfaces as
// ErrMCPServerNameTaken.
func CreateMCPServer(
	ctx context.Context, deps MCPServersDeps, in *CreateMCPServerReq,
) (entity.MCPServerConfig, error) {
	if verr := validateMCPCreateInput(in); verr != nil {
		return entity.MCPServerConfig{}, verr
	}
	enc, eerr := encryptAuthValue(in.AuthHeaderValue, []byte(in.OwnerID))
	if eerr != nil {
		return entity.MCPServerConfig{}, eerr
	}
	return persistMCPServer(ctx, deps, in, enc)
}

func validateMCPCreateInput(in *CreateMCPServerReq) error {
	if in.OwnerID == "" || in.Name == "" || in.URL == "" {
		return apierr.ErrEmptyField
	}
	return nil
}

func persistMCPServer(
	ctx context.Context, deps MCPServersDeps, in *CreateMCPServerReq, enc []byte,
) (entity.MCPServerConfig, error) {
	cfg, err := deps.Servers.Create(ctx, &repo.CreateMCPServerInput{
		OwnerID: in.OwnerID, Name: in.Name, URL: in.URL,
		AuthHeaderName: in.AuthHeaderName, AuthHeaderValueEnc: enc,
	})
	if err != nil {
		if errors.Is(err, entity.ErrMCPServerNameTaken) {
			return entity.MCPServerConfig{}, entity.ErrMCPServerNameTaken
		}
		return entity.MCPServerConfig{}, fmt.Errorf("create mcp server: %w", err)
	}
	return cfg, nil
}

// aad = owner_id: the ext-mcp auth header ciphertext is bound to that owner; buildAuthHeaders
// decrypts it with the same cfg.OwnerID string.
func encryptAuthValue(plaintext string, aad []byte) ([]byte, error) {
	if plaintext == "" {
		// The column is NOT NULL DEFAULT '\x'::bytea; if pgx receives nil it writes NULL
		// instead of the default empty bytes. Give it []byte{} explicitly so the write
		// goes through as a zero-length bytea.
		return []byte{}, nil
	}
	enc, err := cryptobox.Encrypt([]byte(plaintext), aad)
	if err != nil {
		return nil, fmt.Errorf("encrypt auth value: %w", err)
	}
	return enc, nil
}

// ListMCPServers —— admin / MCP list.
func ListMCPServers(
	ctx context.Context, deps MCPServersDeps, ownerID string,
) ([]entity.MCPServerConfig, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	rows, err := deps.Servers.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list mcp servers: %w", err)
	}
	return rows, nil
}

// CheckMCPServer —— ask that server one question: does it answer, what tools does it
// have (F-D-8).
//
// First confirm the server actually belongs to this owner (the repo layer owns that
// check), then let the port dial it. **A read operation**: it writes nothing and changes
// nothing about the server's state — the owner just wants to know "is the URL I just
// pasted correct".
func CheckMCPServer(
	ctx context.Context, deps MCPServersDeps, ownerID, serverID string,
) (MCPProbeResult, error) {
	if err := checkProbePrereqs(ctx, deps, ownerID, serverID); err != nil {
		return MCPProbeResult{}, err
	}
	res, perr := deps.Prober.Probe(ctx, ownerID, serverID)
	if perr != nil {
		return MCPProbeResult{}, fmt.Errorf("probe mcp server: %w", perr)
	}
	return res, nil
}

// checkProbePrereqs —— the three things that must hold before dialing: params are
// complete, this instance has a prober wired, and this server belongs to him.
func checkProbePrereqs(
	ctx context.Context, deps MCPServersDeps, ownerID, serverID string,
) error {
	if ownerID == "" || serverID == "" {
		return apierr.ErrEmptyField
	}
	if deps.Prober == nil {
		return ErrMCPProbeUnavailable
	}
	if _, err := deps.Servers.GetByID(ctx, ownerID, serverID); err != nil {
		return fmt.Errorf("get mcp server: %w", err)
	}
	return nil
}

// ErrMCPProbeUnavailable —— this instance has no prober implementation wired.
// **Say so explicitly** — don't report it as "that server didn't answer": to the owner
// those two things mean opposite things (the same split F-C-23 makes between those two
// messages).
var ErrMCPProbeUnavailable = errors.New("this instance cannot probe MCP servers")

// Two probe-failure kinds, and **what the owner has to do about each is completely
// different** (F-D-15): one means go change the token, the other means go change the URL.
// They used to be the same message, "no answer — internal error" — "it answered but
// refused" got reported as "couldn't dial at all".
//
// Why the sentinels live in the domain instead of recognizing the transport error
// directly: `mcpclient` is the outbound implementation, this domain only declares the
// port (`MCPServerProber`); the composition root dials, then translates the transport
// layer's truth into these two words and hands it back.
var (
	// ErrMCPServerRefusedAuth —— the other side answered, it just rejects this credential.
	ErrMCPServerRefusedAuth = errors.New("mcp server refused the auth header")
	// ErrMCPServerNoAnswer —— genuinely unreachable (network / URL / protocol).
	ErrMCPServerNoAnswer = errors.New("mcp server did not answer")
)

// DeleteMCPServer —— delete one row; ownership is checked via the repo.
func DeleteMCPServer(
	ctx context.Context, deps MCPServersDeps, ownerID, serverID string,
) error {
	if ownerID == "" || serverID == "" {
		return apierr.ErrEmptyField
	}
	if _, gerr := deps.Servers.GetByID(ctx, ownerID, serverID); gerr != nil {
		return fmt.Errorf("get mcp server: %w", gerr)
	}
	if err := deps.Servers.Delete(ctx, ownerID, serverID); err != nil {
		return fmt.Errorf("delete mcp server: %w", err)
	}
	return nil
}

// GrantMCPServerDep —— the owner explicitly authorizes this ext-mcp server to receive a
// connector dependency (a dep name). ext-mcp carries the lowest trust: a tool's declared
// Requires is not injected by default; the grant is written to server.GrantedDeps, and the
// assembly-time gate (capreg_ext_mcp_deps.go) admits it based on that plus `connected`.
// Validates the server belongs to the owner first. Idempotent.
func GrantMCPServerDep(
	ctx context.Context, deps MCPServersDeps, ownerID, serverID, dep string,
) error {
	if ownerID == "" || serverID == "" || dep == "" {
		return apierr.ErrEmptyField
	}
	return grantDepOwned(ctx, deps, ownerID, serverID, dep)
}

// grantDepOwned —— validate the server belongs to the owner, then write the grant
// (idempotent).
func grantDepOwned(
	ctx context.Context, deps MCPServersDeps, ownerID, serverID, dep string,
) error {
	if _, gerr := deps.Servers.GetByID(ctx, ownerID, serverID); gerr != nil {
		return fmt.Errorf("get mcp server: %w", gerr)
	}
	if err := deps.Servers.GrantDep(ctx, ownerID, serverID, dep); err != nil {
		return fmt.Errorf("grant mcp server dep: %w", err)
	}
	return nil
}

// A.3-IAM-5: SetCodeMCPServers / SetCodeMCPServersInput and friends are all gone — mcp
// servers now attach via role_mcp_servers on the Role.
