// cancel.go —— calendar_cancel + calendar_reschedule,港自旧 capreg_booker_cancel.go /
// _reschedule.go。隔离靠 host 种的 ConversationID(非 LLM 控):只动**本对话**那笔预约。
// 取消 = 删日历事件 + 删 booker capstore 记录;改期 = 先订新(不计配额,是移动)→成了再删旧。

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type cancelArgs struct {
	EventID string `json:"event_id"`
}

type rescheduleArgs struct {
	EventID        string      `json:"event_id"`
	PreferredTimes []time.Time `json:"preferred_times"`
	DurationMin    int         `json:"duration_min"`
}

// resolveConvBooking —— 本对话最近一笔预约 + 防御性校 event_id 归属。errWire 非空 = 直接回。
func resolveConvBooking(s session, eventID string) (bookingDoc, string) {
	filter, _ := json.Marshal(map[string]string{"conversation_id": s.ConversationID})
	recs, err := gwCapstoreQuery(bookingsColl, filter)
	if err != nil {
		return bookingDoc{}, bookErr("cancel_failed",
			"couldn't reach the booking right now — please try again later")
	}
	if len(recs) == 0 {
		return bookingDoc{}, bookErr("booking_not_found", "no booking found to cancel")
	}
	latest := latestBooking(recs)
	if eventID != "" && eventID != latest.GoogleEventID {
		return bookingDoc{}, bookErr("booking_not_found", "no matching booking to cancel")
	}
	return latest, ""
}

func latestBooking(recs []json.RawMessage) bookingDoc {
	var latest bookingDoc
	for i := range recs {
		var b bookingDoc
		if json.Unmarshal(recs[i], &b) != nil {
			continue
		}
		if b.StartAt.After(latest.StartAt) {
			latest = b
		}
	}
	return latest
}

// deleteBooking —— 删日历事件 + 删 capstore 记录(按 conversation + event_id 精确删,不误伤别笔)。
func deleteBooking(ownerID string, b *bookingDoc) error {
	delReq, _ := json.Marshal(map[string]string{
		"event_id": b.GoogleEventID, "attendee_email": b.VisitorEmail,
	})
	if _, err := gwConnectorInvoke(ownerID, "calendar", "delete_event", delReq); err != nil {
		return err
	}
	filter, _ := json.Marshal(map[string]string{
		"conversation_id": b.ConversationID, "google_event_id": b.GoogleEventID,
	})
	if _, err := gwCapstoreDelete(bookingsColl, filter); err != nil {
		return err
	}
	return nil
}

func doCancel(s session, rawArgs json.RawMessage) string {
	var args cancelArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return bookErr("invalid_args", err.Error())
	}
	booking, ew := resolveConvBooking(s, args.EventID)
	if ew != "" {
		return ew
	}
	if derr := deleteBooking(s.OwnerID, &booking); derr != nil {
		return bookErr("cancel_failed",
			"couldn't cancel the meeting right now — please try again later")
	}
	return `{"ok":true,"cancelled":true}`
}

func validateRescheduleArgs(a *rescheduleArgs) error {
	if len(a.PreferredTimes) == 0 {
		return errors.New("preferred_times required")
	}
	if a.DurationMin < minDurationMin || a.DurationMin > maxDurationMin {
		return fmt.Errorf("duration_min must be %d–%d", minDurationMin, maxDurationMin)
	}
	return nil
}

func doReschedule(s session, rawArgs json.RawMessage) string {
	var args rescheduleArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return bookErr("invalid_args", err.Error())
	}
	if verr := validateRescheduleArgs(&args); verr != nil {
		return bookErr("invalid_args", verr.Error())
	}
	old, ew := resolveConvBooking(s, args.EventID)
	if ew != "" {
		return ew
	}
	// 订新:不计配额(移动,不是新增);topic 沿用旧 summary、VisitorName 置空(不重复前缀)。
	s2 := s
	s2.VisitorName = ""
	wire := runBook(s2, &bookArgs{
		Topic: old.Summary, PreferredTimes: args.PreferredTimes, DurationMin: args.DurationMin,
	})
	if !wireOK(wire) {
		return wire // 冲突/政策/全忙:原预约不动,失败原样返
	}
	_ = deleteBooking(s.OwnerID, &old) // best-effort:新已成,删旧失败也不回滚(宁留 stray 旧 event)
	return wire
}

// wireOK —— 解 wire 的 {ok} 字段。
func wireOK(wire string) bool {
	var r struct {
		OK bool `json:"ok"`
	}
	return json.Unmarshal([]byte(wire), &r) == nil && r.OK
}
