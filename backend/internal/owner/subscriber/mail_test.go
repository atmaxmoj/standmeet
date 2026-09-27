package subscriber_test

// The owner domain's mail jobs, against a real Postgres and a fake mail registry: the send happens
// before the business state that follows it, a permanent failure leaves that state alone, the
// email-bomb cap still drops, and every mail subscription is idempotent.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/sideeffect/mail"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/subscriber"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

const (
	ownerEmail = "owner@example.com"
	burstCap   = 5
	flood      = 7
)

// sentMail — one send as it reached the mail category.
type sentMail struct {
	To        string `json:"to"`
	Body      string `json:"body"`
	MessageID string `json:"message_id"`
}

// fakeRegistry — the mail category: records what reached it; err, when set, fails every send.
type fakeRegistry struct {
	err  error
	sent []sentMail
}

func (f *fakeRegistry) Invoke(
	_ context.Context, _, _, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	if verb != "send" {
		return json.RawMessage(`{"connected":true}`), nil
	}
	if f.err != nil {
		return nil, f.err
	}
	var m sentMail
	if err := json.Unmarshal(args, &m); err != nil {
		return nil, fmt.Errorf("fake registry: %w", err)
	}
	f.sent = append(f.sent, m)
	return json.RawMessage(`{"ok":true}`), nil
}

var (
	transient = &hostop.FaultError{Code: hostop.FaultUnavailable, Err: errors.New("dropped")}
	rejected  = &hostop.FaultError{Code: hostop.FaultUnavailable, Err: fmt.Errorf("send: %w",
		&hostop.FaultError{Code: hostop.FaultRejected, Err: errors.New("550")})}
)

type mailFixture struct {
	pool  *pgxpool.Pool
	reg   *fakeRegistry
	deps  *subscriber.MailDeps
	owner string
}

func mailSetup(t *testing.T) *mailFixture {
	t.Helper()
	pool := scratchDB(t)
	var owner string
	if err := pool.QueryRow(context.Background(), `INSERT INTO owners
		(email, password_hash, handle, full_name, public_url)
		VALUES ($1, 'x', 'o', 'O', 'https://o.example') RETURNING id`, ownerEmail,
	).Scan(&owner); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	reg := &fakeRegistry{}
	bus, err := events.New(pool, access.EventTypes(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return &mailFixture{pool: pool, reg: reg, owner: owner, deps: &subscriber.MailDeps{
		Reqs: access.NewAccessRequestRepo(pool), Codes: access.NewCodeRepo(pool),
		Owners: repo.NewRepo(pool), Log: slog.New(slog.DiscardHandler), Mail: mail.New(reg, nil),
		Events: bus.Recorder(),
	}}
}

func (f *mailFixture) request(t *testing.T, email string) string {
	t.Helper()
	r, err := f.deps.Reqs.Create(context.Background(), &access.CreateAccessRequestInput{
		OwnerID: f.owner, Name: "V", Email: email, Message: "may I?",
	})
	if err != nil {
		t.Fatal(err)
	}
	return r.ID
}

func (f *mailFixture) code(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	var role string
	if err := f.pool.QueryRow(ctx, `INSERT INTO roles (owner_id, name) VALUES ($1, 'invited')
		RETURNING id`, f.owner).Scan(&role); err != nil {
		t.Fatal(err)
	}
	c, err := f.deps.Codes.CreateAccessCode(ctx, &access.CreateAccessCodeInput{
		OwnerID: f.owner, Code: "inv-test01", Label: "invite", AssumedRoleID: role,
	})
	if err != nil {
		t.Fatal(err)
	}
	return c.ID
}

func (f *mailFixture) status(t *testing.T, id string) string {
	t.Helper()
	r, err := f.deps.Reqs.GetByID(context.Background(), f.owner, id)
	if err != nil {
		t.Fatal(err)
	}
	return r.Status
}

func kindOf(t *testing.T, d *subscriber.MailDeps, name string) jobs.Kind {
	t.Helper()
	for _, k := range subscriber.MailKinds(d) {
		if k.Name == name {
			return k
		}
	}
	t.Fatalf("no kind %s", name)
	return jobs.Kind{}
}

func mustJSON(t *testing.T, v entity.ApprovalNoticeArgs) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// approvalJob —— one approved request and the job that mails its code.
type approvalJob struct {
	req  string
	args json.RawMessage
	kind jobs.Kind
}

func (a *approvalJob) run() error { return a.kind.Handle(context.Background(), a.args) }

func (f *mailFixture) approval(t *testing.T, email string) approvalJob {
	t.Helper()
	req := f.request(t, email)
	args := entity.ApprovalNoticeArgs{OwnerID: f.owner, RequestID: req, CodeID: f.code(t)}
	return approvalJob{
		req: req, kind: kindOf(t, f.deps, entity.ApprovalNoticeKind), args: mustJSON(t, args),
	}
}

// TestApprovalMail_repliedOnlyAfterTheSend — the first send fails for now: the request is still
// open and the job retries; the retry sends, and only then is the request replied.
func TestApprovalMail_repliedOnlyAfterTheSend(t *testing.T) {
	t.Parallel()
	f := mailSetup(t)
	job := f.approval(t, "visitor@example.com")
	f.reg.err = transient
	retryable(t, job.run())
	if st := f.status(t, job.req); st != "open" {
		t.Fatalf("no mail went out, so the request must stay open, got %s", st)
	}
	f.reg.err = nil
	if err := job.run(); err != nil {
		t.Fatal(err)
	}
	if st := f.status(t, job.req); st != "replied" {
		t.Fatalf("after the send: want replied, got %s", st)
	}
	f.sentCarries(t, "visitor@example.com", "inv-test01")
}

// retryable —— err is a failure the job layer tries again.
func retryable(t *testing.T, err error) {
	t.Helper()
	if err == nil || jobs.IsDiscard(err) {
		t.Fatalf("a transient failure must be retryable, got %v", err)
	}
}

// sentCarries —— exactly one mail went, to `to`, carrying `text`.
func (f *mailFixture) sentCarries(t *testing.T, to, text string) {
	t.Helper()
	if len(f.reg.sent) != 1 {
		t.Fatalf("want exactly one mail, got %d", len(f.reg.sent))
	}
	got := f.reg.sent[0]
	if !strings.Contains(got.Body, text) || got.To != to {
		t.Errorf("want a mail to %s carrying %s, got %+v", to, text, got)
	}
}

// TestApprovalMail_permanentFailureStaysOpen — the relay rejects the message (a 5xx): the job is
// discarded at once and the request is not marked replied.
func TestApprovalMail_permanentFailureStaysOpen(t *testing.T) {
	t.Parallel()
	f := mailSetup(t)
	job := f.approval(t, "bounce@example.com")
	f.reg.err = rejected
	if err := job.run(); !jobs.IsDiscard(err) {
		t.Fatalf("a rejected message must be discarded, got %v", err)
	}
	if st := f.status(t, job.req); st != "open" {
		t.Errorf("a mail that never went must not mark the request replied, got %s", st)
	}
}

func (f *mailFixture) notifyEvent(reqID string) events.Event {
	return events.Event{
		ID: "ev-" + reqID, OwnerID: f.owner, Type: access.AccessRequestCreated,
		Subject: "access_request/" + reqID,
		Data:    json.RawMessage(`{"request_id":"` + reqID + `"}`),
	}
}

func pick(t *testing.T, d *subscriber.MailDeps, name string) events.Subscription {
	t.Helper()
	for _, s := range subscriber.MailSubscriptions(d) {
		if s.Name == name {
			return s
		}
	}
	t.Fatalf("no subscription %s", name)
	return events.Subscription{}
}

// TestOwnerNotify_floodIsCapped — a flood of requests mails the owner the cap, not once per
// request; every request is still stored. Falsifiable: drop the cap and all `flood` mails go.
func TestOwnerNotify_floodIsCapped(t *testing.T) {
	t.Parallel()
	f := mailSetup(t)
	sub := pick(t, f.deps, entity.OwnerNotify)
	for i := range flood {
		req := f.request(t, fmt.Sprintf("bomb-%d@example.com", i))
		if err := sub.Handle(context.Background(), f.notifyEvent(req)); err != nil {
			t.Fatalf("request %d: a dropped notification is not a failure: %v", i, err)
		}
	}
	if len(f.reg.sent) != burstCap {
		t.Fatalf("owner notifications: want the cap %d, got %d", burstCap, len(f.reg.sent))
	}
	for _, m := range f.reg.sent {
		wellAddressed(t, m)
	}
}

// wellAddressed —— an owner notice goes to the owner, with its event's Message-ID.
func wellAddressed(t *testing.T, m sentMail) {
	t.Helper()
	if m.To != ownerEmail || !strings.HasPrefix(m.MessageID, "<ev-") {
		t.Errorf("the notice goes to the owner with the event's Message-ID, got %+v", m)
	}
}

// TestOwnerNotify_retryKeepsItsSlot — a notification whose sends keep failing does not spend a
// slot per attempt: after more failed attempts than the cap, its retry still sends.
func TestOwnerNotify_retryKeepsItsSlot(t *testing.T) {
	t.Parallel()
	f := mailSetup(t)
	sub := pick(t, f.deps, entity.OwnerNotify)
	ev := f.notifyEvent(f.request(t, "retry@example.com"))
	f.reg.err = transient
	for range burstCap + 1 {
		if err := sub.Handle(context.Background(), ev); err == nil {
			t.Fatal("a failed send must be retryable")
		}
	}
	f.reg.err = nil
	if err := sub.Handle(context.Background(), ev); err != nil || len(f.reg.sent) != 1 {
		t.Errorf("after failed attempts the retry must still send: err=%v sent=%d",
			err, len(f.reg.sent))
	}
}

// sampleFor — one event per type a mail subscription listens to. A subscription on a type with no
// sample fails the idempotency test below, so a new subscription cannot slip past it.
func sampleFor(t *testing.T, f *mailFixture, typ string) events.Event {
	t.Helper()
	switch typ {
	case access.AccessRequestCreated:
		return f.notifyEvent(f.request(t, "twice@example.com"))
	case usecase.BookingCreated:
		return f.notifiedBooking(t, "bk-twice")
	default:
		t.Fatalf("a mail subscription listens to %s: add a sample event for it", typ)
		return events.Event{}
	}
}

// TestMailSubscriptions_idempotent — registry-driven: every mail subscription, given the same
// event twice, mails once.
func TestMailSubscriptions_idempotent(t *testing.T) {
	t.Parallel()
	for _, s := range subscriber.MailSubscriptions(mailSetup(t).deps) {
		for _, typ := range s.Types {
			deliverTwice(t, s.Name, typ)
		}
	}
}

func deliverTwice(t *testing.T, name, typ string) {
	t.Helper()
	f := mailSetup(t)
	sub := pick(t, f.deps, name)
	ev := sampleFor(t, f, typ)
	for range 2 {
		if err := sub.Handle(context.Background(), ev); err != nil {
			t.Fatal(err)
		}
	}
	if len(f.reg.sent) != 1 {
		t.Errorf("%s on %s twice: want one mail, got %d", name, typ, len(f.reg.sent))
	}
}
