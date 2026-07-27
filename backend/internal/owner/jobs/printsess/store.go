// Package printsess —— short-lived Redis-backed stash for gotenberg-bound
// resume render payloads.
//
// Flow at applications.commit time:
//  1. usecase computes (application, qrURL)
//  2. PDFRenderer adapter calls Stash(payload) → token
//  3. Adapter builds print URL: <PRINT_BASE_URL>/print/application/<id>?t=<token>
//  4. Adapter calls gotenberg.Client.RenderURL(printURL)
//  5. gotenberg fetches the URL; Next.js print page calls
//     `/internal/print-session/<token>` to Take() the payload (one-shot,
//     Redis TTL 60s) and renders the canonical <ResumePage/> twice.
//
// Why a Redis stash and not just URL-encoded payload bytes: keeps the
// URL short, deterministic, and lets us evolve the wire shape without
// touching gotenberg or the Chromium URL-length limit.
package printsess

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/redis/go-redis/v9"
)

const (
	defaultTTL   = 60 * time.Second
	tokenBytes   = 18 // base64url → 24 chars, plenty against guessing
	keyPrefix    = "printsess:"
	payloadMagic = 1 // JSON shape version
)

// ErrSessionMiss —— token unknown, expired, or already taken.
var ErrSessionMiss = errors.New("print session not found")

// Payload —— what the print page renders. Subset of jobsmodel.Application
// — only the fields the React component needs (resume_content +
// job_snapshot + identifiers + qr_url). Trimming avoids leaking
// SubmittedAt / Status which are unrelated to print.
type Payload struct {
	ApplicationID string                  `json:"application_id"`
	QRURL         string                  `json:"qr_url"`
	ResumeContent jobsmodel.ResumeContent `json:"resume_content"`
	JobSnapshot   jobsmodel.FetchedJob    `json:"job_snapshot"`
	Version       int                     `json:"v"`
}

// Store —— Redis-backed one-shot stash.
type Store struct {
	rdb *redis.Client
	ttl time.Duration
}

// New —— constructs Store. ttl≤0 → defaultTTL.
func New(rdb *redis.Client, ttl time.Duration) *Store {
	if ttl <= 0 {
		ttl = defaultTTL
	}
	return &Store{rdb: rdb, ttl: ttl}
}

// Stash —— write payload under a fresh token; returns the token.
func (s *Store) Stash(ctx context.Context, p *Payload) (string, error) {
	token, err := newToken()
	if err != nil {
		return "", err
	}
	p.Version = payloadMagic
	bytes, merr := json.Marshal(p)
	if merr != nil {
		return "", fmt.Errorf("marshal print payload: %w", merr)
	}
	if serr := s.rdb.Set(ctx, key(token), bytes, s.ttl).Err(); serr != nil {
		return "", fmt.Errorf("redis set print session: %w", serr)
	}
	return token, nil
}

// Take —— read and delete the payload in one atomic-ish step
// (GET + DEL). Missing key → ErrSessionMiss.
func (s *Store) Take(ctx context.Context, token string) (*Payload, error) {
	if token == "" {
		return nil, ErrSessionMiss
	}
	raw, err := s.rdb.GetDel(ctx, key(token)).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, ErrSessionMiss
		}
		return nil, fmt.Errorf("redis getdel print session: %w", err)
	}
	var p Payload
	if uerr := json.Unmarshal(raw, &p); uerr != nil {
		return nil, fmt.Errorf("decode print payload: %w", uerr)
	}
	return &p, nil
}

func key(token string) string { return keyPrefix + token }

func newToken() (string, error) {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("rand read: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
