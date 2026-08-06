#!/usr/bin/env python3
# owner_mcp.py —— drives the OWNER-side MCP server the way an owner's AI client
# (Claude Desktop / Code) does: over the real @standmeet/mcp-client stdio bridge,
# Sigv1-signed, against a running backend. Tests the inbound/ingest half of the
# product (the visitor eval covers outbound), exercising the canonical owner
# curate loop end to end:
#
#   me  →  corpus.create(raw)  →  corpus.list(raw)  →  corpus.promote(raw→wiki)
#      →  corpus.list(wiki)  →  corpus.delete (both, so the run leaves nothing behind)
#
# Mechanical round-trips ARE asserted (tool listed, body lands in raw, promote
# returns a new id, the entry shows up in wiki). Whether an AI *chooses* the right
# tool / writes good structure is a separate human-eval — this proves the tools work
# and are agent-drivable.
#
# The tool names above are the ones the server ships. This file used to drive
# raw_dump / list_recent_raw / promote_to_wiki / list_recent_wiki, which the
# genre-as-a-parameter consolidation removed; the run then "called" four tools that
# did not exist, got `{}` back for each, and two of the four checks PASSED anyway
# because they only asked whether the word "error" appeared in the reply. Every
# check below reads a value out of the response instead.
#
# Setup (one-time, per run): claim/own instance + a keypair, then:
#   STANDMEET_HOST=http://localhost:8000 \
#   STANDMEET_CREDS_PATH=/path/to/creds.json \   # {keyId, privateKeyPem}
#   python3 owner_mcp.py
#
# The Makefile target (eval-owner-mcp) mints a throwaway keypair via the admin
# API and wires these env vars for you.

import json
import os
import select
import subprocess
import sys
import time

HOST = os.environ.get("STANDMEET_HOST", "http://localhost:8000")
CREDS = os.environ.get("STANDMEET_CREDS_PATH", "")
BRIDGE = os.environ.get("STANDMEET_MCP_BIN", "../sdk/packages/mcp-client/bin/standmeet-mcp")
STAMP = os.environ.get("EVAL_STAMP", "owner-mcp-eval")


class Bridge:
    def __init__(self):
        env = dict(os.environ, STANDMEET_HOST=HOST, STANDMEET_CREDS_PATH=CREDS)
        self.p = subprocess.Popen(["node", BRIDGE], env=env, text=True, bufsize=1,
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE)
        self._id = 0

    def _send(self, obj):
        self.p.stdin.write(json.dumps(obj) + "\n")
        self.p.stdin.flush()

    def _recv(self, want_id, timeout=30):
        deadline = time.time() + timeout
        while time.time() < deadline:
            r, _, _ = select.select([self.p.stdout], [], [], deadline - time.time())
            if not r:
                break
            line = self.p.stdout.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("id") == want_id:
                return msg
        raise TimeoutError(f"no response for id={want_id} (stderr: {self._stderr()})")

    def _stderr(self):
        try:
            return self.p.stderr.read(500)
        except Exception:
            return ""

    def initialize(self):
        self._id += 1
        self._send({"jsonrpc": "2.0", "id": self._id, "method": "initialize",
                    "params": {"protocolVersion": "2024-11-05", "capabilities": {},
                               "clientInfo": {"name": "claude-agent", "version": "1"}}})
        out = self._recv(self._id)
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return out

    def list_tools(self):
        self._id += 1
        self._send({"jsonrpc": "2.0", "id": self._id, "method": "tools/list"})
        return self._recv(self._id)

    def call(self, name, args):
        self._id += 1
        self._send({"jsonrpc": "2.0", "id": self._id, "method": "tools/call",
                    "params": {"name": name, "arguments": args}})
        return self._recv(self._id)

    def close(self):
        try:
            self.p.terminate()
        except Exception:
            pass


def text_of(resp):
    """Flatten an MCP tools/call result into a string for inspection."""
    r = resp.get("result", {})
    if isinstance(r, dict) and "content" in r:
        return " ".join(c.get("text", "") for c in r["content"] if isinstance(c, dict))
    return json.dumps(r)


def json_of(resp):
    """The tool's result as a dict. {} when the call errored or returned nothing parseable."""
    blob = text_of(resp).strip()
    try:
        out = json.loads(blob)
    except json.JSONDecodeError:
        return {}
    return out if isinstance(out, dict) else {"items": out}


def entry_id(payload):
    """The entry id out of a corpus.create / corpus.promote reply, whatever it wraps it in."""
    for key in ("id", "entry_id", "raw_id", "wiki_id"):
        if isinstance(payload.get(key), str) and payload[key]:
            return payload[key]
    for nest in ("entry", "item", "created", "promoted"):
        inner = payload.get(nest)
        if isinstance(inner, dict):
            got = entry_id(inner)
            if got:
                return got
    return ""


def items_of(payload):
    """The rows out of a corpus.list reply."""
    for key in ("items", "entries", "results", "rows"):
        got = payload.get(key)
        if isinstance(got, list):
            return got
    return []


def main():
    if not CREDS:
        print("STANDMEET_CREDS_PATH required ({keyId, privateKeyPem}). Use `make eval-owner-mcp`.")
        sys.exit(2)
    b = Bridge()
    passed = failed = 0

    def check(label, ok, detail=""):
        nonlocal passed, failed
        passed += ok
        failed += (not ok)
        print(f"   [{'PASS' if ok else 'FAIL'}] {label}{('  — ' + detail) if detail and not ok else ''}")

    try:
        b.initialize()
        tools = b.list_tools().get("result", {}).get("tools", [])
        names = sorted(t["name"] for t in tools)
        print(f"\ntools/list → {len(names)} owner tools")
        print("  ", ", ".join(names))
        check("owner MCP exposes tools", len(names) > 0)
        for must in ("me", "corpus.create", "corpus.list", "corpus.promote", "corpus.delete"):
            check(f"tool present: {must}", must in names)

        print("\ncall: me")
        me = json_of(b.call("me", {}))
        print("   →", json.dumps(me)[:200])
        check("me returns this owner's handle", bool(me.get("owner", {}).get("handle")),
              json.dumps(me)[:160])

        body = f"[{STAMP}] Idempotency is a distributed-systems decision, not a convenience. " \
               "A retry is only safe if the operation is keyed and deduplicated."
        print("\ncall: corpus.create (genre=raw)")
        created = json_of(b.call("corpus.create", {
            "genre": "raw", "body": body, "source": "mcp:claude-agent",
            "tags": ["eval", "idempotency"]}))
        raw_id = entry_id(created)
        print("   →", json.dumps(created)[:240])
        check("corpus.create returns the new raw id", bool(raw_id), json.dumps(created)[:160])

        print("\ncall: corpus.list (genre=raw)")
        raw_list = json_of(b.call("corpus.list", {"genre": "raw", "limit": 10}))
        raw_rows = items_of(raw_list)
        print(f"   → {len(raw_rows)} rows")
        check("the dumped raw is in corpus.list",
              any(r.get("id") == raw_id for r in raw_rows) if raw_id else False,
              json.dumps(raw_list)[:200])

        print(f"\ncall: corpus.promote (raw {raw_id or '?'} → wiki)")
        promoted = json_of(b.call("corpus.promote", {
            "genre": "raw", "id": raw_id, "title": f"{STAMP} — Idempotency"}))
        wiki_id = entry_id(promoted)
        print("   →", json.dumps(promoted)[:240])
        check("corpus.promote returns the new wiki id", bool(wiki_id) and wiki_id != raw_id,
              json.dumps(promoted)[:160])

        print("\ncall: corpus.list (genre=wiki)")
        wiki_list = json_of(b.call("corpus.list", {"genre": "wiki", "limit": 50}))
        wiki_rows = items_of(wiki_list)
        print(f"   → {len(wiki_rows)} rows")
        check("the promoted entry is in corpus.list(wiki)",
              any(r.get("id") == wiki_id for r in wiki_rows) if wiki_id else False,
              json.dumps(wiki_list)[:200])

        # 收尾:这一场写进去的两条自己删掉。留下来的话下一次跑的 list 里就有上一次的残留,
        # 而"语料要跟 vault 一致"这条在别处是硬要求。
        print("\ncall: corpus.delete (cleaning up this run's two entries)")
        for genre, eid in (("wiki", wiki_id), ("raw", raw_id)):
            if not eid:
                continue
            gone = json_of(b.call("corpus.delete", {"genre": genre, "id": eid}))
            print(f"   → delete {genre} {eid}: {json.dumps(gone)[:120]}")
        left = items_of(json_of(b.call("corpus.list", {"genre": "raw", "limit": 50})))
        check("the eval left no raw entry behind",
              not any(r.get("id") == raw_id for r in left))
    finally:
        b.close()

    print(f"\n{'=' * 70}\nOWNER-MCP: {passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
