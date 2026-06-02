// agentskills_booker_book.go —— calendar_book tool 的 spec + decode +
// execute + marshal。从 agentskills_booker.go 拆出来守 max-lines 350 cap。

package usecases

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/inference"
)

func bookerToolSpec() inference.ToolSpec {
	return inference.ToolSpec{
		Name: toolCalendarBookName,
		Description: "Book a meeting on the owner's Google Calendar. " +
			"Only call after you have gathered topic, duration (15-180 minutes), " +
			"and one or more visitor-confirmed preferred start times in RFC3339 " +
			"format. Optionally include a visitor_email so Google sends the " +
			"calendar invite.",
		ProgressLabel: "booking meeting",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"topic":{"type":"string"},
				"duration_min":{"type":"integer","minimum":15,"maximum":180},
				"preferred_times":{
					"type":"array",
					"items":{"type":"string","description":"RFC3339"},
					"minItems":1
				},
				"visitor_email":{"type":"string","format":"email"}
			},
			"required":["topic","duration_min","preferred_times"]
		}`),
	}
}

func runBookerBook(
	ctx context.Context, deps *VisitorDeps, in *agentskills.AssembleInput,
	owner *domain.Owner, input []byte,
) (string, error) {
	args, derr := decodeBookArgs(input)
	if derr != nil {
		return marshalBookErrResult("invalid_args", derr.Error()), nil
	}
	result, berr := BookMeeting(ctx, deps.GCal, deps.Calendar, &BookMeetingInput{
		PreferredTimes: args.PreferredTimes,
		OwnerID:        in.OwnerID,
		OwnerTZ:        owner.ProfileTimezone,
		CodeID:         in.CodeID,
		ConversationID: in.ConversationID,
		VisitorName:    in.VisitorName,
		Topic:          args.Topic,
		VisitorEmail:   args.VisitorEmail,
		DurationMin:    args.DurationMin,
	})
	if berr != nil {
		return marshalBookErr(berr), nil
	}
	return marshalBookResult(&result), nil
}

type bookArgsWire struct {
	Topic          string      `json:"topic"`
	VisitorEmail   string      `json:"visitor_email"`
	PreferredTimes []time.Time `json:"preferred_times"`
	DurationMin    int         `json:"duration_min"`
}

func decodeBookArgs(input []byte) (bookArgsWire, error) {
	var args bookArgsWire
	if err := json.Unmarshal(input, &args); err != nil {
		return args, fmt.Errorf("decode args: %w", err)
	}
	if verr := validateBookArgs(&args); verr != nil {
		return args, verr
	}
	return args, nil
}

func validateBookArgs(args *bookArgsWire) error {
	if args.Topic == "" {
		return errors.New("missing topic")
	}
	if args.DurationMin < minDurationMin || args.DurationMin > maxDurationMin {
		return fmt.Errorf("duration_min must be %d–%d", minDurationMin, maxDurationMin)
	}
	if len(args.PreferredTimes) == 0 {
		return errors.New("preferred_times required")
	}
	return nil
}

// ───── result encoding —— 跟旧 bookerBundle 同 wire 格式不变 ───────

type bookErrWire struct {
	Error  string `json:"error"`
	Detail string `json:"detail"`
	OK     bool   `json:"ok"`
}

type bookOKWire struct {
	EventID  string `json:"event_id"`
	HTMLLink string `json:"html_link"`
	Start    string `json:"start"`
	End      string `json:"end"`
	OK       bool   `json:"ok"`
}

type bookFailWire struct {
	Conflict    string                  `json:"conflict"`
	PolicyHint  string                  `json:"policy_hint,omitempty"`
	BusyWindows []domain.BookBusyWindow `json:"busy_windows,omitempty"`
	OK          bool                    `json:"ok"`
}

func marshalBookErrResult(reason, detail string) string {
	out, err := json.Marshal(bookErrWire{OK: false, Error: reason, Detail: detail})
	if err != nil {
		return `{"ok":false,"error":"marshal_failed"}`
	}
	return string(out)
}

func marshalBookErr(err error) string {
	switch {
	case errors.Is(err, domain.ErrCalendarNotConnected):
		return marshalBookErrResult("not_connected", "owner has not connected a calendar yet")
	case errors.Is(err, domain.ErrCalendarRevoked):
		return marshalBookErrResult("revoked", "owner calendar authorization has been revoked")
	default:
		return marshalBookErrResult("internal_error", err.Error())
	}
}

func marshalBookResult(r *domain.BookResult) string {
	if r.OK {
		out, err := json.Marshal(bookOKWire{
			OK:       true,
			EventID:  r.EventID,
			HTMLLink: r.HTMLLink,
			Start:    r.Start.Format(time.RFC3339),
			End:      r.End.Format(time.RFC3339),
		})
		if err != nil {
			return `{"ok":false,"error":"marshal_failed"}`
		}
		return string(out)
	}
	out, err := json.Marshal(bookFailWire{
		OK:          false,
		Conflict:    string(r.Reason),
		PolicyHint:  r.PolicyHint,
		BusyWindows: r.BusyWindows,
	})
	if err != nil {
		return `{"ok":false,"error":"marshal_failed"}`
	}
	return string(out)
}
