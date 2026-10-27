---
version: alpha
name: syafwan CMS
description: Working-tool UI for the private areas of syafwan.com (/agent /finance /accounts /sejarahpersib). Flat, hairline-ruled, zero radius, zero shadow. Same colours and type as the public site, scaled down to tool density.
colors:
  primary: "#000000"
  secondary: "#6b6b6b"
  tertiary: "#f05a24"
  neutral: "#ffffff"
  surface: "#f6f8f7"
  rule: "#e5e5e5"
  rule-strong: "#cccccc"
  waiting: "#f0a800"
  carbon: "#0f0e12"
typography:
  h1:
    fontFamily: Inter Variable
    fontSize: 28px
    fontWeight: 300
    lineHeight: 1.15
  h2:
    fontFamily: Inter Variable
    fontSize: 19px
    fontWeight: 400
    lineHeight: 1.15
  body-md:
    fontFamily: Inter Variable
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: Inter Variable
    fontSize: 13px
    fontWeight: 300
    lineHeight: 1.4
rounded:
  none: 0px
spacing:
  tight: 4px
  inline: 8px
  control: 11px
  stack: 15px
  head: 22px
  section: 33px
  page: 66px
components:
  button:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    rounded: "{rounded.none}"
    padding: 11px
  button-solid:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.none}"
    padding: 11px
  tag-fail:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.none}"
    padding: 4px
  notice:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    padding: 11px
---

## Overview

Scope: the private CMS only. The public landing pages use the same colour and type tokens from `global.css` but none of the files described here; a test (`tests/css-scope.test.ts`) fails if CMS CSS could reach them. Mood: a quiet instrument panel after teenage.engineering, white page, hairline rules, thin type only at large sizes, status colour rationed (orange = failed, amber = waiting, black = fine).

Source of truth in code: `styles/global.css` (colours, type, base scale), `styles/cms-layout.css` (CMS tokens and page rhythm), `styles/cms/*.css` (components, in cascade order, listed in `styles/cms/index.css`). This file explains the why; the CSS holds the values. The live catalog is `/agent/design`.

## Colors

- **Primary (#000000):** text, rules that matter, solid buttons. The only high-emphasis action on a page is one solid button.
- **Secondary (#6b6b6b):** muted text. The only grey that passes AA on white; `#b2b2b2` is for carbon backgrounds only.
- **Tertiary (#f05a24):** failure and destructive actions. Never decoration.
- **Waiting (#f0a800):** paused / waiting notices.
- **Surface (#f6f8f7) and rule (#e5e5e5):** cells, header rows, hairlines.

## Typography

Inter Variable only. Weights 200/300 are for large text (page title, figures); body and captions use 300/400 at 16px and 13px. No italics, no all-caps labels.

## Layout

Everything uses one scale: 4, 8, 11, 15, 22, 33, 66 px (`--s-4 ... --s-66`). Hairlines (0, 1, 2 px) are the only literals allowed in margin, padding and gap; `tests/css-spacing.test.ts` rejects the rest.

Rule of proximity: space inside a group < space between groups < space between sections.

Vertical rhythm of a page (`.container.page`) in `cms-layout.css`. `.page` is a flex column whose `gap` is `--gap-section` (33); an element that introduces what follows pulls it closer with a negative bottom margin (`--pull-*`). Hidden children (inline scripts, an empty notice, a closed dialog) are `display:none` and take no part. Do not use `+` sibling selectors for gaps: they see those hidden siblings.

- after the page head, tabs or a notice: `--gap-head` (22)
- after a filter bar, before the content it filters: `--gap-lead` (15)
- back link above a detail title: 11
- section after section, a footnote after content, and any element without a role: `--gap-section` (33)
- a second footnote right under the first: 8

Inside components: `--gap-tight` (4) icon and label, `--gap-inline` (8) items on a line, `--gap-stack` (15) items stacked in a card or form, `--pad-control` (11) inputs and buttons, `--pad-row` / `--pad-row-y` list rows, `--pad-dialog` (22).

## Elevation & Depth

None. No shadows, no blur, no gradients. Depth is a hairline or a surface tint. A dialog is a bordered box over a dimmed page.

## Shapes

Zero radius everywhere (`rounded.none`). Status dots are the one round thing.

## Components

- **Feed row** (`.update`): 150px date column, then title, tags, text, actions. Used by Updates and Feedback. Padding `--pad-card`/22 per row, hairline between rows.
- **Filter bar** (`FilterBar.astro`): dropdowns and a search box in one GET form, so every state is a URL.
- **Type tabs** (`TypeTabs.astro` / `.type-tabs`): underline tabs with counts.
- **Dialog** (`scripts/dialog.ts`, `.dlg`): native `<dialog>`. Fields are `.dlg-field`; inputs, selects and textareas share one look.
- **Notice** (`.notice`): left bar, amber = waiting, orange = error.
- **Row actions** (`.row-actions`): text buttons at the end of a list row; one definition for every list.

## Do's and Don'ts

- Do put styles shared by two pages in `styles/cms/`. A `<style is:global>` in a page ships with that page only, so a second page using the same class renders unstyled.
- Do give a new element a role in the rhythm instead of a margin; if it needs a new gap, add a token.
- Do not type `margin`, `padding` or `gap` in px (other than 0/1/2). Use a token.
- Do not add selectors for the CMS to `global.css`, and do not import `styles/cms/*` anywhere except `layouts/HermesShell.astro`.
- Do not use colour as the only signal; status always has text.

## Known issues

- `tag-fail` (white text on #f05a24) measures 3.18:1, below WCAG AA 4.5:1 for small text. Found by `design.md lint`; not changed in the spacing work because it alters the look. Candidate fix: black text on the orange (6.6:1) or a darker orange.
- The colour tokens `rule`, `rule-strong`, `waiting` and `carbon` are used in CSS but not by the components listed in the front matter, so the linter reports them as orphaned.
