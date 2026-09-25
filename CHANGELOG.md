# Changelog

Patch notes for every PlatHelper release. The release workflow copies the section of the version being released to the top of the GitHub release, above the generated "Full Changelog" link, and refuses to publish a version that has no section here.

Keep every bullet on one line: GitHub shows a line break inside release notes as a line break.

## v0.2.5

- **Fix: riven prices.** The Live Scraper priced a riven only from listings with exactly its stats; with none found it fell back to your bought price plus the minimum profit, which listed rivens bought for 0p at 26p, and a lone overpriced identical roll set the price alone (a Boar riven went up at 9500p). It now prices from the identical roll when at least three fixed-price listings exist, otherwise from listings with the same positive stats, otherwise from listings with the stats that matter for the weapon (the good-roll data). Bid auctions never count, only fixed-price listings do.
- **No comparable listing, no auction.** A riven without a comparable price is not listed: its auction is closed and the row shows "No sellers" until a price can be found. An auction you listed yourself is left as it is.
- **Fix: duplicate riven auctions.** After a rate limit the scraper dropped the auction id, created a second auction for the same riven on the next pass, and adopted the first one as a second row, because a row named "Boar Sati-hexatis" was never matched to the auction named "sati-hexatis". Update failures now keep the id, the pass stops when warframe.market rate-limits it, the account's own auction list decides whether an auction is still up, and rows match their auctions by the riven name alone. Existing duplicates: delete the extra rows in Listings > Rivens, each delete closes its auction.
- A failed search or a rate limit no longer counts as "nothing listed": the riven keeps its auction and price until the next pass.
- Riven settings: -1 really disables the sample size and the price threshold now; before, it priced every riven as if nothing were listed.

## v0.2.4

- **Live Scraper settings: a Riven checkbox** sits next to Buy, Sell and Wishlist and replaces the Syndicate checkbox (Syndicate mode never did anything). Tick only Riven to sell your rivens and leave items alone; the "Engine mode" dropdown is gone, your earlier choice carries over.
- **Fix: riven auctions with bids.** The Live Scraper picked up riven auctions that take bids from warframe.market and then failed every price update on them ("bids exist"). It now takes over direct-sell riven auctions only and leaves real auctions to you.

## v0.2.3

- **Live Scraper: hide or show your listings on warframe.market.** Every Listings tab (WTB, WTS, Rivens) has an "On WFM: Visible | Hidden" switch next to the search box. With rows marked it switches only those, otherwise the whole tab.
- New listings follow the same state: a hidden row's next order or auction is created hidden, and switching a whole tab also sets how its new rows start.
- The Status column shows "Hidden on WFM" for a listing other players cannot see, and it picks up changes you make in the Market tab or on warframe.market.
- Pause still takes a listing down; hiding keeps it on warframe.market, just invisible to other players.

## v0.2.2

- Linux: PlatHelper now tells a sandboxed start (appimage-run, steam-run, Flatpak; the usual case on NixOS) apart from a real `kernel.yama.ptrace_scope` block and shows "WF unreachable from sandbox" with the fix: start PlatHelper outside the sandbox.
- Docs: the Linux guide explains why reading Steam's Proton container normally needs no setup, and lists the sysctl only as the fallback.

## v0.2.1

- Linux: a blocked game-memory read (`kernel.yama.ptrace_scope`, the kernel default on NixOS, Ubuntu, Debian and Arch) now shows "WF memory blocked (ptrace_scope)" with the sysctl to set, instead of wrongly claiming that Warframe runs as administrator.
- Docs: README and the getting-started guide explain the ptrace setting for Linux, including the NixOS configuration line.

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
