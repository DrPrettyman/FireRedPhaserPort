// slot_machine.c's game logic without the screen: the machine state, the reels' positions and spin, where each
// reel stops (StopReel1/2/3 with the bias checks), the machine's bias for the next spin (CalcSlotBias) and the
// payout (CalcPayout). The screen (CB2_InitSlotMachine, the sprites, MainTask_*) builds on this.
// The tables are extracted from the decomp: public/gen/slotMachine.json (tools/extract_slots.py).
// No Phaser here, so the unit tests load it in Node.

import { random } from '../util/random';

/** public/gen/slotMachine.json */
export interface SlotMachineData {
  /** sReelIconAnimByReelAndPos: [reel][pos] -> ICON_* */
  reelIcons: number[][];
  /** sPayoutTable: PAYOUT_* -> coins */
  payoutTable: number[];
  /** sReelBiasChances: [machine][PAYOUT_*] (cumulative thresholds for Random() / 4; PAYOUT_7's is the 0x3FFF chance of a cooldown) */
  reelBiasChances: number[][];
  /** sSecondReelBiasCheckIndices: pairs of icons[] slots */
  secondReelBiasCheckIndices: number[][];
  /** sThirdReelBiasCheckIndices: the five lines as icons[] slots */
  thirdReelBiasCheckIndices: number[][];
  /** sRowAttributes: [col1 slot, col2 slot, col3 slot, min bet] per line, in winFlags order */
  rowAttributes: number[][];
  /** sSlotMachineIndices (field_specials.c): GetRandomSlotMachineId's table */
  slotMachineIndices: number[];
  /** slot_machine.c's ICON_* / PAYOUT_* / ROWATTR_* enums and NUM_REELS, REEL_LENGTH, NUM_MATCH_LINES */
  constants: Record<string, number>;
}

export let slotMachineData: SlotMachineData;
let loading: Promise<SlotMachineData> | undefined;

export async function loadSlotMachineData(base: string): Promise<SlotMachineData> {
  loading ??= fetch(`${base}/slotMachine.json`).then((res) => {
    if (!res.ok) throw new Error(`Failed to load slotMachine.json: ${res.status}`);
    return res.json() as Promise<SlotMachineData>;
  });
  slotMachineData = await loading;
  return slotMachineData;
}

/** For the unit tests, which read the JSON from disk. */
export function setSlotMachineData(data: SlotMachineData): void {
  slotMachineData = data;
}

export const NUM_REELS = 3;
export const REEL_LENGTH = 21; // Total number of icons per reel
export const NUM_MATCH_LINES = 5; // 3 horizontal, 2 diagonal

export const ICON_7 = 0;
export const ICON_ROCKET = 1;
export const ICON_PIKACHU = 2;
export const ICON_PSYDUCK = 3; // Psyduck in FR, Slowpoke in LG
export const ICON_CHERRIES = 4;
export const ICON_MAGNEMITE = 5; // Magnemite in FR, Voltorb in LG
export const ICON_SHELLDER = 6; // Shellder in FR, Staryu in LG

export const PAYOUT_NONE = 0;
export const PAYOUT_CHERRIES2 = 1;
export const PAYOUT_CHERRIES3 = 2;
export const PAYOUT_MAGSHELL = 3;
export const PAYOUT_PIKAPSY = 4;
export const PAYOUT_ROCKET = 5;
export const PAYOUT_7 = 6;
export const NUM_PAYOUT_TYPES = 7;

const ROWATTR_COL1POS = 0;
const ROWATTR_COL2POS = 1;
const ROWATTR_COL3POS = 2;
const ROWATTR_MINBET = 3;

/** struct SlotMachineState (the screen's savedCallback, taskId and spinReelsTaskId stay with the screen). */
export interface SlotMachineState {
  machineIdx: number;
  currentReel: number;
  /** The PAYOUT_* the reels are steered towards this spin. */
  machineBias: number;
  slotRewardClass: number;
  biasCooldown: number;
  bet: number;
  reelIsSpinning: boolean[];
  reelPositions: number[];
  reelSubpixel: number[];
  destReelPos: number[];
  reelStopOrder: number[];
  reel2BiasInPlay: number;
  winFlags: boolean[];
  payout: number;
}

/** sSlotMachineState */
export let sSlotMachineState: SlotMachineState;

/**
 * PlaySlotMachine's state half: Alloc the state, clamp the machine id, InitSlotMachineState. Alloc doesn't zero the
 * fields InitSlotMachineState leaves alone (machineBias, biasCooldown, reelStopOrder), so on the GBA they start as
 * whatever the heap held; here they start at 0.
 */
export function CreateSlotMachineState(machineIdx: number): SlotMachineState {
  if (machineIdx >= slotMachineData.reelBiasChances.length) machineIdx = 0;
  sSlotMachineState = {
    machineIdx,
    currentReel: 0,
    machineBias: 0,
    slotRewardClass: 0,
    biasCooldown: 0,
    bet: 0,
    reelIsSpinning: [false, false, false],
    reelPositions: [0, 0, 0],
    reelSubpixel: [0, 0, 0],
    destReelPos: [REEL_LENGTH, REEL_LENGTH, REEL_LENGTH],
    reelStopOrder: [0, 0, 0],
    reel2BiasInPlay: 0,
    winFlags: [false, false, false, false, false],
    payout: 0,
  };
  InitSlotMachineState(sSlotMachineState);
  return sSlotMachineState;
}

/** InitSlotMachineState */
export function InitSlotMachineState(ptr: SlotMachineState): void {
  ptr.currentReel = 0;
  ptr.bet = 0;
  ptr.payout = 0;
  // for whatever reason, the loop does not use the ptr param
  for (let i = 0; i < NUM_REELS; i++) {
    sSlotMachineState.reelIsSpinning[i] = false;
    sSlotMachineState.reelPositions[i] = 0;
    sSlotMachineState.reelSubpixel[i] = 0;
    sSlotMachineState.destReelPos[i] = REEL_LENGTH;
  }
}

/** Task_SpinReels without UpdateReelIconSprites: one frame of the reels' spin (a step down every 3 frames). */
export function SpinReels(): void {
  const s = sSlotMachineState;
  for (let i = 0; i < NUM_REELS; i++) {
    if (s.reelIsSpinning[i] || s.reelSubpixel[i] !== 0) {
      if (s.reelSubpixel[i] !== 0 || s.reelPositions[i] !== s.destReelPos[i]) {
        s.reelSubpixel[i]++;
        if (s.reelSubpixel[i] > 2) {
          s.reelSubpixel[i] = 0;
          s.reelPositions[i]--;
          if (s.reelPositions[i] < 0) s.reelPositions[i] = REEL_LENGTH - 1;
        }
        if (s.reelPositions[i] !== s.destReelPos[i]) continue;
      }
      s.destReelPos[i] = REEL_LENGTH;
      s.reelIsSpinning[i] = false;
    }
  }
}

/** StartReels */
export function StartReels(): void {
  for (let i = 0; i < NUM_REELS; i++) sSlotMachineState.reelIsSpinning[i] = true;
}

/** StopCurrentReel: the first, second or third reel to stop picks its stop differently. */
export function StopCurrentReel(whichReel: number, whichReel2: number, rand: () => number = random): void {
  switch (whichReel2) {
    case 0:
      StopReel1(whichReel, rand);
      break;
    case 1:
      StopReel2(whichReel);
      break;
    case 2:
      StopReel3(whichReel);
      break;
  }
}

/** IsReelSpinning */
export function IsReelSpinning(whichReel: number): boolean {
  return sSlotMachineState.reelIsSpinning[whichReel];
}

/** GetNextReelPosition: the position the reel shows next (one further down while it's between two). */
function GetNextReelPosition(whichReel: number): number {
  let position = sSlotMachineState.reelPositions[whichReel];
  if (sSlotMachineState.reelSubpixel[whichReel] !== 0) {
    position--;
    if (position < 0) position = REEL_LENGTH - 1;
  }
  return position;
}

/**
 * The icon at a reel position. StopReel1's no-bias search reads up to 3 bytes before reel 0's row when the reel is
 * near position 0 (it only wraps the top end); those bytes are the end of sReelBiasChances (0x3C, 0x73, 0x00), none
 * of them ICON_CHERRIES, which is all that search tests for. `undefined` here tests false the same way.
 */
function reelIcon(reel: number, pos: number): number {
  return slotMachineData.reelIcons[reel][pos];
}

/** StopReel1: the first reel stops on, or up to 4 icons past, an icon of the machine's bias (no cherries for none). */
export function StopReel1(whichReel: number, rand: () => number = random): void {
  const s = sSlotMachineState;
  const posToSample: number[] = [];
  const nextPos = GetNextReelPosition(whichReel);
  let destPos: number;

  if (s.machineBias === 0 && whichReel === 0) {
    for (let i = 0; i < 5; i++) {
      let j = 0;
      for (destPos = nextPos - i + 1; j < 3; j++, destPos++) {
        if (destPos >= REEL_LENGTH) destPos = 0;
        if (TestReelIconAttribute(1, reelIcon(whichReel, destPos))) break;
      }
      if (j === 3) posToSample.push(i);
    }
  } else if (s.machineBias !== 1 || whichReel === 0) {
    destPos = nextPos + 1;
    for (let i = 0; i < 3; i++, destPos++) {
      if (destPos >= REEL_LENGTH) destPos = 0;
      if (TestReelIconAttribute(s.machineBias, reelIcon(whichReel, destPos))) {
        posToSample[0] = 0;
        break;
      }
    }
    destPos = nextPos;
    for (let i = 0; i < 4; i++, destPos--) {
      if (destPos < 0) destPos = REEL_LENGTH - 1;
      if (TestReelIconAttribute(s.machineBias, reelIcon(whichReel, destPos))) posToSample.push(i + 1);
    }
  }
  if (posToSample.length === 0) destPos = rand() % 5;
  else destPos = posToSample[rand() % posToSample.length];
  destPos = nextPos - destPos;
  if (destPos < 0) destPos += REEL_LENGTH;
  s.reelStopOrder[0] = whichReel;
  s.destReelPos[whichReel] = destPos;
}

/** StopReel2: the second reel stops at the first of the next 5 positions TwoReelBiasCheck likes. */
export function StopReel2(whichReel: number): void {
  const s = sSlotMachineState;
  const possiblePositions: number[] = [];
  const firstStoppedReelId = s.reelStopOrder[0];
  let firstStoppedReelPos = s.reelPositions[firstStoppedReelId] + 1;
  if (firstStoppedReelPos >= REEL_LENGTH) firstStoppedReelPos = 0;
  const nextPos = GetNextReelPosition(whichReel);
  let pos = nextPos + 1;
  if (pos >= REEL_LENGTH) pos = 0;
  for (let i = 0; i < 5; i++) {
    if (TwoReelBiasCheck(firstStoppedReelId, firstStoppedReelPos, whichReel, pos, s.machineBias)) possiblePositions.push(i);
    pos--;
    if (pos < 0) pos = REEL_LENGTH - 1;
  }
  if (possiblePositions.length === 0) {
    s.reel2BiasInPlay = 0;
    pos = s.machineBias === PAYOUT_ROCKET || s.machineBias === PAYOUT_7 ? 4 : 0;
  } else {
    s.reel2BiasInPlay = 1;
    pos = possiblePositions[0];
  }
  pos = nextPos - pos;
  if (pos < 0) pos += REEL_LENGTH;
  s.reelStopOrder[1] = whichReel;
  s.destReelPos[whichReel] = pos;
}

/** StopReel3: the last reel stops at the first of the next 5 positions OneReelBiasCheck likes. */
export function StopReel3(whichReel: number): void {
  const s = sSlotMachineState;
  const possiblePositions: number[] = [];
  const nextPos = GetNextReelPosition(whichReel);
  let testPos = nextPos;
  for (let i = 0; i < 5; i++) {
    if (OneReelBiasCheck(whichReel, testPos, s.machineBias)) possiblePositions.push(i);
    testPos--;
    if (testPos < 0) testPos = 20;
  }
  let pos: number;
  if (possiblePositions.length === 0) pos = s.machineBias === PAYOUT_ROCKET || s.machineBias === PAYOUT_7 ? 4 : 0;
  else pos = possiblePositions[0];
  pos = nextPos - pos;
  if (pos < 0) pos += REEL_LENGTH;
  s.destReelPos[whichReel] = pos;
}

/**
 * TwoReelBiasCheck: whether two stopped reels (each given by its top visible position) suit the bias `icon`.
 * icons[reel * 3 + row]; the reel still spinning reads 7 (no icon).
 */
export function TwoReelBiasCheck(reel0id: number, reel0pos: number, reel1id: number, reel1pos: number, icon: number): boolean {
  const { secondReelBiasCheckIndices: pairs } = slotMachineData;
  const icons = new Array<number>(9).fill(7);
  for (let i = 0; i < 3; i++) {
    icons[3 * reel0id + i] = reelIcon(reel0id, reel0pos);
    icons[3 * reel1id + i] = reelIcon(reel1id, reel1pos);
    reel0pos++;
    if (reel0pos >= REEL_LENGTH) reel0pos = 0;
    reel1pos++;
    if (reel1pos >= REEL_LENGTH) reel1pos = 0;
  }

  switch (icon) {
    case 0:
      for (let i = 0; i < 3; i++) if (TestReelIconAttribute(1, icons[i])) return false;
      for (let i = 0; i < 15; i++) if (icons[pairs[i][0]] === icons[pairs[i][1]]) return true;
      return false;
    case 1:
      if (reel0id === 0 || reel1id === 0) {
        if (reel0id === 1 || reel1id === 1) {
          for (let i = 0; i < 15; i += 3) if (icons[pairs[i][0]] === icons[pairs[i][1]]) return false;
        }
        for (let i = 0; i < 3; i++) if (TestReelIconAttribute(icon, icons[i])) return true;
        return false;
      }
      return true;
    case 2:
      if (reel0id === 2 || reel1id === 2) {
        for (let i = 0; i < 9; i++) if (TestReelIconAttribute(icon, icons[i])) return true;
        return false; // wrong level
      }
    // fallthrough
  }
  for (let i = 0; i < 15; i++) {
    if (icons[pairs[i][0]] === icons[pairs[i][1]] && TestReelIconAttribute(icon, icons[pairs[i][0]])) return true;
  }
  return false;
}

/** OneReelBiasCheck: whether the last reel at `reelPos` (one above its top visible icon) gives the bias's result. */
export function OneReelBiasCheck(reelId: number, reelPos: number, biasIcon: number): boolean {
  const s = sSlotMachineState;
  const lines = slotMachineData.thirdReelBiasCheckIndices;
  const icons = new Array<number>(9);
  const [first, second] = s.reelStopOrder;
  let firstStoppedPos = s.reelPositions[first] + 1;
  let secondStoppedPos = s.reelPositions[second] + 1;
  reelPos++;
  if (firstStoppedPos >= REEL_LENGTH) firstStoppedPos = 0;
  if (secondStoppedPos >= REEL_LENGTH) secondStoppedPos = 0;
  if (reelPos >= REEL_LENGTH) reelPos = 0;
  for (let i = 0; i < 3; i++) {
    icons[first * 3 + i] = reelIcon(first, firstStoppedPos);
    icons[second * 3 + i] = reelIcon(second, secondStoppedPos);
    icons[reelId * 3 + i] = reelIcon(reelId, reelPos);
    if (++firstStoppedPos >= REEL_LENGTH) firstStoppedPos = 0;
    if (++secondStoppedPos >= REEL_LENGTH) secondStoppedPos = 0;
    if (++reelPos >= REEL_LENGTH) reelPos = 0;
  }
  const allThree = (l: number[]) => icons[l[0]] === icons[l[1]] && icons[l[0]] === icons[l[2]];
  switch (biasIcon) {
    case PAYOUT_NONE:
      for (let i = 0; i < 3; i++) if (TestReelIconAttribute(1, icons[i])) return false;
      for (let i = 0; i < NUM_MATCH_LINES; i++) if (allThree(lines[i])) return false;
      return true;
    case PAYOUT_CHERRIES2:
      for (let i = 0; i < NUM_MATCH_LINES; i++) {
        if (icons[lines[i][0]] === icons[lines[i][1]] && TestReelIconAttribute(biasIcon, icons[lines[i][0]])) return false;
      }
      for (let i = 0; i < 3; i++) if (TestReelIconAttribute(biasIcon, icons[i])) return true;
      return false;
    case PAYOUT_CHERRIES3:
      for (let i = 0; i < NUM_MATCH_LINES; i++) {
        if (icons[lines[i][0]] === icons[lines[i][1]] && TestReelIconAttribute(biasIcon, icons[lines[i][0]])) return true;
      }
      return false;
  }
  for (let i = 0; i < NUM_MATCH_LINES; i++) {
    if (allThree(lines[i]) && TestReelIconAttribute(biasIcon, icons[lines[i][0]])) return true;
  }
  return false;
}

/** TestReelIconAttribute: whether `icon` belongs to the PAYOUT_* `attr` (PAYOUT_NONE: anything but cherries). */
export function TestReelIconAttribute(attr: number, icon: number): boolean {
  switch (attr) {
    case PAYOUT_NONE:
      return (icon ^ 4) !== 0;
    case PAYOUT_CHERRIES2:
    case PAYOUT_CHERRIES3:
      return icon === ICON_CHERRIES;
    case PAYOUT_MAGSHELL:
      return icon === ICON_MAGNEMITE || icon === ICON_SHELLDER;
    case PAYOUT_PIKAPSY:
      return icon === ICON_PIKACHU || icon === ICON_PSYDUCK;
    case PAYOUT_ROCKET:
      return icon === ICON_ROCKET;
    case PAYOUT_7:
      return icon === ICON_7;
    default:
      return false;
  }
}

/** ReelIconToPayoutRank */
function ReelIconToPayoutRank(iconId: number): number {
  switch (iconId) {
    default:
    case ICON_CHERRIES:
      return PAYOUT_CHERRIES2;
    case ICON_MAGNEMITE:
    case ICON_SHELLDER:
      return PAYOUT_MAGSHELL;
    case ICON_PIKACHU:
    case ICON_PSYDUCK:
      return PAYOUT_PIKAPSY;
    case ICON_ROCKET:
      return PAYOUT_ROCKET;
    case ICON_7:
      return PAYOUT_7;
  }
}

/**
 * CalcSlotBias: rolls the PAYOUT_* this spin steers towards from the machine's sReelBiasChances. A Rocket or 7 bias
 * stays until a win resets it (ResetMachineBias). biasCooldown is rolled and counted down but nothing reads it.
 */
export function CalcSlotBias(rand: () => number = random): void {
  const s = sSlotMachineState;
  const rval = Math.trunc(rand() / 4);
  const biasChances = slotMachineData.reelBiasChances[s.machineIdx];
  let i: number;
  for (i = 0; i < NUM_PAYOUT_TYPES - 1; i++) {
    if (rval < biasChances[i]) break;
  }
  if (s.machineBias < PAYOUT_ROCKET) {
    if (s.biasCooldown === 0) {
      if ((rand() & 0x3fff) < biasChances[PAYOUT_7]) s.biasCooldown = rand() & 1 ? 5 : 60;
    }
    if (s.biasCooldown !== 0) {
      if (i === 0 && (rand() & 0x3fff) < Math.trunc(0.7 * 0x3fff)) s.biasCooldown = rand() & 1 ? 5 : 60; // 70%
      s.biasCooldown = (s.biasCooldown - 1) & 0xffff;
    }
    s.machineBias = i;
  }
}

/** ResetMachineBias */
export function ResetMachineBias(): void {
  sSlotMachineState.machineBias = 0;
}

/** CalcPayout: sets winFlags and payout for the lines the bet covers; returns the best line's PAYOUT_*. */
export function CalcPayout(): number {
  const s = sSlotMachineState;
  const rows = slotMachineData.rowAttributes;
  const visibleIcons = new Array<number>(9).fill(0);
  for (let i = 0; i < NUM_MATCH_LINES; i++) s.winFlags[i] = false;

  let bestMatch = 0;
  let [reel1pos, reel2pos, reel3pos] = s.reelPositions;
  for (let i = 0; i < 3; i++) {
    if (++reel1pos >= REEL_LENGTH) reel1pos = 0;
    if (++reel2pos >= REEL_LENGTH) reel2pos = 0;
    if (++reel3pos >= REEL_LENGTH) reel3pos = 0;
    visibleIcons[0 * 3 + i] = reelIcon(0, reel1pos);
    visibleIcons[1 * 3 + i] = reelIcon(1, reel2pos);
    visibleIcons[2 * 3 + i] = reelIcon(2, reel3pos);
  }
  s.payout = 0;
  for (let i = 0; i < NUM_MATCH_LINES; i++) {
    if (s.bet >= rows[i][ROWATTR_MINBET]) {
      const col1 = visibleIcons[rows[i][ROWATTR_COL1POS]];
      const col2 = visibleIcons[rows[i][ROWATTR_COL2POS]];
      const col3 = visibleIcons[rows[i][ROWATTR_COL3POS]];
      let curMatch: number;
      if (TestReelIconAttribute(1, col1)) curMatch = TestReelIconAttribute(2, col2) ? 2 : 1;
      else if (col1 === col2 && col1 === col3) curMatch = ReelIconToPayoutRank(col1);
      else curMatch = 0;
      if (curMatch !== 0) {
        s.winFlags[i] = true;
        s.payout += slotMachineData.payoutTable[curMatch];
      }
      if (curMatch > bestMatch) bestMatch = curMatch;
    }
  }
  return bestMatch;
}

/** GetPayout */
export function GetPayout(): number {
  return sSlotMachineState.payout;
}

/** GetPlayerBet */
export function GetPlayerBet(): number {
  return sSlotMachineState.bet;
}

/** GetWinFlagByLine */
export function GetWinFlagByLine(lineId: number): boolean {
  return sSlotMachineState.winFlags[lineId];
}

/** GetRandomSlotMachineId (field_specials.c): which sReelBiasChances row a machine plays with (0 most often). */
export function GetRandomSlotMachineId(rand: () => number = random): number {
  const indices = slotMachineData.slotMachineIndices;
  return indices[rand() % indices.length];
}
