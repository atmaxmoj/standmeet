// resume.typ —— StandMeet resume, house style (cream paper + ink + vermillion, Newsreader/mono).
//
// Data-driven and injection-safe: every value comes from json("data.json") and is placed as
// content (never evaluated as Typst markup). job + qr come via `typst compile --input`.
// The QR is a server-generated image (qr.png) — the owner's data can never change it.
//
// Reproduces app/src/components/admin/resume-page/ResumePage.tsx.

#let data = json("data.json")
#let qr-url = sys.inputs.at("qr", default: "")
#let role = sys.inputs.at("role", default: "")
#let company = sys.inputs.at("company", default: "")

#let ink = rgb("#1B1814")
#let paper = rgb("#FAF7EF")
#let accent = rgb("#9B3018")
#let rule = rgb("#D7CEB9")
#let muted = rgb("#5F564B")
#let faint = rgb("#9B9282")

#set page(
  width: 8.5in, height: 11in,
  margin: (x: 0.62in, top: 0.5in, bottom: 0.55in),
  fill: paper,
  footer: context {
    set text(font: ("JetBrains Mono", "Menlo"), size: 7pt, fill: faint)
    grid(columns: (1fr, 1fr),
      align(left)[page #counter(page).display() / #counter(page).final().first()],
      align(right)[#qr-url])
  },
)
#set text(font: ("Newsreader", "Georgia"), fill: ink, size: 9.5pt)
#set par(leading: 0.5em)

#let mono(size: 8pt, fill: muted, body) = text(
  font: ("JetBrains Mono", "Menlo"), size: size, fill: fill,
)[#body]

#let sechead(title) = block(above: 12pt, below: 5pt)[
  #mono(size: 8.5pt, fill: accent)[#upper(title)]
  #v(-3pt)
  #line(length: 100%, stroke: 0.5pt + rule)
]

#let period(p) = {
  let e = p.at("end", default: none)
  if e == none or e == "" { p.start + " – present" } else { p.start + " – " + e }
}

// ── header ──────────────────────────────────────────────────────────
#let idy = data.identity
#grid(columns: (1fr, auto), column-gutter: 14pt, align: (left + bottom, right + top),
  [
    #text(size: 23pt, weight: 500)[#lower(idy.name)]
    #v(1pt)
    #if role != "" [ #mono(size: 9pt, fill: ink)[#role] #if company != "" [#mono(size: 9pt, fill: faint)[ · #company]] \ ]
    #mono(size: 8pt)[
      #idy.email #h(6pt)·#h(6pt) #idy.phone #h(6pt)·#h(6pt) #idy.location_line #if idy.at("site", default: "") != "" [#h(6pt)·#h(6pt) #idy.site]
    ]
    #if data.at("social", default: ()).len() > 0 [
      \ #mono(size: 8pt)[#data.social.map(s => s.label + " " + s.handle).join("   ")]
    ]
  ],
  // QR card (vermillion border). qr.png is server-generated from the per-application URL —
  // the owner's data/template can't change what it encodes.
  box(stroke: 0.75pt + accent, inset: 4pt, radius: 1pt)[
    #if qr-url != "" [
      #image("qr.png", width: 46pt)
    ] else [
      #box(width: 46pt, height: 46pt, fill: white)
    ]
  ],
)

#v(2pt)
#line(length: 100%, stroke: 0.75pt + rule)

// ── summary ─────────────────────────────────────────────────────────
#sechead("summary")
#par(justify: false)[#data.summary]

// ── body: skills+education (left) · experience (right) ──────────────
#v(4pt)
#grid(columns: (0.9fr, 2fr), column-gutter: 20pt,
  // left rail
  [
    #sechead("skills")
    #for s in data.at("skills", default: ()) [
      #mono(size: 7.5pt, fill: ink)[#upper(s.category)] \
      #text(size: 9pt)[#s.items.join("  ·  ")]
      #v(4pt)
    ]
    #sechead("education")
    #for e in data.at("educations", default: ()) [
      #text(size: 10pt, weight: 500)[#e.school] \
      #text(size: 8.5pt, fill: muted)[#e.degree] \
      #mono(size: 7pt, fill: faint)[#period(e.period)]
      #v(5pt)
    ]
  ],
  // main column: experience
  [
    #sechead("experience")
    #for w in data.works [
      #grid(columns: (1fr, auto), align: (left, right),
        text(size: 11pt, weight: 500)[#w.title],
        mono(size: 7.5pt, fill: faint)[#period(w.period)])
      #v(-2pt)
      #text(size: 9.5pt, fill: accent)[#w.company] #text(size: 8.5pt, fill: faint)[ · #w.location]
      #v(2pt)
      #for b in w.bullets [
        #grid(columns: (10pt, 1fr),
          text(fill: faint)[•], text(size: 9pt)[#b])
        #v(1pt)
      ]
      #v(7pt)
    ]
  ],
)

// ── page 2: cover letter (only when there is one) ──────────────────
#if data.at("cover_letter", default: "") != "" [
  #pagebreak()
  #v(20pt)
  #text(size: 21pt, weight: 500)[to #if company != "" [#lower(company)] else [you].]
  #v(10pt)
  #par(justify: false, leading: 0.65em)[#data.cover_letter]
]
