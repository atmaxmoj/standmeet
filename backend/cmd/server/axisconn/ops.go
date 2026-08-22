// ops.go —— 资源 connectors:owner 手上这些"连出去的线",由**连接器轴**自己声明。
//
// 这一组分两半:
//
//	通用注册表   列 / 目录 / 状态 / 建 / 改 / 删 / 激活 / 断开 / 验 spec —— 对任何品类
//	             都一样,所以住在这里,而且**不认识任何一个品类的名字**。
//	品类专属     连接器自己在 manifest 里声明(connector.OwnerOp),比如 smtp 的
//	             connectors.mail_test_send。声明是数据,实现由这一侧按品类契约接上。
//
// 拆开之前 mail_test_send 长在通用注册表上,于是通用那层里出现了 "mail" —— 加一个品类专属
// 动作就得改通用层。现在加一个 = 在那个连接器的 manifest 里加一段。

package axisconn

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/connector"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// ConnectorResource —— 通用注册表 + 各连接器自己声明的那些。
func ConnectorResource(d *deps.Runtime) dispatcher.Resource {
	ops := newConnectorOps(d)
	return dispatcher.Resource{
		Name: "connectors",
		Ops:  append(connectorRegistryOps(ops), connectorDeclaredOps(d)...),
	}
}

func connectorRegistryOps(ops connectorOps) []fp.Op {
	return append([]fp.Op{
		{
			ID: "connectors.list",
			Description: "List the owner's configured connectors with their category, " +
				"kind, and credential / connected / active state.",
			InputSchema: fp.NoArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listConnectors(ops),
		},
		{
			ID: "connectors.catalog",
			Description: "List the built-in connectors available to connect (id / category / " +
				"kind, plus the owner operations each one declares); fetch per-connector " +
				"status and credential forms separately.",
			InputSchema: fp.NoArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      catalogConnectors(ops),
		},
		{
			ID:          "connectors.status",
			Description: "Read a single connector's status (category / kind + flags).",
			InputSchema: connectorIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      connectorStatus(ops),
		},
	}, connectorWriteOps(ops)...)
}

var connectorIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"id":{"type":"string","description":"Connector id."}},
	"required":["id"]
}`)

// connectorRowOut —— 一个连接:id / 品类 / kind + 凭据、连上、激活三个状态。
type connectorRowOut struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Kind     string `json:"kind"`
	// Title —— 厂商自己给这份 API 起的名字。**没绑品类契约的上传连接器 Category 是空串**，
	// 而卡名渲的就是 Category —— 于是它在列表里没有名字，两条并排时分不出谁是谁（F-C-56）。
	Title string `json:"title,omitempty"`
	// Reason —— 给 owner 照做的那一句。**不谈密钥、不谈密文**:他要做的只是重新连一次。
	Reason         string `json:"reason,omitempty"`
	HasCredentials bool   `json:"has_credentials"`
	Connected      bool   `json:"connected"`
	Active         bool   `json:"active"`
	// Unreadable —— 这台实例解不开这一行的密文了(换过 INSTANCE_SECRET / 密文被动过)。F-C-41。
	// 以前这种行让整个 list 500,面把它当成「一条都没有」,于是每张卡都写着「你没连过」——
	// 而库里密文和 connected_at 都还在。现在这一行照常回去,只是带着这句话。
	Unreadable bool `json:"unreadable,omitempty"`
}

// unreadableReason —— 这句话同时覆盖两种世界(换了密钥 / 密文被动过),
// 因为 AES-GCM 的认证失败在密码学上分不出它们。
const unreadableReason = "This instance can no longer read this connector's " +
	"saved credentials — reconnect it."

func toConnectorRow(c *connector.Connection) connectorRowOut {
	row := connectorRowOut{
		ID: c.ConnectorID, Category: c.Category, Kind: c.Kind, Title: c.Title,
		HasCredentials: len(c.Credentials) > 0,
		Connected:      c.Connected, Active: c.Active,
		Unreadable: c.Unreadable,
	}
	if c.Unreadable {
		row.Reason = unreadableReason
	}
	return row
}

func toConnectorRows(conns []connector.Connection) []connectorRowOut {
	rows := make([]connectorRowOut, 0, len(conns))
	for i := range conns {
		rows = append(rows, toConnectorRow(&conns[i]))
	}
	return rows
}

func listConnectors(ops connectorOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		conns, err := ops.svc.List(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("list connectors", err)
		}
		return json.Marshal(toConnectorRows(conns))
	}
}

// catalogRowOut —— 目录里的一张卡:通用那几项 + **它自己声明的 owner 操作**。
//
// 声明必须一路走到面上。不走的话,面要摆一个「发一封测试信」的按钮就只能自己写死
// "mail 卡上有这个" —— 通用的那一层里又出现了品类名,而这正是 owner_op.go 把它拆开的
// 理由。声明是数据:manifest 里加一段,卡上就多一个动作,前端一行不改。
type catalogRowOut struct {
	connectorRowOut

	OwnerOps []ownerOpOut `json:"owner_ops,omitempty"`
}

// ownerOpOut —— 一个 owner 操作在面上的样子:操作 id + 一句说明 + 要填的几格。
type ownerOpOut struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Fields      []ownerOpFieldOut `json:"fields,omitempty"`
}

type ownerOpFieldOut struct {
	Key         string `json:"key"`
	Description string `json:"description"`
	// Type —— 声明里的标量类型。面据此选控件并按类型送值:数字字段送字符串的话,
	// op 自己的 schema 第一步 unmarshal 就失败(F-C-17)。
	Type     string `json:"type"`
	Required bool   `json:"required"`
}

func toOwnerOps(decls []connector.OwnerOp) []ownerOpOut {
	out := make([]ownerOpOut, 0, len(decls))
	for _, decl := range decls {
		out = append(out, ownerOpOut{
			Name: decl.Name, Description: decl.Description,
			Fields: toOwnerOpFields(decl.Fields()),
		})
	}
	return out
}

func toOwnerOpFields(fields []connector.OpField) []ownerOpFieldOut {
	out := make([]ownerOpFieldOut, 0, len(fields))
	for _, f := range fields {
		out = append(out, ownerOpFieldOut{
			Key: f.Key, Description: f.Description,
			Type: f.Type, Required: f.Required,
		})
	}
	return out
}

func catalogConnectors(ops connectorOps) fp.Invoke {
	return func(_ context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		conns := ops.svc.Catalog()
		rows := make([]catalogRowOut, 0, len(conns))
		for i := range conns {
			rows = append(rows, catalogRowOut{
				connectorRowOut: toConnectorRow(&conns[i]),
				OwnerOps:        toOwnerOps(ops.svc.OwnerOpsOf(conns[i].ConnectorID)),
			})
		}
		return json.Marshal(rows)
	}
}

type connectorIDArgs struct {
	ID string `json:"id"`
}

func parseConnectorID(raw json.RawMessage) (string, error) {
	var in connectorIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.ID, fp.RequireArgs([2]string{"id", in.ID})
}

func connectorStatus(ops connectorOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseConnectorID(raw)
		if perr != nil {
			return nil, perr
		}
		conn, err := ops.svc.Status(ctx, ownerID, id)
		if err != nil {
			return nil, fp.OpErr("read connector status", err)
		}
		return json.Marshal(toConnectorRow(&conn))
	}
}

// connectorDeclaredOps —— 各内置连接器在自己 manifest 里声明的那些 owner 操作。
//
// 声明里的 op 指向品类契约上的一个动作;这一侧按 op 找实现。manifest 声明了一个没人实现的
// op,启动就炸 —— 那是一句谎话,不能等到 owner 点下去才发现。
func connectorDeclaredOps(d *deps.Runtime) []fp.Op {
	impls := connectorOpImpls(d)
	manifests := loadBuiltinConnectorManifests(d)
	out := make([]fp.Op, 0, len(manifests))
	for i := range manifests {
		out = append(out, declaredOpsOf(&manifests[i], impls)...)
	}
	return out
}

func declaredOpsOf(m *connector.Manifest, impls map[string]fp.Invoke) []fp.Op {
	out := make([]fp.Op, 0, len(m.OwnerOps))
	for _, decl := range m.OwnerOps {
		invoke, ok := impls[decl.Op]
		if !ok {
			panic("connector " + m.ID + " declares owner op " + decl.Name +
				" over unimplemented contract op " + decl.Op)
		}
		out = append(out, fp.Op{
			ID: decl.Name, Description: decl.Description,
			InputSchema: decl.InputSchema, Kind: fp.Action,
			Reach: fp.OwnerAction(), Invoke: invoke,
		})
	}
	return out
}
