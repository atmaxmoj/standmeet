// ops.go —— the connectors resource: the "outbound wires" the owner holds,
// declared by the **connector axis** itself.
//
// This group splits in two:
//
//	generic registry   list / catalog / status / create / edit / delete / activate /
//	                    disconnect / validate spec — the same for every category, so
//	                    it lives here, and **doesn't know the name of any category**.
//	category-specific  the connector declares these itself in its manifest
//	                    (connector.OwnerOp), e.g. smtp's connectors.mail_test_send.
//	                    The declaration is data; this side wires up the
//	                    implementation per the category contract.
//
// Before this split, mail_test_send lived on the generic registry, so the word
// "mail" showed up in the generic layer — adding one category-specific action meant
// editing the generic layer. Now adding one means adding a block to that
// connector's manifest.

package axisconn

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/connector"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// ConnectorResource —— the generic registry + what each connector declares itself.
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
			ID: "connectors.agent_ops",
			Description: "List the operations each connected connector exposes to a visitor's " +
				"AI, grouped by connector. These names are what a skill's allowed_tools must " +
				"carry for the operation to be reachable in a session.",
			InputSchema: fp.NoArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      agentOpsList(ops),
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

// connectorRowOut —— one connection: id / category / kind + the three states
// credentials, connected, active.
type connectorRowOut struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Kind     string `json:"kind"`
	// Title —— the name the vendor itself gave this API. **An uploaded connector
	// not bound to a category contract has an empty Category**, and the card
	// renders Category as its name — so it shows up nameless in the list, and two
	// rows side by side can't be told apart (F-C-56).
	Title string `json:"title,omitempty"`
	// Reason —— the sentence telling the owner what to do. **Never mentions the
	// key or the ciphertext** — all they need to do is reconnect.
	Reason         string `json:"reason,omitempty"`
	HasCredentials bool   `json:"has_credentials"`
	Connected      bool   `json:"connected"`
	Active         bool   `json:"active"`
	// Unreadable —— this instance can no longer decrypt this row's ciphertext
	// (INSTANCE_SECRET rotated / ciphertext tampered with). F-C-41.
	// This used to make the whole list 500, and the surface treated that as "zero
	// rows", so every card said "you've never connected" — while the ciphertext
	// and connected_at were still sitting in the DB. Now this row comes back
	// normally, just carrying this sentence.
	Unreadable bool `json:"unreadable,omitempty"`
}

// unreadableReason —— this one sentence covers both cases (key rotated /
// ciphertext tampered with), because AES-GCM's auth failure can't tell them apart
// cryptographically.
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

// catalogRowOut —— one card in the catalog: the generic fields + **the owner
// operations it declares itself**.
//
// The declaration has to make it all the way to the surface. If it doesn't, the
// surface can only hardcode "the mail card has this button" to show a "send a test
// email" button — putting the category name back into the generic layer, which is
// exactly why owner_op.go split it apart. The declaration is data: add a block to the
// manifest, the card gains an action, the frontend changes zero lines.
type catalogRowOut struct {
	connectorRowOut

	OwnerOps []ownerOpOut `json:"owner_ops,omitempty"`
}

// ownerOpOut —— how one owner operation looks on the surface: op id + one
// description line + the fields to fill in.
type ownerOpOut struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Fields      []ownerOpFieldOut `json:"fields,omitempty"`
}

type ownerOpFieldOut struct {
	Key         string `json:"key"`
	Description string `json:"description"`
	// Type —— the scalar type from the declaration. The surface picks a control
	// and sends the value by this type: send a string for a number field, and
	// the op's own schema fails at the first unmarshal step (F-C-17).
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

// connectorDeclaredOps —— the owner operations each built-in connector declares in
// its own manifest.
//
// The op in the declaration points to an action on the category contract; this side
// looks up the implementation by that op. A manifest that declares an op nobody
// implements makes boot panic — that declaration would be a lie, and it can't wait
// until the owner clicks it to be discovered.
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
