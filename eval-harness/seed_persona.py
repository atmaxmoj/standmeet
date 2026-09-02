#!/usr/bin/env python3
# seed_persona.py —— load a persona fixture into a LIVE StandMeet instance via the
# owner MCP bridge, the way an owner's AI client would: corpus.create every entry
# as raw, promote the public ones to wiki, create a persona Prompt + a Role that
# grants the corpus, and issue an access code. Prints the visitor share link.
#
# Every id below is read back from the reply and REQUIRED. This file used to call
# raw_dump / promote_to_wiki (removed by the genre-as-a-parameter consolidation)
# and to pull ids out with `.get("prompt_id", "")`. Both failures were silent: the
# corpus calls wrote nothing while the script printed "corpus: 50 public → wiki"
# from its loop counter, and a missing id just attached nothing to the role. The
# dev instance came up looking seeded and empty. Counts now come from receipts.
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
import sys

from owner_mcp import Bridge, json_of, text_of

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


# PARENT_OF —— child uri -> parent uri, single source = persona's own tree.json (this script
# and the e2e persona seeder share the same file). Turns the flat corpus into a real tree
# (projects belong to the company, profile subpages belong to "Who I am"); the reader sidebar
# only grows carets/indentation from parent_id. Change the tree by editing only tree.json.
PARENT_OF = {
    k: v
    for k, v in json.loads((PERSONA / "tree.json").read_text(encoding="utf-8")).items()
    if not k.startswith("_")  # skip meta fields like _comment
}


def _depth(uri):
    d = 0
    while uri in PARENT_OF:
        uri = PARENT_OF[uri]
        d += 1
    return d


def need_id(reply, what, *keys):
    """The id out of a write reply — or die. A seed that half-worked is worse than one that
    stopped: the instance comes up looking ready with the persona silently unattached."""
    payload = json_of(reply)
    for key in (*keys, "id"):
        got = payload.get(key)
        if isinstance(got, str) and got:
            return got
    print(f"seed: {what} returned no id — {json.dumps(payload)[:200]} "
          f"| raw: {json.dumps(reply)[:400]}", file=sys.stderr)
    sys.exit(1)


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
            need_id(b.call("corpus.create", {"genre": "raw", "body": body, "source": "mcp:seed",
                                             "tags": tags, "flagged_private": True}),
                    f"private raw {md.name}", "raw_id")
            priv += 1
            continue
        public.append((uri, title, body, tags))

    # Parents before children (sorted by depth), so promote can carry parent_id directly — grows a real tree.
    id_by_uri = {}
    nested = 0
    for uri, title, body, tags in sorted(public, key=lambda e: _depth(e[0])):
        rid = need_id(b.call("corpus.create", {"genre": "raw", "body": body,
                                               "source": "mcp:seed", "tags": tags}),
                      f"raw for {uri}", "raw_id")
        parent_id = id_by_uri.get(PARENT_OF.get(uri, ""), "")
        nested += 1 if parent_id else 0
        wid = need_id(b.call("corpus.promote", {"genre": "raw", "id": rid, "title": title,
                                                "parent_id": parent_id, "tags": tags}),
                      f"wiki for {uri}", "wiki_id")
        id_by_uri[uri] = wid
    # The count comes from the **receipts** (the ones that got an id back), not how many times the loop ran.
    print(f"corpus: {len(id_by_uri)} public → wiki ({nested} nested), {priv} private (raw only)")


def main():
    b = Bridge()
    b.initialize()
    seed_corpus(b)

    persona_body = (PERSONA / "role-body.md").read_text(encoding="utf-8").strip()
    pr = b.call("prompt_create", {"name": "Marcus persona",
                                  "body": persona_body,
                                  "description": "Marcus answering recruiters in his own voice"})
    prompt_id = need_id(pr, "prompt_create", "prompt_id")
    print("prompt:", text_of(pr)[:120])

    # Booking skill —— allowed_tools unlocks the built-in calendar.book capability
    # on any role it's attached to, so the recruiter can schedule a call with Marcus
    # (requires the owner's calendar connector to be connected).
    sk = b.call("skill_create", {
        "name": "Schedule a meeting",
        "prompt": "When the recruiter wants to talk live, or asks about Marcus's "
                  "availability, offer to schedule a short call and book it on his calendar.",
        "description": "Lets the visitor book a meeting on the owner's calendar.",
        "allowed_tools": ["calendar.book"]})
    skill_id = need_id(sk, "skill_create", "skill_id")
    print("skill:", text_of(sk)[:120])

    ro = b.call("role_create", {
        "name": "Recruiter",
        "description": "Recruiter visiting Marcus's page",
        "greeting": "This is Marcus's AI — ask it anything about his engineering work, and it "
                    "answers in his voice, grounded in his real projects and incident write-ups.",
        "prompt_id": prompt_id,
        "skill_ids": [skill_id],
        "corpus_uris": ["wiki://**", "output://**"]})
    role_id = need_id(ro, "role_create", "role_id")
    print("role:", text_of(ro)[:120])

    co = b.call("codes.create", {
        "code": CODE, "label": "Recruiter access", "assumed_role_id": role_id,
        "max_turns_per_session": 50, "max_members": 10,
        "ghosts": [
            "Walk me through your hardest production incident.",
            "How comfortable are you with Kubernetes?",
            "Why are you looking to leave Orbit?",
        ]})
    need_id(co, "codes.create", "code_id")
    print("code:", text_of(co)[:160])

    # Final reconciliation: only what the panel can actually count counts as seeded.
    wiki_n = len(json_of(b.call("corpus.list", {"genre": "wiki", "limit": 200})).get("items", []))
    raw_n = len(json_of(b.call("corpus.list", {"genre": "raw", "limit": 200})).get("items", []))
    b.close()
    print(f"verified on the instance: {wiki_n} wiki + {raw_n} raw")
    if wiki_n == 0:
        print("seed: the instance reports an empty corpus — nothing was seeded", file=sys.stderr)
        sys.exit(1)

    print("\n" + "=" * 70)
    print(f"VISITOR LINK:  {PUBLIC_URL}?c={CODE}")
    print("=" * 70)


if __name__ == "__main__":
    main()
