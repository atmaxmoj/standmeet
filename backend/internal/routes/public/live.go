// live.go —— the owner's live transcript (docs/design/notify-rules-and-live-transcript.md, *The
// live transcript*).
//
//   - GET /api/v1/live/{token}: the conversation so far ({conversation}, the visitor's shape)
//   - GET /api/v1/live/{token}/stream: SSE, every frame of the visitor's turns as they stream —
//     a `turn` frame with the question, then the very frames the visitor's own stream carries
//
// The token is the credential (signed, one conversation, 24 h): the owner opens it from a phone's
// IM app, with no admin session. A tampered or expired token answers 404 and nothing else.
//
// The visitor's stream is untouched: the turn route copies each frame it writes to the
// conversation's feed (liveTee), and this route is a second listener on that feed.

package public

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// LiveTarget —— the conversation a live link opens, and whose it is.
type LiveTarget struct {
	OwnerID        string
	ConversationID string
}

// LiveDeps —— wired at the composition root (the instance key, Redis).
type LiveDeps struct {
	// Verify —— the owner and conversation a token opens; an error for anything else.
	Verify func(token string) (LiveTarget, error)
	// Publish —— one frame onto a conversation's feed (best effort: a lost frame costs the
	// owner's view, never the visitor's turn).
	Publish func(ctx context.Context, conversationID string, frame []byte)
	// Subscribe —— the conversation's frames until ctx ends (the channel closes then).
	Subscribe func(ctx context.Context, conversationID string) <-chan []byte
}

func (h *Handlers) mountLive(r chi.Router) {
	r.Get("/live/{token}", h.getLive())
	r.Get("/live/{token}/stream", h.streamLive())
}

func liveInvalid() apierr.Envelope {
	return apierr.Envelope{
		Status: http.StatusNotFound, Code: "live_link_invalid",
		Message: "This link is not valid or has expired.",
	}
}

// liveTarget —— the token's owner and conversation; false after answering 404.
func (h *Handlers) liveTarget(w http.ResponseWriter, r *http.Request) (LiveTarget, bool) {
	t, err := h.Live.Verify(chi.URLParam(r, "token"))
	if err != nil {
		writeError(h.Log, w, liveInvalid())
		return LiveTarget{}, false
	}
	return t, true
}

func (h *Handlers) getLive() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t, ok := h.liveTarget(w, r)
		if !ok {
			return
		}
		writeLiveConversation(h, w, r, t)
	}
}

func writeLiveConversation(h *Handlers, w http.ResponseWriter, r *http.Request, t LiveTarget) {
	c, err := h.conversationByID(r.Context(), t.OwnerID, t.ConversationID)
	if err != nil {
		writeError(h.Log, w, liveInvalid())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	body := map[string]conversationResp{"conversation": c}
	if eerr := json.NewEncoder(w).Encode(body); eerr != nil {
		h.Log.Error("encode live conversation", "err", eerr)
	}
}

func (h *Handlers) streamLive() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t, ok := h.liveTarget(w, r)
		if !ok {
			return
		}
		relayLive(w, r, h.Live.Subscribe(r.Context(), t.ConversationID))
	}
}

// liveTee —— the visitor's response writer, with every frame also published to the conversation's
// feed. Flush passes through: the turn finds its flusher by type assertion.
type liveTee struct {
	http.ResponseWriter

	publish func([]byte)
}

func (t liveTee) Write(p []byte) (int, error) {
	t.publish(append([]byte(nil), p...))
	n, err := t.ResponseWriter.Write(p)
	if err != nil {
		return n, fmt.Errorf("live tee: %w", err)
	}
	return n, nil
}

func (t liveTee) Flush() {
	if f, ok := t.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap —— the real writer, for http.ResponseController. The turn extends its write deadline
// through the controller; without this the tee hid the writer ("feature not supported") and the
// server's 30s write timeout cut every slower answer off before it reached the visitor.
func (t liveTee) Unwrap() http.ResponseWriter { return t.ResponseWriter }

// teeTurn —— w copied to the turn's conversation feed, which first hears the question. A turn
// with no conversation, or an instance without a feed, streams to the visitor alone.
func teeTurn(
	h *Handlers, r *http.Request, w http.ResponseWriter, req *inference.AgentTurnRequest,
) http.ResponseWriter {
	if req.ConversationID == "" || h.Live.Publish == nil {
		return w
	}
	ctx, conv := context.WithoutCancel(r.Context()), req.ConversationID
	publish := func(frame []byte) { h.Live.Publish(ctx, conv, frame) }
	publish(turnFrame(req.UserMessage))
	return liveTee{ResponseWriter: w, publish: publish}
}

// turnFrame —— `event: turn` carrying the question: the owner's view opens a new exchange on it.
func turnFrame(question string) []byte {
	q, err := json.Marshal(map[string]string{"q": question})
	if err != nil {
		q = []byte(`{"q":""}`)
	}
	return []byte("event: turn\ndata: " + string(q) + "\n\n")
}
