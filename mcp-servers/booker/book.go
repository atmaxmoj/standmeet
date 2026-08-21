// book.go —— calendar_book 主流程,港自旧核心 usecases/calendar_book.go + capreg_booker_book.go。
// #135:逻辑在沙箱;外部走固定词表 —— 日历 insert/delete/freebusy 经 connector.invoke,预约存/数
// (配额)经 capstore,owner 时区经 owner.meta。结果 wire **字节对齐**旧 host(前端卡片照旧解)。

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	minDurationMin = 15
	maxDurationMin = 180
	bookingsColl   = "bookings"
)

type bookArgs struct {
	Topic          string      `json:"topic"`
	PreferredTimes []time.Time `json:"preferred_times"`
	DurationMin    int         `json:"duration_min"`
}

func validateBookArgs(a *bookArgs) error {
	if a.Topic == "" {
		return errors.New("missing topic")
	}
	if a.DurationMin < minDurationMin || a.DurationMin > maxDurationMin {
		return fmt.Errorf("duration_min must be %d–%d", minDurationMin, maxDurationMin)
	}
	if len(a.PreferredTimes) == 0 {
		return errors.New("preferred_times required")
	}
	return nil
}

// ── wire(与旧 capreg_booker_book.go 同键)──

type bookErrWire struct {
	Error  string `json:"error"`
	Detail string `json:"detail"`
	OK     bool   `json:"ok"`
}

// bookOKWire —— 预约成功的回执。**每个字段都要说话，包括"没有"那一种**。
//
// InvitedEmail 以前叫 VisitorEmail 且带 `omitempty`：访客没留邮箱时它整个消失，回执就只剩
// `{ok, event_id, html_link, start, end, can_email:true}`。而 can_email 说的是 owner **能不能**
// 发信，不是这一次**邀请了谁**。模型手上于是没有任何东西能反驳"邀请已经发出去了"——
// prompt 又告诉它"invite goes to the email the visitor entered (if they gave one)"——
// 它就从对话正文里捡了个地址，对访客说"日历邀请会发到 X"。真收件箱是空的，真事件一个
// 参会人都没有（F-B-6）。**省略不是 null**：字段永远在，空串就是"谁都没被邀请"。
type bookOKWire struct {
	EventID  string `json:"event_id"`
	HTMLLink string `json:"html_link"`
	Start    string `json:"start"`
	End      string `json:"end"`
	// InvitedEmail —— 这场会真正加进宾客名单、真正会收到邀请的那个地址；空串 = 没有人。
	InvitedEmail string `json:"invited_email"`
	OK           bool   `json:"ok"`
	CanEmail     bool   `json:"can_email"`
}

type busyWindow struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type bookFailWire struct {
	Conflict    string       `json:"conflict"`
	PolicyHint  string       `json:"policy_hint,omitempty"`
	BusyWindows []busyWindow `json:"busy_windows,omitempty"`
	OK          bool         `json:"ok"`
}

func bookErr(reason, detail string) string {
	return mustJSON(bookErrWire{OK: false, Error: reason, Detail: detail})
}

func bookFailResult(conflict, hint string, busy []busyInterval) string {
	wins := make([]busyWindow, 0, len(busy))
	for i := range busy {
		wins = append(wins, busyWindow{
			Start: busy[i].Start.Format(time.RFC3339),
			End:   busy[i].End.Format(time.RFC3339),
		})
	}
	if conflict != conflictAllBusy {
		wins = nil
	}
	return mustJSON(bookFailWire{OK: false, Conflict: conflict, PolicyHint: hint, BusyWindows: wins})
}

// insertedEvent —— connector.invoke insert_event 的响应(InsertedEvent json tags)。
type insertedEvent struct {
	EventID  string `json:"event_id"`
	HTMLLink string `json:"html_link"`
}

// bookingDoc —— 存进 booker capstore 的一笔预约(cancel 按 conversation 查、配额按主体数)。
type bookingDoc struct {
	OwnerID string `json:"owner_id"`
	// SubjectID / SubjectKind —— 这一笔是**谁**订的:一张邀请码,或一把对外 API key。
	// 宿主按 SubjectID 数用量(manifest 的 QuotaDecl.SubjectField)。以前这里只有 `code_id`,
	// 于是 key 那条路订的会没有主体可数,一次都不闸(F-B-11)。
	SubjectID      string    `json:"subject_id"`
	SubjectKind    string    `json:"subject_kind"`
	ConversationID string    `json:"conversation_id"`
	GoogleEventID  string    `json:"google_event_id"`
	GoogleHTMLLink string    `json:"google_html_link"`
	Summary        string    `json:"summary"`
	VisitorEmail   string    `json:"visitor_email"`
	StartAt        time.Time `json:"start_at"`
	EndAt          time.Time `json:"end_at"`
}

// doBook —— calendar_book 的沙箱实现。返回给 agent 的 wire JSON(含错误也是 {ok:false,...})。
func doBook(s session, rawArgs json.RawMessage) string {
	var args bookArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return bookErr("invalid_args", err.Error())
	}
	if verr := validateBookArgs(&args); verr != nil {
		return bookErr("invalid_args", verr.Error())
	}
	// 配额闸在 host 侧(composition root 读 booker capstore 计数,达上限直接隐藏 tool),
	// 所以走到这里就是还有额度 —— booker 不再自查。
	return runBook(s, &args)
}

func runBook(s session, args *bookArgs) string {
	policy, perr := loadPolicy(s.OwnerID)
	if perr != nil {
		return friendlyCalErr(perr)
	}
	tz, _ := gwOwnerMeta(s.OwnerID, "timezone")
	passed, worst := collectPassing(&policy, tz, args)
	if len(passed) == 0 {
		return bookFailResult(worst, policyHint(&policy, tz), nil)
	}
	span := freebusySpan(passed, args.DurationMin)
	busy, ferr := gwFreeBusy(s.OwnerID, span.min, span.max)
	if ferr != nil {
		return friendlyCalErr(ferr)
	}
	slot, ok := pickFreeSlot(passed, args.DurationMin, busy)
	if !ok {
		return bookFailResult(conflictAllBusy, policyHint(&policy, tz), busy)
	}
	return commitBooking(s, args, tz, slot)
}

// collectPassing —— 逐个 preferred_time 过 policy;返回通过的 + 最坏冲突原因(全不过时用)。
func collectPassing(policy *bookingPolicy, tz string, args *bookArgs) ([]time.Time, string) {
	var passed []time.Time
	worst := ""
	for _, t := range args.PreferredTimes {
		reason, err := evaluatePolicy(policy, tz, t, args.DurationMin)
		if err != nil {
			continue
		}
		if reason != "" {
			worst = reason
			continue
		}
		passed = append(passed, t)
	}
	return passed, worst
}

type spanRange struct{ min, max time.Time }

func freebusySpan(slots []time.Time, durationMin int) spanRange {
	r := spanRange{min: slots[0], max: slots[0]}
	for _, s := range slots {
		if s.Before(r.min) {
			r.min = s
		}
		if s.After(r.max) {
			r.max = s
		}
	}
	r.max = r.max.Add(time.Duration(durationMin) * time.Minute)
	return r
}

func pickFreeSlot(slots []time.Time, durationMin int, busy []busyInterval) (time.Time, bool) {
	dur := time.Duration(durationMin) * time.Minute
	for _, s := range slots {
		if !slotConflicts(s, dur, busy) {
			return s, true
		}
	}
	return time.Time{}, false
}

// commitBooking —— insert event → persist;persist 失败则补偿删事件(不留无预约的孤儿事件)。
func commitBooking(s session, args *bookArgs, tz string, slot time.Time) string {
	end := slot.Add(time.Duration(args.DurationMin) * time.Minute)
	summary := buildSummary(s.VisitorName, args.Topic)
	inserted, ierr := insertEvent(s, args, tz, slot, end, summary)
	if ierr != nil {
		return friendlyCalErr(ierr)
	}
	if perr := persistBooking(s, &inserted, summary, slot, end); perr != nil {
		compensateDelete(s, inserted.EventID)
		return friendlyCalErr(perr)
	}
	// #130 owner-notify:booking 已成立,通知是 best-effort 的尾巴 —— 失败只是没信。
	notifyOwnerOfBooking(s, &bookingDoc{
		OwnerID: s.OwnerID, SubjectID: s.SubjectID, SubjectKind: s.SubjectKind,
		GoogleEventID: inserted.EventID,
		Summary:       summary, VisitorEmail: s.VisitorEmail, StartAt: slot, EndAt: end,
	})
	return mustJSON(bookOKWire{
		OK: true, EventID: inserted.EventID, HTMLLink: inserted.HTMLLink,
		Start: slot.Format(time.RFC3339), End: end.Format(time.RFC3339),
		InvitedEmail: s.VisitorEmail, CanEmail: ownerCanEmail(s.OwnerID),
	})
}

func insertEvent(
	s session, args *bookArgs, tz string, slot, end time.Time, summary string,
) (insertedEvent, error) {
	req, _ := json.Marshal(map[string]any{
		"summary": summary, "description": args.Topic,
		"start": slot, "end": end, "time_zone": tz, "visitor_email": s.VisitorEmail,
	})
	resp, err := gwConnectorInvoke(s.OwnerID, "calendar", "insert_event", req)
	if err != nil {
		return insertedEvent{}, err
	}
	var ev insertedEvent
	if uerr := json.Unmarshal(resp, &ev); uerr != nil {
		return insertedEvent{}, fmt.Errorf("decode insert_event: %w", uerr)
	}
	return ev, nil
}

func persistBooking(s session, ev *insertedEvent, summary string, start, end time.Time) error {
	doc, _ := json.Marshal(bookingDoc{
		OwnerID: s.OwnerID, SubjectID: s.SubjectID, SubjectKind: s.SubjectKind,
		ConversationID: s.ConversationID,
		GoogleEventID:  ev.EventID, GoogleHTMLLink: ev.HTMLLink, Summary: summary,
		VisitorEmail: s.VisitorEmail, StartAt: start, EndAt: end,
	})
	if _, err := gwCapstoreInsert(bookingsColl, doc); err != nil {
		return err
	}
	return nil
}

func compensateDelete(s session, eventID string) {
	req, _ := json.Marshal(map[string]string{"event_id": eventID, "attendee_email": s.VisitorEmail})
	_, _ = gwConnectorInvoke(s.OwnerID, "calendar", "delete_event", req)
}

// ownerCanEmail —— owner 有没有可用 mail 连接器(决定确认信 widget 进不进卡)。
func ownerCanEmail(ownerID string) bool {
	resp, err := gwConnectorInvoke(ownerID, "mail", "connected", nil)
	if err != nil {
		return false
	}
	var r struct {
		Connected bool `json:"connected"`
	}
	return json.Unmarshal(resp, &r) == nil && r.Connected
}

// ownerCanBook —— owner 的日历授权写不写得进去(决定时段卡的 chip 能不能点)。
// 跟 ownerCanEmail 同一个形状:**做不到的动作不给入口**。
// 答不上来时按不能办:这一格宁可少给一个入口,也不要给一个按下去没结果的。
func ownerCanBook(ownerID string) bool {
	args, _ := json.Marshal(map[string]string{"operation": "events.insert"})
	resp, err := gwConnectorInvoke(ownerID, "calendar", "can_perform", args)
	if err != nil {
		return false
	}
	var r struct {
		Can bool `json:"can"`
	}
	return json.Unmarshal(resp, &r) == nil && r.Can
}

func buildSummary(visitorName, topic string) string {
	parts := make([]string, 0, 2)
	if visitorName != "" {
		parts = append(parts, visitorName)
	}
	parts = append(parts, topic)
	return strings.Join(parts, " — ")
}

// friendlyCalErr —— 底层错误一律友好降级,绝不把 socket/连接器内部错泄漏给访客。
func friendlyCalErr(err error) string {
	switch {
	case err != nil && strings.Contains(err.Error(), "not connected"):
		return bookErr("not_connected", "owner has not connected a calendar yet")
	default:
		return bookErr("calendar_unavailable",
			"the calendar service is temporarily unavailable — please try again later")
	}
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"ok":false,"error":"marshal_failed"}`
	}
	return string(b)
}
