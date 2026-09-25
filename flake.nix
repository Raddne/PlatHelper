{
  description = "PlatHelper: warframe companion (electron + svelte + vite)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  # the flake runtime always passes `self`, hence `...`
  outputs = { nixpkgs, ... }:
    let
      # linux-only: the derivation needs wayland-scanner, fuse, xvfb —
      # none of which exist on darwin.
      systems = [ "x86_64-linux" "aarch64-linux" ];
      lib = nixpkgs.lib;
      forAll = lib.genAttrs systems;
    in
    {
      packages = forAll (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          sets = import ./package.nix { inherit pkgs; };
        in
        {
          inherit (sets) app;
          default = sets.app;
        });
      devShells = forAll (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          sets = import ./package.nix { inherit pkgs; };
        in
        { default = sets.devShell; });
    };
}
