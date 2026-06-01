// events_delete.go —— Events.delete. 拆出 events.go 守 max-public-structs=5
// (events.go 已经有 BusyWindow / FreeBusyInput / EventAttendee / InsertEventInput /
// InsertedEvent 5 个 exported struct，DeleteEventInput 装这里)。

package gcal

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
)

// DeleteEventInput —— params for Events.delete.
// SendUpdates controls whether Google emails attendees about cancellation
// ("all" if visitor_email present, "none" otherwise).
type DeleteEventInput struct {
	AccessToken string
	CalendarID  string
	EventID     string
	SendUpdates string
}

// DeleteEvent —— DELETE /calendars/{calendarId}/events/{eventId}. 204 on
// success; 404/410 if already gone — caller can treat as idempotent.
func (c *Client) DeleteEvent(ctx context.Context, in *DeleteEventInput) error {
	resp, err := c.calendarDelete(ctx, deleteEventPath(in), in.AccessToken)
	if err != nil {
		return err
	}
	derr := checkDeleteStatus(resp)
	if cerr := resp.Body.Close(); cerr != nil && derr == nil {
		return fmt.Errorf("gcal: close delete body: %w", cerr)
	}
	return derr
}

func deleteEventPath(in *DeleteEventInput) string {
	path := "/calendars/" + url.PathEscape(in.CalendarID) +
		"/events/" + url.PathEscape(in.EventID)
	if in.SendUpdates != "" {
		path += "?sendUpdates=" + url.QueryEscape(in.SendUpdates)
	}
	return path
}

// checkDeleteStatus —— 204 / 200 / 404 / 410 全 OK (idempotent —— 已经
// 没了也算成功)；其他非 success → error。
func checkDeleteStatus(resp *http.Response) error {
	switch resp.StatusCode {
	case http.StatusNoContent, http.StatusOK,
		http.StatusNotFound, http.StatusGone:
		return nil
	case http.StatusUnauthorized, http.StatusForbidden:
		return ErrUnauthorized
	}
	return statusError(resp)
}
