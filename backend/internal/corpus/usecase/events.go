// events.go —— the writing event types (docs/design/event-bus-outbox-webhooks.md, *Webhook event
// types*). corpus.note.changed is trigger-written and declared by the index subscriber.

package usecase

import "github.com/atmaxmoj/standmeet/internal/infra/events"

// Writing event types. Thin: the subject is writing/<id>, the data {writing_id, slug}.
const (
	WritingPublished   = "writing.published"
	WritingUnpublished = "writing.unpublished"
)

// WritingEventTypes —— the writing event types.
func WritingEventTypes() []events.Type {
	t := func(typ, desc string) events.Type {
		return events.Type{
			Type: typ, Description: desc, Subject: "writing/<writing id>", Exposure: events.Webhook,
		}
	}
	return []events.Type{
		t(WritingPublished, "A writing was published (data.writing_id, data.slug)."),
		t(WritingUnpublished, "A writing went back to draft (data.writing_id, data.slug)."),
	}
}
