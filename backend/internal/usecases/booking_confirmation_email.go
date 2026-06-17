// booking_confirmation_email.go —— #122 确认邮件模板:纯文字兜底 + HTML 正文,
// HTML 里嵌一段 schema.org JSON-LD(EventReservation)让 Gmail 渲染富预约卡片
// (顶部 highlight + "查看预约" 动作)。non-HTML / 不认 markup 的客户端退回
// HTML 卡片或纯文字,逐级 graceful。
//
// 注意:Gmail 把 markup 渲成原生高亮卡需要发件域名在 Google 注册过 schema.org
// 邮件白名单(+ 稳定 DKIM/SPF);没注册时这段 JSON-LD 被忽略,只看到我们自己的
// HTML 卡片。markup 先埋好,注册通过即自动生效。

package usecases

import (
	"encoding/json"
	"fmt"
	"html"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mailer"
)

// buildConfirmationEmail —— owner 口吻模板。时间按访客 tz(tz)渲,缺省退 owner tz。
func buildConfirmationEmail(
	b *domain.CodeBooking, owner *domain.Owner, tz string,
) mailer.Message {
	loc := confirmationLocation(tz, owner.ProfileTimezone)
	when := b.StartAt.In(loc).Format("Monday, Jan 2, 2006 · 3:04 PM MST")
	return mailer.Message{
		Subject: "Confirmed: " + b.Summary,
		Body:    confirmationText(b, owner, when),
		HTML:    confirmationHTML(b, owner, when, loc),
	}
}

// confirmationText —— 纯文字兜底(非 HTML 客户端)。
func confirmationText(b *domain.CodeBooking, owner *domain.Owner, when string) string {
	body := fmt.Sprintf("Hi,\n\nYour meeting is confirmed:\n\n  %s\n  %s\n",
		b.Summary, when)
	if b.GoogleHTMLLink != "" {
		body += "\nAdd it to your calendar: " + b.GoogleHTMLLink + "\n"
	}
	return body + "\n— sent on behalf of " + owner.FullName + "\n"
}

// confirmationHTML —— HTML 正文:<head> 里埋 schema.org JSON-LD,<body> 是一张
// 朴素卡片(serif 标题 + mono 元信息,跟产品 anti-SaaS 视觉一致)。
func confirmationHTML(
	b *domain.CodeBooking, owner *domain.Owner, when string, loc *time.Location,
) string {
	ld := confirmationJSONLD(b, loc)
	card := confirmationCard(b, owner, when)
	return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
		"<script type=\"application/ld+json\">" + ld + "</script></head>" +
		"<body style=\"margin:0;background:#F3EFE6;\">" + card + "</body></html>"
}

// confirmationCard —— 可见的 HTML 卡片(table 布局,邮件客户端兼容)。
func confirmationCard(b *domain.CodeBooking, owner *domain.Owner, when string) string {
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
		"— on behalf of " + html.EscapeString(owner.FullName) + "</td></tr>" +
		"</table></td></tr></table>"
}

// confirmationJSONLD —— schema.org EventReservation,Gmail 据此渲染预约卡片。
// 时间用 RFC3339(带 tz offset)满足 schema.org 的 ISO-8601 要求。
func confirmationJSONLD(b *domain.CodeBooking, loc *time.Location) string {
	ev := ldEvent{
		Type:      "Event",
		Name:      b.Summary,
		StartDate: b.StartAt.In(loc).Format(time.RFC3339),
		EndDate:   b.EndAt.In(loc).Format(time.RFC3339),
		URL:       b.GoogleHTMLLink,
	}
	res := ldReservation{
		Context:           "https://schema.org",
		Type:              "EventReservation",
		ReservationStatus: "https://schema.org/ReservationConfirmed",
		ReservationFor:    ev,
	}
	out, err := json.Marshal(res)
	if err != nil {
		return "{}" // 不该发生(纯值结构);兜底空对象,邮件其余部分照常
	}
	return string(out)
}

type ldEvent struct {
	Type      string `json:"@type"`
	Name      string `json:"name"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate,omitempty"`
	URL       string `json:"url,omitempty"`
}

type ldReservation struct {
	Context           string  `json:"@context"`
	Type              string  `json:"@type"`
	ReservationStatus string  `json:"reservationStatus"`
	ReservationFor    ldEvent `json:"reservationFor"`
}

// confirmationLocation —— 优先访客 tz,空/非法退 owner tz,再退 UTC。
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
