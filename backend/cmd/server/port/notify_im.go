// notify_im.go —— the IM channel of notification rules
// (docs/design/notify-rules-and-live-transcript.md): the card goes to the bridge's internal
// endpoint, which posts it to the owner's chat.

package port

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

const (
	// imBridgeHost —— the bridge inside the compose network (port never published). Plaintext http
	// inside the private network is deliberate, as for the other internal services (config.go).
	imBridgeHost    = "im-bridge:8090"
	imBridgeTimeout = 10 * time.Second
)

// NotifyIMSender —— one attempt per delivery job (the job layer owns retry). A deployment without
// the bridge fails the card, which is retried, then recorded on the job.
func NotifyIMSender() owner.NotifyIMSender {
	client := httpx.NewClient(httpx.Options{Timeout: imBridgeTimeout, NoRetry: true})
	target := (&url.URL{Scheme: "http", Host: imBridgeHost, Path: "/internal/notify"}).String()
	return func(ctx context.Context, platform, chatID string, card *owner.NotifyCard) error {
		body, err := json.Marshal(map[string]string{
			"platform": platform, "chat_id": chatID, "text": card.Text,
			"link": card.Link, "link_label": card.LinkLabel,
		})
		if err != nil {
			return jobs.Discard(err)
		}
		return postCard(ctx, client, target, body)
	}
}

func postCard(ctx context.Context, client *http.Client, target string, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return jobs.Discard(err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("im bridge: %w", err)
	}
	status := res.StatusCode
	if cerr := res.Body.Close(); cerr != nil {
		return fmt.Errorf("im bridge: %w", cerr)
	}
	if status >= http.StatusMultipleChoices {
		return fmt.Errorf("im bridge answered %d", status)
	}
	return nil
}
