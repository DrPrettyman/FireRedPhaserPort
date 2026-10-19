// field_specials.c's `special ListMenu` (Silph Co.'s elevator, the Cerulean badge list) and Flash's
// darkness (overworld.c's flash level, field_screen_effect.c's circle, fldeff_flash.c's FldEff_UseFlash,
// battle_setup.c's TRANSITION_TYPE_FLASH).

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const MEWTWO = { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] };

const listMenu = (game: Game) => game.eval((t) => t.field()?.listMenu);

/** Walk into Silph Co.'s elevator from 1F and press A at its panel; resolves once the floor list is up. */
async function openSilphElevator(game: Game): Promise<void> {
  const mark = await game.mark();
  await game.walk('up'); // the elevator door at (22, 3)
  await game.waitForEvent('map', { since: mark, what: 'the elevator' });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.map)).toBe('SilphCo_Elevator');
  await game.eval((t) => t.walkTo(0, 3)); // the panel is the bg event at (0, 2)
  await game.eval((t) => t.face('up'));
  await game.mashUntil((t) => t.field()?.listMenu, { what: 'the floor list' });
}

test('Silph Co.’s elevator list starts at 1F, scrolls, and B closes it', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SilphCo_1F', x: 22, y: 4 });
  await game.waitIdle();
  await openSilphElevator(game);
  expect(await game.message()).toMatch(/Which floor do you want\?/);
  // InitElevatorFloorSelectMenuPos from 1F: scrolled 5 down, cursor on row 5 = item 10 (1F); 12 items, 7 shown.
  expect(await listMenu(game)).toMatchObject({ listMenuId: 1, scroll: 5, row: 5, selected: 10, arrows: { up: true, down: false } });

  // Up moves the cursor to the middle row (2) before the list scrolls.
  await game.pressTimes('UP', 3);
  expect(await listMenu(game)).toMatchObject({ scroll: 5, row: 2, selected: 7 });
  await game.press('UP');
  expect(await listMenu(game)).toMatchObject({ scroll: 4, row: 2, selected: 6, arrows: { up: true, down: true } });
  await game.pressTimes('UP', 4);
  expect(await listMenu(game)).toMatchObject({ scroll: 0, row: 2, selected: 2, arrows: { up: false, down: true } });
  await game.pressTimes('UP', 3); // the cursor goes on up to 11F and stops there
  expect(await listMenu(game)).toMatchObject({ scroll: 0, row: 0, selected: 0 });

  // B: SCR_MENU_CANCEL, the list and the "Now on:" window close and the script ends.
  await game.press('B');
  await game.waitIdle();
  expect(await listMenu(game)).toBeUndefined();
  expect(await game.eval((t) => t.var('VAR_RESULT'))).toBe(127);
  expect(await game.eval((t) => t.field()?.map)).toBe('SilphCo_Elevator');
});

test('Silph Co.’s elevator takes the player to the floor picked from the list', async () => {
  const game = await session.start({ start: 'after-rival', map: 'SilphCo_1F', x: 22, y: 4 });
  await game.waitIdle();
  await openSilphElevator(game);
  // 1F (item 10) → 5F (item 6): four rows up.
  await game.pressTimes('UP', 4);
  expect(await listMenu(game)).toMatchObject({ selected: 6 });
  await game.press('A');
  // SilphCo_Elevator_EventScript_To5F: the elevator shakes (AnimateElevator), then the door leads to 5F.
  await game.waitIdle({ timeout: 60_000 });
  expect(await listMenu(game)).toBeUndefined();
  expect(await game.eval((t) => t.var('VAR_ELEVATOR_FLOOR'))).toBe(8);
  const mark = await game.mark();
  await game.eval((t) => t.walkTo(2, 5));
  await game.eval((t) => t.enterWarp());
  const arrived = await game.waitForEvent('map', { since: mark, what: 'Silph Co. 5F' });
  expect(arrived.map).toBe('SilphCo_5F');
});

test('the Cerulean badge list stays up while the old man talks, and EXIT closes it', async () => {
  // CeruleanCity_House1's gentleman at (6, 5): LISTMENU_BADGES suspends on a choice (ReturnToListMenu).
  const game = await session.start({ start: 'after-rival', map: 'CeruleanCity_House1', x: 7, y: 5 });
  await game.waitIdle();
  await game.eval((t) => t.face('left'));
  await game.mashUntil((t) => t.field()?.listMenu, { what: 'the badge list' });
  expect(await listMenu(game)).toMatchObject({ listMenuId: 0, scroll: 0, row: 0, selected: 0, suspended: false, arrows: { up: false, down: true } });

  await game.press('DOWN');
  expect(await listMenu(game)).toMatchObject({ selected: 1 });
  await game.press('A');
  // CASCADEBADGE's description, with the list still on screen (Task_SuspendListMenu)
  await game.waitFor((t) => t.field()?.listMenu?.suspended && /Cut/i.test(t.message() ?? ''), { what: 'the Cascade Badge text' });
  await game.mashUntil((t) => t.field()?.listMenu && !t.field()!.listMenu!.suspended, { what: 'the list to take input again' });
  expect(await listMenu(game)).toMatchObject({ selected: 1, arrows: { up: false, down: true } });

  // Down to EXIT (item 8): the list scrolls once the cursor passes the middle row.
  await game.pressTimes('DOWN', 7);
  expect(await listMenu(game)).toMatchObject({ scroll: 5, row: 3, selected: 8, arrows: { up: true, down: false } });
  await game.press('A');
  await game.mashUntil((t) => t.idle(), { what: 'the script to end' });
  expect(await listMenu(game)).toBeUndefined();
  expect(await game.eval((t) => t.var('VAR_RESULT'))).toBe(8);
});

test('Rock Tunnel is dark until Flash lights it', async () => {
  // Route 10's northern Rock Tunnel entrance at (8, 19).
  const game = await session.start({ start: 'after-rival', map: 'Route10', x: 8, y: 20 });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.flash)).toEqual({ level: 0, dark: 0 });
  const mark = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since: mark, what: 'Rock Tunnel' });
  await game.waitIdle();
  // SetDefaultFlashLevel: a `requires_flash` map is at gMaxFlashLevel (radius 24 around the screen centre).
  const dark = await game.eval((t) => t.field()!.flash);
  expect(dark.level).toBe(4);
  expect(dark.dark).toBeGreaterThan(0.9);
  expect(dark.dark).toBeLessThan(0.97);

  // FldEff_UseFlash: FLAG_SYS_FLASH_ACTIVE, then EventScript_FldEffFlash (animateflash 0, setflashlevel 0).
  // The circle grows 2 px every other frame: part way, the darkness is smaller but still there. Watched in the page
  // from the tick Flash starts: polled from Node, the animation could be over first under load (batch 9's merge).
  const midway = await game.eval(async (t) => {
    t.useFlash();
    let seen: { level: number; dark: number } | undefined;
    await t.until(() => {
      const f = t.field()!.flash;
      if (f.dark < 0.85 && f.dark > 0.1) seen = { ...f };
      return seen;
    }, 600);
    return seen;
  });
  expect(await game.eval((t) => t.flag('FLAG_SYS_FLASH_ACTIVE'))).toBe(true);
  expect(midway?.level).toBe(4); // setflashlevel only runs once animateflash is done
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.flash)).toEqual({ level: 0, dark: 0 });

  // Leaving for an outdoor map clears FLAG_SYS_FLASH_ACTIVE (LoadMapFromWarp), so it's dark again next time.
  const out = await game.mark();
  await game.eval((t) => t.walkTo(17, 3));
  await game.walk('up');
  await game.waitForEvent('map', { since: out, what: 'Route 10' });
  await game.waitIdle();
  expect(await game.eval((t) => t.flag('FLAG_SYS_FLASH_ACTIVE'))).toBe(false);
});

test('with FLAG_SYS_FLASH_ACTIVE set, a dark cave starts lit', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route10', x: 8, y: 20 });
  await game.waitIdle();
  // (Flash stays active through warps between a cave's floors; only arriving outdoors clears it.)
  await game.eval((t) => t.state!.setFlag('FLAG_SYS_FLASH_ACTIVE'));
  const mark = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since: mark });
  await game.waitIdle();
  expect(await game.eval((t) => t.flag('FLAG_SYS_FLASH_ACTIVE'))).toBe(true);
  expect(await game.eval((t) => t.field()?.flash)).toEqual({ level: 0, dark: 0 });
});

test('a wild battle in a dark cave opens with the Flash transition (Blur), a lit one with the cave’s', async () => {
  const game = await session.start({ start: 'after-rival', map: 'Route10', x: 8, y: 20, party: [MEWTWO] });
  await game.waitIdle();
  let mark = await game.mark();
  await game.walk('up');
  await game.waitForEvent('map', { since: mark });
  await game.waitIdle();

  // TRANSITION_TYPE_FLASH with a weaker wild mon: B_TRANSITION_BLUR.
  mark = await game.mark();
  // The circle stays on the GBA layer's WIN0 (InitCurrentFlashLevelScanlineEffect) through the transition.
  // (After the intro's blinks, which leave nothing pure black, the blur shows the circle: ~95% black.) Watched in
  // the page from the battle's start: polled from Node, the transition could be over first under load (batch 9).
  const darkField = await game.eval(async (t) => {
    void t.startWildBattle({ species: 'ZUBAT', level: 15 });
    return t.until(() => {
      const black = t.field()?.gbaScreenBlack;
      return black !== undefined && black > 0.9 && black < 0.99;
    }, 1200);
  });
  expect(darkField, 'the dark field on the GBA layer').toBe(true);
  const begin = await game.waitForEvent('battleTransition', { since: mark });
  expect(await game.eval((t, id) => t.nameOf('B_TRANSITION_', id), begin.transition as number)).toBe('B_TRANSITION_BLUR');
  await game.waitForEvent('battleStart', { since: mark, timeout: 60_000 });
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  await game.waitIdle({ timeout: 60_000 });
  // Back on the field, still dark (ResumeMap rebuilds the circle from the flash level).
  expect(await game.eval((t) => t.field()?.flash.level)).toBe(4);
  expect(await game.eval((t) => t.field()!.flash.dark)).toBeGreaterThan(0.9);

  // Lit: TRANSITION_TYPE_CAVE (B_TRANSITION_CLOCKWISE_WIPE).
  await game.eval((t) => t.useFlash());
  await game.waitIdle();
  mark = await game.mark();
  await game.eval((t) => t.startWildBattle({ species: 'ZUBAT', level: 15 }));
  const lit = await game.waitForEvent('battleTransition', { since: mark });
  expect(await game.eval((t, id) => t.nameOf('B_TRANSITION_', id), lit.transition as number)).toBe('B_TRANSITION_CLOCKWISE_WIPE');
});
