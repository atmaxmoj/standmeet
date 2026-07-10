// api_key.go —— API-key facade usecases (facade-directions.md): mint a key (generate secret, hash,
// persist; return the raw secret ONCE) and resolve a presented secret back to its key row at auth
// time. The raw `smk_…` secret is never stored — only its sha256.

package usecases

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

const (
	apiKeyPrefix      = "smk_"
	apiKeySecretBytes = 32
	apiKeyDisplayStub = 8
)

// ErrAPIKeyLabelRequired / ErrAPIKeyRoleRequired —— mint validation.
var (
	ErrAPIKeyLabelRequired = errors.New("label is required")
	ErrAPIKeyRoleRequired  = errors.New("assumed_role_id is required")
)

// APIKeyStore —— persistence the mint/resolve usecases need (postgres.APIKeyRepo implements it).
type APIKeyStore interface {
	Create(ctx context.Context, in *domain.CreateAPIKeyInput) (domain.APIKey, error)
	GetBySecretHash(ctx context.Context, hash []byte) (domain.APIKey, error)
}

// APIKeyRoleGetter —— validate the assumed role exists + belongs to the owner at mint time.
type APIKeyRoleGetter interface {
	GetByID(ctx context.Context, ownerID, roleID string) (domain.Role, error)
}

// IssueAPIKeyDeps —— dependencies for minting a key.
type IssueAPIKeyDeps struct {
	Keys  APIKeyStore
	Roles APIKeyRoleGetter
}

// IssueAPIKeyInput —— mint request (owner comes from the authenticated session/token).
type IssueAPIKeyInput struct {
	ExpiresAt     *time.Time
	RateLimitRPM  *int32
	MaxBookings   *int32
	OwnerID       string
	AssumedRoleID string
	Label         string
}

// apiKeySecret —— a freshly generated secret. Raw is returned to the owner exactly once; only Hash
// is persisted. (A struct return dodges the same-type multi-results lint.)
type apiKeySecret struct {
	Raw    string
	Prefix string
	Hash   []byte
}

// IssuedAPIKey —— the mint result: the raw secret to show once + the persisted key.
type IssuedAPIKey struct {
	Secret string
	Key    domain.APIKey
}

// IssueAPIKey —— validate the role, generate + hash a secret, persist the key, and return the raw
// secret once. The role must belong to the owner (BOLA guard at mint).
func IssueAPIKey(
	ctx context.Context, deps IssueAPIKeyDeps, in *IssueAPIKeyInput,
) (IssuedAPIKey, error) {
	if err := validateIssueAPIKey(ctx, deps, in); err != nil {
		return IssuedAPIKey{}, err
	}
	secret, serr := generateAPIKeySecret()
	if serr != nil {
		return IssuedAPIKey{}, serr
	}
	key, cerr := deps.Keys.Create(ctx, &domain.CreateAPIKeyInput{
		OwnerID: in.OwnerID, AssumedRoleID: in.AssumedRoleID, Label: in.Label,
		Prefix: secret.Prefix, SecretHash: secret.Hash,
		RateLimitRPM: in.RateLimitRPM, MaxBookings: in.MaxBookings, ExpiresAt: in.ExpiresAt,
	})
	if cerr != nil {
		return IssuedAPIKey{}, fmt.Errorf("create api key: %w", cerr)
	}
	return IssuedAPIKey{Key: key, Secret: secret.Raw}, nil
}

func validateIssueAPIKey(ctx context.Context, deps IssueAPIKeyDeps, in *IssueAPIKeyInput) error {
	if strings.TrimSpace(in.Label) == "" {
		return ErrAPIKeyLabelRequired
	}
	if in.AssumedRoleID == "" {
		return ErrAPIKeyRoleRequired
	}
	if _, err := deps.Roles.GetByID(ctx, in.OwnerID, in.AssumedRoleID); err != nil {
		return fmt.Errorf("assumed role: %w", err)
	}
	return nil
}

// ResolveAPIKey —— auth: hash the presented secret and look up the active key. A malformed or
// unknown secret → ErrAPIKeyNotFound (the middleware answers 401). Constant-time is unnecessary
// here: the lookup is by sha256 of the secret, so timing reveals nothing about a valid secret.
func ResolveAPIKey(
	ctx context.Context, store APIKeyStore, rawSecret string,
) (domain.APIKey, error) {
	if !strings.HasPrefix(rawSecret, apiKeyPrefix) {
		return domain.APIKey{}, domain.ErrAPIKeyNotFound
	}
	sum := sha256.Sum256([]byte(rawSecret))
	key, err := store.GetBySecretHash(ctx, sum[:])
	if err != nil {
		return domain.APIKey{}, fmt.Errorf("resolve api key: %w", err)
	}
	return key, nil
}

func generateAPIKeySecret() (apiKeySecret, error) {
	buf := make([]byte, apiKeySecretBytes)
	if _, err := rand.Read(buf); err != nil {
		return apiKeySecret{}, fmt.Errorf("generate api key secret: %w", err)
	}
	body := base64.RawURLEncoding.EncodeToString(buf)
	raw := apiKeyPrefix + body
	sum := sha256.Sum256([]byte(raw))
	prefix := apiKeyPrefix + body[:apiKeyDisplayStub]
	return apiKeySecret{Raw: raw, Prefix: prefix, Hash: sum[:]}, nil
}
