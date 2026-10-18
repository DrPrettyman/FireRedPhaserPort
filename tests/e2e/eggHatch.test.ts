// Egg hatching (daycare.c): a party egg with no egg cycles left hatches on the 256th step (ShouldEggHatch →
// EventScript_EggHatch → special EggHatch), the hatch scene runs (wobbles, shards, the white flash, "X hatched from
// the EGG!", the nickname YES/NO), and the party has the hatched mon (AddHatchedMonToParty).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const PALLET = { start: 'after-rival', map: 'PalletTown', x: 12, y: 14 } as const;
const IVS = { hp: 1, attack: 2, defense: 3, speed: 4, spAttack: 5, spDefense: 6 };

/** A Pidgey and a Bulbasaur egg with no cycles left (CreateEgg's), with known IVs and an egg move. */
async function startWithEgg(): Promise<{ game: Game; personality: number }> {
  const game = await session.start({
    ...PALLET,
    party: [
      { species: 'PIDGEY', level: 10 },
      { species: 'BULBASAUR', level: 5, egg: 0, moves: ['TACKLE', 'GROWL', 'PETAL_DANCE'] },
    ],
  });
  const personality = await game.eval((t, ivs) => {
    const egg = t.state!.party[1];
    egg.ivs = { ...ivs };
    // The next step is the 256th: TryProduceOrHatchEgg's counter reaches 255 and the egg hatches.
    t.state!.daycareStepCounter = 254;
    return egg.personality;
  }, IVS);
  return { game, personality };
}

interface HatchLog {
  states: number[];
  eggAnims: number[];
  maxShards: number;
  shardsMade: number;
  monShown: boolean;
}

/** Watch the scene in the page until the nickname YES/NO is up (state 10), logging what it went through. */
function watchScene(game: Game): Promise<HatchLog> {
  return game.watch(
    (t) => {
      const g = globalThis as unknown as { hatchLog?: HatchLog };
      const log = (g.hatchLog ??= { states: [], eggAnims: [], maxShards: 0, shardsMade: 0, monShown: false });
      const p = t.eggHatch();
      if (!p) return undefined;
      if (log.states[log.states.length - 1] !== p.state) log.states.push(p.state);
      if (log.eggAnims[log.eggAnims.length - 1] !== p.eggAnim) log.eggAnims.push(p.eggAnim);
      log.maxShards = Math.max(log.maxShards, p.shardsLeft);
      log.shardsMade = p.shardsMade;
      if (p.eggInvisible && !p.monInvisible) log.monShown = true;
      return p.state === 10 ? log : undefined;
    },
    { what: 'the hatch scene up to the nickname prompt' },
  );
}

/** What the hatched mon looks like in the party. */
const hatched = (game: Game) =>
  game.eval((t) => {
    const m = t.state!.party[1];
    return {
      summary: t.party()[1],
      isEgg: m.isEgg,
      personality: m.personality,
      ivs: m.ivs,
      friendship: m.friendship,
      metLevel: m.metLevel,
      pokeball: m.pokeball,
      otId: m.otId === t.state!.trainerId,
      hatchedEggs: t.state!.getGameStat(13), // GAME_STAT_HATCHED_EGGS
      caught: t.state!.dexCaught.has(1),
      field: t.field(),
    };
  });

test('an egg hatches on the step its cycles run out; NO keeps the species name', async () => {
  const { game, personality } = await startWithEgg();
  const scene = watchScene(game);
  await game.eval((t) => t.walk('right'));
  // "Huh?" (EventScript_EggHatch), then the scene: B advances the message and does nothing in the scene before the prompt.
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_EggHatch_1', { button: 'B', what: 'the hatch scene' });
  expect(await game.eval((t) => t.state!.party[1].isEgg)).toBe(false); // AddHatchedMonToParty ran in CB2_EggHatch_0

  // The egg's first crack, mid-wobble
  await game.watch((t) => (t.eggHatch()?.eggAnim ?? 0) >= 1, { what: 'the first crack' });
  await game.screenshot('eggHatch-crack');
  // "BULBASAUR hatched from the EGG!" stays up for the (silent) fanfare
  await game.watch((t) => t.eggHatch()?.state === 6, { what: 'the hatched message' });
  await game.screenshot('eggHatch-hatched');

  const log = await scene;
  await game.screenshot('eggHatch-prompt');
  expect(log.states).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(log.eggAnims).toEqual([0, 1, 2]);
  expect(log.shardsMade).toBe(19); // 1 + 2 + 16: every entry of sEggShardVelocities
  expect(log.maxShards).toBeGreaterThanOrEqual(16);
  expect(log.monShown).toBe(true);

  // NO: back to the field, the script done.
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });
  const h = await hatched(game);
  expect(h.summary).toMatchObject({ species: 'BULBASAUR', nickname: 'BULBASAUR', level: 5, moves: ['TACKLE', 'GROWL', 'PETAL_DANCE'] });
  expect(h.summary.hp).toBe(h.summary.maxHP);
  expect(h.isEgg).toBe(false);
  expect(h.personality).toBe(personality);
  expect(h.ivs).toEqual(IVS);
  expect(h.friendship).toBe(120);
  expect(h.metLevel).toBe(0);
  expect(h.otId).toBe(true);
  expect(h.hatchedEggs).toBe(1);
  expect(h.caught).toBe(true);
  expect(h.field).toMatchObject({ map: 'PalletTown', x: 13, y: 14 });
  expect(h.field?.script).toBeFalsy();
  await game.screenshot('eggHatch-field');
});

test('YES at the nickname prompt names the hatched mon through the naming screen', async () => {
  const { game } = await startWithEgg();
  await game.eval((t) => t.walk('right'));
  // A through "Huh?" and the scene; A at the prompt is YES.
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_NamingScreen', { what: 'the naming screen' });
  await game.waitForScreen('CB2_NamingScreen');
  await game.screenshot('eggHatch-naming');
  await game.pressTimes('A', 2); // the cursor starts on "A"
  await game.press('START'); // jump to OK
  await game.press('A');
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });
  const h = await hatched(game);
  expect(h.summary).toMatchObject({ species: 'BULBASAUR', nickname: 'AA', level: 5 });
  expect(h.ivs).toEqual(IVS);
  expect(h.field?.map).toBe('PalletTown');
});
