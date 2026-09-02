// unseal.go —— unsealing **only happens in this file**.
//
// §1.5: the core only seals, never unseals. The owner fills in a credential on the
// panel → it's encrypted into the DB → from then on the core only ever sees
// ciphertext. When it's needed, it's unsealed once, right here, and what gets handed
// out is **the usable thing itself**, never the key that opens it.
//
// Keeping both unseal sites together makes "does the core actually have any other
// opening" something countable at a glance. The gate
// (infra/scripts/check-core-seals-only.sh) scans backend/internal; this file lives
// under cmd/, the composition root — it isn't inside the core, and there shouldn't
// be a third file like it.
//
// One thing matters about the shape of what gets handed out: **never hand out a
// function that can unseal any owner**. That was the old AI-provider path's mistake —
// the composition root injected a cryptobox.Decrypt closure into the core, and the
// core did its own unsealing. That isn't "the core decrypted once", it's "the core
// is holding a skeleton key".

package main

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

// openAIProviderKey —— unseals the owner's AI provider key.
//
// ownerID is used as AAD: the ciphertext is bound to that owner, so unsealing
// tamper-fails if it's ever moved to another owner's row. Empty ciphertext means the
// owner hasn't configured one; returns an empty string so the resolver takes the
// ErrOwnerProviderUnconfigured path — "not configured" and "failed to unseal" are two
// different things and must not both be reported as an unseal failure.
func openAIProviderKey(ownerID string, enc []byte) (string, error) {
	if len(enc) == 0 {
		return "", nil
	}
	plain, err := cryptobox.Decrypt(enc, []byte(ownerID))
	if err != nil {
		return "", fmt.Errorf("open owner ai key: %w", err)
	}
	return string(plain), nil
}

// mcpServerStore —— the sliver of the repo surface this adapter needs. Narrowed to
// one method on purpose, so that "this does nothing but read one row" holds true at
// the type level.
type mcpServerStore interface {
	GetByID(ctx context.Context, ownerID, serverID string) (marketplace.MCPServerConfig, error)
}

// dialableMCPServers —— translates "the stored shape" into "the shape you can dial":
// the auth header is unsealed right here.
//
// The assembly side (internal/routes/capload) therefore never sees ciphertext and
// never needs to know how to unseal — the DialableMCPServer it receives is directly
// dialable. Same rule as the AI provider key, landing in the same place.
type dialableMCPServers struct {
	repo mcpServerStore
}

func (d *dialableMCPServers) GetByID(
	ctx context.Context, ownerID, serverID string,
) (marketplace.DialableMCPServer, error) {
	cfg, err := d.repo.GetByID(ctx, ownerID, serverID)
	if err != nil {
		return marketplace.DialableMCPServer{}, fmt.Errorf("mcp server lookup: %w", err)
	}
	header, herr := openMCPAuthHeader(&cfg)
	if herr != nil {
		return marketplace.DialableMCPServer{}, herr
	}
	return marketplace.DialableMCPServer{
		ID: cfg.ID, OwnerID: cfg.OwnerID, Name: cfg.Name, URL: cfg.URL,
		AuthHeader: header, GrantedDeps: cfg.GrantedDeps,
	}, nil
}

// openMCPAuthHeader —— unseals that server's auth header. No header configured means
// that server doesn't require auth; returns an empty header (not an error): **"no
// auth needed" and "failed to unseal" are two different things** — conflate them and
// an undefended server gets reported as a credential failure.
func openMCPAuthHeader(cfg *marketplace.MCPServerConfig) (marketplace.MCPAuthHeader, error) {
	if cfg.AuthHeaderName == "" || len(cfg.AuthHeaderValueEnc) == 0 {
		return marketplace.MCPAuthHeader{}, nil
	}
	plain, err := cryptobox.Decrypt(cfg.AuthHeaderValueEnc, []byte(cfg.OwnerID))
	if err != nil {
		return marketplace.MCPAuthHeader{}, fmt.Errorf("open mcp auth header: %w", err)
	}
	return marketplace.MCPAuthHeader{Name: cfg.AuthHeaderName, Value: string(plain)}, nil
}
