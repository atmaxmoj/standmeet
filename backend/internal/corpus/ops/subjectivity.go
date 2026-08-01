// Package ops —— corpus 域对外能做的事,由域**自己**声明。
//
// 一个操作在这里是完整的一份:稳定 id、给调用方看的说明、入参 schema、语义类别、
// 暴露意图(哪些面欠它),以及实现 —— 实现就是调本域的用例,不经任何中间形状。
//
// 为什么在域里而不是在收口里:收口若替各域声明,它就得复述每个域已有的入参和出参,
// 于是每加一个操作就多一份"同一个概念的第二个名字",而两份一定会飘。域说自己会什么,
// 收口只负责把这些声明汇起来、加装饰器、投影到各个面。
package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// Subjectivity —— 自我模型这一 genre 的操作。
//
// 只在 MCP 上,是产品决定:自我模型是 owner 跟自己的 AI 边想边写出来的,不是在表单里填的。
func Subjectivity(deps usecase.Deps) []fp.Op {
	return []fp.Op{{
		// id 保持 owner 的 AI 一直在用的那个名字 —— 搬家不该改对外的称呼。
		ID: "subjectivity_write",
		Description: "Write (create or update) a subjectivity note — the owner's self-model: " +
			"taste, judgment, what they care about. Prose; the address is derived from the " +
			"title and the tree. Private unless show_as_source says otherwise.",
		InputSchema: subjectivitySchema,
		Kind:        fp.Action,
		Reach: fp.Only(
			"the owner's self-model is written by thinking out loud with their own AI, "+
				"not filled into a form", "mcp"),
		Invoke: writeSubjectivity(deps),
	}}
}

var subjectivitySchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"title":{"type":"string","description":"Note title (its path segment)."},
		"body":{"type":"string","description":"Prose body."},
		"subjectivity_id":{"type":"string",
			"description":"Existing note id to update or reparent; empty creates a new one."},
		"parent_id":{"type":"string",
			"description":"Parent note id; root when empty. The path is tree-derived."},
		"tags":{"type":"array","items":{"type":"string"}},
		"css_classes":{"type":"array","items":{"type":"string"}},
		"show_as_source":{"type":"boolean",
			"description":"Cite this note to visitors. Defaults to false — this genre is private."}
	},
	"required":["title","body"]
}`)

// subjectivityArgs —— 线上的入参。show_as_source 用指针,因为这个 genre 的默认是
// **私有**,跟 wiki / output 相反 —— 靠 bool 零值表达不了"没提到"。
type subjectivityArgs struct {
	ShowAsSource *bool    `json:"show_as_source"`
	Title        string   `json:"title"`
	Body         string   `json:"body"`
	ID           string   `json:"subjectivity_id"`
	ParentID     string   `json:"parent_id"`
	Tags         []string `json:"tags"`
	CSSClasses   []string `json:"css_classes"`
}

func writeSubjectivity(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeSubjectivity(raw, ownerID)
		if perr != nil {
			return nil, perr
		}
		res, err := usecase.WriteSubjectivity(ctx, deps, in)
		if err != nil {
			return nil, subjectivityErr(err)
		}
		return json.Marshal(subjectivityOut{ID: res.ID, Path: res.Path})
	}
}

// subjectivityOut —— 写完给调用方的:这条笔记的 id 和它的地址。
type subjectivityOut struct {
	ID   string `json:"subjectivity_id"`
	Path string `json:"path"`
}

func decodeSubjectivity(
	raw json.RawMessage, ownerID string,
) (*usecase.WriteSubjectivityInput, error) {
	var in subjectivityArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := fp.RequireArgs(
		[2]string{"title", in.Title}, [2]string{"body", in.Body},
	); err != nil {
		return nil, err
	}
	return in.toInput(ownerID), nil
}

func (in *subjectivityArgs) toInput(ownerID string) *usecase.WriteSubjectivityInput {
	out := &usecase.WriteSubjectivityInput{
		OwnerID: ownerID, ID: in.ID, Title: in.Title, Body: in.Body,
		Tags: in.Tags, CSSClasses: in.CSSClasses,
		ShowAsSource: in.ShowAsSource != nil && *in.ShowAsSource,
	}
	if in.ParentID != "" {
		parent := in.ParentID
		out.ParentID = &parent
	}
	return out
}

// subjectivityErr —— 本域的哨兵 → 协议无关的错误类别。翻译在域里,因为知道
// "这个哨兵意味着调用方给错了还是东西不存在"的是域。
func subjectivityErr(err error) error {
	switch {
	case errors.Is(err, entity.ErrParentNotFound):
		return fp.Coded(fp.NotFound("parent entry not found"), "parent_not_found")
	case errors.Is(err, entity.ErrParentCycle):
		return fp.Coded(fp.BadInput("cannot reparent: that would create a cycle"), "parent_cycle")
	case errors.Is(err, apierr.ErrEmptyField):
		return fp.BadInput("title and body are required")
	}
	return fp.OpErr("write subjectivity", err)
}
