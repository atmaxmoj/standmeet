// block_host.go — the socket the eval mini-host opens for sandboxed
// blocks: **adapter only, no stand-ins.**
//
// A sandboxed block has no network, only a unix socket to the host,
// carrying the handful of host ops named in its manifest. Prod's inbound
// convergence (routes/hostdesk) dispatches by each domain's declaration;
// this dispatches **the same declaration** (the same Collect, the same
// pick) — only the implementation behind it is supplied by the caller.
//
// The implementations (a calendar that answers, an in-memory record table)
// live on the eval-harness side — the P.13 invariant: not one stand-in
// stays in the backend. This file is therefore only a bridge: it wires
// the public, pure-data ports (SupplierCall / BlockStore) into the
// internal ports.
//
// Why not let the harness write its own 9 handlers: that would give the
// vocabulary a second source — rename something in the manifest and eval
// still stays green, but it's now testing an interface that doesn't exist
// in the product. What gets swapped here is the backend, not the vocabulary.

package agentcore

import (
	"context"
	"fmt"
	"log/slog"

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/routes/hostdesk"
)

// SupplierCall — one external call: "<seam>.<verb>" (e.g. "calendar.free_busy")
// + arg JSON, returns response JSON or an error. **Caller-implemented** — this
// host layer doesn't know what a calendar looks like.
type SupplierCall func(call string, args []byte) ([]byte, error)

// StoredRecord — one entry in a block's own store: id + document.
type StoredRecord struct {
	ID  string
	Doc []byte
}

// BlockStore — a block's own isolated store (caller-implemented).
//
// The filter is a JSON blob with the same semantics as prod: **containment**
// (postgres's doc @> filter). If the semantics differ, a quota gate that counts
// usage by code_id will count something else here — and that drift won't error.
type BlockStore interface {
	Insert(collection string, doc []byte) (string, error)
	Query(collection string, filter []byte) ([]StoredRecord, error)
	DeleteByID(collection, recordID string) (bool, error)
	DeleteMatching(collection string, filter []byte) (int, error)
}

// BlockHost — everything needed to hook up one block. Every field
// is data or a function, so a standalone module can fill it in.
type BlockHost struct {
	// Supplier — the outside world. nil = this block never calls supplier.invoke.
	Supplier SupplierCall
	// Store — its own storage. nil = it never calls blockstore.*.
	Store BlockStore
	// Config — overrides for a few config keys (key → raw JSON). Keys not given
	// fall back to the manifest's declared default — "one place for a default"
	// holds here too.
	Config map[string]string
	// Transcript — the answer to conversation.read (as of the moment it's
	// called). nil = this is never called.
	Transcript TranscriptSource
	// Cred — which credential inference.generate runs with. nil = this is never called.
	Cred *Cred
	// Report — who receives the cleaned, templated HTML from report.store.
	// nil = this is never called.
	Report ReportSink
	// OwnerID / Timezone — the two fields owner.meta answers with. Timezone must
	// match the timezone stated in this turn's instruction: booking policy is
	// judged against the owner's timezone, and a mismatch here makes an open
	// slot show as closed.
	OwnerID  string
	Timezone string

	manifest plugin.Manifest
}

// StartBlockSocket — starts a socket for the host ops named in the manifest.
//
// Naming an op that isn't in the vocabulary → error, the same signal prod
// gives at boot.
func StartBlockSocket(
	ctx context.Context, h *BlockHost, blockID, sockPath string,
) (func() error, error) {
	m, err := BuiltinManifest(blockID)
	if err != nil {
		return nil, err
	}
	h.manifest = m
	want := []string{}
	if m.Transport.Sandbox != nil {
		want = m.Transport.Sandbox.HostOps
	}
	srv, serr := hostdesk.ServeAt(ctx, slog.Default(), &hostdesk.ServeInput{
		PluginID: blockID, Want: want, SockPath: sockPath,
		All: hostdesk.Collect(h.deps(), h.perBlock()),
	})
	if serr != nil {
		return nil, fmt.Errorf("block socket: %w", serr)
	}
	return srv.Close, nil
}

// deps — the domain dependencies. Every one is filled by a bridge; whichever
// isn't wired for this run, its own bridge errors out — and pick only
// dispatches names that were actually called, so the ones never called
// don't even get a handler attached.
//
// Corpus is left empty: retrieval goes through its own socket
// (StartRetrievalSocket), not dispatched from here.
func (h *BlockHost) deps() *hostdesk.Deps {
	return &hostdesk.Deps{
		Corpus:    &corpus.IndexDeps{},
		Owners:    ownerMetaBridge{tz: h.Timezone},
		Suppliers: supplierBridge{call: h.Supplier},
		Conversation: conversation.OpsHost{
			Chats:    transcriptBridge{src: h.Transcript},
			Resolver: credBridge{cred: h.Cred},
			Reports:  reportBridge{sink: h.Report},
		},
	}
}

// perBlock — the two things that belong only to this block: its
// own store, its own config.
func (h *BlockHost) perBlock() *hostdesk.PerBlock {
	return &hostdesk.PerBlock{
		Store:  storeBridge{store: h.Store},
		Config: manifestConfigBridge{host: h},
	}
}
