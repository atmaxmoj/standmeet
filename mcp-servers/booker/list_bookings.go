// list_bookings.go —— owner 面的 bookings_list:列这个 owner 已经约成的会。
//
// 为什么在沙箱:约成的会存在 booker **自己的**隔离存储里,是 booker 的数据。
// host 那边曾经有一条 admin REST 路由直接去查这份存储(admin/bookings.go +
// booking_store_deps.go + 一个 CodeBooking 类型)—— 那是 host 认识了 booker 的数据形状。
//
// 以前搬不过来的原因很具体:列表要带**记录 id**(取消时按 id 找),而 reach-back 的固定词表
// 里只有 insert/query/count/delete,没有"查询并带回 id"。补上 capstore.query_records 之后
// 这条就通了。

package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"
)

const (
	listBookingsDefaultLimit = 50
	listBookingsMaxLimit     = 200
)

type listBookingsArgs struct {
	Limit int `json:"limit"`
}

// bookingRow —— 出站的一条预约。id 是记录 id,取消时按它找。
type bookingRow struct {
	ID             string `json:"id"`
	StartAt        string `json:"start_at"`
	EndAt          string `json:"end_at"`
	Summary        string `json:"summary"`
	VisitorEmail   string `json:"visitor_email"`
	CodeID         string `json:"code_id"`
	ConversationID string `json:"conversation_id"`
	GoogleEventID  string `json:"google_event_id,omitempty"`
	GoogleHTMLLink string `json:"google_html_link,omitempty"`
}

// doListBookings —— 按 owner 列已约的会,最近的在前。
func doListBookings(s session, rawArgs json.RawMessage) string {
	args := listBookingsArgs{Limit: listBookingsDefaultLimit}
	if len(rawArgs) > 0 {
		if err := json.Unmarshal(rawArgs, &args); err != nil {
			return bookErr("invalid_args", err.Error())
		}
	}
	rows, err := loadBookings(s.OwnerID, clampListLimit(args.Limit))
	if err != nil {
		return bookErr("list_failed", err.Error())
	}
	out, merr := json.Marshal(map[string][]bookingRow{"bookings": rows})
	if merr != nil {
		return bookErr("list_failed", "encode bookings: "+merr.Error())
	}
	return string(out)
}

func clampListLimit(n int) int {
	if n <= 0 {
		return listBookingsDefaultLimit
	}
	if n > listBookingsMaxLimit {
		return listBookingsMaxLimit
	}
	return n
}

func loadBookings(ownerID string, limit int) ([]bookingRow, error) {
	filter, merr := json.Marshal(map[string]string{"owner_id": ownerID})
	if merr != nil {
		return nil, fmt.Errorf("bookings filter: %w", merr)
	}
	recs, err := gwCapstoreQueryRecords(bookingsColl, filter)
	if err != nil {
		return nil, err
	}
	rows := make([]bookingRow, 0, len(recs))
	for i := range recs {
		var doc bookingDoc
		if uerr := json.Unmarshal(recs[i].Doc, &doc); uerr != nil {
			continue // 单条坏文档不该让整张列表打不开
		}
		rows = append(rows, toBookingRow(recs[i].ID, &doc))
	}
	sort.Slice(rows, func(a, b int) bool { return rows[a].StartAt > rows[b].StartAt })
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}

func toBookingRow(id string, d *bookingDoc) bookingRow {
	return bookingRow{
		ID: id, Summary: d.Summary, VisitorEmail: d.VisitorEmail,
		CodeID: d.CodeID, ConversationID: d.ConversationID,
		GoogleEventID: d.GoogleEventID, GoogleHTMLLink: d.GoogleHTMLLink,
		StartAt: d.StartAt.UTC().Format(time.RFC3339),
		EndAt:   d.EndAt.UTC().Format(time.RFC3339),
	}
}
