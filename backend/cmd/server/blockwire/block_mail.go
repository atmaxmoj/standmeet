// block_mail.go — the substrate mechanism that lets a sandbox_stdio MCP block SERVE the mail seam.
// The sibling of block_calendar.go, and the same shape: it IS a MailProxy (so a mailer caller's
// supplier.invoke("mail",…) resolves to it like any supplier), and it implements each mail op by
// dialing the block and calling its MCP tool through the generic blockseam.Provider. The owner's
// stored connect-form values are an OPAQUE blob merged in by the provider; the host names no field.
//
// Mail used to be an in-host protocol supplier (net/smtp). It is a block now (SMTP is an app on a
// protocol, like CalDAV is an app on HTTP): the block owns the SMTP dialogue AND its error
// classification — the friendly auth/tls/connect sentence rides in the tool error's text, which the
// admin surfaces verbatim (verifyReason). One dial per op (sandbox-lives-one-turn).

package blockwire

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockseam"
	"github.com/atmaxmoj/standmeet/internal/plugin/mount"
)

// blockMailProxy — a mail-seam supplier backed by an MCP block. Still a typed MailProxy (so a
// mailer caller resolves to it), but the merge→dial→call plumbing lives in the blockseam.Provider;
// this proxy is only the typed translation layer on top of it. Nothing here is provider-specific.
type blockMailProxy struct {
	vault blockCredVault
	seam  *blockseam.Provider
	id    string
}

func newBlockMailProxy(m *plugin.Manifest, vault blockCredVault) *blockMailProxy {
	dial := func(ctx context.Context, mm *plugin.Manifest) (blockseam.Session, error) {
		return mount.DialBlock(ctx, mm)
	}
	return &blockMailProxy{vault: vault, seam: blockseam.New(m, vault, dial), id: m.ID}
}

// sendArgs — the send operation's own fields (the owner's credentials are merged in separately, as
// an opaque blob). Keys match the block's `send` tool inputSchema.
type sendArgs struct {
	To      string `json:"to"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
	HTML    string `json:"html,omitempty"`
}

// sendReply — the block's `send` tool result shape: { id }.
type sendReply struct {
	ID string `json:"id"`
}

// Name / Kind / Connected — the Supplier base surface. Kind "block": served by an MCP block, not an
// in-host protocol impl or an openapi spec.
func (p *blockMailProxy) Name() string { return p.id }
func (*blockMailProxy) Kind() string   { return "block" }

func (p *blockMailProxy) Connected(ctx context.Context, ownerID string) (bool, error) {
	return p.vault.Connected(ctx, p.id, ownerID)
}

// Verify — the connection test (Verifier): call the block's `verify` tool with the owner's creds.
// A failure surfaces the block's friendly, classified sentence (auth/tls/connect) via the fault.
func (p *blockMailProxy) Verify(ctx context.Context, ownerID string) error {
	_, err := p.seam.CallVerb(ctx, ownerID, "verify", nil)
	return err
}

// Send — call the block's `send` tool; map its { id } back to the receipt's ProviderID (empty is a
// valid answer — SMTP has no promised id, [[empty-is-not-json-null]]).
func (p *blockMailProxy) Send(
	ctx context.Context, ownerID string, msg adapters.MailMessage,
) (adapters.MailReceipt, error) {
	opArgs, merr := json.Marshal(sendArgs{
		To: msg.To, Subject: msg.Subject, Body: msg.Body, HTML: msg.HTML,
	})
	if merr != nil {
		return adapters.MailReceipt{}, merr
	}
	out, err := p.seam.CallVerb(ctx, ownerID, "send", opArgs)
	if err != nil {
		return adapters.MailReceipt{}, err
	}
	var r sendReply
	if uerr := json.Unmarshal(out, &r); uerr != nil {
		return adapters.MailReceipt{}, fmt.Errorf("mail block send decode: %w", uerr)
	}
	return adapters.MailReceipt{ProviderID: r.ID}, nil
}
