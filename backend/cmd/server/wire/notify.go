// notify.go —— the composition-root half of notification rules and the live transcript
// (docs/design/notify-rules-and-live-transcript.md): what a card says about an event (it reads
// other domains: the conversation's visitor, the code's string), the IM channel (the bridge's
// internal endpoint), and the live feed (Redis pub/sub, one channel per conversation).

package wire

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/cmd/server/port"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

const (
	// liveFeedBuffer —— frames held for a slow owner page before the oldest wait blocks.
	liveFeedBuffer    = 256
	liveChannelPrefix = "standmeet:live:"
	conversationStart = "conversation.started"
)

// notifyDeliveryDeps —— rule matching and delivery; the job runtime and the bus are read at run
// time (both are built after the declarations that point at them).
func notifyDeliveryDeps(d *deps.Runtime) *owner.NotifyDeliveryDeps {
	return &owner.NotifyDeliveryDeps{
		Repo: d.OwnerRepo, Pool: d.DB, Mail: port.MailSender(d),
		Jobs: func() jobs.Jobs { return d.Jobs },
		Event: func(ctx context.Context, id string) (events.Event, error) {
			return d.Events.Get(ctx, id)
		},
		Facts: cardFacts(d),
		IM:    port.NotifyIMSender(),
	}
}

// cardFacts —— for a conversation that started: who (the visitor's name), through which code,
// and the live-transcript link. Other events: their type and subject are the card.
func cardFacts(d *deps.Runtime) owner.NotifyCardFacts {
	return func(ctx context.Context, ev *events.Event) (owner.NotifyCardInfo, error) {
		if ev.Type != conversationStart {
			return owner.NotifyCardInfo{}, nil
		}
		var data struct {
			ConversationID string `json:"conversation_id"`
			CodeID         string `json:"code_id"`
		}
		if err := json.Unmarshal(ev.Data, &data); err != nil {
			return owner.NotifyCardInfo{},
				jobs.Discard(fmt.Errorf("conversation.started data: %w", err))
		}
		return conversationFacts(ctx, d, ev.OwnerID, data.ConversationID, data.CodeID)
	}
}

func conversationFacts(
	ctx context.Context, d *deps.Runtime, ownerID, convID, codeID string,
) (owner.NotifyCardInfo, error) {
	chat, err := d.ChatRepo.GetChat(ctx, ownerID, convID)
	if err != nil {
		return owner.NotifyCardInfo{}, fmt.Errorf("card: conversation: %w", err)
	}
	o, err := d.OwnerRepo.GetByID(ctx, ownerID)
	if err != nil {
		return owner.NotifyCardInfo{}, fmt.Errorf("card: owner: %w", err)
	}
	visitor, code := chat.VisitorName, codeString(ctx, d, codeID)
	if visitor == "" {
		visitor = "someone"
	}
	return owner.NotifyCardInfo{
		Vars: map[string]string{
			"visitor": visitor, "code": code,
			"summary": visitor + " started a conversation" + throughCode(code),
		},
		Link: o.PublicURL + "/live/" +
			owner.NewLiveToken(d.SessionKey, ownerID, convID, time.Now()),
	}, nil
}

func codeString(ctx context.Context, d *deps.Runtime, codeID string) string {
	if codeID == "" {
		return ""
	}
	c, err := d.CodeRepo.GetByID(ctx, codeID)
	if err != nil {
		return ""
	}
	return c.Code
}

func throughCode(code string) string {
	if code == "" {
		return ""
	}
	return " with code " + code
}

// LiveFeed —— publish / subscribe on a conversation's live channel.
type LiveFeed struct{ rdb *redis.Client }

// NewLiveFeed —— the feed over the instance's Redis.
func NewLiveFeed(rdb *redis.Client) LiveFeed { return LiveFeed{rdb: rdb} }

// Publish —— best effort: a frame nobody hears, or one Redis drops, costs only the owner's view.
func (f LiveFeed) Publish(ctx context.Context, conversationID string, frame []byte) {
	f.rdb.Publish(ctx, liveChannelPrefix+conversationID, frame)
}

// Subscribe —— the conversation's frames from now on, until ctx ends. Subscribed before it
// returns, so nothing published after the call is missed.
func (f LiveFeed) Subscribe(ctx context.Context, conversationID string) <-chan []byte {
	ps := f.rdb.Subscribe(ctx, liveChannelPrefix+conversationID)
	out := make(chan []byte, liveFeedBuffer)
	if _, err := ps.Receive(ctx); err != nil {
		closeSub(ps)
		close(out)
		return out
	}
	go relayFeed(ctx, ps, out)
	return out
}

// closeSub —— the subscription's connection goes back; a failure there only costs the connection.
func closeSub(ps *redis.PubSub) {
	if err := ps.Close(); err != nil {
		slog.Debug("live feed: close subscription", "err", err)
	}
}

func relayFeed(ctx context.Context, ps *redis.PubSub, out chan<- []byte) {
	defer close(out)
	defer closeSub(ps)
	in := ps.Channel()
	for {
		select {
		case m, ok := <-in:
			if !ok {
				return
			}
			out <- []byte(m.Payload)
		case <-ctx.Done():
			return
		}
	}
}
