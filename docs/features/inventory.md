---
title: Inventory
summary: Item categories, market prices, value estimates, and bulk selling.
group: Features
order: 2
version: "2.0"
view: inventory
screenshot: docs-inventory.png
screenshotAlt: PlatHelper Inventory with item categories, value estimates, filters, and owned item cards.
screenshotCaption: Inventory with sample data.
---

## Before you start

Connect an inventory source using [Getting started](/docs/getting-started#choose-an-inventory-source). Public price lookups do not require a warframe.market sign-in. Creating or changing your own listings does.

Item counts come from your last inventory snapshot. Market prices update separately. After a trade, allow time for inventory to refresh.

## Find an item

1. Open **Inventory** in the sidebar.
2. Pick a category, or use **Everything** to search across several categories. Its **Include** controls choose which groups appear.
3. Enter an item name in the search field. Change the sort order to compare the results.
4. Use **Filters** to narrow the list further. If an owned item seems missing, clear the search and active filters, then check its category.

The category tabs separate parts, relics, mods, arcanes, full sets, built equipment, pets, resources, and miscellaneous items. Equipment and resource views are useful for ownership even when an item has no market price.

### Check complete sets

Open **Full Sets** to see sets assembled from your owned parts. Enable **Show incomplete sets** to include sets with missing components.

A set groups your owned parts. Selling a part reduces the number of complete sets available.

## Read prices and listings

Select a market item to inspect its current buy and sell orders. Compare those orders with the historical sale average before choosing a price.

- **WTS** means a seller's asking price; **WTB** means a buyer's offer.
- **R0** means unranked. Other rank labels distinguish ranked mod or arcane prices.
- **Ducats** show the exchange value where applicable; not every tradable item can be exchanged for ducats.
- A missing price means no usable price is available yet.

Check the item's rank, variant, and quantity before listing it. Built equipment differs from the tradable blueprints or parts used to craft it.

## Understand the value estimate

**Est. value** multiplies owned quantities by warframe.market 48-hour average sale prices. Actual sale prices may differ.

- **In view** follows the items in the current view and its filters.
- **Whole inventory** covers the selected valuation scope beyond those view filters.
- **Prime parts only** limits the calculation to prime parts. **All tradables** includes other tradable items such as mods and arcanes.
- The minimum-platinum control excludes priced items below the selected per-item threshold.

Set rows are skipped because their parts are already counted. Ducat totals count prime parts. A **≥** value with an **unpriced** count means some items lack prices, so the displayed total is incomplete. Unpriced items remain counted even when a minimum price is selected.

## Review what to keep

Before selling, check the item's reservation information. Depending on your settings and goals, PlatHelper can reserve copies for mastery, pinned crafting goals, full sets, spare copies, or manual locks.

Hover a reservation indicator to see why copies are being kept. **Safe to sell** uses your current rules and inventory snapshot; check it against your plans before selling.

Use **Foundry** for crafting requirements and **Mastery** for equipment you have yet to master.

## Select items for bulk selling

1. Open **Bulk Sell** in the inventory controls to enter selection mode.
2. Select eligible items, or use the control to select all eligible filtered results.
3. Optionally name and save the selection if you want to use that group again.
4. Choose **Bulk sell** to review the selected items.
5. Check the proposed quantities, ranks or variants, and prices before confirming any listings. Sign in to warframe.market when required.

Listings are created after review and confirmation. Complete the trade with the buyer in Warframe.

## If something looks wrong

- **No items found:** clear the search and filters, then check another category. If every category is empty, check your inventory source in Settings.
- **A crafted blueprint still appears:** blueprint data can remain until the Foundry build is claimed and a newer snapshot loads.
- **A price is missing:** allow market data to load and inspect current orders. Some inventory items are not tradable.
- **A set appears alongside its parts:** this is a grouped view. The value estimate avoids counting the set twice.
- **A quantity has not changed after a trade:** see [inventory refresh and imports](/docs/getting-started#choose-an-inventory-source).

For setup and capture problems, return to [Getting started](/docs/getting-started#if-setup-gets-stuck). For an inventory mismatch that persists, report the app version, source type, item name, and expected quantity through [GitHub Issues](https://github.com/Raddne/PlatHelper/issues).
