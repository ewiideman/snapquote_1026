# SnapQuote design system

Oct 6, 2026; refined Oct 24, 2026 (surfaces, light/dark/system themes, the board's cards, lanes and summary). One stylesheet (`src/ui/styles.css`) and hand-rolled components (`src/ui/components/ui.tsx`):
plain CSS with tokens, no component library, no CDN. The Quotes page was redesigned first; the other
screens take the same tokens and shell and are to follow page by page.

## Direction

Calm and practical for daily work: a cool neutral page, white cards, charcoal text, one blue. Clarity
comes from type, spacing and alignment, not from color or decoration. Linear was the reference for
restraint, not for its look.

- **Four surfaces, back to front**: the page (`--bg`), the sidebar (`--nav`), the board's lanes
  (`--lane`, a tray with no outline) and the cards (`--surface`, the only board element with a shadow,
  because it is the one you click). Menus and dialogs are `--raised`. Few nested outlines.
- **Blue is for action, selection, focus and links**, never decoration.
- **Amber is for what needs someone**: the "needs you" count in the sidebar, Needs attention, and a
  card's required step (Review and send, Answer a question, Add the customer). **Green** is for what
  succeeded (priced, won, money won); **red** for late; **violet** for a department's question in the
  department list. A status is always words or an icon as well as color, never color alone.
- **Emphasis only when it means something**: a summary figure is colored only when it is above zero
  and calls for something (amber Needs attention, red Overdue, green Won); zeros recede.
- **Few pills**: dates and states are text with a small outline icon; pills are kept for tags such as
  ITAR and for the existing chips on the quote pages.
- No gradients, glass, oversized headings or bold everywhere: 600 for headings, names and actions, 500
  for controls, 400 for text.

## Themes

Light, dark and system, from one set of semantic tokens: `:root` is light, `:root[data-theme="dark"]`
redefines the same names. Dark is deep slate (`#13161b`), the sidebar and lanes a step lighter, cards a
step above them, never pure black and only slightly cool. `color-scheme` follows the theme, so date
pickers, scrollbars and selects match.

- The choice is in the sidebar (the monitor, sun or moon button beside the brand; in the icon rail, at
  its foot) and on the account page (Appearance). "System" follows the computer, live.
- It is remembered in the browser (`localStorage` `snapquote.theme`; no key means System), not on the
  server, so each computer can differ. `src/ui/lib/theme.ts`.
- A script in `index.html` sets `data-theme` before anything is drawn, and a small inline style colors
  the page, so a dark page never flashes light (checked in `tests/browser/theme.spec.ts` with the app's
  script blocked).

## Tokens

| Group | Tokens |
| --- | --- |
| Surfaces | `--bg` page, `--nav` sidebar, `--lane` board lanes, `--surface` cards and inputs, `--raised` menus and dialogs, `--sunken` table heads, `--subtle` tracks, `--hover` |
| Lines | `--line` dividers, `--line-strong` quiet control edges, `--input-line` text fields (3:1), `--card-line` |
| Text | `--ink`, `--ink-2`, `--muted` (6.4:1 on white, 5.4:1 on a lane; 6.2:1 on a dark card), `--faint` (icons only), `--placeholder` |
| Accent | `--accent`, `--accent-hover`, `--on-accent`, `--accent-ink` (links, text on soft), `--accent-soft`, `--accent-line`, `--ring` |
| Status | `--late`, `--soon` (amber text), `--done`, `--ask`, each with `-soft` and `-line`; `--attn` / `--on-attn` (amber fill for counts) |
| Stages | `--stage-draft`, `-estimating`, `-ready`, `-sent`, `-closed`: the lanes' markers only |
| Overlays | `--tip` / `--tip-ink` / `--tip-link` (tooltips, the toast), `--tag-bg` / `--tag-ink` (ITAR), `--scrim`, `--veil` (busy and drop overlays), `--mine` |
| Type | `--font` (Inter, bundled from `@fontsource-variable/inter`), `--mono` (quote and part numbers only), `--text-xs` 12 / `-sm` 13 / base 14 / `-md` 15 / `-lg` 16 / `-xl` 22 |
| Space | `--space-1` … `--space-8` on a 4px step |
| Shape | `--r-sm` 6, `--r` 8 (controls), `--r-lg` 10 (cards), `--r-xl` 12 (panels, lanes); `--control` 34px and `--control-sm` 28px heights; `--shadow-card` and `--shadow-card-hover` (cards), `--shadow-xs`, `--shadow-sm`, `--shadow` (overlays) |
| Layout | `--sidebar` 216px, `--rail` 60px |

Text is 14px; 12–13px only for secondary metadata. Page titles 22px 650; a card's customer 15px 600;
summary figures 22px 650. Numbers are tabular. Every text color meets WCAG AA on the surfaces it sits on
in both themes (checked by measuring each text element on the rendered board, quote, settings, queue and
sign-in pages).

## Components

- **Brand**: SnapQuote V2's "SQ" mark redrawn as a vector (`BrandMark` in `ui.tsx`, sharp at any size)
  beside the name "SnapQuote"; the browser icon is its boxed app icon as SVG (`snapquote-icon.svg`, the
  PNG kept for browsers without SVG icons). The mark keeps its own light blue, a shade lighter in dark:
  it is the brand, not an action color.
- **Shell** (`main.tsx`): left sidebar with the brand and the theme button, the destinations each role
  has (unchanged), the amber "needs you" count, and the account and sign-out at the foot. The page you
  are on is a raised row with a blue bar at its edge and a blue icon. 1200px and wider: full sidebar.
  721–1199px: an icon rail whose names show on hover and keyboard focus. 720px and under: a top bar with
  a menu. The page never scrolls sideways.
- **`.page-head`**: the page title (20px), one supporting line, the page's main action at the right.
  `.hello` on older pages is styled the same.
- **`Icon`**: one outline set on a 24-unit grid, 1.75 stroke, current color; 16px in buttons, 18px in
  the sidebar, 14px on cards.
- **Buttons**: `.btn` (secondary), `.btn.primary` (one per view: New quote on the board), `.btn.ghost`,
  `.icon-btn`, `.quiet-link`. One height (`--control`), one small (`--control-sm`), 8px corners.
- **Fields**: every one-line field and dropdown is `--control` (34px) tall in every browser: Safari's
  short dropdowns and tall date fields are evened out, dropdowns draw one chevron of our own, and date
  parts sit left like text. `.field` is a label above its box (one 20px line, so a row of fields starts
  its boxes level); `.field-check` puts a checkbox where a box would be; `.with-note` puts a short note
  inside a field at its right (how soon the customer's date is, shown only within two weeks or late).
  In tables, `.bare` fields are 30px and `GrowingText` wraps a long value instead of cutting it off.
  Checked in WebKit as well as Chrome.
- **Drawings in the pricing panel** (`PartDrawings`, `src/ui/lib/drawings.ts`): the quote's drawings and
  models at the top of the panel, the part's own first (attached to the part, or its part number in the
  file name), marked "this part". A PDF or image opens in a new tab, in the browser's own viewer beside
  the calculator; a CAD file downloads. No viewer inside SnapQuote: the browser's is better.
- **Parts table** (`table.parts`): set column widths, so part numbers show whole and the description
  takes the rest of the row.
- **`.seg`**: segmented choice; the chosen one is white with blue text and `aria-pressed`.
- **`DropStrip`**: compact drop target with its own Upload button; help and waiting files sit inside
  it so dropping on them works too. The one place with a dashed border, because it is a place to drop:
  at rest dashed gray, under the pointer dashed blue, while dragging solid blue with "Drop to add to the
  new quote", while uploading a veil with what it is doing, and on a failure a red edge with the reason
  inside it. `DropZone` stays for the quote page.
- **`.metrics`**: one row of figures, each a toggle that filters the board: a filter icon shows under
  the pointer and on keyboard focus, and the one that is on is blue with a bar beneath it. Figures show
  "–" while the board loads, not 0. Pipeline (Oct 24) is the quotes the customers have now (sent, not
  won or lost), each at its first quantity as its card shows it; it filters to those quotes.
- **`.toolbar`**: scope, search, the active filter (with a clear button), count and secondary links.
- **Board**: `.board` scrolls sideways inside itself with edge fades and arrow buttons when the window
  is too narrow (a lane is at least 176px, so all five fit from 1200px, where the full sidebar shows); lanes stack on a phone. Lane headings take one height, so every lane's cards start level. `.column` (a lane), `.column-head` with a `.stage-mark` (a
  small dot in the stage's color) and a `.badge` count (quiet at zero), `.column-empty`: words and a
  small icon, no box. Loading and a failed load are said the same quiet way in each lane.
- **`.qcard`**: customer (or "Customer not set") to two lines, title to two lines, number · owner and
  last change, then a status block: departments with their state, the customer's date (`Due plain`),
  and the next step (`.act` in tones `do` and `ask` amber and bold, `fix` amber, `late` red, `done`
  green, `wait` and `plain` neutral), taken only from what the board knows. Money is always at the right
  of the last row. Hover raises the card; keyboard focus draws a blue outline around it.

## Checks

`tests/browser/theme.spec.ts` checks choosing, remembering and following the computer's theme, and that
the saved theme is on before the app's script runs. `tests/browser/board.spec.ts` checks the cards' next steps, the summary filters, search, scope, opening a
card from the keyboard, no sideways page scroll at 950px and 390px, the board scrolling inside itself,
and the phone menu.
