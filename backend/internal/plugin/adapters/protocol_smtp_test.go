// protocol_smtp_test.go — backend-internal unit test: the SMTP protocol supplier actually
// implements MailProxy, not configured → friendly ErrMailNotConfigured, connection state
// delegates to vault. Real sending (net/smtp) is covered by e2e.

package adapters

import (
	"context"
	"errors"
	"testing"
)

type fakeSMTPVault struct {
	cfg       SMTPConfig
	connected bool
}

func (v *fakeSMTPVault) Connected(_ context.Context, _, _ string) (bool, error) {
	return v.connected, nil
}

func (v *fakeSMTPVault) SMTPConfig(_ context.Context, _, _ string) (SMTPConfig, error) {
	return v.cfg, nil
}

func TestSMTPSupplier_NotConfigured_Friendly(t *testing.T) {
	t.Parallel()
	c := NewSMTPSupplier("smtp", &fakeSMTPVault{})
	mp, ok := c.(MailProxy)
	if !ok {
		t.Fatalf("smtp supplier is not a MailProxy: %T", c)
	}
	_, err := mp.Send(context.Background(), "owner-1", MailMessage{
		To: "v@example.com", Subject: "hi", Body: "hello",
	})
	if !errors.Is(err, ErrMailNotConfigured) {
		t.Fatalf("unconfigured send should be ErrMailNotConfigured, got %v", err)
	}
}

func TestSMTPSupplier_ConnectedDelegates(t *testing.T) {
	t.Parallel()
	c := NewSMTPSupplier("smtp", &fakeSMTPVault{connected: true})
	ok, err := c.Connected(context.Background(), "owner-1")
	if err != nil || !ok {
		t.Fatalf("Connected should delegate true, got ok=%v err=%v", ok, err)
	}
}
