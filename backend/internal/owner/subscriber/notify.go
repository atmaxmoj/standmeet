// notify.go —— notification rules at work (docs/design/notify-rules-and-live-transcript.md).
//
//   - notify.fanout (a subscription on every webhook-exposed type): matches the event against the
//     owner's enabled rules (type glob + filter). For each match it claims the first-only marker
//     (when the rule asks for one) and queues one notify.deliver job, in one transaction — so a
//     retried fan-out neither sends twice nor loses the marker.
//   - notify.deliver {rule_id, event_id}: renders the card and sends it down the rule's channel.
//     webhook → the endpoint's own webhook.deliver job (its secret, lease and delivery log);
//     email → the owner's address through the mail port; im → the bridge, to the linked chat.

package subscriber

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/infra/sideeffect/mail"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// Notify job limits: the mail policy (8 attempts over about 6 h) for every channel.
const (
	notifyAttempts = mailAttempts
	notifyTimeout  = 30 * time.Second
)

// CardInfo —— what a card may say about an event beyond its type and subject: named values for
// the template ({code}, {visitor}, {summary} …) and a link to open ("" = none).
type CardInfo struct {
	Vars map[string]string
	Link string
}

// CardFacts —— supplied by the composition root, which reads the other domains (a conversation's
// visitor, a code's string, the live link).
type CardFacts func(ctx context.Context, ev *events.Event) (CardInfo, error)

// IMSender —— posts a card to one linked chat (the composition root calls the bridge).
type IMSender func(ctx context.Context, platform, chatID string, card *entity.NotifyCard) error

// NotifyDeps —— what matching and delivery need. Jobs is read at run time (built after the
// declarations that point at it).
type NotifyDeps struct {
	Repo  *repo.Repo
	Pool  *pgstore.Pool
	Jobs  func() jobs.Jobs
	Event func(ctx context.Context, id string) (events.Event, error)
	Facts CardFacts
	IM    IMSender
	Mail  mail.Sender
}

// NotifySubscriptions —— the rule fan-out, on every webhook-exposed type among declared.
func NotifySubscriptions(d *NotifyDeps, declared []events.Type) []events.Subscription {
	types := []string{}
	for _, t := range declared {
		if t.Exposure == events.Webhook {
			types = append(types, t.Type)
		}
	}
	if len(types) == 0 {
		return []events.Subscription{}
	}
	return []events.Subscription{{
		Name: entity.NotifyFanout, Types: types, Queue: jobs.QueueNotify,
		MaxAttempts: notifyAttempts, Timeout: notifyTimeout, Backoff: MailBackoff,
		Handle: func(ctx context.Context, ev events.Event) error { return matchRules(ctx, d, &ev) },
	}}
}

// NotifyKinds —— notify.deliver.
func NotifyKinds(d *NotifyDeps) []jobs.Kind {
	return []jobs.Kind{{
		Name: entity.NotifyDeliverKind, Queue: jobs.QueueNotify, MaxAttempts: notifyAttempts,
		Timeout: notifyTimeout, Backoff: MailBackoff,
		Handle: func(ctx context.Context, raw json.RawMessage) error {
			return deliverCard(ctx, d, raw)
		},
	}}
}

// matchRules —— one notify.deliver per matching rule, the first-only markers claimed alongside.
func matchRules(ctx context.Context, d *NotifyDeps, ev *events.Event) error {
	if ev.OwnerID == "" || ev.Type == entity.WebhookTestEvent {
		return nil
	}
	rules, err := d.Repo.EnabledNotifyRules(ctx, ev.OwnerID)
	if err != nil {
		return err
	}
	hits := MatchingRules(rules, ev)
	if len(hits) == 0 {
		return nil
	}
	return pgstore.InTx(ctx, d.Pool, func(tx pgstore.Tx) error {
		return queueCards(ctx, tx, d.Jobs().With(tx), hits, ev)
	})
}

func queueCards(
	ctx context.Context, tx pgstore.Tx, j jobs.Jobs, hits []entity.NotifyRule, ev *events.Event,
) error {
	for i := range hits {
		send, err := firstTimeOrAny(ctx, tx, &hits[i], ev)
		if err != nil {
			return err
		}
		if !send {
			continue // a first-only rule that already fired for this
		}
		args := entity.NotifyDeliverArgs{RuleID: hits[i].ID, EventID: ev.ID}
		if _, qerr := j.Enqueue(ctx, entity.NotifyDeliverKind, args,
			jobs.EnqueueOpts{UniqueByArgs: true}); qerr != nil {
			return fmt.Errorf("queue notify card for rule %s: %w", hits[i].ID, qerr)
		}
	}
	return nil
}

// firstTimeOrAny —— true for an every-time rule; for a first-only rule, true only when this call
// claimed its marker.
func firstTimeOrAny(
	ctx context.Context, tx pgstore.Tx, r *entity.NotifyRule, ev *events.Event,
) (bool, error) {
	if !r.FirstOnly {
		return true, nil
	}
	return repo.ClaimNotifyMark(ctx, tx, r.ID, firstMark(r, ev))
}

// MatchingRules —— the rules whose type glob and filter both match ev.
func MatchingRules(rules []entity.NotifyRule, ev *events.Event) []entity.NotifyRule {
	out := []entity.NotifyRule{}
	for i := range rules {
		if events.Match(rules[i].EventType, ev.Type) && filterKeeps(&rules[i], ev) {
			out = append(out, rules[i])
		}
	}
	return out
}

// filterKeeps —— no filter, the subject, or one declared data key equal to the rule's value.
func filterKeeps(r *entity.NotifyRule, ev *events.Event) bool {
	switch r.FilterKey {
	case "":
		return true
	case entity.FilterSubject:
		return ev.Subject == r.FilterValue
	default:
		return dataValue(ev, r.FilterKey) == r.FilterValue
	}
}

// dataValue —— data[key] as text: a JSON string unquoted, anything else as written.
func dataValue(ev *events.Event, key string) string {
	var data map[string]json.RawMessage
	if err := json.Unmarshal(ev.Data, &data); err != nil {
		return ""
	}
	var s string
	if err := json.Unmarshal(data[key], &s); err == nil {
		return s
	}
	return string(data[key])
}

// firstMark —— what "the first time" counts: the filtered thing (this code), else the subject.
func firstMark(r *entity.NotifyRule, ev *events.Event) string {
	if r.FilterKey != "" {
		return r.FilterKey + "=" + r.FilterValue
	}
	return ev.Subject
}

// deliverCard —— one attempt of notify.deliver. A rule or event that is gone is discarded.
func deliverCard(ctx context.Context, d *NotifyDeps, raw json.RawMessage) error {
	a, err := deliverCardArgs(raw)
	if err != nil {
		return err
	}
	rule, err := d.Repo.NotifyRule(ctx, a.RuleID)
	if err != nil {
		return discardGone(err, entity.ErrNotifyRuleNotFound)
	}
	ev, err := d.Event(ctx, a.EventID)
	if err != nil {
		return discardGone(err, events.ErrNotFound)
	}
	return sendCard(ctx, d, &rule, &ev)
}

func deliverCardArgs(raw json.RawMessage) (entity.NotifyDeliverArgs, error) {
	var a entity.NotifyDeliverArgs
	if err := json.Unmarshal(raw, &a); err != nil || a.RuleID == "" || a.EventID == "" {
		return a, badArgs(entity.NotifyDeliverKind, raw)
	}
	return a, nil
}

// discardGone —— a row that is gone ends the job; any other read failure is retried.
func discardGone(err, gone error) error {
	if errors.Is(err, gone) {
		return jobs.Discard(err)
	}
	return err
}

func sendCard(ctx context.Context, d *NotifyDeps, rule *entity.NotifyRule, ev *events.Event) error {
	if rule.Channel == entity.ChannelWebhook {
		args := entity.DeliverArgs{EndpointID: rule.ChannelRef, EventID: ev.ID}
		_, err := d.Jobs().Enqueue(ctx, entity.WebhookDeliverKind, args,
			jobs.EnqueueOpts{UniqueByArgs: true})
		return err
	}
	card, err := renderCard(ctx, d, rule, ev)
	if err != nil {
		return err
	}
	if rule.Channel == entity.ChannelEmail {
		return mailCard(ctx, d, rule, ev, &card)
	}
	return imCard(ctx, d, rule, &card)
}

// renderCard —— the rule's template (or the event's summary) with the facts filled in.
func renderCard(
	ctx context.Context, d *NotifyDeps, rule *entity.NotifyRule, ev *events.Event,
) (entity.NotifyCard, error) {
	info, err := d.Facts(ctx, ev)
	if err != nil {
		return entity.NotifyCard{}, err
	}
	vars := map[string]string{
		"event": ev.Type, "subject": ev.Subject, "summary": ev.Type + " · " + ev.Subject,
	}
	maps.Copy(vars, info.Vars)
	tmpl := rule.Template
	if tmpl == "" {
		tmpl = "{summary}"
	}
	card := entity.NotifyCard{Text: fill(tmpl, vars), Link: info.Link}
	if info.Link != "" {
		card.LinkLabel = "Open"
	}
	return card, nil
}

// fill —— {name} → its value; an unknown name stays as written, so a typo shows on the card.
func fill(tmpl string, vars map[string]string) string {
	pairs := make([]string, 0, 2*len(vars))
	for k, v := range vars {
		pairs = append(pairs, "{"+k+"}", v)
	}
	return strings.NewReplacer(pairs...).Replace(tmpl)
}

func mailCard(
	ctx context.Context, d *NotifyDeps, rule *entity.NotifyRule, ev *events.Event,
	card *entity.NotifyCard,
) error {
	o, err := d.Repo.GetByID(ctx, ev.OwnerID)
	if err != nil {
		return err
	}
	if o.Email == "" {
		return jobs.Discard(errors.New("notify: the owner has no email address"))
	}
	body := card.Text
	if card.Link != "" {
		body += "\n\n" + card.Link
	}
	subject, _, _ := strings.Cut(card.Text, "\n")
	return d.Mail.Send(ctx, ev.OwnerID, mail.Message{
		To: o.Email, Subject: subject, Body: body,
		MessageID: messageID("notify-" + rule.ID + "-" + ev.ID),
	})
}

func imCard(
	ctx context.Context, d *NotifyDeps, rule *entity.NotifyRule, card *entity.NotifyCard,
) error {
	link, err := d.Repo.IMLink(ctx, rule.OwnerID, rule.ChannelRef)
	if errors.Is(err, entity.ErrIMLinkNotFound) {
		return jobs.Discard(err) // unlinked since: nowhere to send it
	}
	if err != nil {
		return err
	}
	if !link.Linked() {
		return jobs.Discard(errors.New("notify: the chat was never linked"))
	}
	return d.IM(ctx, link.Platform, link.ChatID, card)
}
