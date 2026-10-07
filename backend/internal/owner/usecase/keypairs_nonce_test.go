package usecase_test

// keypairs_nonce_test.go —— the replay guard on the owner MCP signature fails closed, and the bound
// form's signed payload carries the request (refactor ledger R6).

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

type brokenNonceStore struct{}

func (brokenNonceStore) Fresh(context.Context, string, time.Duration) (bool, error) {
	return false, errors.New("redis: connection refused")
}

func TestNonceStoreErrorRefusesTheRequest(t *testing.T) {
	t.Parallel()
	err := usecase.NonceStoreErrorRefuses(context.Background(), brokenNonceStore{})
	if !errors.Is(err, entity.ErrKeypairUnauthorized) {
		t.Fatalf("nonce store down: got %v, want ErrKeypairUnauthorized", err)
	}
}

func TestBoundChallengeCarriesTheRequest(t *testing.T) {
	t.Parallel()
	req := &usecase.SignedRequest{Method: "post", Path: "/mcp?x=1", Body: []byte("{}")}
	sum := sha256.Sum256([]byte("{}"))
	want := "standmeet-sigv1\nk\n1\nn\nPOST\n/mcp?x=1\n" + hex.EncodeToString(sum[:])
	if got := usecase.BoundChallenge("2", req); got != want {
		t.Fatalf("bound challenge = %q, want %q", got, want)
	}
	if strings.Contains(usecase.BoundChallenge("", req), "POST") {
		t.Fatal("the unbound form must keep its original payload (older clients sign it)")
	}
}
