// visitor_chat_introspect.go —— test-only helper that returns the names
// of tools backend would装配给 a given visitor session, without actually
// running the chat. Used by the /internal/test/visitor-tool-specs sys
// route to let e2e specs assert which agent skills are exposed.

package usecases

import (
	"context"

	"github.com/wangsijie/standmeet/internal/inference"
)

// AssembleVisitorToolNames —— inspect tool spec assembly identically to
// SendMessage but without writing the visitor turn or invoking the
// inference provider. Returns tool spec names only (not full specs).
//
// 错误 silently skip：tool spec assembly 失败 (loading wiki / skills /
// connector) 返回部分结果而不是 500，让 introspection endpoint 鲁棒。
func AssembleVisitorToolNames(
	ctx context.Context, deps *VisitorDeps, in *SendMessageInput,
) []string {
	out := append([]string{}, namesOf(retrievalToolSpecs())...)
	out = append(out, skillNamesFor(ctx, deps, in)...)
	out = append(out, extNamesFor(ctx, deps, in)...)
	out = append(out, bookerNamesFor(ctx, deps, in)...)
	return out
}

func namesOf(specs []inference.ToolSpec) []string {
	out := make([]string, 0, len(specs))
	for _, s := range specs {
		out = append(out, s.Name)
	}
	return out
}

func skillNamesFor(ctx context.Context, deps *VisitorDeps, in *SendMessageInput) []string {
	bundle, err := buildSkillBundle(ctx, deps, in)
	if err != nil || bundle == nil {
		return []string{}
	}
	return namesOf(bundle.Specs())
}

func extNamesFor(ctx context.Context, deps *VisitorDeps, in *SendMessageInput) []string {
	bundle := buildExternalMCPBundle(ctx, deps, in)
	if bundle == nil {
		return []string{}
	}
	defer bundle.Close()
	return namesOf(bundle.Specs())
}

func bookerNamesFor(ctx context.Context, deps *VisitorDeps, in *SendMessageInput) []string {
	bundle, err := buildBookerBundle(ctx, deps, in)
	if err != nil || bundle == nil {
		return []string{}
	}
	return namesOf(bundle.Specs())
}
