---
title: Rendering Mathematics Without JavaScript
date: 2026-09-20
tags: [mathml, web, pandoc]
summary: Client-side TeX renderers have dominated the web for a decade. That era is quietly ending — native MathML reached Baseline in 2025, and for a certain class of site it is now the better trade.
toc: true
---

## The decade of the JavaScript renderer

For most of the web's history, putting a formula on a page meant shipping a renderer. You wrote `$E = mc^2$`, and some library — MathJax, then KaTeX — scanned the DOM at load time and replaced your plain text with nested `<span>` elements positioned by hand-tuned CSS.

This worked, and worked well. It is still how most mathematical blogs do it today: I checked a handful of well-known ones and found MathJax 2.7.x on four of them, KaTeX on one.[^survey] But it was always a workaround for a gap in the platform.

The costs are real. MathJax 3 weighs in around half a megabyte and blocks rendering until every expression has been typeset, which is why so many sites show a flash of raw `\frac{a}{b}` before the page settles. KaTeX is considerably faster and lighter, but covers a smaller slice of LaTeX, and it still requires shipping JavaScript, CSS, and a directory of web fonts.

[^survey]: Scott Aaronson's blog loads MathJax 2.7.9 from cdnjs; Math ∩ Programming uses MathJax 3; Math3ma uses 2.7.4; MathOverflow uses 2.7.5. Distill is the KaTeX outlier. Terence Tao's blog takes a different route entirely — WordPress renders each formula to a PNG on the server.

## What changed

MathML — the markup language specifically designed to describe mathematics — has been in browsers for a long time, but Chromium's support was missing for years, which made it useless in practice.

| Browser | MathML support since |
|---------|---------------------|
| Firefox | 4 (2011) |
| Safari  | 5.1 (2011) |
| Chrome  | 109 (January 2023) |
| Edge    | 109 (January 2023) |

Once Chromium shipped it, the picture changed quickly. In July 2025 MathML entered **Baseline: widely available**, which is the standards community's way of saying that every current browser supports it.

That means a formula can now be sent as actual markup:

```html
<math display="inline">
  <semantics>
    <mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow>
    <annotation encoding="application/x-tex">E = mc^2</annotation>
  </semantics>
</math>
```

The browser renders it natively. No script tag, no font directory, no flash of unstyled TeX.

## The trade-off, stated honestly

MathML is not a strict upgrade. Rendering quality still varies between engines, and Chromium's layout is noticeably less polished than KaTeX for anything complicated — matrices, multi-line alignments, nested fractions.

The difference shows up in the sum

$$
(AB)_{ij} = \sum_{k=1}^{n} a_{ik}\,b_{kj}
$$

only mildly, but a matrix with tall entries is where it becomes visible:

$$
\begin{pmatrix}
  1 & x_1 & \cdots & x_1^{n-1} \\
  1 & x_2 & \cdots & x_2^{n-1} \\
  \vdots & \vdots & \ddots & \vdots \\
  1 & x_n & \cdots & x_n^{n-1}
\end{pmatrix}
= \prod_{1 \le i < j \le n} (x_j - x_i)
$$

For linear algebra and short derivations, native rendering is entirely serviceable. For a paper full of `align` environments, it is not yet a substitute.

What you gain is worth listing, because it is not only about bytes:

- **Nothing to execute.** The page is HTML and CSS.
- **Text is selectable.** A formula is characters, not an image.
- **Screen readers can read it.** MathML carries semantic structure that a PNG cannot.
- **It follows your theme.** Colour is inherited, so dark mode works without a second render.
- **It degrades gracefully.** With CSS disabled you still see meaningful markup.

## Adding it to a static site

With Pandoc the whole change is one flag. Write Markdown as usual:

```markdown
$$
(AB)_{ij} = \sum_{k=1}^{n} a_{ik} b_{kj}
$$
```

and ask for MathML on the way out:

```bash
pandoc -f gfm+tex_math_dollars -t html --mathml --wrap=none post.md
```

The output is what you saw above. Note that `gfm` already enables `tex_math_dollars`, so the explicit extension is only there for clarity.

> A note on `--wrap=none`: Pandoc's default line wrapping inserts newlines at 80 columns, and in HTML a newline is whitespace. That matters less than it sounds — Pandoc breaks on spaces, and Chinese text has none, so CJK paragraphs pass through untouched. It is mostly a tidiness flag.

## When to reach for a renderer instead

Native MathML is the right default for a personal technical blog. It is the wrong choice in two cases:

1. **You need the full LaTeX surface.** Custom macros, `\newcommand`, AMS environments with numbering, `tikz`-adjacent packages — KaTeX and MathJax cover far more of it.
2. **You need pixel-identical output across browsers.** Native rendering hands layout to the engine, and engines disagree. A client-side renderer produces the same DOM everywhere.

For everyone else — which is most of us writing about algorithms, systems, and the occasional matrix — the trade has finally gone the other way.
