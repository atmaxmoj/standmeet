"""
Populate demo data for manual testing.

Creates a realistic set of content, roles, and invite codes.
Idempotent — skips items that already exist (matched by path/name/label).
"""

import os
from datetime import timedelta
from pathlib import Path

from django.core.management.base import BaseCommand
from django.utils import timezone

from infrastructure.persistence.models import (
    AssetModel,
    ContentEntryModel,
    InviteCodeModel,
    PathPermissionModel,
    RoleModel,
    SkillModel,
)
from infrastructure.settings.models import SiteSettingsModel
from infrastructure.storage.s3_client import MinioAssetStorage

# ── Content ──

CONTENT = [
    # Profile
    {
        "path": "/profile/basic",
        "content": {
            "body": (
                "**Name:** Alex Chen\n"
                "**Title:** Full-Stack Engineer & Open Source Contributor\n"
                "**Location:** San Francisco, CA\n"
                "**Email:** alex@example.com\n"
                "**Website:** https://alexchen.dev"
            ),
        },
        "summary": "Basic profile info — name, title, location, contact",
        "visibility": "public",
        "show_as_source": True,
    },
    {
        "path": "/profile/bio",
        "content": {
            "body": (
                "## Short Bio\n\n"
                "I build developer tools and distributed systems. Previously at Stripe and Google. MIT CS '18.\n\n"
                "## Full Bio\n\n"
                "I'm a full-stack engineer with 8 years of experience building developer tools and "
                "distributed systems. I started my career at Google working on Kubernetes internals, "
                "then moved to Stripe where I led the API platform team. Now I'm an independent "
                "consultant and open source contributor, focusing on developer experience and "
                "infrastructure tooling. I'm passionate about making complex systems accessible "
                "through great abstractions."
            ),
        },
        "summary": "Short and long bio",
        "visibility": "public",
        "show_as_source": True,
    },
    # Skills
    {
        "path": "/skills/languages",
        "content": {
            "body": (
                "## Programming Languages\n\n"
                "**Expert:** TypeScript, Python, Go, Rust\n"
                "**Proficient:** Java, C++, SQL\n"
                "**Familiar:** Elixir, Haskell, Zig"
            ),
        },
        "summary": "Programming languages by proficiency level",
        "visibility": "public",
        "show_as_source": True,
    },
    {
        "path": "/skills/tools",
        "content": {
            "body": (
                "## Tools & Frameworks\n\n"
                "**Infrastructure:** Kubernetes, Docker, Terraform, AWS, GCP\n"
                "**Databases:** PostgreSQL, Redis, DynamoDB, ClickHouse\n"
                "**Frameworks:** React, Next.js, Django, FastAPI, gRPC\n"
                "**Practices:** CI/CD, TDD, Domain-Driven Design, Event Sourcing"
            ),
        },
        "summary": "Tools, frameworks, and practices",
        "visibility": "public",
        "show_as_source": True,
    },
    # Work experience
    {
        "path": "/work/experience",
        "content": {
            "body": (
                "## Independent Consultant — Principal Engineer (2023 – present)\n\n"
                "- Help startups design and scale their backend systems\n"
                "- Built a real-time analytics pipeline processing 2M events/sec\n"
                "- Advisor to 3 YC-backed startups on infrastructure strategy\n\n"
                "## Stripe — Staff Engineer, API Platform (2020 – 2023)\n\n"
                "- Led the API platform team (12 engineers)\n"
                "- Designed the next-gen API versioning system\n"
                "- Reduced p99 API latency by 40% through connection pooling overhaul\n\n"
                "## Google — Senior Software Engineer, Kubernetes (2018 – 2020)\n\n"
                "- Core contributor to Kubernetes scheduler\n"
                "- Shipped custom resource definitions v2\n"
                "- Mentored 5 junior engineers"
            ),
        },
        "summary": "Work history — roles, companies, key achievements",
        "visibility": "public",
        "show_as_source": True,
    },
    # Projects
    {
        "path": "/projects/oss",
        "content": {
            "body": (
                "## Open Source Projects\n\n"
                "### fastmcp ⭐ 2,400\n"
                "High-performance MCP server framework for Python\n"
                "Tech: Python, asyncio, MCP\n"
                "https://github.com/alexchen/fastmcp\n\n"
                "### kubediff ⭐ 850\n"
                "Visual diff tool for Kubernetes manifests\n"
                "Tech: Go, Kubernetes\n"
                "https://github.com/alexchen/kubediff\n\n"
                "### sqlfmt ⭐ 3,100\n"
                "Opinionated SQL formatter with IDE integration\n"
                "Tech: Rust, WASM\n"
                "https://github.com/alexchen/sqlfmt"
            ),
        },
        "summary": "Open source projects with descriptions and tech stack",
        "visibility": "public",
        "show_as_source": True,
    },
    {
        "path": "/projects/side",
        "content": {
            "body": (
                "## Side Projects\n\n"
                "### StandMeet (active)\n"
                "AI-powered personal introduction platform (this site!)\n"
                "Tech: Django, Next.js, Claude Agent SDK\n\n"
                "### HomeKit Bridge (maintained)\n"
                "Custom IoT bridge connecting legacy devices to Apple HomeKit\n"
                "Tech: Swift, Raspberry Pi, MQTT"
            ),
        },
        "summary": "Side projects and personal experiments",
        "visibility": "public",
        "show_as_source": True,
    },
    # Education
    {
        "path": "/education/degrees",
        "content": {
            "body": (
                "## MIT — B.S. Computer Science (2018)\n\n"
                "- Dean's List\n"
                "- Undergraduate TA for 6.824 Distributed Systems"
            ),
        },
        "summary": "Education background",
        "visibility": "public",
        "show_as_source": True,
    },
    # Blog
    {
        "path": "/blog/api-design",
        "content": {
            "body": (
                "# API Design Lessons from 5 Years at Stripe\n"
                "*2024-03-15*\n\n"
                "After spending 3 years building and maintaining Stripe's API platform, "
                "here are the principles I've come to believe in:\n\n"
                "## 1. Consistency beats cleverness\n"
                "Every endpoint should feel like it belongs to the same API. Use the same "
                "patterns for pagination, filtering, and error handling everywhere.\n\n"
                "## 2. Version early, version often\n"
                "API versioning isn't just about breaking changes — it's about giving yourself "
                "room to evolve. We shipped a new versioning system that let us make "
                "backward-compatible improvements without touching existing versions.\n\n"
                "## 3. Errors are part of the API\n"
                "Your error responses deserve as much design attention as your success responses. "
                "Include machine-readable error codes, human-readable messages, and actionable suggestions.\n\n"
                "## 4. Idempotency is non-negotiable\n"
                "Every mutating endpoint should support idempotency keys. Network failures happen; "
                "your API should handle retries gracefully."
            ),
        },
        "summary": "Blog post about API design principles learned at Stripe",
        "visibility": "public",
        "show_as_source": True,
    },
    {
        "path": "/blog/rust-production",
        "content": {
            "body": (
                "# Why We Rewrote Our SQL Formatter in Rust\n"
                "*2024-01-20*\n\n"
                "Our SQL formatter started as a Python script. It worked fine for small queries "
                "but choked on 10,000-line stored procedures. Here's how we rewrote it in Rust "
                "and got a **50x speedup** while adding WASM support for browser-based formatting.\n\n"
                "| Metric | Python | Rust |\n"
                "|--------|--------|------|\n"
                "| 100-line query | 12ms | 0.2ms |\n"
                "| 10K-line query | 8.4s | 160ms |\n"
                "| Memory usage | 120MB | 3MB |\n\n"
                "The rewrite took 6 weeks with 2 engineers. Worth every minute."
            ),
        },
        "summary": "Blog post about rewriting sqlfmt in Rust with benchmarks",
        "visibility": "public",
        "show_as_source": True,
    },
    # Interests (private — for invitation mode only)
    {
        "path": "/personal/interests",
        "content": {
            "body": (
                "## Personal Interests\n\n"
                "**Hobbies:** Rock climbing, Sourdough bread baking, Film photography\n"
                "**Reading:** Currently reading 'Designing Data-Intensive Applications' for the 3rd time\n"
                "**Music:** Mostly jazz and ambient electronic. Favorite album: Kind of Blue."
            ),
        },
        "summary": "Personal interests and hobbies",
        "visibility": "private",
        "show_as_source": True,
    },
    # Contact preferences (private, hidden from sources)
    {
        "path": "/private/contact-rules",
        "content": {
            "body": (
                "## Contact Preferences\n\n"
                "**Preferred method:** Email\n"
                "**Response time:** Usually within 24 hours\n\n"
                "**Not interested in:** cold sales pitches, crypto/web3 projects\n\n"
                "Happy to chat about open source, distributed systems, or career advice."
            ),
        },
        "summary": "Contact preferences and rules for AI",
        "visibility": "private",
        "show_as_source": False,
    },
    # Internal notes (private, hidden from sources)
    {
        "path": "/private/ai-notes",
        "content": {
            "body": (
                "## AI Behavior Notes\n\n"
                "- Be friendly but professional. Use humor sparingly.\n"
                "- Don't share salary info or specific client names.\n"
                "- For consulting inquiries, suggest emailing alex@example.com."
            ),
        },
        "summary": "Internal AI behavior notes — NOT shown to visitors",
        "visibility": "private",
        "show_as_source": False,
    },
    # Work — detailed Stripe experience
    {
        "path": "/work/stripe-deep-dive",
        "content": {
            "body": (
                "## Stripe — Deep Dive\n\n"
                "### API Versioning System\n"
                "Stripe's API has thousands of integrations. Breaking changes are existential threats. "
                "I designed a version gate system that lets us evolve the API without breaking existing "
                "integrations. Each version is a set of transformations applied to the canonical internal "
                "representation. New versions add transformations; old versions keep working forever.\n\n"
                "**Technical details:**\n"
                "- Version gates are composable middleware functions\n"
                "- Automated compatibility testing: every PR runs against all active API versions\n"
                "- Dashboard shows which merchants are on which versions with migration guides\n"
                "- Reduced version-related incidents from ~4/quarter to 0 in 18 months\n\n"
                "### Connection Pooling Overhaul\n"
                "Our p99 API latency was creeping up as traffic grew. Root cause: connection pool exhaustion "
                "under load spikes. I redesigned the connection management layer:\n"
                "- Replaced per-service pools with a shared pool using connection multiplexing\n"
                "- Added adaptive pool sizing based on traffic patterns\n"
                "- Implemented graceful degradation: shed load early rather than timeout\n"
                "- Result: p99 dropped from 850ms to 510ms (40% reduction), p50 from 45ms to 28ms\n\n"
                "### Team Leadership\n"
                "Led a team of 12 engineers (3 senior, 6 mid, 3 junior). My approach:\n"
                "- Weekly 1:1s focused on career growth, not status updates\n"
                "- Architecture Decision Records (ADRs) for all significant choices\n"
                "- Promoted 4 engineers during my tenure\n"
                "- Team satisfaction score went from 7.2 to 9.1 (internal survey)"
            ),
        },
        "summary": "Detailed Stripe experience — versioning system, connection pooling, team leadership",
        "visibility": "public",
        "show_as_source": True,
    },
    # Work — detailed Google experience
    {
        "path": "/work/google-deep-dive",
        "content": {
            "body": (
                "## Google — Deep Dive\n\n"
                "### Kubernetes Scheduler\n"
                "The scheduler is the brain of Kubernetes — it decides which node runs each pod. "
                "I worked on improving scheduling throughput and fairness:\n"
                "- Implemented preemption scoring to reduce unnecessary pod evictions by 60%\n"
                "- Added topology-aware scheduling for better resource utilization across zones\n"
                "- Contributed ~15K lines to the upstream project\n\n"
                "### Custom Resource Definitions v2\n"
                "CRDs let users extend the Kubernetes API. V1 had validation limitations. "
                "I co-designed CRD v2 with structural schemas and server-side validation:\n"
                "- Designed the OpenAPI v3 schema validation pipeline\n"
                "- Implemented conversion webhooks for multi-version CRDs\n"
                "- Wrote the KEP (Kubernetes Enhancement Proposal) and shepherded it through review\n\n"
                "### What I Learned\n"
                "- How to contribute to a massive open-source project (2000+ contributors)\n"
                "- The art of writing KEPs that actually get approved\n"
                "- Distributed consensus is hard; distributed scheduling is harder"
            ),
        },
        "summary": "Detailed Google/Kubernetes experience — scheduler, CRDs, open source process",
        "visibility": "public",
        "show_as_source": True,
    },
    # Skills — architecture philosophy
    {
        "path": "/skills/architecture",
        "content": {
            "body": (
                "## Architecture Philosophy\n\n"
                "### Principles I Follow\n"
                "1. **Start monolithic, extract when it hurts.** Microservices are a scaling strategy, "
                "not an architecture. Most teams split too early.\n"
                "2. **Make the right thing the easy thing.** If developers have to fight the system to do "
                "the right thing, the system is wrong.\n"
                "3. **Optimize for debuggability.** Production will break. The question is how fast you "
                "can understand what went wrong. Structured logging, distributed tracing, and "
                "correlation IDs are non-negotiable.\n"
                "4. **Domain-Driven Design for boundaries, not for everything.** DDD is great for finding "
                "service boundaries and ubiquitous language. But don't cargo-cult aggregates and repositories "
                "into a 500-line CRUD app.\n\n"
                "### Tech Radar\n"
                "**Adopt:** PostgreSQL for almost everything, gRPC for service-to-service, "
                "OpenTelemetry for observability\n"
                "**Trial:** ClickHouse for analytics, Temporal for workflows, Zig for systems work\n"
                "**Hold:** MongoDB (unless you truly need schemaless), GraphQL (great for public APIs, "
                "overhead for internal), Kafka (often overkill — try Redis Streams first)"
            ),
        },
        "summary": "Architecture principles, tech radar, and design philosophy",
        "visibility": "public",
        "show_as_source": True,
    },
    # Skills — leadership & mentoring
    {
        "path": "/skills/leadership",
        "content": {
            "body": (
                "## Leadership & Mentoring\n\n"
                "### Engineering Leadership Style\n"
                "I'm a technical leader, not a people manager. I lead through code, architecture, "
                "and teaching — not through process and meetings.\n\n"
                "**What I do well:**\n"
                "- Turn ambiguous business requirements into clear technical plans\n"
                "- Unblock teams by making hard architectural decisions with conviction\n"
                "- Level up engineers through deep code reviews and pair programming\n"
                "- Write technical specs that people actually read\n\n"
                "**What I've learned about mentoring:**\n"
                "- Junior engineers need clear boundaries and fast feedback loops\n"
                "- Mid-level engineers need exposure to system-level thinking\n"
                "- Senior engineers need someone to challenge their assumptions\n"
                "- The best mentorship happens in code reviews, not meetings"
            ),
        },
        "summary": "Leadership style, mentoring approach, and team building philosophy",
        "visibility": "public",
        "show_as_source": True,
    },
    # Blog — more posts
    {
        "path": "/blog/scaling-postgres",
        "content": {
            "body": (
                "# PostgreSQL at Scale: What I Wish I Knew Earlier\n"
                "*2024-06-10*\n\n"
                "PostgreSQL can handle more than you think — if you know the tricks.\n\n"
                "## Connection management is everything\n"
                "PgBouncer in transaction mode. Period. Your app shouldn't hold connections while "
                "waiting for user input or making HTTP calls. We went from 500 connections to 50 "
                "and performance improved.\n\n"
                "## Partial indexes are magic\n"
                "`CREATE INDEX idx_active_orders ON orders(created_at) WHERE status = 'active';`\n"
                "This index is 1/100th the size of a full index and 10x faster for the query that matters.\n\n"
                "## EXPLAIN ANALYZE is your best friend\n"
                "Not EXPLAIN. EXPLAIN *ANALYZE*. The estimated costs lie. The actual row counts don't.\n\n"
                "## Don't fear the replication lag\n"
                "Read replicas with 100ms lag are fine for 90% of reads. Use `SET statement_timeout` "
                "to keep long queries from killing your primary.\n\n"
                "## Vacuum is not optional\n"
                "If you're not monitoring autovacuum, you have a ticking time bomb. "
                "We set `autovacuum_vacuum_cost_delay = 2ms` and never looked back."
            ),
        },
        "summary": "Blog post about PostgreSQL scaling — connections, indexing, replication",
        "visibility": "public",
        "show_as_source": True,
    },
    {
        "path": "/blog/startup-mistakes",
        "content": {
            "body": (
                "# 5 Infrastructure Mistakes Every Startup Makes\n"
                "*2024-09-22*\n\n"
                "After advising a dozen startups, I keep seeing the same patterns:\n\n"
                "## 1. Microservices on day one\n"
                "You have 3 engineers and 12 microservices. Each service has its own deploy pipeline, "
                "its own database, and its own on-call rotation. You spend more time on infra than product. "
                "**Start with a monolith.** Split when you hit a real scaling wall, not an imagined one.\n\n"
                "## 2. No observability until production is on fire\n"
                "Add structured logging, distributed tracing, and basic metrics from day one. "
                "The cost is trivial. The cost of not having them is a 3am debugging session with no data.\n\n"
                "## 3. DIY auth\n"
                "Don't build your own auth system. Use an established provider. I've seen two startups "
                "lose months to homegrown auth bugs that a library would have handled.\n\n"
                "## 4. Ignoring database migrations\n"
                "Your schema will change. Have a migration strategy before you have data you can't lose.\n\n"
                "## 5. Premature Kubernetes\n"
                "If you have fewer than 10 services, you probably don't need K8s. "
                "Docker Compose + a simple deploy script gets you surprisingly far."
            ),
        },
        "summary": "Blog post about common startup infrastructure mistakes",
        "visibility": "public",
        "show_as_source": True,
    },
    {
        "path": "/blog/ai-developer-tools",
        "content": {
            "body": (
                "# Building AI-Powered Developer Tools: Lessons from StandMeet\n"
                "*2025-01-15*\n\n"
                "StandMeet uses Claude as its AI backbone. Here's what I learned building "
                "AI features into a real product:\n\n"
                "## The prompt is your product\n"
                "Spend 80% of your time on prompt engineering. The difference between a good and "
                "bad prompt is the difference between a useful product and a toy.\n\n"
                "## Stream everything\n"
                "Users will wait 30 seconds for a streaming response but abandon after 5 seconds "
                "of a loading spinner. WebSocket + token streaming is non-negotiable.\n\n"
                "## MCP is a game changer\n"
                "Model Context Protocol lets AI connect to your data without you building custom "
                "integrations. We went from 2 weeks per integration to 2 hours.\n\n"
                "## Cost control matters\n"
                "API costs add up fast. Implement per-session message limits, cache common queries, "
                "and use smaller models for simple tasks. Our cost per conversation dropped 60% "
                "after implementing tiered model selection."
            ),
        },
        "summary": "Blog post about building AI developer tools — prompts, streaming, MCP, costs",
        "visibility": "public",
        "show_as_source": True,
    },
    # Talks & conferences
    {
        "path": "/talks/list",
        "content": {
            "body": (
                "## Conference Talks\n\n"
                "### KubeCon NA 2019 — \"Scheduling at Scale: Lessons from the Kubernetes Scheduler\"\n"
                "Deep dive into K8s scheduler internals, preemption strategies, and how we improved "
                "throughput by 3x. [Recording](https://youtube.com/example)\n\n"
                "### API World 2022 — \"API Versioning Without Tears\"\n"
                "How Stripe's API versioning system works under the hood. Covered version gates, "
                "compatibility testing, and migration tooling.\n\n"
                "### PyCon 2024 — \"FastMCP: Building High-Performance MCP Servers in Python\"\n"
                "Introduced the fastmcp framework. Live demo of building an MCP server in 50 lines "
                "of Python. [Slides](https://speakerdeck.com/example)\n\n"
                "### Local Meetups\n"
                "Regular speaker at SF Python, SF Go, and Bay Area Kubernetes meetups. "
                "Happy to speak at events — reach out via email."
            ),
        },
        "summary": "Conference talks and speaking experience",
        "visibility": "public",
        "show_as_source": True,
    },
    # Detailed project — fastmcp
    {
        "path": "/projects/fastmcp-detail",
        "content": {
            "body": (
                "## fastmcp — Deep Dive\n\n"
                "**High-performance MCP server framework for Python**\n"
                "GitHub: https://github.com/alexchen/fastmcp | ⭐ 2,400 | MIT License\n\n"
                "### Why I built it\n"
                "The official MCP SDK is great but low-level. Building a production MCP server "
                "required 200+ lines of boilerplate. fastmcp reduces that to ~20 lines.\n\n"
                "### Key features\n"
                "- Decorator-based tool/resource/prompt registration\n"
                "- Automatic schema generation from type hints\n"
                "- Built-in auth (OAuth, API keys)\n"
                "- Streaming support via SSE and WebSocket\n"
                "- Hot-reload in development\n\n"
                "### Architecture\n"
                "- Pure asyncio, no threads\n"
                "- ASGI-compatible — deploy with uvicorn, gunicorn, or any ASGI server\n"
                "- Middleware pipeline for auth, logging, rate limiting\n"
                "- ~3,000 lines of code, 95% test coverage\n\n"
                "### Adoption\n"
                "Used by 50+ companies including 3 YC startups. "
                "Featured in Anthropic's MCP ecosystem showcase."
            ),
        },
        "summary": "Deep dive into fastmcp — architecture, features, adoption",
        "visibility": "public",
        "show_as_source": True,
    },
    # Consulting — how I work
    {
        "path": "/consulting/how-i-work",
        "content": {
            "body": (
                "## How I Work\n\n"
                "### Engagement Structure\n"
                "1. **Free intro call (30 min)** — Understand your challenge. No sales pitch.\n"
                "2. **Discovery (2-3 days)** — Deep dive into your codebase, architecture, and team. "
                "I read code, run the system, and talk to engineers.\n"
                "3. **Execution** — Hands-on work. I write code, review PRs, and pair with your team. "
                "I don't hand you a PDF and disappear.\n"
                "4. **Handoff** — Written recommendations, architecture diagrams, and a knowledge transfer "
                "session so your team can maintain everything after I leave.\n\n"
                "### Communication\n"
                "- Daily async updates via Slack/Discord\n"
                "- Weekly sync calls (30 min)\n"
                "- Access to a private GitHub repo with all deliverables\n"
                "- I'm available for questions for 2 weeks after the engagement ends\n\n"
                "### What I Don't Do\n"
                "- Project management (you need a PM, not me)\n"
                "- Frontend pixel-pushing (I can architect, but I'm not a designer)\n"
                "- Ongoing maintenance contracts (I build it, teach your team, and leave)"
            ),
        },
        "summary": "How consulting engagements work — structure, communication, boundaries",
        "visibility": "public",
        "show_as_source": True,
    },
    # Consulting — FAQ
    {
        "path": "/consulting/faq",
        "content": {
            "body": (
                "## Frequently Asked Questions\n\n"
                "**Q: How soon can you start?**\n"
                "Typically 1-2 weeks out. For urgent performance issues, I can sometimes start within days.\n\n"
                "**Q: Do you work on-site?**\n"
                "Remote only. I'm based in SF but work with teams worldwide. All collaboration "
                "happens via Slack, GitHub, and video calls.\n\n"
                "**Q: Can you sign an NDA?**\n"
                "Yes, standard mutual NDA is fine. I sign one at the start of every engagement.\n\n"
                "**Q: What if we want to hire you full-time?**\n"
                "I'm not looking for full-time roles, but I offer retainer arrangements "
                "for ongoing advisory work.\n\n"
                "**Q: What's your tech stack preference?**\n"
                "I'm strongest with Python, Go, TypeScript, PostgreSQL, and Kubernetes. "
                "But architecture consulting is largely language-agnostic.\n\n"
                "**Q: Do you work with non-technical founders?**\n"
                "Absolutely. Part of my job is translating between business needs and technical solutions. "
                "I'll explain everything in plain English.\n\n"
                "**Q: How do I get started?**\n"
                "Book a free intro call: https://cal.com/alexchen/intro\n"
                "Or email: alex@example.com"
            ),
        },
        "summary": "Consulting FAQ — availability, remote work, NDA, getting started",
        "visibility": "public",
        "show_as_source": True,
    },
    # Personal — reading list
    {
        "path": "/personal/reading",
        "content": {
            "body": (
                "## Reading List\n\n"
                "### Books That Shaped My Thinking\n"
                "- **Designing Data-Intensive Applications** (Kleppmann) — The bible of distributed systems\n"
                "- **A Philosophy of Software Design** (Ousterhout) — Why deep modules beat shallow ones\n"
                "- **Staff Engineer** (Larson) — How to have impact without managing people\n"
                "- **The Manager's Path** (Fournier) — Even ICs should read this to understand their managers\n"
                "- **Thinking in Systems** (Meadows) — Mental models for understanding complex systems\n\n"
                "### Currently Reading\n"
                "- **Fundamentals of Software Architecture** (Richards & Ford)\n"
                "- **Build** (Tony Fadell) — Stories from building the iPod and Nest"
            ),
        },
        "summary": "Recommended books and current reading list",
        "visibility": "private",
        "show_as_source": True,
    },
    # Personal — life in SF
    {
        "path": "/personal/sf-life",
        "content": {
            "body": (
                "## Life in San Francisco\n\n"
                "I've lived in SF since graduating from MIT in 2018. Some favorites:\n\n"
                "**Coffee:** Sightglass (SoMa), Ritual (Mission), Red Bay (Oakland)\n"
                "**Climbing:** Dogpatch Boulders, Mission Cliffs, weekend trips to Castle Rock\n"
                "**Food:** Burma Superstar, Tartine, Bi-Rite Creamery\n"
                "**Running:** Morning runs along the Embarcadero. Did Bay to Breakers twice.\n\n"
                "I work from home most days but you'll find me at a coffee shop on Fridays."
            ),
        },
        "summary": "Life in San Francisco — coffee, climbing, food, routines",
        "visibility": "private",
        "show_as_source": True,
    },
    # Consulting services
    {
        "path": "/consulting/services",
        "content": {
            "body": (
                "## Consulting Services\n\n"
                "### Architecture Review & Design\n"
                "Deep-dive into your system architecture. Identify bottlenecks, single points of failure, "
                "and scaling risks. Deliver a written report with prioritized recommendations.\n"
                "**Typical engagement:** 1–2 weeks\n\n"
                "### API Platform Strategy\n"
                "Design or overhaul your public/internal API. Versioning strategy, rate limiting, "
                "authentication, SDK generation, and developer experience.\n"
                "**Typical engagement:** 2–4 weeks\n\n"
                "### Performance & Scalability\n"
                "Profile your system, identify hot paths, and implement optimizations. "
                "From database query tuning to connection pooling to caching layers.\n"
                "**Typical engagement:** 2–3 weeks\n\n"
                "### Team Mentorship & Code Review\n"
                "Embedded with your team for ongoing code reviews, architecture guidance, "
                "and engineering best practices. Great for leveling up junior/mid engineers.\n"
                "**Typical engagement:** 1–3 months, part-time"
            ),
        },
        "summary": "Consulting service offerings with descriptions and typical timelines",
        "visibility": "public",
        "show_as_source": True,
    },
    {
        "path": "/consulting/case-studies",
        "content": {
            "body": (
                "## Case Studies\n\n"
                "### Fintech Startup — API Redesign\n"
                "**Problem:** Series A fintech had a monolithic REST API that was blocking feature velocity. "
                "3 teams stepping on each other, no versioning, breaking changes every sprint.\n"
                "**Solution:** Designed a domain-driven API architecture with per-domain ownership, "
                "automated backward-compatibility checks in CI, and a versioning strategy.\n"
                "**Result:** Deploy frequency went from weekly → 4x/day. Zero breaking changes in 6 months.\n\n"
                "### E-commerce Platform — Performance Crisis\n"
                "**Problem:** Black Friday traffic was 10x normal load. System fell over at 3x.\n"
                "**Solution:** Profiled the hot path (checkout flow), added read replicas, "
                "connection pooling, and a Redis caching layer for product catalog.\n"
                "**Result:** Handled 15x normal traffic with p99 under 200ms. $0 downtime on Black Friday.\n\n"
                "### SaaS Company — Data Pipeline\n"
                "**Problem:** Analytics pipeline took 6 hours to run, blocking morning standups.\n"
                "**Solution:** Migrated from batch PostgreSQL queries to a streaming architecture "
                "with ClickHouse for analytics and incremental materialized views.\n"
                "**Result:** Near real-time analytics. Pipeline latency went from 6 hours to under 2 minutes."
            ),
        },
        "summary": "Real consulting case studies with problem/solution/result",
        "visibility": "public",
        "show_as_source": True,
    },
    {
        "path": "/consulting/pricing",
        "content": {
            "body": (
                "## Pricing\n\n"
                "### Project-Based\n"
                "Fixed-scope engagements with a clear deliverable.\n"
                "- Architecture review: $8,000–$15,000\n"
                "- API design/overhaul: $15,000–$30,000\n"
                "- Performance optimization: $12,000–$25,000\n\n"
                "### Retainer\n"
                "Ongoing advisory, code reviews, and architecture guidance.\n"
                "- Part-time (10 hrs/week): $6,000/month\n"
                "- Half-time (20 hrs/week): $11,000/month\n\n"
                "### Intro Call\n"
                "30-minute intro call is always free. No strings attached.\n"
                "Book at: https://cal.com/alexchen/intro\n\n"
                "*Prices are starting points — actual quote depends on scope and timeline.*"
            ),
        },
        "summary": "Consulting pricing — project-based and retainer options",
        "visibility": "public",
        "show_as_source": True,
    },
    {
        "path": "/consulting/testimonials",
        "content": {
            "body": (
                "## Client Testimonials\n\n"
                "> \"Alex joined us for 3 weeks and completely transformed our API strategy. "
                "Our developers went from dreading API changes to shipping them confidently. "
                "Best consulting money we ever spent.\"\n"
                "> — CTO, Series B Fintech\n\n"
                "> \"We were drowning in performance issues before our product launch. "
                "Alex identified the root cause in day one and had a fix deployed by day three. "
                "Calm, methodical, and incredibly effective.\"\n"
                "> — VP Engineering, E-commerce Platform\n\n"
                "> \"What sets Alex apart is that he doesn't just solve the problem — he teaches your team "
                "how to think about it so they can handle it next time. Our senior engineers "
                "leveled up noticeably during the engagement.\"\n"
                "> — Engineering Manager, SaaS Startup"
            ),
        },
        "summary": "Client testimonials and quotes about consulting work",
        "visibility": "public",
        "show_as_source": True,
    },
]


# ── Assets (demo placeholder files) ──

FIXTURES_DIR = Path(__file__).parent / "fixtures"

ASSETS = [
    {
        "path": "/images/avatar.jpg",
        "filename": "avatar.jpg",
        "file": "avatar.jpg",
        "mime_type": "image/jpeg",
        "visibility": "public",
    },
    {
        "path": "/images/banner.jpg",
        "filename": "banner.jpg",
        "file": "banner.jpg",
        "mime_type": "image/jpeg",
        "visibility": "public",
    },
    {
        "path": "/documents/resume.txt",
        "filename": "resume.txt",
        "content": b"Alex Chen - Full-Stack Engineer & Open Source Contributor\nSee /work/experience for details.",
        "mime_type": "text/plain",
        "visibility": "public",
    },
    {
        "path": "/documents/references.txt",
        "filename": "references.txt",
        "content": b"Professional references available upon request.\nContact alex@example.com",
        "mime_type": "text/plain",
        "visibility": "private",
    },
]


# ── Roles ──

ROLES = [
    {
        "name": "general",
        "prompt": (
            "You are speaking on behalf of Alex Chen. "
            "Be helpful and informative. Share public information freely."
        ),
        "permissions": [
            {"action": "allow", "path_pattern": "/**"},
        ],
    },
    {
        "name": "recruiter",
        "prompt": (
            "You are speaking to a recruiter on behalf of Alex Chen. "
            "Focus on professional experience, skills, and projects. "
            "Do not share personal interests or private notes."
        ),
        "permissions": [
            {"action": "deny", "path_pattern": "/personal/**"},
            {"action": "deny", "path_pattern": "/private/**"},
            {"action": "allow", "path_pattern": "/**"},
        ],
    },
    {
        "name": "friend",
        "prompt": (
            "You are chatting with a friend of Alex Chen. "
            "Be casual and warm. Feel free to share personal interests and hobbies."
        ),
        "permissions": [
            {"action": "deny", "path_pattern": "/private/**"},
            {"action": "allow", "path_pattern": "/**"},
        ],
    },
    {
        "name": "read-only-profile",
        "prompt": "You can only share basic profile information. For anything else, suggest they reach out directly.",
        "permissions": [
            {"action": "allow", "path_pattern": "/profile/**"},
        ],
    },
    {
        "name": "sales",
        "prompt": (
            "You are Alex Chen's sales AI. Your job is to help potential clients understand "
            "Alex's consulting services and guide them toward booking an intro call. "
            "Be confident, specific, and outcome-oriented."
        ),
        "permissions": [
            {"action": "deny", "path_pattern": "/private/**"},
            {"action": "deny", "path_pattern": "/personal/**"},
            {"action": "allow", "path_pattern": "/**"},
        ],
    },
]


# ── Skills (non-builtin, populated for demo) ──

SKILLS = [
    {
        "name": "Sales Consultant",
        "description": "AI sells the owner's consulting services to potential clients",
        "prompt": (
            "You are a persuasive but authentic sales representative for the owner's consulting services. "
            "Your goal is to understand the visitor's technical challenges and demonstrate how the owner's "
            "expertise can solve them.\n\n"
            "## Sales approach:\n"
            "1. **Discover** — Ask about their current challenges, team size, tech stack, and timeline. "
            "Listen actively before pitching.\n"
            "2. **Connect** — Match their pain points to the owner's specific experience. Use concrete examples: "
            "\"At Stripe, Alex solved a similar problem by...\" Don't be generic.\n"
            "3. **Prove** — Reference real projects, metrics, and outcomes from the owner's profile. "
            "Numbers beat adjectives: \"reduced p99 latency by 40%\" > \"improved performance\".\n"
            "4. **Propose** — Suggest a concrete engagement: a specific deliverable, rough timeline, and next step. "
            "Always recommend booking a free intro call at https://cal.com/alexchen/intro.\n\n"
            "## Tone:\n"
            "- Confident but not pushy. You're a trusted advisor, not a used car salesman.\n"
            "- Acknowledge when something is outside the owner's wheelhouse — honesty builds trust.\n"
            "- Use the visitor's language (if they say \"microservices\" don't correct to \"distributed systems\").\n"
            "- End conversations with a clear CTA: book a call, "
            "email alex@example.com, or ask a follow-up question.\n\n"
            "## Important:\n"
            "- Always look up /consulting/* content before answering "
            "questions about services, pricing, or case studies.\n"
            "- Quote specific numbers from case studies "
            "(\"handled 15x traffic\", \"pipeline from 6 hours to 2 minutes\").\n"
            "- When discussing pricing, mention the free intro call — lower the barrier to next step."
        ),
    },
]


# ── Invite Codes ──

INVITES = [
    {
        "code": "sm_demo_general",
        "label": "Demo (General)",
        "role": "general",
        "skills": ["Resume / Portfolio", "Conversation Report"],
        "greeting": "Hi! I'm Alex's AI assistant. What would you like to know about me?",
    },
    {
        "code": "sm_demo_recruiter",
        "label": "Demo (Recruiter)",
        "role": "recruiter",
        "prompt": (
            "Focus on highlighting technical achievements and leadership experience. "
            "Always suggest scheduling a call for detailed discussions."
        ),
        "skills": ["Resume / Portfolio", "Code Review", "Conversation Report"],
        "max_messages_per_session": 30,
        "greeting": (
            "Hello! I'm here to help you learn about Alex's professional background. "
            "Feel free to ask about experience, skills, or projects."
        ),
    },
    {
        "code": "sm_demo_friend",
        "label": "Demo (Friend)",
        "role": "friend",
        "skills": ["Frontend Design", "Conversation Report"],
        "greeting": "Hey! Ask me anything about Alex — hobbies, projects, whatever you're curious about.",
    },
    {
        "code": "sm_demo_limited",
        "label": "Demo (Profile Only)",
        "role": "read-only-profile",
        "max_messages_per_session": 10,
    },
    {
        "code": "sm_demo_trial",
        "label": "Demo (Trial — 50 uses, 7 days)",
        "role": "general",
        "max_uses": 50,
        "expires_in_days": 7,
        "max_messages_per_session": 20,
        "prompt": "This is a trial invite. Be helpful but concise — keep answers short.",
        "skills": ["Resume / Portfolio"],
    },
    {
        "code": "sm_demo_sales",
        "label": "Demo (Sales)",
        "role": "sales",
        "skills": ["Sales Consultant", "Conversation Report"],
        "prompt": (
            "You are Alex Chen's sales AI. Your mission: understand the visitor's pain points "
            "and show how Alex's consulting can solve them. Always look up Alex's content "
            "(especially /consulting/*, /work/*, /projects/*) before answering. "
            "Lead with specific results and case studies, not generic claims. "
            "Guide every conversation toward booking a free intro call."
        ),
        "greeting": (
            "Hi! I'm Alex's AI assistant. I can tell you about Alex's consulting services — "
            "architecture reviews, API design, performance optimization, and more. "
            "What technical challenges is your team facing?"
        ),
    },
]


# ── System prompt ──

SYSTEM_PROMPT = (
    "You are an AI assistant representing Alex Chen on their StandMeet profile. "
    "Use the available tools to look up Alex's information before answering questions. "
    "Be accurate — only share information that you can find in the content repository. "
    "If you don't know something, say so honestly rather than making things up."
)


class Command(BaseCommand):
    help = "Populate demo content, roles, and invite codes for manual testing"

    def handle(self, *args, **options):
        self._populate_settings()
        self._populate_content()
        self._populate_assets()
        self._populate_skills()
        role_map = self._populate_roles()
        self._populate_invites(role_map)

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("=== Demo data populated ==="))
        self.stdout.write("")
        self.stdout.write("Invite codes for testing:")
        for inv in INVITES:
            parts = [f"  {inv['code']}  →  {inv['label']}"]
            if inv.get("skills"):
                parts.append(f"    skills: {', '.join(inv['skills'])}")
            if inv.get("greeting"):
                parts.append(f"    greeting: {inv['greeting'][:60]}...")
            if inv.get("prompt"):
                parts.append(f"    prompt: {inv['prompt'][:60]}...")
            if inv.get("max_messages_per_session"):
                parts.append(f"    message limit: {inv['max_messages_per_session']}")
            if inv.get("max_uses"):
                parts.append(f"    max uses: {inv['max_uses']}")
            if inv.get("expires_in_days"):
                parts.append(f"    expires in: {inv['expires_in_days']} days")
            self.stdout.write("\n".join(parts))
        self.stdout.write("")

    def _populate_settings(self):
        settings = SiteSettingsModel.load()
        if not settings.ai_system_prompt:
            settings.ai_system_prompt = SYSTEM_PROMPT
            self.stdout.write("  Set system prompt")
        else:
            self.stdout.write("  System prompt already set, skipping")

        # Populate IM integrations from env vars
        extra = settings.extra or {}
        im = extra.get("im_integrations", {})

        discord_token = os.environ.get("DISCORD_BOT_TOKEN", "")
        discord_app_id = os.environ.get("DISCORD_APPLICATION_ID", "")
        if discord_token:
            im["discord"] = {
                "enabled": True,
                "bot_token": discord_token,
                "application_id": discord_app_id,
            }
            self.stdout.write("  Discord config set from env")
        else:
            self.stdout.write("  DISCORD_BOT_TOKEN not set, skipping Discord")

        telegram_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
        if telegram_token:
            im["telegram"] = {
                "enabled": True,
                "bot_token": telegram_token,
            }
            self.stdout.write("  Telegram config set from env")
        else:
            self.stdout.write("  TELEGRAM_BOT_TOKEN not set, skipping Telegram")

        extra["im_integrations"] = im
        settings.extra = extra
        settings.save()

    def _populate_content(self):
        for item in CONTENT:
            _, created = ContentEntryModel.objects.update_or_create(
                path=item["path"],
                defaults={
                    "content": item["content"],
                    "summary": item["summary"],
                    "visibility": item.get("visibility", "private"),
                    "show_as_source": item.get("show_as_source", True),
                },
            )
            status = "created" if created else "updated"
            self.stdout.write(f"  Content {item['path']} — {status}")

    def _populate_assets(self):
        storage = MinioAssetStorage()
        for item in ASSETS:
            if "file" in item:
                data = (FIXTURES_DIR / item["file"]).read_bytes()
            else:
                data = item["content"]
            obj, created = AssetModel.objects.update_or_create(
                path=item["path"],
                defaults={
                    "filename": item["filename"],
                    "size": len(data),
                    "mime_type": item["mime_type"],
                    "visibility": item.get("visibility", "private"),
                },
            )
            storage.upload(item["path"], data, item["mime_type"])
            status = "created" if created else "updated"
            self.stdout.write(f"  Asset {item['path']} — {status}")

    def _populate_skills(self):
        for skill_data in SKILLS:
            _, created = SkillModel.objects.update_or_create(
                name=skill_data["name"],
                defaults={
                    "description": skill_data["description"],
                    "prompt": skill_data["prompt"],
                },
            )
            status = "created" if created else "updated"
            self.stdout.write(f"  Skill '{skill_data['name']}' — {status}")

    def _populate_roles(self) -> dict[str, RoleModel]:
        role_map = {}
        for role_data in ROLES:
            role, created = RoleModel.objects.get_or_create(
                name=role_data["name"],
                defaults={"prompt": role_data.get("prompt", "")},
            )
            if not created:
                role.prompt = role_data.get("prompt", "")
                role.save()

            # Recreate permissions
            PathPermissionModel.objects.filter(role=role).delete()
            for i, perm in enumerate(role_data["permissions"]):
                PathPermissionModel.objects.create(
                    role=role,
                    action=perm["action"],
                    path_pattern=perm["path_pattern"],
                    order=i,
                )

            role_map[role_data["name"]] = role
            status = "created" if created else "updated"
            self.stdout.write(f"  Role '{role_data['name']}' — {status}")

        return role_map

    def _populate_invites(self, role_map: dict[str, RoleModel]):
        for inv in INVITES:
            expires_at = None
            if inv.get("expires_in_days"):
                expires_at = timezone.now() + timedelta(days=inv["expires_in_days"])

            defaults = {
                "label": inv["label"],
                "role": role_map.get(inv.get("role", "")),
                "is_active": True,
                "prompt": inv.get("prompt", ""),
                "greeting": inv.get("greeting", ""),
                "max_uses": inv.get("max_uses"),
                "max_messages_per_session": inv.get("max_messages_per_session"),
                "expires_at": expires_at,
            }

            obj, created = InviteCodeModel.objects.update_or_create(
                code=inv["code"],
                defaults=defaults,
            )

            # Bind skills (M2M — set after save)
            skill_names = inv.get("skills", [])
            if skill_names:
                skills = SkillModel.objects.filter(name__in=skill_names)
                obj.skills.set(skills)

            status = "created" if created else "updated"
            extras = []
            if inv.get("greeting"):
                extras.append("greeting")
            if inv.get("prompt"):
                extras.append("prompt")
            if inv.get("max_messages_per_session"):
                extras.append(f"limit={inv['max_messages_per_session']}")
            if inv.get("max_uses"):
                extras.append(f"max_uses={inv['max_uses']}")
            if inv.get("expires_in_days"):
                extras.append(f"expires={inv['expires_in_days']}d")
            if skill_names:
                extras.append(f"skills={skill_names}")
            extra_str = f" ({', '.join(extras)})" if extras else ""
            self.stdout.write(f"  Invite {inv['code']} — {status}{extra_str}")
