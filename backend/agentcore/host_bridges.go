// host_bridges.go — four bridges: the public, pure-data ports → the internal ports.
//
// Each one only relays and reshapes, **with no behaviour of its own**: how the
// calendar answers, where records are stored, what a config change means — all
// of that lives on the caller's side (eval-harness). This is exactly P.13's
// division of labor — the bridge belongs to backend, the stand-in belongs to
// the harness.

package agentcore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	conversationentity "github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	conversationrepo "github.com/atmaxmoj/standmeet/internal/conversation/repo"
	ownerentity "github.com/atmaxmoj/standmeet/internal/owner/entity"
	capstoreroutes "github.com/atmaxmoj/standmeet/internal/routes/capstore"
)

// errNoConnector / errNoStore — the capability called this, but nothing was wired
// for this run. **Surface it**: silently returning empty would let it think "the
// calendar is empty / there are no records" — that's the hardest kind of false
// green to track down.
var (
	errNoConnector = errors.New("agentcore: this launch wired no connector")
	errNoStore     = errors.New("agentcore: this launch wired no capability store")
)

// —— owner.meta ——

type ownerMetaBridge struct{ tz string }

func (b ownerMetaBridge) GetByID(_ context.Context, ownerID string) (ownerentity.Owner, error) {
	return ownerentity.Owner{ID: ownerID, ProfileTimezone: b.tz}, nil
}

// —— connector.invoke ——

type connectorBridge struct{ call ConnectorCall }

func (b connectorBridge) Invoke(
	_ context.Context, _, category, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	if b.call == nil {
		return nil, errNoConnector
	}
	out, err := b.call(category+"."+verb, args)
	if err != nil {
		return nil, fmt.Errorf("connector %s.%s: %w", category, verb, err)
	}
	return out, nil
}

func (b connectorBridge) InvokeBackground(
	ctx context.Context, ownerID, category, verb string, args json.RawMessage,
) {
	_, _ = b.Invoke(ctx, ownerID, category, verb, args) //nolint:errcheck // background, drop result
}

// —— capstore.* ——

// storeBridge — all five read/write ports derive from the caller's three methods:
// counting = query and take the length, fetching a doc = query and drop the id.
// One fewer API, one fewer place the two sides can drift apart.
type storeBridge struct{ store CapabilityStore }

func (b storeBridge) Insert(
	_ context.Context, collection string, doc json.RawMessage,
) (string, error) {
	if b.store == nil {
		return "", errNoStore
	}
	id, err := b.store.Insert(collection, doc)
	if err != nil {
		return "", fmt.Errorf("capability store insert: %w", err)
	}
	return id, nil
}

func (b storeBridge) Query(
	ctx context.Context, collection string, filter json.RawMessage,
) ([]json.RawMessage, error) {
	recs, err := b.QueryRecords(ctx, collection, filter)
	if err != nil {
		return nil, err
	}
	out := make([]json.RawMessage, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].Doc)
	}
	return out, nil
}

func (b storeBridge) Count(
	ctx context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	recs, err := b.QueryRecords(ctx, collection, filter)
	if err != nil {
		return 0, err
	}
	return int64(len(recs)), nil
}

func (b storeBridge) Delete(
	_ context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	if b.store == nil {
		return 0, errNoStore
	}
	n, err := b.store.DeleteMatching(collection, filter)
	if err != nil {
		return 0, fmt.Errorf("capability store delete: %w", err)
	}
	return int64(n), nil
}

func (b storeBridge) QueryRecords(
	_ context.Context, collection string, filter json.RawMessage,
) ([]capstoreroutes.BoundRecord, error) {
	if b.store == nil {
		return nil, errNoStore
	}
	recs, err := b.store.Query(collection, filter)
	if err != nil {
		return nil, fmt.Errorf("capability store query: %w", err)
	}
	out := make([]capstoreroutes.BoundRecord, 0, len(recs))
	for i := range recs {
		out = append(out, capstoreroutes.BoundRecord{ID: recs[i].ID, Doc: recs[i].Doc})
	}
	return out, nil
}

func (b storeBridge) DeleteByID(_ context.Context, collection, recordID string) (int64, error) {
	if b.store == nil {
		return 0, errNoStore
	}
	gone, err := b.store.DeleteByID(collection, recordID)
	if err != nil {
		return 0, fmt.Errorf("capability store delete by id: %w", err)
	}
	if gone {
		return 1, nil
	}
	return 0, nil
}

// —— capconfig.get ——

// manifestConfigBridge — config values: keys not overridden fall back to the
// manifest's declared default. **The default isn't copied here** — it reads
// straight from the manifest.
type manifestConfigBridge struct{ host *CapabilityHost }

func (c manifestConfigBridge) Values(
	_ context.Context, _ string,
) (map[string]json.RawMessage, error) {
	out := map[string]json.RawMessage{}
	for i := range c.host.manifest.Config {
		f := c.host.manifest.Config[i]
		out[f.Key] = json.RawMessage(f.Default)
	}
	for k, v := range c.host.Config {
		out[k] = json.RawMessage(v)
	}
	return out, nil
}

// A wrong wiring goes red right here, instead of quietly missing something at runtime.
var _ capstoreroutes.BoundStore = storeBridge{}

// —— conversation.read / inference.generate / report.store ——
//
// Capabilities like summarize call these three. Same story, only a bridge:
// the transcript is data the caller supplies, the credential resolves through
// its existing Driver, and the report is handed back to the caller to store —
// this layer produces no content of its own.

// TranscriptTurn — one line of the transcript (role: "visitor" / "assistant").
type TranscriptTurn struct {
	Role string
	Body string
}

// TranscriptSource — everything said up to **this moment**. It's a function, not
// a slice: the socket comes up at the start of the conversation, while the
// transcript keeps growing turn by turn — a one-time snapshot would leave the
// summarize turn reading the empty transcript from the very start.
type TranscriptSource func() []TranscriptTurn

// ReportSink — who receives the finished report (caller-implemented). Returns an id.
type ReportSink func(html string) (string, error)

type transcriptBridge struct{ src TranscriptSource }

func (b transcriptBridge) GetWithMessages(
	_ context.Context, _, chatID string,
) (conversationrepo.ChatWithMessages, error) {
	if b.src == nil {
		return conversationrepo.ChatWithMessages{}, errNoTranscript
	}
	turns := b.src()
	msgs := make([]conversationentity.Message, 0, len(turns))
	for _, t := range turns {
		msgs = append(msgs, conversationentity.Message{Role: t.Role, Body: t.Body})
	}
	return conversationrepo.ChatWithMessages{
		Chat:     conversationentity.Chat{ID: chatID},
		Messages: msgs,
	}, nil
}

// reportBridge — where report.store lands. Where it's stored is the caller's
// decision; this only reshapes.
type reportBridge struct{ sink ReportSink }

func (b reportBridge) Upsert(
	_ context.Context, in *conversationrepo.UpsertReportInput,
) (conversationentity.ChatReport, error) {
	if b.sink == nil {
		return conversationentity.ChatReport{}, errNoReportSink
	}
	id, err := b.sink(in.HTML)
	if err != nil {
		return conversationentity.ChatReport{}, fmt.Errorf("report sink: %w", err)
	}
	return conversationentity.ChatReport{ID: id, HTML: in.HTML}, nil
}

func (reportBridge) GetByID(
	_ context.Context, reportID string,
) (conversationentity.ChatReport, error) {
	return conversationentity.ChatReport{ID: reportID}, nil
}

// —— inference.generate ——

// credBridge — the host's owner+mode credential-resolution step. There's only
// one credential on this side (the one this run uses): the sandbox still can't
// see the key, it still only gets text.
type credBridge struct{ cred *Cred }

func (b credBridge) Resolve(_ context.Context, _ *inference.ResolveInput) (*Cred, error) {
	if b.cred == nil {
		return nil, errNoCred
	}
	return b.cred, nil
}

// A capability called one of these three and nothing was wired for this run —
// surface it every time, same reasoning as errNoConnector.
var (
	errNoReportSink = errors.New("agentcore: this launch wired no report sink")
	errNoTranscript = errors.New("agentcore: this launch wired no transcript source")
	errNoCred       = errors.New("agentcore: this launch wired no credential")
)
