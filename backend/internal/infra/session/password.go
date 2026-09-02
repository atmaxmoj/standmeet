// Argon2id password hashing + verification.
//
// Parameters follow the design doc's E.2 recommendation: time=3,
// memory=64 MB, threads=4, keyLen=32.
// Output format: $argon2id$v=19$m=65536,t=3,p=4$<base64-salt>$<base64-hash>
// This is the standard "PHC" string format, also recognized by
// passlib / argon2-cffi and similar libraries.

package session

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	argonTime    uint32 = 3
	argonMemory  uint32 = 64 * 1024 // KiB
	argonThreads uint8  = 4
	argonKeyLen  uint32 = 32
	argonSaltLen        = 16

	// phcFieldCount —— $argon2id$v=...$m=...$salt$hash split by '$' = 6.
	phcFieldCount = 6
)

// ErrPasswordMismatch —— wrong password (doesn't distinguish "user exists
// or not"; that distinction is left to the caller to translate).
var (
	ErrPasswordMismatch = errors.New("password mismatch")
	errMalformedPHC     = errors.New("verify password: malformed phc string")
)

// HashPassword hashes with Argon2id + a random salt, returning a PHC string.
func HashPassword(plaintext string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("read salt: %w", err)
	}
	key := argon2.IDKey([]byte(plaintext), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	encoded := fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	)
	return encoded, nil
}

// VerifyPassword checks a plaintext password against a PHC string using a
// constant-time compare. Returns ErrPasswordMismatch on mismatch (or a
// wrapped parse error).
func VerifyPassword(plaintext, encoded string) error {
	parts := strings.Split(encoded, "$")
	params, err := parsePHC(parts)
	if err != nil {
		return err
	}
	got := argon2.IDKey(
		[]byte(plaintext),
		params.salt,
		params.time, params.memory, params.threads,
		uint32(len(params.want)),
	)
	if subtle.ConstantTimeCompare(params.want, got) != 1 {
		return ErrPasswordMismatch
	}
	return nil
}

type phcParams struct {
	salt    []byte
	want    []byte
	memory  uint32
	time    uint32
	threads uint8
}

// parsePHC splits the 6 fields into structured params. Split into three
// sub-helpers so each function stays at cyclo <= 4 (cyclop's global cap
// is 5).
func parsePHC(parts []string) (phcParams, error) {
	if err := validatePHCFrame(parts); err != nil {
		return phcParams{}, err
	}
	p, err := parsePHCParamLine(parts[3])
	if err != nil {
		return phcParams{}, err
	}
	bytes, err := decodePHCBase64(parts[4], parts[5])
	if err != nil {
		return phcParams{}, err
	}
	p.salt = bytes.salt
	p.want = bytes.want
	return p, nil
}

// phcBytes bundles decodePHCBase64's two []byte returns into a single
// struct, satisfying both the confusing-results and nonamedreturns
// revive rules at once.
type phcBytes struct {
	salt []byte
	want []byte
}

func validatePHCFrame(parts []string) error {
	if len(parts) != phcFieldCount {
		return errMalformedPHC
	}
	if parts[1] != "argon2id" {
		return errMalformedPHC
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return fmt.Errorf("verify password: parse version: %w", err)
	}
	return nil
}

func parsePHCParamLine(line string) (phcParams, error) {
	p := phcParams{}
	if _, err := fmt.Sscanf(line, "m=%d,t=%d,p=%d", &p.memory, &p.time, &p.threads); err != nil {
		return phcParams{}, fmt.Errorf("verify password: parse params: %w", err)
	}
	return p, nil
}

func decodePHCBase64(saltStr, hashStr string) (phcBytes, error) {
	salt, err := base64.RawStdEncoding.DecodeString(saltStr)
	if err != nil {
		return phcBytes{}, fmt.Errorf("verify password: decode salt: %w", err)
	}
	want, err := base64.RawStdEncoding.DecodeString(hashStr)
	if err != nil {
		return phcBytes{}, fmt.Errorf("verify password: decode hash: %w", err)
	}
	return phcBytes{salt: salt, want: want}, nil
}
