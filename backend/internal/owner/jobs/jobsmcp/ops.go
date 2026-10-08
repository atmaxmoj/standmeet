// ops.go —— the job loop's owner tools as dispatcher ops (refactor ledger R1;
// docs/design/layer2-externalize-jobs.md).
//
// jobs.*, resume.* and assistant.push used to be three owner-only fibers in the in-process
// registry — Go capability fibers in core, the shape the layer-② target retires. They take the
// exit applications.commit took (step 1), not the JS-block one the design first planned for them:
//   - resume_drafts cannot become a block store — applications.commit (host Go) reads the draft
//     and deletes it inside its own atomic transaction, and the admin composer reads the rows;
//   - jobs.fetch_new runs as durable host jobs (jobs.fetch_source) that record jobs.fetched,
//     which a sandboxed block cannot enqueue;
//   - assistant.push writes the in-process cue store the admin page streams from.
// All three touch host-owned state, which is the design's own rule for an fp.Op.
//
// The tool bodies are unchanged: each binding below is lifted as-is — same name, class, schema,
// description and handler — so the owner's AI sees byte-identical tools and results.

package jobsmcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/cues"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// panelReason —— why these ops are MCP-only: the admin panel reaches the same usecases through
// jobsadmin's own routes (drafts, masters, sources, listings, screen assistant).
const panelReason = "the panel reaches the same usecases through jobsadmin's routes"

// OwnerOps —— jobs.*, resume.* and assistant.push.
func OwnerOps(
	jobs *jobsuc.JobsDeps, resume *jobsuc.ResumeDeps, store *cues.Store, log *slog.Logger,
) []fp.Op {
	bindings := (&jobsFiber{jobs: jobs, log: log}).OwnerMCPBindings()
	bindings = append(bindings, (&resumeFiber{resume: resume, log: log}).OwnerMCPBindings()...)
	bindings = append(bindings, (&assistantFiber{store: store, log: log}).OwnerMCPBindings()...)
	out := make([]fp.Op, 0, len(bindings))
	for _, b := range bindings {
		out = append(out, opOf(b))
	}
	return out
}

// opOf —— one binding as an op. A read-class tool is a Read; every other class is an Action
// carrying that class.
func opOf(b *registry.MCPBinding) fp.Op {
	op := fp.Op{
		ID: b.Name, Kind: fp.Action, Danger: fp.Danger(b.Danger),
		Reach: fp.Only(panelReason, "mcp"), InputSchema: b.InputSchema,
		Description: b.Description, Invoke: invokeOf(b.Handler),
	}
	if op.Danger == fp.DangerRead {
		op.Kind, op.Danger = fp.Read, ""
	}
	return op
}

// invokeOf —— an MCP handler as an op's Invoke: a failure is its error text; a success is its JSON,
// with any embedded resource carried as `_embeds` (the MCP face turns them back into resources).
func invokeOf(h registry.MCPHandler) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		r := h(ctx, ownerID, raw)
		if !r.OK {
			return nil, errors.New(r.Text)
		}
		if len(r.Embeddings) == 0 {
			return json.RawMessage(r.Text), nil
		}
		return withEmbeds(r)
	}
}

func withEmbeds(r registry.MCPResult) (json.RawMessage, error) {
	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal([]byte(r.Text), &fields); err != nil {
		return nil, errors.New("encode result: " + err.Error())
	}
	embeds := make([]fp.Embed, 0, len(r.Embeddings))
	for _, e := range r.Embeddings {
		embeds = append(embeds, fp.Embed{URI: e.URI, MIMEType: e.MIMEType, Blob: e.Blob})
	}
	enc, err := json.Marshal(embeds)
	if err != nil {
		return nil, errors.New("encode embeds: " + err.Error())
	}
	fields[fp.EmbedsKey] = enc
	out, err := json.Marshal(fields)
	if err != nil {
		return nil, errors.New("encode result: " + err.Error())
	}
	return out, nil
}
