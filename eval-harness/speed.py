#!/usr/bin/env python3
"""speed.py —— the visitor-agent speed eval (docs: StandMeet Agent speedup handoff, W1–W5).

Asks the regression questions (fixtures/speed/questions.json) one after another in ONE visitor
session on a real instance, through the same endpoints the SDK uses: POST /api/v1/sessions, the
session's prompt parts, POST /api/v1/agent/turn (SSE). Per question it records the wall time, the
time to the first answer token, and every tool the agent called; the answers go to a transcript
for a person to read against each question's gold points. Speed is only a win if the answers hold.

  EVAL_HOST=https://sijie.xyz EVAL_CODE=SPEED-XXX make eval-speed
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# The CDN in front of a real instance refuses urllib's default "Python-urllib" agent.
UA = {'User-Agent': 'standmeet-eval-speed/1'}


def post(url, body, headers=None):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), method='POST',
        headers={'Content-Type': 'application/json', **UA, **(headers or {})})
    return urllib.request.urlopen(req, timeout=600)


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60)


def system_of(host, session):
    parts = []
    for pid in session.get('system_prompt_part_ids') or []:
        path = '/'.join(urllib.parse.quote(s, safe='') for s in pid.split('/'))
        try:
            parts.append(get(f'{host}/api/v1/prompts/{path}').read().decode().strip())
        except OSError:
            pass
    persona = (session.get('system_prompt_persona') or '').strip()
    if persona:
        parts.append(persona)
    return '\n\n'.join(p for p in parts if p)


def frames(resp):
    buf = ''
    for raw in resp:
        buf += raw.decode('utf-8', 'replace')
        while '\n\n' in buf:
            frame, buf = buf.split('\n\n', 1)
            ev, data = '', ''
            for line in frame.split('\n'):
                if line.startswith('event: '):
                    ev = line[7:].strip()
                elif line.startswith('data: '):
                    data = line[6:].strip()
            yield ev, data


def ask(host, session, system, history, question):
    t0 = time.monotonic()
    first, answer, tools, err = None, '', [], ''
    resp = post(f'{host}/api/v1/agent/turn', {
        'system': system, 'user_message': question,
        'conversation_id': session['conversation_id'], 'history': history,
    }, {'Authorization': f"Bearer {session['session_token']}"})
    for ev, data in frames(resp):
        d = json.loads(data) if data.startswith('{') else {}
        if ev == 'text' and d.get('delta'):
            first = first if first is not None else time.monotonic() - t0
            answer += d['delta']
        elif ev == 'tool_started':
            tools.append(d.get('name', '?'))
        elif ev == 'error':
            err = d.get('message', 'error')
        elif ev == 'done':
            break
    return {'total_s': round(time.monotonic() - t0, 1),
            'first_token_s': round(first, 1) if first is not None else None,
            'tools': tools, 'answer': answer, 'error': err}


def main():
    host = os.environ.get('EVAL_HOST', 'http://localhost:8000').rstrip('/')
    code = os.environ['EVAL_CODE']
    out = os.environ.get('EVAL_OUT', '/tmp/sm-eval-speed')
    only = os.environ.get('EVAL_ONLY', '')
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(HERE, 'fixtures/speed/questions.json')) as f:
        questions = [q for q in json.load(f) if not only or q['id'] in only]
    session = json.loads(post(f'{host}/api/v1/sessions', {
        'mode': 'code', 'code': code, 'visitor_name': os.environ.get('EVAL_NAME', 'speed-eval'),
    }).read())
    system = system_of(host, session)
    history, rows = [], []
    for q in questions:
        r = ask(host, session, system, history, q['q'])
        history += [{'role': 'user', 'content': q['q']}, {'role': 'assistant', 'content': r['answer']}]
        r['missing'] = [m for m in q.get('must', []) if m.lower() not in r['answer'].lower()]
        rows.append({**q, **r})
        print(f"({q['id']}) total {r['total_s']}s · first token {r['first_token_s']}s · "
              f"{len(r['tools'])} tools {r['tools']}{' · ERROR ' + r['error'] if r['error'] else ''}"
              f"{' · MISSING ' + str(r['missing']) if r['missing'] else ''}", flush=True)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    with open(os.path.join(out, f'{code}-{stamp}.json'), 'w') as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)
    with open(os.path.join(out, f'{code}-{stamp}.md'), 'w') as f:
        for r in rows:
            f.write(f"## ({r['id']}) {r['q']}\n\n_{r['total_s']}s total, first token "
                    f"{r['first_token_s']}s, tools: {', '.join(r['tools']) or 'none'}_\n\n"
                    f"**Gold:** {r['gold']}\n\n{r['answer'] or '(no answer) ' + r['error']}\n\n")
    totals = sorted(r['total_s'] for r in rows)
    print(f"median total {totals[len(totals) // 2]}s · transcript {out}/{code}-{stamp}.md")
    return 1 if any(r['error'] or not r['answer'] or r['missing'] for r in rows) else 0


if __name__ == '__main__':
    sys.exit(main())
