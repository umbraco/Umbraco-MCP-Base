#!/usr/bin/env bash
#
# Publish a nightly / prerelease build of one package to the MyGet npm feed.
#
# Usage: publish-nightly.sh <artifact-directory> <build-id> <nightly-date>
#
# <artifact-directory> is a pipeline artifact downloaded from the BuildAndTest
# stage. It contains exactly one *.tgz produced by `npm pack`, plus an .npmrc
# that scopes @umbraco-cms to the MyGet feed and carries the credentials
# injected by the npmAuthenticate task. <nightly-date> must be the same value
# for every job in a pipeline run (the pipeline passes a run-scoped
# `nightlyDate` variable, not each job's own wall-clock) — see below.
#
# dev and release/* builds reuse whatever version is committed in package.json
# (it is only bumped when a release is cut), so the raw version would collide on
# every rebuild. This script repacks the tarball with a unique
# <version>-nightly.<date>.<build id> version and publishes it under the
# "nightly" dist-tag, leaving the npm latest/beta/rc tags untouched. The
# committed package.json is never modified — only the extracted copy is.
#
# Intra-monorepo deps (e.g. mcp-hosted -> mcp-server-sdk) are repointed at the
# sibling's nightly version. That's only correct because every package here is
# versioned in lockstep (see CLAUDE.md "Releases") and every job in a run
# shares the same <date>.<build id> suffix, so "this package's nightly
# version" and "the sibling's nightly version" are the same string *when the
# sibling has already published under it* — this script verifies that with
# `npm view` rather than assuming it, so a missing/failed sibling publish (or a
# future break in the lockstep-versioning convention) fails loudly here instead
# of shipping a nightly with a dependency pin that resolves to nothing.
set -euo pipefail

artifactDir=${1:?artifact directory is required}
buildId=${2:?build id is required}
nightlyDate=${3:?nightly date is required}

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
nightlyVersion="${baseVersion}-nightly.${nightlyDate}.${buildId}"

# `npm view` distinguishes "genuinely not published" (404, safe to proceed)
# from any other failure (auth, network, mis-scoped registry — must not be
# treated as "not published yet"). Output is captured, not discarded, so a
# real problem is visible in the logs either way.
npmViewVersion() {
  local pkgSpec=$1 out rc
  out=$(npm view "$pkgSpec" version 2>&1) && rc=0 || rc=$?
  if [[ $rc -eq 0 ]]; then
    echo "$out"
    return 0
  fi
  if [[ "$out" == *"E404"* ]]; then
    return 1
  fi
  echo "npm view ${pkgSpec} failed unexpectedly (not a 404):" >&2
  echo "$out" >&2
  exit 1
}

# Repoint intra-monorepo dependencies at the sibling's nightly, across every
# field npm honours dependency resolution from (matches the field list
# rewrite-file-deps.mjs rewrites `file:` refs in, so nothing this script skips
# was rewritten to a stale released version by that hook and then left alone
# here). Verify the sibling actually published under that version first —
# don't assume the lockstep-versioning convention holds.
depFields=(dependencies devDependencies peerDependencies optionalDependencies)
siblings=("@umbraco-cms/mcp-server-sdk" "@umbraco-cms/mcp-hosted")
for field in "${depFields[@]}"; do
  for sibling in "${siblings[@]}"; do
    current=$(node -p "const d = require('./${pkgDir}/package.json').${field} || {}; d['${sibling}'] || ''")
    [[ -n "$current" ]] || continue
    if ! siblingVersion=$(npmViewVersion "${sibling}@${nightlyVersion}"); then
      echo "Cannot pin ${field}.${sibling} to ${nightlyVersion}: that version is not on the feed yet." >&2
      echo "This package depends on a sibling nightly that hasn't published (wrong job order, or the sibling job failed/skipped)." >&2
      exit 1
    fi
    (cd "$pkgDir" && npm pkg set "${field}.${sibling}=${siblingVersion}")
    echo "Pinned ${field}.${sibling} to ${siblingVersion} (was ${current})"
  done
done

# `npm version` validates the string is valid semver before writing it. Run
# after the sibling repoint above so a rejected/aborted repoint never leaves a
# half-versioned package.json behind.
(cd "$pkgDir" && npm version --no-git-tag-version --ignore-scripts "$nightlyVersion" >/dev/null)

nightlyTarball="${PWD}/nightly.tgz"
rm -f "$nightlyTarball"
(cd extracted && tar -czf "$nightlyTarball" package)

# Re-runs of the same build produce the same version; skip rather than fail on
# an immutable feed.
if npmViewVersion "${name}@${nightlyVersion}" >/dev/null; then
  echo "##[warning]Skipping ${name}@${nightlyVersion} — already published"
  exit 0
fi

echo "Publishing ${name}@${nightlyVersion} with tag nightly"
npm publish "$nightlyTarball" --tag nightly
