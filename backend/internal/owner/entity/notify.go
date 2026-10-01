// notify.go —— notification rules and the owner's linked IM chats
// (docs/design/notify-rules-and-live-transcript.md). A rule = event type + filter + channel + the
// card's words. Instance configuration, like webhook endpoints.

package entity

import (
	"errors"
	"time"
)

// Names shared by the ops, the subscriber and the composition root.
const (
	// NotifyFanout —— the subscription that matches an event against the owner's rules.
	NotifyFanout = "notify.fanout"
	// NotifyDeliverKind —— the job that sends one rule's card for one event.
	NotifyDeliverKind = "notify.deliver"
	// ChannelWebhook / ChannelEmail / ChannelIM —— where a rule's card goes.
	ChannelWebhook = "webhook"
	ChannelEmail   = "email"
	ChannelIM      = "im"
	// FilterSubject —— a rule may always filter on the event's subject.
	FilterSubject = "subject"
)

// ErrNotifyInput —— a rule the instance cannot take (the caller's fault).
var ErrNotifyInput = errors.New("invalid notification rule")

// ErrNotifyRuleNotFound —— no rule with that id for this owner.
var ErrNotifyRuleNotFound = errors.New("notification rule not found")

// ErrIMLinkNotFound —— no linked chat with that id (or pairing code).
var ErrIMLinkNotFound = errors.New("im link not found")

// NotifyRule —— one rule.
type NotifyRule struct {
	CreatedAt   time.Time `json:"created_at"`
	ID          string    `json:"id"`
	OwnerID     string    `json:"-"`
	EventType   string    `json:"event_type"`
	FilterKey   string    `json:"filter_key"`
	FilterValue string    `json:"filter_value"`
	Channel     string    `json:"channel"`
	ChannelRef  string    `json:"channel_ref"`
	Template    string    `json:"template"`
	FirstOnly   bool      `json:"first_only"`
	Enabled     bool      `json:"enabled"`
}

// IMLink —— one of the owner's own chats. Linked once the owner sent the bot the pairing code.
type IMLink struct {
	CreatedAt   time.Time  `json:"created_at"`
	PairedAt    *time.Time `json:"paired_at"`
	ID          string     `json:"id"`
	OwnerID     string     `json:"-"`
	Platform    string     `json:"platform"`
	PairingCode string     `json:"pairing_code"`
	ChatID      string     `json:"-"`
}

// Linked —— the bridge recorded the owner's chat.
func (l *IMLink) Linked() bool { return l.ChatID != "" }

// NotifyDeliverArgs —— a notify.deliver job's args.
type NotifyDeliverArgs struct {
	RuleID  string `json:"rule_id"`
	EventID string `json:"event_id"`
}

// NotifyCard —— what a channel shows: the words, and an optional link with its button label.
type NotifyCard struct {
	Text      string `json:"text"`
	Link      string `json:"link"`
	LinkLabel string `json:"link_label"`
}
