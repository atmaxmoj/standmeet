// notify.go —— notification rules and the owner's linked IM chats: CRUD, validation and pairing
// (docs/design/notify-rules-and-live-transcript.md). Matching and delivery are jobs
// (internal/owner/subscriber/notify.go).

package usecase

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// Pairing and template limits.
const (
	// PairingMaxAgeMinutes —— a pairing code works this long after the admin showed it.
	PairingMaxAgeMinutes = 30
	pairingCodeLen       = 8
	pairingAlphabet      = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O, 1/I: it is typed by hand
	maxTemplateLen       = 500
)

// NotifyDeps —— the rule and link store, and the bus (declared types and their filterable keys).
type NotifyDeps struct {
	Repo *repo.Repo
	Bus  *events.Bus
}

// RuleInput —— a new rule as the owner wrote it.
type RuleInput struct {
	EventType   string `json:"event_type"`
	FilterKey   string `json:"filter_key"`
	FilterValue string `json:"filter_value"`
	Channel     string `json:"channel"`
	ChannelRef  string `json:"channel_ref"`
	Template    string `json:"template"`
	FirstOnly   bool   `json:"first_only"`
}

func notifyInputErr(msg string) error { return fmt.Errorf("%w: %s", entity.ErrNotifyInput, msg) }

// NotifyEventTypes —— the types a rule may watch (the ones that may leave the instance).
func NotifyEventTypes(d *NotifyDeps) []events.Type { return d.Bus.WebhookTypes() }

// ListNotifyRules —— the owner's rules.
func ListNotifyRules(
	ctx context.Context, d *NotifyDeps, ownerID string,
) ([]entity.NotifyRule, error) {
	return d.Repo.ListNotifyRules(ctx, ownerID)
}

// CreateNotifyRule —— validates, then stores.
func CreateNotifyRule(
	ctx context.Context, d *NotifyDeps, ownerID string, in *RuleInput,
) (entity.NotifyRule, error) {
	if err := validateRule(ctx, d, ownerID, in); err != nil {
		return entity.NotifyRule{}, err
	}
	return d.Repo.CreateNotifyRule(ctx, &entity.NotifyRule{
		OwnerID: ownerID, EventType: strings.TrimSpace(in.EventType), FilterKey: in.FilterKey,
		FilterValue: strings.TrimSpace(in.FilterValue), Channel: in.Channel,
		ChannelRef: in.ChannelRef, Template: strings.TrimSpace(in.Template),
		FirstOnly: in.FirstOnly,
	})
}

// SetNotifyRuleEnabled —— turns a rule off or on.
func SetNotifyRuleEnabled(
	ctx context.Context, d *NotifyDeps, ownerID, id string, enabled bool,
) (entity.NotifyRule, error) {
	return d.Repo.SetNotifyRuleEnabled(ctx, ownerID, id, enabled)
}

// DeleteNotifyRule —— removes a rule.
func DeleteNotifyRule(ctx context.Context, d *NotifyDeps, ownerID, id string) error {
	return d.Repo.DeleteNotifyRule(ctx, ownerID, id)
}

func validateRule(ctx context.Context, d *NotifyDeps, ownerID string, in *RuleInput) error {
	if err := validateRuleEvent(d, in); err != nil {
		return err
	}
	if len(in.Template) > maxTemplateLen {
		return notifyInputErr(
			fmt.Sprintf("the card text is limited to %d characters", maxTemplateLen))
	}
	return validateChannel(ctx, d, ownerID, in)
}

// validateRuleEvent —— a type (or glob) that may leave the instance, and a filter it allows: the
// subject always, a data key only when that exact type declares it filterable.
func validateRuleEvent(d *NotifyDeps, in *RuleInput) error {
	exposed := d.Bus.WebhookTypes()
	if !matchesAnyType(strings.TrimSpace(in.EventType), exposed) {
		return notifyInputErr(fmt.Sprintf("%q is not an event type a rule can watch", in.EventType))
	}
	if !filterAllowed(d, in) {
		return notifyInputErr(
			fmt.Sprintf("%q cannot be filtered by %q", in.EventType, in.FilterKey))
	}
	return filterValueGiven(in)
}

// filterAllowed —— no filter, the subject, or a key that exact type declares filterable.
func filterAllowed(d *NotifyDeps, in *RuleInput) bool {
	if in.FilterKey == "" || in.FilterKey == entity.FilterSubject {
		return true
	}
	t, ok := d.Bus.Declared(in.EventType)
	return ok && slices.Contains(t.Filterable, in.FilterKey)
}

func filterValueGiven(in *RuleInput) error {
	if in.FilterKey != "" && strings.TrimSpace(in.FilterValue) == "" {
		return notifyInputErr("say which one the filter keeps")
	}
	return nil
}

// validateChannel —— the channel exists, and what it names is the owner's.
func validateChannel(ctx context.Context, d *NotifyDeps, ownerID string, in *RuleInput) error {
	switch in.Channel {
	case entity.ChannelEmail:
		return nil
	case entity.ChannelWebhook:
		_, err := d.Repo.GetWebhook(ctx, ownerID, in.ChannelRef)
		return refErr(err, "choose one of your webhook endpoints")
	case entity.ChannelIM:
		_, err := d.Repo.IMLink(ctx, ownerID, in.ChannelRef)
		return refErr(err, "choose one of your linked chats")
	default:
		return notifyInputErr("choose where the card goes: email, a webhook or a linked chat")
	}
}

func refErr(err error, msg string) error {
	if errors.Is(err, entity.ErrWebhookNotFound) || errors.Is(err, entity.ErrIMLinkNotFound) {
		return notifyInputErr(msg)
	}
	return err
}

// ListIMLinks —— the owner's chats, linked or still waiting for their pairing code.
func ListIMLinks(ctx context.Context, d *NotifyDeps, ownerID string) ([]entity.IMLink, error) {
	return d.Repo.ListIMLinks(ctx, ownerID)
}

// StartIMLink —— a new chat waiting for its pairing code, which the admin shows the owner.
func StartIMLink(ctx context.Context, d *NotifyDeps, ownerID string) (entity.IMLink, error) {
	code, err := newPairingCode()
	if err != nil {
		return entity.IMLink{}, err
	}
	return d.Repo.CreateIMLink(ctx, ownerID, code)
}

// DeleteIMLink —— unlinks a chat.
func DeleteIMLink(ctx context.Context, d *NotifyDeps, ownerID, id string) error {
	return d.Repo.DeleteIMLink(ctx, ownerID, id)
}

// PairIMLink —— the bridge saw a pairing code: record the chat it came from.
func PairIMLink(
	ctx context.Context, r *repo.Repo, code, platform, chatID string,
) (entity.IMLink, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" || chatID == "" {
		return entity.IMLink{}, entity.ErrIMLinkNotFound
	}
	return r.PairIMLink(ctx, code, platform, chatID, PairingMaxAgeMinutes)
}

func newPairingCode() (string, error) {
	b := make([]byte, pairingCodeLen)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("pairing code: %w", err)
	}
	for i := range b {
		b[i] = pairingAlphabet[int(b[i])%len(pairingAlphabet)]
	}
	return string(b), nil
}
