// tasks.go —— the Tasks panel's operations: the job queue, the periodic jobs and the event stream
// (docs/design/event-bus-outbox-webhooks.md, *Admin "Tasks" panel*).
//
// They belong to this domain for the same reason instance.jobs does: stats is the domain that
// reports on the instance's own machinery. Declared once, projected to admin and owner MCP, so an
// owner can also ask their AI "are any tasks stuck?". Owner plane only: never on the API-key face.
// Job args and event payloads are thin, so nothing here shows a corpus body.

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
)

// Alert thresholds: the panel raises an alert while any holds.
const (
	backlogAlertCount = 1_000
	backlogAlertAge   = 5 * time.Minute
)

// Alert codes the panel translates.
const (
	alertEventsBacklog  = "events_backlog"
	alertEventsPoisoned = "events_poisoned"
	alertJobsDiscarded  = "jobs_discarded"
)

// TasksDeps —— the job runtime and the event bus.
type TasksDeps struct {
	Jobs   jobs.Inspector
	Events *events.Bus
}

func (d TasksDeps) wired() bool { return d.Jobs != nil && d.Events != nil }

var (
	tasksOverviewSchema = json.RawMessage(`{"type":"object","properties":{
		"kind":{"type":"string","description":"Only this job kind; empty = every kind."}}}`)
	tasksListSchema = json.RawMessage(`{"type":"object","properties":{
		"kind":{"type":"string","description":"Job kind, e.g. corpus.index; empty = any."},
		"state":{"type":"string","description":` +
		`"pending | running | retryable | completed | discarded | cancelled; empty = any."},
		"limit":{"type":"integer","description":"At most this many, newest first (default 50)."}}}`)
	taskIDSchema = json.RawMessage(`{"type":"object","properties":{
		"id":{"type":"string","description":"Job id."}},"required":["id"]}`)
	periodicNameSchema = json.RawMessage(`{"type":"object","properties":{
		"name":{"type":"string","description":"Periodic job name, as tasks.periodic lists it."}},
		"required":["name"]}`)
	noArgsSchema = json.RawMessage(`{"type":"object","properties":{}}`)
)

// Tasks —— the tasks.* group. Not wired → none.
func Tasks(d TasksDeps) []fp.Op {
	if !d.wired() {
		return []fp.Op{}
	}
	return []fp.Op{
		{
			ID: "tasks.overview", Kind: fp.Read, Reach: fp.OwnerRead(),
			InputSchema: tasksOverviewSchema,
			Description: "Background work at a glance: job counts per state, " +
				"the age of the oldest pending job, the event backlog, table sizes, " +
				"and any alerts.",
			Invoke: tasksOverview(d),
		},
		{
			ID: "tasks.list", Kind: fp.Read, Reach: fp.OwnerRead(), InputSchema: tasksListSchema,
			Description: "List background jobs, newest first, filtered by kind and state.",
			Invoke:      tasksList(d),
		},
		{
			ID: "tasks.get", Kind: fp.Read, Reach: fp.OwnerRead(), InputSchema: taskIDSchema,
			Description: "One job: its args, the error of every failed attempt, " +
				"and when it runs next.",
			Invoke: taskAction(d, nil),
		},
		{
			ID: "tasks.periodic", Kind: fp.Read, Reach: fp.OwnerRead(), InputSchema: noArgsSchema,
			Description: "The periodic jobs: interval, last and next run, last result, " +
				"recent runs.",
			Invoke: tasksPeriodic(d),
		},
		{
			ID: "tasks.retry", Kind: fp.Action, Reach: fp.OwnerAction(), InputSchema: taskIDSchema,
			Description: "Run a job again now (a failed, discarded or waiting one).",
			Invoke:      taskAction(d, d.Jobs.Retry),
		},
		{
			ID: "tasks.cancel", Kind: fp.Action, Reach: fp.OwnerAction(), InputSchema: taskIDSchema,
			Description: "Cancel a job: it will not run again and its side effect " +
				"will not happen.",
			Invoke: taskAction(d, d.Jobs.Cancel),
		},
		{
			ID: "tasks.run_periodic", Kind: fp.Action, Reach: fp.OwnerAction(),
			InputSchema: periodicNameSchema,
			Description: "Run a periodic job now, outside its schedule.",
			Invoke:      runPeriodicNow(d),
		},
	}
}

type overviewOut struct {
	Alerts []string       `json:"alerts"`
	Jobs   jobs.Overview  `json:"jobs"`
	Events events.Backlog `json:"events"`
}

type kindArgs struct {
	Kind string `json:"kind"`
}

func tasksOverview(d TasksDeps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var a kindArgs
		if len(raw) > 0 && json.Unmarshal(raw, &a) != nil {
			return nil, fp.BadInput("invalid arguments")
		}
		ov, err := d.Jobs.Overview(ctx, a.Kind)
		if err != nil {
			return nil, fp.OpErr("job overview", err)
		}
		bl, err := d.Events.Backlog(ctx)
		if err != nil {
			return nil, fp.OpErr("event backlog", err)
		}
		return json.Marshal(overviewOut{Jobs: ov, Events: bl, Alerts: alertsOf(&ov, &bl)})
	}
}

// alertsOf —— the panel's alerts. Mail may be the thing failing, so an alert is shown in the
// panel, never mailed.
func alertsOf(ov *jobs.Overview, bl *events.Backlog) []string {
	out := []string{}
	if bl.Unfanned > backlogAlertCount || bl.OldestUnfannedAge > backlogAlertAge {
		out = append(out, alertEventsBacklog)
	}
	if bl.Poisoned > 0 {
		out = append(out, alertEventsPoisoned)
	}
	if ov.Counts[jobs.StateDiscarded] > 0 {
		out = append(out, alertJobsDiscarded)
	}
	return out
}

type listArgs struct {
	Kind  string `json:"kind"`
	State string `json:"state"`
	Limit int    `json:"limit"`
}

type jobsOutList struct {
	Jobs []jobs.Job `json:"jobs"`
}

func tasksList(d TasksDeps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var a listArgs
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, fp.BadInput("invalid arguments")
		}
		f := jobs.Filter{Kind: a.Kind, State: jobs.State(a.State), Limit: a.Limit}
		list, err := d.Jobs.List(ctx, f)
		if err != nil {
			return nil, fp.OpErr("list jobs", err)
		}
		return json.Marshal(jobsOutList{Jobs: list})
	}
}

type idArgs struct {
	ID json.RawMessage `json:"id"`
}

// jobIDOf —— the id arrives as a string from the admin path and as either from MCP.
func jobIDOf(raw json.RawMessage) (jobs.JobID, error) {
	var a idArgs
	if err := json.Unmarshal(raw, &a); err != nil || len(a.ID) == 0 {
		return 0, fp.BadInput("id is required")
	}
	n, err := strconv.ParseInt(unquoted(string(a.ID)), idBase, idBits)
	if err != nil || n <= 0 {
		return 0, fp.BadInput("id must be a job id")
	}
	return jobs.JobID(n), nil
}

// Job ids parse as decimal int64.
const (
	idBase = 10
	idBits = 64
)

// unquoted —— s without its JSON string quotes, or s itself when it is a bare number.
func unquoted(s string) string {
	if uq, err := strconv.Unquote(s); err == nil {
		return uq
	}
	return s
}

// taskAction —— act (nil for a plain read) on one job, then return the job as it now stands.
func taskAction(d TasksDeps, act func(context.Context, jobs.JobID) error) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		id, err := jobIDOf(raw)
		if err != nil {
			return nil, err
		}
		if aerr := applyAction(ctx, act, id); aerr != nil {
			return nil, jobErr(aerr)
		}
		j, gerr := d.Jobs.Get(ctx, id)
		if gerr != nil {
			return nil, jobErr(gerr)
		}
		return json.Marshal(j)
	}
}

// applyAction —— act on the job; nil act is a plain read and does nothing.
func applyAction(
	ctx context.Context, act func(context.Context, jobs.JobID) error, id jobs.JobID,
) error {
	if act == nil {
		return nil
	}
	return act(ctx, id)
}

func jobErr(err error) error {
	if errors.Is(err, jobs.ErrNotFound) {
		return fp.NotFound("no such job")
	}
	return fp.OpErr("job", err)
}

type periodicOut struct {
	Periodic []jobs.PeriodicState `json:"periodic"`
}

func tasksPeriodic(d TasksDeps) fp.Invoke {
	return func(ctx context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		ps, err := d.Jobs.Periodic(ctx)
		if err != nil {
			return nil, fp.OpErr("periodic jobs", err)
		}
		return json.Marshal(periodicOut{Periodic: ps})
	}
}

type nameArgs struct {
	Name string `json:"name"`
}

type queuedOut struct {
	Name   string `json:"name"`
	Queued bool   `json:"queued"`
}

func runPeriodicNow(d TasksDeps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var a nameArgs
		if err := json.Unmarshal(raw, &a); err != nil || a.Name == "" {
			return nil, fp.BadInput("name is required")
		}
		err := d.Jobs.RunPeriodic(ctx, a.Name)
		if errors.Is(err, jobs.ErrUnknownKind) {
			return nil, fp.NotFound("no periodic job named " + a.Name)
		}
		if err != nil {
			return nil, fp.OpErr("run periodic job", err)
		}
		return json.Marshal(queuedOut{Queued: true, Name: a.Name})
	}
}
