// slot_machine.c's game logic (src/menus/slotMachineLogic.ts) against cases worked by hand from the C and the reel
// tables in slot_machine.c:
//   reel 0: 7 PSY CHE ROC PIK SHE PIK MAG 7 SHE PSY ROC CHE PIK SHE 7 MAG PIK ROC SHE PIK
//   reel 1: 7 MAG CHE PSY ROC MAG CHE PSY PIK MAG CHE PSY 7 MAG CHE ROC PSY SHE MAG PSY CHE
//   reel 2: 7 PSY SHE MAG PIK PSY SHE MAG PIK PSY MAG SHE PIK PSY MAG SHE PIK PSY MAG SHE ROC
// A reel at position p shows p+1, p+2, p+3 (top, middle, bottom).

import { beforeEach, describe, expect, test } from 'vitest';
import * as slots from '../../src/menus/slotMachineLogic';
import {
  CalcPayout,
  CalcSlotBias,
  CreateSlotMachineState,
  GetPayout,
  GetRandomSlotMachineId,
  GetWinFlagByLine,
  OneReelBiasCheck,
  PAYOUT_7,
  PAYOUT_CHERRIES2,
  PAYOUT_CHERRIES3,
  PAYOUT_NONE,
  PAYOUT_PIKAPSY,
  ResetMachineBias,
  SpinReels,
  StartReels,
  StopReel1,
  StopReel2,
  StopReel3,
  TwoReelBiasCheck,
  setSlotMachineData,
  type SlotMachineData,
  type SlotMachineState,
} from '../../src/menus/slotMachineLogic';
import { readGen } from './gameData';

const data = readGen<SlotMachineData>('slotMachine.json');
setSlotMachineData(data);

/** A Random() that returns these values in order and fails if the code rolls more. */
function seq(...values: number[]): () => number {
  return () => {
    if (values.length === 0) throw new Error('Random() called more often than expected');
    return values.shift()!;
  };
}

let s: SlotMachineState;
beforeEach(() => {
  s = CreateSlotMachineState(0);
});

describe('tables', () => {
  test("the module's enums match slot_machine.c's", () => {
    for (const [name, value] of Object.entries(data.constants)) {
      if (name.startsWith('ROWATTR_')) continue; // file-private in the module
      expect((slots as Record<string, unknown>)[name], name).toBe(value);
    }
  });

  test('three reels of 21, six machines, sPayoutTable', () => {
    expect(data.reelIcons.map((r) => r.length)).toEqual([21, 21, 21]);
    expect(data.reelBiasChances.length).toBe(6);
    expect(data.payoutTable).toEqual([0, 2, 6, 8, 15, 100, 300]);
  });
});

describe('InitSlotMachineState', () => {
  test('a fresh machine: no bet, reels still with no destination', () => {
    expect(s).toMatchObject({ machineIdx: 0, bet: 0, payout: 0, currentReel: 0, machineBias: 0 });
    expect(s.reelIsSpinning).toEqual([false, false, false]);
    expect(s.reelPositions).toEqual([0, 0, 0]);
    expect(s.destReelPos).toEqual([21, 21, 21]);
  });

  test('PlaySlotMachine: a machine id past sReelBiasChances plays machine 0', () => {
    expect(CreateSlotMachineState(6).machineIdx).toBe(0);
    expect(CreateSlotMachineState(5).machineIdx).toBe(5);
  });
});

describe('the reels spin', () => {
  test('a step down every 3 frames, stopping on the destination', () => {
    StartReels();
    s.reelPositions[0] = 5;
    s.destReelPos[0] = 3;
    for (let i = 0; i < 5; i++) SpinReels();
    expect(s.reelIsSpinning[0]).toBe(true);
    expect([s.reelPositions[0], s.reelSubpixel[0]]).toEqual([4, 2]);
    SpinReels();
    expect(s.reelIsSpinning[0]).toBe(false);
    expect(s.reelPositions[0]).toBe(3);
    expect(s.destReelPos[0]).toBe(21);
    // reel 1 has no destination yet: it keeps going and wraps from 0 to 20
    expect(s.reelIsSpinning[1]).toBe(true);
    expect([s.reelPositions[1], s.reelSubpixel[1]]).toEqual([19, 0]);
  });
});

describe('GetRandomSlotMachineId', () => {
  test('sSlotMachineIndices[Random() % 22]', () => {
    expect(GetRandomSlotMachineId(seq(10))).toBe(0);
    expect(GetRandomSlotMachineId(seq(11))).toBe(1);
    expect(GetRandomSlotMachineId(seq(18))).toBe(3);
    expect(GetRandomSlotMachineId(seq(21))).toBe(5);
    expect(GetRandomSlotMachineId(seq(22))).toBe(0);
  });
});

describe('CalcSlotBias', () => {
  test('Random() / 4 under the first threshold: no bias; no cooldown roll under 0x49', () => {
    CalcSlotBias(seq(0, 100));
    expect([s.machineBias, s.biasCooldown]).toEqual([PAYOUT_NONE, 0]);
  });

  test('the thresholds are cumulative: 8097 * 4 is the first cherries roll', () => {
    CalcSlotBias(seq(8096 * 4 + 3, 0x3fff));
    expect(s.machineBias).toBe(PAYOUT_NONE);
    CalcSlotBias(seq(8097 * 4, 0x3fff));
    expect(s.machineBias).toBe(PAYOUT_CHERRIES2);
  });

  test('past every threshold: 7s; the cooldown is rolled (5 or 60) and counts down', () => {
    CalcSlotBias(seq(15400 * 4, 10, 1));
    expect([s.machineBias, s.biasCooldown]).toEqual([PAYOUT_7, 4]);
    // a 7 (or Rocket) bias stays until a win resets it; only the first roll is made
    CalcSlotBias(seq(0));
    expect(s.machineBias).toBe(PAYOUT_7);
    ResetMachineBias();
    expect(s.machineBias).toBe(PAYOUT_NONE);
  });

  test('with a cooldown running, a no-bias roll rerolls it 70% of the time', () => {
    s.biasCooldown = 4;
    CalcSlotBias(seq(0, 0, 0));
    expect(s.biasCooldown).toBe(59);
    s.biasCooldown = 4;
    CalcSlotBias(seq(0, 11468)); // (int)(0.7 * 0x3FFF) = 11468: not under it
    expect(s.biasCooldown).toBe(3);
  });

  test('each machine has its own table (machine 5: 7s cooldown under 0x73)', () => {
    CalcSlotBias(seq(0, 0x72)); // machine 0: 0x72 isn't under 0x49
    expect(s.biasCooldown).toBe(0);
    s = CreateSlotMachineState(5);
    CalcSlotBias(seq(0, 0x72, 0, 0x3fff)); // 60, then no reroll, then the countdown
    expect(s.biasCooldown).toBe(59);
  });
});

describe('CalcPayout', () => {
  test('7s across the middle: 300 for any bet', () => {
    s.reelPositions = [6, 10, 19]; // MAG 7 SHE | PSY 7 MAG | ROC 7 PSY (reel 2 wraps)
    s.bet = 1;
    expect(CalcPayout()).toBe(PAYOUT_7);
    expect(GetPayout()).toBe(300);
    expect([0, 1, 2, 3, 4].map(GetWinFlagByLine)).toEqual([false, false, true, false, false]);
    s.bet = 3;
    expect(CalcPayout()).toBe(PAYOUT_7);
    expect(GetPayout()).toBe(300);
  });

  test('cherries count per line the bet covers: one is 2 coins, two are 6', () => {
    s.reelPositions = [1, 1, 0]; // CHE ROC PIK | CHE PSY ROC | PSY SHE MAG
    s.bet = 3; // top row: two cherries (6), tl-br: one (2)
    expect(CalcPayout()).toBe(PAYOUT_CHERRIES3);
    expect(GetPayout()).toBe(8);
    expect([0, 1, 2, 3, 4].map(GetWinFlagByLine)).toEqual([true, true, false, false, false]);
    s.bet = 2;
    expect(CalcPayout()).toBe(PAYOUT_CHERRIES3);
    expect(GetPayout()).toBe(6);
    s.bet = 1;
    expect(CalcPayout()).toBe(PAYOUT_NONE);
    expect(GetPayout()).toBe(0);
  });

  test('three Pikachu: 15', () => {
    s.reelPositions = [2, 6, 2]; // ROC PIK SHE | PSY PIK MAG | MAG PIK PSY
    s.bet = 3;
    expect(CalcPayout()).toBe(PAYOUT_PIKAPSY);
    expect(GetPayout()).toBe(15);
  });
});

describe('StopReel1', () => {
  test('no bias: one of the next 5 stops with no cherries showing, at random', () => {
    s.reelPositions[0] = 10; // 11-13 and 10-12 show the cherries at 12: offsets 2, 3, 4 are left
    StopReel1(0, seq(4)); // 4 % 3 = 1: offset 3
    expect(s.destReelPos[0]).toBe(7);
    StopReel1(0, seq(0));
    expect(s.destReelPos[0]).toBe(8);
    StopReel1(0, seq(2));
    expect(s.destReelPos[0]).toBe(6);
    expect(s.reelStopOrder[0]).toBe(0);
  });

  test('between two icons, the reel counts from the next one down', () => {
    s.reelPositions[0] = 11;
    s.reelSubpixel[0] = 1;
    StopReel1(0, seq(4));
    expect(s.destReelPos[0]).toBe(7);
  });

  test('a 7s bias stops with a 7 showing', () => {
    s.machineBias = PAYOUT_7;
    s.reelPositions[0] = 10; // the 7 at 8 shows from position 7 (offset 3)
    StopReel1(0, seq(99));
    expect(s.destReelPos[0]).toBe(7);
    s.reelPositions[0] = 13; // the 7 at 15 already shows (offset 0)
    StopReel1(0, seq(99));
    expect(s.destReelPos[0]).toBe(13);
  });
});

describe('StopReel2 / TwoReelBiasCheck', () => {
  beforeEach(() => {
    s.reelStopOrder[0] = 0;
    s.reelPositions[0] = 7; // 7 SHE PSY
  });

  test('a 7s bias: the first of the next 5 stops lining up a 7 with reel 1', () => {
    s.machineBias = PAYOUT_7;
    s.reelPositions[1] = 15; // the 7 at 12 shows from 11 (offset 4)
    StopReel2(1);
    expect(s.destReelPos[1]).toBe(11);
    expect(s.reel2BiasInPlay).toBe(1);
    expect(s.reelStopOrder[1]).toBe(1);
  });

  test('no stop lines up: offset 4 for Rocket / 7, else 0', () => {
    s.machineBias = PAYOUT_7;
    s.reelPositions[1] = 5;
    StopReel2(1);
    expect(s.destReelPos[1]).toBe(1);
    expect(s.reel2BiasInPlay).toBe(0);
  });

  test('no bias: no cherries on reel 0, and two equal icons on a line', () => {
    expect(TwoReelBiasCheck(0, 8, 1, 12, PAYOUT_NONE)).toBe(true); // 7 7 on the top row
    expect(TwoReelBiasCheck(0, 8, 1, 15, PAYOUT_NONE)).toBe(true); // PSY PSY on bl-tr
    expect(TwoReelBiasCheck(0, 8, 1, 13, PAYOUT_NONE)).toBe(false);
    expect(TwoReelBiasCheck(0, 2, 1, 15, PAYOUT_NONE)).toBe(false); // cherries on reel 0
  });

  test('one cherry: cherries on reel 0 and no two equal on a line', () => {
    expect(TwoReelBiasCheck(0, 2, 1, 15, PAYOUT_CHERRIES2)).toBe(true);
    expect(TwoReelBiasCheck(0, 2, 1, 13, PAYOUT_CHERRIES2)).toBe(false); // CHE CHE on tl-br
    expect(TwoReelBiasCheck(0, 8, 1, 13, PAYOUT_CHERRIES2)).toBe(false); // no cherries
    expect(TwoReelBiasCheck(1, 8, 2, 15, PAYOUT_CHERRIES2)).toBe(true); // reel 0 not stopped
  });
});

describe('StopReel3 / OneReelBiasCheck', () => {
  beforeEach(() => {
    s.reelStopOrder[0] = 0;
    s.reelStopOrder[1] = 1;
    s.reelPositions[0] = 7; // 7 SHE PSY
    s.reelPositions[1] = 11; // 7 MAG CHE
  });

  test('a 7s bias: the last reel stops for 7 7 7, and it pays', () => {
    s.machineBias = PAYOUT_7;
    s.reelPositions[2] = 2; // the 7 at 0 shows on top from 20 (offset 3, wrapping)
    StopReel3(2);
    expect(s.destReelPos[2]).toBe(20);
    s.reelPositions[2] = 20;
    s.bet = 2;
    expect(CalcPayout()).toBe(PAYOUT_7);
    expect(GetPayout()).toBe(300);
    expect(GetWinFlagByLine(1)).toBe(true);
  });

  test('no bias: the first stop with no line of three', () => {
    s.reelPositions[2] = 2;
    StopReel3(2);
    expect(s.destReelPos[2]).toBe(2);
    s.reelPositions[2] = 20; // 7 7 7 on top: skipped
    StopReel3(2);
    expect(s.destReelPos[2]).toBe(19);
    expect(OneReelBiasCheck(2, 20, PAYOUT_NONE)).toBe(false);
  });
});
