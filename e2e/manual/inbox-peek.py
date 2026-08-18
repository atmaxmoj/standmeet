#!/usr/bin/env python3
"""inbox-peek —— 去**真收件箱**看那封信到底有没有到，并把里面的链接原样打出来。

为什么要有它：产品说「已发送」不算数。SMTP 回 250 只证明**对方收下了**，不证明**送达**了
（mail-connector 的 F-C-13 就是这条：accepted ≠ delivered）。判据写着「打开真实收件箱」，
那就得真去读，而不是把产品自己的成功提示当回执。

用的是 verify-creds 里那把 app password —— 跟发信同一把，只是换成 IMAP 读。
这不是「往第三方表单里输密码」，是用已配好的凭据走协议客户端，跟 SMTP 那一半同性质。

用法：
  python3 e2e/manual/inbox-peek.py "subject substring" [last_n] [--body]

--body：把纯文本正文的前 25 行原样打出来。加它是因为**不是每封信里的东西都长得像链接或访问码**——
恢复短语是一串词，两条既有的正则都匹配不到，于是「信到了」看得见、「信里写了什么」看不见。
判据要读的是内容时，只印链接等于没读（同 [[receipt-check-belongs-next-to-the-action]]）。
"""
import email
import imaplib
import os
import re
import sys
from email.header import decode_header, make_header

HOST = "imap.gmail.com"
USER = os.environ.get("GMAIL_SMTP_USER", "")
PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")
ARGS = [a for a in sys.argv[1:] if a != "--body"]
SHOW_BODY = "--body" in sys.argv
NEEDLE = ARGS[0] if ARGS else ""
LAST_N = int(ARGS[1]) if len(ARGS) > 1 else 8
BODY_LINES = 25


def body_text(msg):
    """整封信的可读文本：multipart 就把每一段拼起来，纯文本直接取。"""
    if not msg.is_multipart():
        return msg.get_payload(decode=True).decode("utf-8", "replace")
    parts = []
    for part in msg.walk():
        if part.get_content_type() in ("text/plain", "text/html"):
            raw = part.get_payload(decode=True) or b""
            parts.append(raw.decode("utf-8", "replace"))
    return "\n".join(parts)


def main():
    if not USER or not PASSWORD:
        print("inbox-peek: GMAIL_SMTP_USER / GMAIL_APP_PASSWORD not in env", file=sys.stderr)
        return 2
    box = imaplib.IMAP4_SSL(HOST)
    box.login(USER, PASSWORD)
    box.select("INBOX")
    _, data = box.search(None, "ALL")
    ids = data[0].split()[-LAST_N:]
    hits = 0
    for mid in reversed(ids):
        _, raw = box.fetch(mid, "(RFC822)")
        msg = email.message_from_bytes(raw[0][1])
        subject = str(make_header(decode_header(msg.get("Subject", ""))))
        if NEEDLE and NEEDLE.lower() not in subject.lower():
            continue
        hits += 1
        print(f"--- from: {msg.get('From')}")
        print(f"--- date: {msg.get('Date')}")
        print(f"--- subject: {subject}")
        text = body_text(msg)
        for url in dict.fromkeys(re.findall(r"https?://[^\s\"'<>)]+", text)):
            print(f"    link: {url}")
        for code in dict.fromkeys(re.findall(r"\b[A-Z][A-Z0-9]{2,11}-[A-Z0-9]{3,6}\b", text)):
            print(f"    code: {code}")
        if SHOW_BODY:
            plain = re.sub(r"<[^>]+>", " ", text)
            for line in [ln.strip() for ln in plain.splitlines() if ln.strip()][:BODY_LINES]:
                print(f"    | {line}")
    print(f"inbox-peek: {hits} message(s) matching {NEEDLE!r} in the last {LAST_N}")
    box.logout()
    return 0


if __name__ == "__main__":
    sys.exit(main())
