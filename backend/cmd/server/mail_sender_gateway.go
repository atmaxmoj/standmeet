// mail_sender_gateway.go —— #135: mail-sender 从私有 "send" host op 迁到**固定词表** reach-back
// 网关(跟 booker_gateway 同构)。沙箱 mail-sender 经 connector.invoke("mail","send") 发信;host 侧
// 不再有 mail-sender 专属 handler(旧 capreg_mailsender.go 已删),只挂通用网关。

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capsocket"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capstore"
	capstoreroutes "github.com/atmaxmoj/standmeet/internal/routes/capstore"
	connectorroutes "github.com/atmaxmoj/standmeet/internal/routes/connector"
	ownerroutes "github.com/atmaxmoj/standmeet/internal/routes/owner"
)

// boundCapStore —— 把通用 capstore.Store 绑死到某个 cap 的隔离命名空间(reachback.CapStore 接口里
// 没 kind/id;沙箱填不了别人的)。mail-sender 现在不落存储,但网关提供完整固定词表面 —— 隔离到
// 自己的 schema,将来要存也够不到别的 cap。
type boundCapStore struct {
	store *capstore.Store
	kind  capstore.Kind
	id    string
}

func (b boundCapStore) Insert(
	ctx context.Context, collection string, doc json.RawMessage,
) (string, error) {
	id, err := b.store.Insert(ctx, b.kind, b.id, collection, doc)
	if err != nil {
		return "", fmt.Errorf("capstore insert: %w", err)
	}
	return id, nil
}

func (b boundCapStore) Query(
	ctx context.Context, collection string, filter json.RawMessage,
) ([]json.RawMessage, error) {
	docs, err := b.store.Query(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return nil, fmt.Errorf("capstore query: %w", err)
	}
	return docs, nil
}

func (b boundCapStore) Count(
	ctx context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	n, err := b.store.Count(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return 0, fmt.Errorf("capstore count: %w", err)
	}
	return n, nil
}

func (b boundCapStore) Delete(
	ctx context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	n, err := b.store.Delete(ctx, b.kind, b.id, collection, filter)
	if err != nil {
		return 0, fmt.Errorf("capstore delete: %w", err)
	}
	return n, nil
}

const mailSenderCapKind = capstore.KindMCP

var mailSenderCapID = "mail.send"

// wireMailSenderGateway —— provision mail-sender 的隔离 schema + 挂固定词表网关到 mail-sender.sock。
func wireMailSenderGateway(ctx context.Context, d *runtimeDeps) {
	store := capstore.New(d.db)
	if perr := store.Provision(ctx, mailSenderCapKind, mailSenderCapID); perr != nil {
		d.log.Error("mail-sender capstore provision", "err", perr)
		return
	}
	if mkErr := os.MkdirAll("/run/standmeet", socketDirMode); mkErr != nil {
		d.log.Error("mail-sender socket dir", "err", mkErr)
		return
	}
	srv, err := capsocket.Listen(ctx, "/run/standmeet/mail-sender.sock", d.log)
	if err != nil {
		d.log.Error("mail-sender socket listen", "err", err)
		return
	}
	bound := boundCapStore{store: store, kind: mailSenderCapKind, id: mailSenderCapID}
	connectorroutes.RegisterInvokeOp(srv, d.connectorSlots)
	capstoreroutes.RegisterOps(srv, bound)
	ownerroutes.RegisterOwnerMetaOp(srv, d.ownerRepo)
	go srv.Serve(ctx)
}
