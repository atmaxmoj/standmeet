package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"math/big"
	"time"
)

// Email-OTP verification for the outbound mail connector. We don't trust "the
// SMTP server accepted a send" as proof the owner controls the inbox — we mail a
// 6-digit code to from_address and require it back. The code is stored only as a
// sha256 hash; it expires, and after MailOTPMaxAttempts wrong tries it's voided
// (the owner must request a fresh one).
const (
	MailOTPDigits      = 6
	MailOTPTTL         = 10 * time.Minute
	MailOTPMaxAttempts = 10
)

const mailOTPMax = 1_000_000 // exclusive upper bound for a 6-digit code

// GenerateMailOTP —— a cryptographically-random 6-digit code. Callers persist
// only HashMailOTP(code); the plaintext is emailed, never stored.
func GenerateMailOTP() (string, error) {
	n, rerr := rand.Int(rand.Reader, big.NewInt(mailOTPMax))
	if rerr != nil {
		return "", fmt.Errorf("mail otp: random: %w", rerr)
	}
	return fmt.Sprintf("%0*d", MailOTPDigits, n.Int64()), nil
}

// HashMailOTP —— sha256 of the code; persisted + compared constant-time.
func HashMailOTP(code string) []byte {
	sum := sha256.Sum256([]byte(code))
	return sum[:]
}

// OTPActive —— there is a pending OTP that hasn't expired yet.
func (c *MailConnector) OTPActive(now time.Time) bool {
	return len(c.OTPHash) > 0 && c.OTPExpiresAt != nil && now.Before(*c.OTPExpiresAt)
}

// OTPExhausted —— too many wrong attempts; the pending OTP must be voided.
func (c *MailConnector) OTPExhausted() bool {
	return c.OTPAttempts >= MailOTPMaxAttempts
}

// OTPMatches —— constant-time compare of a submitted code against the stored hash.
func (c *MailConnector) OTPMatches(code string) bool {
	return subtle.ConstantTimeCompare(c.OTPHash, HashMailOTP(code)) == 1
}
