// Package credmgr is the credential-manager: the block through which a non-native secret
// (a Telegram bot token, an SMTP password, an API key) is stored — encrypted at rest, in the
// db block's storage, keyed by (owner, name). It is the design's replacement for the bespoke
// per-supplier vault: "credentials are not a manifest field; the credential-manager is a block
// that requires db" (docs/design/plugin/everything-is-a-block.md rule 3).
//
// It runs in-process, in the host, because it holds the instance secret to encrypt with — a
// sandboxed block never sees that secret. What it persists is ordinary data in the
// credential-manager block's own blockstore schema; the secret bytes are AES-GCM sealed
// (cryptobox), bound to the owner id as AAD, so a row lifted into another owner's context will
// not decrypt. A non-native secret gets no special base treatment beyond this.
package credmgr

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockstore"
)

// ErrNotFound — no secret stored under this (owner, name). A sentinel rather than a third
// return value, so Get stays a two-result function.
var ErrNotFound = errors.New("credmgr: no such secret")

// BlockID — the credential-manager block's id, and therefore its blockstore schema
// (mcp_credential_manager). The host provisions this schema at boot; credmgr never names a
// schema of its own, it uses the db block the way any storing block does.
const BlockID = "credential-manager"

// collection — the one collection credmgr keeps in its schema. Secrets are the only thing it
// stores; a single collection keeps the (owner, name) filter simple.
const collection = "secrets"

// Store — the credential-manager, over the db block's storage.
type Store struct {
	bs *blockstore.Store
}

// New — construct over the shared blockstore.
func New(bs *blockstore.Store) *Store { return &Store{bs: bs} }

// secretDoc — one stored secret. owner + name are the lookup key (plaintext, for filtering);
// blob is the base64 of the AES-GCM sealed value. The plaintext value is never stored.
type secretDoc struct {
	Owner string `json:"owner"`
	Name  string `json:"name"`
	Blob  string `json:"blob"`
}

// encode — seal a plaintext secret for this owner. Pure (no DB): cryptobox binds the owner id
// as AAD, so the ciphertext only decrypts back under the same owner.
func encode(owner, plaintext string) (string, error) {
	sealed, err := cryptobox.Encrypt([]byte(plaintext), []byte(owner))
	if err != nil {
		return "", fmt.Errorf("credmgr seal: %w", err)
	}
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// decode — open a sealed secret for this owner. Fails (ErrTampered) if the blob was sealed
// under a different owner or altered.
func decode(owner, blob string) (string, error) {
	sealed, err := base64.StdEncoding.DecodeString(blob)
	if err != nil {
		return "", fmt.Errorf("credmgr decode blob: %w", err)
	}
	plain, derr := cryptobox.Decrypt(sealed, []byte(owner))
	if derr != nil {
		return "", fmt.Errorf("credmgr open: %w", derr)
	}
	return string(plain), nil
}

// filter — the (owner, name) containment filter for one secret.
func filter(owner, name string) (json.RawMessage, error) {
	b, err := json.Marshal(map[string]string{"owner": owner, "name": name})
	if err != nil {
		return nil, fmt.Errorf("credmgr filter: %w", err)
	}
	return b, nil
}

// Set — store (or replace) a named secret for an owner. Upsert: an existing (owner, name) row
// is deleted before the new one is inserted, so a re-set changes the value in place rather than
// piling up rows.
func (s *Store) Set(ctx context.Context, owner, name, value string) error {
	blob, err := encode(owner, value)
	if err != nil {
		return err
	}
	f, ferr := filter(owner, name)
	if ferr != nil {
		return ferr
	}
	if _, derr := s.bs.Delete(ctx, blockstore.KindMCP, BlockID, collection, f); derr != nil {
		return fmt.Errorf("credmgr replace: %w", derr)
	}
	return s.insert(ctx, owner, name, blob)
}

// Get — read back a named secret for an owner. Returns ErrNotFound when there is no such
// secret. Internal use (the consuming supplier), never an owner-facing plaintext egress.
func (s *Store) Get(ctx context.Context, owner, name string) (string, error) {
	f, ferr := filter(owner, name)
	if ferr != nil {
		return "", ferr
	}
	docs, err := s.bs.Query(ctx, blockstore.KindMCP, BlockID, collection, f)
	if err != nil {
		return "", fmt.Errorf("credmgr read: %w", err)
	}
	if len(docs) == 0 {
		return "", ErrNotFound
	}
	var d secretDoc
	if uerr := json.Unmarshal(docs[0], &d); uerr != nil {
		return "", fmt.Errorf("credmgr unmarshal: %w", uerr)
	}
	return decode(owner, d.Blob)
}

// insert — marshal and store one secret doc. Split from Set so Set stays under the branch cap.
func (s *Store) insert(ctx context.Context, owner, name, blob string) error {
	doc, merr := json.Marshal(secretDoc{Owner: owner, Name: name, Blob: blob})
	if merr != nil {
		return fmt.Errorf("credmgr marshal: %w", merr)
	}
	if _, ierr := s.bs.Insert(ctx, blockstore.KindMCP, BlockID, collection, doc); ierr != nil {
		return fmt.Errorf("credmgr store: %w", ierr)
	}
	return nil
}
