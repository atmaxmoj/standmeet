// capreg_mcp_app_dial.go —— mcpAppCapability 的 transport 拨号子关注：把一条 manifest
// 的 Transport（stdio / http / in_process / sandbox_stdio）dial 成一个 mcpclient
// 会话。从 capreg_mcp_app.go 拆出来守 max-lines 350 cap。归一：四类走同一入口
// dialMCPApp，只是底层不同。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/sandbox"
)

// transportDialers —— 每种 transport 一个拨号器，dialMCPApp 查表分发。in_process
// 内存直连同进程 server；sandbox_stdio 经 bwrap 隔离起第三方 server。
var transportDialers = map[string]func(
	context.Context, *mcpplugin.Transport,
) (*mcpclient.Session, error){
	mcpplugin.TransportStdio:        dialStdio,
	mcpplugin.TransportHTTP:         dialHTTP,
	mcpplugin.TransportInProcess:    dialInProcess,
	mcpplugin.TransportSandboxStdio: dialSandboxStdio,
}

// dialMCPApp —— 查 transportDialers 分发。未知 kind → error。错误被 VisitorBinding
// 收成 ErrHidden,这里只负责 dial。
func dialMCPApp(ctx context.Context, t *mcpplugin.Transport) (*mcpclient.Session, error) {
	d, ok := transportDialers[t.Kind]
	if !ok {
		return nil, fmt.Errorf("plugin: unknown transport kind %q", t.Kind)
	}
	return d(ctx, t)
}

func dialStdio(ctx context.Context, t *mcpplugin.Transport) (*mcpclient.Session, error) {
	sess, err := mcpclient.DialStdio(ctx, t.Command, t.Args, t.Env)
	return sess, wrapDial(err)
}

func dialHTTP(ctx context.Context, t *mcpplugin.Transport) (*mcpclient.Session, error) {
	sess, err := mcpclient.Dial(ctx, t.URL, t.Headers)
	return sess, wrapDial(err)
}

func dialInProcess(ctx context.Context, t *mcpplugin.Transport) (*mcpclient.Session, error) {
	sess, err := mcpclient.DialInProcess(ctx, t.InProcessServer)
	return sess, wrapDial(err)
}

// dialSandboxStdio —— 主进程把第三方 server 起在 bubblewrap 隔离环境里（只读 host
// 运行时 + 只读插件代码 + per-session workspace + tmpfs /tmp + 默认无网，碰不了
// host）；stdio 透明走 bwrap 的 stdin/stdout，dial 仍是普通 DialStdio，只是命令被包
// 了一层 `bwrap`。
func dialSandboxStdio(ctx context.Context, t *mcpplugin.Transport) (*mcpclient.Session, error) {
	argv, aerr := sandboxStdioArgv(t)
	if aerr != nil {
		return nil, wrapDial(aerr)
	}
	sess, derr := mcpclient.DialStdio(ctx, "bwrap", argv, t.Env)
	return sess, wrapDial(derr)
}

// sandboxStdioArgv —— 把 manifest 的沙箱声明 + 容器内启动命令拼成 `bwrap ...` argv
// （只读 host 运行时 / 只读插件代码 / tmpfs / 网络策略），交给 DialStdio。
func sandboxStdioArgv(t *mcpplugin.Transport) ([]string, error) {
	if t.Sandbox == nil {
		return nil, errors.New("plugin: sandbox_stdio missing sandbox config")
	}
	launch := &sandbox.StdioLaunch{
		CodeDir: t.Sandbox.PluginDir, // 插件代码（MinIO materialize 出来的只读 artifact）
		// WorkspaceDir 暂空 —— per-session 懒建工作区接 session 上下文时再填（#148）。
		WorkspaceDir: "",
		Command:      t.Command,
		Args:         t.Args,
		AllowNet:     t.Sandbox.AllowNet,
		HostSockets:  t.Sandbox.HostSockets, // 数据型内建的窄 socket（断网也可达）
	}
	argv, err := launch.BwrapArgv()
	if err != nil {
		return nil, fmt.Errorf("plugin: build sandbox argv: %w", err)
	}
	return argv, nil
}

func wrapDial(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("plugin dial: %w", err)
}
