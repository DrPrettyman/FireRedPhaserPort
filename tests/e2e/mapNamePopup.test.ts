// map_name_popup.c: the map name window that slides in at the top of the screen.

import { expect, test } from 'vitest';
import { useGame } from './harness';

const session = useGame();

test('crossing into another map section slides the new name in, holds it, and slides it out', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 2 });
  // Arriving in Pallet Town (a map with show_map_name) shows its name.
  await game.waitFor((t) => t.mapNamePopup()?.text === 'PALLET TOWN', { what: 'the PALLET TOWN popup' });
  await game.waitIdle();

  // Crossing the connection while it's up reshows it: out, reprinted, back in.
  await game.walk('up', 3); // stops at the connection while Route 1 loads
  await game.waitFor((t) => t.field()?.map === 'Route1', { what: 'Route 1' });
  // 120 frames on screen (tTimer > 120), 12 frames out, then the window is cleared. Counted in the page, frame by
  // frame: polling from here can notice the full height several frames late on a loaded machine.
  expect(await game.eval(async (t) => {
    const shown = await t.until(() => { const p = t.mapNamePopup(); return p?.text === 'ROUTE 1' && p.height === 24; }, 600);
    await t.waitFrames(100);
    return shown && t.mapNamePopup()?.height;
  })).toBe(24);
  expect(await game.eval((t) => t.until(() => t.mapNamePopup() === undefined, 60))).toBe(true);
});

test('a warp shows the name only if the map asks for it, with the floor', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 16, y: 15 });
  await game.waitFor((t) => t.mapNamePopup(), { what: 'the PALLET TOWN popup' });
  // Oak's lab door is at (16, 13); taking it dismisses the popup, and the lab has no show_map_name.
  const mark = await game.mark();
  await game.eval((t) => t.walkTo(16, 13));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.map)).toBe('PalletTown_ProfessorOaksLab');
  expect(await game.eval((t) => t.mapNamePopup())).toBeUndefined();
  expect((await game.events(mark)).filter((e) => e.type === 'mapNamePopup')).toEqual([]);

  // The department store floors add their floor number to "CELADON DEPT." (sMapsecName_CELADON_DEPT_).
  const store = await session.start({ start: 'after-rival', map: 'CeladonCity_DepartmentStore_2F', x: 7, y: 3 });
  expect(await store.waitFor((t) => t.mapNamePopup()?.text, { what: 'the popup' })).toBe('CELADON DEPT. 2F');
  const roof = await session.start({ start: 'after-rival', map: 'CeladonCity_DepartmentStore_Roof', x: 6, y: 3 });
  expect(await roof.waitFor((t) => t.mapNamePopup()?.text, { what: 'the popup' })).toBe('CELADON DEPT. ROOFTOP');
});

test('field input that starts something dismisses the popup at once', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await game.waitFor((t) => t.mapNamePopup()?.height === 24, { what: 'the popup fully shown' });
  await game.press('START');
  await game.waitFor((t) => t.field()?.overlay, { what: 'the start menu' });
  // DismissMapNamePopup jumps to the clearing states: gone within a few frames, no slide out.
  expect(await game.eval((t) => t.until(() => t.mapNamePopup() === undefined, 4))).toBe(true);
});
