#!/usr/bin/env python3
# compaction_gen.py —— 生成一个 >32K token 的长面试对话 askRequest，写到 argv[1]。
#
# 用于 compaction 用例：开头埋几个独特事实（面试官 Priya Nair / Nimbus Data /
# Staff Backend / billing），中间用 persona 的真实 corpus body 填到超过 agent
# loop 的 summarization 阈值（32K token），结尾问一个召回 + pitch 的问题。
# 跑完断言：(a) compaction 真触发，(b) 压缩后早期上下文仍被准确召回。
#
# 只读 public corpus（带 visibility: private 的跳过，跟检索层 ACL 一致）。

import json
import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(HERE, "fixtures/personas/marcus-chen/corpus")

# 字符数阈值：~155K chars ≈ ~39K tokens，稳过 agent loop 的 32K token 触发线。
TARGET_CHARS = 155000

# 工具腿（--leg tools）的历史长度：**故意留在阈值以下**。
#
# 第一次模型调用还没有 usage 可参考，eino 按 chars/4 估（estimateTokenCount）：88K ≈ 22K
# token，加 system 和 tool 声明仍在 32K 以下 → 那一次**不**压缩，工具因此先跑得成。工具返回
# 44K 字符的报告之后才越线 → 压缩发生在**工具结果已经进窗口之后**，正是 prod 那次的形状。
#
# 这个数是量出来的，不是算出来的：第一版填 110K（估 27.5K，看着离 32K 还有富余），
# 结果第一次调用就压了（`before_msgs=200`，日志里工具一行都没有）—— 也就是说 system
# 提示词加工具声明本身要 4K+ token。shell 那条顺序断言当场把它抓住了；没有它，这条腿会
# 在「工具结果还新鲜」的另一条路上绿得一模一样。
TOOLS_LEG_CHARS = 88000


def public_bodies():
    out = []
    for f in sorted(glob.glob(CORPUS + "/*/*.md")):
        s = open(f, encoding="utf-8").read()
        front = s.split("\n---", 1)[0] if s.startswith("---") else ""
        if "visibility: private" in front:
            continue  # ACL: 跟 corpus_search/read 一致，私货不入对话
        body = s.split("---", 2)[-1].strip()
        if len(body) > 200:
            out.append(body)
    return out


def build_request(leg="conv"):
    bodies = public_bodies()
    target = TOOLS_LEG_CHARS if leg == "tools" else TARGET_CHARS
    # 开头两条埋独特事实 —— 压缩后考召回的锚点。
    hist = [
        {"role": "interviewer", "text": (
            "Hi Marcus, I'm Priya Nair, VP of Engineering at Nimbus Data. "
            "We're interviewing you for a Staff Backend Engineer role on our "
            "billing and payments platform. I'll dig into your reconciliation "
            "work today.")},
        {"role": "candidate", "text": (
            "Thanks Priya, great to meet you. A Staff Backend role on billing "
            "and payments at Nimbus is a strong fit — the FlowPay reconciliation "
            "pipeline is the most relevant thing I've done, happy to go deep.")},
    ]
    qs = ["Can you elaborate?", "Walk me through the details.", "What was hardest?",
          "What would you change?", "How did you measure success?",
          "Tell me the trade-offs.", "What did you learn?", "How does it scale?"]
    i = 0
    while sum(len(t["text"]) for t in hist) < target:
        hist.append({"role": "interviewer", "text": qs[i % len(qs)]})
        hist.append({"role": "candidate", "text": bodies[i % len(bodies)]})
        i += 1
    if leg == "tools":
        # 工具腿：问一个**只有工具答得出**的问题（那两个数字语料里没有），
        # 而且要求原样给数字 —— 含糊的转述在这条判据下不算召回。
        return {
            "history": hist,
            "bulk_skill": True,
            "question": (
                "One last thing: pull up the due-diligence dossier and give me, in the "
                "exact figures it uses, the platform's peak throughput and how long the "
                "3 November interruption lasted."),
        }
    return {
        "history": hist,
        "question": (
            "Before we wrap up — just so I know you've been tracking: remind me "
            "who I am, what company, and exactly what role and team this interview "
            "has been for? Then give me a one-line pitch for why you fit it."),
    }


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/compaction_req.json"
    leg = sys.argv[2] if len(sys.argv) > 2 else "conv"
    req = build_request(leg)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(req, fh)
    chars = sum(len(t["text"]) for t in req["history"])
    print(f"leg={leg} turns={len(req['history'])} chars={chars} "
          f"(~{chars // 4000}K tokens, threshold 32K) → {out_path}")


if __name__ == "__main__":
    main()
