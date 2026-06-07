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


def build_request():
    bodies = public_bodies()
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
    while sum(len(t["text"]) for t in hist) < TARGET_CHARS:
        hist.append({"role": "interviewer", "text": qs[i % len(qs)]})
        hist.append({"role": "candidate", "text": bodies[i % len(bodies)]})
        i += 1
    return {
        "history": hist,
        "question": (
            "Before we wrap up — just so I know you've been tracking: remind me "
            "who I am, what company, and exactly what role and team this interview "
            "has been for? Then give me a one-line pitch for why you fit it."),
    }


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/compaction_req.json"
    req = build_request()
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(req, fh)
    chars = sum(len(t["text"]) for t in req["history"])
    print(f"turns={len(req['history'])} chars={chars} (~{chars // 4000}K tokens, "
          f"threshold 32K) → {out_path}")


if __name__ == "__main__":
    main()
