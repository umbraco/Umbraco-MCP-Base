#!/usr/bin/env bash
#
# Publish a nightly / prerelease build of one package to the MyGet npm feed.
#
# Usage: publish-nightly.sh <artifact-directory> <build-id>
#
# <artifact-directory> is a pipeline artifact downloaded from the BuildAndTest
# stage. It contains exactly one *.tgz produced by `npm pack`, plus an .npmrc
# that scopes @umbraco-cms to the MyGet feed and carries the credentials
# injected by the npmAuthenticate task.
#
# dev and release/* builds reuse whatever version is committed in package.json
# (it is only bumped when a release is cut), so the raw version would collide on
# every rebuild. This script repacks the tarball with a unique
# <version>-nightly.<UTC date>.<build id> version and publishes it under the
# "nightly" dist-tag, leaving the npm latest/beta/rc tags untouched. The
# committed package.json is never modified — only the extracted copy is.
set -euo pipefail

artifactDir=${1:?artifact directory is required}
buildId=${2:?build id is required}

cd "$artifactDir"

shopt -s nullglob
tarballs=(*.tgz)
shopt -u nullglob
if [[ ${#tarballs[@]} -ne 1 ]]; then
  echo "Expected exactly one .tgz in ${artifactDir}, found ${#tarballs[@]}" >&2
  exit 1
fi
tarball=${tarballs[0]}

# npm needs a package.json in the working directory to run view/publish here.
[[ -f package.json ]] || npm init -y >/dev/null

rm -rf extracted
mkdir extracted
# npm tarballs always extract to a single top-level "package" directory.
tar -xzf "$tarball" -C extracted
pkgDir="extracted/package"
if [[ ! -f "${pkgDir}/package.json" ]]; then
  echo "Unexpected tarball layout: ${pkgDir}/package.json not found" >&2
  exit 1
fi

name=$(node -p "require('./${pkgDir}/package.json').name")
baseVersion=$(node -p "require('./${pkgDir}/package.json').version")
nightlyVersion="${baseVersion}-nightly.$(date -u +%Y%m%d).${buildId}"

# `npm version` validates the string is valid semver before writing it.
(cd "$pkgDir" && npm version --no-git-tag-version --allow-same-version --ignore-scripts "$nightlyVersion" >/dev/null)

# Repoint intra-monorepo dependencies at the nightly being built in this same
# run, so a nightly @umbraco-cms/mcp-hosted resolves the matching nightly SDK
# instead of the last released one.
for sibling in "@umbraco-cms/mcp-server-sdk" "@umbraco-cms/mcp-hosted"; do
  current=$(node -p "const d = require('./${pkgDir}/package.json').dependencies || {}; d['${sibling}'] || ''")
  if [[ -n "$current" ]]; then
    (cd "$pkgDir" && npm pkg set "dependencies.${sibling}=${nightlyVersion}")
    echo "Pinned ${sibling} to ${nightlyVersion} (was ${current})"
  fi
done

nightlyTarball="${PWD}/nightly.tgz"
rm -f "$nightlyTarball"
(cd extracted && tar -czf "$nightlyTarball" package)

# Re-runs of the same build produce the same version; skip rather than fail on
# an immutable feed.
if npm view "${name}@${nightlyVersion}" version >/dev/null 2>&1; then
  echo "##[warning]Skipping ${name}@${nightlyVersion} — already published"
  exit 0
fi

echo "Publishing ${name}@${nightlyVersion} with tag nightly"
npm publish "$nightlyTarball" --tag nightly
