# CLAUDE.md

FireRed rebuilt in Phaser 3 + TypeScript (Vite). See README.md for setup and architecture.

- Decomp: `/Users/joshua/Coding/PokemonProjects/pret/firered` is the source of truth. Before implementing a mechanic,
  read the corresponding C in `src/` and match it, citing the original function name in a comment where useful.
- Never commit or hand-copy game assets/text into `src/`. Add new data to `tools/extract.py`, which writes to `public/gen/`
  (gitignored), then rerun `npm run extract`.
- Prefer reading constants (behavior ids, etc.) from extracted JSON over hardcoding numbers.
- Game logic ticks at a fixed 60 Hz (`OverworldScene.tick`), so express timings in GBA frames.
- Coordinates: entities use world tile coordinates; map-local = world - chunk origin.
- Verify with `npm run typecheck`, `npm test` (unit) and `npm run test:e2e` (headless playthroughs; see tests/README.md).
  When you check a mechanic at runtime, prefer writing it as an e2e test (tests/e2e/) over a one-off script, so it keeps
  being checked. For quick looks: `?map=Name&x=&y=`, `?start=after-rival` (story preset), `window.game` / `window.__test`
  in dev, and `tools/browser-test.mjs`.
- Progress docs. Read STATUS.md at the start; read the other docs when your task touches them. For each change:
  - STATUS.md: tick the checklist, update "Next up". Keep it short: status and backlog only.
  - docs/DEV_NOTES.md: add or update the entry for the subsystem (where it lives, how to hook in, how to test it).
  - docs/DEVIATIONS.md: add placeholders/approximations you leave behind; remove the ones you fix. Deliberate QOL
    changes go in its own section there.
  - docs/LOG.md: append an entry (what changed, fixes found on the way, how it was verified). It's long: search it,
    don't read it end to end.
  - PROGRESS.md is the old all-in-one file, kept until branches started before the split have merged. Don't add to
    it; when a merged branch changed it, carry those changes over to STATUS.md and docs/.

## Git

- New feature work:
  - Work in a new branch in a worktree, started from an up-to-date `origin/master`. The user works on master in the
    main checkout at the same time, so never switch its branch or touch its working tree.
  - Commit regularly while working (commits are squashed on merge).
  - When finished: run typecheck, unit and e2e tests; update STATUS.md and docs/; push and open a PR with a short
    summary. Then report what was done, what wasn't, and confirm the progress docs are updated.
- Merging PRs:
  - Merge open PRs one at a time, smallest first (unless one depends on another).
  - For each: in a worktree, merge the latest `origin/master` into the PR branch, resolve conflicts (STATUS.md,
    PROGRESS.md and docs/*.md use merge=union: tidy any duplicated lines), run typecheck, unit and e2e tests, push, then
    `gh pr merge --squash`. If a conflict needs a judgement call or tests fail, skip that PR and report it.
  - After each merge, delete the PR's branch (local and remote) and its worktree.
  - At the end, `git pull --ff-only` in the main checkout only if its working tree is clean; otherwise tell the user.
