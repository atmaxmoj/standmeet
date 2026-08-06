// host_bridges.go —— 四座桥:公开的纯数据口 → 内部那几个端口。
//
// 每一座都只做转接和形状转换,**没有任何行为**:日历怎么回答、记录存在哪、配置改了什么,
// 全在调用方(eval-harness)那一侧。这正是 P.13 的分工 —— 桥归 backend,替身归 harness。

package agentcore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	conversationentity "github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
	conversationrepo "github.com/atmaxmoj/standmeet/internal/conversation/repo"
	ownerentity "github.com/atmaxmoj/standmeet/internal/owner/entity"
	capstoreroutes "github.com/atmaxmoj/standmeet/internal/routes/capstore"
)

// errNoConnector / errNoStore —— 能力点了这件事,而这一场没接上。**报出来**:悄悄回空会
// 让它以为"日历是空的 / 一条记录都没有",那是最难查的一种假绿。
var (
	errNoConnector = errors.New("agentcore: this launch wired no connector")
	errNoStore     = errors.New("agentcore: this launch wired no capability store")
)

// —— owner.meta ——

type ownerMetaBridge struct{ tz string }

func (b ownerMetaBridge) GetByID(_ context.Context, ownerID string) (ownerentity.Owner, error) {
	return ownerentity.Owner{ID: ownerID, ProfileTimezone: b.tz}, nil
}

// —— connector.invoke ——

type connectorBridge struct{ call ConnectorCall }

func (b connectorBridge) Invoke(
	_ context.Context, _, category, verb string, args json.RawMessage,
) (json.RawMessage, error) {
	if b.call == nil {
		return nil, errNoConnector
	}
	out, err := b.call(category+"."+verb, args)
	if err != nil {
		return nil, fmt.Errorf("connector %s.%s: %w", category, verb, err)
	}
	return out, nil
}

func (b connectorBridge) InvokeBackground(
	ctx context.Context, ownerID, category, verb string, args json.RawMessage,
) {
	_, _ = b.Invoke(ctx, ownerID, category, verb, args) //nolint:errcheck // 后台调用,丢结果
}

// —— capstore.* ——

// storeBridge —— 五个读写口都从调用方那三件事推出来:数一数 = 查了数长度,取文档 = 查了
// 丢掉 id。少一个 API,少一处两边会飘的地方。
type storeBridge struct{ store CapabilityStore }

func (b storeBridge) Insert(
	_ context.Context, collection string, doc json.RawMessage,
) (string, error) {
	if b.store == nil {
		return "", errNoStore
	}
	id, err := b.store.Insert(collection, doc)
	if err != nil {
		return "", fmt.Errorf("capability store insert: %w", err)
	}
	return id, nil
}

func (b storeBridge) Query(
	ctx context.Context, collection string, filter json.RawMessage,
) ([]json.RawMessage, error) {
	recs, err := b.QueryRecords(ctx, collection, filter)
	if err != nil {
		return nil, err
	}
	out := make([]json.RawMessage, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].Doc)
	}
	return out, nil
}

func (b storeBridge) Count(
	ctx context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	recs, err := b.QueryRecords(ctx, collection, filter)
	if err != nil {
		return 0, err
	}
	return int64(len(recs)), nil
}

func (b storeBridge) Delete(
	_ context.Context, collection string, filter json.RawMessage,
) (int64, error) {
	if b.store == nil {
		return 0, errNoStore
	}
	n, err := b.store.DeleteMatching(collection, filter)
	if err != nil {
		return 0, fmt.Errorf("capability store delete: %w", err)
	}
	return int64(n), nil
}

func (b storeBridge) QueryRecords(
	_ context.Context, collection string, filter json.RawMessage,
) ([]capstoreroutes.BoundRecord, error) {
	if b.store == nil {
		return nil, errNoStore
	}
	recs, err := b.store.Query(collection, filter)
	if err != nil {
		return nil, fmt.Errorf("capability store query: %w", err)
	}
	out := make([]capstoreroutes.BoundRecord, 0, len(recs))
	for i := range recs {
		out = append(out, capstoreroutes.BoundRecord{ID: recs[i].ID, Doc: recs[i].Doc})
	}
	return out, nil
}

func (b storeBridge) DeleteByID(_ context.Context, collection, recordID string) (int64, error) {
	if b.store == nil {
		return 0, errNoStore
	}
	gone, err := b.store.DeleteByID(collection, recordID)
	if err != nil {
		return 0, fmt.Errorf("capability store delete by id: %w", err)
	}
	if gone {
		return 1, nil
	}
	return 0, nil
}

// —— capconfig.get ——

// manifestConfigBridge —— 配置值:没被覆盖的项走 manifest 声明的默认值。
// **默认值不在这儿抄一份** —— 它读的就是 manifest。
type manifestConfigBridge struct{ host *CapabilityHost }

func (c manifestConfigBridge) Values(
	_ context.Context, _ string,
) (map[string]json.RawMessage, error) {
	out := map[string]json.RawMessage{}
	for i := range c.host.manifest.Config {
		f := c.host.manifest.Config[i]
		out[f.Key] = json.RawMessage(f.Default)
	}
	for k, v := range c.host.Config {
		out[k] = json.RawMessage(v)
	}
	return out, nil
}

// 接错了在这里红,而不是运行时少一件事。
var _ capstoreroutes.BoundStore = storeBridge{}

// —— conversation.read / inference.generate / report.store ——
//
// summarize 那类能力点这三件。同样只有桥:逐字稿是调用方给的数据,凭据走它已有的
// Driver 解析,报告交回调用方存 —— 这一层不产生任何内容。

// TranscriptTurn —— 逐字稿里的一句(role: "visitor" / "assistant")。
type TranscriptTurn struct {
	Role string
	Body string
}

// TranscriptSource —— 到**这一刻**为止说过的话。是个函数不是切片:socket 在开场时就起来了,
// 而逐字稿每一轮都在长 —— 取一次快照的话,总结那一轮读到的会是开场时的空。
type TranscriptSource func() []TranscriptTurn

// ReportSink —— 生成好的报告交给谁(调用方实现)。返回一个 id。
type ReportSink func(html string) (string, error)

type transcriptBridge struct{ src TranscriptSource }

func (b transcriptBridge) GetWithMessages(
	_ context.Context, _, chatID string,
) (conversationrepo.ChatWithMessages, error) {
	if b.src == nil {
		return conversationrepo.ChatWithMessages{}, errNoTranscript
	}
	turns := b.src()
	msgs := make([]conversationentity.Message, 0, len(turns))
	for _, t := range turns {
		msgs = append(msgs, conversationentity.Message{Role: t.Role, Body: t.Body})
	}
	return conversationrepo.ChatWithMessages{
		Chat:     conversationentity.Chat{ID: chatID},
		Messages: msgs,
	}, nil
}

// reportBridge —— report.store 的落点。存哪儿由调用方决定;这里只转形状。
type reportBridge struct{ sink ReportSink }

func (b reportBridge) Upsert(
	_ context.Context, in *conversationrepo.UpsertReportInput,
) (conversationentity.ChatReport, error) {
	if b.sink == nil {
		return conversationentity.ChatReport{}, errNoReportSink
	}
	id, err := b.sink(in.HTML)
	if err != nil {
		return conversationentity.ChatReport{}, fmt.Errorf("report sink: %w", err)
	}
	return conversationentity.ChatReport{ID: id, HTML: in.HTML}, nil
}

func (reportBridge) GetByID(
	_ context.Context, reportID string,
) (conversationentity.ChatReport, error) {
	return conversationentity.ChatReport{ID: reportID}, nil
}

// —— inference.generate ——

// credBridge —— 宿主按 owner+mode 解凭据那一步。这一侧只有一把(这一场用的那把):
// 沙箱同样看不见 key,它拿到的还是文本。
type credBridge struct{ cred *Cred }

func (b credBridge) Resolve(_ context.Context, _ *inference.ResolveInput) (*Cred, error) {
	if b.cred == nil {
		return nil, errNoCred
	}
	return b.cred, nil
}

// 能力点了这三件而这一场没接上 —— 一律报出来,理由同 errNoConnector。
var (
	errNoReportSink = errors.New("agentcore: this launch wired no report sink")
	errNoTranscript = errors.New("agentcore: this launch wired no transcript source")
	errNoCred       = errors.New("agentcore: this launch wired no credential")
)
