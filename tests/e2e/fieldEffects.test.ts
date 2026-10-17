// Field graphics that run on their own: tile animations, door animations and ground effects.

import { expect, test } from 'vitest';
import { useGame } from './harness';

const session = useGame();

test('water and flower tiles animate', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await game.waitIdle();
  // TilesetAnim_General: the water frames go to tiles 416+ every 16 frames (8 frames, so the same one every 128),
  // the flowers to 508+ (5 frames: every 80). Both reads in one `until`, exactly 40 ticks apart: with separate
  // evals the gap is 40 plus however long the round trip took, which under load can be 80 or 128.
  const [before, after] = await game.eval(async (t) => {
    const read = () => [t.tilesetTile('General', 416), t.tilesetTile('General', 508)];
    let before: (string | undefined)[] = [];
    let after: (string | undefined)[] = [];
    let ticks = 0;
    await t.until(() => {
      if (ticks === 0) before = read();
      if (ticks++ < 40) return false;
      after = read();
      return true;
    });
    return [before, after];
  });
  expect(after[0]).not.toBe(before[0]);
  expect(after[1]).not.toBe(before[1]);
});

test('a door opens for the player, and closes behind them', async () => {
  // Task_DoorWarp: the player stands below Oak's lab door at (16, 13) and holds up.
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 16, y: 14 });
  await game.waitIdle();
  await game.eval((t) => t.face('up'));
  const sawDoor = game.eval((t) => t.until(() => t.field()?.doorAnimating, 120));
  await game.eval((t) => t.walk('up', 1));
  expect(await sawDoor).toBe(true);
  // The door closes with the player inside it, hidden, before the warp.
  expect(await game.eval((t) => t.until(() => t.field()?.map === 'PalletTown' && t.field()?.y === 13 && !t.field()?.playerVisible, 240))).toBe(true);
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.map)).toBe('PalletTown_ProfessorOaksLab');
});

test('leaving a house, the player walks out of the opening door', async () => {
  // Task_ExitDoor: the 1F mat warps to the door at (6, 7), where the player arrives hidden.
  const game = await session.start({ start: 'after-rival', map: 'PalletTown_PlayersHouse_1F', x: 4, y: 8 });
  await game.waitIdle();
  // The limits are only there to fail rather than hang: the game keeps ticking while Pallet Town loads (fetched
  // the first time), so the arrival took ~185 ticks on an idle machine and 1,221 under load.
  const arrival = game.eval((t) => t.until(() => t.field()?.map === 'PalletTown' && !t.field()?.playerVisible, 20000));
  const door = game.eval((t) => t.until(() => t.field()?.map === 'PalletTown' && t.field()?.doorAnimating, 20000));
  await game.eval((t) => t.enterWarp());
  expect(await arrival).toBe(true);
  expect(await door).toBe(true);
  await game.waitIdle();
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'PalletTown', x: 6, y: 8, facing: 'down', playerVisible: true, doorAnimating: false });
});

test('a ledge jump casts a shadow and lands in rustling grass', async () => {
  // Route 1's ledge at (12, 5) drops into tall grass at (12, 6). A level-100 lead and a repel keep
  // wild Pokémon away.
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 12, y: 4, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await game.waitIdle();
  await game.eval((t) => t.state!.setVar('VAR_REPEL_STEP_COUNT', 100));
  await game.eval((t) => t.face('down'));
  const shadow = game.eval((t) => t.until(() => t.field()?.playerEffects.includes('FLDEFF_SHADOW'), 120));
  await game.press('DOWN'); // facing the ledge, a tap jumps it
  expect(await shadow).toBe(true);
  await game.waitIdle();
  const f = await game.eval((t) => t.field());
  expect(f).toMatchObject({ x: 12, y: 6 });
  // GroundEffect_JumpOnTallGrass: the landing burst and the grass over the player's feet; the shadow
  // is gone (UpdateShadowFieldEffect stops on tall grass).
  expect(f?.playerEffects).toContain('FLDEFF_TALL_GRASS');
  expect(f?.playerEffects).not.toContain('FLDEFF_SHADOW');
  // Each step in the grass rustles the tile stepped onto; the grass left behind stays until the step ends.
  const rustle = game.eval((t) => t.until(() => t.field()?.playerEffects.filter((e) => e === 'FLDEFF_TALL_GRASS').length === 2, 120));
  await game.eval((t) => t.walk('right', 1));
  expect(await rustle).toBe(true);
});

test('standing by a pond shows a reflection', async () => {
  // Viridian City's pond starts at y = 26: the reflection shows while one of the two tiles below the
  // player (or below the tile they came from) is water.
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity', x: 14, y: 20 });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.playerEffects)).not.toContain('reflection');
  await game.eval((t) => t.walkTo(14, 24));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.playerEffects)).toContain('reflection');
  await game.eval((t) => t.walkTo(14, 21));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.playerEffects)).not.toContain('reflection');
});
