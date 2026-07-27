// api_key.go —— API-key facade usecases (facade-directions.md): mint a key (generate secret, hash,
// persist; return the raw secret ONCE) and resolve a presented secret back to its key row at auth
// time. The raw `smk_…` secret is never stored — only its sha256.

package usecase

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
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

// APIKeyStore —— the mint side (APIKeyRepo implements it).
type APIKeyStore interface {
	Create(
		ctx context.Context, in *entity.CreateAPIKeyInput,
	) (entity.APIKey, error)
}

// APIKeyRoleGetter —— validate the assumed role exists + belongs to the owner at mint time.
type APIKeyRoleGetter interface {
	GetByID(ctx context.Context, ownerID, roleID string) (entity.Role, error)
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
	Key    entity.APIKey
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
	key, cerr := deps.Keys.Create(ctx, &entity.CreateAPIKeyInput{
		OwnerID: in.OwnerID, AssumedRoleID: in.AssumedRoleID, Label: in.Label,
		Prefix: secret.Prefix, SecretHash: secret.Hash,
		RateLimitRPM: in.RateLimitRPM, ExpiresAt: in.ExpiresAt,
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
