import { computeRivenStatSimilarity } from "./riven-similarity.js";
import { sheetCellTokens } from "./riven-sheet-rolls.js";

const _side = new URLSearchParams(window.location.search).get("side") || "left";
const _isLeft = _side === "left";

let _rollCount = 0;
let _overlayInteractiveMode = false;
/** Whether this panel currently has real stats displayed (not "Waiting for roll..."). */
let _hasDisplayedStats = false;
/** Buffered enrichment data - rendered when panel gets stats. */
let _pendingGoodRolls = null;
let _pendingListings = null;
/** The panel's stat codes by sign and its good sheet row, from the last grading. */
let _sheetCodes = null;
let _sheetGoodRow = null;

// Every panel string is rebuilt from this state, so a language change needs no rescan.
let _scanningKey = "overlay.riven.scanning";
let _bannerKey = "overlay.riven.readFailed";
let _renderedStats = [];

const t = window.overlayI18n.t;
function el(id) {
  return document.getElementById(id);
}

let _interactionHotkey = null;

/* Label follows the live interaction hotkey; stays hidden while unbound. */
function renderInteractionHint() {
  const hint = el("interaction-hint");
  if (!hint) return;
  const label = String(_interactionHotkey || "")
    .replace(/CommandOrControl|Control/g, "Ctrl")
    .replace(/Command/g, "Cmd")
    .replace(/\+/g, " + ");
  hint.textContent = label ? t("overlay.hint.interact", { hotkey: label }) : "";
  hint.classList.toggle("is-hidden", _overlayInteractiveMode || !label);
}

function setOverlayInteractiveMode(interactive) {
  _overlayInteractiveMode = !!interactive;
  const closeButton = el("btn-close");
  if (closeButton) closeButton.classList.toggle("is-hidden", !_overlayInteractiveMode);
  const rescanButton = el("btn-rescan");
  if (rescanButton)
    rescanButton.classList.toggle("is-hidden", !_overlayInteractiveMode || !_isLeft);
  renderInteractionHint();
  if (!_overlayInteractiveMode) {
    document.documentElement.classList.remove("is-overlay-dragging");
  }
}

/** Map a letter grade string to its CSS class suffix. */
function gradeClass(grade) {
  if (!grade || grade === "?") return "grade-unknown";
  // "A+" -> "grade-Ap", "A-" -> "grade-Am", "B+" -> "grade-Bp", etc.
  const sanitised = String(grade)
    .replace("+", "p")
    .replace("-", "m")
    .replace(/[^A-Za-z]/g, "");
  return "grade-" + (sanitised || "unknown");
}

/** Create a grade badge span. */
function buildGradeBadge(grade, large) {
  const badge = document.createElement("span");
  badge.className = "grade-badge " + gradeClass(grade) + (large ? " grade-large" : "");
  badge.textContent = grade || "?";
  return badge;
}

/** Map roll float (0-1) to a colour for the progress bar. */
function rollBarColor(rollFloat, isCurse) {
  // For curses, lower float = better (stat is less penalising)
  var pct = isCurse ? 1 - rollFloat : rollFloat;
  if (pct >= 0.85) return "var(--ok)";
  if (pct >= 0.6) return "var(--accent)";
  if (pct >= 0.35) return "var(--warn)";
  return "var(--bad)";
}

function buildStatRow(stat) {
  const row = document.createElement("div");
  row.className = "stat-row" + (stat.positive ? " stat-positive" : " stat-negative");

  // Colored quality dot
  var dot = document.createElement("span");
  dot.className = "stat-dot";
  if (stat.grade && stat.grade !== "?") {
    dot.classList.add(gradeClass(stat.grade));
  }
  row.appendChild(dot);

  const valueEl = document.createElement("span");
  if (stat.multiplier && stat.value != null) {
    valueEl.textContent = "x" + stat.value;
    valueEl.className = "stat-value " + (stat.positive ? "pos" : "neg");
  } else {
    const displayPositive =
      typeof stat.displayPositive === "boolean" ? stat.displayPositive : stat.positive;
    const sign = displayPositive ? "+" : "\u2212";
    if (stat.value != null) {
      valueEl.textContent = sign + stat.value + "%";
    } else {
      valueEl.textContent = sign;
    }
    valueEl.className = "stat-value " + (stat.positive ? "pos" : "neg");
  }

  const nameEl = document.createElement("span");
  nameEl.className = "stat-name";
  nameEl.textContent = stat.name;

  row.appendChild(valueEl);
  row.appendChild(nameEl);

  // Grade letter badge
  if (stat.grade && stat.grade !== "?") {
    const badge = buildGradeBadge(stat.grade);
    badge.classList.add("stat-grade");
    row.appendChild(badge);
  }

  // Roll quality progress bar
  if (stat.rollFloat != null && stat.grade && stat.grade !== "?") {
    var barWrap = document.createElement("div");
    barWrap.className = "roll-bar-wrap";
    var barFill = document.createElement("div");
    barFill.className = "roll-bar-fill";
    var pct = Math.round(Math.max(0, Math.min(1, stat.rollFloat)) * 100);
    barFill.style.width = pct + "%";
    barFill.style.setProperty("--roll-grade-color", rollBarColor(stat.rollFloat, !stat.positive));
    barWrap.appendChild(barFill);
    row.appendChild(barWrap);
  }

  return row;
}

function renderStats(stats) {
  const container = el("stats-container");
  const list = el("stats-list");
  const errorEl = el("error-banner");
  if (!container || !list) return;

  // New stats drop the codes graded for the old ones until their grading arrives.
  if (stats !== _renderedStats) {
    _sheetCodes = null;
    _sheetGoodRow = null;
  }
  _renderedStats = Array.isArray(stats) ? stats : [];
  list.innerHTML = "";

  if (_renderedStats.length === 0) {
    _hasDisplayedStats = false;
    const empty = document.createElement("div");
    empty.className = "stat-empty";
    empty.textContent = t(
      _isLeft ? "overlay.riven.waitingForScan" : "overlay.riven.waitingForRoll",
    );
    list.appendChild(empty);
    container.classList.remove("is-hidden");
    if (errorEl) errorEl.classList.remove("visible");
    // Hide enrichment sections when no stats
    el("good-rolls").classList.add("is-hidden");
    el("similar-listings").classList.add("is-hidden");
    return;
  }

  _hasDisplayedStats = true;
  if (errorEl) errorEl.classList.remove("visible");
  for (const stat of _renderedStats) {
    list.appendChild(buildStatRow(stat));
  }
  container.classList.remove("is-hidden");

  _currentStats = statsToMatchable(_renderedStats);
  _currentStatNamesLc = _currentStats.map(function (s) {
    return s.name;
  });

  // Flush any buffered enrichment now that we have stats
  if (_pendingGoodRolls) renderGoodRolls(_pendingGoodRolls);
  if (_pendingListings) renderSimilarListings(_pendingListings);
}

function renderErrorBanner() {
  const banner = el("error-banner");
  if (banner) banner.textContent = t(_bannerKey);
}

/** Show the error banner with a reason instead of an endless "Waiting" spinner. */
function showScanError(messageKey) {
  hideScanning();
  _hasDisplayedStats = false;
  _renderedStats = [];
  el("stats-container").classList.add("is-hidden");
  el("good-rolls").classList.add("is-hidden");
  el("similar-listings").classList.add("is-hidden");
  _bannerKey = messageKey;
  renderErrorBanner();
  const banner = el("error-banner");
  if (banner) banner.classList.add("visible");
}

/** State: current stat names (lowercase) for WFM similarity matching. */
let _currentStatNamesLc = [];
/** State: current stats as { name (lowercase), positive }. */
let _currentStats = [];

function statsToMatchable(stats) {
  return stats.map(function (s) {
    return { name: (s.name || "").toLowerCase(), positive: s.positive !== false };
  });
}

// The verdict badge per roll sheet rating; a weapon the sheet lacks says so.
const SHEET_BADGES = {
  good: { key: "overlay.riven.sheet.goodRoll", look: "attr-grade-great" },
  "one-positive-off": { key: "overlay.riven.sheet.onePositiveOff", look: "attr-grade-ok" },
  "unlisted-negative": { key: "overlay.riven.sheet.unlistedNegative", look: "attr-grade-ok" },
  "not-good": { key: "overlay.riven.sheet.notGood", look: "attr-grade-neutral" },
};
const NOT_IN_SHEET_BADGE = { key: "overlay.riven.sheet.notInSheet", look: "attr-grade-neutral" };
let _verdictBadge = null;

function sheetBadge(sheet) {
  if (!sheet) return null;
  if (!sheet.weapon) return NOT_IN_SHEET_BADGE;
  return SHEET_BADGES[sheet.rating] || null;
}

function renderOverallGrade(sheet) {
  const wrapper = el("overall-grade");
  const badge = el("overall-grade-badge");
  if (!wrapper || !badge) return;

  // Stats the sheet cannot judge get no badge.
  _verdictBadge = sheetBadge(sheet);
  if (!_verdictBadge) {
    wrapper.classList.add("is-hidden");
    return;
  }

  badge.className = "attr-grade-badge " + _verdictBadge.look;
  badge.textContent = t(_verdictBadge.key);
  wrapper.classList.remove("is-hidden");
}

function renderVerdictText() {
  const badge = el("overall-grade-badge");
  if (badge && _verdictBadge) badge.textContent = t(_verdictBadge.key);
}

// Grading arrives through a later IPC event, so rebuild the existing stat rows.
function applyGradingToStats(gradingResult) {
  if (!gradingResult) return;
  const { stats, sheet } = gradingResult;

  renderOverallGrade(sheet);

  if (!Array.isArray(stats)) return;

  // Re-render stats with grading info baked in
  const list = el("stats-list");
  const container = el("stats-container");
  if (!list || !container) return;

  _renderedStats = stats;
  list.innerHTML = "";
  for (const stat of stats) {
    list.appendChild(buildStatRow(stat));
  }
  container.classList.remove("is-hidden");

  _currentStats = statsToMatchable(stats);
  _currentStatNamesLc = _currentStats.map(function (s) {
    return s.name;
  });
  _sheetCodes = sheet
    ? { positives: sheet.positives || [], negatives: sheet.negatives || [] }
    : null;
  _sheetGoodRow = sheet && sheet.rating === "good" ? sheet.sheetRow : null;
  refreshGoodRollHighlights();
}

function onGradingInitial(grading) {
  if (_isLeft) {
    applyGradingToStats(grading);
  }
}

function onGradingRoll(payload) {
  if (!payload) return;
  const side = _isLeft ? payload.left : payload.right;
  applyGradingToStats(side);
}

/* One sheet cell as a chip of its raw text; each stat token carries its code and,
   as a hover hint, the stat's full name. The negatives cell reads "- Z / IMP". */
function buildSheetChip(text, codes, side, labels) {
  const chip = document.createElement("span");
  chip.className = "sheet-chip " + side;
  if (side === "neg") chip.appendChild(document.createTextNode("\u2212 "));
  for (const part of sheetCellTokens(String(text || ""), codes)) {
    const span = document.createElement("span");
    span.textContent = part.text;
    if (part.code) {
      span.className = "sheet-token";
      span.dataset.code = part.code;
      if (labels[part.code]) span.title = labels[part.code];
    }
    chip.appendChild(span);
  }
  return chip;
}

/* The weapon's sheet rows: three positive cells, then the accepted negatives. */
function renderGoodRolls(payload) {
  _pendingGoodRolls = payload;

  // Don't render if panel has no stats yet (right panel before first roll)
  if (!_hasDisplayedStats) return;

  const wrapper = el("good-rolls");
  const list = el("good-rolls-list");
  if (!wrapper || !list) return;

  list.innerHTML = "";
  const rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
  if (rows.length === 0) {
    wrapper.classList.add("is-hidden");
    return;
  }
  const labels = payload.labels || {};
  for (const row of rows) {
    const line = document.createElement("div");
    line.className = "sheet-row";
    line.dataset.sheetRow = String(row.sheetRow);
    if (row.note) line.title = row.note;
    const slotCodes = Array.isArray(row.slotCodes) ? row.slotCodes : [];
    const positives = Array.isArray(row.positives) ? row.positives : [];
    for (let i = 0; i < 3; i++) {
      line.appendChild(buildSheetChip(positives[i], slotCodes[i], "pos", labels));
    }
    line.appendChild(buildSheetChip(row.negatives, row.negativeCodes, "neg", labels));
    list.appendChild(line);
  }

  wrapper.classList.remove("is-hidden");
  refreshGoodRollHighlights();
}

// Keyed and valued in English: the scan, the grading tables and the WFM search
// all speak these stat names, so a translated chip could not be matched back.
var STAT_ABBREVIATIONS = {
  "critical chance": "CritCh",
  "critical damage": "CritDmg",
  multishot: "Multi",
  damage: "Dmg",
  "melee damage": "Dmg",
  "status chance": "Status",
  "attack speed": "AtkSpd",
  electricity: "Elec",
  toxin: "Toxin",
  heat: "Heat",
  cold: "Cold",
  range: "Range",
  zoom: "Zoom",
  "ammo maximum": "Ammo",
  "weapon recoil": "Recoil",
  "projectile speed": "ProjSpd",
  "finisher damage": "Finisher",
  "heavy attack efficiency": "HvyAtk",
  "combo duration": "Combo",
  "slide attack": "Slide",
  "reload speed": "Reload",
  "fire rate": "FireRate",
};

/** Abbreviate long stat names for compact chip display. */
function abbreviateStat(name) {
  return STAT_ABBREVIATIONS[name.toLowerCase()] || name;
}

// A token lights up when the panel's riven has that stat with the cell's sign; the
// row that made the roll good gets an outline.
function refreshGoodRollHighlights() {
  const codes = _sheetCodes || { positives: [], negatives: [] };
  document.querySelectorAll(".sheet-chip").forEach((chip) => {
    const owned = chip.classList.contains("neg") ? codes.negatives : codes.positives;
    chip.querySelectorAll(".sheet-token").forEach((token) => {
      token.classList.toggle("matched", owned.includes(token.dataset.code));
    });
  });
  document.querySelectorAll(".sheet-row").forEach((row) => {
    const good = _sheetGoodRow !== null && row.dataset.sheetRow === String(_sheetGoodRow);
    row.classList.toggle("is-good", good);
  });
}

function renderSimilarListings(listings) {
  _pendingListings = listings;

  // Don't render if panel has no stats yet (right panel before first roll)
  if (!_hasDisplayedStats) return;

  var wrapper = el("similar-listings");
  var list = el("similar-list");
  if (!wrapper || !list) return;

  list.innerHTML = "";

  if (!Array.isArray(listings) || listings.length === 0) {
    wrapper.classList.add("is-hidden");
    return;
  }

  var myStats = _currentStatNamesLc.slice();
  var enriched = [];
  for (var i = 0; i < listings.length; i++) {
    var sim = computeRivenStatSimilarity(myStats, listings[i].stats);
    enriched.push({ item: listings[i], pct: sim.pct, matchedNames: sim.matchedNames });
  }
  enriched.sort(function (a, b) {
    return b.pct - a.pct;
  });

  for (var k = 0; k < enriched.length; k++) {
    var item = enriched[k].item;
    var pct = enriched[k].pct;
    var matchedNames = enriched[k].matchedNames;

    var card = document.createElement("div");
    card.className = "listing-card";
    if (item.id) {
      card.setAttribute("data-auction-id", item.id);
      card.style.cursor = "pointer";
      card.addEventListener(
        "click",
        (function (aid) {
          return function () {
            window.rivenOverlay.openAuction(aid);
          };
        })(item.id),
      );
    }

    var simEl = document.createElement("div");
    simEl.className = "listing-similarity";
    if (pct >= 75) simEl.classList.add("sim-high");
    else if (pct >= 40) simEl.classList.add("sim-medium");
    else simEl.classList.add("sim-low");
    simEl.textContent = t("overlay.riven.matchPercent", { percent: pct });
    card.appendChild(simEl);

    var topRow = document.createElement("div");
    topRow.className = "listing-card-top";

    var priceEl = document.createElement("span");
    priceEl.className = "listing-price";
    var price = item.buyoutPrice || item.startingPrice || item.platinum || 0;
    const priceValue = document.createElement("span");
    priceValue.className = "listing-price-value";
    priceValue.textContent = String(price);
    const priceUnit = document.createElement("span");
    priceUnit.className = "listing-price-unit";
    priceUnit.textContent = "p";
    priceEl.append(priceValue, priceUnit);
    topRow.appendChild(priceEl);

    var rerollsEl = document.createElement("span");
    rerollsEl.className = "listing-rerolls";
    rerollsEl.textContent = t("overlay.riven.rolls", { count: item.rerolls || 0 });
    topRow.appendChild(rerollsEl);

    card.appendChild(topRow);

    // Stat lines (vertical, one per line) - cross out non-matching stats
    if (Array.isArray(item.stats)) {
      var statsCol = document.createElement("div");
      statsCol.className = "listing-stats-col";
      for (var j = 0; j < item.stats.length; j++) {
        var s = item.stats[j];
        var sname = (s.name || "").toLowerCase();
        var isMatch = matchedNames.has(sname);
        var line = document.createElement("div");
        line.className = "listing-stat-line " + (s.positive ? "pos" : "neg");
        if (!isMatch) line.classList.add("crossed");
        var sign = s.positive ? "+" : "\u2212";
        const statValue = document.createElement("span");
        statValue.className = "listing-stat-value";
        statValue.textContent = sign + Math.round(s.value) + "%";
        const statName = document.createElement("span");
        statName.className = "listing-stat-name";
        statName.textContent = abbreviateStat(s.name);
        line.append(statValue, statName);
        statsCol.appendChild(line);
      }
      card.appendChild(statsCol);
    }

    list.appendChild(card);
  }

  wrapper.classList.remove("is-hidden");
}

function renderScanningText() {
  const text = el("scanning-text");
  if (text) text.textContent = t(_scanningKey);
}

function setScanningText(key) {
  _scanningKey = key;
  renderScanningText();
}

function showScanning() {
  el("scanning-state").classList.add("visible");
  el("stats-container").classList.add("is-hidden");
  el("error-banner").classList.remove("visible");
}

function hideScanning() {
  el("scanning-state").classList.remove("visible");
}

function renderRollBadge() {
  const rollBadge = el("roll-badge");
  if (rollBadge) rollBadge.textContent = t("overlay.riven.roll", { count: _rollCount });
}

function renderPanelLabel() {
  const labelEl = el("panel-label");
  if (labelEl) labelEl.textContent = t(_isLeft ? "overlay.riven.current" : "overlay.riven.newRoll");
}

function onSessionStart(weapon) {
  _rollCount = 0;
  _currentStatNamesLc = [];
  _currentStats = [];
  _hasDisplayedStats = false;
  _pendingGoodRolls = null;
  _pendingListings = null;

  el("weapon-name").textContent = weapon || "\u2014";
  setWeaponWarningVisible(false);

  renderRollBadge();

  // Reset stats
  el("stats-container").classList.add("is-hidden");
  el("error-banner").classList.remove("visible");

  // Reset grading + enrichment sections
  el("overall-grade").classList.add("is-hidden");
  el("good-rolls").classList.add("is-hidden");
  el("similar-listings").classList.add("is-hidden");

  // Left panel: show scanning spinner for initial card scan
  // Right panel: show "waiting for roll" placeholder
  if (_isLeft) {
    showScanning();
    setScanningText("overlay.riven.scanningCurrent");
  } else {
    renderStats([]); // shows "Waiting for roll..."
  }
}

function onInitialStats(stats, lowConfidence) {
  hideScanning();
  // Only the left (current) panel uses initial stats
  if (!_isLeft) return;
  if (Array.isArray(stats) && stats.length > 0) {
    renderStats(stats);
  } else {
    showScanError(
      lowConfidence === true ? "overlay.riven.textTooSmall" : "overlay.riven.readFailed",
    );
  }
}

function onScanning() {
  showScanning();
  setScanningText("overlay.riven.scanningRoll");
}

function onRollResult(payload) {
  const { rollCount, left, right } = payload || {};

  _rollCount = Number(rollCount) || _rollCount + 1;

  renderRollBadge();

  hideScanning();

  // Each window displays only its side's data
  const stats = _isLeft ? left : right;
  const hasStats = Array.isArray(stats) && stats.length > 0;

  if (hasStats) {
    renderStats(stats);
  } else {
    showScanError("overlay.riven.rollReadFailed");
  }
}

function onChoiceMade(side) {
  // Show a visual indicator of which choice was made
  const panel = el("panel");
  if (!panel) return;

  if (side === "left" && _isLeft) {
    // User kept old (this panel) - highlight briefly
    panel.style.borderColor = "var(--ok)";
    setTimeout(() => {
      panel.style.borderColor = "";
    }, 2000);
  } else if (side === "right" && !_isLeft) {
    // User took new roll (this panel) - highlight briefly
    panel.style.borderColor = "var(--ok)";
    setTimeout(() => {
      panel.style.borderColor = "";
    }, 2000);
  }

  // Preserve a chosen right-side highlight briefly; otherwise clear stale roll
  // data as soon as the game returns to one card.
  if (!_isLeft) {
    const delay = side === "right" ? 2000 : 0;
    setTimeout(() => {
      renderStats([]); // shows "Waiting for roll..."
    }, delay);
  }

  // Left panel: show scanning spinner while the re-scan runs so the user gets
  // immediate feedback that the overlay is updating.
  if (_isLeft) {
    showScanning();
    setScanningText("overlay.riven.scanningCurrent");
  }
}

function setWeaponWarningVisible(visible) {
  const warning = el("weapon-warning");
  if (warning) warning.classList.toggle("is-hidden", !visible);
}

/* Manual rescan after a FITS IN variant switch: fresh values are coming for
   the current card, and the old roll panel's numbers no longer apply. */
function onRescan() {
  setWeaponWarningVisible(false);
  if (_isLeft) {
    showScanning();
    setScanningText("overlay.riven.rescanning");
  } else {
    el("overall-grade").classList.add("is-hidden");
    renderStats([]); // shows "Waiting for roll..."
  }
}

function onSessionEnd() {
  hideScanning();
  _currentStatNamesLc = [];
  _currentStats = [];
  _hasDisplayedStats = false;
  _pendingGoodRolls = null;
  _pendingListings = null;
  el("overall-grade").classList.add("is-hidden");
  el("good-rolls").classList.add("is-hidden");
  el("similar-listings").classList.add("is-hidden");
}

/* Rebuilds every string this panel writes from JS, for a live language change. */
function renderDynamicText() {
  if (layoutPreviewState) {
    renderLayoutPreview(layoutPreviewState);
    return;
  }
  renderPanelLabel();
  renderRollBadge();
  renderScanningText();
  renderErrorBanner();
  renderInteractionHint();
  renderVerdictText();
  // The banner replaces the stat list, so re-rendering stats would resurrect it.
  const banner = el("error-banner");
  if (banner && banner.classList.contains("visible")) return;
  renderStats(_renderedStats);
}

let layoutEditor = null;
let layoutPreviewState = null;

function tagRivenLayoutFields() {
  const tag = (selector, field, root = document) => {
    const target = root.querySelector(selector);
    if (target) target.dataset.rewardField = field;
  };
  for (const [selector, field] of Object.entries({
    "#panel-label": "panelLabel",
    "#weapon-name": "weaponName",
    "#roll-badge": "rollBadge",
    "#btn-rescan": "rescanButton",
    "#btn-close": "closeButton",
    "#overall-grade-badge": "overallGrade",
    ".scan-spinner": "scanSpinner",
    "#scanning-text": "scanText",
    "#error-banner": "errorText",
    "#weapon-warning": "weaponWarning",
    ".stat-empty": "emptyText",
    "#interaction-hint": "interactionHint",
    "#good-rolls-label": "bestPositiveLabel",
    "#similar-header": "listingsLabel",
  }))
    tag(selector, field);
  document.querySelectorAll(".stat-row").forEach((row, index) => {
    for (const [selector, role] of Object.entries({
      ".stat-dot": "Dot",
      ".stat-value": "Value",
      ".stat-name": "Name",
      ".stat-grade": "Grade",
      ".roll-bar-wrap": "Track",
    }))
      tag(selector, `stat${index}${role}`, row);
    const dot = row.querySelector(".stat-dot");
    if (dot) dot.dataset.layoutTint = "background";
  });
  for (const [selector, field] of [
    [".sheet-chip.pos", "bestPositiveChip"],
    [".sheet-chip.neg", "bestNegativeChip"],
  ]) {
    document.querySelectorAll(selector).forEach((element) => {
      element.dataset.rewardField = field;
    });
  }
  document.querySelectorAll(".listing-card").forEach((card) => {
    tag(".listing-similarity", "listingMatch", card);
    tag(".listing-price-value", "listingPlatinum", card);
    tag(".listing-price-unit", "listingPlatinumUnit", card);
    tag(".listing-rerolls", "listingRolls", card);
    card.querySelectorAll(".listing-stat-line").forEach((line, index) => {
      tag(".listing-stat-value", `listingStat${index}Value`, line);
      tag(".listing-stat-name", `listingStat${index}Name`, line);
    });
  });
}

const PREVIEW_SHEET_ROW = {
  sheetRow: 1024,
  positives: ["MS", "CD", "CC > DMG / FR > TOX / SC"],
  negatives: "Z / IMP > REC",
  note: null,
  slotCodes: [["MS"], ["CD"], ["CC", "DMG", "FR", "TOX", "SC"]],
  negativeCodes: ["Z", "IMP", "REC"],
};
// Game terms, as the sheet's stat labels: not translated text.
const PREVIEW_SHEET_LABELS = {
  MS: "Multishot",
  CD: "Critical Damage",
  CC: "Critical Chance",
  DMG: "Damage",
  FR: "Fire Rate / Attack Speed",
  TOX: "Toxin",
  SC: "Status Chance",
  Z: "Zoom",
  IMP: "Impact",
  REC: "Weapon Recoil",
};

function renderLayoutPreview(state) {
  layoutPreviewState = state;
  onSessionStart("Rubico");
  hideScanning();
  _rollCount = state.previewVariant === "unrolled" ? 0 : 12;
  renderRollBadge();
  setOverlayInteractiveMode(true);
  el("btn-rescan").classList.remove("is-hidden");
  _interactionHotkey = "Ctrl+O";
  renderInteractionHint();
  el("interaction-hint").classList.remove("is-hidden");
  if (state.previewVariant === "scanning") {
    showScanning();
    return;
  }
  if (state.previewVariant === "error") {
    showScanError("overlay.riven.readFailed");
    setWeaponWarningVisible(true);
    return;
  }
  if (state.previewVariant === "waiting") {
    renderStats([]);
    return;
  }
  const stats = [
    { name: "Critical Chance", value: 153.4, positive: true, grade: "A", rollFloat: 0.82 },
    { name: "Critical Damage", value: 120.6, positive: true, grade: "S", rollFloat: 0.98 },
    { name: "Multishot", value: 84.3, positive: true, grade: "B+", rollFloat: 0.64 },
    { name: "Zoom", value: 40.2, positive: false, grade: "A-", rollFloat: 0.21 },
  ];
  const unrolled = state.previewVariant === "unrolled";
  renderStats(unrolled ? [stats[0], stats[1], stats[3]] : stats);
  // Rubico's sheet row: the full card is a good roll, the unrolled one is not.
  applyGradingToStats({
    stats: _renderedStats,
    sheet: {
      weapon: "Rubico",
      rating: unrolled ? "not-good" : "good",
      sheetRow: unrolled ? null : PREVIEW_SHEET_ROW.sheetRow,
      positives: unrolled ? ["CC", "CD"] : ["CC", "CD", "MS"],
      negatives: ["Z"],
    },
  });
  renderGoodRolls({ weapon: "Rubico", rows: [PREVIEW_SHEET_ROW], labels: PREVIEW_SHEET_LABELS });
  if (state.previewVariant !== "noListings") {
    renderSimilarListings(
      [0, 1, 2, 3, 4, 5].map((index) => ({
        platinum: 400 + index * 75,
        rerolls: index * 3,
        stats: stats.map((stat) => ({ ...stat, value: stat.value + index })),
      })),
    );
  }
}

function startOverlay() {
  const panel = el("panel");
  if (!_isLeft && panel) panel.classList.add("is-new");
  renderPanelLabel();
  renderRollBadge();
  renderScanningText();
  renderErrorBanner();
  setOverlayInteractiveMode(false);
  renderStats([]);
}

document.addEventListener("DOMContentLoaded", () => {
  let bootstrapped = false;
  const finishBootstrap = (loaded) => {
    if (!loaded || bootstrapped) return;
    bootstrapped = true;
    startOverlay();
    layoutEditor = window.installOverlayLayout({
      defaultFieldStyle: window.overlayLayoutApi.defaultFieldStyle,
      tagFields: tagRivenLayoutFields,
      boundsFor: (element) => element.closest(".listing-card"),
      renderPreview: renderLayoutPreview,
      resetPreview: () => {
        layoutPreviewState = null;
        startOverlay();
      },
    });
    window.rivenOverlay.ready();
  };
  window.overlayTheme.bootstrapOverlayTheme(() => window.rivenOverlay.getThemeVars());

  el("btn-close").addEventListener("click", () => window.rivenOverlay.close());
  el("btn-rescan").addEventListener("click", () => window.rivenOverlay.requestRescan());
  window.installOverlayDrag({
    isInteractive: () => _overlayInteractiveMode && !layoutEditor?.isEditing(),
    moveBy: (dx, dy) => window.rivenOverlay.moveBy(dx, dy),
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      window.rivenOverlay.close();
    }
  });

  window.rivenOverlay.onThemeVars((vars) => window.overlayTheme.applyThemeVars(vars));
  window.rivenOverlay.onMessages((messages) => finishBootstrap(window.overlayI18n.apply(messages)));
  window.rivenOverlay.onSessionStart((weapon) => onSessionStart(weapon));
  window.rivenOverlay.onInitialStats((stats, lowConfidence) =>
    onInitialStats(stats, lowConfidence),
  );
  window.rivenOverlay.onScanning(() => onScanning());
  window.rivenOverlay.onRollResult((payload) => onRollResult(payload));
  window.rivenOverlay.onChoiceMade((side) => onChoiceMade(side));
  window.rivenOverlay.onRescan(() => onRescan());
  window.rivenOverlay.onSessionEnd(() => onSessionEnd());
  window.rivenOverlay.onWeaponUpdate((weapon) => {
    el("weapon-name").textContent = weapon || "\u2014";
    if (weapon) setWeaponWarningVisible(false);
  });
  window.rivenOverlay.onWeaponMissing(() => {
    if (_isLeft) setWeaponWarningVisible(true);
  });
  window.rivenOverlay.onInteractionMode((payload) => {
    setOverlayInteractiveMode(Boolean(payload?.interactive));
  });
  Promise.resolve(window.rivenOverlay.getDragHint?.())
    .then((info) => {
      _interactionHotkey = info && typeof info.hotkey === "string" ? info.hotkey : null;
      renderInteractionHint();
    })
    .catch(() => {
      // hint is optional; stay hidden on failure
    });

  window.rivenOverlay.onGradingInitial((grading) => onGradingInitial(grading));
  window.rivenOverlay.onGradingRoll((payload) => onGradingRoll(payload));
  window.rivenOverlay.onGoodRolls((rolls) => renderGoodRolls(rolls));
  window.rivenOverlay.onSimilarListings((listings) => renderSimilarListings(listings));

  window.overlayI18n.onApply(renderDynamicText);
  void window.overlayI18n.load(() => window.rivenOverlay.getMessages()).then(finishBootstrap);
});
