// scopes.go —— 「这一步要什么权限」。
//
// 跟 runtime.go 分开：那边管**怎么发这个请求**（解 operationId、拼 URL、注认证、送出去），
// 这边只回答**做这一步需要哪些 scope**。两件事的读者不一样：前者是排查一次调用为什么失败，
// 后者是在**还没调用之前**判断这个 owner 的授权够不够（F-B-8）。

package openapi

// ScopesFor —— 这个 operation 在 spec 里自己声明需要哪些 scope。
// 没声明 → 空切片，调用方据此当「这一步不要求额外权限」。
//
// 这是「授到的 ⊇ 需要的」那句判断的右半边；左半边（授到了什么）在连接行上。
func (r *Runtime) ScopesFor(operationID string) []string {
	return r.spec.ScopesFor(operationID)
}
