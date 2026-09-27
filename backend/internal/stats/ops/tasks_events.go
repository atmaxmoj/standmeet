// tasks_events.go —— the Tasks panel's event stream: the events.* group (see tasks.go).

package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
)

var (
	eventsListSchema = json.RawMessage(`{"type":"object","properties":{
		"type":{"type":"string","description":"Event type or glob (corpus.note.*); empty = any."},
		"subject":{"type":"string","description":"Exact subject, e.g. wiki://projects/lucerna."},
		"limit":{"type":"integer","description":"At most this many, newest first (default 50)."}}}`)
	eventIDSchema = json.RawMessage(`{"type":"object","properties":{
		"id":{"type":"string","description":"Event id."}},"required":["id"]}`)
)

// Events —— the events.* group. Not wired → none.
func Events(d TasksDeps) []fp.Op {
	if !d.wired() {
		return []fp.Op{}
	}
	return []fp.Op{
		{
			ID: "events.list", Kind: fp.Read, Reach: fp.OwnerRead(), InputSchema: eventsListSchema,
			Description: "The event stream, newest first: type, subject, " +
				"and the jobs it fanned out to.",
			Invoke: eventsList(d),
		},
		{
			ID: "events.get", Kind: fp.Read, Reach: fp.OwnerRead(), InputSchema: eventIDSchema,
			Description: "One event: its payload and the job each subscriber got, " +
				"with that job's state.",
			Invoke: eventsGet(d),
		},
		{
			ID: "events.requeue", Kind: fp.Action, Reach: fp.OwnerAction(),
			InputSchema: eventIDSchema,
			Description: "Puts a poisoned event (one the relay gave up on) back in line " +
				"to fan out.",
			Invoke: eventsRequeue(d),
		},
	}
}

func eventsRequeue(d TasksDeps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var a eventIDArgs
		if err := json.Unmarshal(raw, &a); err != nil || a.ID == "" {
			return nil, fp.BadInput("id is required")
		}
		err := d.Events.Requeue(ctx, a.ID)
		if errors.Is(err, events.ErrNotFound) {
			return nil, fp.NotFound("no unfanned event " + a.ID)
		}
		if err != nil {
			return nil, fp.OpErr("requeue event", err)
		}
		return json.Marshal(map[string]bool{"requeued": true})
	}
}

type eventsListArgs struct {
	Type    string `json:"type"`
	Subject string `json:"subject"`
	Limit   int    `json:"limit"`
}

type eventsOut struct {
	Events []events.Event `json:"events"`
}

func eventsList(d TasksDeps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var a eventsListArgs
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, fp.BadInput("invalid arguments")
		}
		f := events.Filter{Type: a.Type, Subject: a.Subject, Limit: a.Limit}
		list, err := d.Events.List(ctx, f)
		if err != nil {
			return nil, fp.OpErr("list events", err)
		}
		return json.Marshal(eventsOut{Events: list})
	}
}

// fanoutOut —— a subscriber's job and that job's current state.
type fanoutOut struct {
	Subscriber string     `json:"subscriber"`
	State      jobs.State `json:"state"`
	JobID      jobs.JobID `json:"job_id"`
}

type eventOut struct {
	Fanout []fanoutOut  `json:"fanout"`
	Event  events.Event `json:"event"`
}

type eventIDArgs struct {
	ID string `json:"id"`
}

func eventsGet(d TasksDeps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var a eventIDArgs
		if err := json.Unmarshal(raw, &a); err != nil || a.ID == "" {
			return nil, fp.BadInput("id is required")
		}
		ev, err := d.Events.Get(ctx, a.ID)
		if errors.Is(err, events.ErrNotFound) {
			return nil, fp.NotFound("no event " + a.ID)
		}
		if err != nil {
			return nil, fp.OpErr("get event", err)
		}
		return json.Marshal(eventOut{Event: ev, Fanout: fanoutStates(ctx, d.Jobs, ev.Fanout)})
	}
}

// fanoutStates —— each target's job state; a job pruned since shows an empty state.
func fanoutStates(ctx context.Context, in jobs.Inspector, targets []events.Target) []fanoutOut {
	out := make([]fanoutOut, 0, len(targets))
	for _, t := range targets {
		o := fanoutOut{Subscriber: t.Subscriber, JobID: t.JobID}
		if j, err := in.Get(ctx, t.JobID); err == nil {
			o.State = j.State
		}
		out = append(out, o)
	}
	return out
}
