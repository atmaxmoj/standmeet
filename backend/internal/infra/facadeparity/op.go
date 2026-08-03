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

// File —— 随调用一起递过来的一份字节。
//
// 为什么它不塞进 args:args 是 JSON,把 25MB 的附件 base64 进去要多占三分之一的内存,而且
// 会长进 InputSchema —— 生成型的面(MCP)于是多出一个参数,而那个面**永远不该**填它:
// owner 通过 AI 递的是地址,字节在图床上。字节这条路只属于挑得动文件的那类面。
//
// 这个通道以前不存在,后果不是"少个功能",而是**每个要传文件的面只能绕过收口**:
// writings 那条 multipart 就是这么直连域的(见 check-routes-via-dispatcher 的基线)。
// 一道闸门挡住了唯一的路,代码就绕到闸门外面去 —— 缺的是机制,不是纪律。
type File struct {
	Field       string
	Filename    string
	ContentType string
	Body        []byte
}

// filesKey —— 随行字节在 context 里的键。包私有:别的包造不出这个键,
// 于是"谁能往里放"是可查的(只有 WithFiles 这一个入口)。
type filesKey struct{}

// WithFiles —— 把随行字节挂到这次调用上。
//
// 走 context 而不是给 Invoke 加一个参数,是为了**装饰器链只有一条**:鉴权 / 配额 / 审计
// 包的还是同一个 Invoke。开第二个执行入口的话,这些策略就得记得也包那一个 —— 那正是
// 收口存在要消灭的那种"记得"。
func WithFiles(ctx context.Context, files []File) context.Context {
	return context.WithValue(ctx, filesKey{}, files)
}

// FilesFrom —— 这次调用带了哪些字节。没带就是空 —— 空不是"坏了",是"owner 给的是地址"。
func FilesFrom(ctx context.Context) []File {
	files, ok := ctx.Value(filesKey{}).([]File)
	if !ok {
		return []File{}
	}
	return files
}

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
