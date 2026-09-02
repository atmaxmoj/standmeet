// capreg_resume_read_test.go —— 简历读取能力：哪一份，与隔离。
//
// 这是内容级保证唯一可观测的一层。transcript API 刻意把工具 RESULT 从下发给访客的内容里剥掉
// （history.go：里面可能有私有正文），后端日志只记 result_bytes、从不记文本。所以 e2e 只能证
// "工具接上了、闸对了"，只有读得到 handler 真返回值的测试才能证"会话 A 拿到 A 的简历、永不拿到
// B 的"。这就在这里。
//
// fake 替 DB，但被测的逻辑是真的：解析来自冻结的 session subject（不从工具入参取），且除非那个
// subject 反查得到简历，否则工具隐藏。handler 若返回固定/全局内容、或认了 args 里的 id、或在普通
// 码上也暴露 —— 这些都会红。

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

// fakeResumeSource —— access_code → (owner, 简历内容)，owner-scoped，替代 port.ResumeReader。
// 镜像真适配器：owner 不匹配 → found=false（普通码同款隐藏路径）。
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

// TestResumeRead_returns_only_this_sessions_application —— 隔离保证。code-A 的会话读到 A 的简历、
// 永不读到 B 的；code-B 反过来。
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

// TestResumeRead_ignores_a_forged_id_in_args —— 解析来自冻结的 session subject，不从工具参数取。
// agent 在 args 里塞另一份 application 的 id，拿到的仍是它自己那份 —— 塞的 id 改不了任何东西。
func TestResumeRead_ignores_a_forged_id_in_args(t *testing.T) {
	t.Parallel()
	out := runResumeTool(t, twoResumes(), resOwnerA, resCodeSubject(resCodeA),
		`{"application":"`+resCodeB+`","id":"`+resCodeB+`","code":"`+resCodeB+`"}`)
	require.Contains(t, out, resMarkerA)
	require.NotContains(t, out, resMarkerB, "a forged id must not redirect resolution")
}

// TestResumeRead_hidden_unless_the_code_is_an_application —— 闸。工具只在 subject 是一张能反查到
// application 的 code 时出现。普通码、非 code subject（api-key）、匿名会话一律隐藏（ErrHidden）。
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

// TestResumeRead_is_owner_scoped —— 一个 owner 的会话永不能反查到另一个 owner 的 application，
// 就算拿着对的码字符串（BOLA 守卫）。真查询的 owner_id 过滤由 fake 镜像；owner 不匹配 → 隐藏。
func TestResumeRead_is_owner_scoped(t *testing.T) {
	t.Parallel()
	c := newResumeReadCapability(twoResumes())
	// code-A 属于 ownerA；ownerB 的会话拿着 code-A 必须反查不到。
	b, err := c.VisitorBinding(context.Background(), &capreg.AssembleInput{
		OwnerID: resOwnerB, Subject: resCodeSubject(resCodeA),
	})
	require.ErrorIs(t, err, capreg.ErrHidden)
	require.Nil(t, b)
}
