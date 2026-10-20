---
name: get-on
description: Run the project autonomously. This session becomes the main coordinator, which starts one sub-coordinator per batch; each plans the next step, runs workers, merges their PRs and updates the docs; then the next one starts. Use when the user says "get on with the project", "carry on", "keep going", or invokes /get-on (optionally with a number of batches or a focus).
---

# Get on with the project

You are the **main coordinator**. You don't plan, port or merge anything yourself: you run sub-coordinators one
after another, each of which runs one batch of docs/WORKFLOW.md, and you keep the user posted. Keeping your own
context small is the point: everything heavy happens in the sub-coordinators.

## Arguments

- A number (`/get-on 2`): run that many batches, then stop. Default: keep going until a stop condition below.
- Anything else is a focus for the next batch ("the Pokédex screen", "audio"), passed to the sub-coordinator.

## Before the first batch

1. Read STATUS.md ("Next up") and `gh pr list`. Don't read the plans or the code; the sub-coordinator does.
2. Main checkout: if its working tree is clean, `git pull --ff-only`. Never switch its branch or edit it.
3. Tell the user in two or three lines what you're starting with and how many batches you'll run.

## The loop

1. Start a sub-coordinator: the Agent tool, `general-purpose`, in the background, with the prompt below (fill in
   the batch number, the focus if any, and the notes from the previous batch's report).
2. Wait for its report. Don't poll it and don't do its work. If the user asks, say it's still running.
3. When it reports, check its cleanup yourself before believing it: `git fetch --prune`,
   `git ls-remote --heads origin`, `git worktree list`, `gh pr list`. Only master and open PRs' branches and
   worktrees should be left. For anything else, check its head matches a merged PR's head
   (`gh pr list --state all --json headRefName,headRefOid,state`), delete it if so (docs/WORKFLOW.md section 4
   "Cleaning up a merged PR"), and tell the user the report missed it. Anything that doesn't match a merged PR: leave
   it and ask.
4. Give the user a short update: what merged (PR numbers), what's left open and why, decisions it made that the user
   may want to revisit, and the test totals. Keep the previous report's "notes for the next batch" for the next
   prompt.
5. Check the stop conditions. If none holds, go to 1.

## Stop conditions

Stop, and tell the user why, when:

- the requested number of batches is done;
- the sub-coordinator reports something that needs the user (a decision it wouldn't take, a permission it was
  denied, a PR it couldn't merge that blocks the next step);
- two batches in a row merged nothing;
- STATUS.md says nothing is left that a batch could do without the user.

A permission a sub-coordinator or worker was denied is never yours to retry: stop and pass it on.

## Sub-coordinator prompt

> You are the sub-coordinator for batch N of a FireRed port to Phaser 3 + TypeScript. The repo is
> /Users/joshua/Coding/PokemonProjects/PhaserRebuild (the main checkout: never switch its branch or edit it; work
> in worktrees next to it). The decomp is /Users/joshua/Coding/PokemonProjects/pret/firered.
>
> Run one batch of docs/WORKFLOW.md, start to finish: read CLAUDE.md, STATUS.md and docs/WORKFLOW.md first.
> *(Focus: … / Notes from the previous batch: …)*
>
> 1. First deal with open PRs (`gh pr list`): merge what's mergeable per section 4, or say why not.
> 2. Pick the next step from STATUS.md "Next up" (or the focus), check it against the decomp and the port, and write
>    the batch into a plan doc (continue the current plan, or start a new `docs/plans/<NAME>_PLAN.md`, added to
>    docs/plans/README.md's table) as a docs-only PR, and merge it.
> 3. Start workers (section 2) in the background, one unit each, and run section 2's watchdog. How many at once (at
>    most four) is your estimate from the work and the machine load (section 1). When a worker hands back with
>    units left, start a continuation worker on the same branch. Workers don't start agents of their own.
> 4. Merge their PRs (section 4: typecheck, unit tests and each PR's own e2e files per merge; the full e2e suite
>    exactly once, at the end; workers never run it), cleaning up each branch and worktree right after its merge.
>    Then the docs-only STATUS/LOG PR, then pull the main checkout if it's clean, then section 4's end-of-batch
>    check.
>
> Decisions: where the plan needs a choice the user hasn't made, take the reasonable one, write it in the plan's
> "Decisions" section marked "(coordinator, revisit if you disagree)", and list it in your report. Deliberate
> divergences from the GBA are allowed if logged in docs/DEVIATIONS.md "Deliberate QOL changes". Don't take
> decisions that are hard to undo (deleting work, rewriting history, changing CLAUDE.md or settings); report them.
>
> If you run low on context: finish the merge you're in, leave the rest open, and say exactly what's left.
>
> Your final message (it goes to the main coordinator, not the user): PRs merged (numbers, one line each), PRs left
> open and why, decisions you took, deviations added, test totals from the last full run, the end-of-batch check's
> output, anything that needs the user, and notes for the next batch (what you'd do next and why).
