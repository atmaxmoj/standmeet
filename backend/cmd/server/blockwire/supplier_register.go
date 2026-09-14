// supplier_register.go —— #155 composition root: wires supplier machinery into the running
// system. Boot assembles built-in manifests into the supplier table and declares the seams
// they supply; the credentials repo satisfies ConnectionStore / SMTPVault / the opaque block
// cred vault / SeamStore through the adapters in supplier_vaults.go (decryption inside the repo).

package blockwire

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/infra/egress"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
	"github.com/atmaxmoj/standmeet/internal/routes/blockload"
)

// supplierEgressAllow —— outbound SSRF allowlist (SUPPLIER_EGRESS_ALLOW: comma-separated
// hostnames; e2e allows external-mock through, prod leaves it empty = blocks internal network).
func supplierEgressAllow() egress.Allow {
	return egress.NewAllow(strings.Split(os.Getenv("SUPPLIER_EGRESS_ALLOW"), ","))
}

// supplierEgressClient —— SSRF-guarded outbound client (allowed host passes, else blocked).
func supplierEgressClient() *http.Client {
	return supplierEgressAllow().GuardedHTTPClient()
}

// EnsureBlockDispatch —— stands up the supplier table and the dispatcher over it.
//
// The shrinkage is the point: this used to build a Hub, then a Slots wrapping that Hub,
// then set a logger on the Slots — three objects for "hold the assembled blocks and answer
// which one is active". It is now a map plus a lookup function, and the dispatcher is built
// from the function rather than from a registry.
//
// Idempotent: it runs before anything that captures the dispatcher, and a second call
// must not hand out a second, empty table.
func EnsureBlockDispatch(d *deps.Runtime) {
	if d.BlockDispatch != nil {
		return
	}
	// The door owns the holder's construction (allocate + wire the by-id diag path + logger); the
	// composition root only supplies the seam store it reads and the logger. One reference chain,
	// facade→core (everything-is-a-block.md rule 2): the supplier dispatch is no longer allocated
	// outside the door.
	d.BlockSuppliers, d.BlockDispatch = blockload.NewSupplierDispatch(
		seamStoreAdapter{repo: d.Credentials}, d.Log)
}

// DiscoverSeamProviders —— boot: assemble every supplying block into the table, then RETURN the
// seam providers they supply (the caller registers them through the one door — no direct reach into
// the core registry from the composition root, everything-is-a-block.md rule 2).
//
// The seam names come from the manifests. They used to be two string literals here — one
// per-op provider named "calendar" and one plain provider named "smtp", each with a typed
// accessor — which is why adding a seam meant editing the composition root, and why `mail.send`
// ended up declaring `requires: [smtp]`: "smtp" was not any manifest's name, it was that line. A
// loop over `provides` cannot produce that mistake, because there is nowhere left to write a name
// down.
func DiscoverSeamProviders(
	ctx context.Context, d *deps.Runtime,
) ([]registry.DepProvider, error) {
	EnsureBlockDispatch(d)
	adeps := newAssembleDeps(d.Credentials)
	// Iterate the FULL manifests (not the thin supplier shape): a sandbox_stdio block that serves a
	// seam needs its transport (command/sandbox) to be dialable, which the thin adapters.Manifest
	// drops. Each supplying manifest yields one Supplier + one thin manifest for seam declaration.
	full := BuiltinManifests()
	thin := make([]adapters.Manifest, 0, len(full))
	for i := range full {
		if full[i].Provides == "" {
			continue
		}
		sup, aerr := assembleBuiltinSupplier(&full[i], adeps)
		if aerr != nil {
			return nil, aerr
		}
		d.BlockSuppliers.Put(sup)
		thin = append(thin, toSupplierManifest(&full[i]))
	}
	providers := seamProviders(d, thin)
	registerUploadedSuppliers(ctx, d.BlockSuppliers, d.Credentials, adeps, d.Log)
	return providers, nil
}

// assembleBuiltinSupplier — one built-in supplier block. A sandbox_stdio block SERVES its seam via
// an MCP block (dialed on demand); every other kind (openapi / protocol) is assembled in-host from
// the thin manifest. The host names no block — it branches on the transport kind, generically.
func assembleBuiltinSupplier(m *plugin.Manifest, adeps *assembleDeps) (adapters.Supplier, error) {
	if m.Transport.Kind == plugin.TransportSandboxStdio {
		return blockSeamSupplier(m, adeps)
	}
	thin := toSupplierManifest(m)
	return assembleSupplier(&thin, adeps)
}

// blockSeamSupplier — build the MCP-block-backed supplier for the seam a sandbox_stdio block
// provides. Only calendar today (the CalDAV block); a new seam adds a case with its own contract
// proxy over the block's tools. Names the SEAM (a swappable capability), never a block id.
func blockSeamSupplier(m *plugin.Manifest, adeps *assembleDeps) (adapters.Supplier, error) {
	switch m.Provides {
	case "calendar":
		return newBlockCalendarProxy(m, adeps.credVault), nil
	default:
		return nil, fmt.Errorf("sandbox_stdio supplier %q provides seam %q, "+
			"which has no block-backed proxy", m.ID, m.Provides)
	}
}

// seamProviders —— one DepProvider per supplied seam, from the manifests and nothing else.
//
// A seam may be supplied by several blocks (a Google calendar and a CalDAV one); its DepProvider
// is produced once and resolves whichever supplier is active at call time. The door registers them
// and a duplicate panics (Register), so the dedupe (distinctSeamShapes) is load-bearing, not
// cosmetic.
//
// Two shapes, and which one a seam gets is read off the declarations: if ANY supplier of the seam
// can answer per-operation questions (an openapi supplier compares the spec's per-op scope against
// the grant) it gets the richer provider, so `calendar.readonly` still lists free slots while
// booking fails (F-B-8); a seam with no such supplier only answers "connected" (the active
// supplier is asked at call time regardless — CanPerform allows a supplier that cannot answer).
func seamProviders(d *deps.Runtime, ms []adapters.Manifest) []registry.DepProvider {
	shapes := distinctSeamShapes(ms)
	out := make([]registry.DepProvider, 0, len(shapes))
	for _, sh := range shapes {
		out = append(out, seamProvider(d, sh))
	}
	return out
}

// seamShape —— one seam and whether any of its suppliers can answer per-operation questions.
type seamShape struct {
	seam      string
	opCapable bool
}

// distinctSeamShapes —— dedupe the manifests to one entry per seam (first appearance keeps
// declaration order), marking a seam op-capable if ANY supplier of it is openapi.
func distinctSeamShapes(ms []adapters.Manifest) []seamShape {
	idx := make(map[string]int)
	out := make([]seamShape, 0, len(ms))
	for i := range ms {
		seam := ms[i].Seam
		if seam == "" {
			continue
		}
		j, seen := idx[seam]
		if !seen {
			j = len(out)
			idx[seam] = j
			out = append(out, seamShape{seam: seam})
		}
		if ms[i].Kind == "openapi" {
			out[j].opCapable = true
		}
	}
	return out
}

// seamProvider —— one seam's provider, of whichever of the two shapes the seam's suppliers fill.
func seamProvider(d *deps.Runtime, sh seamShape) registry.DepProvider {
	connected := seamConnectedFn(d, sh.seam)
	if !sh.opCapable {
		return registry.NamedProvider(sh.seam, connected)
	}
	return registry.NamedOpProvider(sh.seam, connected,
		func(ctx context.Context, ownerID, op string) (bool, error) {
			return d.BlockDispatch.CanPerform(ctx, ownerID, sh.seam, op)
		},
	)
}

// seamConnectedFn —— "does this owner have this seam supplied", closed over the seam name.
func seamConnectedFn(d *deps.Runtime, seam string) func(context.Context, string) (bool, error) {
	return func(ctx context.Context, ownerID string) (bool, error) {
		sup, err := d.BlockSuppliers.Lookup(ctx, ownerID, seam)
		if err != nil || sup == nil {
			return false, err
		}
		return sup.Connected(ctx, ownerID)
	}
}

// uploadedInstaller —— Installer: assembles a self-built manifest and puts it in the table.
type uploadedInstaller struct {
	sups *adapters.Suppliers
	deps *assembleDeps
}

func (i uploadedInstaller) Install(m *adapters.Manifest) (string, error) {
	c, err := assembleSupplier(m, i.deps)
	if err != nil {
		return "", fmt.Errorf("assemble supplier: %w", err)
	}
	seam, serr := manifestSeam(m)
	if serr != nil {
		return "", serr
	}
	i.sups.Put(c)
	return seam, nil
}

// manifestSeam —— openapi's seam comes from the Binding; protocol/credential/block use the
// declared Seam.
func manifestSeam(m *adapters.Manifest) (string, error) {
	// protocol (smtp), credential (a token holder, e.g. telegram's `im`), and block (a seam served
	// by an MCP block, e.g. the CalDAV block's `calendar`) declare their seam directly — no binding
	// to parse. Only openapi derives its seam from the binding.
	if directSeamKind(m.Kind) {
		return m.Seam, nil
	}
	if len(m.Binding) == 0 {
		// agent-only openapi supplier (§3): no seam binding, occupies no seam slot
		return "", nil
	}
	seam, serr := adapters.BindingSeam(m)
	if serr != nil {
		return "", fmt.Errorf("binding seam: %w", serr)
	}
	return seam, nil
}

// directSeamKind —— kinds that declare their seam directly (no openapi binding to parse): a
// protocol supplier (smtp), a credential-only one (telegram's im), and a block one (the CalDAV
// block's calendar).
func directSeamKind(kind string) bool {
	return kind == "protocol" || kind == "credential" || kind == "block"
}

// assembleDeps —— dependencies to assemble one supplier (openapi and protocol share the set).
type assembleDeps struct {
	doer          *http.Client
	store         connectionStoreAdapter
	smtpVault     smtpVaultAdapter
	credVault     credVaultAdapter
	telegramVault telegramVaultAdapter
	allow         egress.Allow
}

func newAssembleDeps(repo *credentials.Repo) *assembleDeps {
	allow := supplierEgressAllow()
	return &assembleDeps{
		doer:          allow.GuardedHTTPClient(),
		store:         connectionStoreAdapter{repo: repo},
		smtpVault:     smtpVaultAdapter{repo: repo},
		credVault:     credVaultAdapter{repo: repo},
		telegramVault: telegramVaultAdapter{repo: repo},
		allow:         allow,
	}
}

// loadBuiltinSupplierManifests —— the supplying blocks, for the admin surface.
//
// No error path any more: the built-in declarations are read once at process start and
// a bad one panics there (see manifests.go). By the time the admin needs them, either
// they parsed or this process never came up.
func loadBuiltinSupplierManifests(_ *deps.Runtime) []adapters.Manifest {
	return supplierManifests()
}

// assembleSupplier —— builds a Supplier from a manifest by kind; built-in/uploaded share it.
func assembleSupplier(m *adapters.Manifest, d *assembleDeps) (adapters.Supplier, error) {
	switch m.Kind {
	case "openapi":
		return assembleOpenAPISupplier(m, d)
	case "protocol":
		return assembleProtocolSupplier(m, d)
	case "credential":
		// A credential-only supplier: the owner stores a credential and something else consumes it
		// out of band (the `im` seam's token, read by im-bridge). No host client, no protocol name;
		// the manifest declaring `kind: credential` is the whole selection, so the host stays blind
		// to which block this is. telegram lives here now (it was a `case "telegram"`).
		return adapters.NewCredentialOnlySupplier(m.ID, d.telegramVault), nil
	default:
		return nil, fmt.Errorf("unknown supplier kind %q for %q", m.Kind, m.ID)
	}
}

// assembleOpenAPISupplier —— the openapi arm of assembleSupplier, split out so the dispatch
// switch stays under the complexity limit.
func assembleOpenAPISupplier(m *adapters.Manifest, d *assembleDeps) (adapters.Supplier, error) {
	c, err := adapters.AssembleOpenAPI(m, d.doer, d.store, d.allow)
	if err != nil {
		return nil, fmt.Errorf("assemble openapi supplier: %w", err)
	}
	return c, nil
}

// assembleProtocolSupplier —— for protocol kind, picks the built-in impl by Protocol. Only smtp
// now: CalDAV left "protocol" and became a `block` (assembled by blockSeamSupplier, not here).
func assembleProtocolSupplier(
	m *adapters.Manifest, d *assembleDeps,
) (adapters.Supplier, error) {
	switch m.Protocol {
	case "smtp":
		return adapters.NewSMTPSupplier(m.ID, d.smtpVault), nil
	default:
		return nil, fmt.Errorf("unknown protocol %q for supplier %q", m.Protocol, m.ID)
	}
}
