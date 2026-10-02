# How OpenClaw Spread: A Communication-Studies Breakdown

## Abstract

OpenClaw reached 250k+ stars in 60 days. This document does not discuss "why it is good". It uses communication-theory frameworks to analyse "why it spread" — from diffusion of innovations, the two-step flow, framing, and social proof through to the dynamics of controversy — and takes apart, layer by layer, the communication mechanism behind each growth stage.

---

## Growth timeline (referenced below)

| Stage | Time | Stars | Key events |
|------|------|-------|---------|
| Seed | 2025.11 | ~a few hundred | Clawdbot released |
| Controversy | 2025.12 | ~a few thousand | Anthropic trademark dispute, renamed to Moltbot |
| Rename | 2026.01 | ~9,000 | Settled on the name OpenClaw, intensive development |
| Breakout | 2026.02 | 9k→210k | +200k in 10 days |
| Media | 2026.02-03 | 210k→250k | TechCrunch, Lex Fridman, Fortune |
| Steady state | 2026.03- | 270k+ | Passed React, security crisis |

---

## 1. Diffusion of Innovations (Rogers, 1962)

Everett Rogers's diffusion of innovations theory says that whether an innovation is adopted depends on five attributes. We check them one by one:

### 1. Relative Advantage

```
Existing options:                  OpenClaw:
ChatGPT → data in the cloud        → data stays local
Ollama → chat only                 → can carry out actions
Siri → not customisable            → fully open source
LangChain → you have to write code → just npm install
```

The relative advantage is not a single breakthrough; it is **being better on several dimensions at once**. Rogers says the larger the relative advantage, the faster the adoption. OpenClaw beats each competitor on a different dimension, so it appeals to the user base of every competitor — which enlarges the total pool of potential adopters.

### 2. Compatibility

This is OpenClaw's most underrated communication attribute.

> **It does not ask you to change any existing behaviour.**

You use Telegram? It lives in your Telegram. You use Discord? It lives in your Discord. You use WhatsApp? Same.

Rogers defines compatibility as "the degree to which an innovation is perceived as consistent with the existing values, past experiences, and needs of potential adopters". OpenClaw's support for 24 channels is not a feature — **it is compatibility maximised, in the communication-studies sense**.

Compared with AI tools that make you download a new app, register a new account and learn a new interface, OpenClaw's adoption cost is close to zero. You do not need to change any habit; you only add one more contact in a tool you already use.

### 3. Complexity — inverted

```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

Two commands. An interactive wizard guides the configuration. The first conversation happens within 5 minutes.

Rogers says complexity is inversely related to the adoption rate. OpenClaw cut the complexity of self-hosted AI from "you need to set up Docker + a database + a reverse proxy + SSL" down to "two commands".

### 4. Trialability

After install you chat directly in the browser at `http://127.0.0.1:18789`. No channel needs configuring.

**Zero-config trial → see the value → then decide whether to connect Telegram/Discord.**

Rogers says the higher the trialability and the lower the cost of trial and error, the faster the adoption. WebChat as a zero-barrier entry point is a textbook case of product design serving trialability.

### 5. Observability

This is the cleverest part of how OpenClaw spread.

The problem with traditional developer tools is that **the act of using them is invisible** — you use a good ORM and nobody else sees it. But OpenClaw's usage is visible by nature:

- You ask your AI something in a Telegram group chat, and everyone else in the group sees it
- You screenshot your AI replying to you in WhatsApp and post it on Twitter
- You show off your AI's skills in a Discord server, and the server members see it

**Each of the 24 channels is an amplifier of observability.** Users' everyday use is itself a showcase. It is the same mechanism as Hotmail adding "Get your free email at Hotmail" to the bottom of every email — using the product is spreading the product.

### Rogers's S-curve prediction

Rogers's model predicts that innovation diffusion follows an S-curve: slow start → take-off → rapid growth → saturation.

```
Stars
270k ─────────────────────────────── ·····→
       │                           ╱
210k ─ │                         ╱   ← Media (TechCrunch/Lex Fridman drive the late majority)
       │                       ╱
       │                     ╱       ← Breakout (GitHub Trending triggers herd behaviour)
 60k ─ │                   ╱
       │                 ╱
  9k ─ │            ···╱             ← Rename (brand established, early majority starts watching)
       │        ···
  ~0 ─ │····                         ← Seed + Controversy (innovators + early adopters)
       └──────────────────────────
       Nov   Dec   Jan   Feb    Mar
```

OpenClaw's S-curve is unusually steep — from seed to take-off took only about 3 months. A typical open-source project needs 1-3 years for this stage (React took about 2 years, Docker about 1 year).

The reason is not only that the product is good. The frameworks below explain why the curve is so steep.

---

## 2. Two-Step Flow and Opinion Leaders (Katz & Lazarsfeld, 1955)

### The classic two-step flow model

```
Mass media → opinion leaders → general audience
```

Katz & Lazarsfeld proposed in 1955 that information does not flow directly from the media to the public; it first reaches "opinion leaders", who then influence the people around them.

### OpenClaw's spread was actually three-step

```
Step 1: Peter's personal network
   Peter (PSPDFKit founder, KOL in the iOS community)
      → his Twitter followers (high-quality developers)
      → the iOS/macOS developer community

Step 2: spread through developer opinion leaders
   Early-adopting developers
      → write analysis blog posts (technical articles on Medium)
      → share in their own Discord servers / Telegram groups
      → tweet thanks after submitting a PR

Step 3: mass-media amplification
   TechCrunch / Fortune / Lex Fridman / 36kr
      → non-developer tech enthusiasts
      → investors, product managers, founders
      → the broad tech crowd who "have heard of it but won't necessarily use it"
```

**Key insight: Peter himself is the first-step opinion leader.**

Lazarsfeld defines an opinion leader by these traits: (1) seen as competent in a field, (2) socially active, (3) actively passes information on. As the founder of PSPDFKit, Peter fits all three in the iOS developer community.

This means OpenClaw skipped the cold-start problem most open-source projects face — it did not need to wait for the mass media to notice it; the founder himself was the distribution channel.

### Opinion-leader density and speed of spread

530 contributors joined within 3 weeks. Contributors to an open-source project are usually the most active 1-5% of the wider user base. At an estimate of 2%, 530 contributors imply about 26,500 active users.

How many of these contributors are opinion leaders in their own communities? Open-source contributors already have the opinion-leader traits Lazarsfeld defines — they are technically strong, socially active (active on GitHub), and spread information actively (submitting a PR is itself an act of spreading).

**Every contributor is a node in the two-step flow. With 530 nodes activated at the same time within 3 weeks, the speed of spread grows exponentially.**

---

## 3. Framing and Agenda Setting (Entman, 1993; McCombs & Shaw, 1972)

### OpenClaw's frame is not "yet another AI tool"

Entman defines framing as "selecting some aspects of a perceived reality and making them more salient in a communicating text". OpenClaw's communication frame was rebuilt three times:

**Frame 1: Seed — "a personal AI assistant"**
```
Core narrative: you can own your own AI assistant, on your own device
Emphasised: privacy, running locally, autonomy
Omitted: technical complexity, needing an API key, needing a server
```

**Frame 2: Breakout — "a product of vibe coding"**
```
Core narrative: one person used AI to build a project bigger than big-team projects
Emphasised: Peter's way of working, what AI-assisted development makes possible
Omitted: Peter's ten years of engineering experience, his PSPDFKit background
```

**Frame 3: Media — "a new paradigm for the AI era"**
```
Core narrative: an Austrian developer built a project that passed React and got hired by OpenAI
Emphasised: the star count, the narrative tension of passing React, individual heroism
Omitted: security problems, doubts about sustainability, actual user retention
```

### The levels of agenda setting

McCombs & Shaw's agenda-setting theory has two levels:
- **First level**: the media tell you "what to pay attention to" (OpenClaw exists and is worth attention)
- **Second level**: the media tell you "how to think about it" (OpenClaw = a win for the individual developer / a sign of the AI era)

Every wave of media coverage was doing agenda setting:

| Outlet | First level (what to attend to) | Second level (how to think) |
|------|-----------------|----------------|
| TechCrunch | OpenClaw exists | Peter is a builder worth learning from |
| Fortune | Peter hired by OpenAI | He must be very good → the project must be good |
| Lex Fridman | The philosophy of AI development | "Vibe coding is a slur" — this is serious engineering |
| 36kr | OpenClaw enters China's field of view | 80% of apps will disappear |

**Each outlet repackaged OpenClaw's story in its own frame, but all of them did the same thing — put OpenClaw on the public agenda.**

---

## 4. Social Proof and Conformity (Cialdini, 1984)

### The social-proof cascade of GitHub stars

Cialdini's principle of Social Proof: when uncertain, people look at what others do to decide what to do themselves.

A GitHub star is the most direct social-proof signal in the open-source world. But stars do not spread linearly — they cascade:

```
Stage 1 (< 1k stars)
  Signal: "someone is using it"
  Adopters: people who need this feature (feature-driven)

Stage 2 (1k-10k stars)
  Signal: "lots of people are using it"
  Adopters: people who follow tech trends (trend-driven)

Stage 3 (10k-100k stars)
  Signal: "if you don't know this, you're behind"
  Adopters: people afraid of missing out (FOMO-driven)

Stage 4 (> 100k stars)
  Signal: "this is a phenomenon"
  Adopters: non-technical people start paying attention too (media-driven)
  Starring detaches from use — many people star it but never install it
```

**OpenClaw went from stage 1 to stage 4 in about 2 months.** A normal project gets stuck in stage 2 for a long time (1k-10k is the hardest band to cross), because it has to switch from a "feature-driven" to a "trend-driven" audience.

Why didn't OpenClaw get stuck in stage 2? Because Peter's personal brand (the first step of the two-step flow) pushed it straight to the threshold of stage 2, and the Anthropic trademark dispute (analysed in the next section) supplied the acceleration to cross into stage 3.

### The anchoring effect of "passing React"

> "OpenClaw has more stars than React. React took 10 years."

This is not a technical fact (star count is not project quality), but as a social-proof signal it is extremely effective. Tversky & Kahneman's Anchoring effect: people rely too heavily on the first piece of information they receive when they make a judgement.

"Passing React" anchored OpenClaw in the cognitive position of "on the same level as React". Every later discussion unfolded from that anchor — even critics had to first concede "it does have more stars than React" before starting their rebuttal.

---

## 5. Controversy as a Communication Dynamic

### The trademark dispute: a textbook case of the Streisand effect

```
Clawdbot → Anthropic says trademark infringement → renamed Moltbot → finally named OpenClaw
```

From a communication-studies angle, this dispute had every element of news value (Galtung & Ruge's 1965 theory of news values):

- **Conflict**: small developer vs big company
- **Reference to Elite**: Anthropic is a leading company in AI
- **Unexpectedness**: a side project caught a big company's attention
- **Narrative**: the David vs Goliath story template

**The controversy itself spread better than the project.** Many people learned of OpenClaw because "Anthropic made an open-source project change its name", not because of OpenClaw's features.

This is the classic Streisand effect — an attempt to suppress information ends up amplifying it. Anthropic may never have meant to "suppress" anything, but the public perception was "a big company bullying a small developer", and that narrative spreads extremely well.

### "Vibe coding is a slur": the dynamics of a controversial statement

In an interview, Peter said the term "vibe coding" is a "slur" (a derogatory term).

From a framing-analysis angle, this statement did three things precisely:

1. **It created an arguable proposition.** Not everyone agrees that "vibe coding is a slur" — some think he is right, some think he is too sensitive. Both sides have to repost his original words to argue → spread.

2. **It redefined his own work.** From "vibe coder" to "AI-assisted engineer", Peter pulled himself out of a possibly derogatory category and placed himself in a more dignified frame.

3. **It gave the media a headline.** "OpenClaw creator says 'vibe coding' has become a slur" (AOL's actual headline). A controversial statement has built-in headline value.

Noelle-Neumann's (1974) spiral of silence applies here: people holding the view that "vibe coding is positive" were forced either to come out and defend it or to stay silent. Both reactions amplified Peter's voice — defenders spread the original message, and the silent let Peter's frame become the default frame.

---

## 6. Network Effects and the Strength of Weak Ties (Granovetter, 1973)

### What the 24 channels mean in network topology

Granovetter's "strength of weak ties" theory says: new information is more likely to spread through weak ties (acquaintances) than through strong ties (close friends), because people with strong ties hold highly overlapping information.

What does OpenClaw's support for 24 channels mean in network topology?

```
                    ┌── Telegram tech groups ──── Russian-speaking developers
                    │
        OpenClaw ───┼── Discord servers ──── gaming/mod communities
                    │
                    ├── WhatsApp groups ──── non-technical users, family groups
                    │
                    ├── Slack workspaces ──── inside companies
                    │
                    ├── Feishu ──── Chinese business users
                    │
                    ├── Line ──── users in Japan/Taiwan
                    │
                    ├── Zalo ──── users in Vietnam
                    │
                    └── Matrix ──── privacy-geek communities
```

**Each channel connects to a different social network. The links between these networks are "weak ties".**

A developer in a Telegram tech group and a user in a WhatsApp family group have no direct connection. But OpenClaw lives in both networks at once, so **it becomes the bridge of a weak tie itself**.

What this means for efficiency of spread: a traditional tool spreads within one network (a Slack-only tool, for example, spreads only among Slack users), while OpenClaw spreads in 24 relatively independent networks at once. The reach is not 24 times larger — because information travels far more efficiently across weak ties than by repetition inside strong ties, the actual effect is exponential.

### Geographic and cultural penetration

Note the non-English markets covered in the channel list:

| Channel | Main market | What it means for spread |
|---------|---------|---------|
| Feishu | China | Bypasses GitHub's visibility problem in China |
| Line | Japan, Taiwan, Thailand | Enters East Asian markets outside China |
| Zalo | Vietnam | Enters the Southeast Asian market |
| Nostr | Global decentralised communities | Enters the crypto/Web3 community |
| IRC | Old-school hacker communities | Enters the fundamentalist open-source community |

**Each channel is not just a technical integration; it is a cultural entry point.** 36kr did not cover OpenClaw because TechCrunch covered it first — it covered it because Feishu support put OpenClaw directly in front of Chinese developers.

---

## 7. Narrative Transportation and Myth Building (Barthes, 1957; Green & Brock, 2000)

### Peter Steinberger's hero narrative

Roland Barthes says that behind every cultural phenomenon there is a "myth" — not a false story, but a naturalised ideology.

The myth structure behind OpenClaw:

```
Hero:     an Austrian indie developer (individual vs system)
Trial:    a big company's trademark dispute (David vs Goliath)
Weapon:   the AI agent (the magic tool of a new era)
Feat:     passing React (a quantified victory)
Reward:   hired by OpenAI (final recognition from the industry)
Moral:    one person + AI can do what a team cannot
```

This narrative structure fits Joseph Campbell's Hero's Journey template perfectly. Green & Brock's Narrative Transportation theory says: when an audience is "transported" into a narrative, its attitudes and beliefs move in the narrative's direction.

**People are not only using OpenClaw — they are consuming a narrative.** Starring a project, reposting Peter's interviews, copying his way of working in their own projects — the drive behind these actions does not come entirely from functional need; much of it comes from identifying with the narrative.

"I too can do something big alone with AI, like Peter" — that is the core temptation of this myth.

### Why this narrative worked in 2026

Barthes says the function of myth is to "naturalise" social relations. In early-2026 tech culture there were several anxieties that needed "naturalising":

| Anxiety | The "antidote" the Peter narrative offers |
|------|---------------------|
| "AI will replace programmers" | → "No, Peter proved the human + AI collaboration model" |
| "Individual developers have no chance any more" | → "Wrong, Peter alone outdid a big team" |
| "Open source doesn't make money" | → "Peter got hired by OpenAI on a big salary" |
| "Privacy is hopeless" | → "You can run your own AI locally" |

**OpenClaw spread not only because it is useful, but because its existence eased a set of social anxieties.** Every star is a small ritual of anxiety relief.

---

## 8. (thanks @xxx): Reciprocity and Identity

### The reciprocity principle (Cialdini, 1984)

The way Peter handled community PRs deserves its own analysis from a communication-studies angle.

He does not merge PRs directly — he rewrites the code into main and adds `(thanks @username)` to the commit message.

Cialdini's reciprocity principle says: when a person receives a favour, they feel obliged to return it. Peter's approach cleverly reverses the direction of reciprocity:

```
Reciprocity in traditional open source:
  contributor gives code → maintainer accepts → maintainer owes the contributor (should give credit)

Peter's reciprocity:
  contributor submits a PR → Peter rewrites + thanks → contributor feels valued
  → now the contributor owes Peter (he spent time rewriting my code + thanked me publicly)
  → contributor is more willing to keep contributing + promote it publicly
```

`(thanks @xxx)` is not passive credit — it is an active social gift. 223 of 3057 commits carry a thank-you. Each thank-you establishes a reciprocal relationship.

### Social identity and group belonging

`(thanks @xxx)` also does something else: **it builds group identity**.

The thanked contributors form an implicit group — "people Peter has thanked". This group has a clear entry condition (get a PR accepted) and a visible badge (the `thanks @` mark in the commit history).

Tajfel & Turner's (1979) social identity theory says: people define themselves through group belonging. Being thanked by OpenClaw = being recognised by a 270k-star project = a form of identity capital.

**Part of what drives contributors to promote OpenClaw is maintaining this identity capital.** "I contributed code to OpenClaw" has value on a developer's résumé, provided OpenClaw stays popular. So contributors have a reason to help OpenClaw stay popular.

This is a self-reinforcing identity loop.

---

## 9. Risk Communication in the Security Crisis (Kasperson et al., 1988)

### The Social Amplification of Risk Framework (SARF)

Kasperson et al. proposed the "social amplification of risk framework": risk events are amplified or attenuated by social processes, and the final social impact can be far larger or far smaller than the direct impact.

OpenClaw's security-crisis data:
- 8 critical/high CVEs
- 42,665 exposed instances (93.4% with authentication bypassed)
- ~900 malicious ClawHub skills (20% of the registry)

Analysed through SARF:

**Amplifying factors**:
- Media headlines tend to amplify ("Security Nightmare", "Data Breach Waiting to Happen")
- Big numbers are amplifiers in themselves (42k exposed instances hits harder than "has security vulnerabilities")
- A competitor (IronClaw) used the crisis for comparative marketing, amplifying the perceived risk further

**Attenuating factors**:
- Those affected are technical users who can assess the risk themselves
- Peter and the community fixed things fast (consistent with OpenClaw's rapid iteration pace)
- "42k exposed instances" inversely proves the size of the user base — to potential users that is a social-proof signal
- Open source is itself a trust mechanism — "you can read the code and change it yourself"

### A counter-intuitive conclusion

The security crisis had a **net positive** effect on OpenClaw's spread:

```
Direct loss: some security-sensitive users gave up → perhaps X users lost
Indirect gains:
  1. Crisis coverage is free exposure in itself → more people know OpenClaw
  2. Forks like IronClaw enlarged the ecosystem instead of splitting the users
  3. "The security issues need fixing" drew in more contributors
  4. 42k instances → social proof → more new users
```

Kasperson says the social amplification of risk can produce a "ripple effect" whose reach goes far beyond the event itself. OpenClaw's security crisis did produce ripples — but the ripples carried OpenClaw to more people.

---

## 10. The Technology Acceptance Model (Davis, 1989)

### The two core variables of TAM

Fred Davis's Technology Acceptance Model says whether users adopt a new technology depends on two factors:

**Perceived Usefulness**: how much users believe using the technology will improve their job performance.

**Perceived Ease of Use**: how easy users believe the technology is to use.

OpenClaw hit extreme values on both dimensions at once:

| Dimension | OpenClaw's design | Effect on adoption |
|------|---------------|-------------|
| Perceived usefulness | "One more AI contact in the app you already use" — no need to imagine a use case | Maps directly onto existing needs |
| Perceived ease of use | Two-command install, wizard guidance, works in the browser right away | Almost removes the psychological barrier of "learning to use it" |

### The version number as a perception signal

The version format `v2026.3.8` has a special meaning under the TAM framework:

It sends two perception signals at once:
1. **Perceived usefulness**: a date-based version suggests "updated every day" → "problems get fixed fast" → "I can rely on it"
2. **Perceived ease of use**: a date is more intuitive than a semantic version → "no need to understand semver to decide whether to update"

---

## 11. Summary: The Stacking of Communication Mechanisms

OpenClaw's spread is not the result of one mechanism; it is the result of **several communication mechanisms stacking up across different stages**.

| Stage | Dominant mechanism | Theoretical framework |
|------|------------|---------|
| Seed | Radiation from Peter's personal network | Two-step flow (Katz & Lazarsfeld) |
| Controversy | The trademark dispute ignites the topic | Agenda setting (McCombs) + Streisand effect |
| Rename | Brand established + GitHub Trending | Social-proof cascade (Cialdini) |
| Breakout | Network penetration through 24 channels | Strength of weak ties (Granovetter) |
| Media | Hero narrative + mass-media amplification | Narrative transportation (Green & Brock) + framing (Entman) |
| Steady state | Contributor identity + security-crisis ripples | Social identity theory (Tajfel) + SARF (Kasperson) |

**No single factor explains 250k stars in 60 days.** These mechanisms stacked at the right moments, in the right order, and produced a phase transition.

### A counterfactual test

What would growth look like with each factor removed?

| Remove | Likely result |
|---------|-----------|
| Peter's personal brand | Stuck at 1k-10k stars (unable to cross the chasm from early adopters to the early majority) |
| The Anthropic trademark dispute | A flatter growth curve (without the acceleration from controversy exposure) |
| The 24 channels | Spread confined to a single social network (perhaps popular only among developers) |
| Media coverage | Stays at GitHub Trending level (10-50k stars) |
| The security crisis | One fewer round of free exposure, but also less loss of trust → net effect uncertain |
| AI-assisted iteration speed | The flywheel never spins up, PRs are handled slowly → contributors leave → stalls at 50k |

**The least replaceable factors are Peter's personal brand + AI-assisted iteration speed.** The first supplied the quality of seed users a cold start needs; the second supplied the fuel that kept the flywheel turning. The other factors are accelerators, but without these two foundations there is nothing for the accelerators to accelerate.

---

## Lessons for Building Products

### 1. Channel strategy is a distribution decision, not a feature decision

The ROI of multi-channel support should not be measured as "how many users use this channel", but as "which previously unreachable social network this channel opens for us". Integrating Zalo is not for 100 users in Vietnam — it is for entering an entirely new communication network.

### 2. Controversy can be designed

"Vibe coding is a slur" is unlikely to have been improvised — it is a precise controversial statement that meets every condition spread requires (arguable, takes a stance, has headline value). The point is not to manufacture controversy on purpose, but: if controversy is coming, make sure it happens inside your frame.

### 3. Opinion-leader density > total users

530 contributors (high-quality spreading nodes) are worth more for spread than 50,000 people who star without using. If you can optimise only one metric, choose "how many active contributors" over "how many stars".

### 4. Narrative comes before product

What people remember is not OpenClaw's feature list; it is the story "one person used AI to build a project that passed React". If your product has no narrative that can be retold, it can spread only through its features — and that is far too slow.

### 5. Once a social-proof cascade starts, it has its own dynamics

Once past some star threshold (about 10k), starring is no longer driven fully by product quality but by social proof. This means first-mover advantage is extremely important — the first project to reach 10k eats the room latecomers need to survive, because latecomers lack the social-proof signal.

---

Sources:
- [OpenClaw hits 100k GitHub stars](https://www.the180i.com/openclaw-hits-100k-github-stars-and-signals-a-shift-in-how-ai-assistants-are-built/)
- [210,000 GitHub Stars in 10 Days](https://medium.com/@Micheal-Lanham/210-000-github-stars-in-10-days-what-openclaws-architecture-teaches-us-about-building-personal-ai-dae040fab58f)
- [OpenClaw Surpasses React With 250,000 GitHub Stars](https://finance.yahoo.com/news/openclawd-releases-major-platform-openclaw-150000544.html)
- [TechCrunch: OpenClaw creator's advice to AI builders](https://techcrunch.com/2026/02/25/openclaw-creators-advice-to-ai-builders-is-to-be-more-playful-and-allow-yourself-time-to-improve/)
- [Fortune: Who is Peter Steinberger?](https://fortune.com/2026/02/19/openclaw-who-is-peter-steinberger-openai-sam-altman-anthropic-moltbook/)
- [Lex Fridman Interview Analysis](https://medium.com/product-powerhouse/openclaw-peter-steinberger-and-the-5-product-management-lessons-hidden-in-his-lex-fridman-7a12b8e2f146)
- [OpenClaw Security Crisis](https://pbxscience.com/openclaw-2026s-first-major-ai-agent-security-crisis-explained/)
- ["Vibe coding has become a slur"](https://www.aol.com/articles/openclaw-creator-says-vibe-coding-090501774.html)
