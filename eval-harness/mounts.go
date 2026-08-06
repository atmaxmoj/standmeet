// mounts.go —— 把一件**真插件**挂到候选人身上:编译它、按它自己的 manifest 生成 PluginSpec、
// 起一根宿主 socket 供它 manifest 点过的那几件 host op。
//
// 为什么单独一个文件:漏挂一件能力**不报错** —— 那件能力的工具在 tools/list 里不出现,模型
// 只好用散文回答,而断言"它调了这个工具"从此永远不可能绿。summarize 就是这样红的:P.13 把
// eval 搬到 agentcore.Driver 上时,--ask 那条路只接了 retrieval,而 ask_visitor 和
// summarize_conversation 谁也没接 —— 三件 acl:always 的能力,产品里都装,eval 里只装了一件。
//
// 所以这里给的是一张**表**,不是三处调用:prod 装哪几件由 manifest 的 acl 字段说了算,这一侧
// 照着同一份 id 挂。要再加一件 always-on 能力,是往表里加一行,而不是想起来要在某处也接一下。

package main

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// 三件 acl:always 的能力 id + 它们的插件模块。prod 给每个访客都装这三件。
const (
	askVisitorCapabilityID = "ask_visitor"
	retrievalCapabilityID  = "corpus.retrieval"
	summarizeCapabilityID  = "summarize_conversation"
)

// buildPluginBinary —— 把一个插件模块编成本机架构的二进制(prod 在 bwrap 里跑它;
// mini-host 用普通 stdio 跑 —— 隔离是 prod 的,词汇表是共用的)。
func buildPluginBinary(dir, out string) (string, error) {
	cmd := exec.Command("go", "build", "-o", out, ".")
	cmd.Dir = dir
	if outBytes, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("build plugin %s: %w\n%s", dir, err, outBytes)
	}
	return out, nil
}

// mountCapability —— 编译 + 起 socket + 加进 driver 的插件集,一次做完。
//
// spec 的每一项(host op 清单、ACL 档、工具是否原名)都从**它自己的 manifest** 读,这一侧
// 一个字都不重述:重述过的地方,manifest 改了名 eval 照样绿,而它测的已经是产品里不存在的
// 那套接口了。
func mountCapability(
	ctx context.Context, driver *EvalDriver,
	capID, pluginDir, tmp string, host *agentcore.CapabilityHost,
) (func() error, error) {
	bin, berr := buildPluginBinary(pluginDir, filepath.Join(tmp, capID+"-plugin"))
	if berr != nil {
		return nil, berr
	}
	sock := filepath.Join(tmp, capID+".sock")
	spec, serr := agentcore.BuiltinPluginSpec(capID, bin, sock)
	if serr != nil {
		return nil, fmt.Errorf("%s plugin spec: %w", capID, serr)
	}
	stop := func() error { return nil }
	if len(spec.HostOps) > 0 {
		s, herr := agentcore.StartCapabilitySocket(ctx, host, capID, sock)
		if herr != nil {
			return nil, fmt.Errorf("start %s socket: %w", capID, herr)
		}
		stop = s
	}
	driver.plugins = append(driver.plugins, spec)
	return stop, nil
}

// mountBooker —— 真 booker + 一份会回答的日历 + 它自己的记录表。
//
// canned 的只有**边界之外**(日历、存储);插件、host op 词表、ACL 闸和装配都是真的 ——
// 一个假的预约工具证明不了 booker 的任何事。
func mountBooker(
	ctx context.Context, driver *EvalDriver, tmp, ownerID string, opts *launchOpts,
) (func() error, error) {
	host, _ := bookingWorld(ownerID, ownerTZOr(opts.ownerTimezone), nil, opts.bookingFail)
	return mountCapability(ctx, driver, bookerCapabilityID, "../mcp-servers/booker", tmp, host)
}

// mountSummarize —— 真 summarize 插件 + 它要的三件 host op:读这一场的逐字稿、用 owner 的
// 模型跑一次生成、把 HTML 交回宿主。
//
// 洗白名单和套版是**宿主**做的(安全边界),所以报告是真的洗过的那一份;这一侧只提供逐字稿
// 从哪儿来、凭据是哪把、洗完存哪儿。
func mountSummarize(
	ctx context.Context, driver *EvalDriver, tmp string, opts *launchOpts,
) (func() error, error) {
	host := &agentcore.CapabilityHost{
		Timezone:   ownerTZOr(opts.ownerTimezone),
		Transcript: opts.transcript,
		Cred:       &driver.cred,
		Report:     opts.report,
	}
	return mountCapability(ctx, driver, summarizeCapabilityID, "../mcp-servers/summarize", tmp, host)
}

// mountAskVisitor —— 真 ask_visitor 插件。它一件 host op 都不点(问题就是它的输出),
// 所以没有 socket。
func mountAskVisitor(
	ctx context.Context, driver *EvalDriver, tmp string,
) (func() error, error) {
	return mountCapability(ctx, driver, askVisitorCapabilityID, "../mcp-servers/ask-visitor", tmp, nil)
}
