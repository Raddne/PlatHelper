# Changelog

Patch notes for every PlatHelper release. The release workflow copies the section of the version being released to the top of the GitHub release, above the generated "Full Changelog" link, and refuses to publish a version that has no section here.

Keep every bullet on one line: GitHub shows a line break inside release notes as a line break.

## v0.1.2

- The title bar now says PLATHELPER instead of WFHELPER.
- "What's new" window: nested bullet points from the patch notes show as one tidy list.
- **Live Scraper:** the Stock and Wishlist boxes are add forms only now - every tracked item is shown, edited and removed in the Listings panel below. Nothing you already track is lost.
- Your Live Scraper lists survive updates; if a list file ever cannot be read, a backup copy is kept next to it instead of being overwritten.

## v0.1.1

- **Rivens tab:** right-click a riven card for two new actions.
  - *Search this roll on warframe.market* opens the auction search for the same weapon and stats, cheapest first.
  - *List at the lowest price...* asks whether only online sellers should count, shows the cheapest comparable price and posts the auction once you confirm. The riven is added to the Live Scraper, which manages the listing from its next run.
- Releases now come with patch notes.

## v0.1.0

First PlatHelper release, based on WFHelper v2.0.0.

- **Live Scraper:** automated warframe.market trading - buys profitable items from a full catalog scan, keeps sell orders for your stock competitive (existing sell orders are picked up), fills a wishlist, and sells rivens. Listings panel with inline price limits and a right-click menu per row.
- **Messages tab:** your warframe.market chats - live incoming messages, reply, delete, unread counter in the sidebar.
- **Sidebar:** drag to reorder with an insertion line, groups, layout presets.
- **Comfort:** `Ctrl` + mouse wheel zoom, mouse back/forward navigation.
- Installer and portable zip; an existing WFHelper profile is copied on first start.
