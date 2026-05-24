// Package sandbox runs untrusted owner-curated scripts inside disposable
// docker containers. 设计源自 legacy
// standmeet-server/gateway/src/runtime/sandbox.ts，移植成 Go subprocess
// 调用 `docker run`。
//
// 安全模型：
//   - --network=none  → 脚本进不了网
//   - --read-only     → root fs 不可写
//   - --tmpfs /tmp    → 64MB 临时盘
//   - --memory + --cpus → 资源上限
//   - --rm            → 容器跑完就 GC
//   - args 通过 ARGS env 传 JSON 字符串，脚本用语言内置 env 拆
//
// Runner 是接口让 dev/prod 走 docker、未受信环境走 disabled。
package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"time"
)

// Runner —— sandbox 后端抽象。实现：DockerRunner / DisabledRunner。
type Runner interface {
	Run(ctx context.Context, in *RunInput) (Result, error)
}

// RunInput —— Run 入参。
type RunInput struct {
	Language string // 'python' | 'bash' | 'javascript'
	Script   string // 脚本源码
	ArgsJSON string // JSON string, 传给脚本的 ARGS env
	Timeout  time.Duration
}

// Result —— 脚本执行结果。
type Result struct {
	Stdout   string
	Stderr   string
	ExitCode int
	TimedOut bool
}

// ErrDisabled —— SANDBOX_DRIVER=disabled 或 driver 未初始化。
var ErrDisabled = errors.New("sandbox: disabled")

// ErrUnsupportedLanguage —— language 不在白名单。
var ErrUnsupportedLanguage = errors.New("sandbox: unsupported language")

const (
	defaultTimeout  = 30 * time.Second
	memoryLimit     = "256m"
	cpuLimit        = "0.5"
	tmpfsSize       = "size=64m"
	maxOutputBytes  = 1 << 20 // 1MB stdout+stderr cap
	killGracePeriod = 5 * time.Second
)

// languageImages —— 白名单 + 对应 docker image。owner 写 skill script 时
// 选其中一种 language。新加语言走 PR review。
var languageImages = map[string]string{
	"python":     "python:3.11-slim",
	"bash":       "bash:5",
	"javascript": "node:20-slim",
}

// DockerRunner —— 通过 docker CLI 调用本机 docker daemon (通常 mount
// /var/run/docker.sock 进 backend 容器)。
type DockerRunner struct{}

// NewDockerRunner 构造 DockerRunner。
func NewDockerRunner() *DockerRunner { return &DockerRunner{} }

// Run 执行脚本。返回 Result + err；err 只在 setup 阶段非 nil
// (unsupported language / docker 不可用)，脚本本身退出码非 0 走 Result。
func (*DockerRunner) Run(ctx context.Context, in *RunInput) (Result, error) {
	image, ok := languageImages[in.Language]
	if !ok {
		return Result{}, fmt.Errorf("%w: %s", ErrUnsupportedLanguage, in.Language)
	}
	timeout := in.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	cmd := buildDockerCmd(ctx, image, in)
	return runDockerCmd(cmd, timeout)
}

// buildDockerCmd —— 拼 `docker run --rm --network=none ...`。脚本通过
// stdin 喂语言 interpreter？这里跟 legacy 一致用 -c/-e 在 argv 传。
//
// docker 命令路径硬编码 + 参数全部受控来自语言白名单 + owner-controlled
// script content；脚本本身在 --network=none + --read-only sandbox 里跑，
// shell-injection 攻击面在容器外是 zero。
//
//nolint:gosec // docker subprocess 参数受控；脚本内容在沙箱内执行。
func buildDockerCmd(ctx context.Context, image string, in *RunInput) *exec.Cmd {
	argsEnv := in.ArgsJSON
	if argsEnv == "" {
		argsEnv = "{}"
	}
	interp := interpreterFor(in.Language)
	args := []string{
		"run", "--rm",
		"--network=none",
		"--memory=" + memoryLimit,
		"--cpus=" + cpuLimit,
		"--read-only",
		"--tmpfs", "/tmp:" + tmpfsSize,
		"--env", "ARGS=" + argsEnv,
		image,
		interp[0], interp[1], in.Script,
	}
	return exec.CommandContext(ctx, "docker", args...)
}

func interpreterFor(language string) [2]string {
	switch language {
	case "python":
		return [2]string{"python3", "-c"}
	case "javascript":
		return [2]string{"node", "-e"}
	default: // bash
		return [2]string{"bash", "-c"}
	}
}

// runDockerCmd —— exec docker、wait、cap output。timeout 用 context cancel
// 触发 `docker run` 被 kill，container --rm 自动清理。
func runDockerCmd(cmd *exec.Cmd, timeout time.Duration) (Result, error) {
	deadline := time.Now().Add(timeout)
	stdoutBuf := newCappedBuffer(maxOutputBytes)
	stderrBuf := newCappedBuffer(maxOutputBytes)
	cmd.Stdout = stdoutBuf
	cmd.Stderr = stderrBuf
	if err := cmd.Start(); err != nil {
		return Result{}, fmt.Errorf("sandbox: start docker: %w", err)
	}
	timedOut := waitOrKill(cmd, deadline)
	exitCode := waitExitCode(cmd)
	return Result{
		Stdout:   stdoutBuf.String(),
		Stderr:   stderrBuf.String(),
		ExitCode: exitCode,
		TimedOut: timedOut,
	}, nil
}

func waitOrKill(cmd *exec.Cmd, deadline time.Time) bool {
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
		return false
	case <-time.After(time.Until(deadline)):
		killAndDrain(cmd, done)
		return true
	}
}

// killAndDrain —— deadline 到了：SIGKILL + 等 Wait 落地 (最多 killGracePeriod)。
// drainWait 失败不影响调用方，Result.ExitCode 已经从 ProcessState 拿。
func killAndDrain(cmd *exec.Cmd, done <-chan error) {
	if kerr := cmd.Process.Kill(); kerr != nil {
		_ = kerr
	}
	select {
	case <-done:
	case <-time.After(killGracePeriod):
	}
}

func waitExitCode(cmd *exec.Cmd) int {
	if cmd.ProcessState == nil {
		return -1
	}
	return cmd.ProcessState.ExitCode()
}

// DisabledRunner —— 未启用 sandbox 时返回 ErrDisabled。生产环境默认值，
// owner 显式开 SANDBOX_DRIVER=docker 才走 DockerRunner。
type DisabledRunner struct{}

// NewDisabledRunner 构造 DisabledRunner。
func NewDisabledRunner() *DisabledRunner { return &DisabledRunner{} }

// Run 永远返 ErrDisabled。
func (*DisabledRunner) Run(_ context.Context, _ *RunInput) (Result, error) {
	return Result{}, ErrDisabled
}

// FromEnv —— 按 driver 字符串选 Runner。空 / "disabled" → DisabledRunner；
// "docker" → DockerRunner。composition root 调。
//
//nolint:ireturn // FromEnv 是 driver-selection 工厂，本质要返 interface。
func FromEnv(driver string) Runner {
	if driver == "docker" {
		return NewDockerRunner()
	}
	return NewDisabledRunner()
}
