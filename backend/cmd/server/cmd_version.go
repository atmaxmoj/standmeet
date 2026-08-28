// cmd_version.go —— `standmeet version` / `--version`：这个二进制是哪一个 build。
//
// 存在的理由是**闸门要问得到**：版本号靠 `-ldflags -X` 在发布时烧进来，而"忘了传
// build-arg"的失败是无声的 —— 二进制照样能跑，只是从此对外报一个跟 build 无关的数。
// 这条子命令让发布流程在推之前直接问镜像本人（不需要起 db/redis/整套栈）。
//
// 顺带也是 owner 的工具：`docker run --rm <image> --version` 就说得清手里这张镜像是谁。

package main

import (
	"os"

	"github.com/atmaxmoj/standmeet/cmd/server/port"
)

// versionSubcommand —— argv[1] 是 version / --version / -v 时打印版本并返 0；
// 其它 argv 走 server 路径返 -1（跟 passwordResetSubcommand 同一套调度约定）。
func versionSubcommand() int {
	if len(os.Args) < 2 {
		return -1
	}
	switch os.Args[1] {
	case "version", "--version", "-v":
		// 走 writeLines 而不是 fmt.Println —— 输出目标是显式的那个 writer
		// (跟 password-reset 同一条路),lint 也禁裸 print。
		writeLines(os.Stdout, []string{port.AppVersion()})
		return 0
	default:
		return -1
	}
}
