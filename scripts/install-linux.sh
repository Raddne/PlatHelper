#!/bin/sh
# Installs or updates PlatHelper from the latest GitHub release:
#
#   curl -fsSL https://github.com/Raddne/PlatHelper/releases/latest/download/install-linux.sh | sudo sh
#
# Picks the .deb on apt systems (Debian, Ubuntu, Mint, Pop!_OS) and the .rpm on
# dnf, yum or zypper systems (Fedora, openSUSE). Every package is checked against
# the SHA-512 that the release lists in latest-linux.yml before it is installed.
# Other distributions: use the AppImage from the release page instead.

set -eu

REPO="Raddne/PlatHelper"
# PLATHELPER_RELEASE_BASE points the script at a local copy of a release for testing.
BASE="${PLATHELPER_RELEASE_BASE:-https://github.com/$REPO/releases/latest/download}"

fail() {
  echo "PlatHelper install: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "run this with sudo, e.g. curl -fsSL $BASE/install-linux.sh | sudo sh"
[ "$(uname -m)" = "x86_64" ] || fail "only x86_64 builds exist; $(uname -m) is not supported"

if command -v curl > /dev/null 2>&1; then
  fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
elif command -v wget > /dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  fail "needs curl or wget"
fi

if command -v apt-get > /dev/null 2>&1; then
  kind=deb
elif command -v dnf > /dev/null 2>&1 || command -v yum > /dev/null 2>&1 ||
  command -v zypper > /dev/null 2>&1; then
  kind=rpm
else
  fail "no apt, dnf, yum or zypper found; download the AppImage from https://github.com/$REPO/releases/latest"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' INT TERM
# apt reads local packages as its unprivileged _apt user.
chmod 755 "$tmp"

fetch "$BASE/latest-linux.yml" "$tmp/latest-linux.yml" || fail "could not reach the release feed"
version=$(sed -n 's/^version: *//p' "$tmp/latest-linux.yml" | head -n 1)
# Each files entry is "- url: <name>" followed by its "sha512: <base64>".
entry=$(awk -v ext=".$kind" '
  /^ *- url: / { name = $3; next }
  /^ *sha512: / && name != "" {
    if (substr(name, length(name) - length(ext) + 1) == ext) { print name, $2; exit }
    name = ""
  }
' "$tmp/latest-linux.yml")
[ -n "$entry" ] || fail "the latest release ($version) has no .$kind package"
file=${entry% *}
expected=$(printf '%s' "${entry#* }" | base64 -d | od -An -v -tx1 | tr -d ' \n')
case "$file" in
  */* | "") fail "unexpected file name in the release feed: $file" ;;
esac

echo "Downloading PlatHelper $version ($file)..."
fetch "$BASE/$file" "$tmp/$file" || fail "download of $file failed"
chmod 644 "$tmp/$file"
actual=$(sha512sum "$tmp/$file" | cut -d ' ' -f 1)
[ "$actual" = "$expected" ] || fail "checksum of $file does not match the release; nothing was installed"

echo "Installing..."
if [ "$kind" = deb ]; then
  apt-get install -y "$tmp/$file"
elif command -v dnf > /dev/null 2>&1; then
  dnf install -y "$tmp/$file"
elif command -v zypper > /dev/null 2>&1; then
  zypper --non-interactive install --allow-unsigned-rpm "$tmp/$file"
else
  yum localinstall -y "$tmp/$file"
fi

echo
echo "PlatHelper $version is installed. Start it from your app menu or run: plathelper"
echo "Start it as your normal user, not with sudo."
if [ "$kind" = deb ]; then
  echo "To remove it: sudo apt remove plathelper"
else
  echo "To remove it: sudo dnf remove plathelper (or: sudo zypper remove plathelper)"
fi
