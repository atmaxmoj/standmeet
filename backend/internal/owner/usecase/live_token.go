// live_token.go —— the credential in a live-transcript link (docs/design/notify-rules-and-live-
// transcript.md, *The live transcript*). The owner opens it from a phone's IM app, where there is
// no admin session, so the link itself is the credential: scoped to one conversation, valid 24 h.
//
// Derived, not stored — the preview token's shape and signature (previewSig), with the signed
// "slug" being `live:<conversation id>`. A slug never contains ':', so a preview token can never
// pass as a live token or the other way round.

package usecase

import (
	"crypto/hmac"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// LiveTokenTTL —— how long a live-transcript link works.
const LiveTokenTTL = 24 * time.Hour

const liveTokenParts = 4

// NewLiveToken —— `<owner b64>.<conversation id>.<exp>.<sig>`, URL-safe.
func NewLiveToken(key, ownerID, conversationID string, now time.Time) string {
	exp := strconv.FormatInt(now.Add(LiveTokenTTL).Unix(), decimalBase)
	return fmt.Sprintf("%s.%s.%s.%s",
		base64.RawURLEncoding.EncodeToString([]byte(ownerID)), conversationID, exp,
		previewSig(key, ownerID, "live:"+conversationID, exp))
}

// VerifyLiveToken —— the owner and conversation a token opens. Tampered, expired and malformed
// all read as ErrPreviewTokenInvalid.
func VerifyLiveToken(key, token string, now time.Time) (LiveTarget, error) {
	parts := strings.Split(token, ".")
	if len(parts) != liveTokenParts {
		return LiveTarget{}, ErrPreviewTokenInvalid
	}
	raw, derr := base64.RawURLEncoding.DecodeString(parts[0])
	if derr != nil {
		return LiveTarget{}, ErrPreviewTokenInvalid
	}
	t, exp := LiveTarget{OwnerID: string(raw), ConversationID: parts[1]}, parts[2]
	sig := previewSig(key, t.OwnerID, "live:"+t.ConversationID, exp)
	if !hmac.Equal([]byte(sig), []byte(parts[3])) {
		return LiveTarget{}, ErrPreviewTokenInvalid
	}
	return t, expiredOr(exp, now)
}

// LiveTarget —— the conversation a live link opens, and whose it is.
type LiveTarget struct {
	OwnerID        string
	ConversationID string
}
