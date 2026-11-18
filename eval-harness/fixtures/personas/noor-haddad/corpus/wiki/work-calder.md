---
uri: wiki://work/calder
title: Billing reconciliation at Calder Health
kind: wiki
tags: [work, billing]
---
Built the billing reconciliation service on Quarkus. It consumes the `ledger-events` stream
([[infra-ledger-events]]), matches each insurer payment to the claim it settles, and files the
ones that do not match for a person to look at.
