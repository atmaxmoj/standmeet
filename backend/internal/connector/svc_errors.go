// errors.go —— connectorsvc 的 sentinel 错误。每个表达一种**调用方需要区分**的失败（routes 层据此
// 翻成不同 HTTP envelope）；分得开才不会把「坏 manifest / 内置改不得 / state 失效」混成一个含糊错。

package connector

import "errors"

// ErrNotFound —— 未知连接器 id（内置 manifest 里没有）。
var ErrNotFound = errors.New("connector not found")

// ErrNoOAuthClient —— oauth 连接器还没存 client_id（connect 前必须先存凭据）。
var ErrNoOAuthClient = errors.New("connector oauth client_id not set")

// ErrConnectionFailed —— protocol 连接器的连接测试失败（host/port/auth/TLS 错）。
var ErrConnectionFailed = errors.New("connector connection test failed")

// ErrInvalidManifest —— 上传的 spec/binding 装配期校验失败（坏 JSONata / 未知 op / 缺品类等）。
var ErrInvalidManifest = errors.New("invalid connector spec/binding")

// ErrBuiltinReadonly —— 对内置连接器做改/删（编辑 spec、删除）：内置来自 embed 数据，不可改。
// 跟 ErrInvalidManifest 分开——「你发了坏 manifest」和「这是内置改不得」是两码事。
var ErrBuiltinReadonly = errors.New("built-in connector is read-only")

// ErrInvalidOAuthState —— OAuth 回程的 state 空/过期/不匹配（防重放校验没过）。预期态（用户重放、
// 双击、state 过期），不是 client 没配——跟 ErrNoOAuthClient 分开。
var ErrInvalidOAuthState = errors.New("invalid or expired oauth state")
