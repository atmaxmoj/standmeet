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


def seed_corpus(b):
    pub = priv = 0
    for md in sorted(PERSONA.glob("corpus/**/*.md")):
        meta, body = split_frontmatter(md.read_text(encoding="utf-8"))
        uri = meta.get("uri", "")
        private = meta.get("visibility") == "private"
        title = meta.get("title", md.stem)
        tags = [t.strip(" []") for t in meta.get("tags", "").split(",") if t.strip(" []")]
        dump = text_of(b.call("raw_dump", {"body": body, "source": "mcp:seed",
                                           "tags": tags, "private": private}))
        if private:
            priv += 1
            continue
        rid = (json.loads(dump).get("raw_id") if dump.strip().startswith("{") else "")
        b.call("promote_to_wiki", {"raw_id": rid, "title": title, "body": body})
        pub += 1
    print(f"corpus: {pub} public → wiki, {priv} private (raw only)")


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
