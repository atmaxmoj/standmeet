// gateway_test.go —— 固定词表 handler 的纯 UT(不起真 socket)。证明:请求路由到后端、
// owner.meta 白名单外的字段被拒(不泄露任意 owner 数据)。

package reachback //nolint:testpackage // 测未导出 handler(d.connectorInvoke 等),必须同包

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type fakeInvoker struct {
	gotCategory string
	gotVerb     string
}

func (f *fakeInvoker) Invoke(
	_ context.Context, _, category, verb string, _ json.RawMessage,
) (json.RawMessage, error) {
	f.gotCategory = category
	f.gotVerb = verb
	return json.RawMessage(`{"ok":true}`), nil
}

type fakeStore struct {
	gotCollection string
	gotDoc        json.RawMessage
}

func (f *fakeStore) Insert(
	_ context.Context, collection string, doc json.RawMessage,
) (string, error) {
	f.gotCollection = collection
	f.gotDoc = doc
	return "rec-1", nil
}

func (*fakeStore) Query(
	_ context.Context, _ string, _ json.RawMessage,
) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"a":1}`)}, nil
}

func (*fakeStore) Count(_ context.Context, _ string, _ json.RawMessage) (int64, error) {
	return 3, nil
}

type fakeOwner struct{ gotField string }

func (f *fakeOwner) Meta(_ context.Context, _, field string) (string, error) {
	f.gotField = field
	return "Asia/Shanghai", nil
}

type kit struct {
	d   *Deps
	inv *fakeInvoker
	st  *fakeStore
	ow  *fakeOwner
}

func newKit() *kit {
	inv, st, ow := &fakeInvoker{}, &fakeStore{}, &fakeOwner{}
	return &kit{d: &Deps{Connectors: inv, Store: st, Owner: ow}, inv: inv, st: st, ow: ow}
}

func TestConnectorInvoke_RoutesToBackend(t *testing.T) {
	t.Parallel()
	k := newKit()
	raw := json.RawMessage(
		`{"owner_id":"o1","category":"calendar","verb":"insert_event","args":{}}`)
	out, err := k.d.connectorInvoke(context.Background(), raw)
	if err != nil {
		t.Fatalf("connectorInvoke: %v", err)
	}
	if k.inv.gotCategory != "calendar" || k.inv.gotVerb != "insert_event" {
		t.Fatalf("wrong route: cat=%q verb=%q", k.inv.gotCategory, k.inv.gotVerb)
	}
	if !strings.Contains(string(out), "ok") {
		t.Fatalf("lost backend response: %s", out)
	}
}

func TestCapstoreInsert_ReachesStore(t *testing.T) {
	t.Parallel()
	k := newKit()
	raw := json.RawMessage(`{"collection":"bookings","doc":{"code_id":"c1"}}`)
	out, err := k.d.capstoreInsert(context.Background(), raw)
	if err != nil {
		t.Fatalf("capstoreInsert: %v", err)
	}
	if k.st.gotCollection != "bookings" || !strings.Contains(string(k.st.gotDoc), "c1") {
		t.Fatalf("insert lost fields: coll=%q doc=%s", k.st.gotCollection, k.st.gotDoc)
	}
	if !strings.Contains(string(out), "rec-1") {
		t.Fatalf("insert did not return id: %s", out)
	}
}

func TestOwnerMeta_WhitelistOnly(t *testing.T) {
	t.Parallel()
	k := newKit()

	if _, err := k.d.ownerMeta(
		context.Background(), json.RawMessage(`{"owner_id":"o1","field":"timezone"}`)); err != nil {
		t.Fatalf("whitelisted field timezone must pass: %v", err)
	}
	if k.ow.gotField != "timezone" {
		t.Fatalf("owner.meta did not forward field: %q", k.ow.gotField)
	}

	_, err := k.d.ownerMeta(
		context.Background(), json.RawMessage(`{"owner_id":"o1","field":"email"}`))
	if err == nil {
		t.Fatal("non-whitelisted field must be refused (no arbitrary owner data)")
	}
	if !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("unexpected refusal error: %v", err)
	}
}
