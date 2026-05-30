// visitor_chat_book_tool.go —— calendar.book tool spec + executor。
// 同样的 bundle 形态 as skillToolBundle / externalMCPBundle.
//
// Gating: bookerGatingPasses + connector connected + quota not exhausted.
// 都满足 specs() 才暴露 spec；否则 LLM 完全看不到 calendar.book。

package usecases

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
)

const (
	// BookerSkillName —— 标识符；access_codes.granted_skills 里出现这个就解锁。
	BookerSkillName = "calendar.book"

	minDurationMin = 15
	maxDurationMin = 180
)

// bookerBundle —— 实现 specs() + has() + execute()。
type bookerBundle struct {
	deps        *VisitorDeps
	in          *SendMessageInput
	owner       *domain.Owner
	visitorName string
	exposed     bool
}

// buildBookerBundle —— 评估 gating + 装 owner profile；gating 失败时返
// exposed=false 的 bundle (Specs/Has 都不暴露)。
func buildBookerBundle(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
) (*bookerBundle, error) {
	if !bookerGatingPasses(in) || deps.Calendar == nil {
		return &bookerBundle{deps: deps, in: in}, nil
	}
	return buildBookerBundleExposable(ctx, deps, in)
}

func buildBookerBundleExposable(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
) (*bookerBundle, error) {
	expose, err := canExposeBooker(ctx, deps, in)
	if err != nil {
		return nil, err
	}
	if !expose {
		return &bookerBundle{deps: deps, in: in}, nil
	}
	owner, oerr := deps.Owners.GetByID(ctx, in.OwnerID)
	if oerr != nil {
		return nil, fmt.Errorf("booker: load owner: %w", oerr)
	}
	return &bookerBundle{
		deps: deps, in: in, owner: &owner,
		visitorName: lookupVisitorName(ctx, deps, in),
		exposed:     true,
	}, nil
}

func canExposeBooker(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
) (bool, error) {
	conn, err := deps.Calendar.GetConnector(ctx, in.OwnerID, domain.CalendarProvider)
	if err != nil {
		return false, fmt.Errorf("booker: load connector: %w", err)
	}
	if !conn.Connected() {
		return false, nil
	}
	exhausted, qerr := bookerQuotaExhausted(ctx, deps, in)
	if qerr != nil {
		return false, qerr
	}
	return !exhausted, nil
}

func bookerGatingPasses(in *SendMessageInput) bool {
	if in.Mode != "code" || in.RoleSnapshot == nil {
		return false
	}
	// AllowedTools is the union of skill.allowed_tools across role's skills;
	// calendar.book is granted iff role has the booker skill attached with
	// that tool in its allow list.
	return slices.Contains(in.RoleSnapshot.AllowedTools(), BookerSkillName)
}

func bookerQuotaExhausted(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
) (bool, error) {
	if in.MaxBookings == nil || *in.MaxBookings <= 0 || in.CodeID == "" {
		return false, nil
	}
	count, err := deps.Calendar.CountBookingsForCode(ctx, in.CodeID)
	if err != nil {
		return false, fmt.Errorf("booker: count bookings: %w", err)
	}
	return count >= *in.MaxBookings, nil
}

func lookupVisitorName(ctx context.Context, deps *VisitorDeps, in *SendMessageInput) string {
	conv, err := deps.Conv.GetConversation(ctx, in.OwnerID, in.ConversationID)
	if err != nil {
		return ""
	}
	return conv.VisitorName
}

// Specs —— exposed=true 时暴露 calendar.book 的 ToolSpec。
func (b *bookerBundle) Specs() []inference.ToolSpec {
	if !b.exposed {
		return []inference.ToolSpec{}
	}
	return []inference.ToolSpec{{
		Name: BookerSkillName,
		Description: "Book a meeting on the owner's Google Calendar. " +
			"Only call after you have gathered topic, duration (15-180 minutes), " +
			"and one or more visitor-confirmed preferred start times in RFC3339 " +
			"format. Optionally include a visitor_email so Google sends the " +
			"calendar invite.",
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
	}}
}

// Has —— dispatcher 路由判断。
func (b *bookerBundle) Has(name string) bool {
	return b.exposed && name == BookerSkillName
}

// Execute —— 解 JSON → 调 BookMeeting → 序列化 BookResult。所有 error 都
// 翻成 tool-result string (包含失败原因)，不向外抛 panic / raw err。
func (b *bookerBundle) Execute(
	ctx context.Context, name string, input []byte,
) (string, error) {
	if name != BookerSkillName {
		return "", fmt.Errorf("booker: unknown tool %q", name)
	}
	args, err := decodeBookArgs(input)
	if err != nil {
		return marshalErrResult("invalid_args", err.Error()), nil
	}
	result, berr := BookMeeting(ctx, b.deps.GCal, b.deps.Calendar, &BookMeetingInput{
		PreferredTimes: args.PreferredTimes,
		OwnerID:        b.in.OwnerID,
		OwnerTZ:        b.owner.ProfileTimezone,
		CodeID:         b.in.CodeID,
		ConversationID: b.in.ConversationID,
		VisitorName:    b.visitorName,
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

// ───── result encoding ─────────────────────────────────────────

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

func marshalErrResult(reason, detail string) string {
	out, err := json.Marshal(bookErrWire{OK: false, Error: reason, Detail: detail})
	if err != nil {
		return `{"ok":false,"error":"marshal_failed"}`
	}
	return string(out)
}

func marshalBookErr(err error) string {
	switch {
	case errors.Is(err, domain.ErrCalendarNotConnected):
		return marshalErrResult("not_connected", "owner has not connected a calendar yet")
	case errors.Is(err, domain.ErrCalendarRevoked):
		return marshalErrResult("revoked", "owner calendar authorization has been revoked")
	default:
		return marshalErrResult("internal_error", err.Error())
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
