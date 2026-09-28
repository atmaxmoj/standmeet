---
uri: wiki://work/tidewater
title: Tidewater — appointment reminders
kind: wiki
tags: [work, project]
---
Appointment reminders for small clinics (Go + Postgres). The scheduler is the core: each pending
reminder holds a lease with a TTL in Redis; a worker renews the lease while it sends, and an
expired lease makes the reminder claimable again, so a crashed worker never loses or doubles a
reminder.
