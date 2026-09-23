---
title: Getting started
summary: Installation, inventory sources, and overlay setup.
group: Start here
order: 1
version: "2.0"
view: setup
screenshot: docs-setup.png
screenshotAlt: PlatHelper setup with language, app size, and theme choices.
screenshotCaption: The setup wizard. You can change these choices later in Settings.
---

## Install and open PlatHelper

1. Download PlatHelper from [GitHub Releases](https://github.com/Raddne/PlatHelper/releases).
2. On Windows, download the release's `PlatHelper-<version>-Setup.exe` and run it. The installer is unsigned, so Windows SmartScreen may show a warning. Check that the file came from the project's release page before choosing **More info**, then **Run anyway**.
3. On Linux (Ubuntu, Debian, Mint, Fedora, openSUSE), run `curl -fsSL https://github.com/Raddne/PlatHelper/releases/latest/download/install-linux.sh | sudo sh` in a terminal, then start PlatHelper from your app menu or with `plathelper`. On other distributions, download the `.AppImage`, mark it executable in your file manager's Properties, and open it. See [Linux setup](#linux-setup) below for screen capture and Steam settings.
4. Choose your language, app size, and theme in the setup wizard, then select **Next**.

You do not need a PlatHelper account. A warframe.market sign-in is only needed for account features such as managing your listings.

## Choose an inventory source

### Automatic inventory

On Windows, select **warframe-api-helper**, then **Install Helper**. If it is already installed, select **Load Helper Data**. PlatHelper downloads the helper through the setup wizard.

On Linux, select **Read from the running game**. The inventory reader is built in, so there is no separate helper executable to install.

Start Warframe and finish logging in. The first inventory can take a couple of minutes to arrive. Once it loads, continue to overlay placement.

Automatic inventory refreshes run on a ten-minute cooldown while the game is available. Your displayed inventory is a snapshot, so a trade or newly claimed item may take time to appear.

### Import a file

- **Import inventory JSON** reads an existing `inventory.json` from warframe-api-helper.
- **Import AlecaFrame cache** reads `lastData.dat` from `%LOCALAPPDATA%\AlecaFrame` on Windows. Select the cache itself, rather than an AlecaFrame stats or trade-history export.

Imported data reflects the selected file. Automatic helper sync does not overwrite an imported inventory. You can change your inventory source in **Settings** later.

### Continue without inventory

Choose **Continue without inventory** to use World and market features. Connect a source later in Settings to see your ownership and crafting requirements.

## Position your overlays

The wizard previews the relic reward, relic planner, riven, and arbitration summary overlays. Drag each preview into place and adjust its size. Positions save as you change them.

To check a reward scan:

1. Set **Warframe's UI language to English**. PlatHelper's display language is a separate setting.
2. Leave PlatHelper running, enter a Void Fissure mission, and open a relic.
3. When the reward choices appear, wait for the reward overlay to show their prices.
4. If it does not appear, check the overlay settings and the **Relic trigger hotkey** in **Settings**. On Linux, also check the screen-share permission described below.

To reposition an overlay later, use the unlock hotkey shown on it.

## Linux setup

Run Warframe through Steam with Proton. For faster detection of overlay events, add `PROTON_LOG=1 %command%` to Warframe's **Properties > Launch Options**, then restart the game. The setup wizard also provides this string to copy.

The first capture in a session asks you to share a screen. Select the monitor showing Warframe and allow the request. If you dismiss it, the overlay cannot read the reward screen.

### Allow reading game memory

Automatic inventory reads the login token from the running game's memory. On most distributions (NixOS, Ubuntu, Debian, Arch, and others that keep the kernel default) `kernel.yama.ptrace_scope` is `1`, which only lets a program read its own child processes. PlatHelper then shows **WF memory blocked (ptrace_scope)** in the title bar and in the setup wizard. Nothing is running as administrator; the kernel setting is the cause.

- Try it now, until the next reboot: `sudo sysctl kernel.yama.ptrace_scope=0`
- Permanently on NixOS: add `boot.kernel.sysctl."kernel.yama.ptrace_scope" = 0;` to your configuration and rebuild.
- Permanently elsewhere: write `kernel.yama.ptrace_scope = 0` into `/etc/sysctl.d/60-plathelper.conf`, then run `sudo sysctl --system`.

PlatHelper retries on its own once the setting is in place. It does not change the setting for you, because it applies to every program on the system. The desktop or compositor (GNOME, KDE, niri, Hyprland) makes no difference here.

Overlays work on X11, XWayland and native Wayland. On native Wayland they use the layer-shell protocol (KDE Plasma, Sway, Hyprland, niri, COSMIC); GNOME does not offer it, so PlatHelper uses XWayland there. SteamOS game mode is unsupported.

## If setup gets stuck

- **Waiting for the game:** start Warframe and finish logging in. The launcher alone is not enough.
- **Access denied (Windows):** the setup message may indicate that Warframe is running as administrator. Restart the game and its launcher without **Run as administrator**.
- **WF memory blocked (Linux):** the kernel does not let PlatHelper read the game's memory. Follow [Allow reading game memory](#allow-reading-game-memory).
- **Login token not found:** restart Warframe and try again. If the error persists, include the exact message when asking for help.
- **JSON rejected:** choose an inventory export, rather than a stats or trade-history export.
- **Items or quantities look old:** check the selected source and allow for the helper cooldown. Imported files need a newer export to reflect later changes.
- **Overlay cannot read a reward:** confirm the game's English interface, check screen-share permission on Linux, and follow any OCR hint shown by the app. If a scan-debug bundle was created, **Settings > General > Open scan-debug folder** opens it.

Report persistent problems through [GitHub Issues](https://github.com/Raddne/PlatHelper/issues) or [Discord](https://discord.gg/7Gm3UvUSww). Include your app version, operating system, inventory source, and exact error. Check logs and screenshots for personal information before sharing them.

## Next: explore your inventory

See [Inventory](/docs/inventory) for prices, value estimates, and selling.
