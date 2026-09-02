// service.go — connector admin orchestration (save credentials / connect / oauth callback /
// activate / disconnect). Pulls this business logic out of the routes layer (route handlers
// enforce cyclo ≤3 and only handle presentation); this runs under a cyclop ≤5 business budget.
// The OAuth dance reuses OAuthEndpoints (provider-agnostic).

package connector

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	oauthStateTTL   = 10 * time.Minute
	oauthStateBytes = 16
)

// Sentinel errors are in errors.go.

// Deps — service dependencies (injected by the composition root). Manifests = built-in
// connectors (id→category/kind/spec).
type Deps struct {
	Repo      *Repo
	Owners    OwnerLookup
	Redis     *redis.Client
	HTTP      *http.Client
	Verifier  ConnectionVerifier
	Installer Installer
	Manifests []Manifest
}

// Service — connector admin orchestration.
type Service struct{ d *Deps }

// New — construct (takes the assembly-time dependency bundle by pointer, doesn't copy the
// large struct by value).
func New(d *Deps) *Service { return &Service{d: d} }

// Manifest — looks up a built-in manifest by id.
func (s *Service) Manifest(id string) *Manifest {
	for i := range s.d.Manifests {
		if s.d.Manifests[i].ID == id {
			return &s.d.Manifests[i]
		}
	}
	return nil
}

// DeclaredOwnerOpIDs — the owner-operation ids each connector **declares for itself in its
// manifest** (e.g. "connectors.mail_test_send").
//
// The admin routing layer derives its own routes from this list, so that layer never hardcodes
// a category name: adding a connector that declares an operation gets the route automatically.
// The list belongs to the connector axis — whoever declares it knows about it.
//
// Scans only built-in manifests, **which is not an omission**: an owner-op's only source is the
// `owner_ops:` block in `connectors/<id>/manifest.yaml` (see connectors/loader.go). An
// owner-**uploaded** connector is spec + binding, exposing agent tools, with no mechanism to
// declare an owner-op — so there's nothing here it could be missing.
func (s *Service) DeclaredOwnerOpIDs() []string {
	out := make([]string, 0, len(s.d.Manifests))
	for i := range s.d.Manifests {
		for _, op := range s.d.Manifests[i].OwnerOps {
			out = append(out, op.Name)
		}
	}
	return out
}

// OwnerOpsOf — the owner operations one built-in connector **declares for itself**. Unknown id
// / nothing declared → empty.
//
// Division of labor with DeclaredOwnerOpIDs: that one is a flat list, used for wiring routes
// (route wiring doesn't care who declared what); this one is grouped by connector, used by the
// **surface** — an action needs to render on the card declaring it, otherwise the surface would
// have to know "the mail card has a send button" by itself, and a category name leaks back into
// the generic layer — exactly what owner_op.go exists to prevent.
func (s *Service) OwnerOpsOf(id string) []OwnerOp {
	m := s.Manifest(id)
	if m == nil {
		return []OwnerOp{}
	}
	return m.OwnerOps
}

// Catalog — every built-in connector (manifests assembled externally at boot), for the admin UI
// to render connectable built-in cards. Each card's status/credential form is fetched
// separately via /{id}/{status,credential-form}. Not part of List (List lists only what the
// owner already created; mixing built-ins in would be misgrabbed by reuse-by-category callers).
// Reuses Connection, no new public type added.
func (s *Service) Catalog() []Connection {
	out := make([]Connection, 0, len(s.d.Manifests))
	for i := range s.d.Manifests {
		m := &s.d.Manifests[i]
		out = append(out, Connection{
			ConnectorID: m.ID, Category: m.Category, Kind: m.Kind,
		})
	}
	return out
}

// ConnectResult — the result of Connect: oauth → AuthURL+State; non-dance → Connected=true.
type ConnectResult struct {
	AuthURL string
	State   string
	// Error — owner-friendly reason for a failed connection test (protocol verify failure:
	// connect/tls/auth).
	Error     string
	Connected bool
}

// Connect — oauth2 → starts the dance (builds the consent-page URL + stores state in Redis);
// non-dance → marks connected.
func (s *Service) Connect(ctx context.Context, ownerID, id string) (ConnectResult, error) {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return ConnectResult{}, merr
	}
	if m.Kind == "protocol" { // caldav/smtp, no spec: connect = connection test, no dance
		return s.verifyAndConnect(ctx, ownerID, id)
	}
	return s.connectOpenAPI(ctx, ownerID, id, m)
}

// Callback — validates state → exchanges code for a token → stores it. Returns that owner
// (carried in state).
func (s *Service) Callback(ctx context.Context, id, code, state string) error {
	dance, cerr := s.consumeState(ctx, state, id)
	if cerr != nil {
		// a Redis fault → reported, never masked as "bad state"
		return fmt.Errorf("oauth callback: %w", cerr)
	}
	if dance.OwnerID == "" {
		return ErrInvalidOAuthState // state empty/expired/mismatched (expected state)
	}
	if err := s.exchangeAndStore(ctx, &dance, code); err != nil {
		return err
	}
	return s.ensureActive(ctx, dance.OwnerID, id)
}

// Activate — claims the category slot. Disconnect — soft disconnect. Status / List — reads.
func (s *Service) Activate(ctx context.Context, ownerID, id string) error {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return merr
	}
	if err := s.d.Repo.SetActive(ctx, ownerID, id, m.Category); err != nil {
		return fmt.Errorf("activate connector: %w", err)
	}
	return nil
}

// Disconnect — soft disconnect (wipes token + connected + active, keeps credentials). If what
// was disconnected was active and the same category has another connected candidate →
// auto-promote it to active (§1 rule#6 fallback, no re-gating); no candidate → slot goes empty
// → re-gated.
func (s *Service) Disconnect(ctx context.Context, ownerID, id string) error {
	m, merr := s.manifestFor(ctx, ownerID, id)
	if merr != nil {
		return merr
	}
	if err := s.d.Repo.ClearTokens(ctx, ownerID, id); err != nil {
		return fmt.Errorf("disconnect connector: %w", err)
	}
	return s.promoteFallback(ctx, ownerID, m.Category)
}

// List — the connectors an owner has configured.
func (s *Service) List(ctx context.Context, ownerID string,
) ([]Connection, error) {
	conns, err := s.d.Repo.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list connectors: %w", err)
	}
	return conns, nil
}

// Status — one connector's status.
func (s *Service) Status(
	ctx context.Context, ownerID, id string,
) (Connection, error) {
	conn, err := s.d.Repo.Get(ctx, ownerID, id)
	if err != nil {
		return conn, fmt.Errorf("connector status: %w", err)
	}
	conn.ConnectorID = id
	return conn, nil
}

// manifestFor — resolve the manifest for an id: built-in (embedded) takes priority, otherwise
// an uploaded connector (spec/binding archived in the DB). Neither → ErrNotFound.
func (s *Service) manifestFor(
	ctx context.Context, ownerID, id string,
) (*Manifest, error) {
	if m := s.Manifest(id); m != nil {
		return m, nil
	}
	um, err := s.d.Repo.GetManifest(ctx, ownerID, id)
	if err != nil {
		return nil, fmt.Errorf("load uploaded manifest: %w", err)
	}
	// Empty spec and not protocol = not an owner-created connector (no row / built-in). A
	// protocol connector's spec is empty by nature.
	if len(um.Spec) == 0 && um.Kind != "protocol" {
		return nil, ErrNotFound
	}
	return &Manifest{
		ID: id, Kind: um.Kind, Category: um.Category, Protocol: um.Protocol,
		AuthScheme: um.AuthScheme, Spec: um.Spec, Binding: um.Binding,
	}, nil
}

// verifyAndConnect — non-dance: run a connection test first (protocol connectors have one; a
// no-op for others) → mark connected only after it passes.
// connectOpenAPI — connect for openapi connectors: oauth2 → dance; non-oauth
// (apikey/bearer/basic) → save-and-use; declared oauth2 but misconfigured (missing
// authorizationCode flow, etc.) → surface the error, never silently fall through to the
// non-dance path (otherwise markConnected would run with no token).
func (s *Service) connectOpenAPI(
	ctx context.Context, ownerID, id string, m *Manifest,
) (ConnectResult, error) {
	ep, err := OAuthEndpointsFor(m, m.AuthScheme)
	switch {
	case errors.Is(err, ErrNotDanceScheme):
		return s.verifyAndConnect(ctx, ownerID, id)
	case err != nil:
		return ConnectResult{}, fmt.Errorf("connect oauth setup: %w", err)
	default:
		return s.initDance(ctx, ownerID, id, ep)
	}
}

func (s *Service) verifyAndConnect(ctx context.Context, ownerID, id string) (ConnectResult, error) {
	if s.d.Verifier != nil {
		if verr := s.d.Verifier.VerifyConnector(ctx, id, ownerID); verr != nil {
			return ConnectResult{Connected: false, Error: verifyReason(verr)}, nil
		}
	}
	return s.markConnected(ctx, ownerID, id)
}

// noCredentialsReason — the reason shown to the owner when Connect is clicked before any
// credentials were ever saved. States what to do next, not the internal why (there's no row).
const noCredentialsReason = "fill in this connector's credentials above, then connect"

// verifyReason — an owner-friendly reason for a failed connection test (categorized
// connect/tls/auth; unrecognized → generic).
func verifyReason(err error) string {
	if r := FriendlyVerifyError(err); r != "" {
		return r
	}
	return "the connection test failed — check the host, port, and credentials"
}

// markConnected — mark connected. **If the write didn't land, say so.**
//
// The UPDATE below only updates an existing row, and the row is created by the "save
// credentials" step. When the owner clicks Connect having filled in nothing, there's no row —
// this used to return connected:true anyway, the card would flip green while the DB had
// nothing, and a refresh would show it "disconnected itself". Now the repo reports 0 rows as
// ErrNoConnection, and this translates that into a next step the owner can understand (go fill
// in the form), the same shape as a failed connection test: 200 + connected:false + one plain
// sentence.
func (s *Service) markConnected(ctx context.Context, ownerID, id string) (ConnectResult, error) {
	if err := s.d.Repo.MarkConnected(ctx, ownerID, id); err != nil {
		if errors.Is(err, ErrNoConnection) {
			return ConnectResult{Connected: false, Error: noCredentialsReason}, nil
		}
		return ConnectResult{}, fmt.Errorf("mark connected: %w", err)
	}
	if err := s.ensureActive(ctx, ownerID, id); err != nil {
		return ConnectResult{}, err
	}
	return ConnectResult{Connected: true}, nil
}

// ensureActive — this category has no active connector yet → the one that just connected
// claims the slot (first connection wins; if there's already an active one, it isn't grabbed —
// switching goes through explicit activate). §9: only one active connector per category at a
// time.
func (s *Service) ensureActive(ctx context.Context, ownerID, id string) error {
	category, err := s.activateCategory(ctx, ownerID, id)
	if err != nil {
		return err
	}
	if category == "" {
		return nil // category couldn't be determined (no manifest) → silently skip auto-activate
	}
	return s.claimSlotIfFree(ctx, ownerID, id, category)
}

// activateCategory — resolve this connector's category for auto-activation. An empty category =
// no manifest (ErrNotFound), a skip signal; a real error (DB, etc.) → reported.
func (s *Service) activateCategory(ctx context.Context, ownerID, id string) (string, error) {
	m, merr := s.manifestFor(ctx, ownerID, id)
	switch {
	case merr == nil:
		return m.Category, nil
	case errors.Is(merr, ErrNotFound):
		return "", nil
	default:
		return "", fmt.Errorf("manifest for auto-activate: %w", merr)
	}
}

// claimSlotIfFree — this category's slot has no active connector yet → claim it (first
// connection wins); if there's already one, it isn't grabbed.
func (s *Service) claimSlotIfFree(ctx context.Context, ownerID, id, category string) error {
	conns, err := s.d.Repo.ListByCategory(ctx, ownerID, category)
	if err != nil {
		return fmt.Errorf("list category for auto-activate: %w", err)
	}
	if hasActive(conns) {
		return nil
	}
	if serr := s.d.Repo.SetActive(ctx, ownerID, id, category); serr != nil {
		return fmt.Errorf("auto-activate: %w", serr)
	}
	return nil
}

func hasActive(conns []Connection) bool {
	for i := range conns {
		if conns[i].Active {
			return true
		}
	}
	return false
}

// initDance / openDance are in svc_oauth.go — the dance's internal pieces all live there.
