// capreg_mcp_app_dial.go —— mcpAppCapability 的 transport 拨号子关注：把一条 manifest
// 的 Transport（stdio / http / in_process / sandbox_stdio）dial 成一个 mcpclient
// 会话。从 capreg_mcp_app.go 拆出来守 max-lines 350 cap。归一：四类走同一入口
// dialMCPApp，只是底层不同。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
	"github.com/atmaxmoj/standmeet/internal/infra/sandbox"
)

// transportDialers —— 每种 transport 一个拨号器，dialMCPApp 查表分发。in_process
// 内存直连同进程 server；sandbox_stdio 经 bwrap 隔离起第三方 server。workspaceDir 是
// 这次 session 懒建出来的 per-session 工作区（仅 sandbox_stdio + manifest workspace=true
// 时非空），非沙箱 dialer 忽略它。
var transportDialers = map[string]func(
	context.Context, *mcpplugin.Transport, string,
) (*mcpclient.Session, error){
	mcpplugin.TransportStdio:        dialStdio,
	mcpplugin.TransportHTTP:         dialHTTP,
	mcpplugin.TransportInProcess:    dialInProcess,
	mcpplugin.TransportSandboxStdio: dialSandboxStdio,
}

// dialMCPApp —— 查 transportDialers 分发。未知 kind → error。错误被 VisitorBinding
// 收成 ErrHidden,这里只负责 dial。
func dialMCPApp(
	ctx context.Context, t *mcpplugin.Transport, workspaceDir string,
) (*mcpclient.Session, error) {
	d, ok := transportDialers[t.Kind]
	if !ok {
		return nil, fmt.Errorf("plugin: unknown transport kind %q", t.Kind)
	}
	return d(ctx, t, workspaceDir)
}

func dialStdio(ctx context.Context, t *mcpplugin.Transport, _ string) (*mcpclient.Session, error) {
	sess, err := mcpclient.DialStdio(ctx, t.Command, t.Args, t.Env)
	return sess, wrapDial(err)
}

func dialHTTP(ctx context.Context, t *mcpplugin.Transport, _ string) (*mcpclient.Session, error) {
	sess, err := mcpclient.Dial(ctx, t.URL, t.Headers)
	return sess, wrapDial(err)
}

func dialInProcess(
	ctx context.Context, t *mcpplugin.Transport, _ string,
) (*mcpclient.Session, error) {
	sess, err := mcpclient.DialInProcess(ctx, t.InProcessServer)
	return sess, wrapDial(err)
}

// dialSandboxStdio —— 主进程把第三方 server 起在 bubblewrap 隔离环境里（只读 host
// 运行时 + 只读插件代码 + per-session workspace + tmpfs /tmp + 默认无网，碰不了
// host）；stdio 透明走 bwrap 的 stdin/stdout，dial 仍是普通 DialStdio，只是命令被包
// 了一层 `bwrap`。workspaceDir 非空 → bind 进沙箱的 /workspace（可写、跨 turn 持久）。
func dialSandboxStdio(
	ctx context.Context, t *mcpplugin.Transport, workspaceDir string,
) (*mcpclient.Session, error) {
	argv, aerr := sandboxStdioArgv(t, workspaceDir)
	if aerr != nil {
		return nil, wrapDial(aerr)
	}
	sess, derr := mcpclient.DialStdio(ctx, "bwrap", argv, t.Env)
	return sess, wrapDial(derr)
}

// sandboxStdioArgv —— 把 manifest 的沙箱声明 + 容器内启动命令拼成 `bwrap ...` argv
// （只读 host 运行时 / 只读插件代码 / tmpfs / 网络策略），交给 DialStdio。
func sandboxStdioArgv(t *mcpplugin.Transport, workspaceDir string) ([]string, error) {
	if t.Sandbox == nil {
		return nil, errors.New("plugin: sandbox_stdio missing sandbox config")
	}
	launch := &sandbox.StdioLaunch{
		CodeDir: t.Sandbox.PluginDir, // 插件代码（MinIO materialize 出来的只读 artifact）
		// WorkspaceDir —— per-session 懒建工作区（manifest workspace=true 才有），bind
		// 进沙箱 /workspace；空则该 session 无持久工作区（只有 ephemeral tmpfs /tmp）。
		WorkspaceDir: workspaceDir,
		Workspace:    t.Sandbox.Workspace, // 想要 /workspace（无 session 时 tmpfs 兜底）
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

// workspaceProvisioner —— composition root 注入的 per-session 工作区分配器（由
// internal/sandboxws.Manager.Provision 实现）。nil = 无工作区子系统（eval / 未配）。
var workspaceProvisioner func(sessionID string) (string, error)

// SetWorkspaceProvisioner —— composition root 注入工作区分配器。
func SetWorkspaceProvisioner(fn func(sessionID string) (string, error)) {
	workspaceProvisioner = fn
}

// provisionWorkspaceFor —— manifest 声明 workspace=true 且有 session id 时，懒建并返回
// 这次 session 的工作区 host 路径；否则 / 失败 → 空（沙箱无 /workspace）。
func provisionWorkspaceFor(m *mcpplugin.Manifest, sessionID string) string {
	if !wantsWorkspace(m, sessionID) {
		return ""
	}
	dir, err := workspaceProvisioner(sessionID)
	if err != nil {
		return ""
	}
	return dir
}

// wantsWorkspace —— 这次 dial 该不该分配持久工作区：插件声明了 workspace、有 session id、
// 且注入了 provisioner。
func wantsWorkspace(m *mcpplugin.Manifest, sessionID string) bool {
	s := m.Transport.Sandbox
	return s != nil && s.Workspace && sessionID != "" && workspaceProvisioner != nil
}

func wrapDial(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("plugin dial: %w", err)
}
