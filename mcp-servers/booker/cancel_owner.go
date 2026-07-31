// cancel_owner.go —— owner 面的取消:按**预约 id** 取消一条已约的会。
//
// 为什么在沙箱:删一条预约 = 删日历事件 + 删自己存储里那一行,两步都是 booker 的事。
// host 那边曾经把这两步又实现了一遍(uc_booking_cancel.go / uc_booking_cancel_own.go /
// ownercore 的 cap_calendar),只有"怎么找到那一行"不同 —— owner 按 booking id 找,
// 访客按会话 + 事件 id 找。
//
// 这份重复的根子是机制缺口:沙箱以前拿不到自己记录的 id(reach-back 的固定词表里
// 只有 insert/query/count/delete),所以"按 id 取消"host 只能自己写。
// 补上 capstore.query_records / delete_by_id 之后,这里就能用 booker 自己的 deleteBooking。

package main

import (
	"encoding/json"
	"errors"
	"fmt"
)

// errBookingNotFound —— 按 id 没找到这个 owner 的那一条。不区分"不存在"和"不是你的":
// 两者都不该泄露存在性。
var errBookingNotFound = errors.New("booking not found")

type cancelByIDArgs struct {
	BookingID string `json:"booking_id"`
}

// doCancelByID —— owner 取消一条预约。找不到就是找不到(不区分"不存在"和"不是你的",
// 两者都不该泄露存在性)。
func doCancelByID(s session, rawArgs json.RawMessage) string {
	var args cancelByIDArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return bookErr("invalid_args", err.Error())
	}
	if args.BookingID == "" {
		return bookErr("invalid_args", "booking_id is required")
	}
	rec, doc, err := findOwnedBooking(s.OwnerID, args.BookingID)
	if err != nil {
		return bookErr("not_found", err.Error())
	}
	if derr := deleteBookingByRecord(s.OwnerID, rec, doc); derr != nil {
		return bookErr("cancel_failed", derr.Error())
	}
	out, merr := json.Marshal(map[string]any{"ok": true, "booking_id": args.BookingID})
	if merr != nil {
		return bookErr("cancel_failed", merr.Error())
	}
	return string(out)
}

// findOwnedBooking —— 按 id 找这个 owner 的那一条。owner_id 一并进过滤条件:
// 别人的 id 猜中了也拿不到。
func findOwnedBooking(ownerID, bookingID string) (string, *bookingDoc, error) {
	filter, merr := json.Marshal(map[string]string{"owner_id": ownerID})
	if merr != nil {
		return "", nil, fmt.Errorf("bookings filter: %w", merr)
	}
	recs, err := gwCapstoreQueryRecords(bookingsColl, filter)
	if err != nil {
		return "", nil, err
	}
	for i := range recs {
		if recs[i].ID != bookingID {
			continue
		}
		var doc bookingDoc
		if uerr := json.Unmarshal(recs[i].Doc, &doc); uerr != nil {
			return "", nil, fmt.Errorf("decode booking: %w", uerr)
		}
		return recs[i].ID, &doc, nil
	}
	return "", nil, errBookingNotFound
}

// deleteBookingByRecord —— 删日历事件 + 按记录 id 删自己那一行。
//
// 跟 deleteBooking(会话侧)是同一件事,只是删存储那步按 id 而不是按过滤条件 ——
// 找法不同,做法只有一份。
func deleteBookingByRecord(ownerID, recordID string, b *bookingDoc) error {
	delReq, merr := json.Marshal(map[string]string{
		"event_id": b.GoogleEventID, "attendee_email": b.VisitorEmail,
	})
	if merr != nil {
		return fmt.Errorf("delete request: %w", merr)
	}
	if _, err := gwConnectorInvoke(ownerID, "calendar", "delete_event", delReq); err != nil {
		return err
	}
	if _, err := gwCapstoreDeleteByID(bookingsColl, recordID); err != nil {
		return err
	}
	return nil
}
