# Parallel batches: coordinator, workers, merger

How big pieces of work get done here: one session (the coordinator) plans a batch, runs up to four workers in
parallel, then merges their PRs. Used for BATTLE_ANIMS_PLAN.md (PRs #6-#13) and MAIN_PATH_PLAN.md batches 1-3
(PRs #14-#28). The git rules in CLAUDE.md still apply; this file adds what's specific to running a batch.

## 0. Running it autonomously

`/get-on` (or "get on with the project") runs batches back to back without the user: see
`.claude/skills/get-on/SKILL.md`. Three levels of agents:

- **Main coordinator:** the user's session. Starts one sub-coordinator per batch, waits for its report, updates the
  user, and starts the next one until a stop condition (a batch count, something that needs the user, nothing
  merged twice in a row).
- **Sub-coordinator:** a background agent that runs one batch end to end: open PRs first, then sections 1-4 below,
  including the docs-only plan and STATUS PRs. It takes the reasonable call on open questions and records it in
  the plan's "Decisions" for the user to revisit.
- **Workers:** started by the sub-coordinator (section 2). They don't start agents themselves.

Sections 1-4 are written for whoever coordinates the batch: the sub-coordinator, or the user's session when a
batch is run by hand.

## 1. Coordinator: plan the batch

1. **Read STATUS.md and the current plan.** List the candidate work.
2. **Check each item against the decomp and the port** before assigning it. An item can be smaller or bigger than
   its STATUS line says: in batch 3 the card key doors already worked (test only), and "the Hall of Fame PC" turned
   out to need the whole Hall of Fame screen. Useful checks:
   - `wc -l` the C files involved, to size the work.
   - Grep the scripts for the commands and specials the item uses, and check `script/ScriptEngine.ts` and
     `script/specials.ts` for each one (unknown ones log once at runtime).
   - `?map=Name&x=&y=` to try it in the browser.
3. **Split it into workstreams**, each owning distinct files. How many workers to run at once (at most four) is the
   coordinator's estimate from the work and the machine: each worker runs e2e files, and in batch 2 of
   SCREENS_PLAN.md four at once pushed the load average to 150-300 and exposed races. Fewer workstreams with more
   units each are fine; so is starting a fourth worker once another has finished.
4. **Split each workstream into units** a fresh worker can finish in about an hour: roughly 1,000-1,500 lines of C
   ported plus its tests and docs, each leaving the branch green (typecheck, unit tests, its e2e cases). List the
   units in order in the plan. A worker does one unit (or a few small ones) and hands back; the next unit goes to a
   continuation worker on the same branch (section 2). Batch 3's W-fly took region_map.c (4k lines) and Fly in one
   worker and ran to ~60 minutes and ~700k tokens of context; that should have been three units.
5. **Give each shared building block one owner.** Grep the C files each workstream will port for the helpers
   they call outside themselves (menu.c windows, bg.c affine BGs, SoftReset, palette helpers, ...). If two
   workstreams need the same one, the plan names the owner; the others leave it out and reuse it once it merges, or
   wait a batch. (Batch 3 got three duplicates without this: affine BGs, the top bar window and SoftReset.)
6. **Write the batch into the plan doc** (workstreams, their units, owners, what's shared, what's left out). The coordinator
   can't push to master (auto mode blocks it), so plan and STATUS updates go in as small docs-only PRs. Merge them
   with `gh pr merge --squash` after a look at the diff (they need no test run), then clean up as in section 4
   "Cleaning up a merged PR".

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
free port, so parallel runs don't clash.

### While the workers run

- **A report with units left** (a hand-back): start a continuation worker in the same worktree and branch, with the
  same prompt plus "You continue W-name: units 1-k are done (see the PR and `git log`); do unit k+1" and the
  hand-back's notes. One workstream can go through several workers this way.
- **A watchdog** for workers that run long: when the workers start, start a background timer
  (`sleep 1800`, run in the background, so its exit wakes you). On each wake, for each worker still running, look
  at its worktree (`git log -1 --format='%cr %s'`, `git status -s | head`). If it has run for over 60 minutes, send
  it a checkpoint with SendMessage (the agent id the Agent tool returned):
  "Checkpoint: finish the step you're on, get the branch green, commit, push, open or update the PR, and hand
  back with what's left." Then restart the timer. A worker with no new commit in 45 minutes gets the same message
  with "say what you're stuck on". Stop the timer once every workstream has handed back its last unit.
- Otherwise don't poll: reports and hand-backs arrive by themselves.

### Worker prompt template

> You are worker **W-name** in batch N of a FireRed port to Phaser 3 + TypeScript. Your worktree is
> `/…/wt-<branch>` (branch `<branch>`, from origin/master; node_modules and public/gen are in place). Work only
> there: never touch the main checkout or the other worktrees. The decomp is `/…/pret/firered`.
>
> Start by reading, in your worktree: CLAUDE.md, STATUS.md, docs/WORKFLOW.md section 3 (your rules),
> tests/README.md, and the docs/DEV_NOTES.md entries for *(the subsystems this touches)*. Search docs/LOG.md for
> *(related history)*.
>
> Your task: *(the workstream, then the unit(s) this worker does: C files and function names, what "done"
> looks like)*. Units after yours go to a continuation worker: don't start them. *(For a continuation: units
> 1-k are done, see PR #n and `git log`; notes from the last worker: …)*
>
> You own *(files)*. Shared building blocks: *(what you build for others / what you reuse from whom)*. Other
> workers running now: *(one line each)*; avoid their areas.
>
> Tests: typecheck, `npm test`, your own e2e file `tests/e2e/<name>.test.ts` covering *(scenarios)*, plus
> *(the e2e files your shared changes touch)*.
>
> When your unit is done: push, open the PR with `gh pr create --draft` (or update it), summary, shared files
> touched, what's not done. If you get a "Checkpoint" message, follow it. Your final message: the PR URL, the
> units done and left, a hand-back for the next worker (what's next, where you stopped, gotchas), test results
> with counts, shared files touched.

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
- Scratch files: prefix them with your workstream name and keep them out of commits. Don't edit `.git/info/exclude`
  or `.git/config`: every worktree and the user's main checkout share them.
- **One unit, then hand back.** Don't start the plan's next unit; a fresh worker does it with a clean context. Hand
  back early, at the next green point, if the conversation has been summarized once (a sign the context is
  full) or you've worked for about an hour.
- **A "Checkpoint" message from the coordinator:** finish the step you're on, get the branch green (or revert the
  half-done step), commit, push, update the PR, and hand back with what's left.
- **Keep the context small:** read big C files in parts (`sed -n`, `grep -n`), not whole; pipe test output through
  `grep -E "×|FAIL|Tests "` and look at the failures only; send full e2e output to a file; don't re-read files you
  just edited.
- **The PR is a draft until the workstream's last unit**; the last worker marks it ready (`gh pr ready`).

## 4. Merger

Follow CLAUDE.md's "Merging PRs" (smallest first, merge `origin/master` in, tests, push, squash, clean up), for
the PRs whose workstream is finished (not drafts). On top of that:

- **Which tests to run per merge is your call.** Typecheck and unit tests always. The full e2e suite (~10
  minutes) when the PR, or what merging master brought in, touches code many scenarios go through: the engine,
  scenes, the script engine, field movement, battle, save format, `tools/`. For a PR that adds something
  self-contained (a screen, a special) with its own e2e file, run that file plus the e2e files for any shared code
  it touches. Always run the full suite once at the end, on master with everything merged, before the STATUS PR.
  Say in the LOG entry which runs you did.
- **Cleaning up a merged PR.** Right after each `gh pr merge` (code PRs and docs-only ones alike):

  ```sh
  git worktree remove ../wt-<branch>       # if no other open PR still uses it
  git branch -D <branch>
  git push origin --delete <branch>
  git ls-remote --heads origin <branch>    # must print nothing
  ```

  Don't rely on `gh pr merge --delete-branch`: when a worktree has the branch checked out, it fails to delete the
  local branch and then skips the remote one too. Batches 1-2 of SCREENS_PLAN.md left 15 remote branches this way
  while reporting "all branches cleaned up".

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
- **End-of-batch check, last of all.** Run these and paste their output into your report:

  ```sh
  git fetch --prune && git ls-remote --heads origin   # master, plus branches of PRs still open
  git worktree list                                   # the main checkout, plus worktrees of PRs still open
  gh pr list
  ```

  Anything else left over: clean it up (section above) and run the check again. A report that says "cleaned up"
  without this output doesn't count.
