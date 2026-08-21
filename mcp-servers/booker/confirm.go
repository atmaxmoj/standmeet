// confirm.go —— send_confirmation,港自旧 booking_confirmation*.go。定位本对话最近一笔预约 →
// 校归属(owner+code)→ 幂等(confirmations marker,一笔一次)→ 挑收件人(透传/引用 session
// email)→ 渲确认信(text + HTML + schema.org JSON-LD)→ 经 connector.invoke("mail","send") 发。
// 收件人硬控在 host 侧值(session email / 卡里改写地址),LLM 不经手。

package main

import (
	"encoding/json"
	"fmt"
	"html"
	"net/mail"
	"time"
)

const confirmationsColl = "confirmations"

type sendConfirmationArgs struct {
	Recipient string `json:"recipient"`
	TZ        string `json:"tz"`
}

// confirmationMarker —— 已发确认信的标记(按 event_id 一笔一记,做幂等)。
type confirmationMarker struct {
	GoogleEventID  string `json:"google_event_id"`
	ConversationID string `json:"conversation_id"`
}

func doSendConfirmation(s session, rawArgs json.RawMessage) string {
	var args sendConfirmationArgs
	if err := json.Unmarshal(rawArgs, &args); err != nil {
		return bookErr("invalid_args", err.Error())
	}
	booking, ew := resolveConfirmBooking(s)
	if ew != "" {
		return ew
	}
	to, rew := pickRecipient(args.Recipient, s.VisitorEmail)
	if rew != "" {
		return rew
	}
	return deliverConfirmation(s, &booking, to, args.TZ)
}

func resolveConfirmBooking(s session) (bookingDoc, string) {
	filter, _ := json.Marshal(map[string]string{"conversation_id": s.ConversationID})
	recs, err := gwCapstoreQuery(bookingsColl, filter)
	if err != nil {
		return bookingDoc{}, bookErr("send_failed", "couldn't reach the booking — please try again later")
	}
	if len(recs) == 0 {
		return bookingDoc{}, bookErr("booking_not_found", "no booking found for this conversation")
	}
	b := latestBooking(recs)
	// 同一个 owner **且**同一个主体才认:换一张码 / 换一把 key 进来的人不该给别人的预约发信。
	if b.OwnerID != s.OwnerID || b.SubjectID != s.SubjectID {
		return bookingDoc{}, bookErr("booking_not_found", "no booking found for this conversation")
	}
	return b, ""
}

func pickRecipient(passthrough, sessionEmail string) (string, string) {
	to := passthrough
	if to == "" {
		to = sessionEmail
	}
	if _, perr := mail.ParseAddress(to); to == "" || perr != nil {
		return "", bookErr("no_recipient", "no email address to send the confirmation to")
	}
	return to, ""
}

// deliverConfirmation —— 幂等 claim(插 marker)→ 发信 → 失败则 release(删 marker,可重试)。
func deliverConfirmation(s session, b *bookingDoc, to, tz string) string {
	if sent, cerr := confirmationSent(b.GoogleEventID); cerr != nil {
		return bookErr("send_failed", "couldn't send the confirmation right now — please try again later")
	} else if sent {
		return bookErr("already_sent", "confirmation already sent for this booking")
	}
	marker, _ := json.Marshal(confirmationMarker{
		GoogleEventID: b.GoogleEventID, ConversationID: b.ConversationID,
	})
	if _, ierr := gwCapstoreInsert(confirmationsColl, marker); ierr != nil {
		return bookErr("send_failed", "couldn't send the confirmation right now — please try again later")
	}
	if serr := sendConfirmationMail(s.OwnerID, b, to, tz); serr != "" {
		releaseConfirmation(b.GoogleEventID)
		return serr
	}
	return `{"ok":true}`
}

func confirmationSent(eventID string) (bool, error) {
	filter, _ := json.Marshal(map[string]string{"google_event_id": eventID})
	n, err := gwCapstoreCount(confirmationsColl, filter)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func releaseConfirmation(eventID string) {
	filter, _ := json.Marshal(map[string]string{"google_event_id": eventID})
	_, _ = gwCapstoreDelete(confirmationsColl, filter)
}

// sendConfirmationMail —— 渲信 + 经 mail 连接器发。返回 errWire(空 = 成功)。
func sendConfirmationMail(ownerID string, b *bookingDoc, to, tz string) string {
	ownerName, _ := gwOwnerMeta(ownerID, "full_name")
	ownerTZ, _ := gwOwnerMeta(ownerID, "timezone")
	msg := buildConfirmationEmail(b, ownerName, tz, ownerTZ)
	msg["to"] = to
	payload, _ := json.Marshal(msg)
	if _, err := gwConnectorInvoke(ownerID, "mail", "send", payload); err != nil {
		return mailSendErr(err)
	}
	return ""
}

// mailSendErr —— **两种失败，两句话**（F-C-42）。
//
// 以前这里对任何错误都说「owner 还没配邮件」。owner 配了、只是这一刻拨不通的时候，
// 那句话对访客是**假的**，而且它顺带把 owner 的配置状态说了出去。
// 现在按 host 给的类别分岔：类别丢了（老 host / 没带 code）就走保守的那一支 ——
// 说「现在发不出去」永远不会撒谎，说「没配过」会。
func mailSendErr(err error) string {
	if faultCode(err) == faultNotConfigured {
		return bookErr("mail_not_configured", "the owner hasn't set up email yet")
	}
	return bookErr("mail_send_failed",
		"couldn't send the confirmation right now — the booking is still yours; try again in a bit")
}

// ── 邮件模板(港自 booking_confirmation_email.go)──

func buildConfirmationEmail(b *bookingDoc, ownerName, visitorTZ, ownerTZ string) map[string]string {
	loc := confirmationLocation(visitorTZ, ownerTZ)
	when := b.StartAt.In(loc).Format("Monday, Jan 2, 2006 · 3:04 PM MST")
	return map[string]string{
		"subject": "Confirmed: " + b.Summary,
		"body":    confirmationText(b, ownerName, when),
		"html":    confirmationHTML(b, ownerName, when, loc),
	}
}

func confirmationText(b *bookingDoc, ownerName, when string) string {
	body := fmt.Sprintf("Hi,\n\nYour meeting is confirmed:\n\n  %s\n  %s\n", b.Summary, when)
	if b.GoogleHTMLLink != "" {
		body += "\nAdd it to your calendar: " + b.GoogleHTMLLink + "\n"
	}
	return body + "\n— sent on behalf of " + ownerName + "\n"
}

func confirmationHTML(b *bookingDoc, ownerName, when string, loc *time.Location) string {
	ld := confirmationJSONLD(b, loc)
	card := confirmationCard(b, ownerName, when)
	return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
		"<script type=\"application/ld+json\">" + ld + "</script></head>" +
		"<body style=\"margin:0;background:#F3EFE6;\">" + card + "</body></html>"
}

func confirmationCard(b *bookingDoc, ownerName, when string) string {
	summary := html.EscapeString(b.Summary)
	whenEsc := html.EscapeString(when)
	link := ""
	if b.GoogleHTMLLink != "" {
		link = "<p style=\"margin:12px 0 0;font:12px monospace;\">" +
			"<a href=\"" + html.EscapeString(b.GoogleHTMLLink) +
			"\" style=\"color:#B5391C;\">open in google calendar →</a></p>"
	}
	return "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">" +
		"<tr><td align=\"center\" style=\"padding:32px 16px;\">" +
		"<table role=\"presentation\" width=\"480\" cellpadding=\"0\" cellspacing=\"0\" " +
		"style=\"background:#fff;border-left:3px solid #B5391C;padding:24px;\">" +
		"<tr><td style=\"font:11px monospace;letter-spacing:0.16em;" +
		"text-transform:uppercase;color:#9b8f80;\">booking confirmed</td></tr>" +
		"<tr><td style=\"font:italic 20px Georgia,serif;color:#1B1814;padding:6px 0 4px;\">" +
		summary + "</td></tr>" +
		"<tr><td style=\"font:13px monospace;color:#1B1814;\">" + whenEsc + "</td></tr>" +
		"<tr><td>" + link + "</td></tr>" +
		"<tr><td style=\"font:11px monospace;color:#9b8f80;padding-top:16px;\">" +
		"— on behalf of " + html.EscapeString(ownerName) + "</td></tr>" +
		"</table></td></tr></table>"
}

type ldVirtualLocation struct {
	Type string `json:"@type"`
	URL  string `json:"url,omitempty"`
}

type ldEvent struct {
	Location  *ldVirtualLocation `json:"location,omitempty"`
	Type      string             `json:"@type"`
	Name      string             `json:"name"`
	StartDate string             `json:"startDate"`
	EndDate   string             `json:"endDate,omitempty"`
	URL       string             `json:"url,omitempty"`
}

type ldReservation struct {
	ReservationFor    ldEvent `json:"reservationFor"`
	Context           string  `json:"@context"`
	Type              string  `json:"@type"`
	ReservationStatus string  `json:"reservationStatus"`
	ReservationNumber string  `json:"reservationNumber"`
}

func confirmationJSONLD(b *bookingDoc, loc *time.Location) string {
	ev := ldEvent{
		Type: "Event", Name: b.Summary,
		StartDate: b.StartAt.In(loc).Format(time.RFC3339),
		EndDate:   b.EndAt.In(loc).Format(time.RFC3339),
		URL:       b.GoogleHTMLLink,
	}
	if b.GoogleHTMLLink != "" {
		ev.Location = &ldVirtualLocation{Type: "VirtualLocation", URL: b.GoogleHTMLLink}
	}
	out, err := json.Marshal(ldReservation{
		Context: "https://schema.org", Type: "EventReservation",
		ReservationStatus: "https://schema.org/ReservationConfirmed",
		ReservationNumber: b.GoogleEventID, ReservationFor: ev,
	})
	if err != nil {
		return "{}"
	}
	return string(out)
}

func confirmationLocation(visitorTZ, ownerTZ string) *time.Location {
	for _, name := range []string{visitorTZ, ownerTZ} {
		if name == "" {
			continue
		}
		if loc, err := time.LoadLocation(name); err == nil {
			return loc
		}
	}
	return time.UTC
}
