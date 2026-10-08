#!/usr/bin/env python3
"""ghost_live.py —— does the ghost actually steer, on a real instance with a real model?

One visitor session on a code whose role carries waypoints. The visitor opens with a neutral
question, then FOLLOWS every ghost (asks its text as the next question), the way a visitor who
taps the suggestion does. After each turn it reads the post-`done` `ghost` frame (same endpoint
the SDK uses: POST /api/v1/agent/turn, SSE).

Pass (exit 0) only when all hold — each is a way steering visibly fails:
  1. the first turn ends with a ghost (a role with waypoints that never steers is the bug);
  2. no waypoint is targeted again after the visitor already followed a ghost to it;
  3. at least MIN_DISTINCT different waypoints are visited within the turn budget;
  4. once the terminal waypoint was followed (or every waypoint), the ghost goes silent within
     two turns (a ghost that keeps pushing after the destination is reached is noise).

    EVAL_HOST=https://sijie.xyz EVAL_CODE=<code> python3 eval-harness/ghost_live.py
Prints every question, answer and ghost: read them — the score only says it moved, the
transcript says whether it moved somewhere sensible.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from speed import frames, post, system_of  # noqa: E402  (same wire, one implementation)

TURNS = int(os.environ.get('EVAL_GHOST_TURNS', '7'))
MIN_DISTINCT = int(os.environ.get('EVAL_GHOST_MIN_DISTINCT', '3'))
OPENER = os.environ.get('EVAL_GHOST_OPENER', "Hi — I'm a recruiter. What does Sijie do?")


def turn(host, session, system, history, question):
    """One turn: the answer text, and the ghost frame that follows `done` ({} = none)."""
    body = {'system': system, 'user_message': question,
            'conversation_id': session['conversation_id'], 'history': history}
    resp = post(f'{host}/api/v1/agent/turn', body,
                {'Authorization': f"Bearer {session['session_token']}"})
    answer, ghost = '', {}
    for ev, data in frames(resp):
        d = json.loads(data) if data.startswith('{') else {}
        if ev == 'text' and d.get('delta'):
            answer += d['delta']
        elif ev == 'ghost':
            ghost = d
    return answer, ghost


def main():
    host = os.environ.get('EVAL_HOST', 'http://localhost:8000').rstrip('/')
    session = json.loads(post(f'{host}/api/v1/sessions', {
        'mode': 'code', 'code': os.environ['EVAL_CODE'], 'visitor_name': 'ghost-eval',
    }).read())
    system = system_of(host, session)
    terminal = set(filter(None, os.environ.get('EVAL_GHOST_TERMINAL', '').split(',')))
    history, followed, fails = [], [], []
    question, silent_after_end = OPENER, None
    for i in range(1, TURNS + 1):
        answer, ghost = turn(host, session, system, history, question)
        target, text = ghost.get('target_waypoint', ''), (ghost.get('text') or '').strip()
        print(f"\n── turn {i}\nQ: {question}\nA: {answer[:600]}{'…' if len(answer) > 600 else ''}"
              f"\nGHOST → {target or '(none)'}: {text or '(silent)'}", flush=True)
        history += [{'role': 'user', 'content': question}, {'role': 'assistant', 'content': answer}]
        if i == 1 and not text:
            fails.append('no ghost after the first turn')
        if text and target in followed:
            fails.append(f'turn {i}: targets {target} again after it was followed')
        done = bool(terminal & set(followed)) or (followed and not text)
        if done and silent_after_end is None:
            silent_after_end = i
        if silent_after_end is not None and text and i - silent_after_end >= 2:
            fails.append(f'turn {i}: still steering two turns after the destination')
        if not text:
            break
        followed.append(target)
        if target in terminal:
            # The destination is the ask itself; the booking flow is its own e2e (booking-*).
            print(f"\nreached the terminal waypoint {target} at turn {i}")
            break
        question = text
    distinct = len(set(followed))
    print(f"\nfollowed: {followed} · distinct {distinct}")
    if distinct < MIN_DISTINCT:
        fails.append(f'only {distinct} distinct waypoints visited (want ≥ {MIN_DISTINCT})')
    for f in fails:
        print('FAIL:', f)
    print('PASS' if not fails else 'RED')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
