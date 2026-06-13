---
uri: wiki://work/acme-retail/inventory-sync
title: The inventory sync job (ACME)
kind: wiki
tags: [work-experience, acme, batch, postgres, inventory]
---

ACME had warehouses whose stock lived in a separate WMS, and the website's
inventory had to track them. The sync was a batch job I inherited and spent a lot
of time babysitting — every 15 minutes it pulled deltas and updated our catalog.

It broke in boring ways constantly: the WMS export would be late, one malformed row
would kill the whole batch, or a long-running update would lock rows the site
needed. My contributions were making it resilient rather than clever — skip and log
bad rows instead of aborting, process in smaller chunked transactions so we weren't
holding locks, and add metrics so we'd know it was behind *before* a customer
ordered something we didn't have.

It was my first real lesson that a lot of backend work is making an existing,
fragile thing boring and observable, not building something new and exciting.
