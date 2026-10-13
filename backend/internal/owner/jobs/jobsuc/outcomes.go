// outcomes.go —— what happens to an application after it is sent (roadmap E1): the owner
// records its outcome (1.3), the recruiter's first conversation is noticed once (1.2), and
// withdrawing takes the code back (1.4). The two reactions run as event subscriptions, off the
// write that caused them.

package jobsuc

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// conversationStarted —— the conversation domain's event, named here rather than imported (the job
// loop does not depend on the conversation module; wire/notify.go does the same).
const conversationStarted = "conversation.started"

// retentionBundleCleared / Restored —— owner core's retention events, named here for the same
// reason (owner/usecase/retention.go declares them): the bundle's assessments clear or return.
const (
	retentionBundleCleared  = "retention.bundle_cleared"
	retentionBundleRestored = "retention.bundle_restored"
)

// bundleHandler —— runs fn with the event's bundle_id. Idempotent on a redelivery.
func bundleHandler(fn func(context.Context, string) error) eventHandler {
	return func(ctx context.Context, ev *events.Event) error {
		var data struct {
			BundleID string `json:"bundle_id"`
		}
		if err := json.Unmarshal(ev.Data, &data); err != nil || data.BundleID == "" {
			return jobs.Discard(fmt.Errorf("%s: unreadable data %s", ev.Type, ev.Data))
		}
		return fn(ctx, data.BundleID)
	}
}

const (
	reactionAttempts = 10
	reactionTimeout  = 30 * time.Second
)

// Bound —— what else still opens an application's code: embeds and microsites bound to it.
type Bound struct {
	Embeds     []string `json:"embeds"`
	Microsites []string `json:"microsites"`
}

// OutcomeDeps —— the outcome use case and its reactions.
type OutcomeDeps struct {
	Apps *ApplicationRepo
	// Seen —— the ledger: retention clears and restores its assessments (retention.go).
	Seen   *JobSeenRepo
	Events events.Recorder
	// BoundTo —— a narrow port into the access and owner domains: the embeds and microsites
	// bound to a code. nil = not reported.
	BoundTo func(ctx context.Context, ownerID, codeID string) (Bound, error)
	// Revoke —— a narrow port into the access domain: revoke a code and end its sessions.
	Revoke func(ctx context.Context, ownerID, codeID string) error
}

// OutcomeResult —— the application after the change; Bound is set only for a withdrawal (what the
// revocation is about to cut off with the code).
type OutcomeResult struct {
	Bound       *Bound
	Application jobsmodel.Application
}

// UpdateOutcome —— the owner sets an application's outcome. MCP and the admin panel both call this.
func UpdateOutcome(ctx context.Context, d *OutcomeDeps, c *OutcomeChange) (OutcomeResult, error) {
	if !jobsmodel.IsOutcome(c.To) {
		return OutcomeResult{}, jobsmodel.ErrUnknownOutcome
	}
	changed, err := d.Apps.ChangeOutcome(ctx, d.Events, c)
	if err != nil {
		return OutcomeResult{}, err
	}
	app, err := d.Apps.GetByID(ctx, c.OwnerID, c.ApplicationID)
	if err != nil {
		return OutcomeResult{}, err
	}
	res := OutcomeResult{Application: app}
	if c.To != jobsmodel.OutcomeWithdrawn {
		return res, nil
	}
	err = withBound(ctx, d, c.OwnerID, changed.CodeID, &res)
	return res, err
}

// withBound —— a withdrawal's result names what the revocation is about to cut off.
func withBound(
	ctx context.Context, d *OutcomeDeps, ownerID, codeID string, res *OutcomeResult,
) error {
	if d.BoundTo == nil {
		return nil
	}
	bound, err := d.BoundTo(ctx, ownerID, codeID)
	if err != nil {
		return fmt.Errorf("bound to code: %w", err)
	}
	res.Bound = &bound
	return nil
}

type eventHandler = func(context.Context, *events.Event) error

// Subscriptions —— the reactions: the first conversation on an application's code marks it
// engaged (once); a withdrawal revokes the code.
func Subscriptions(d *OutcomeDeps) []events.Subscription {
	sub := func(name, typ string, h eventHandler) events.Subscription {
		return events.Subscription{
			Name: name, Types: []string{typ}, Queue: jobs.QueueMaintenance,
			MaxAttempts: reactionAttempts, Timeout: reactionTimeout,
			Handle: func(ctx context.Context, ev events.Event) error { return h(ctx, &ev) },
		}
	}
	engaged := func(ctx context.Context, ev *events.Event) error { return markEngaged(ctx, d, ev) }
	revoke := func(ctx context.Context, ev *events.Event) error {
		return revokeOnWithdraw(ctx, d, ev)
	}
	return []events.Subscription{
		sub("jobs.application_engaged", conversationStarted, engaged),
		sub("jobs.withdraw_revokes", ApplicationOutcomeChanged, revoke),
		sub("jobs.retention_clears", retentionBundleCleared, bundleHandler(d.Seen.ClearBundle)),
		sub("jobs.retention_restores", retentionBundleRestored,
			bundleHandler(d.Seen.RestoreBundle)),
	}
}

func markEngaged(ctx context.Context, d *OutcomeDeps, ev *events.Event) error {
	var data struct {
		CodeID         string `json:"code_id"`
		ConversationID string `json:"conversation_id"`
	}
	if err := json.Unmarshal(ev.Data, &data); err != nil {
		return jobs.Discard(fmt.Errorf("conversation.started: unreadable data %s", ev.Data))
	}
	if data.CodeID == "" {
		return nil // a codeless conversation belongs to no application
	}
	return d.Apps.MarkEngaged(ctx, d.Events, data.CodeID, data.ConversationID)
}

// revokeOnWithdraw —— revoking ends the code's sessions after its own commit, so it cannot share
// the outcome's transaction: the outcome is written first and this follows. A second revoke of
// the same code is harmless.
func revokeOnWithdraw(ctx context.Context, d *OutcomeDeps, ev *events.Event) error {
	var data struct {
		ApplicationID string `json:"application_id"`
		To            string `json:"to"`
	}
	if err := json.Unmarshal(ev.Data, &data); err != nil {
		return jobs.Discard(fmt.Errorf("outcome_changed: unreadable data %s", ev.Data))
	}
	if data.To != jobsmodel.OutcomeWithdrawn || d.Revoke == nil {
		return nil
	}
	app, err := d.Apps.GetByID(ctx, ev.OwnerID, data.ApplicationID)
	if err != nil {
		return fmt.Errorf("withdrawn application: %w", err)
	}
	return d.Revoke(ctx, ev.OwnerID, app.AccessCodeID)
}
