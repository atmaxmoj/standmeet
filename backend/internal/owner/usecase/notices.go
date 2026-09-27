// notices.go — what the owner domain's mail says. The content is the product's (StandMeet telling
// someone something), so it lives here; the subscribers that send it only render and hand it on.

package usecase

import (
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// NewRequestNotice — tells the owner someone asked for access: who asked and what they said, so
// they can decide whether to approve (which then issues and mails a code).
func NewRequestNotice(req *access.Request, ownerEmail, publicURL string) OutboundNotice {
	from := req.Email
	if req.Name != "" {
		from = req.Name + " <" + req.Email + ">"
	}
	body := "Someone requested access on your StandMeet page.\n\n" +
		"From:    " + from + "\n"
	if req.Org != "" {
		body += "Org:     " + req.Org + "\n"
	}
	body += "\nMessage:\n" + req.Message + "\n"
	if publicURL != "" {
		body += "\nReview and approve in your admin, or ask your AI:\n" +
			"    \"list my access requests\"\n"
	}
	body += "\nSent via StandMeet."
	return OutboundNotice{
		To:    ownerEmail,
		Title: "New access request from " + req.Email,
		Body:  body,
	}
}

// CodeLink — the page link with the code already filled in.
func CodeLink(publicURL, code string) string {
	return strings.TrimRight(publicURL, "/") + "?code=" + code
}

// ApprovalNotice — tells the requester they got a code, and the link that opens the conversation.
func ApprovalNotice(req *access.Request, code, link string) OutboundNotice {
	greeting := "Hi there,"
	if req.Name != "" {
		greeting = "Hi " + req.Name + ","
	}
	body := greeting + "\n\n" +
		"Your request for access has been approved. Here is your access code:\n\n" +
		"    " + code + "\n\n" +
		"Open this link to start the conversation (the code is already filled in):\n\n" +
		"    " + link + "\n\n" +
		"Sent via StandMeet."
	return OutboundNotice{
		To:    req.Email,
		Title: "Your access request has been approved",
		Body:  body,
	}
}

// EmailConfirmNotice — the confirmation link of a pending email change, sent to the **new**
// address: receiving it is what proves the address is real.
func EmailConfirmNotice(to, publicURL, token string) OutboundNotice {
	link := strings.TrimSuffix(publicURL, "/") + confirmPath + token
	return OutboundNotice{
		To:    to,
		Title: "Confirm your new StandMeet email",
		Body: strings.Join([]string{
			"Someone (probably you) asked to change the email on your StandMeet instance.",
			"",
			"Open this link to confirm — until you do, your sign-in and your recovery",
			"phrase both stay on the old address:",
			"",
			link,
			"",
			"The link works once and expires in 24 hours. If this wasn't you, ignore",
			"this message and nothing changes.",
		}, "\n"),
	}
}
