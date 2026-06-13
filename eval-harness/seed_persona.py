#!/usr/bin/env python3
# seed_persona.py —— load a persona fixture into a LIVE StandMeet instance via the
# owner MCP bridge, the way an owner's AI client would: raw_dump every corpus
# entry, promote the public ones to wiki, create a persona Prompt + a Role that
# grants the corpus, and issue an access code. Prints the visitor share link.
#
# Turns the eval's marcus-chen fixture into a real, chattable instance for manual
# testing / demo — no clicking 19 corpus forms by hand.
#
#   STANDMEET_HOST=http://localhost:8000 STANDMEET_CREDS_PATH=creds.json \
#   EVAL_PERSONA=fixtures/personas/marcus-chen PUBLIC_URL=http://localhost:38127 \
#   python3 seed_persona.py
#
# (owner-mcp-setup.sh-style wrappers mint the keypair; here creds are passed in.)

import json
import os
import pathlib

from owner_mcp import Bridge, text_of

PERSONA = pathlib.Path(os.environ.get("EVAL_PERSONA", "fixtures/personas/marcus-chen"))
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost:38127").rstrip("/")
CODE = os.environ.get("SEED_CODE", "RECRUIT-MARCUS")


def split_frontmatter(text):
    t = text.lstrip("﻿ \t\n")
    if not t.startswith("---\n"):
        return {}, text
    rest = t[4:]
    end = rest.find("\n---")
    if end < 0:
        return {}, text
    front, body = rest[:end], rest[end + 4:].lstrip("\n")
    meta = {}
    for line in front.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, body.strip()


def scheme_path(uri):  # "wiki://profile/overview" -> ("wiki", "profile/overview")
    i = uri.find("://")
    return (uri[:i], uri[i + 3:]) if i >= 0 else ("wiki", uri)


# PARENT_OF —— child uri -> parent uri,把扁平 corpus 组成真树(projects 归公司、
# profile 子页归 "Who I am")。reader 侧栏靠 parent_id 才长出 caret/缩进。
PARENT_OF = {
    # profile/overview ("Who I am") 下挂自我介绍类
    "wiki://profile/working-style": "wiki://profile/overview",
    "wiki://profile/skills": "wiki://profile/overview",
    "wiki://profile/education": "wiki://profile/overview",
    "wiki://profile/looking-next": "wiki://profile/overview",
    # 公司下挂项目/事故(3 层:work > company > project)
    "wiki://project/notification-pipeline": "wiki://work/orbit",
    "wiki://work/orbit/event-bus": "wiki://work/orbit",
    "wiki://work/orbit/oncall": "wiki://work/orbit",
    "wiki://work/orbit/feature-flags": "wiki://work/orbit",
    "wiki://project/order-reconciliation": "wiki://work/flowpay",
    "wiki://lessons/double-charge-incident": "wiki://work/flowpay",
    "wiki://work/flowpay/idempotency": "wiki://work/flowpay",
    "wiki://work/flowpay/webhooks": "wiki://work/flowpay",
    "wiki://project/slow-query-optimization": "wiki://work/acme-retail",
    "wiki://work/acme-retail/inventory-sync": "wiki://work/acme-retail",
    "wiki://work/acme-retail/cache-invalidation": "wiki://work/acme-retail",
    # skills 自己成一棵(4 层:profile/overview > skills > go/postgres/...)
    "wiki://profile/skills/go": "wiki://profile/skills",
    "wiki://profile/skills/postgres": "wiki://profile/skills",
    "wiki://profile/skills/debugging": "wiki://profile/skills",
    "wiki://profile/skills/kubernetes": "wiki://profile/skills",
    # thinking 是新根,下挂 essays
    "wiki://thinking/correctness": "wiki://thinking",
    "wiki://thinking/boring-tech": "wiki://thinking",
    "wiki://thinking/being-mid": "wiki://thinking",
}


def _depth(uri):
    d = 0
    while uri in PARENT_OF:
        uri = PARENT_OF[uri]
        d += 1
    return d


def seed_corpus(b):
    priv = 0
    public = []  # (uri, title, body, tags)
    for md in sorted(PERSONA.glob("corpus/**/*.md")):
        meta, body = split_frontmatter(md.read_text(encoding="utf-8"))
        uri = meta.get("uri", "")
        private = meta.get("visibility") == "private"
        title = meta.get("title", md.stem)
        tags = [t.strip(" []") for t in meta.get("tags", "").split(",") if t.strip(" []")]
        if private:
            b.call("raw_dump", {"body": body, "source": "mcp:seed",
                                "tags": tags, "private": True})
            priv += 1
            continue
        public.append((uri, title, body, tags))

    # 父在子前(按 depth 排),promote 时直接带 parent_id —— 长出真树。
    id_by_uri = {}
    nested = 0
    for uri, title, body, tags in sorted(public, key=lambda e: _depth(e[0])):
        dump = text_of(b.call("raw_dump", {"body": body, "source": "mcp:seed",
                                           "tags": tags, "private": False}))
        rid = (json.loads(dump).get("raw_id") if dump.strip().startswith("{") else "")
        parent_id = id_by_uri.get(PARENT_OF.get(uri, ""), "")
        nested += 1 if parent_id else 0
        promo = text_of(b.call("promote_to_wiki", {
            "raw_id": rid, "title": title, "body": body, "parent_id": parent_id}))
        wid = (json.loads(promo).get("wiki_id") if promo.strip().startswith("{") else "")
        id_by_uri[uri] = wid
    print(f"corpus: {len(public)} public → wiki ({nested} nested), {priv} private (raw only)")


def main():
    b = Bridge()
    b.initialize()
    seed_corpus(b)

    persona_body = (PERSONA / "role-body.md").read_text(encoding="utf-8").strip()
    pr = text_of(b.call("prompt_create", {"name": "Marcus persona",
                                          "body": persona_body,
                                          "description": "Marcus answering recruiters in his own voice"}))
    prompt_id = json.loads(pr).get("prompt_id", "") if pr.strip().startswith("{") else ""
    print("prompt:", pr[:120])

    ro = text_of(b.call("role_create", {"name": "Recruiter",
                                        "description": "Recruiter visiting Marcus's page",
                                        "greeting": "This is Marcus's AI — ask it anything about his "
                                                    "engineering work, and it answers in his voice, "
                                                    "grounded in his real projects and incident write-ups.",
                                        "prompt_id": prompt_id,
                                        "corpus_uris": ["wiki://**", "output://**"]}))
    role_id = json.loads(ro).get("role_id", "") if ro.strip().startswith("{") else ""
    print("role:", ro[:120])

    co = text_of(b.call("codes.create", {
        "code": CODE, "label": "Recruiter access", "assumed_role_id": role_id,
        "max_turns_per_session": 50, "max_members": 10,
        "ghosts": [
            "Walk me through your hardest production incident.",
            "How comfortable are you with Kubernetes?",
            "Why are you looking to leave Orbit?",
        ]}))
    print("code:", co[:160])
    b.close()

    print("\n" + "=" * 70)
    print(f"VISITOR LINK:  {PUBLIC_URL}?c={CODE}")
    print("=" * 70)


if __name__ == "__main__":
    main()
