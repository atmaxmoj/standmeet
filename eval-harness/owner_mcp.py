#!/usr/bin/env python3
# owner_mcp.py —— drives the OWNER-side MCP server the way an owner's AI client
# (Claude Desktop / Code) does: over the real @standmeet/mcp-client stdio bridge,
# Sigv1-signed, against a running backend. Tests the inbound/ingest half of the
# product (the visitor eval covers outbound), exercising the canonical owner
# curate loop end to end:
#
#   me  →  raw_dump  →  list_recent_raw  →  promote_to_wiki  →  list_recent_wiki
#
# Mechanical round-trips ARE asserted (tool listed, body lands in raw, promote
# returns ok, the entry shows up in wiki). Whether an AI *chooses* the right tool
# / writes good structure is a separate human-eval — this proves the tools work
# and are agent-drivable.
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
        for must in ("me", "raw_dump", "list_recent_raw", "promote_to_wiki", "list_recent_wiki"):
            check(f"tool present: {must}", must in names)

        print("\ncall: me")
        me = text_of(b.call("me", {}))
        print("   →", me[:200])
        check("me returns owner profile", "alice" in me.lower() or "owner" in me.lower())

        body = f"[{STAMP}] Idempotency is a distributed-systems decision, not a convenience. " \
               "A retry is only safe if the operation is keyed and deduplicated."
        print("\ncall: raw_dump")
        dump = text_of(b.call("raw_dump", {"body": body, "source": "mcp:claude-agent",
                                           "tags": ["eval", "idempotency"]}))
        print("   →", dump[:200])
        check("raw_dump ok", "error" not in dump.lower() or "id" in dump.lower())

        print("\ncall: list_recent_raw")
        recent = text_of(b.call("list_recent_raw", {"limit": 5}))
        print("   →", recent[:240])
        check("dumped raw shows in list_recent_raw", STAMP in recent)

        # raw id for promotion — pull it from the dump or the recent list.
        raw_id = ""
        for blob in (dump, recent):
            try:
                for key in ("id", "raw_id"):
                    j = json.loads(blob) if blob.strip().startswith("{") else {}
                    if key in j:
                        raw_id = j[key]
            except Exception:
                pass
        print("\ncall: promote_to_wiki", f"(raw_id={raw_id or '?'})")
        promo = text_of(b.call("promote_to_wiki", {
            "raw_id": raw_id, "title": f"{STAMP} — Idempotency",
            "body": f"# Idempotency\n\n{body}"}))
        print("   →", promo[:240])
        check("promote_to_wiki accepted", "error" not in promo.lower() or "id" in promo.lower())

        print("\ncall: list_recent_wiki")
        wiki = text_of(b.call("list_recent_wiki", {"limit": 5}))
        print("   →", wiki[:240])
        check("promoted entry shows in list_recent_wiki", STAMP in wiki)
    finally:
        b.close()

    print(f"\n{'=' * 70}\nOWNER-MCP: {passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
