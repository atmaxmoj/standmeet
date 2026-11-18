---
uri: wiki://work/brightwater
title: Dispatch service at Brightwater Logistics
kind: wiki
tags: [work]
---
Wrote the dispatch service in Kotlin on Spring Boot: it assigns parcels to vans each morning and
re-plans when a driver calls in late. State lived in Postgres 11; the planner ran as a batch job
every fifteen minutes.
