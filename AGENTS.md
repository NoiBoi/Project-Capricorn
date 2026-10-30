# Capri project continuity

## Required repository and delivery workflow

This is Project Capricorn, whose Windows application is named Capri Buddy.
The user's normal expectation for an implementation is working code committed
and pushed to the correct repository, visible in GitHub Desktop, and a verified
installed application with working launch shortcuts. A source edit alone is not
a completed implementation. Explicit task instructions can narrow this scope.

### Start in the correct checkout

- Canonical remote: `https://github.com/NoiBoi/Project-Capricorn.git`.
- This machine's GitHub Desktop checkout:
  `C:\Users\matth\OneDrive\Pictures\Documents\GitHub\Project-Capricorn`.
  Prefer editing there so Desktop can show changes while coding. Other machines
  must discover their own Desktop checkout rather than assume this path exists.
- Before editing, inspect `git rev-parse --show-toplevel`, `git remote -v`,
  `git status --short --branch`, `git branch -vv`, and `git worktree list`.
  Fetch the intended remote and check divergence before integrating anything.
- Old `capri-companion` repositories and dated Codex output folders are not the
  canonical checkout. Do not silently implement there or copy a new source tree
  into another output folder. Preserve unrelated edits and concurrent work.
- If isolation requires another worktree/branch, state its path and plan the
  integration back into the Desktop checkout. Desktop watches its selected
  checkout, not every clone or worktree. Committed files appear in History;
  the Changes list only contains uncommitted changes. Generated `dist/`,
  `node_modules/`, installers and logs are intentionally ignored.

### Implement, validate, and publish

- Read the continuity requirements below before applicable behavior changes.
  Complete the feature and relevant checks; record failures honestly. At minimum
  run `npm run typecheck` and relevant unit tests for code changes; use packaged
  and native checks for changes that depend on Electron/Windows behavior.
  Documentation-only work does not require rebuilding or a version bump.
- For a delivered application change, choose the next appropriate version using
  current GitHub and installed versions, not a stale baseline. Update
  `package.json` and both root version entries in `package-lock.json` together
  (`npm version <version> --no-git-tag-version` can do this). Do not downgrade an
  installed newer release or reuse a release version for different shipped code.
- Review the diff and stage only intended source, tests and documentation.
  Never commit credentials, personal profiles, location observations, backups,
  `.env` files or generated release binaries. Commit the completed change.
- Push to the canonical remote and verify its branch SHA with `git ls-remote`.
  Do not stop at a local commit or assume that a build, source ZIP, GitHub Desktop
  fetch, or installer publishes code. Set an upstream for a new branch.
- For ordinary completed changes in the user's direct-main workflow, integrate
  into `main` and push normally. If the task requires review or branch protection
  requires a PR, push the feature branch, create the PR, and report that main is
  pending review. Never force-push, discard unrelated work, or bypass protection.
  If auth, concurrent changes, or failed checks prevent delivery, report exactly
  which step remains; never claim that publishing succeeded.
- Bring the Desktop checkout onto the delivered commit safely (fast-forward
  when possible). Do not reset it or switch away from someone else's work.
  Verify the final checkout, branch, status and remote SHA. A clean Changes list
  after committing is expected; the commit must be visible in History.

### Deliver the Windows application

- `npm run build` updates only `dist/`; `npm run dist` builds the installer in
  `release/` using `release-staged/` and explicitly does not publish. Neither
  installs the app. There is no configured automatic application update step.
- Generate icons with `npm run icons` when icon assets change. Validate the
  packaged build and its version before replacing the running application.
  Use an isolated test profile; never run destructive tests on the live profile.
  Keep a rollback package and take the normal-profile backup while Capri is
  stopped. Preserve the user's profile, credentials and approved memories.
- Normal install/launch target on this machine:
  `C:\Users\matth\AppData\Local\Programs\Capri Buddy\Capri Buddy.exe`.
  Normal profile: `C:\Users\matth\Documents\Capri Buddy`.
  Verify actual process paths and profile logs; do not infer them from filenames.
- Install and relaunch the validated version for an implementation delivery,
  unless the user explicitly asks for source-only/review work. Verify executable
  product/file version, packaged `package.json`, startup log version, process
  path, profile path, and a relevant live smoke check. Source version alone does
  not prove the installed or running version. Report any unfinished install.
- Inspect Desktop, Start Menu, and taskbar shortcuts, including misleadingly
  named `Electron.lnk`. Their target, working directory and icon must point to
  the installed app, not source Electron or a dated `release/win-unpacked` copy.
  Preserve `dev.capri.buddy` consistently in runtime/build/shortcut identity.
  Verify the actual pinned launch entry; do not claim a visible icon refresh
  from a version bump alone. If Windows still shows cached artwork or needs
  re-pinning, explain the observed remaining step instead of claiming success.
- Final handoff must state source commit/branch, push verification, Desktop
  checkout status, application version and installation/launch verification,
  tests and known failures. Clearly distinguish completed and pending steps.

## Dialogue, behavior, and profile continuity

Before changing dialogue, persona, context, or companion behavior, read
`docs/DIALOGUE_GUIDE.md`. It is the cumulative source of the user's dialogue
preferences. Its runtime section is imported into both chat and ambient prompts.

Preserve older preferences unless the user explicitly supersedes them. Add new
feedback to the dated preference ledger, reconcile conflicts explicitly, and
update examples and runtime guidance together. Do not replace this guide with
the newest request or create a competing persona document. Keep examples as
illustrations, not fixed lines to repeat. Check actual live prompt paths.

Keep cursor visits, new-window interest, and tour/perch/lower-ledge choices
available together. A change to speech or memory must not silently remove a
physical behavior. Test movement cancellation, closed/covered targets, user
placement, focus, sleep, and profile preservation when changing these paths.

Keep existing unrelated changes. Validate the packaged application before
replacing the running copy, with a stopped-profile backup and rollback package.
