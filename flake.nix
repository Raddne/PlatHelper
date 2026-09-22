{
  description = "PlatHelper: warframe companion (electron + svelte + vite)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  # the flake runtime always passes `self`, hence `...`
  outputs = { nixpkgs, flake-utils, ... }:
  flake-utils.lib.eachDefaultSystem (
    system:
    let
      pkgs = nixpkgs.legacyPackages.${system};
      sets = (import ./package.nix { inherit pkgs; });
    in
    {
      packages = {
        inherit (sets) app;
        default = sets.app;
      };
      devShells.default = sets.devShell;
    }
  );
}
