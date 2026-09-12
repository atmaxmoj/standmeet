// supplier_ops.go —— the suppliers resource: the "outbound wires" the owner holds,
// declared by the supplying blocks themselves.
//
// This group splits in two:
//
//	generic registry   list / catalog / status / create / edit / delete / activate /
//	                    disconnect / validate spec — the same for every seam, so
//	                    it lives here, and **doesn't know the name of any seam**.
//	seam-specific      the supplier declares these itself in its manifest
//	                    (adapters.OwnerOp), e.g. smtp's suppliers.mail_test_send.
//	                    The declaration is data; this side wires up the
//	                    implementation per the seam contract.
//
// Before this split, mail_test_send lived on the generic registry, so the word
// "mail" showed up in the generic layer — adding one seam-specific action meant
// editing the generic layer. Now adding one means adding a block to that
// supplier's manifest.

package blockwire

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// SupplierResource —— the generic registry + what each supplier declares itself.
func SupplierResource(d *deps.Runtime) dispatcher.Resource {
	ops := newSupplierOps(d)
	return dispatcher.Resource{
		Name: "suppliers",
		Ops:  append(supplierRegistryOps(ops), supplierDeclaredOps(d)...),
	}
}

func supplierRegistryOps(ops supplierOps) []fp.Op {
	return append([]fp.Op{
		{
			ID: "suppliers.list",
			Description: "List the owner's configured suppliers with their seam, " +
				"kind, and credential / connected / active state.",
			InputSchema: fp.NoArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listSuppliers(ops),
		},
		{
			ID: "suppliers.catalog",
			Description: "List the built-in suppliers available to connect (id / seam / " +
				"kind, plus the owner operations each one declares); fetch per-supplier " +
				"status and credential forms separately.",
			InputSchema: fp.NoArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      catalogSuppliers(ops),
		},
		{
			ID: "suppliers.agent_ops",
			Description: "List the operations each connected supplier exposes to a visitor's " +
				"AI, grouped by supplier. These names are what a skill's allowed_tools must " +
				"carry for the operation to be reachable in a session.",
			InputSchema: fp.NoArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      agentOpsList(ops),
		},
		{
			ID:          "suppliers.status",
			Description: "Read a single supplier's status (seam / kind + flags).",
			InputSchema: supplierIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      supplierStatus(ops),
		},
	}, supplierWriteOps(ops)...)
}

var supplierIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"id":{"type":"string","description":"Supplier block id."}},
	"required":["id"]
}`)

// supplierRowOut —— one connection: id / seam / kind + the three states
// credentials, connected, active.
type supplierRowOut struct {
	ID   string `json:"id"`
	Seam string `json:"seam"`
	Kind string `json:"kind"`
	// Title —— the name the vendor itself gave this API. **An uploaded supplier
	// not bound to a seam contract has an empty Seam**, and the card renders Seam
	// as its name — so it shows up nameless in the list, and two rows side by side
	// can't be told apart (F-C-56).
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
const unreadableReason = "This instance can no longer read this supplier's " +
	"saved credentials — reconnect it."

func toSupplierRow(c *credentials.Connection) supplierRowOut {
	row := supplierRowOut{
		ID: c.BlockID, Seam: c.Seam, Kind: c.Kind, Title: c.Title,
		HasCredentials: len(c.Credentials) > 0,
		Connected:      c.Connected, Active: c.Active,
		Unreadable: c.Unreadable,
	}
	if c.Unreadable {
		row.Reason = unreadableReason
	}
	return row
}

func toSupplierRows(conns []credentials.Connection) []supplierRowOut {
	rows := make([]supplierRowOut, 0, len(conns))
	for i := range conns {
		rows = append(rows, toSupplierRow(&conns[i]))
	}
	return rows
}

func listSuppliers(ops supplierOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		conns, err := ops.svc.List(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("list suppliers", err)
		}
		return json.Marshal(toSupplierRows(conns))
	}
}

// catalogRowOut —— one card in the catalog: the generic fields + **the owner
// operations it declares itself**.
//
// The declaration has to make it all the way to the surface. If it doesn't, the
// surface can only hardcode "the mail card has this button" to show a "send a test
// email" button — putting the seam name back into the generic layer, which is
// exactly why owner_op.go split it apart. The declaration is data: add a block to the
// manifest, the card gains an action, the frontend changes zero lines.
type catalogRowOut struct {
	supplierRowOut

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

func toOwnerOps(decls []adapters.OwnerOp) []ownerOpOut {
	out := make([]ownerOpOut, 0, len(decls))
	for _, decl := range decls {
		out = append(out, ownerOpOut{
			Name: decl.Name, Description: decl.Description,
			Fields: toOwnerOpFields(decl.Fields()),
		})
	}
	return out
}

func toOwnerOpFields(fields []adapters.OpField) []ownerOpFieldOut {
	out := make([]ownerOpFieldOut, 0, len(fields))
	for _, f := range fields {
		out = append(out, ownerOpFieldOut{
			Key: f.Key, Description: f.Description,
			Type: f.Type, Required: f.Required,
		})
	}
	return out
}

func catalogSuppliers(ops supplierOps) fp.Invoke {
	return func(_ context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		conns := ops.svc.Catalog()
		rows := make([]catalogRowOut, 0, len(conns))
		for i := range conns {
			rows = append(rows, catalogRowOut{
				supplierRowOut: toSupplierRow(&conns[i]),
				OwnerOps:       toOwnerOps(ops.svc.OwnerOpsOf(conns[i].BlockID)),
			})
		}
		return json.Marshal(rows)
	}
}

type supplierIDArgs struct {
	ID string `json:"id"`
}

func parseSupplierID(raw json.RawMessage) (string, error) {
	var in supplierIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.ID, fp.RequireArgs([2]string{"id", in.ID})
}

func supplierStatus(ops supplierOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseSupplierID(raw)
		if perr != nil {
			return nil, perr
		}
		conn, err := ops.svc.Status(ctx, ownerID, id)
		if err != nil {
			return nil, fp.OpErr("read supplier status", err)
		}
		return json.Marshal(toSupplierRow(&conn))
	}
}

// supplierDeclaredOps —— the owner operations each built-in supplier declares in
// its own manifest.
//
// The op in the declaration points to an action on the seam contract; this side
// looks up the implementation by that op. A manifest that declares an op nobody
// implements makes boot panic — that declaration would be a lie, and it can't wait
// until the owner clicks it to be discovered.
func supplierDeclaredOps(d *deps.Runtime) []fp.Op {
	impls := supplierOpImpls(d)
	manifests := loadBuiltinSupplierManifests(d)
	out := make([]fp.Op, 0, len(manifests))
	for i := range manifests {
		out = append(out, declaredOpsOf(&manifests[i], impls)...)
	}
	return out
}

func declaredOpsOf(m *adapters.Manifest, impls map[string]fp.Invoke) []fp.Op {
	out := make([]fp.Op, 0, len(m.OwnerOps))
	for _, decl := range m.OwnerOps {
		invoke, ok := impls[decl.Op]
		if !ok {
			panic("supplier " + m.ID + " declares owner op " + decl.Name +
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
