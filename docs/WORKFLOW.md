# Parallel batches: coordinator, workers, merger

How big pieces of work get done here: one session (the coordinator) plans a batch, runs up to four workers in
parallel, then merges their PRs. Used for BATTLE_ANIMS_PLAN.md (PRs #6-#13) and MAIN_PATH_PLAN.md batches 1-3
(PRs #14-#28). The git rules in CLAUDE.md still apply; this file adds what's specific to running a batch.

## 1. Coordinator: plan the batch

1. **Read STATUS.md and the current plan.** List the candidate work.
2. **Check each item against the decomp and the port** before assigning it. An item can be smaller or bigger than
   its STATUS line says: in batch 3 the card key doors already worked (test only), and "the Hall of Fame PC" turned
   out to need the whole Hall of Fame screen. Useful checks:
   - `wc -l` the C files involved, to size the work.
   - Grep the scripts for the commands and specials the item uses, and check `script/ScriptEngine.ts` and
     `script/specials.ts` for each one (unknown ones log once at runtime).
   - `?map=Name&x=&y=` to try it in the browser.
3. **Split it into workstreams**, at most four per batch, each owning distinct files. One worker can take two or
   three PRs in a row (e.g. a screen, then the feature built on it).
4. **Give each shared building block one owner.** Grep the C files each workstream will port for the helpers
   they call outside themselves (menu.c windows, bg.c affine BGs, SoftReset, palette helpers, ...). If two
   workstreams need the same one, the plan names the owner; the others leave it out and reuse it once it merges, or
   wait a batch. (Batch 3 got three duplicates without this: affine BGs, the top bar window and SoftReset.)
5. **Write the batch into the plan doc** (workstreams, owners, what's shared, what's left out). The coordinator
   can't push to master (auto mode blocks it), so plan and STATUS updates go in as small docs-only PRs. Merge them
   with `gh pr merge --squash --delete-branch` after a look at the diff; they need no test run.

## 2. Coordinator: start the workers

One worktree per workstream, from an up-to-date `origin/master`, next to the main checkout. Clone `node_modules` and
the extracted data instead of reinstalling and re-extracting (`cp -c` makes APFS copy-on-write clones, which take
seconds):

```sh
git fetch
for b in branch-a branch-b; do
  git worktree add -b $b ../wt-$b origin/master
  cp -Rc node_modules ../wt-$b/
  mkdir -p ../wt-$b/public && cp -Rc public/gen ../wt-$b/public/
done
```

Then launch each worker as a background agent with the prompt template below. The e2e dev server falls back to a
free port, so parallel runs don't clash. Don't poll workers; their report arrives when they finish.

### Worker prompt template

> You are worker **W-name** in batch N of a FireRed port to Phaser 3 + TypeScript. Your worktree is
> `/…/wt-<branch>` (branch `<branch>`, from origin/master; node_modules and public/gen are in place). Work only
> there: never touch the main checkout or the other worktrees. The decomp is `/…/pret/firered`.
>
> Start by reading, in your worktree: CLAUDE.md, STATUS.md, docs/WORKFLOW.md section 3 (your rules),
> tests/README.md, and the docs/DEV_NOTES.md entries for *(the subsystems this touches)*. Search docs/LOG.md for
> *(related history)*.
>
> Your task: *(what to port, C files and function names, what "done" looks like, what to do if there's no room
> for all of it)*.
>
> You own *(files)*. Shared building blocks: *(what you build for others / what you reuse from whom)*. Other
> workers running now: *(one line each)*; avoid their areas.
>
> Tests: typecheck, `npm test`, your own e2e file `tests/e2e/<name>.test.ts` covering *(scenarios)*, plus
> *(the e2e files your shared changes touch)*.
>
> When done: push, open the PR with `gh pr create` (summary, shared files touched, what's not done). Your final
> message: the PR URL(s), what was done, what wasn't, test results with counts, shared files touched.

## 3. Worker rules

- Follow CLAUDE.md: port from the decomp, cite C function names, timings in GBA frames, assets through the
  extractor.
- **Only change what you own.** Keep shared changes small and list them in the PR. Don't build a shared building
  block another workstream owns; leave a stub or a TODO and say so in the PR.
- **Tests:** typecheck, `npm test`, your own e2e file, and the e2e files for any shared code you change. Don't run
  the full e2e suite while other workers are running theirs (it takes ~10 minutes, and four copies at once overload
  the machine); the merger runs it. Run it yourself only if the plan says so (e.g. a refactor everything goes
  through).
- **A test that fails and then passes on a rerun has a race. Fix it, or name it in the PR as unfixed.** Never
  write it off as "parallel load": load only exposes races that are already there. tests/README.md ("Writing a new
  scenario") lists the usual causes.
- **Docs:** a docs/LOG.md entry, docs/DEV_NOTES.md for a new subsystem, docs/DEVIATIONS.md for what you
  approximate (and remove what you fix). Don't tick STATUS.md; the merger does.
- **A second PR stacked on your first:** give it its own branch and worktree from your first branch (not a branch
  switch in the same worktree), set the PR's base to your first branch, and say so in both PR bodies.
- Scratch files: prefix them with your workstream name and keep them out of commits.
- If you run low on context: commit, push, open the PR with what's done and say what's left.

## 4. Merger

Follow CLAUDE.md's "Merging PRs" (smallest first, merge `origin/master` in, tests, push, squash, clean up). On top
of that:

- **Re-extract after merging master in** if either side changed `tools/` (`npm run extract`, ~20 s).
- **Check the merge brought in only master's changes:** `git diff <PR head before the merge> --stat` should match
  `git diff <old master>..origin/master --stat` plus your conflict resolutions. Record the PR head before merging,
  and record it on the branch you're merging: a worktree can be on a different branch than its name says.
- **Duplicated building blocks:** keep the more complete version, move every caller onto it, delete the other, and
  fix the docs that named it. Note what you did in the merge commit message.
- **Stacked PRs:** after the first PR is squash-merged, retarget the second with `gh pr edit <n> --base master`
  (before deleting the first branch, which would close it). Merging master into it then conflicts on everything the
  squash duplicated. Instead, apply only the second PR's own changes on top of master:

  ```sh
  git diff --binary <first PR's head> <second PR's head> > second.patch
  git checkout --detach origin/master
  git apply -3 --index second.patch           # resolve what conflicts, git add
  C=$(git commit-tree $(git write-tree) -p <second PR's head> -p origin/master -m "Merge origin/master into <branch>")
  git reset --hard && git switch <branch> && git merge --ff-only $C
  ```

- **The full e2e suite takes ~10 minutes,** longer than a foreground shell command may run. Run it in the
  background with its output to a file, and read the failures from the file.
- **A test that fails in the merge run:** rerun its file alone. If it passes, it's a race: find it and fix it (in the
  PR branch, with a commit saying what it was) rather than rerunning the suite until it's green. Add the cause to
  tests/README.md if it's a new kind.
- **`gh pr merge` right after a push** can report a conflict while GitHub is still computing mergeability. Wait for
  `gh pr view <n> --json mergeable` to say MERGEABLE.
- **At the end:** a docs-only PR that ticks STATUS.md, updates "Next up", and adds a docs/LOG.md entry for the merge
  (conflict resolutions, tests fixed); `git pull --ff-only` and `npm run extract` in the main checkout if its working
  tree is clean; report to the user what was done, what wasn't, and that the progress docs are updated.
