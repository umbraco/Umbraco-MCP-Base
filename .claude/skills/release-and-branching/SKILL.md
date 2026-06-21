---
name: release-and-branching
description: This repo's branching, merge, and release workflow. Use whenever creating a branch to do work, opening or merging a PR, cutting a release, or merging a release into main — to follow the required branch naming, the squash-into-dev vs merge-commit-into-main conventions, and the release → main → dev flow. Trigger on intents like "start a branch", "merge this PR", "cut/do a release", "release X", "merge to main".
---

# Branching & release workflow

## Branching (all work)
- **Never commit directly to `dev` or `main`** — both are protected. Always work on a branch.
- Name the branch by type: **`feature/…`**, **`fix/…`**, **`chore/…`** (also `docs/…`, `refactor/…`, `test/…`).
- Branch off **`dev`**.

## Merging a normal PR → `dev`
- Open the PR against **`dev`**.
- After review + green CI, **always squash-merge** into `dev` (one tidy commit per PR).
- Delete the branch after merge.

## Cutting a release
1. **Always create a release branch off `dev`:** `release/<version>` (e.g. `release/1.0.0-beta.30`).
2. Bump the version across **all** manifests + `package-lock.json`, and verify no stale version strings. The exact file list and verify command are in **`CLAUDE.md` → Releases → Release process** — don't duplicate them, follow them.
3. Open a PR from the release branch into **`main`**.
4. After green CI (release PRs also run LLM evals + the skill E2E), **always use a merge commit — NOT squash —** when merging the release branch into `main`. The real merge/version-bump commit on `main` is what the automation keys off.

## After the release reaches `main` (automated)
- **`release-tag.yml`** creates the `v<version>` tag + GitHub Release.
- **`sync-main-to-dev.yml`** merges `main` back into `dev` via the `chore/merge-main-to-dev` branch.
- If that sync fails, do the merge-back-to-dev by hand — steps are in **`CLAUDE.md` → Post-release: merge main to dev**.

## Why two merge styles
- **Squash → `dev`** keeps day-to-day history to one commit per feature.
- **Merge commit → `main`** preserves the release branch's version-bump commit, which the tag automation and the `main`→`dev` sync rely on. Squashing a release into `main` would break that.
