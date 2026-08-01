// op.go —— 一个操作的完整声明,以及它做的事。
//
// 这套词汇住在这里而不是收口旁边,是为了让**域说得出自己会什么**:域声明操作时不必
// import 任何路由包。词汇一旦住进收口,域就说不出口,声明只好挪到唯一能同时看见两边的
// 地方,那里又得把域已有的入参出参复述一遍 —— 同一个概念于是有了第二个名字。

package facadeparity

import (
	"context"
	"encoding/json"
)

// Invoke —— 一个操作真正做的事。入参出参都是不透明 JSON:这套词汇跟协议无关,
// 所以它能命名一个操作,而不必知道调用方是从 MCP、HTTP 还是别的还没写的东西过来的。
type Invoke func(ctx context.Context, ownerID string, args json.RawMessage) (json.RawMessage, error)

// NoArgs —— 不收参数的操作的入参 schema。
var NoArgs = json.RawMessage(`{"type":"object","properties":{}}`)

// Op —— 一个操作的整份声明:稳定 id、给调用方看的说明、入参 schema、语义类别、
// 暴露意图(哪些面欠它),以及实现。
type Op struct {
	Invoke      Invoke
	ID          string
	Description string
	InputSchema json.RawMessage
	Reach       Reach
	Kind        Kind
}
