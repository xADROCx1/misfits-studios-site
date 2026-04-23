# Shadow Kids Studios — Icon Set

Custom SVG iconography for the Shadow Kids Studios brand: skull-punk, neon underground, cyberpunk HUD. Pure SVG, no external dependencies, no raster embeds.

## How to tint with CSS

Every icon (except `noise-pattern.svg`) uses `stroke="currentColor"` or `fill="currentColor"`. That means the color is inherited from the CSS `color:` property of the parent element. Drop in one of the brand colors:

```html
<img src="/assets/icons/skull.svg" alt="" class="w-6 h-6" style="color:var(--neon-mint)"/>
<img src="/assets/icons/warning-triangle.svg" alt="" style="color:var(--safety-orange)"/>
<img src="/assets/icons/logo-mark.svg" alt="Shadow Kids Studios" style="color:var(--electric-purple)"/>
```

For SVG-as-CSS-background, you need to either inline them in a `background-image: url("data:image/svg+xml,...")` or use the `<img>` tag; `currentColor` won't work through `url()`, so for background tiles we provide the `noise-pattern.svg` and `scanlines.svg` as standalone patterns.

## Brand colors available (from `theme.css`)

| Token | Hex | Intent |
|---|---|---|
| `--neon-mint` | `#00ffa3` | Shipped / online / free |
| `--electric-purple` | `#cc97ff` | Primary brand |
| `--neon-cyan` | `#53ddfc` | Technical / cool |
| `--digital-pink` | `#ff86c3` | Punk accent |
| `--safety-orange` | `#ff9e53` | Warning / hazard |
| `--deep-black` | `#060e20` | Background |

## Icons

### `skull.svg` — 64x64
Large, detailed punk skull. Use as page-level decoration, hero splash mark, section divider anchor.

```html
<img src="/assets/icons/skull.svg" alt="" width="64" height="64" style="color:var(--digital-pink)"/>
```

### `skull-icon.svg` — 24x24
Compact skull for tight spaces. Use in nav items, footer credits, inline next to labels.

```html
<span style="color:var(--electric-purple); display:inline-flex; gap:.5rem; align-items:center;">
  <img src="/assets/icons/skull-icon.svg" alt="" width="24" height="24"/>
  Shadow Kids Studios
</span>
```

### `warning-triangle.svg` — 32x32
HUD hazard icon. Use for error banners, destructive action confirmations, unstable-build badges.

```html
<img src="/assets/icons/warning-triangle.svg" alt="warning" width="32" height="32" style="color:var(--safety-orange)"/>
```

### `bracket-corner-tl.svg`, `bracket-corner-tr.svg`, `bracket-corner-bl.svg`, `bracket-corner-br.svg` — 16x16 each
HUD L-brackets for framing content. Drop one in each corner of a container to get a scope-framed look without pseudo-elements.

```html
<div class="hud-frame" style="position:relative; padding:1rem; color:var(--neon-cyan);">
  <img src="/assets/icons/bracket-corner-tl.svg" alt="" style="position:absolute; top:4px; left:4px;"/>
  <img src="/assets/icons/bracket-corner-tr.svg" alt="" style="position:absolute; top:4px; right:4px;"/>
  <img src="/assets/icons/bracket-corner-bl.svg" alt="" style="position:absolute; bottom:4px; left:4px;"/>
  <img src="/assets/icons/bracket-corner-br.svg" alt="" style="position:absolute; bottom:4px; right:4px;"/>
  Scoped content
</div>
```

### `logo-mark.svg` — 48x48
Minimal MS monogram in stamped-metal block-letter style. Use as a favicon source, inline brand mark in headers, embedded small-format logo where the full PNG is overkill.

```html
<link rel="icon" type="image/svg+xml" href="/assets/icons/logo-mark.svg">
<!-- or -->
<img src="/assets/icons/logo-mark.svg" alt="Shadow Kids Studios" width="32" height="32" style="color:var(--electric-purple)"/>
```

### `noise-pattern.svg` — 200x200
Tileable grain texture using `feTurbulence`. Use as `background-image` on large surfaces to add a subtle organic rough texture.

```css
body {
  background-color: var(--deep-black);
  background-image: url("/assets/icons/noise-pattern.svg");
  background-repeat: repeat;
}
```

### `spray-arrow.svg` — 64x32
Graffiti-style wobble arrow. Use as a bullet marker for lists, a CTA pointer, or next to "check this out" callouts.

```html
<ul class="spray-list" style="list-style:none; padding:0;">
  <li style="display:flex; gap:.75rem; align-items:center; color:var(--neon-mint);">
    <img src="/assets/icons/spray-arrow.svg" alt="" width="32" height="16"/>
    Ritual Travel shipping next wipe
  </li>
</ul>
```

### `scanlines.svg` — 4x4
Tiny tileable CRT scanline pattern. Use as `background-image` over video-like panels for a retro monitor feel.

```css
.crt-panel {
  background-image: url("/assets/icons/scanlines.svg");
  background-repeat: repeat;
  color: var(--neon-cyan);
}
```

Scanlines pick up `currentColor`, so setting a `color:` on the panel tints the lines without editing the SVG.

## Notes

- Every SVG is valid XML with the `xmlns` attribute and renders in all modern browsers.
- Default `viewBox` is set on each, so they scale cleanly when resized via CSS `width`/`height`.
- None of them contain raster images or external imports; safe to inline or ship as-is.
- For best crispness at small sizes, apply `shape-rendering: geometricPrecision` via CSS if needed.
