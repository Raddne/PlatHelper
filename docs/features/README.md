# Feature guides

The Markdown files in this folder are the guides opened by the in-app Help
buttons (`src/components/DocsLink.svelte`), rendered on GitHub. Write the
guide, keep it valid against the rules below, and
`pnpm run test -- tests/main/docsGuides.test.ts` checks those rules. This
README is not published.

## When to edit

Change the guide in the same commit as the feature it describes. Check the steps
against the app, use the exact UI labels, and keep heading anchors that other
guides link to. Only finished guides are published; do not add placeholder
pages. Mark a beta feature as beta in the text.

The in-app help buttons open `/docs/getting-started` and `/docs/inventory`
(`src/components/DocsLink.svelte`), so those two files keep their names.

## File format

One file per guide, named `<slug>.md` with lowercase letters, digits and single
hyphens; `index` is reserved. Front matter first, then the body starting at an
h2:

```
---
title: Inventory
summary: One sentence for the index card and the page description.
group: Features
order: 2
version: "2.0"
view: inventory
screenshot: docs-inventory.png
screenshotAlt: What the screenshot shows, for screen readers.
screenshotCaption: One line under the screenshot.
---

## First section
```

- One `key: value` per line. `title`, `summary`, `group`, `version`,
  `screenshot`, `screenshotAlt` and `screenshotCaption` are required.
- `group` is one of `Start here`, `Features`, `Overlays`, `Help`. `order` is a
  number that sorts guides within the group.
- `version` is the app version the text describes.
- `view` is optional and names the app view the guide covers (ids in
  `src/types/views.ts`).
- `screenshot` names an image the site maintainer captures from the e2e harness
  with fixture data, never from a real account. Describe the wanted screen in the
  pull request; the file is added on the site side.

## Body rules

- Start at `##`; the title comes from the front matter. Use `###` for
  subsections.
- Plain Markdown only: headings, paragraphs, lists, bold, inline code and links.
  No raw HTML and no images; the page shows the front-matter screenshot.
- Links: `#anchor` within the page, `/docs/<slug>` or `/docs/<slug>#anchor` to
  another guide, absolute `https://` elsewhere. An anchor is the heading text
  lowercased with runs of other characters replaced by `-`. A link to a guide or
  heading that does not exist fails the build.
- Each guide covers the purpose, prerequisites, the steps, how to read the
  output, limits, and where to get help.
- The prose stays English. The app's translation dictionaries hold UI labels
  only.
