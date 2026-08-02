// Package hostop —— 宿主开给沙箱能力的那套词汇(入站方向)。
//
// 出站有 facadeparity:域声明自己会做什么,收口汇聚,各面投影。入站是它的镜像:沙箱里的
// 能力断了网,只能经一个 unix socket 回头问宿主要东西(读语料、发信、存自己的数据)。
// 这套词汇让**域说得出**它开了哪几件事,而域不必 import 路由,也不必 import 能力轴。
//
// 为什么不复用 facadeparity.Op:出站的身份是 owner,入站的身份是**会话**(owner +
// conversation,由宿主种在工具调用的 _meta 上、插件原样转进来)。两个身份混成一个类型,
// 读的人就分不清某个 op 到底是替谁在动。
package hostop

import (
	"context"
	"encoding/json"
	"path/filepath"
)

// SocketDir / SocketPath —— 一个能力的 socket 落在哪儿,由**宿主信任的 id** 派生。
//
// 路径不写进 manifest:声明说的是"我要哪几件事",不是"给我挂哪个文件"。开 socket 的
// (收口)和把它 bind 进沙箱的(装载器)照同一条规则算,所以两边不会各写一份路径。
const SocketDir = "/run/standmeet"

// SocketPath —— 派生某个能力的 socket 路径。
func SocketPath(pluginID string) string {
	return filepath.Join(SocketDir, pluginID+".sock")
}

// Invoke —— 一个 host op 真正做的事。入参出参都是不透明 JSON:身份在请求体里,
// 这套词汇跟传输无关。
type Invoke func(ctx context.Context, req json.RawMessage) (json.RawMessage, error)

// Op —— 宿主开给沙箱的一件事。
//
// Name 是固定词表里的一项(如 "conversation.read")。能力在自己的 manifest 里按名字点单,
// 点了词表里没有的名字 —— 启动就炸,不会等到 owner 点下去才发现。
type Op struct {
	Invoke      Invoke
	Name        string
	Description string
}
