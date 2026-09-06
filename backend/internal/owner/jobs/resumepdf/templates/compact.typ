// compact.typ —— a single-column, ATS-leaning variant. Same ResumeContent, same house colours,
// tighter and linear (one text flow, easy for résumé parsers). Data-driven + injection-safe:
// every value is placed as content, never eval'd. QR is the server-built qr.png.

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

// fs — owner-chosen font-size multiplier (data.font_scale; absent/0 → 1); every text size is scaled
// by it (sz) so the whole résumé grows/shrinks proportionally. Matches classic.typ.
#let fs-raw = data.at("font_scale", default: 1.0)
#let fs = if fs-raw == 0 { 1.0 } else { fs-raw }
#let sz(s) = s * fs

#set page(
  width: 8.5in, height: 11in,
  margin: (x: 0.75in, top: 0.6in, bottom: 0.6in),
  fill: paper,
  // No footer: the access URL lives in the header QR, not a bottom-right text line (read as a
  // watermark). Dropping it also removes the page-number line.
)
#set text(font: ("Newsreader", "Georgia", "Noto Serif CJK SC"), fill: ink, size: sz(10pt))
#set par(leading: 0.55em)

#let mono(size: sz(8pt), fill: muted, body) = text(
  font: ("JetBrains Mono", "Menlo", "Noto Sans Mono CJK SC"), size: size, fill: fill,
)[#body]

#let sechead(title) = block(above: 11pt, below: 5pt)[
  #mono(size: sz(8.5pt), fill: accent)[#upper(title)]
  #v(-3pt)
  #line(length: 100%, stroke: 0.5pt + rule)
]

#let period(p) = {
  let e = p.at("end", default: none)
  if e == none or e == "" { p.start + " – present" } else { p.start + " – " + e }
}

// edit-anchor —— invisible, queryable position marker for the composer's on-canvas editor
// (docs/design/composer-visual-editor.md, Phase 3). No visual output; the committed PDF is
// unaffected. Matches classic.typ; queried via `<sm-edit>`.
#let edit-anchor(field) = context {
  let p = here().position()
  [#metadata((field: field, x: p.x / 1pt, y: p.y / 1pt, page: p.page)) <sm-edit>]
}

// row-anchor —— marks the top of a repeatable row for on-canvas drag-reorder (P3-b). Queried via
// `<sm-row>`; matches classic.typ. No visual output.
#let row-anchor(kind, index) = context {
  let p = here().position()
  [#metadata((kind: kind, index: index, x: p.x / 1pt, y: p.y / 1pt, page: p.page)) <sm-row>]
}

// section-anchor —— marks the top of a whole SECTION block for on-canvas section reorder (Spec 2).
// Matches classic.typ; queried via `<sm-section>`. No visual output.
#let section-anchor(kind, index) = context {
  let p = here().position()
  [#metadata((kind: kind, index: index, x: p.x / 1pt, y: p.y / 1pt, page: p.page)) <sm-section>]
}

// left-order — the owner's order for the reorderable section blocks (skills / education / custom).
// Compact is single-column, so these render one after another (after experience) in this order.
#let left-order = data.at("left_order", default: ("skills", "education", "custom"))

#let render-education() = [
  #if data.at("educations", default: ()).len() > 0 [
    #sechead("education")
    #for (i, e) in data.at("educations", default: ()).enumerate() [
      #row-anchor("educations", i)
      #grid(columns: (1fr, auto), align: (left, right),
        text(size: sz(10pt), weight: 500)[#e.school #text(size: sz(9pt), fill: muted)[— #e.degree]],
        mono(size: sz(7.5pt), fill: faint)[#period(e.period)])
      #v(3pt)
    ]
  ]
]
#let render-skills() = [
  #if data.at("skills", default: ()).any(s => s.items.len() > 0) [
    #sechead("skills")
    #for s in data.at("skills", default: ()) [
      #mono(size: sz(8pt), fill: ink)[#s.category:] #text(size: sz(9.5pt))[ #s.items.join("  ·  ")] \
    ]
  ]
]
#let render-custom() = [
  // custom owner-named sections (languages, certifications, …). The composer offers these and
  // ResumePage renders them; the PDF must too, or they vanish from the résumé recruiters receive.
  #for c in data.at("custom", default: ()) [
    #if c.at("kind", default: "") == "divider" [
      #v(3pt) #line(length: 100%, stroke: 0.5pt + rule) #v(3pt)
    ] else if c.label != "" and c.value != "" [
      #sechead(c.label)
      #text(size: sz(9.5pt))[#c.value]
    ]
  ]
]
#let render-left(key) = {
  if key == "skills" { render-skills() } else if key == "education" { render-education() } else if key == "custom" { render-custom() }
}

#let idy = data.identity

// QR is a mandatory system widget on every template — qr.png is server-built from the
// per-application URL, so the owner's data/template can't change what it encodes.
#if qr-url != "" [
  #place(top + right, box(stroke: 0.75pt + accent, inset: 3pt, radius: 1pt)[
    #image("qr.png", width: 40pt)
  ])
]

// header — centered name, single meta line
#align(center)[
  #edit-anchor("identity.name")#text(size: sz(22pt), weight: 500)[#lower(idy.name)]
  #v(2pt)
  #if role != "" [ #mono(size: sz(9pt), fill: ink)[#role#if company != "" [ · #company]] \ ]
  #mono(size: sz(8pt))[
    #idy.email #h(5pt)·#h(5pt) #idy.phone #h(5pt)·#h(5pt) #idy.location_line #if idy.at("site", default: "") != "" [#h(5pt)·#h(5pt) #idy.site]
  ]
]
#v(3pt)
#line(length: 100%, stroke: 0.75pt + rule)

#sechead("summary")
#edit-anchor("summary")
#par(justify: false)[#data.summary]

// Empty sections print NO heading (parity with ResumePage — a bare heading reads as broken).
#if data.works.len() > 0 [
  #sechead("experience")
  #for (i, w) in data.works.enumerate() [
    #row-anchor("works", i)
    #grid(columns: (1fr, auto), align: (left, right),
      text(size: sz(11pt), weight: 500)[#w.title #text(size: sz(9.5pt), fill: accent)[· #w.company]],
      mono(size: sz(7.5pt), fill: faint)[#period(w.period)])
    #v(1pt)
    #for b in w.bullets [
      #grid(columns: (12pt, 1fr), text(fill: faint)[•], text(size: sz(9.5pt))[#b])
      #v(1pt)
    ]
    #v(6pt)
  ]
]

// The reorderable sections (education / skills / custom), in the owner's left-order.
#for (i, key) in left-order.enumerate() [
  #section-anchor("left", i)
  #render-left(key)
]

// ── page 2: cover letter (only when there is one) ──────────────────
#if data.at("cover_letter", default: "") != "" [
  #pagebreak()
  #v(18pt)
  #align(center)[#text(size: sz(19pt), weight: 500)[to #if company != "" [#lower(company)] else [you].]]
  #v(10pt)
  #par(justify: false, leading: 0.65em)[#data.cover_letter]
]
