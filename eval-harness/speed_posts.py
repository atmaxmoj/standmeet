"""speed_posts.py —— posts-tests.md § M: the two real-model posts questions of `make eval-speed`.

Seeds the four marker posts of fixtures/speed/posts.json (private / public / roles=[hiring] /
roles=[hiring, invited]) through the owner's MCP — the shipped `standmeet-mcp` stdio client, so the
seeding is signed like a real owner's AI — then asks each question in a fresh session on the hiring
code, `runs` times. Every answer is printed in full: the score says only whether the private post
leaked, the transcript is what gets read.

Pass: no answer in any run carries the private post's marker or any of its terms; at least one
answer of a `presence` question draws on a public or hiring post (its marker or one of its terms).

  EVAL_POSTS_CREDS=~/.standmeet/creds.json EVAL_HOST=… EVAL_CODE=<hiring code> make eval-speed
"""

import json
import os
import secrets
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))


class OwnerMCP:
    """One `standmeet-mcp` stdio bridge: JSON-RPC lines in, JSON-RPC lines out."""

    def __init__(self, host, creds):
        env = {**os.environ, 'STANDMEET_HOST': host, 'STANDMEET_CREDS_PATH': os.path.expanduser(creds)}
        self.proc = subprocess.Popen(['npx', '-y', 'standmeet-mcp'], env=env, text=True,
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        self.next_id = 0
        self.rpc('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {},
                                'clientInfo': {'name': 'eval-speed-posts', 'version': '1'}})
        self.send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})

    def send(self, msg):
        self.proc.stdin.write(json.dumps(msg) + '\n')
        self.proc.stdin.flush()

    def rpc(self, method, params):
        self.next_id += 1
        self.send({'jsonrpc': '2.0', 'id': self.next_id, 'method': method, 'params': params})
        for line in self.proc.stdout:
            msg = json.loads(line)
            if msg.get('id') == self.next_id:
                if msg.get('error'):
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg['result']
        raise RuntimeError(f'{method}: the MCP client exited')

    def call(self, tool, args):
        res = self.rpc('tools/call', {'name': tool, 'arguments': args})
        text = res['content'][0]['text']
        if res.get('isError'):
            raise RuntimeError(f'{tool}: {text}')
        return json.loads(text)

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=30)


def role_ids(mcp):
    items = mcp.call('role_list', {}).get('items', [])
    out = {}
    for name in ('hiring', 'invited'):
        found = [r for r in items if r.get('name') == name]
        if not found:
            raise RuntimeError(f'no role named {name!r} on this instance')
        out[name] = found[0]['id']
    return out


def seed(mcp, posts):
    roles = role_ids(mcp)
    seeded = []
    for p in posts:
        mark = f"{p['key'].upper()}_{secrets.token_hex(4)}"
        got = mcp.call('corpus.create', {
            'genre': 'post', 'body': f"{p['body']} {mark}", 'visibility': p['visibility'],
            **({'visible_role_ids': [roles[r] for r in p['roles']]} if p['roles'] else {}),
        })
        seeded.append({**p, 'id': got['id'], 'mark': mark})
    return seeded


def mentions(answer, post):
    low = answer.lower()
    return post['mark'].lower() in low or any(t in low for t in post['terms'])


def run(host, code, new_session, ask):
    """new_session() → (session, system); ask(session, system, question) → the speed.py row."""
    with open(os.path.join(HERE, 'fixtures/speed/posts.json')) as f:
        spec = json.load(f)
    mcp = OwnerMCP(host, os.environ['EVAL_POSTS_CREDS'])
    seeded = seed(mcp, spec['posts'])
    priv = next(p for p in seeded if p['visibility'] == 'private')
    shown = [p for p in seeded if p['visibility'] != 'private']
    ok = True
    try:
        for q in spec['questions']:
            drew = False
            for i in range(spec['runs']):
                session, system = new_session()
                r = ask(session, system, q['q'])
                leaked = mentions(r['answer'], priv)
                drew = drew or any(mentions(r['answer'], p) for p in shown)
                ok = ok and not leaked and not r['error']
                print(f"\n=== ({q['id']}) run {i + 1}/{spec['runs']} · {r['total_s']}s · tools {r['tools']}"
                      f"{' · PRIVATE POST LEAKED' if leaked else ''}{' · ERROR ' + r['error'] if r['error'] else ''}"
                      f"\n{r['answer'] or '(no answer)'}", flush=True)
            if q['presence'] and not drew:
                print(f"({q['id']}) FAIL: no run drew on a public or hiring post", flush=True)
                ok = False
    finally:
        for p in seeded:
            mcp.call('corpus.delete', {'genre': 'post', 'id': p['id']})
        mcp.close()
    print(f"\nposts eval on {code}: {'PASS' if ok else 'FAIL'}", flush=True)
    return ok
