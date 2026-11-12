// assistant.go —— the cue card, made on the server (assistant.cue): every driver — the desktop
// app, a mock-interview agent — asks here and gets the card the owner's notes and this one
// mechanism decide. The I/O comes in as ports wired at the composition root; this package holds
// the mechanism (deck, rounds, prompt) and the feed.

package cues

import (
	"context"
	"errors"
	"strings"
	"sync"
)

// Role —— the interview's role: its notes' scope, what it is for, the provider it runs on.
// A role ref grants CorpusURIs with no DeniedURIs; a bound code resolves to a Role whose CorpusURIs
// are its assumed role's grant and whose DeniedURIs are what the code takes back (pure subtraction,
// same shape as a visitor read's corpus admission).
type Role struct {
	ID          string
	Name        string
	Description string
	ProviderID  string
	CorpusURIs  []string
	DeniedURIs  []string
}

// ModelRequest —— one card's model call.
type ModelRequest struct {
	System string
	// Code —— the access code this interview is bound to ("" = none). The port reads the code's
	// pinned provider / model (access_codes.provider_id / .model, code beats role) and runs the
	// card on them. Only the final card sets it; the classifier and rewrite stay on the role's
	// fast model.
	Code     string
	Messages []Message
}

// AppOption —— one committed application the owner can bind a screen-assistant session to: its
// access code (the handle the card reads the résumé by) and the job it was sent for, for the start
// screen's picker (assistant.applications).
type AppOption struct {
	Code    string `json:"code"`
	Company string `json:"company"`
	Title   string `json:"title"`
}

// Ports —— what the assistant reads and calls. Role returns ErrNoRole for a ref no role has;
// Notes lists the notes inside globs in corpus order; Version changes whenever any note does.
type Ports struct {
	Role func(ctx context.Context, ownerID, ref string) (Role, error)
	// CodeScope —— the scope a bound access code reads: its assumed role's grant as CorpusURIs and
	// the code's corpus denials as DeniedURIs. ErrCodeNoScope when the code binds no usable scope
	// (invalid id, or another owner's code) — the deck then falls back to the role ref, as before.
	CodeScope func(ctx context.Context, ownerID, code string) (Role, error)
	// Notes lists the notes a scope admits — inside granted and outside denied — in corpus order,
	// the same admission a visitor read goes through. A role ref passes no denied.
	Notes   func(ctx context.Context, ownerID string, granted, denied []string) ([]Note, error)
	Version func(ctx context.Context, ownerID string) (string, error)
	Screen  func(ctx context.Context, ownerID string) (Screen, error)
	// Resume returns the tailored résumé of the application an access code is bound to; ErrNoResume
	// when the code binds no application (a card then behaves as before, not an error).
	Resume func(ctx context.Context, ownerID, code string) (Resume, error)
	// Applications lists the owner's committed applications, newest first, for the start screen's
	// "which application is this interview for" picker.
	Applications func(ctx context.Context, ownerID string) ([]AppOption, error)
	// Model streams the card: onText gets the text so far. It returns the model's name.
	Model func(ctx context.Context, ownerID, providerID string, req ModelRequest,
		onText func(string)) (model, text string, err error)
}

// Errors the tools show as they are.
var (
	ErrNoRole    = errors.New("no such role")
	ErrNoNotes   = errors.New("the role's scope holds no notes")
	ErrBadRound  = errors.New("no such round")
	ErrNoQuery   = errors.New("question is required")
	errModelCall = errors.New("the model call failed")
	// ErrNoResume —— the session's code binds no application; the card goes on without a
	// résumé (not an asked error). The port returns it; callScreen swallows it.
	ErrNoResume = errors.New("no résumé for this application")
	// ErrCodeNoScope —— the bound code resolves to no usable scope (invalid id, or another owner's
	// code); the deck falls back to the role ref. CodeScope returns it; scopeFor swallows it.
	ErrCodeNoScope = errors.New("no scope for this code")
)

// IsAsked —— a failure the caller caused or can act on; its text is safe to show.
func IsAsked(err error) bool {
	for _, e := range []error{ErrNoRole, ErrNoNotes, ErrBadRound, ErrNoQuery, errModelCall} {
		if errors.Is(err, e) {
			return true
		}
	}
	return false
}

// wholeWiki —— the scope without a role.
var wholeWiki = []string{"wiki://**"}

// Assistant —— the feed plus the card mechanism.
type Assistant struct {
	ports Ports
	Feed  *Store
	decks map[string]cachedDeck
	mu    sync.Mutex
}

type cachedDeck struct {
	deck    *Deck
	version string
}

// NewAssistant —— feed is the screen-assistant feed the cards go to.
func NewAssistant(feed *Store, ports Ports) *Assistant {
	return &Assistant{Feed: feed, ports: ports, decks: map[string]cachedDeck{}}
}

type roleDeck struct {
	deck *Deck
	role Role
}

// roleOf —— the role a ref names; the whole wiki for "".
func (a *Assistant) roleOf(ctx context.Context, ownerID, ref string) (Role, error) {
	if ref == "" {
		return Role{CorpusURIs: wholeWiki}, nil
	}
	return a.ports.Role(ctx, ownerID, ref)
}

// scopeFor —— the scope the deck is built in: a bound code's own scope wins (owner wants the card
// scoped to what the application's code can read, not a separately-picked role); a code that binds
// no usable scope falls back to the role ref.
func (a *Assistant) scopeFor(ctx context.Context, ownerID, ref, code string) (Role, error) {
	if code != "" && a.ports.CodeScope != nil {
		r, err := a.ports.CodeScope(ctx, ownerID, code)
		if err == nil {
			return r, nil
		}
		if !errors.Is(err, ErrCodeNoScope) {
			return Role{}, err
		}
	}
	return a.roleOf(ctx, ownerID, ref)
}

// brief —— "<name> — <description>", as the app led the context with it; "" without a role.
func (r *Role) brief() string {
	if r.Description == "" {
		return r.Name
	}
	return r.Name + " — " + r.Description
}

// deckFor —— the scope's deck, rebuilt when the corpus or the scope changed. A bound code scopes it
// to what that code reads; otherwise the role ref does.
func (a *Assistant) deckFor(ctx context.Context, ownerID, ref, code string) (roleDeck, error) {
	role, err := a.scopeFor(ctx, ownerID, ref, code)
	if err != nil {
		return roleDeck{}, err
	}
	version, err := a.ports.Version(ctx, ownerID)
	if err != nil {
		return roleDeck{}, err
	}
	key := ownerID + "\x00" + strings.Join(role.CorpusURIs, "\n") +
		"\x00" + strings.Join(role.DeniedURIs, "\n") + "\x00" + role.brief()
	if deck := a.cached(key, version); deck != nil {
		return roleDeck{deck: deck, role: role}, nil
	}
	notes, err := a.ports.Notes(ctx, ownerID, role.CorpusURIs, role.DeniedURIs)
	if err != nil {
		return roleDeck{}, err
	}
	deck := NewDeck(notes, role.brief())
	a.mu.Lock()
	a.decks[key] = cachedDeck{deck: deck, version: version}
	a.mu.Unlock()
	return roleDeck{deck: deck, role: role}, nil
}

// cached —— the deck built for key at this corpus version, or nil.
// ponytail: one process-wide map, every owner and role; a few hundred notes each.
func (a *Assistant) cached(key, version string) *Deck {
	a.mu.Lock()
	defer a.mu.Unlock()
	if c, ok := a.decks[key]; ok && c.version == version {
		return c.deck
	}
	return nil
}
