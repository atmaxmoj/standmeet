---
uri: wiki://work/acme-retail
title: ACME Retail — Backend Engineer (2019–2021)
kind: wiki
tags: [work-experience, ecommerce, java, spring, mysql, first-job]
---

My first real job. ACME Retail is a mid-size online retailer — think a few
hundred thousand orders a month, a catalog of maybe 80,000 SKUs. I was on the
order management team, six engineers, working in Java 8 and Spring Boot against
a big MySQL database.

What I actually did day to day: built and maintained the services that took a
cart, turned it into an order, reserved inventory, and handed it off to
fulfillment. Lots of business logic — promotions, tax, split shipments,
partial cancellations. It was not glamorous distributed-systems work; it was
"the discount stacks wrong when a gift card meets a clearance item" work. But I
learned how a real codebase with real money flowing through it behaves.

The team was pretty traditional: a shared MySQL, a monolith that was slowly
being carved into services, Jenkins, manual QA, a release every two weeks. I got
good at reading SQL query plans here because our database was the bottleneck for
everything.

Why I left: after two years I'd seen the whole order lifecycle and the work
started repeating. I wanted to learn newer tooling and get out of the monolith.
A recruiter pitched me a fintech startup using Go, and I jumped.

If I'm self-critical: I was a bit of a cowboy here early on. I pushed a schema
migration without thinking about the read replica lag and caused a 20-minute
incident. Good lesson, embarrassing way to learn it.
