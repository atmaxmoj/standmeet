// agent_turn_persist.go —— #28: 后端拥有这一轮。agent 事件流末端的「DB sink」。
//
// 设计是 stream → (tee) → {显示 sink, 累计}。sseSink 是显示 tap(sink 到浏览器,
// 断了无所谓);accumSink 包住它,把同一条流累计成一个纯 TurnResult,loop 收尾时
// 交给注入的 PersistFunc sink 进 conversation 表 —— 那才是 durable 的落点。
//
// DDD:inference 只懂「流」,不碰 DB。落库通过注入的 port(PersistFunc)触发,
// inference 不知道落哪(routes/usecases 层给闭包,走 RecordDialog)。citation /
// tool_calls 的累计形态跟前端老做法一字不差(corpus_read 结果扒 entry id;
// tool_calls = [{name, ok, result}]),只是 sink 从「前端当 sink」挪到了流末端。

package inference

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
)

// TurnResult —— 一整轮在后端累计出的可落库产物。Question 由 caller 从
// in.Req.UserMessage 填(accumSink 不知道问句);其余从事件流累出来。
type TurnResult struct {
	Question       string
	Answer         string
	ToolCalls      json.RawMessage
	CitedWikiIDs   []string
	CitedOutputIDs []string
}

// PersistFunc —— 落库 port。RunAgentTurn 在 loop 收尾(且 AI 答出了内容)时调
// 一次。ctx 是 detached 过的(客户端断开也活着),所以即便流没人收也照样 sink。
type PersistFunc func(ctx context.Context, res *TurnResult) error

// persistedToolCall —— 落库形态的一条 tool 调用。result 原样透(整个 tool 输出
// JSON);ok 从顶层 envelope 取。跟前端 ToolCallView / dialogRequest.tool_calls
// 对齐,conversation 读模型 + admin transcript 照原样渲。
// 字段顺序按 govet fieldalignment 排:含指针的(string / slice)连续在前,bool
// 末尾。JSON 按 key 解,顺序无所谓。
type persistedToolCall struct {
	Name   string          `json:"name"`
	Result json.RawMessage `json:"result"`
	OK     bool            `json:"ok"`
}

// accumSink —— tee:转发给显示 sink(inner),同时在流末端累计 TurnResult。
// 纯累计,不碰 DB。answer 累 text delta;tool_calls 按落库形态收;citations
// 从 corpus_read 结果扒 entry id(按 id 去重)。
type accumSink struct {
	inner AgentSink
	// onDone —— 流收尾 hook,在把 `done` 帧转发给浏览器**之前**跑(落库)。这样
	// `done` 帧就代表「这一轮已提交」:浏览器收到 done 后 reload,GET conversation
	// 必见这轮,无 persist-vs-reload 竞态。RunAgentTurn 注入 = 落库闭包。
	onDone   func()
	tools    []persistedToolCall
	wikiIDs  []string
	outIDs   []string
	seenCite map[string]bool
	answer   strings.Builder
}

var _ AgentSink = (*accumSink)(nil)

func newAccumSink(inner AgentSink) *accumSink {
	return &accumSink{inner: inner, seenCite: map[string]bool{}}
}

func (a *accumSink) Text(delta string) {
	// strings.Builder.WriteString 永不返错;显式弃返回值(revive unhandled-error)。
	_, _ = a.answer.WriteString(delta)
	a.inner.Text(delta)
}

func (a *accumSink) ToolStarted(id, name, progressLabel string, args json.RawMessage) {
	a.inner.ToolStarted(id, name, progressLabel, args)
}

func (a *accumSink) ToolCompleted(name, result string) {
	a.accumulateTool(name, result)
	a.inner.ToolCompleted(name, result)
}

func (a *accumSink) Ghosts(items []string) { a.inner.Ghosts(items) }
func (a *accumSink) Retrying(attempt int)  { a.inner.Retrying(attempt) }
func (a *accumSink) Error(err error)       { a.inner.Error(err) }

// Done —— 先落库(onDone)再转发 `done` 帧。顺序是刻意的:浏览器把 done 当
// 「turn 提交完成」信号,落库必须在它之前完成。
func (a *accumSink) Done(stop string) {
	if a.onDone != nil {
		a.onDone()
	}
	a.inner.Done(stop)
}

// accumulateTool —— 一个 tool 完成:按落库形态收 {name, ok, result},并从
// corpus_read 结果扒 citation entry id。
func (a *accumSink) accumulateTool(name, result string) {
	ok := envelopeOK(result)
	a.tools = append(a.tools, persistedToolCall{
		Name: name, OK: ok, Result: json.RawMessage(result),
	})
	if ok {
		a.collectCitation(name, result)
	}
}

// envelopeOK —— result 顶层若是带 `ok: bool` 的 envelope 就取它,否则当成功
// (bare array / flat object / 标量)。跟前端 safeParseToolResult 一致。
func envelopeOK(result string) bool {
	var probe map[string]json.RawMessage
	if json.Unmarshal([]byte(result), &probe) != nil {
		return true
	}
	raw, has := probe["ok"]
	if !has {
		return true
	}
	var b bool
	if json.Unmarshal(raw, &b) != nil {
		return true
	}
	return b
}

// collectCitation —— corpus_read 成功结果(flat object {id, genre, ...})扒
// entry id,按 genre 归 wiki / output,按 id 去重(同 entry 读多次只引一次)。
// caller 保证只在 ok 时调。
func (a *accumSink) collectCitation(name, result string) {
	if name != "corpus_read" {
		return
	}
	c := parseCitedEntry(result)
	if c.ID == "" || a.seenCite[c.ID] {
		return
	}
	a.seenCite[c.ID] = true
	if c.Genre == "output" {
		a.outIDs = append(a.outIDs, c.ID)
		return
	}
	a.wikiIDs = append(a.wikiIDs, c.ID)
}

// citedEntry —— corpus_read flat object 里取 citation 用的两字段。
type citedEntry struct {
	ID    string `json:"id"`
	Genre string `json:"genre"`
}

// parseCitedEntry —— corpus_read 结果解出 citation entry;解析失败 → 零值。
func parseCitedEntry(result string) citedEntry {
	var c citedEntry
	if json.Unmarshal([]byte(result), &c) != nil {
		return citedEntry{}
	}
	return c
}

func (a *accumSink) answered() bool {
	return a.answer.Len() > 0
}

// result —— 累计完一轮后产出 TurnResult。tool_calls 空也给 `[]`(读模型
// rawOrEmptyArray 期望非 nil)。
func (a *accumSink) result(question string) *TurnResult {
	return &TurnResult{
		Question:       question,
		Answer:         a.answer.String(),
		ToolCalls:      a.marshalTools(),
		CitedWikiIDs:   a.wikiIDs,
		CitedOutputIDs: a.outIDs,
	}
}

func (a *accumSink) marshalTools() json.RawMessage {
	if len(a.tools) == 0 {
		return json.RawMessage("[]")
	}
	b, err := json.Marshal(a.tools)
	if err != nil {
		return json.RawMessage("[]")
	}
	return b
}

// persistTurn —— loop 收尾把累计的这一轮 sink 进 DB(注入的 PersistFunc)。
// 只有 AI 真答出内容才落(锁定模型:dialog 持久化 iff 答完);没注入 port
// (无 conversation 的无状态 smoke 调用)或没答案则跳过。
func persistTurn(ctx context.Context, log *slog.Logger, in *AgentTurnInput, acc *accumSink) {
	if in.Persist == nil || !acc.answered() {
		return
	}
	if err := in.Persist(ctx, acc.result(in.Req.UserMessage)); err != nil {
		log.Error("agent turn persist", logErrKey, err)
	}
}
