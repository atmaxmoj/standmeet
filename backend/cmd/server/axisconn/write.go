// write.go —— 通用注册表的写操作:建 / 改 / 删 / 激活 / 断开 / 验 spec
// (声明在 ops.go)。
//
// 编排本身在 internal/connector 的 Service 里(抓 spec / 装配 / 落库 / OAuth);这里只解参、
// 转交、翻回执。

package axisconn

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/connector"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// connectorOps —— 通用注册表要的那点东西。
type connectorOps struct{ svc *connector.Service }

func newConnectorOps(d *deps.Runtime) connectorOps {
	return connectorOps{svc: NewService(d)}
}

func connectorWriteOps(ops connectorOps) []fp.Op {
	return []fp.Op{
		{
			ID: "connectors.create",
			Description: "Create a connector. kind 'protocol' builds a protocol connector " +
				"(protocol caldav/smtp, explicit category); otherwise uploads an openapi " +
				"connector from a spec + JSONata binding.",
			InputSchema: connectorCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createConnector(ops),
		},
		{
			ID: "connectors.update",
			Description: "Edit an uploaded openapi connector's spec + binding (built-in " +
				"connectors are read-only).",
			InputSchema: connectorUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateConnector(ops),
		},
		{
			ID: "connectors.delete",
			Description: "Delete an owner-built connector (built-in connectors are " +
				"read-only and cannot be deleted).",
			InputSchema: connectorIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      connectorIDAction(ops.svc.Delete, "delete connector"),
		},
		{
			ID:          "connectors.activate",
			Description: "Activate a connector into its category slot (make it the active one).",
			InputSchema: connectorIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      connectorIDAction(ops.svc.Activate, "activate connector"),
		},
		{
			ID: "connectors.disconnect",
			Description: "Soft-disconnect a connector (clear tokens; keep credentials). A " +
				"connected sibling in the same category is promoted to active if one exists.",
			InputSchema: connectorIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      connectorIDAction(ops.svc.Disconnect, "disconnect connector"),
		},
		{
			ID: "connectors.validate_spec",
			Description: "Validate an OpenAPI spec (inline text or fetched from a URL) before " +
				"creating a connector. Returns a candidate title + derived auth forms, or a " +
				"human-readable rejection reason.",
			InputSchema: connectorValidateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      validateConnectorSpec(ops),
		},
	}
}

var (
	connectorCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"kind":{"type":"string","description":"'protocol' or 'openapi' (default)."},
			"protocol":{"type":"string","description":"Protocol connector: caldav / smtp."},
			"category":{"type":"string","description":"Protocol connector category."},
			"auth_scheme":{"type":"string","description":"Selected OpenAPI auth scheme."},
			"base_url":{"type":"string","description":"Base URL if the spec has none."},
			"url":{"type":"string","description":"Fetch the spec from here if no text."},
			"spec":{"type":"string","description":"OpenAPI spec text (JSON or YAML)."},
			"binding":{"type":"string","description":"JSONata binding text (YAML)."},
			"expose_as_agent_tools":{"type":"boolean","description":"Expose raw ops as tools."}
		}
	}`)

	connectorUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"id":{"type":"string","description":"Connector id."},
			"auth_scheme":{"type":"string","description":"Selected OpenAPI auth scheme."},
			"base_url":{"type":"string","description":"Base URL if the spec has none."},
			"url":{"type":"string","description":"Fetch the spec from here if no text."},
			"spec":{"type":"string","description":"OpenAPI spec text (JSON or YAML)."},
			"binding":{"type":"string","description":"JSONata binding text (YAML)."},
			"expose_as_agent_tools":{"type":"boolean","description":"Expose raw ops as tools."}
		},
		"required":["id"]
	}`)

	connectorValidateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"spec":{"type":"string","description":"OpenAPI spec text (JSON or YAML)."},
			"url":{"type":"string","description":"URL to fetch the spec from (optional)."},
			"base_url":{"type":"string","description":"Base URL if the spec has none."}
		}
	}`)
)

// connectorOKOut —— id 型动作的回执。
type connectorOKOut struct {
	ID string `json:"id"`
	OK bool   `json:"ok"`
}

// connectorIDAction —— 删 / 激活 / 断开只差调哪个方法;解参和回执同一份。
func connectorIDAction(
	apply func(ctx context.Context, ownerID, id string) error, what string,
) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseConnectorID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := apply(ctx, ownerID, id); err != nil {
			return nil, connErr(what, err)
		}
		return json.Marshal(connectorOKOut{ID: id, OK: true})
	}
}

// connectorCreateArgs —— kind ""/"openapi" → 传 spec+binding;"protocol" → 协议连接器。
type connectorCreateArgs struct {
	Kind               string `json:"kind"`
	Protocol           string `json:"protocol"`
	Category           string `json:"category"`
	AuthScheme         string `json:"auth_scheme"`
	BaseURL            string `json:"base_url"`
	URL                string `json:"url"` // spec 从 URL 抓来时:调用方没有正文,这一层去抓
	Spec               string `json:"spec"`
	Binding            string `json:"binding"`
	ExposeAsAgentTools bool   `json:"expose_as_agent_tools"`
}

func (a *connectorCreateArgs) uploaded() *connector.UploadedSpec {
	return &connector.UploadedSpec{
		AuthScheme: a.AuthScheme, BaseURL: a.BaseURL, URL: a.URL,
		Spec: []byte(a.Spec), Binding: []byte(a.Binding),
		ExposeAsAgentTools: a.ExposeAsAgentTools,
	}
}

type connectorCreatedOut struct {
	ID string `json:"id"`
}

func createConnector(ops connectorOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in connectorCreateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		id, err := createByKind(ctx, ops, ownerID, &in)
		if err != nil {
			return nil, connErr("create connector", err)
		}
		return json.Marshal(connectorCreatedOut{ID: id})
	}
}

// createByKind —— protocol 走协议连接器,其余走上传 spec。
func createByKind(
	ctx context.Context, ops connectorOps, ownerID string, in *connectorCreateArgs,
) (string, error) {
	if in.Kind == "protocol" {
		return ops.svc.CreateProtocol(ctx, ownerID, in.Category, in.Protocol)
	}
	return ops.svc.CreateUploaded(ctx, ownerID, in.uploaded())
}

type connectorUpdateArgs struct {
	ID                 string `json:"id"`
	AuthScheme         string `json:"auth_scheme"`
	BaseURL            string `json:"base_url"`
	URL                string `json:"url"`
	Spec               string `json:"spec"`
	Binding            string `json:"binding"`
	ExposeAsAgentTools bool   `json:"expose_as_agent_tools"`
}

func updateConnector(ops connectorOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in connectorUpdateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
			return nil, err
		}
		if err := ops.svc.UpdateUploaded(ctx, ownerID, in.ID, &connector.UploadedSpec{
			AuthScheme: in.AuthScheme, BaseURL: in.BaseURL, URL: in.URL,
			Spec: []byte(in.Spec), Binding: []byte(in.Binding),
			ExposeAsAgentTools: in.ExposeAsAgentTools,
		}); err != nil {
			return nil, connErr("update connector", err)
		}
		return json.Marshal(connectorOKOut{ID: in.ID, OK: true})
	}
}

type connectorValidateArgs struct {
	Spec    string `json:"spec"`
	URL     string `json:"url"`
	BaseURL string `json:"base_url"`
}

// connectorVerdictOut —— 验 spec 的结果。auth 原样透传:它的形状由那份 spec 决定,
// 这一层不该看懂,所以是已经编好的 JSON。
type connectorVerdictOut struct {
	Title string          `json:"title"`
	Error string          `json:"error"`
	Auth  json.RawMessage `json:"auth"`
	OK    bool            `json:"ok"`
}

func validateConnectorSpec(ops connectorOps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var in connectorValidateArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		v := ops.svc.ValidateSpec(ctx, []byte(in.Spec), in.URL, in.BaseURL)
		auth, aerr := json.Marshal(v.Auth)
		if aerr != nil {
			// 认证表单编不出来只该少这一半,不该让 owner 连"这份 spec 行不行"都问不到。
			auth = json.RawMessage(`null`)
		}
		return json.Marshal(connectorVerdictOut{
			OK: v.OK, Title: v.Title, Error: v.Reason, Auth: auth,
		})
	}
}
