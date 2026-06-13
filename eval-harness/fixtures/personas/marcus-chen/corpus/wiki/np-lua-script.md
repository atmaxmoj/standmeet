---
uri: wiki://project/notification-pipeline/rate-limiting/lua-script
title: The atomic check-and-decrement, line by line
kind: wiki
tags: [orbit, redis, lua, concurrency, deep-dive]
---

This is the one genuinely subtle piece of the notification pipeline, so it gets its
own page. The problem: with a pool of workers all hitting the same Redis bucket, a
read-then-write rate-limit check races. Redis runs Lua scripts atomically — one
script, start to finish, nothing else interleaves — so I moved the whole
check-and-decrement into a script.

Roughly what it does:
1. Read the current token count and the last-refill timestamp for the key.
2. Add tokens for the elapsed time (elapsed × refill rate), capped at the burst
   size. This is lazy refill — cheaper than a background refiller.
3. If tokens >= 1, decrement and return "allowed"; otherwise return "denied" plus
   the seconds until the next token.
4. Write the new count and timestamp back, with a TTL so idle keys expire.

Because it's one atomic script, two workers can't both see the same token and both
spend it. I won't pretend I wrote it from scratch — I adapted a well-known pattern
and spent a day actually understanding it instead of copy-pasting, which is the
only reason I can debug it now. It's the piece of this project I'm most confident
explaining in an interview.
