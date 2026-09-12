// Package mailer sends one message over SMTP.
//
// A leaf on purpose: pure stdlib (net/smtp), no internal imports, no knowledge of who is sending
// or why. The SMTP protocol supplier builds on it, decides the credentials, and owns everything
// about the owner's account; this package only renders RFC822 and puts it on the wire.
package mailer
