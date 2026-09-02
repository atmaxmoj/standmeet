// compact.typ —— a single-column, ATS-leaning variant. Same ResumeContent, same house colours,
// tighter and linear (one text flow, easy for résumé parsers). Data-driven + injection-safe:
// every value is placed as content, never eval'd. QR is the server-built qr.png.

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
  margin: (x: 0.75in, top: 0.6in, bottom: 0.6in),
  fill: paper,
  footer: context {
    set text(font: ("JetBrains Mono", "Menlo"), size: 7pt, fill: faint)
    grid(columns: (1fr, 1fr),
      align(left)[page #counter(page).display() / #counter(page).final().first()],
      align(right)[#qr-url])
  },
)
#set text(font: ("Newsreader", "Georgia"), fill: ink, size: 10pt)
#set par(leading: 0.55em)

#let mono(size: 8pt, fill: muted, body) = text(
  font: ("JetBrains Mono", "Menlo"), size: size, fill: fill,
)[#body]

#let sechead(title) = block(above: 11pt, below: 5pt)[
  #mono(size: 8.5pt, fill: accent)[#upper(title)]
  #v(-3pt)
  #line(length: 100%, stroke: 0.5pt + rule)
]

#let period(p) = {
  let e = p.at("end", default: none)
  if e == none or e == "" { p.start + " – present" } else { p.start + " – " + e }
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
  #text(size: 22pt, weight: 500)[#lower(idy.name)]
  #v(2pt)
  #if role != "" [ #mono(size: 9pt, fill: ink)[#role#if company != "" [ · #company]] \ ]
  #mono(size: 8pt)[
    #idy.email #h(5pt)·#h(5pt) #idy.phone #h(5pt)·#h(5pt) #idy.location_line #if idy.at("site", default: "") != "" [#h(5pt)·#h(5pt) #idy.site]
  ]
]
#v(3pt)
#line(length: 100%, stroke: 0.75pt + rule)

#sechead("summary")
#par(justify: false)[#data.summary]

#sechead("experience")
#for w in data.works [
  #grid(columns: (1fr, auto), align: (left, right),
    text(size: 11pt, weight: 500)[#w.title #text(size: 9.5pt, fill: accent)[· #w.company]],
    mono(size: 7.5pt, fill: faint)[#period(w.period)])
  #v(1pt)
  #for b in w.bullets [
    #grid(columns: (12pt, 1fr), text(fill: faint)[•], text(size: 9.5pt)[#b])
    #v(1pt)
  ]
  #v(6pt)
]

#sechead("education")
#for e in data.at("educations", default: ()) [
  #grid(columns: (1fr, auto), align: (left, right),
    text(size: 10pt, weight: 500)[#e.school #text(size: 9pt, fill: muted)[— #e.degree]],
    mono(size: 7.5pt, fill: faint)[#period(e.period)])
  #v(3pt)
]

#sechead("skills")
#for s in data.at("skills", default: ()) [
  #mono(size: 8pt, fill: ink)[#s.category:] #text(size: 9.5pt)[ #s.items.join("  ·  ")] \
]

// ── page 2: cover letter (only when there is one) ──────────────────
#if data.at("cover_letter", default: "") != "" [
  #pagebreak()
  #v(18pt)
  #align(center)[#text(size: 19pt, weight: 500)[to #if company != "" [#lower(company)] else [you].]]
  #v(10pt)
  #par(justify: false, leading: 0.65em)[#data.cover_letter]
]
