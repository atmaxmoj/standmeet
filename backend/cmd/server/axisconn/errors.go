// errors.go —— 连接器的域错误 → 收口的分类错误。
//
// `internal/connector/svc_errors.go` 把失败分成了**调用方需要区分**的几种(坏 manifest /
// 内置改不得 / 连不上 / 没配 client_id),分得开才不会混成一个含糊错。那份区分以前由
// admin 那条手写路由翻成 HTTP(`routes/admin/connectors_errors.go` 的 writeConnErr);
// 操作搬进收口之后没人再翻,于是**每一种都落成 500** —— owner 删一个内置连接器,产品告诉他
// "服务器错误",而真相是"这个连接器不能删"。
//
// 所以翻译跟着操作一起搬:域声明自己的 op,也声明自己的失败长什么样。收口和各个面照旧
// 只认 fp 的那几类,不必认识"连接器"这个概念。

package axisconn

import (
	"errors"

	"github.com/atmaxmoj/standmeet/internal/connector"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// connErr —— 把连接器的 sentinel 翻成收口认得的类别。认不出来的才是真故障(500)。
//
// what 只在真故障那一支用得上:分得出类别的错,消息是给 owner 看的,不该再套一层
// "delete connector: " 这种内部动作名。
func connErr(what string, err error) error {
	// ErrInvalidManifest 单独一支:它要带上**具体原因**(坏 JSONata / 未知 op / 未知品类 /
	// 够到内网),owner 才知道该改哪 —— 一句通用的"spec 无效"等于没说。
	if errors.Is(err, connector.ErrInvalidManifest) {
		return fp.Coded(fp.BadInput(err.Error()), "invalid_manifest")
	}
	for i := range connCases {
		if errors.Is(err, connCases[i].sentinel) {
			return connCases[i].as
		}
	}
	return fp.OpErr(what, err)
}

// 对外的说法。全是给 owner 看的人话 —— 不是内部动作名,也不是 sentinel 的原文。
const (
	msgBuiltinReadonly = "this connector is built-in and cannot be edited or deleted"
	msgConnectFailed   = "connection test failed — check host/port/credentials"
	msgNoCreds         = "connector credentials not set"
	msgStaleOAuth      = "this authorization link is expired or already used — start again"
)

// connCases —— sentinel → 对外的说法。表驱动:加一种连接器错只加一行。
var connCases = []struct {
	sentinel error
	as       error
}{
	{connector.ErrNotFound, fp.NotFound("no such connector")},
	{connector.ErrBuiltinReadonly, fp.Coded(fp.Conflict(msgBuiltinReadonly), "builtin_readonly")},
	{connector.ErrConnectionFailed, fp.BadInput(msgConnectFailed)},
	{connector.ErrNoOAuthClient, fp.BadInput(msgNoCreds)},
	{connector.ErrInvalidOAuthState, fp.BadInput(msgStaleOAuth)},
}
