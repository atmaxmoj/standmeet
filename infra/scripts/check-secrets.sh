#!/usr/bin/env sh
# check-secrets —— **没有密钥离开这台机器。**
#
# 为什么它长这样:仓库里本来就有一个 gitleaks 步骤(`backend/Makefile` 的 `secrets`),而它
# 挡不住这件事的两个出口 ——
#
#   1. **gitleaks 不在就静默通过**:`command -v gitleaks || exit 0`,打一行 "skipping" 然后
#      报成功。在没装它的机器上,这一步替它没做过的事签了字。
#   2. **只扫暂存区**(`gitleaks protect --staged`)。而 `git push` 送出去的是**整部历史**:
#      一个在后面某次提交里删掉的密钥,推上去照样在。暂存区从来看不见它。
#
# 所以这条扫的是**历史**,并且 gitleaks 缺席时**红**,不是跳过。
#
# 镜像那个出口不在这里:镜像里有什么由 `.dockerignore` 决定,跟 `.gitignore` 不是同一张单子。
# 那条由 `make secrets-image` 扫**镜像本身**(不是扫它的构建上下文 —— 上下文是替身)。
#
# 自证:在**放行条目最密集的那个目录里**种一个真密钥,判定必须看得见。
# allowlist 是这条闸门唯一会瞎掉的地方,而且它瞎掉的时候跟它通过长得一模一样 ——
# 这条自证第一次跑就抓到了:配置里写了 `paths = ['docs/design/project/']`,本意是
# 「这个目录里那四个假 token」,gitleaks 的实际行为是**整个目录不扫**(`scanned ~0 bytes`)。
# 种下去的 AWS key 就那么躺在那儿没人看见。所以配置里现在一条 `paths` 都没有。

set -eu

CONFIG=".gitleaks.toml"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "check-secrets: gitleaks is not installed — this gate cannot run."
  echo "               install it (brew install gitleaks) rather than skipping:"
  echo "               a skipped secret scan reports success for work it did not do."
  exit 2
fi

test -f "$CONFIG" || { echo "check-secrets: $CONFIG missing"; exit 2; }

# ── 自证 ────────────────────────────────────────────────────────────────────────────────
# 种在 docs/design/project/ —— 放行条目最多的那个目录(设计原型的四个假 token)。
# 种的值跟那四条毫无关系:放行的是那四个确切字面量,不是这个目录、也不是「看着像 token 的东西」。
#
# 诱饵不用 AWS 文档里那把 `…EXAMPLEKEY`:gitleaks 默认配置**本来就放行**所有公开示例密钥,
# 于是它证不了任何事 —— 一个永远红不了的自证跟没有自证是一回事。
#
# 诱饵也**不能是这个文件里的一个常量**:那样它自己就是一个提交进仓库的、长得像密钥的字符串,
# 而唯一能让它过闸的办法是给它开一条 allowlist —— 一个形状恰好是密钥的永久缺口。
# 这条闸门第一次跑就红在这里(红的正是它自己的诱饵),所以现在每次现生成一个,
# 文件里一个密钥形状的常量都没有。
PLANT="docs/design/project/.gitleaks-selftest-canary.txt"
cleanup() { rm -f "$PLANT"; }
trap cleanup EXIT INT TERM
# **诱饵要命中一条不看熵的规则**。
#
# 前两版都用 `aws_secret_access_key = "<随机串>"`,打的是 gitleaks 的 `generic-api-key` ——
# 那条**带熵阈值**,于是随机串里总有一部分落在阈下:实测 40 次漏 1 次(那次还偏短,
# 因为 `tr -d '/+='` 会删字符),改成定长 40 位之后仍然 60 次漏 3 次。
# 后果是这道闸门**随机地**报「allowlist 瞎了」并挡下一次正常提交 —— 而一个闪断的自证
# 比没有自证更糟:它训练人去重试,而重试正是它想拦住的那个动作。
#
# private-key 那条规则只看**块结构**,不看熵。实测 60 次 0 漏。
# 标记头拆成 `-----%s RSA PRIVATE KEY-----` 拼:这样本文件里没有一处能被自己扫中的字面量,
# 也就不需要为它开一条形状恰好是密钥的 allowlist。
canary_body=$(LC_ALL=C tr -dc 'A-Za-z0-9+/' < /dev/urandom | head -c 64)
printf -- '-----%s RSA PRIVATE KEY-----\n%s\n-----%s RSA PRIVATE KEY-----\n' \
  BEGIN "$canary_body" END > "$PLANT"
if gitleaks dir docs/design/project --config "$CONFIG" --no-banner --redact >/dev/null 2>&1; then
  echo "check-secrets: SELF-TEST FAILED — a planted AWS key inside an allowlisted"
  echo "               directory was not detected. The allowlist has gone blind."
  exit 2
fi
cleanup
trap - EXIT INT TERM

# ── 真扫:暂存区 ─────────────────────────────────────────────────────────────────────────
# 还没提交的那一笔。历史扫描看不见它 —— 它还不是历史。
if ! gitleaks git --staged . --config "$CONFIG" --no-banner --redact; then
  echo "check-secrets: secrets in the staged diff — do NOT commit."
  exit 1
fi

# ── 真扫:历史 ───────────────────────────────────────────────────────────────────────────
# `git push` 送出去的是整部历史。在后面某次提交里删掉的密钥,推上去照样在。
if ! gitleaks git . --config "$CONFIG" --no-banner --redact; then
  echo "check-secrets: secrets found in history. Do NOT push."
  echo "               A secret removed in a later commit is still in the history you push;"
  echo "               rotate it first, then rewrite history — deleting the file is not enough."
  exit 1
fi

commits=$(git rev-list --count HEAD)
echo "check-secrets: staged diff + ${commits} commits of history scanned, clean"
echo "               (self-test passed: a planted key in the allowlisted directory goes red)."
