// capreg_resume_read_test.go —— the résumé-reading capability: which one, and isolation.
//
// This is the only layer where the content-level guarantee is observable. The transcript
// API deliberately strips the tool RESULT out of what's sent down to the visitor
// (history.go: it may contain private body text), and the backend log only records
// result_bytes, never the text. So e2e can only prove "the tool wired up, the gate was
// right"; only a test that can read the handler's real return value can prove "session A
// gets A's résumé, and never B's". That's what happens here.
//
// A fake stands in for the DB, but the logic under test is real: resolution comes from the
// frozen session subject (never from a tool input arg), and the tool stays hidden unless
// that subject resolves to a résumé. If the handler returned fixed/global content, or
// honored an id from args, or exposed itself on an ordinary code too — any of those would
// turn this red.

package capload

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// errFakeNoResume —— the fake's "this code has no application" (real port returns a wrapped
// ErrApplicationNotFound; the cap only cares that it's non-nil → hide).
var errFakeNoResume = errors.New("no application for code")

const (
	resOwnerA  = "owner-A"
	resOwnerB  = "owner-B"
	resCodeA   = "code-A"
	resCodeB   = "code-B"
	resMarkerA = "NORTHWIND-DELTA"
	resMarkerB = "ACME-CLASSIFIED"
)

// fakeResumeSource —— access_code → (owner, résumé content), owner-scoped, standing in for
// port.ResumeReader. Mirrors the real adapter: owner mismatch → found=false (the same hide
// path as an ordinary code).
type fakeResumeSource struct{ byCode map[string]fakeResumeRow }

type fakeResumeRow struct {
	owner   string
	content string
}

func (f fakeResumeSource) ResumeForCode(
	_ context.Context, ownerID, codeID string,
) ([]byte, error) {
	row, ok := f.byCode[codeID]
	if !ok || row.owner != ownerID {
		return []byte{}, errFakeNoResume
	}
	return []byte(row.content), nil
}

func twoResumes() fakeResumeSource {
	return fakeResumeSource{byCode: map[string]fakeResumeRow{
		resCodeA: {owner: resOwnerA, content: resMarkerA},
		resCodeB: {owner: resOwnerB, content: resMarkerB},
	}}
}

func resCodeSubject(id string) capreg.Subject {
	return capreg.Subject{Kind: capreg.SubjectCode, ID: id}
}

// runResumeTool —— assemble for the subject, invoke resume_read, return its result text.
func runResumeTool(
	t *testing.T, src resumeSource, owner string, subj capreg.Subject, argsJSON string,
) string {
	t.Helper()
	c := newResumeReadCapability(src)
	b, err := c.VisitorBinding(context.Background(), &capreg.AssembleInput{
		OwnerID: owner, Subject: subj,
	})
	require.NoError(t, err)
	require.NotNil(t, b, "the résumé tool must be exposed for an application session")
	var bt *capreg.BindingTool
	for i := range b.Tools {
		if b.Tools[i].Name == ResumeReadTool {
			bt = &b.Tools[i]
		}
	}
	require.NotNil(t, bt, "the binding carries the resume_read tool")
	out, rerr := bt.Tool.InvokableRun(context.Background(), argsJSON)
	require.NoError(t, rerr)
	return out
}

// TestResumeRead_returns_only_this_sessions_application —— the isolation guarantee. A
// session on code-A reads A's résumé and never B's; code-B is the reverse.
func TestResumeRead_returns_only_this_sessions_application(t *testing.T) {
	t.Parallel()
	src := twoResumes()

	outA := runResumeTool(t, src, resOwnerA, resCodeSubject(resCodeA), "{}")
	require.Contains(t, outA, resMarkerA, "own application's résumé is returned")
	require.NotContains(t, outA, resMarkerB, "another application's résumé must never leak")

	outB := runResumeTool(t, src, resOwnerB, resCodeSubject(resCodeB), "{}")
	require.Contains(t, outB, resMarkerB)
	require.NotContains(t, outB, resMarkerA)
}

// TestResumeRead_ignores_a_forged_id_in_args —— resolution comes from the frozen session
// subject, never from the tool's parameters. When the agent stuffs another application's
// id into args, it still gets its own — the stuffed id changes nothing.
func TestResumeRead_ignores_a_forged_id_in_args(t *testing.T) {
	t.Parallel()
	out := runResumeTool(t, twoResumes(), resOwnerA, resCodeSubject(resCodeA),
		`{"application":"`+resCodeB+`","id":"`+resCodeB+`","code":"`+resCodeB+`"}`)
	require.Contains(t, out, resMarkerA)
	require.NotContains(t, out, resMarkerB, "a forged id must not redirect resolution")
}

// TestResumeRead_hidden_unless_the_code_is_an_application —— the gate. The tool appears
// only when the subject is a code that resolves to an application. An ordinary code, a
// non-code subject (api-key), and an anonymous session are all hidden (ErrHidden).
func TestResumeRead_hidden_unless_the_code_is_an_application(t *testing.T) {
	t.Parallel()
	c := newResumeReadCapability(twoResumes())
	cases := []struct {
		in   *capreg.AssembleInput
		name string
	}{
		{name: "ordinary code (no application)", in: &capreg.AssembleInput{
			OwnerID: resOwnerA, Subject: resCodeSubject("PLAIN-CODE"),
		}},
		{name: "api-key subject", in: &capreg.AssembleInput{
			OwnerID: resOwnerA, Subject: capreg.Subject{Kind: capreg.SubjectAPIKey, ID: resCodeA},
		}},
		{name: "anonymous (public/byoai)", in: &capreg.AssembleInput{
			OwnerID: resOwnerA, Subject: capreg.Subject{Kind: capreg.SubjectCode, ID: ""},
		}},
	}
	for _, tc := range cases {
		b, err := c.VisitorBinding(context.Background(), tc.in)
		require.ErrorIs(t, err, capreg.ErrHidden, tc.name)
		require.Nil(t, b, tc.name)
	}
}

// TestResumeRead_is_owner_scoped —— a session under one owner can never resolve another
// owner's application, even holding the correct code string (a BOLA guard). The real
// query's owner_id filtering is mirrored by the fake; owner mismatch → hidden.
func TestResumeRead_is_owner_scoped(t *testing.T) {
	t.Parallel()
	c := newResumeReadCapability(twoResumes())
	// code-A belongs to ownerA; a session under ownerB holding code-A must fail to resolve it.
	b, err := c.VisitorBinding(context.Background(), &capreg.AssembleInput{
		OwnerID: resOwnerB, Subject: resCodeSubject(resCodeA),
	})
	require.ErrorIs(t, err, capreg.ErrHidden)
	require.Nil(t, b)
}
