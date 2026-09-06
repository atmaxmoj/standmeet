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
// accent — owner-customizable (data.accent, #RRGGBB); empty/absent → the house vermillion.
#let accent-raw = data.at("accent", default: "")
#let accent = if accent-raw == "" { rgb("#9B3018") } else { rgb(accent-raw) }
#let rule = rgb("#D7CEB9")
#let muted = rgb("#5F564B")
#let faint = rgb("#9B9282")

// No footer: the access URL lives in the header QR, not a bottom-right text line (the owner read
// that line as a watermark). Dropping it also removes the page-number line.
#set page(
  width: 8.5in, height: 11in,
  margin: (x: 0.62in, top: 0.5in, bottom: 0.55in),
  fill: paper,
)
#set text(font: ("Newsreader", "Georgia", "Noto Serif CJK SC"), fill: ink, size: 9.5pt)
#set par(leading: 0.5em)

#let mono(size: 8pt, fill: muted, body) = text(
  font: ("JetBrains Mono", "Menlo", "Noto Sans Mono CJK SC"), size: size, fill: fill,
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

// edit-anchor —— an invisible, queryable marker the composer's WASM preview uses to place
// click-to-edit overlays (docs/design/composer-visual-editor.md, Phase 3). It emits the field's
// on-page position (pt) + page number as metadata; `query('<sm-edit>')` reads them back. Produces
// NO visual output and takes no space, so the committed PDF is byte-identical with or without it.
#let edit-anchor(field) = context {
  let p = here().position()
  [#metadata((field: field, x: p.x / 1pt, y: p.y / 1pt, page: p.page)) <sm-edit>]
}

// row-anchor —— like edit-anchor, but marks the top of a repeatable ROW (an experience/education
// entry) so the composer can overlay drag handles and reorder ON the canvas (P3-b). Emits the
// list `kind` + `index` + position; `query('<sm-row>')` reads them back. No visual output.
#let row-anchor(kind, index) = context {
  let p = here().position()
  [#metadata((kind: kind, index: index, x: p.x / 1pt, y: p.y / 1pt, page: p.page)) <sm-row>]
}

// ── header ──────────────────────────────────────────────────────────
#let idy = data.identity
#grid(columns: (1fr, auto), column-gutter: 14pt, align: (left + bottom, right + top),
  [
    #edit-anchor("identity.name")#text(size: 23pt, weight: 500)[#lower(idy.name)]
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
#edit-anchor("summary")
#par(justify: false)[#data.summary]

// ── body: skills+education (left) · experience (right) ──────────────
#v(4pt)
#grid(columns: (0.9fr, 2fr), column-gutter: 20pt,
  // left rail
  [
    // Empty sections print NO heading (parity with ResumePage; an "EDUCATION" heading with nothing
    // under it reads as broken to a recruiter).
    #if data.at("skills", default: ()).any(s => s.items.len() > 0) [
      #sechead("skills")
      #for s in data.at("skills", default: ()) [
        #mono(size: 7.5pt, fill: ink)[#upper(s.category)] \
        #text(size: 9pt)[#s.items.join("  ·  ")]
        #v(4pt)
      ]
    ]
    #if data.at("educations", default: ()).len() > 0 [
      #sechead("education")
      #for e in data.at("educations", default: ()) [
        #text(size: 10pt, weight: 500)[#e.school] \
        #text(size: 8.5pt, fill: muted)[#e.degree] \
        #mono(size: 7pt, fill: faint)[#period(e.period)]
        #v(5pt)
      ]
    ]
    // custom owner-named sections (languages, certifications, …). The composer offers these and
    // ResumePage renders them; the PDF must too, or they vanish from the résumé recruiters receive.
    #for c in data.at("custom", default: ()) [
      #if c.at("kind", default: "") == "divider" [
        #v(3pt) #line(length: 100%, stroke: 0.5pt + rule) #v(3pt)
      ] else if c.label != "" and c.value != "" [
        #sechead(c.label)
        #text(size: 9pt)[#c.value]
        #v(4pt)
      ]
    ]
  ],
  // main column: experience
  [
    #if data.works.len() > 0 [
    #sechead("experience")
    #for (i, w) in data.works.enumerate() [
      #row-anchor("works", i)
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
