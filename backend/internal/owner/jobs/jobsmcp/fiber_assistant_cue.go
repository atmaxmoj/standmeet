// fiber_assistant_cue.go —— the cue card on the server: assistant.prepare (a session's start),
// assistant.context (the prompt, for an agent that runs its own model) and assistant.cue (the
// card, written to the feed). The desktop app and any agent ask the same tools and get the same
// card (docs/design/assistant-cue.md).

package jobsmcp

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/mcputil"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/cues"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

const askProps = `
	"role_id":{"type":"string",
		"description":"The interview's role (id or name, as role_list shows it): its ` +
	`corpus_uris are the notes the card may use. Absent = every wiki note."},
	"round":{"type":"string",
		"enum":["general","recruiter","behavioural","manager","technical","design",
			"executive","mentor"],
		"description":"The interview round; it decides which notes count and how the ` +
	`card talks. Absent = general."},
	"question":{"type":"string","description":"What the other side just said, verbatim."},
	"call_id":{"type":"string",
		"description":"One id per interview: the card sees the call so far, and a call ` +
	`that names a company applied to stays on that job. Absent = a line on its own."},
	"user_context":{"type":"string",
		"description":"Extra words from the owner for this session."},
	"rewrite":{"type":"boolean",
		"description":"Turn the line as heard into the line as meant first: stutters, ` +
	`fillers, false starts and a sentence cut in two cleaned up, a mis-heard name of the ` +
	`owner's restored. Default: on; false for a line that is already clean."}`

func (c *assistantFiber) cueBindings() []*registry.MCPBinding {
	return []*registry.MCPBinding{{
		Name: "assistant.prepare", Danger: "read",
		Description: "Start a screen-assistant session: how many notes the role's scope holds, " +
			"the interview rounds, and the names to put in a speech recognizer's prompt " +
			"(the owner's projects, stack and companies) so they are heard as names.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{` +
			`"role_id":{"type":"string",` +
			`"description":"Role id or name; absent = every wiki note."}}}`),
		Handler: c.handlePrepare,
	}, {
		Name: "assistant.context", Danger: "read",
		Description: "The system prompt assistant.cue would send for this line — the owner's " +
			"notes that match it, marked whose they are, the round's rules — without calling a " +
			"model or writing anything. For an agent that writes the card with its own model.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{` + askProps + `},` +
			`"required":["question"]}`),
		Handler: c.handleContext,
	}, {
		Name: "assistant.cue", Danger: "write",
		Description: "Write the cue card for one line of an interview, from the owner's notes, " +
			"on the owner's model. The card streams into the screen-assistant feed under " +
			"feed_id (the desktop app and /admin/screen-assistant show it) and comes back whole. " +
			"A mock-interview agent calls this for each question and hands the card to the owner.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{` + askProps + `,
			"id":{"type":"string","description":"The card's feed event id; absent = a new one."},
			"debug":{"type":"boolean",
				"description":"Also return the context, the prompt and the notes used."}},
			"required":["question"]}`),
		Handler: c.handleCue,
	}}
}

type askArgs struct {
	Rewrite     *bool  `json:"rewrite"`
	RoleID      string `json:"role_id"`
	Round       string `json:"round"`
	Question    string `json:"question"`
	CallID      string `json:"call_id"`
	UserContext string `json:"user_context"`
	ID          string `json:"id"`
	Debug       bool   `json:"debug"`
}

// ask —— the arguments as an Ask. The rewrite is on unless the caller turns it off (owner,
// 2026-10-21: "改写层要现在就默认打开"): speech recognition alone does not survive accents and
// stutters.
func (a *askArgs) ask() *cues.Ask {
	rewrite := true
	if a.Rewrite != nil {
		rewrite = *a.Rewrite
	}
	return &cues.Ask{
		RoleRef: a.RoleID, Round: a.Round, Question: a.Question,
		CallID: a.CallID, UserContext: a.UserContext, Rewrite: rewrite,
	}
}

// failed —— a failure the caller can act on, as is; anything else, logged and generic.
func (c *assistantFiber) failed(tool string, err error) registry.MCPResult {
	if cues.IsAsked(err) {
		return registry.MCPError(err.Error())
	}
	c.log.Error("cap "+tool, "err", err)
	return registry.MCPError(tool + " failed")
}

func (c *assistantFiber) handlePrepare(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var in askArgs
	if err := decodeArgs(raw, &in); err != nil {
		return registry.MCPError(err.Error())
	}
	p, err := c.asst.Prepare(ctx, ownerID, in.RoleID)
	if err != nil {
		return c.failed("assistant.prepare", err)
	}
	out := map[string]any{"notes": p.Notes, "hint": p.Hint, "rounds": cues.Rounds, "role": nil}
	if p.Role != nil {
		out["role"] = map[string]string{"id": p.Role.ID, "name": p.Role.Name}
	}
	return mcputil.MarshalResult(c.log, "assistant.prepare", out)
}

func (c *assistantFiber) handleContext(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var in askArgs
	if err := decodeArgs(raw, &in); err != nil {
		return registry.MCPError(err.Error())
	}
	p, err := c.asst.Context(ctx, ownerID, in.ask())
	if err != nil {
		return c.failed("assistant.context", err)
	}
	return mcputil.MarshalResult(c.log, "assistant.context", promptOut(&p))
}

func (c *assistantFiber) handleCue(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var in askArgs
	if err := decodeArgs(raw, &in); err != nil {
		return registry.MCPError(err.Error())
	}
	card, err := c.asst.Cue(ctx, c.log, ownerID, in.ID, in.ask())
	if err != nil {
		return c.failed("assistant.cue", err)
	}
	out := map[string]any{"card": card.Text, "feed_id": card.FeedID, "model": card.Model}
	if in.Debug {
		out["debug"] = promptOut(&card.Prompt)
	}
	return mcputil.MarshalResult(c.log, "assistant.cue", out)
}

func promptOut(p *cues.Prompt) map[string]any {
	matrix := "off"
	if p.Matrix {
		matrix = "on"
	}
	return map[string]any{
		"system": p.System, "context": p.Context, "sources": nonNil(p.Sources),
		"heard":  p.Heard,
		"matrix": matrix, "stack_named": nonNil(p.Named),
	}
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func decodeArgs(raw json.RawMessage, into *askArgs) error {
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, into); err != nil {
		return fmt.Errorf("invalid arguments: %w", err)
	}
	return nil
}
