# SnapQuote design system

Oct 6, 2026. One stylesheet (`src/ui/styles.css`) and hand-rolled components (`src/ui/components/ui.tsx`):
plain CSS with tokens, no component library, no CDN. The Quotes page was redesigned first; the other
screens take the same tokens and shell and are to follow page by page.

## Direction

Calm and practical for daily work: a soft neutral page, white surfaces, charcoal text, one blue. Clarity
comes from type, spacing and alignment, not from color or decoration. Linear was the reference for
restraint, not for its look.

- **Blue is for action, selection, focus and links**, never decoration. It also marks "needs you"
  counts, because those call for action.
- **Status has its own hues**: green priced or won, amber soon or incomplete, red late, violet a
  department's question. A status is always words plus color, never color alone.
- **Emphasis only when it means something**: a summary figure is colored only when it is above zero
  and calls for action (Needs attention, Overdue); zeros are muted.
- **Few pills**: dates and states are text with a small outline icon; pills are kept for tags such as
  ITAR and for the existing chips on the quote pages.
- No gradients, glass, oversized headings or bold everywhere: 600 for headings, names and actions, 500
  for controls, 400 for text.

## Tokens (`:root`)

| Group | Tokens |
| --- | --- |
| Neutrals | `--bg` page, `--surface` white, `--sunken`, `--subtle` (sidebar, columns, tracks), `--hover`, `--line`, `--line-strong` |
| Text | `--ink` charcoal, `--ink-2`, `--muted` (5.7:1 on white), `--faint` (icons only) |
| Accent | `--accent`, `--accent-ink` (links, text on soft), `--accent-soft`, `--accent-line`, `--ring` |
| Status | `--late`, `--soon`, `--done`, `--ask`, each with `-soft` and `-line` |
| Type | `--font` (Inter, bundled from `@fontsource-variable/inter`), `--mono` (quote and part numbers only), `--text-xs` 12 / `-sm` 13 / base 14 / `-lg` 16 / `-xl` 20 |
| Space | `--space-1` … `--space-8` on a 4px step |
| Shape | `--r-sm` 6, `--r` 8 (controls), `--r-lg` 10 (cards), `--r-xl` 12 (panels, columns); `--shadow-xs`, `--shadow-sm`, `--shadow` (overlays only) |
| Layout | `--sidebar` 220px, `--rail` 64px |

Text is 14px; 12–13px only for secondary metadata. Numbers are tabular.

## Components

- **Shell** (`main.tsx`): left sidebar with the brand, the destinations each role has (unchanged), the
  "needs you" count, and the account and sign-out at the foot. 1200px and wider: full sidebar.
  721–1199px: an icon rail whose names show on hover and keyboard focus. 720px and under: a top bar with
  a menu. The page never scrolls sideways.
- **`.page-head`**: the page title (20px), one supporting line, the page's main action at the right.
  `.hello` on older pages is styled the same.
- **`Icon`**: one outline set on a 24-unit grid, 1.75 stroke, current color.
- **Buttons**: `.btn` (secondary), `.btn.primary` (one per view), `.btn.ghost`, `.icon-btn`,
  `.quiet-link`.
- **`.seg`**: segmented choice; the chosen one is white with blue text and `aria-pressed`.
- **`DropStrip`**: compact drop target with its own Upload button; help and waiting files sit inside
  it so dropping on them works too. `DropZone` stays for the quote page.
- **`.metrics`**: one quiet row of figures; each is a toggle that filters the board.
- **`.toolbar`**: scope, search, the active filter (with a clear button), count and secondary links.
- **Board**: `.board` scrolls sideways inside itself with edge fades and arrow buttons when the window
  is too narrow; columns stack on a phone. `.column`, `.column-head` with a `.badge` count,
  `.column-empty` for quiet empty states.
- **`.qcard`**: customer (or "Customer not set"), title to two lines, number · owner and last change,
  then a status block: departments with their state, the customer's date (`Due plain`), and the next
  step (`.act` in tones `do`, `ask`, `fix`, `wait`, `late`, `done`, `plain`), taken only from what the
  board knows.

## Checks

`tests/browser/board.spec.ts` checks the cards' next steps, the summary filters, search, scope, opening a
card from the keyboard, no sideways page scroll at 950px and 390px, the board scrolling inside itself,
and the phone menu.
