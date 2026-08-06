// builtin_spec.go —— 用**产品自己发的那份 manifest** 造一个 eval 的 PluginSpec。
//
// 在这之前每个 eval 挂插件都手抄一遍它的属性(host ops / raw 工具名 / ACL 档)。手抄的那份
// 不会跟着 manifest 变:manifest 改了 acl,eval 还按旧档装,于是 eval 测的是一个产品里
// 不存在的配置 —— 而它会一直绿。
//
// 声明只有一份:backend/capabilities/<id>/manifest.yaml,go:embed 进二进制,prod 和 eval
// 读的是同一份字节。

package agentcore

import (
	"fmt"

	"github.com/atmaxmoj/standmeet/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// BuiltinManifest —— 按 id 取一份内建能力声明。找不到 → error(拼错了 id 该当场知道)。
func BuiltinManifest(id string) (mcpplugin.Manifest, error) {
	all, err := capabilities.Load()
	if err != nil {
		return mcpplugin.Manifest{}, fmt.Errorf("load builtin manifests: %w", err)
	}
	for i := range all {
		if all[i].ID == id {
			return all[i], nil
		}
	}
	return mcpplugin.Manifest{}, fmt.Errorf("no builtin capability %q", id)
}

// BuiltinPluginSpec —— 内建能力的 manifest → eval 的 PluginSpec。
//
// command 是**这台机器上编好的**插件二进制(manifest 里那个 /plugin/xxx 是 prod 的沙箱内
// 路径),sock 是 mini-host 的 socket。其余全部照 manifest:点了哪些 host op、工具名加不加
// 前缀、ACL 是哪一档。
func BuiltinPluginSpec(id, command, sock string) (PluginSpec, error) {
	m, err := BuiltinManifest(id)
	if err != nil {
		return PluginSpec{}, err
	}
	spec := PluginSpec{
		ID: m.ID, Command: command,
		RawToolNames: m.RawToolNames,
		ACLAlways:    m.ACL == mcpplugin.ACLAlways,
	}
	if m.Transport.Sandbox != nil {
		spec.HostOps = m.Transport.Sandbox.HostOps
	}
	if len(spec.HostOps) > 0 {
		spec.Env = map[string]string{HostSocketEnv: sock}
	}
	return spec, nil
}
