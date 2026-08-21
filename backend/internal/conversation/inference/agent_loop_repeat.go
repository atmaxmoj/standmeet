// agent_loop_repeat.go —— **工具循环和压缩互相追着跑**那条路的边界（F-D-14）。
//
// prod 上量到的（真第三方 DeepWiki）：一轮里同一次 `read_wiki_contents` 被派发 **8 次**，每次
// 回 374871 字节，中间夹着 **8 次** `context compacted`，两者交替，整轮 248 秒。机制不神秘：
// 那份结果**作为消息本身就活不过 32K 窗口**，压缩必然吃掉它（tailPlainTurns 连工具痕迹一起
// 丢，见 agent_compaction.go），模型发现证据没了就再取一遍 —— 而再取一遍又把窗口顶爆。
//
// **重取不是缺陷**：eval 那侧量过，那是模型正常的恢复动作。缺陷是**没有任何东西打断这个
// 循环**。所以这里补的不是「禁止重复调用」，是一份**这一轮自己的台账**：同一次调用第二次
// 来的时候，不再打到对面，而是回一份**有界的、活得过压缩的**摘要。
//
// **只管大结果**（oversizedResultBytes）。小结果重复调用必须照常派发：「约完之后再查一次
// 时段」是真实且正确的动作，一刀切按 (name,args) 去重会把它一起拿掉，而那种闸门 CI 全绿、
// 闸门不响（[[gate-granularity-removes-working-action]]）。

package inference

import (
	"context"
	"fmt"
	"sync"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"

	"github.com/atmaxmoj/standmeet/internal/infra/textcut"
)

// oversizedResultBytes —— 大到「一个人就能把窗口顶爆」的结果，从阈值**推**出来而不是手填：
// 压缩线是 contextTokenThreshold 个 token，按 eino 自己的 chars/4 估算换成字节，取一半 ——
// 也就是「这一条结果吃掉半个窗口」。手填一个 64000 会在阈值改动的那天悄悄失准
// （[[computed-class-generates-nothing]] 那一族：名字说它在表达某个量，实际是个常量）。
const oversizedResultBytes = contextTokenThreshold * 4 / 2

// repeatSliceBytes —— 每次交出去一段有多大。同样从窗口**推**出来：「大到撑爆」的一半，
// 也就是窗口的四分之一。
//
// 第一版填的是 6000，而窗口是 12 万字节 —— 谨慎得没有道理，代价是 prod 上那一轮答不出
// 「怎么跑一个」。判据是「这一段活得过压缩」，不是「这一段越小越安全」。
const repeatSliceBytes = oversizedResultBytes / 2

// repeatLedger —— 这一轮派发过的**大**结果：(工具名, 参数) → 全文 + 读到哪儿了。
//
// 它是 Go 侧的状态，不是消息 —— 所以压缩碰不到它。这正是要点：被压掉的那件事，
// 记在压缩够不着的地方。
//
// **为什么存全文 + 游标，而不是一份固定摘要**：⑤ 在 prod 上量出来的。第一版每次重复
// 都回**同一个开头**，于是那一轮的答案从「七个 server + 四种跑法带命令」退成「六个
// server + 我看不到跑法那一段」—— 循环是断了，答案也变差了。回头看那八次重取才明白：
// 模型再问一遍**要的是后面**，八次取回来的其实是在跨压缩**翻页**。所以把这件事做成
// 它本来的样子：第二次给第二段，第三次给第三段，翻完为止。
type repeatLedger struct {
	seen map[string]*repeatEntry
	mu   sync.Mutex
}

// repeatEntry —— 一次大结果的全文，以及已经交出去多少字节。
type repeatEntry struct {
	body   string
	offset int
}

func newRepeatLedger() *repeatLedger {
	return &repeatLedger{seen: map[string]*repeatEntry{}}
}

// repeatSlice —— nextSlice 的答复：这次交出去的一段、后面还有没有、这个 key 认不认识。
// 三件事装一个值：revive 只许两个返回值，而把 known 挤掉会让「没见过」和「翻完了」
// 变成同一种答案 —— 那正好是这条边界最不能混的两种。
type repeatSlice struct {
	text  string
	more  bool
	known bool
}

// nextSlice —— 这一次调用之前做过吗；做过就把**下一段**交出去，并说清还有没有更多。
func (l *repeatLedger) nextSlice(key string) repeatSlice {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.seen[key]
	if !ok {
		return repeatSlice{}
	}
	if e.offset >= len(e.body) {
		return repeatSlice{known: true} // 翻完了：一个字都没有了，得如实说
	}
	end := min(e.offset+repeatSliceBytes, len(e.body))
	text := textcut.BytesMark(e.body[e.offset:end], repeatSliceBytes)
	e.offset = end
	return repeatSlice{text: text, more: e.offset < len(e.body), known: true}
}

// remember —— 只记**大**结果。游标从 **0** 起：第一次那份全文模型确实收到过，但压缩把它
// 吃掉了 —— 它现在手上什么都没有，所以翻页从头翻，不是从「它见过的地方」往后。
// 小结果不记：它自己活得过压缩，模型再问一次是它的事。
func (l *repeatLedger) remember(key, result string) {
	if len(result) < oversizedResultBytes {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.seen[key] = &repeatEntry{body: result, offset: 0}
}

// repeatKey —— 一次调用的身份是**名字加参数**，不是名字。
// 只按名字去重会把「换个参数再查一次」也吃掉（[[read-the-key-not-the-name]]）。
func repeatKey(name, args string) string {
	return name + "\x00" + args
}

// repeatNote —— 第二次来的时候回给模型的东西。
//
// 措辞照着「模型接下来该做什么」写：说清**已经取过**、给出**当时取到的开头**、并且点明
// 它取不到更多了 —— 否则它只会把同一次调用再发一遍（那正是这条边界要断的循环）。
// 跟 evidenceDigest 一样，**如实说这是部分内容**：把缺口读成「不存在」是更坏的失败
// （chain-exhaustion eval 抓到过那一次）。
func repeatNote(name string, s repeatSlice) string {
	tail := "That is the end of the result — there is no more of it. Answer the visitor from " +
		"what you have, and say plainly which part of their question it doesn't cover."
	if s.more {
		tail = "There is MORE after this. Call the tool with these same arguments again to get " +
			"the next part — each call hands you the next section, it does not re-fetch."
	}
	return fmt.Sprintf(
		"You already called %s with these exact arguments earlier in this turn, and its result is "+
			"far too large to hold in context all at once — so it is being handed to you in "+
			"sections rather than fetched again. Here is the next section:\n\n%s\n\n%s",
		name, s.text, tail)
}

// exhaustedNote —— 翻完了还在问。说清楚「没有更多了」，别让它以为再来一次就有。
func exhaustedNote(name string) string {
	return fmt.Sprintf(
		"You have already been handed every section of %s's result for these arguments this "+
			"turn. There is nothing further to fetch. Answer the visitor now from what you "+
			"have, and say plainly which part of their question the material doesn't cover.", name)
}

// repeatGuardedTool —— 一个工具的外壳：先问台账，没做过才真派发。
type repeatGuardedTool struct {
	inner  tool.InvokableTool
	ledger *repeatLedger
	name   string
}

func (t *repeatGuardedTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
	return t.inner.Info(ctx) //nolint:wrapcheck // 纯转发，包一层只会让错误更难读
}

func (t *repeatGuardedTool) InvokableRun(
	ctx context.Context, args string, opts ...tool.Option,
) (string, error) {
	key := repeatKey(t.name, args)
	if s := t.ledger.nextSlice(key); s.known {
		if s.text == "" {
			return exhaustedNote(t.name), nil
		}
		return repeatNote(t.name, s), nil
	}
	out, err := t.inner.InvokableRun(ctx, args, opts...)
	if err != nil {
		return out, err //nolint:wrapcheck // 工具自己的错误原样上浮，这层不改写它
	}
	t.ledger.remember(key, out)
	return out, nil
}

// guardRepeats —— 给这一轮的工具集套上台账。
//
// **只包 invokable 的**：流式工具包成非流式会悄悄换掉它的行为，而这条边界跟流式无关
// （[[move-the-capability-move-its-edges]]：搬家时不跟着走的那些边，失效时不报错）。
func guardRepeats(ctx context.Context, tools []tool.BaseTool) []tool.BaseTool {
	ledger := newRepeatLedger()
	out := make([]tool.BaseTool, 0, len(tools))
	for _, t := range tools {
		guarded, ok := guardOne(ctx, t, ledger)
		if !ok {
			out = append(out, t)
			continue
		}
		out = append(out, guarded)
	}
	return out
}

// guardOne —— 包得住就返回外壳，包不住返回 false（caller 原样放行）。
// 不返回 `tool.BaseTool`：那样每一个「放行」分支都得再造一次接口值，读的人也分不清
// 「包过了」和「原样过」。
func guardOne(
	ctx context.Context, t tool.BaseTool, ledger *repeatLedger,
) (*repeatGuardedTool, bool) {
	inv, ok := t.(tool.InvokableTool)
	if !ok {
		return nil, false
	}
	if _, streaming := t.(tool.StreamableTool); streaming {
		return nil, false
	}
	info, err := t.Info(ctx)
	if err != nil || info == nil {
		return nil, false
	}
	return &repeatGuardedTool{inner: inv, ledger: ledger, name: info.Name}, true
}
