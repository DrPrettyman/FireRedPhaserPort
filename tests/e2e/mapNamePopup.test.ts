// map_name_popup.c: the map name window that slides in at the top of the screen.

import { expect, test } from 'vitest';
import { useGame } from './harness';

const session = useGame();

test('crossing into another map section slides the new name in, holds it, and slides it out', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 2 });
  // Arriving in Pallet Town (a map with show_map_name) shows its name. (From the event log: the popup is up for
  // ~150 ticks, which a poll from here can miss right after the load.)
  expect((await game.waitForEvent('mapNamePopupText', { what: 'the PALLET TOWN popup' })).text).toBe('PALLET TOWN');
  await game.waitIdle();

  // Crossing the connection while it's up reshows it: out, reprinted, back in.
  // 120 frames on screen (tTimer > 120), 12 frames out, then the window is cleared. Counted inside one `until`
  // predicate, tick by tick: an awaited `until` resumes only where the frame's batch of ticks ends, which on a
  // loaded machine can be dozens of ticks late, so a separate `waitFrames(100)` after it could land past the 120.
  // The tick limit spans Route 1's load (the game keeps ticking meanwhile: over 1,000 ticks under load).
  expect(await game.eval(async (t) => {
    await t.walk('up', 3); // stops at the connection while Route 1 loads
    let shownAt = -1;
    let height: number | undefined;
    await t.until(() => {
      const p = t.mapNamePopup();
      if (shownAt < 0) {
        if (p?.text === 'ROUTE 1' && p.height === 24) shownAt = t.frame();
        return false;
      }
      if (t.frame() < shownAt + 100) return false;
      height = p?.height;
      return true;
    }, 20000);
    return height;
  })).toBe(24);
  expect(await game.eval((t) => t.until(() => t.mapNamePopup() === undefined, 60))).toBe(true);
});

test('a warp shows the name only if the map asks for it, with the floor', async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 16, y: 15 });
  await game.waitForEvent('mapNamePopupText', { what: 'the PALLET TOWN popup' });
  // Oak's lab door is at (16, 13); taking it dismisses the popup, and the lab has no show_map_name.
  const mark = await game.mark();
  await game.eval((t) => t.walkTo(16, 13));
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.map)).toBe('PalletTown_ProfessorOaksLab');
  expect(await game.eval((t) => t.mapNamePopup())).toBeUndefined();
  expect((await game.events(mark)).filter((e) => e.type === 'mapNamePopup')).toEqual([]);

  // The department store floors add their floor number to "CELADON DEPT." (sMapsecName_CELADON_DEPT_).
  const store = await session.start({ start: 'after-rival', map: 'CeladonCity_DepartmentStore_2F', x: 7, y: 3 });
  expect((await store.waitForEvent('mapNamePopupText', { what: 'the popup' })).text).toBe('CELADON DEPT. 2F');
  const roof = await session.start({ start: 'after-rival', map: 'CeladonCity_DepartmentStore_Roof', x: 6, y: 3 });
  expect((await roof.waitForEvent('mapNamePopupText', { what: 'the popup' })).text).toBe('CELADON DEPT. ROOFTOP');
});

test('field input that starts something dismisses the popup at once', async () => {
  // Crossing into Route 1 brings the popup up again; START goes in while it's fully shown. All in the page: it's
  // fully shown for 120 ticks, which polls from here (the popup the load brings up) could miss.
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 2 });
  await game.waitIdle();
  const ticks = await game.eval(async (t) => {
    await t.walk('up', 3);
    if (!(await t.until(() => t.mapNamePopup()?.text === 'ROUTE 1' && t.mapNamePopup()?.height === 24, 20000))) return 'never fully shown';
    await t.press('START');
    // DismissMapNamePopup jumps to the clearing states: gone within a few frames of the start menu, no slide out.
    let openedAt = -1;
    let gone: number | undefined;
    await t.until(() => {
      if (openedAt < 0 && t.field()?.overlay) openedAt = t.frame();
      if (openedAt >= 0 && t.mapNamePopup() === undefined) gone = t.frame() - openedAt;
      return gone !== undefined;
    }, 600);
    return gone;
  });
  expect(ticks).toBeLessThanOrEqual(4);
});
