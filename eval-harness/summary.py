#!/usr/bin/env python3
# summary.py —— end-to-end eval of summarize_conversation on REAL DeepSeek (no
# mock). Models a recruiter who DIGS INTO ONE POINT instead of asking one-line
# questions:
#
#   1. DRILL   — the interviewer picks the single most substantive thing the
#                candidate raises and drills only into it for several adaptive
#                turns (specifics, mechanism, tradeoffs).
#   2. SUMMARIZE — asks the candidate for a shareable written summary; the agent
#                  calls summarize_conversation and we capture the report HTML.
#   3. FOLLOW-UP — the recruiter keeps asking AFTER the summary. These turns
#                  carry the (text-less) summarize turn in history, so they also
#                  guard the empty-assistant-message bug: a post-summarize turn
#                  must still answer, not 400.
#   4. JUDGE   — an LLM judge scores the report: faithful, grounded, structured,
#                captures the drilled point, third-person.
#
# The report HTML + a rendered PDF are written to a temp dir so a human can
# actually open the artifact.
#
#   make eval-summary
#   EVAL_SUMMARY_DRILL=6 EVAL_SUMMARY_FOLLOWUPS=3 make eval-summary
#
# Needs the real LLM (eval-harness/.env DeepSeek key) for candidate, interviewer,
# and judge.

import json
import os
import subprocess
import sys
import textwrap
import urllib.request

BIN = os.environ.get("EVAL_BIN", "./eval-harness-bin")
PERSONA = os.environ.get("EVAL_PERSONA", "fixtures/personas/marcus-chen")
DRILL = int(os.environ.get("EVAL_SUMMARY_DRILL", "5"))
FOLLOWUPS = int(os.environ.get("EVAL_SUMMARY_FOLLOWUPS", "3"))
TURN_TIMEOUT = int(os.environ.get("EVAL_TURN_TIMEOUT", "180"))
OUTDIR = os.environ.get("EVAL_SUMMARY_OUT", "/tmp/sm-eval-summary")


def load_dotenv(path=".env"):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


load_dotenv()
KEY = os.environ.get("EVAL_KEY", "")
ENDPOINT = os.environ.get("EVAL_ENDPOINT", "https://api.deepseek.com").rstrip("/")
MODEL = os.environ.get("EVAL_MODEL", "deepseek-chat")

DRILL_SYSTEM = (
    "You are a sharp engineering hiring manager interviewing Marcus, a backend "
    "engineer, for a senior role. Pick the SINGLE most substantive project or "
    "incident he raises in his first answer and drill ONLY into it for the whole "
    "interview — do not change topics, do not summarize. Each turn ask exactly "
    "ONE adaptive follow-up that goes deeper into specifics: what exactly broke, "
    "the precise mechanism, the tradeoff he weighed, what he'd do differently. "
    "If an answer is vague, push ('what exactly', 'why that and not X'). Output "
    "ONLY the question — no preamble, no 'good answer'."
)

FOLLOWUP_SYSTEM = (
    "You are the same hiring manager. The candidate just produced a written "
    "summary of the conversation. Ask ONE more sharp follow-up that goes beyond "
    "the summary.\n"
    "Output ONLY the question itself — a single question, one or two sentences. "
    "No preamble, no analysis, no restating the candidate's answer, and do NOT "
    "write a summary yourself."
)

JUDGE_SYSTEM = (
    "You are a strict evaluator of an AI-generated conversation-summary report. "
    "You get the full interview transcript and the HTML report the AI produced "
    "for the recruiter. Judge the report against the transcript.\n\n"
    "This is an INTERVIEW, so the report should default to STAR framing.\n\n"
    "Return ONLY a JSON object:\n"
    '{"faithful": bool, "grounded": bool, "structured": bool, "uses_star": bool, '
    '"captures_point": bool, "third_person": bool, "score": 1-5, '
    '"issues": [string], "verdict": string}\n\n'
    "- faithful: every claim is supported by the transcript. Set false and list "
    "the issue if the report invents a number, name, or specific the candidate "
    "never said.\n"
    "- grounded: the specifics match what the candidate actually said.\n"
    "- structured: clear title + sections.\n"
    "- uses_star: each substantive experience is framed as Situation / Task / "
    "Action / Result — the right shape for a recruiter evaluating the candidate. "
    "Set false if it's just generic meeting-notes (overview/topics) with no STAR.\n"
    "- captures_point: the ONE topic the interview drilled is the core of it.\n"
    "- third_person: written about 'the visitor'/'the candidate', not first person.\n"
    "- score: overall 1 (useless) to 5 (excellent, recruiter-ready). A report that "
    "ignores STAR for an interview cannot score above 3.\n"
    "- issues: concrete problems; empty if none.\n"
    "- verdict: one-sentence overall assessment."
)


def deepseek(system, msgs, temperature=0.7):
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "system", "content": system}] + msgs,
        "temperature": temperature,
    }).encode()
    req = urllib.request.Request(
        f"{ENDPOINT}/chat/completions", data=body,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=TURN_TIMEOUT) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"].strip()


def interviewer_next(system, transcript, hint):
    msgs = []
    for t in transcript:
        role = "assistant" if t["role"] == "interviewer" else "user"
        # The summarize turn has no verbal answer (ReturnDirectly). Feeding the
        # interviewer an empty user message makes it ramble (and the candidate
        # history keeps the real empty turn, to guard the #85 fix); give the
        # interviewer a readable placeholder instead.
        content = t["text"] or "(no spoken reply — produced a written summary report)"
        msgs.append({"role": role, "content": content})
    msgs.append({"role": "user", "content": hint})
    return deepseek(system, msgs, temperature=0.7)


def candidate_answer(history, question):
    req = {"mode": "code", "booking": False, "history": history, "question": question}
    p = subprocess.run(
        [BIN, "--ask", "--persona", PERSONA],
        input=json.dumps(req), capture_output=True, text=True, timeout=TURN_TIMEOUT)
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        print(f"CANDIDATE PARSE FAIL\nstdout={p.stdout[:600]}\nstderr={p.stderr[-600:]}")
        sys.exit(1)


def show(label, q, resp):
    tools = [t["name"] for t in resp.get("tools", [])]
    print(f"\n{'=' * 80}\n{label}")
    print("RECRUITER:", "\n".join(textwrap.wrap(q, 94)))
    print("-" * 80)
    if tools:
        print("tools:", ", ".join(tools))
    ans = resp.get("answer", "")
    if ans:
        print("MARCUS:", "\n".join(textwrap.wrap(ans, 94)))
    if resp.get("error"):
        print("ERROR:", resp["error"])
    return ans


def judge(transcript_text, report_html):
    user = (f"INTERVIEW TRANSCRIPT:\n{transcript_text}\n\n"
            f"GENERATED HTML REPORT:\n{report_html}")
    raw = deepseek(JUDGE_SYSTEM, [{"role": "user", "content": user}], temperature=0.0)
    s = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        return json.loads(s[s.index("{"):s.rindex("}") + 1])
    except (ValueError, json.JSONDecodeError):
        return {"score": 0, "verdict": f"judge parse failed: {raw[:200]}", "issues": []}


REPORT_CSS = (
    "body{background:#F3EFE6;color:#1B1814;font-family:'Newsreader',Georgia,serif;"
    "font-size:17px;line-height:1.65;max-width:48em;margin:0 auto;padding:56px 32px;}"
    "h1{font-size:30px;font-weight:500;margin:0 0 .2em;}"
    "h2{font-family:'JetBrains Mono',monospace;font-size:11px;text-transform:uppercase;"
    "letter-spacing:.18em;color:#B5391C;margin:2.2em 0 .9em;padding-top:.9em;"
    "border-top:1px solid #DAD3C4;}"
    ".lede{font-size:20px;line-height:1.5;margin:0 0 1.5em;}"
    ".callout{border-left:2px solid #B5391C;background:rgba(181,57,28,.05);padding:.9em 1.1em;margin:1.3em 0;}"
    "ul.checks{list-style:none;padding-left:0;}ul.checks li{position:relative;padding-left:1.5em;margin:.5em 0;}"
    "ul.checks li:before{content:'\\2192';position:absolute;left:0;color:#B5391C;font-family:monospace;}"
    ".tags{margin:.4em 0 1.4em;}.tag{font-family:'JetBrains Mono',monospace;font-size:10.5px;"
    "text-transform:uppercase;letter-spacing:.1em;color:#6B6256;border:1px solid #DAD3C4;padding:.2em .6em;margin-right:.3em;}"
    ".kv{display:flex;gap:1em;padding:.4em 0;border-bottom:1px solid #DAD3C4;}"
    ".kv .k{font-family:'JetBrains Mono',monospace;font-size:11px;text-transform:uppercase;color:#6B6256;min-width:9em;}"
    ".exp{margin:.4em 0 2em;}.star{margin:.6em 0 0;}"
    ".star-row{display:grid;grid-template-columns:7.5em 1fr;gap:1.2em;align-items:start;"
    "padding:.65em 0;border-bottom:1px solid #DAD3C4;}"
    ".star-row:first-child{border-top:1px solid #DAD3C4;}"
    ".star-k{font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:500;"
    "text-transform:uppercase;letter-spacing:.14em;color:#B5391C;padding-top:.25em;}.star-v{margin:0;}"
)


def save_artifacts(report_html):
    os.makedirs(OUTDIR, exist_ok=True)
    frag = os.path.join(OUTDIR, "report-fragment.html")
    open(frag, "w", encoding="utf-8").write(report_html)
    doc = (f"<!DOCTYPE html><html><head><meta charset='utf-8'>"
           f"<link href='https://fonts.googleapis.com/css2?family=Newsreader:wght@400;500&"
           f"family=JetBrains+Mono:wght@400;500&display=swap' rel='stylesheet'>"
           f"<style>{REPORT_CSS}</style></head><body>{report_html}</body></html>")
    docpath = os.path.join(OUTDIR, "report.html")
    open(docpath, "w", encoding="utf-8").write(doc)
    return docpath


def main():
    if not KEY:
        print("no EVAL_KEY (need eval-harness/.env with the DeepSeek key)")
        sys.exit(1)
    history, transcript = [], []

    # 1. DRILL into one point.
    for i in range(1, DRILL + 1):
        hint = ("(Begin the interview with your first question.)" if not transcript
                else "(Ask your next, deeper follow-up on the SAME topic.)")
        q = interviewer_next(DRILL_SYSTEM, transcript, hint)
        resp = candidate_answer(history, q)
        ans = show(f"DRILL {i}/{DRILL}", q, resp)
        history += [{"role": "interviewer", "text": q}, {"role": "candidate", "text": ans}]
        transcript = history

    # 2. SUMMARIZE — capture the report.
    sumq = ("Before we wrap this thread — can you put together a written summary "
            "of what we just covered that I can share with my team?")
    sresp = candidate_answer(history, sumq)
    report = sresp.get("report", "")
    show(f"SUMMARIZE  [report captured: {bool(report)}]", sumq, sresp)
    # carry the (text-less) summarize turn into history so the follow-ups exercise
    # the post-summarize path (the empty-assistant-message guard).
    history += [{"role": "interviewer", "text": sumq},
                {"role": "candidate", "text": sresp.get("answer", "")}]
    transcript = history

    # 3. FOLLOW-UPS after summarize — must still answer (guards the history bug).
    followup_ok = True
    for i in range(1, FOLLOWUPS + 1):
        q = interviewer_next(FOLLOWUP_SYSTEM, transcript, "(Ask one more follow-up.)")
        resp = candidate_answer(history, q)
        ans = show(f"FOLLOW-UP {i}/{FOLLOWUPS}", q, resp)
        if resp.get("error") or not ans:
            followup_ok = False
            print(f"!! POST-SUMMARIZE TURN FAILED: {resp.get('error', 'empty answer')}")
        history += [{"role": "interviewer", "text": q}, {"role": "candidate", "text": ans}]
        transcript = history

    # 4. JUDGE the report + report results.
    print(f"\n{'#' * 80}\nRESULTS")
    if not report:
        print("FAIL — the agent never produced a summary report (summarize_conversation not called).")
        sys.exit(1)
    docpath = save_artifacts(report)
    tx = "\n".join(f"{'Q' if t['role']=='interviewer' else 'A'}: {t['text']}" for t in transcript)
    verdict = judge(tx, report)
    print(f"\nSUMMARY JUDGE: score={verdict.get('score')}/5  "
          f"faithful={verdict.get('faithful')}  grounded={verdict.get('grounded')}  "
          f"structured={verdict.get('structured')}  uses_star={verdict.get('uses_star')}  "
          f"captures_point={verdict.get('captures_point')}  "
          f"third_person={verdict.get('third_person')}")
    print("verdict:", verdict.get("verdict"))
    for issue in verdict.get("issues", []):
        print("  - issue:", issue)
    print(f"\npost-summarize follow-ups all answered: {followup_ok}")
    print(f"report saved: {docpath}")
    print(f"           +  {os.path.join(OUTDIR, 'report-fragment.html')}")


if __name__ == "__main__":
    main()
