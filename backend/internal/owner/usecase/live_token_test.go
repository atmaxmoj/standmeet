package usecase_test

import (
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

const (
	// liveTestEpoch —— a fixed "now" for the token tests.
	liveTestEpoch = 1_800_000_000
	liveKey       = "k"
)

// TestLiveToken —— a token opens its own conversation for 24 h.
func TestLiveToken(t *testing.T) {
	t.Parallel()
	now := time.Unix(liveTestEpoch, 0)
	tok := usecase.NewLiveToken(liveKey, "owner-1", "conv-1", now)
	got, err := usecase.VerifyLiveToken(liveKey, tok, now.Add(time.Hour))
	if err != nil || got.OwnerID != "owner-1" || got.ConversationID != "conv-1" {
		t.Fatalf("valid token: %+v %v", got, err)
	}
}

// TestLiveToken_refused —— a changed byte, another key or a later day opens nothing.
func TestLiveToken_refused(t *testing.T) {
	t.Parallel()
	now := time.Unix(liveTestEpoch, 0)
	tok := usecase.NewLiveToken(liveKey, "owner-1", "conv-1", now)
	bad := []struct {
		at             time.Time
		name, key, tok string
	}{
		{now, "tampered", liveKey, tok[:len(tok)-2] + "aa"},
		{now, "other key", "k2", tok},
		{now.Add(usecase.LiveTokenTTL + time.Minute), "expired", liveKey, tok},
		{now, "malformed", liveKey, "x.y"},
	}
	for _, b := range bad {
		if _, verr := usecase.VerifyLiveToken(b.key, b.tok, b.at); verr == nil {
			t.Errorf("%s: accepted", b.name)
		}
	}
}
