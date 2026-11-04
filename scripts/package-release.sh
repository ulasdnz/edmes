#!/usr/bin/env bash
# Builds a release package: everything an install needs and no source code. Prints its path.
# With --offline it also carries every image, for a server without internet access; an image is
# taken from the local Docker when present, otherwise pulled.
#
#   scripts/package-release.sh 1.0.0              what the release workflow publishes
#   scripts/package-release.sh 1.0.0 --offline    for an offline server, run on a connected machine
set -euo pipefail
cd "$(dirname "$0")/.."

version=${1:?usage: scripts/package-release.sh <version> [--offline]}
mode=${2:-}
stage=dist/aimes

rm -rf "$stage"
mkdir -p "$stage"
# Only files git tracks, so nothing local slips in
{
  git ls-files infra
  echo docker-compose.yml
  echo .env.example
  echo install.sh
} | tar -cf - -T - | tar -xf - -C "$stage"
cp docs/operations/installation.md "$stage/INSTALL.md"
echo "$version" > "$stage/VERSION"
chmod +x "$stage/install.sh"

name=aimes-$version.tar.gz
if [ "$mode" = --offline ]; then
  refs=$(grep -E '^ +image: ' docker-compose.yml | awk '{print $2}' | sed "s/\${AIMES_VERSION:-dev}/$version/")
  names=()
  for ref in $refs; do
    docker image inspect "$ref" > /dev/null 2>&1 || docker pull "$ref" >&2
    # An image pulled by digest has no tag, and docker save writes no name for it, so it would load
    # nameless and compose would not find it. Saved under its tag it loads by that name, and the
    # digest-pinned reference in docker-compose.yml still resolves to it.
    name=${ref%@*}
    [ "$name" = "$ref" ] || docker tag "$ref" "$name"
    names+=("$name")
  done
  docker save "${names[@]}" | gzip > "$stage/images.tar.gz"
  name=aimes-$version-offline.tar.gz
fi

tar -czf "dist/$name" -C dist aimes
echo "dist/$name"
