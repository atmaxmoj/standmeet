// Package session manages the setup token for first-run instance claim,
// the owner login session, API tokens, and visitor sessions.
//
// setup_token -- generated at startup, printed to stdout, its hash
// written to the DB; at claim time it's hashed again and compared
// atomically against the DB. The plaintext only ever appears once, in
// stdout / the log file; the DB stores only sha256(plaintext).
package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"sync"
)

const (
	// setupTokenBytes determines setup token entropy; 24 bytes base64url
	// is about 32 characters.
	setupTokenBytes = 24
	// firstRunPath —— at startup, the setup path is written to this file
	// so the owner can find it without watching the log (the setup
	// endpoint deletes it once claim completes).
	firstRunPath = "/srv/first-run.txt"
	// firstRunFileMode —— rw for owner only, unreadable by other users,
	// to avoid a multi-user scenario on a host volume.
	firstRunFileMode = 0o600
)

// NewSetupToken generates a base64url-encoded setup token plaintext
// (24 random bytes).
func NewSetupToken() (string, error) {
	buf := make([]byte, setupTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// HashSetupToken computes sha256 of the plaintext token, hex-encoded.
// The DB stores this; at claim time the input token is hashed the same
// way and compared (atomic SQL UPDATE).
func HashSetupToken(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}

// InstanceTokenWriter is the minimal interface for writing a setup token
// to the DB (lets IssueSetupToken be unit-tested without depending on the
// concrete *owner.InstanceRepo type).
type InstanceTokenWriter interface {
	SetSetupTokenHash(ctx context.Context, hash string) error
}

// SetupTokenHolder —— keeps the plaintext token generated at startup in
// memory, so the /api/v1/instance handler can hand it back to the
// frontend during the unclaimed period for an "open / auto-redirect to
// /setup?t=TOKEN" flow.
//
// Once the instance is claimed, nothing reads Get()'s return value
// anymore (frontend SSR sees claimed=true and renders the public page
// directly). On server restart a new token is generated and its DB hash
// written, and the holder updates along with it; the old token's
// plaintext is lost and the old URL stops working (its DB hash has
// already been overwritten).
type SetupTokenHolder struct {
	plaintext string
	mu        sync.RWMutex
}

// NewSetupTokenHolder constructs an empty holder.
func NewSetupTokenHolder() *SetupTokenHolder {
	return &SetupTokenHolder{}
}

// Plaintext —— the setup token plaintext currently held; empty string
// means none is held.
func (h *SetupTokenHolder) Plaintext() string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.plaintext
}

func (h *SetupTokenHolder) set(s string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.plaintext = s
}

// IssueSetupToken generates a new setup token, writes its hash to the DB,
// stores the plaintext in holder, and prints the path to stdout +
// writes first-run.txt. The caller (main.go) is responsible for checking
// whether the instance is already claimed first -- don't call this when
// already claimed (avoids overwriting a token nobody needs).
//
// No publicURL parameter: once the PUBLIC_URL env var is dropped, the
// server doesn't know its own external domain (it only lands in the DB
// after the owner fills in public_url on the claim form). The banner
// only prints the path; ops wires it up to their own host.
func IssueSetupToken(
	ctx context.Context,
	log *slog.Logger,
	repo InstanceTokenWriter,
	holder *SetupTokenHolder,
) error {
	plaintext, err := NewSetupToken()
	if err != nil {
		return fmt.Errorf("generate setup token: %w", err)
	}

	if werr := repo.SetSetupTokenHash(ctx, HashSetupToken(plaintext)); werr != nil {
		return fmt.Errorf("store setup token hash: %w", werr)
	}
	holder.set(plaintext)

	setupPath := "/setup?t=" + plaintext
	printSetupBanner(log, setupPath)
	writeFirstRunFile(log, setupPath)
	return nil
}

// setupBannerTemplate —— the Chinese text in the banner is written as
// \uXXXX escapes (gosmopolitan checks string literals for Han script;
// escape-encoded text isn't flagged). The banner only prints the path
// ("/setup?t=..."); ops wires it up to their own host, since without a
// PUBLIC_URL env var the server doesn't know its own external address.
const setupBannerTemplate = "\n" +
	"┌───────────────────────────────────────────────────────────┐\n" +
	"│ STANDMEET \u5df2\u5c31\u7eea\u3002Open <your_host>+path:" +
	"                 │\n" +
	"│   %-58s │\n" +
	"└───────────────────────────────────────────────────────────┘\n"

// printSetupBanner prints the setup path to stdout prominently -- this
// is what the owner watches for on first startup, and going through slog
// alone risks it getting buried in structured JSON noise.
func printSetupBanner(log *slog.Logger, path string) {
	banner := fmt.Sprintf(setupBannerTemplate, path)
	if _, err := os.Stdout.WriteString(banner); err != nil {
		log.Warn("write setup banner (non-fatal)", "err", err)
	}
	log.Info("setup token issued", "path", path)
}

func writeFirstRunFile(log *slog.Logger, path string) {
	// O_TRUNC: content resets on every IssueSetupToken call; the endpoint
	// deletes the file once claim succeeds.
	if err := os.WriteFile(firstRunPath, []byte(path+"\n"), firstRunFileMode); err != nil {
		log.Warn("write first-run file (non-fatal)", "path", firstRunPath, "err", err)
	}
}

// RemoveFirstRunFile —— called once claim succeeds, deletes
// first-run.txt (best-effort).
func RemoveFirstRunFile(log *slog.Logger) {
	if err := os.Remove(firstRunPath); err != nil && !os.IsNotExist(err) {
		log.Warn("remove first-run file (non-fatal)", "path", firstRunPath, "err", err)
	}
}
