// Package ops — what the conversation domain can do externally, declared by the domain itself.
//
// An op here is a complete unit: id, description, input schema, semantic kind, exposure
// intent, implementation.
//
// The conversations resource does three things: list conversations, read one full
// transcript (along with which corpus entries the AI cited at the time), and the
// ghost-steering funnel.
//
// Two things collapsed during normalization:
//
//   - The same transcript used to differ a lot between the two faces. The panel side
//     carried refs (title + path) and the ghost log; the MCP side carried the cited
//     entries' **body text** (the owner used it to debug retrieval). Neither was a
//     subset of the other, so the owner was missing half no matter which side they
//     looked from. Now it's one shape: refs carry their body text, and the ghost log
//     is on every face.
//   - code_id / code_value / client_ip in the list used to be panel-only — from Claude
//     Code you couldn't tell "which code this conversation came in on, from which IP."
//     Now both sides see the same payload.
package ops

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/usecase"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
)

// ConversationsDeps — conversations themselves + the ghost log + the corpus repo used to
// read back cited entries' body text.
type ConversationsDeps struct {
	Chats  usecase.ConversationsDeps
	Ghosts usecase.GhostDeps
	Corpus corpus.Deps
	Log    *slog.Logger
}

// Conversations — list / get / ghost_telemetry (read-only) + the public-conversation policy.
func Conversations(d *ConversationsDeps) []fp.Op {
	return append([]fp.Op{
		{
			ID: "conversations.list",
			Description: "List the owner's visitor conversations, most recent activity first, " +
				"one page at a time ({items, next_cursor, total}): who, which access code, how " +
				"many turns, and the derived sentiment. Filter by code string.",
			InputSchema: paging.Schema(convListFilters),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listConversations(d.Chats),
		},
		{
			ID: "conversations.get",
			Description: "Read one conversation in full: every message, the corpus entries " +
				"the assistant cited (with their bodies), and the ghost-steering log.",
			InputSchema: convIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getConversation(d),
		},
		{
			ID: "conversations.ghost_telemetry",
			Description: "Ghost-steering funnel per waypoint: how often a policy ghost was " +
				"shown, how often the visitor took it, and the resulting rate.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      ghostTelemetry(d.Ghosts),
		},
	}, publicPolicyOps(d.Chats.Chats)...)
}

var (
	noArgs = json.RawMessage(`{"type":"object","properties":{}}`)

	convListFilters = json.RawMessage(`{
		"type":"object",
		"properties":{
			"code":{"type":"string","description":"Only conversations on this code string."}
		}
	}`)

	convIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"conversation_id":{"type":"string","description":"Conversation id."}},
		"required":["conversation_id"]
	}`)
)

type convListArgs struct {
	Code string `json:"code"`
}

func listConversations(deps usecase.ConversationsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := paging.ParseArgs[convListArgs](raw)
		if perr != nil {
			return nil, fp.BadInput("invalid arguments: " + perr.Error())
		}
		page, err := usecase.ListConversations(ctx, deps, ownerID, in.Filter.Code, in.Req)
		if err != nil {
			return nil, convErr(err)
		}
		return json.Marshal(paging.Each(page, toConversationOut))
	}
}

type convIDArgs struct {
	ConversationID string `json:"conversation_id"`
}

func getConversation(d *ConversationsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in convIDArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs(
			[2]string{"conversation_id", in.ConversationID},
		); err != nil {
			return nil, err
		}
		bundle, err := usecase.GetConversationTranscript(ctx, d.Chats, ownerID, in.ConversationID)
		if err != nil {
			return nil, convErr(err)
		}
		return json.Marshal(buildTranscript(ctx, d, ownerID, in.ConversationID, &bundle))
	}
}

func ghostTelemetry(deps usecase.GhostDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		stats, err := usecase.GhostTelemetry(ctx, &deps, ownerID)
		if err != nil {
			return nil, convErr(err)
		}
		return json.Marshal(toGhostFunnel(stats))
	}
}

// convErr — domain sentinel error → protocol-agnostic category. The code is an already-
// shipped contract, pinned explicitly.
func convErr(err error) error {
	if errors.Is(err, entity.ErrChatNotFound) {
		return fp.Coded(fp.NotFound("conversation not found"), "not_found")
	}
	if errors.Is(err, paging.ErrBadCursor) {
		return fp.BadInput("bad cursor")
	}
	return fp.OpErr("conversation op", err)
}
