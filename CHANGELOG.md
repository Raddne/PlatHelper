# Changelog

Patch notes for every PlatHelper release. The release workflow copies the section of the version being released to the top of the GitHub release, above the generated "Full Changelog" link, and refuses to publish a version that has no section here.

Keep every bullet on one line: GitHub shows a line break inside release notes as a line break.

## v0.2.0

- **PlatHelper now runs on Linux.** Every release ships an `.AppImage`, a `.deb` (Ubuntu, Debian, Mint) and an `.rpm` (Fedora, openSUSE).
- One-command install and update on Linux: `curl -fsSL https://github.com/Raddne/PlatHelper/releases/latest/download/install-linux.sh | sudo sh` (see the README).
- Updating on Linux: the AppImage updates itself from inside the app; for the `.deb` and `.rpm`, run the install command again.

## v0.1.9

- Price data now comes from PlatHelper's own backend instead of the upstream project's server.
- Removed the upstream project's branding, donation buttons and links; the app now carries its own icon.
- Feedback is back in the sidebar and goes to PlatHelper's own backend.

## v0.1.6

- Maintenance release: internal cleanup, no changes to existing features.

## v0.1.5

- **Simplified Chinese:** Live Scraper, Messages, sidebar presets and the riven shortcuts are now translated (Settings > Language > 简体中文).
- **Live Scraper picks up your existing riven auctions.** Auctions you already have on warframe.market appear under Rivens and are re-priced like the rest; the price you listed them at becomes their minimum price. A picked-up auction that is sold or closed simply disappears from the list and is never re-created.
- A riven you added by hand that is already listed on warframe.market is linked to that auction instead of being listed a second time.
- Listings panel: very long lists show the first 300 rows and point to the search box for the rest, so the view stays fast.

## v0.1.4

- **Live Scraper with many listings is much more responsive.** The status used to stay on "Cleaning up orders..." while the scraper was really working through every sell listing; it now shows what it is doing ("Selling 12/40: item name").
- Listings are processed in rotating blocks of 40 per pass, so Stop, setting changes, buy orders and rivens no longer wait for a full round over hundreds of listings.
- After the first round each listing needs one warframe.market request instead of two, which roughly halves the time for a full round. A full round over several hundred listings still takes minutes: warframe.market only allows about three requests per second.
- Picking up hundreds of existing sell listings on first start is faster.

## v0.1.3

- **Important fix - Live Scraper no longer deletes buy orders you placed yourself.** With "Auto-delete" on (the default), starting the scraper used to remove every buy order on the account during "Cleaning up orders". It now only ever deletes orders it created itself; orders you placed by hand are never deleted, re-priced or taken down by the automatic passes.
- Buy orders the scraper created before this update count as yours from now on: they are left alone until you remove them yourself.
- **Live Scraper:** an existing sell listing that gets picked up keeps the price you listed it at as its minimum price, so the scraper never undercuts what you asked for. You can change or clear the minimum per row in the Listings panel.
- **Listings panel:** select several rows with `Ctrl` + click, a whole range with `Shift` + click. Right-click the selection to set a price for all of them, pause, resume or remove them in one go. `Esc` clears the selection.
- **Listings panel:** new search box to filter the list by item name.
- **New sell setting "Min above lowest listing":** lists your items a fixed amount of platinum above the cheapest other seller instead of matching their price.

## v0.1.2

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
