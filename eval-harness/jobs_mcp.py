#!/usr/bin/env python3
# jobs_mcp.py —— real-env verification for the JOBS cluster (job-fetch / resume-draft /
# application-commit) driven as the owner's AI client does: over the real @standmeet/mcp-client
# Sigv1 stdio bridge against a running backend. Reuses owner_mcp.Bridge.
#
#   jobs.list_sources → (register greenhouse:gitlab if none) → jobs.fetch_new → jobs.show
#   → resume.draft(cache_id, resume) → applications.commit(draft_id)
#
# Env: STANDMEET_HOST, STANDMEET_CREDS_PATH ({keyId, privateKeyPem}). Additive on the instance
# (writes a job source + a draft + a committed application + an access code) — no deletes.

import json
import os
import sys

from owner_mcp import Bridge


def text_of(res):
    """Pull the text payload out of a tools/call result."""
    try:
        content = res["result"]["content"]
        return "\n".join(c.get("text", "") for c in content if c.get("type") == "text")
    except (KeyError, TypeError):
        return json.dumps(res)


def call(b, name, args):
    res = b.call(name, args)
    body = text_of(res)
    is_err = res.get("result", {}).get("isError", False)
    print(f"\n=== {name} ({'ERR' if is_err else 'ok'}) ===")
    print(body[:1400])
    return body, is_err


RESUME = {
    "identity": {
        "name": "Sijie Wang", "email": "sijie.wang.lark@gmail.com", "phone": "",
        "location_line": "Toronto, Canada", "links": [],
    },
    "summary": "Backend/platform engineer — Go, distributed systems, self-hostable products.",
    "works": [{
        "company": "StandMeet", "role": "Founder / Engineer",
        "start": "2026", "end": "present",
        "bullets": ["Built a self-hostable AI representation platform end to end."],
    }],
    "educations": [],
    "skills": [{"label": "Core", "items": ["Go", "TypeScript", "Postgres", "MCP"]}],
}


def main():
    b = Bridge()
    init = b.initialize()
    print("initialize:", "ok" if "result" in init else init)
    tools = b.list_tools().get("result", {}).get("tools", [])
    names = sorted(t["name"] for t in tools)
    jobs_tools = [n for n in names if n.split(".")[0] in ("jobs", "resume", "applications")]
    print(f"\ntools/list: {len(names)} total; jobs cluster: {jobs_tools}")

    # 1) sources — register a real Greenhouse source if the owner has none.
    srcs, _ = call(b, "jobs.list_sources", {})
    if '"source_id"' not in srcs and '"id"' not in srcs:
        call(b, "jobs.register_source",
             {"kind": "greenhouse", "label": "GitLab (verify)", "config": {"company": "gitlab"}})

    # CACHE_ID override — reuse a job already in the 24h pool (fetch_new is since-last-seen).
    if os.environ.get("CACHE_ID"):
        cache_id = os.environ["CACHE_ID"]
        print(f"\n>>> using CACHE_ID = {cache_id!r}")
        call(b, "jobs.show", {"cache_id": cache_id})
        draft, derr = call(b, "resume.draft", {"job_cache_id": cache_id, "resume_content": RESUME})
        did = json.loads(draft).get("draft_id", "") if not derr else ""
        print(f"\n>>> draft_id = {did!r}")
        return

    # 2) fetch_new — real Greenhouse pull into the 24h Redis pool.
    fetched, ferr = call(b, "jobs.fetch_new", {})
    if ferr:
        print("\nFETCH FAILED — stopping."); sys.exit(1)

    # 3) pick a cache_id from the fetched jobs.
    cache_id = ""
    try:
        for tok in fetched.replace(",", " ").replace('"', " ").split():
            if tok.startswith("job_") or tok.startswith("fj_"):
                cache_id = tok
                break
    except Exception:
        pass
    if not cache_id:
        # fall back: try to parse a JSON array of jobs with cache_id fields
        try:
            data = json.loads(fetched)
            jobs = data if isinstance(data, list) else data.get("jobs", [])
            cache_id = jobs[0].get("cache_id", "") if jobs else ""
        except Exception:
            pass
    print(f"\n>>> picked cache_id = {cache_id!r}")
    if not cache_id:
        print("no cache_id — cannot proceed to resume.draft."); sys.exit(2)

    call(b, "jobs.show", {"cache_id": cache_id})

    # 4) resume.draft — curate a draft against the picked job.
    draft, derr = call(b, "resume.draft", {"job_cache_id": cache_id, "resume_content": RESUME})
    if derr:
        print("\nDRAFT FAILED — stopping."); sys.exit(3)
    draft_id = ""
    try:
        draft_id = json.loads(draft).get("draft_id", "") or json.loads(draft).get("id", "")
    except Exception:
        for tok in draft.replace(",", " ").replace('"', " ").split():
            if tok.startswith("draft_") or tok.startswith("rd_"):
                draft_id = tok; break
    print(f"\n>>> draft_id = {draft_id!r}")
    if not draft_id:
        print("no draft_id — cannot commit."); sys.exit(4)

    # 5) applications.commit — real application row + AccessCode + official PDF+QR.
    #    DRAFT_ONLY=1 stops here (leaves an un-committed draft for the /admin/drafts match-gauge check).
    if os.environ.get("DRAFT_ONLY"):
        print(f"\n>>> DRAFT_ONLY — left draft {draft_id} un-committed for the match-gauge check.")
        return
    call(b, "applications.commit", {"draft_id": draft_id})
    print("\n>>> DONE — inspect the commit result above (application id, access code, pdf url).")


if __name__ == "__main__":
    main()
