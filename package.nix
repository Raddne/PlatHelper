# PlatHelper: electron + svelte + vite app, pnpm.
# modeled on WFHelper's nixpkgs package.
#
# `nix run` gives you the built app running nixpkgs' patched electron.
# for distributable artifacts (AppImage, nsis) run `pnpm dist:linux`
# inside `nix develop` — that's electron-builder's job, not nix's.
{
  pkgs ? import <nixpkgs> { },
  lib ? pkgs.lib,
}:
let
  pnpm = pkgs.pnpm_11; # packageManager: pnpm@11.1.2
  # nodejs_22 for engines ">=22.12"; fetchPnpmDeps and the build must share
  # the same node, so it's threaded through both.
  nodejs = pkgs.nodejs_22;
  electron = pkgs.electron_42; # project pins ^41, but 41 is EOL

  app = pkgs.stdenv.mkDerivation (finalAttrs: {
    pname = "plathelper";
    version = "0.2.0";
    src = ./.;

    __structuredAttrs = true;
    strictDeps = true;

    # sharp / onnxruntime-node / koffi all ship prebuilt linux-x64 binaries
    # via optionalDependencies, no cc needed for them; the wayland
    # layer-shell addon IS built here (pkg-config + wayland-scanner below,
    # wayland libs in buildInputs).
    nativeBuildInputs = [
      nodejs
      pnpm
      pkgs.pnpmConfigHook
      pkgs.makeBinaryWrapper
      pkgs.copyDesktopItems
      pkgs.pkg-config
      pkgs.wayland-scanner
    ];

    buildInputs = [
      pkgs.wayland
      pkgs.wayland-protocols
    ];

    pnpmDeps = pkgs.fetchPnpmDeps {
      inherit (finalAttrs) pname version src;
      inherit pnpm nodejs;
      fetcherVersion = 4;
      hash = "sha256-Hmbc0/Q1wDKysP6FvP1RnMdfMHG8yfDQLHGwCh9sdQI=";
    };

    buildPhase = ''
      runHook preBuild

      pnpm run verify:onnx-models
      pnpm run build
      node scripts/build-layer-shell.mjs --require
      pnpm exec electron-builder --dir \
        -c.electronDist='${electron.dist}' \
        -c.electronVersion='${electron.version}'

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      libdir="$out/share/lib/plathelper"
      mkdir -p "$libdir"
      cp -r release/linux-unpacked/{resources/,locales/} "$libdir"

      install -Dm444 assets/logo.png $out/share/icons/hicolor/974x974/apps/plathelper.png

      makeBinaryWrapper '${lib.getExe electron}' "$out/bin/plathelper" \
        --add-flags "$libdir/resources/app.asar" \
        --inherit-argv0

      runHook postInstall
    '';

    desktopItems = [
      (pkgs.makeDesktopItem {
        name = "plathelper";
        desktopName = "PlatHelper";
        exec = "plathelper %U";
        terminal = false;
        type = "Application";
        icon = "plathelper";
        startupWMClass = "plathelper"; # matches the layer-shell layer name
        comment = "Warframe companion: inventory, foundry, relic and riven scanning, market orders.";
        categories = ["Utility"];
      })
    ];

    meta = with pkgs.lib; {
      description = "Warframe companion: inventory, foundry, relic and riven scanning, market orders.";
      homepage = "https://github.com/Raddne/PlatHelper";
      license = licenses.mit;
      platforms = platforms.linux;
      mainProgram = "plathelper";
    };
  });

  devShell = pkgs.mkShell {
    name = "plathelper-dev";
    packages = with pkgs; [
      nodejs_22    # engines: >=22.12
      pnpm_11      # packageManager: pnpm@11.1.2
      gcc          # cc for the optional layer-shell addon
      wayland
      wayland-protocols
      pkg-config
      fuse         # electron-builder AppImage target
      xvfb         # headless electron/playwright runs
      libGL
      libxkbcommon
    ];
    shellHook = ''
      echo "PlatHelper dev shell"
      echo "  pnpm install              one-time, or after touching the lockfile"
      echo "  pnpm dev                  run the app with watchers"
      echo "  pnpm build:layer-shell   build the optional wayland addon"
      echo "  pnpm test                 vitest"
      echo "  pnpm typecheck            all tsconfigs"
      echo "  pnpm dist:linux           AppImage (electron-builder)"
    '';
  };
in
{ inherit app devShell; }
