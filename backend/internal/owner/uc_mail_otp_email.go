// mail_otp_email.go —— StandMeet-branded HTML for the verification email. Email
// clients don't load web fonts or honour <style> reliably, so everything is a
// table layout with inline styles + web-safe fonts (Georgia serif, Courier mono)
// in the brand palette (cream paper / ink / vermillion).

package owner

import (
	"strconv"
	"strings"
)

const otpEmailTmpl = "<!DOCTYPE html><html>" +
	"<body style=\"margin:0;padding:0;background:#F3EFE6;\">" +
	"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" " +
	"style=\"background:#F3EFE6;\"><tr>" +
	"<td align=\"center\" style=\"padding:40px 16px;\">" +
	"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" " +
	"style=\"width:100%;max-width:460px;background:#FBFAF6;" +
	"border:1px solid #DAD3C4;border-radius:4px;\"><tr>" +
	"<td style=\"padding:34px 38px;font-family:Georgia,'Times New Roman',serif;" +
	"color:#1B1814;\">" +
	"<div style=\"font-family:'Courier New',Courier,monospace;font-size:11px;" +
	"letter-spacing:3px;text-transform:uppercase;color:#B5391C;\">standmeet</div>" +
	"<h1 style=\"font-size:23px;font-weight:normal;margin:20px 0 8px;" +
	"color:#1B1814;\">Verify your email</h1>" +
	"<p style=\"font-size:15px;line-height:1.55;color:#6B6256;margin:0 0 26px;\">" +
	"Enter this code under <strong style=\"color:#1B1814;\">admin &rarr; Connectors" +
	"</strong> to confirm your outbound email is working.</p>" +
	"<div style=\"font-family:'Courier New',Courier,monospace;font-size:36px;" +
	"font-weight:bold;letter-spacing:10px;color:#1B1814;background:#F3EFE6;" +
	"border:1px solid #DAD3C4;border-radius:3px;padding:20px 0;text-align:center;\">" +
	"{{CODE}}</div>" +
	"<p style=\"font-size:12.5px;line-height:1.5;color:#9A9285;margin:22px 0 0;\">" +
	"This code expires in {{MIN}} minutes. " +
	"If you didn&rsquo;t request it, you can ignore this email.</p>" +
	"</td></tr></table>" +
	"<div style=\"font-family:'Courier New',Courier,monospace;font-size:10px;" +
	"letter-spacing:1.5px;color:#B3AC9E;margin-top:18px;\">" +
	"standmeet &middot; self-hosted</div>" +
	"</td></tr></table></body></html>"

// otpEmailHTML —— fill the template with the code + expiry minutes.
func otpEmailHTML(code string, expiryMin int) string {
	h := strings.ReplaceAll(otpEmailTmpl, "{{CODE}}", code)
	return strings.ReplaceAll(h, "{{MIN}}", strconv.Itoa(expiryMin))
}
