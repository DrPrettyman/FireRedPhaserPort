# Battle animations: plan to finish

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

## Step 1: high-value callbacks (one PR)

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

**Layout:** start a new file per C source (`src/battle/anim/fight.ts`, `rock.ts`, `psychic.ts`, ...) and register
each one in `ported.ts` like the existing modules. Optionally move that file's section out of `moves.ts` into it.
Later PRs then touch separate files and can run in parallel worktrees without conflicts.

**Tests:** add the newly complete labels to the list in `tests/unit/battleAnims.test.ts`. Add an e2e case to
`tests/e2e/battleAnims.test.ts` for any anim that uses a new engine path (for example the psychic background or
Transform), and check a few by eye in mid-anim screenshots.

## Step 2: one PR per type file

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

## Step 3: battle_anim_effects_1/2/3.c

| C file | Symbols left | Scripts touching | Only this file |
|---|---:|---:|---:|
| `battle_anim_effects_3.c` | 70 | 59 | 44 |
| `battle_anim_effects_2.c` | 55 | 42 | 28 |
| `battle_anim_effects_1.c` | 54 | 42 | 34 |

These are the largest files (5.7k, 3.9k and 5.4k lines) and hold mostly later-game and Gen III moves. Split each
into two or three PRs by move.

## Loose ends to close along the way

- `CreateAdditionalMonSpriteForMoveAnim` (battle_anim_mons.c) isn't ported.
- `General_SafariReaction`: done in step 1. Remove it from docs/DEVIATIONS.md when it lands.
- Castform's form change (needs the per-form front pics; Castform has no `front.png`).
- Open question: with the BG dimmed (Thunder Shock, String Shot), faint diagonal lines show at the healthbox
  corners. Compare against the real game (mGBA screenshot) and fix it or record it as matching the GBA.
- Without audio, SE and cry waits in anim scripts end at once. Revisit the timing when audio lands.

## Done when

- `battleAnimCoverage()` returns `[]` for all 397 labels, and the unit test asserts that for every label instead
  of the hand-kept list.
- STATUS.md: the "move/status animations" checklist item is `[x]`, and the anim placeholder entry in
  docs/DEVIATIONS.md is reduced to the no-audio note.
