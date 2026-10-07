// notify.go —— the notify.* group: notification rules and the owner's linked IM chats
// (docs/design/notify-rules-and-live-transcript.md). Declared once, projected to admin and owner
// MCP. Owner plane only.

package ops

import (
	"context"
	"encoding/json"
	"errors"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

var (
	notifyIDSchema = json.RawMessage(`{"type":"object","properties":{
		"id":{"type":"string","description":"Rule or linked-chat id."}},"required":["id"]}`)
	notifyRuleSchema = json.RawMessage(`{"type":"object","properties":{
	"event_type":{"type":"string","description":"Event type or glob; see notify.event_types."},
	"filter_key":{"type":"string",
		"description":"Empty = every event; subject; or a key the type lists as filterable."},
	"filter_value":{"type":"string","description":"The value the filter keeps (a code id)."},
	"first_only":{"type":"boolean","description":"Once per filtered thing (or subject), ever."},
	"channel":{"type":"string","enum":["email","webhook","im"]},
	"channel_ref":{"type":"string","description":"The webhook endpoint id or linked chat id."},
	"template":{"type":"string",
		"description":"Card words; {code} {visitor} {summary} {event} {subject} are filled in."}},
	"required":["event_type","channel"]}`)
	notifyEnableSchema = json.RawMessage(`{"type":"object","properties":{
		"id":{"type":"string","description":"Rule id."},
		"enabled":{"type":"boolean"}},"required":["id","enabled"]}`)
)

// Notify —— the notify.* group. Not wired → none.
func Notify(d usecase.NotifyDeps) []fp.Op {
	if d.Repo == nil || d.Bus == nil {
		return []fp.Op{}
	}
	return append(notifyRuleOps(&d), notifyIMOps(&d)...)
}

func notifyRuleOps(d *usecase.NotifyDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "notify.rules", Kind: fp.Read, Reach: fp.OwnerRead(), InputSchema: noArgs,
			Description: "List notification rules: event, filter, first-only, channel, card text.",
			Invoke:      listNotifyRules(d),
		},
		{
			ID: "notify.event_types", Kind: fp.Read, Reach: fp.OwnerRead(), InputSchema: noArgs,
			Description: "The event types a rule can watch, and the data keys each can filter on.",
			Invoke: func(context.Context, string, json.RawMessage) (json.RawMessage, error) {
				return json.Marshal(map[string][]notifyTypeOut{"event_types": notifyTypesOut(d)})
			},
		},
		{
			ID: "notify.create_rule", Kind: fp.Action,
			Danger: fp.DangerEgress, Reach: fp.OwnerAction(),
			InputSchema: notifyRuleSchema,
			Description: "Add a notification rule: when this event (filtered) happens, send " +
				"a card by email, to a webhook endpoint, or to a linked chat.",
			Invoke: createNotifyRule(d),
		},
		{
			ID: "notify.set_rule_enabled", Kind: fp.Action,
			Danger: fp.DangerEgress, Reach: fp.OwnerAction(),
			InputSchema: notifyEnableSchema, Description: "Turn a notification rule off or on.",
			Invoke: setNotifyRuleEnabled(d),
		},
		{
			ID: "notify.delete_rule", Kind: fp.Action,
			Danger: fp.DangerDestructive, Reach: fp.OwnerAction(),
			InputSchema: notifyIDSchema, Description: "Remove a notification rule.",
			Invoke: deleteByNotifyID(func(ctx context.Context, owner, id string) error {
				return usecase.DeleteNotifyRule(ctx, d, owner, id)
			}),
		},
	}
}

func notifyIMOps(d *usecase.NotifyDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "notify.im_links", Kind: fp.Read, Reach: fp.OwnerRead(), InputSchema: noArgs,
			Description: "Your linked chats, and the ones still waiting for their pairing code.",
			Invoke:      listIMLinks(d),
		},
		{
			ID: "notify.link_im", Kind: fp.Action,
			Danger: fp.DangerCredential, Reach: fp.OwnerAction(), InputSchema: noArgs,
			Description: "Start linking a chat: returns a pairing code. Send \"/pair <code>\" " +
				"to your bot within 30 minutes; the chat it comes from becomes linked.",
			Invoke: startIMLink(d),
		},
		{
			ID: "notify.unlink_im", Kind: fp.Action,
			Danger: fp.DangerWrite, Reach: fp.OwnerAction(),
			InputSchema: notifyIDSchema,
			Description: "Unlink a chat. Rules pointing at it stop sending.",
			Invoke: deleteByNotifyID(func(ctx context.Context, owner, id string) error {
				return usecase.DeleteIMLink(ctx, d, owner, id)
			}),
		},
	}
}

func listNotifyRules(d *usecase.NotifyDeps) fp.Invoke {
	return func(ctx context.Context, owner string, _ json.RawMessage) (json.RawMessage, error) {
		list, err := usecase.ListNotifyRules(ctx, d, owner)
		return encodeNotify(map[string][]entity.NotifyRule{"rules": list}, err)
	}
}

func listIMLinks(d *usecase.NotifyDeps) fp.Invoke {
	return func(ctx context.Context, owner string, _ json.RawMessage) (json.RawMessage, error) {
		list, err := usecase.ListIMLinks(ctx, d, owner)
		return encodeNotify(map[string][]imLinkOut{"links": imLinksOut(list)}, err)
	}
}

func startIMLink(d *usecase.NotifyDeps) fp.Invoke {
	return func(ctx context.Context, owner string, _ json.RawMessage) (json.RawMessage, error) {
		l, err := usecase.StartIMLink(ctx, d, owner)
		return encodeNotify(map[string]imLinkOut{"link": imLinkView(&l)}, err)
	}
}

// imLinkOut —— a chat as the owner sees it: never the chat id, only whether it is linked.
type imLinkOut struct {
	entity.IMLink

	Linked bool `json:"linked"`
}

func imLinkView(l *entity.IMLink) imLinkOut { return imLinkOut{IMLink: *l, Linked: l.Linked()} }

func imLinksOut(list []entity.IMLink) []imLinkOut {
	out := make([]imLinkOut, 0, len(list))
	for i := range list {
		out = append(out, imLinkView(&list[i]))
	}
	return out
}

type notifyTypeOut struct {
	Type        string   `json:"type"`
	Description string   `json:"description"`
	Subject     string   `json:"subject"`
	Filterable  []string `json:"filterable"`
}

func notifyTypesOut(d *usecase.NotifyDeps) []notifyTypeOut {
	types := usecase.NotifyEventTypes(d)
	out := make([]notifyTypeOut, 0, len(types))
	for _, t := range types {
		f := t.Filterable
		if f == nil {
			f = []string{}
		}
		out = append(out, notifyTypeOut{
			Type: t.Type, Description: t.Description, Subject: t.Subject, Filterable: f,
		})
	}
	return out
}

func createNotifyRule(d *usecase.NotifyDeps) fp.Invoke {
	return func(ctx context.Context, owner string, raw json.RawMessage) (json.RawMessage, error) {
		var in usecase.RuleInput
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments")
		}
		r, err := usecase.CreateNotifyRule(ctx, d, owner, &in)
		return encodeNotify(map[string]entity.NotifyRule{"rule": r}, err)
	}
}

func setNotifyRuleEnabled(d *usecase.NotifyDeps) fp.Invoke {
	return func(ctx context.Context, owner string, raw json.RawMessage) (json.RawMessage, error) {
		var a struct {
			Enabled *bool  `json:"enabled"`
			ID      string `json:"id"`
		}
		if err := json.Unmarshal(raw, &a); err != nil || a.ID == "" || a.Enabled == nil {
			return nil, fp.BadInput("id and enabled are required")
		}
		r, err := usecase.SetNotifyRuleEnabled(ctx, d, owner, a.ID, *a.Enabled)
		return encodeNotify(map[string]entity.NotifyRule{"rule": r}, err)
	}
}

// deleteByNotifyID —— decodes {id}, runs the removal, answers {"deleted": true}.
func deleteByNotifyID(fn func(ctx context.Context, owner, id string) error) fp.Invoke {
	return func(ctx context.Context, owner string, raw json.RawMessage) (json.RawMessage, error) {
		var a struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &a); err != nil || a.ID == "" {
			return nil, fp.BadInput("id is required")
		}
		return encodeNotify(map[string]bool{"deleted": true}, fn(ctx, owner, a.ID))
	}
}

// notifyOut —— what the notify ops answer with.
type notifyOut interface {
	map[string][]entity.NotifyRule | map[string]entity.NotifyRule |
		map[string][]imLinkOut | map[string]imLinkOut | map[string]bool
}

func encodeNotify[T notifyOut](out T, err error) (json.RawMessage, error) {
	if err != nil {
		return nil, notifyErr(err)
	}
	return json.Marshal(out)
}

// notifyErr —— domain sentinel → protocol-agnostic category.
func notifyErr(err error) error {
	if errors.Is(err, entity.ErrNotifyInput) {
		return fp.BadInput(err.Error())
	}
	for _, c := range []struct {
		sentinel error
		msg      string
	}{
		{entity.ErrNotifyRuleNotFound, "no such notification rule"},
		{entity.ErrIMLinkNotFound, "no such linked chat"},
	} {
		if errors.Is(err, c.sentinel) {
			return fp.NotFound(c.msg)
		}
	}
	return fp.OpErr("notify", err)
}
