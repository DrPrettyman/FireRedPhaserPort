# Battle animations: plan to finish

**Status: Done: PRs #2, #6-#13.** Plans index: [README.md](README.md).

**Done (2026-10-16): every battle_anim_*.c file is ported and all 397 scripts run.** Steps 2-3 ran as eight
workers in two batches (PRs #6-#13). Kept for the record; the one open question (healthbox corner lines) is in
STATUS.md "Loose ends".

Status as of 2026-10-16 (master at `a9d97a8`). See STATUS.md for what is already ported.

The engine is complete: the `battle_anim.c` interpreter, battle_anim_mons.c, mon_movement, normal, utility_funcs,
sound_tasks, status_effects and battle_anim_special.c. What's left is the per-move code. **296 of the 397 scripts
still end at once** because they reach at least one sprite callback or task that isn't registered. In total
**347 symbols** are missing, from 17 decomp files (about 28k lines of C, most of them in `battle_anim_effects_1/2/3.c`).

The work is easy to split up: 152 of the 296 scripts are blocked by a single symbol each. Ported in the order of
how many scripts each one completes:

| Symbols ported | Scripts that start running |
|---:|---:|
| 10 | 37 |
| 25 | 67 |
| 50 | 95 |
| 100 | 145 |

## Getting the current numbers

`battleAnimCoverage()` (src/battle/anim/battleAnim.ts) maps every script label to the symbols it still needs. To
dump it, run a throwaway Vitest file:

```ts
import { test } from 'vitest';
import { writeFileSync } from 'fs';
import { battleAnimCoverage } from '../../src/battle/anim/battleAnim';
import { newBattleEnv } from './gameData';
test('dump', async () => {
  await newBattleEnv();
  writeFileSync('coverage.json', JSON.stringify(battleAnimCoverage(), null, 1));
});
```

Entries look like `gFallingRockSpriteTemplate (AnimFallingRock)` (a template and its callback) or a bare
`AnimTask_*` name.

## Step 1: high-value callbacks (one PR) — done

Done on branch `battle-anims-step1`: 168 of 397 scripts now run. `moves.ts` is split into one module per C
file, so step 2 PRs can each take their own file(s).

These 25 symbols complete **67 scripts**. They are the greedy pick: at each step, take whichever symbols finish the
most scripts.

| Symbol | C file |
|---|---|
| `AnimTask_SetPsychicBackground` | battle_anim_effects_3.c |
| `AnimTask_TransformMon` | battle_anim_effects_3.c |
| `AnimTask_RockMonBackAndForth` | battle_anim_effects_3.c |
| `AnimAngerMark` | battle_anim_effects_2.c |
| `AnimGrantingStars` | battle_anim_effects_1.c |
| `AnimEndureEnergy` | battle_anim_effects_1.c |
| `AnimCuttingSlice` | battle_anim_effects_1.c |
| `AnimBowMon` | battle_anim_effects_1.c |
| `AnimHornHit` | battle_anim_effects_1.c |
| `AnimConstrictBinding` | battle_anim_effects_1.c |
| `AnimBasicFistOrFoot` | battle_anim_fight.c |
| `AnimJumpKick` | battle_anim_fight.c |
| `AnimSlidingKick` | battle_anim_fight.c |
| `AnimParticleInVortex` | battle_anim_rock.c |
| `AnimFallingRock` | battle_anim_rock.c |
| `AnimDefensiveWall` | battle_anim_psychic.c |
| `AnimWallSparkle` | battle_anim_psychic.c |
| `AnimClawSlash` | battle_anim_dark.c |
| `AnimGustToTarget` | battle_anim_flying.c |
| `AnimMissileArc` | battle_anim_bug.c |
| `InitSwirlingFogAnim` | battle_anim_ice.c |
| `AnimTask_CreateSurfWave` | battle_anim_water.c |
| `AnimTask_CreateRaindrops` | battle_anim_water.c |
| `AnimBoneHitProjectile` | battle_anim_ground.c |
| `AnimSunlight` | battle_anim_fire.c |

**Scripts this completes:**
- **Moves:** Aerial Ace, Barrier, Beat Up, Bone Club, Bone Rush, Charm, Comet Punch, Confusion, Constrict,
  Cosmic Power, Counter, Covet, Crush Claw, Cut, Dragon Claw, Dream Eater, Dynamic Punch, Endure, Fire Spin,
  Focus Energy, Fury Attack, Future Sight, Headbutt, Hi Jump Kick, Horn Attack, Horn Drill, Hypnosis, Icicle Spear,
  Jump Kick, Light Screen, Low Kick, Mach Punch, Magic Coat, Metal Claw, Mirror Coat, Mist, Muddy Water,
  Pin Missile, Psybeam, Psychic, Psywave, Rage, Rain Dance, Reflect, Rock Slide, Rock Throw, Rolling Kick,
  Sand Tomb, Shadow Punch, Smog, Steel Wing, Sunny Day, Surf, Synthesis, Transform, Triple Kick, Whirlpool,
  Wing Attack.
- **General anims:** FocusPunchSetUp, FutureSightHit, HeldItemEffect, Rain, SafariReaction, SilphScoped, Sun,
  TurnTrap, WishHeal.

**Layout:** one file per C source (`src/battle/anim/fight.ts`, `rock.ts`, `psychic.ts`, `effects1.ts`, ...),
each registered in `ported.ts`. Later PRs then touch separate files and can run in parallel worktrees without
conflicts (apart from `ported.ts` when a new file is added).

**Tests:** add the newly complete labels to the list in `tests/unit/battleAnims.test.ts` (steps 2-3: see "Working
in parallel" for where). Add an e2e case for any anim that uses a new engine path (for example the psychic background or
Transform), and check a few by eye in mid-anim screenshots.

## Working in parallel (steps 2-3)

Steps 2 and 3 run as several workers at once, each in its own worktree and branch, each owning whole C files.
To keep their PRs from conflicting:

- **Only port your own files' symbols.** If a script also needs a symbol from someone else's file, leave it; the
  script completes when the second file lands (whoever lands second adds its label). Known cases:
  AnimMoveTwisterParticle (effects_1, used by rock), SetSpriteNextToMonHead (effects_1, used by effects_2),
  AnimParticleBurst (effects_2, used by effects_3), AnimTask_HorizontalShake (ground, used by water),
  AnimWaterPulseRing (water, used by effects_2). CreateAdditionalMonSpriteForMoveAnim (battle_anim_mons.c) is
  only used by the second half of effects_3, so that worker ports it (into animMons.ts).
- **Unit test:** add the labels your files complete to your C file's list in `FULLY_PORTED`
  (`tests/unit/battleAnims.test.ts`). Don't touch the other lists.
- **E2e:** put your cases in a new file, `tests/e2e/battleAnims.<file>.test.ts` (e.g. `battleAnims.fight.test.ts`),
  using `tests/e2e/battleAnimHelpers.ts` (`expectMovesRun(session, moves)` runs up to four moves against a
  splashing Snorlax). Don't add to `battleAnims.test.ts`.
- **Which tests to run:** typecheck, `npm test`, and only your own e2e file
  (`npx vitest run --project e2e tests/e2e/battleAnims.<file>.test.ts`). If you change shared code outside
  `src/battle/anim/`, also run `tests/e2e/battleAnims.test.ts`. Don't run the full e2e suite: with several
  workers each starting four Chromes it overloads the machine. The merger runs the anim e2e files for each PR and
  the full suite once per batch.
- **Scratch files:** the scratchpad directory is shared between workers. Prefix anything you write there with your
  worker name (e.g. `e3b-coverage.json`).
- **Shared engine** (`battleAnim.ts`, `animMons.ts`, `gfx.ts`, `src/gba/`): change it only when your callbacks need
  it, keep the change small, and say what you changed in the PR description.
- **Docs:** don't edit the "N of 397 scripts" counts in STATUS.md and docs/DEVIATIONS.md, or this plan's tables;
  whoever merges updates them. Do add your docs/LOG.md entry and any new deviations.

Batch 1 (step 2), one worker each: **A** fight, rock, ground, bug, poison · **B** water, ice, dragon (new module,
register it in `ported.ts`) · **C** fire, electric, flying · **D** ghost, psychic, dark.

Batch 2 (step 3), four workers: **E1** battle_anim_effects_1.c (`effects1.ts`) · **E2** battle_anim_effects_2.c
(`effects2.ts`) · **E3a** battle_anim_effects_3.c up to AnimPainSplitProjectile, C line 2877 (`effects3.ts`) ·
**E3b** battle_anim_effects_3.c from AnimTask_PainSplitMovement, C line 2914, to the end (`effects3b.ts`). The two
halves of effects_3 don't call each other's functions, so E3a and E3b only share the C file. Each worker opens one
PR; a worker that runs low on context commits, pushes and opens its PR with what's done, and says what's left.

## Step 2: one PR per type file — done

Done in PRs #6-#9 (four workers in parallel): every type file is fully ported, and 264 of 397 scripts
run. The table below is the starting point, kept for the record.

After step 1, the remaining symbols per file are below. "Touching" is how many unfinished scripts need something
from the file. "Only this file" is how many of them would be complete after porting just this file.

| C file | Symbols left | Scripts touching | Only this file |
|---|---:|---:|---:|
| `battle_anim_fight.c` | 15 | 16 | 10 |
| `battle_anim_ice.c` | 14 | 13 | 11 |
| `battle_anim_fire.c` | 14 | 13 | 6 |
| `battle_anim_electric.c` | 14 | 9 | 7 |
| `battle_anim_ghost.c` | 12 | 10 | 9 |
| `battle_anim_flying.c` | 12 | 12 | 6 |
| `battle_anim_rock.c` | 11 | 10 | 7 |
| `battle_anim_water.c` | 10 | 8 | 6 |
| `battle_anim_psychic.c` | 10 | 9 | 5 |
| `battle_anim_ground.c` | 9 | 10 | 5 |
| `battle_anim_dark.c` | 8 | 6 | 4 |
| `battle_anim_dragon.c` | 6 | 5 | 5 |
| `battle_anim_bug.c` | 4 | 4 | 4 |
| `battle_anim_poison.c` | 4 | 3 | 3 |

Small files can share a PR (for example bug + poison + dragon + dark). Port each C file completely, not just the
symbols scripts need right now, so the file can be marked done in STATUS.md.

## Step 3: battle_anim_effects_1/2/3.c — done

| C file | Symbols left | Scripts touching | Only this file |
|---|---:|---:|---:|
| `battle_anim_effects_3.c` | 70 | 59 | 53 |
| `battle_anim_effects_2.c` | 55 | 42 | 36 |
| `battle_anim_effects_1.c` | 54 | 42 | 35 |

(After step 2. All 133 unfinished scripts now only wait on these three files.)

These are the largest files (5.7k, 3.9k and 5.4k lines) and hold mostly later-game and Gen III moves. Split each
into two or three PRs by move.

## Loose ends to close along the way

- `CreateAdditionalMonSpriteForMoveAnim` (battle_anim_mons.c): done in E3b (animMons.ts).
- `General_SafariReaction`: done in step 1.
- Castform's form change: done in E3a (HandleSpeciesGfxDataChange's Castform branch; see DEVIATIONS).
- Open question: with the BG dimmed (Thunder Shock, String Shot), faint diagonal lines show at the healthbox
  corners. Compare against the real game (mGBA screenshot) and fix it or record it as matching the GBA.
- Without audio, SE and cry waits in anim scripts end at once. Revisit the timing when audio lands.

## Done when

- `battleAnimCoverage()` returns `[]` for all 397 labels, and the unit test asserts that for every label instead
  of the hand-kept list.
- STATUS.md: the "move/status animations" checklist item is `[x]`, and the anim placeholder entry in
  docs/DEVIATIONS.md is reduced to the no-audio note.
