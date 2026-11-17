Strategik is a technical instrument panel: black on white, thin lines instead of shadows, square corners, a monospace voice for every label, number and status, and one orange that only ever marks something. It is the default look for everything built for this user, from internal apps to published pages, slides and diagrams.

## Content fundamentals

- Write the product's UI in Vietnamese first and English second; every string goes through the i18n layer. Technical labels (ids, codes, status words such as `applied`, `rejected`) stay English and sit in mono.
- Address the person plainly. A control states exactly what it does ("Thêm công việc", "Send test event"); an error says what went wrong and how to fix it, with no apology.
- Never invent a control, a number or a feature. A thing that does not exist yet is marked with the 6px `signal` square and answers "coming soon", not drawn as if it worked.
- No emoji, no exclamation marks, no filler copy. Use real data, or example data that is plainly marked as example.
- Number only what is a sequence. A section label is `■ TRẠNG THÁI` (square in `signal`), a sequence label is `◇ QUY TRÌNH`, and step numbers `01 02 03` appear only beside real steps.

## Visual foundations

- **Colour.** Text is `ink` or `body` on `ground`; secondary text is `muted`; `faint` only on pure `ground`. Lines are `line`, `line-soft`, `field-line`, `console`; they are decoration, never the only cue. The single accent is `signal`, as a mark. Use `signal-ink` when a word must be orange.
- **State is a mark and a word.** `mark-ok` and `mark-warn` fail 3:1 on light grounds, so a state is always an 8px square plus its word, in a chip made of `ok-bg`/`ok-ink`, `warn-bg`/`warn-ink` or `danger-bg`/`danger-ink`. Never colour alone.
- **Identity by position.** `id-1` to `id-6` colour the n-th column, entity type or series, as an 8px square, a 2-3px rule or an SVG stroke beside the name. Never a fill under text, never text.
- **Type.** Reading text, titles and card titles are `sans` (Space Grotesk); every label, count, date, id, code, status word, chip, table header and button is `mono` (JetBrains Mono). Page titles use `page-title`, section labels `label`. Both families ship the vietnamese subset: load it.
- **Shape.** Radius is `radius-none` everywhere. The only round things are an avatar, a toggle knob and a dot (`radius-round`); the monogram uses `radius-monogram`. There are no shadows (`shadow-none`): a card has a 1px `line` border, a popover or dialog a 1px `ink` border.
- **Space.** 4px base. Panels pad `space-5` to `space-6`, cards 14px, chips 2px 6px, the page gutter is at least `space-4`. Touch targets are `touch` (44px).
- **Bars.** The app bar is `bar` (black) at `bar-height`, with the monogram, the product name as `wordmark`, items in `nav`. A primary action placed on the black bar is inverted: `bar-ink` fill with `bar` text.
- **Grid.** The 50px tech grid (5% black lines) goes behind graphs, empty states and sign-in only, never behind running text.
- **Motion.** None beyond a 150ms colour change and one pulse on a running mark. Honour `prefers-reduced-motion`.
- **Focus.** A 2px `signal` outline with a 2px offset on every focusable element.
- **Dark theme.** Only for surfaces that must follow the viewer's theme (published pages). The bar inverts to white; inks lighten (`ok-ink`, `warn-ink`, `danger-ink`, `signal-ink` have dark values). Product UI stays light.

## Components

Compose screens from the components in this system: `AppBar`, `Button`, `Segmented`, `Chip`, `Status`, `ConsoleBox`, `DataTable`, `Column`, `Toast`. The primary action of a screen is one full-width `Button` with its label left and a decorative arrow right. Forms and composers live in a `ConsoleBox`. Tables use mono uppercase headers, `line-soft` row rules and a `well` selected row with a 2px `ink` left rule.

## Iconography

Inline SVG, stroke 1.75, `currentColor`, round caps. No icon font, no emoji. A status is a square, never an icon alone. The product marks are `assets/Logos/strategik-logo.svg` and `strategik-monogram.svg`; do not redraw them.

## Applying it

- Web apps: app bar, panels, tables, console boxes; open in a working state with example data.
- Published pages and slides: a black bar with the wordmark, a Space Grotesk headline, hairline panels, one orange mark.
- Charts: draw to scale in SVG, `line` gridlines, direct mono labels, `ink` first then `id-n` series, no gradients; name series in words and distinguish by dash as well as colour.
- Documents: white page, `label` section titles with a `signal` square, tables as above.
- Check contrast against what is painted: text 4.5:1 (3:1 from 24px), no mark or `decor` as text, `faint` only on `ground`.
