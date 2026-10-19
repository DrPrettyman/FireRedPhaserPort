// Dynamic-graphics objects: OBJ_EVENT_GFX_VAR_0..F take their sprite from VAR_OBJ_GFX_ID_0..F
// (SetObjectEventDynamicGraphicsId / VarGetObjectEventGraphicsId, event_object_movement.c / event_data.c), which
// the maps' ON_TRANSITION scripts set: Fuchsia's Kabuto / Omanyte statue, Birth Island's Deoxys, Viridian's
// tutorial old man. SpawnObjectEventInternal takes the graphics from ROM when it spawns, so a script that sets a
// VAR_OBJ_GFX_ID_* and `addobject`s at once has the object out in that frame, whatever sheet the var names.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** A scripted warp (ScrCmd_warp) to map-local (x, y), waiting for the new map to settle. */
async function warp(game: Game, mapId: string, x: number, y: number) {
  const mark = await game.mark();
  await game.eval((_t, id, x, y) => (window as any).game.scene.getScene('Overworld').warp(id, -1, x, y), mapId, x, y);
  await game.waitForEvent('map', { since: mark, what: mapId });
  await game.waitIdle();
}

/** The current map's object with this local id: graphics, map-local position, sprite texture. */
function object(game: Game, localId: number) {
  return game.eval((t, id) => t.objects().find((o) => o.localId === id), localId);
}

/** The texture key of an OBJ_EVENT_GFX_*'s sprite sheet, and whether it's loaded now. */
function sheet(game: Game, gfx: string) {
  return game.eval((_t, gfx) => {
    const g = (window as any).game;
    const key = `spr_${g.registry.get('assets').sprites[gfx].key}`;
    return { key, loaded: g.textures.exists(key) as boolean };
  }, gfx);
}

/**
 * Start a field script of raw commands and wait in the page for the object `localId` to be out with `gfx`: the
 * logic ticks from the start to the first tick that sees it, and the object.
 */
function runAndWatch(game: Game, label: string, code: string[][], localId: number, gfx: string) {
  return game.eval(
    async (t, label, code, localId, gfx) => {
      const start = t.frame();
      if (!t.runScript(label, code)) throw new Error('no field');
      let seen: { ticks: number; obj: ReturnType<typeof t.objects>[number] } | undefined;
      await t.until(() => {
        const obj = t.objects().find((o) => o.localId === localId && o.graphicsId === gfx);
        if (obj) seen = { ticks: t.frame() - start, obj };
        return obj;
      }, 600);
      return seen;
    },
    label,
    code,
    localId,
    gfx,
  );
}

const FUCHSIA_STATUE = 9; // FuchsiaCity's 9th object: OBJ_EVENT_GFX_VAR_0 at (8, 8)

test("Fuchsia's statue: a Kabuto until the Dome Fossil is taken, then an Omanyte (FuchsiaCity_OnTransition)", async () => {
  const game = await session.start({ start: 'after-rival', map: 'FuchsiaCity', x: 8, y: 10 });
  expect(await game.eval((t) => t.flag('FLAG_GOT_DOME_FOSSIL'))).toBe(false);
  const kabuto = await sheet(game, 'OBJ_EVENT_GFX_KABUTO');
  expect(await object(game, FUCHSIA_STATUE)).toMatchObject({ x: 8, y: 8, graphicsId: 'OBJ_EVENT_GFX_KABUTO', texture: kabuto.key });
  // FLAG_GOT_DOME_FOSSIL (Mt. Moon's fossil choice): the next ON_TRANSITION picks the Omanyte
  await game.eval((t) => t.state!.setFlag('FLAG_GOT_DOME_FOSSIL', true));
  await warp(game, 'MAP_FUCHSIA_CITY', 8, 10);
  const omanyte = await sheet(game, 'OBJ_EVENT_GFX_OMANYTE');
  expect(await game.eval((t) => t.var('VAR_OBJ_GFX_ID_0') === t.state!.defines.require('OBJ_EVENT_GFX_OMANYTE'))).toBe(true);
  expect(await object(game, FUCHSIA_STATUE)).toMatchObject({ x: 8, y: 8, graphicsId: 'OBJ_EVENT_GFX_OMANYTE', texture: omanyte.key });
});

test("Birth Island's Deoxys is OBJ_EVENT_GFX_DEOXYS_N (BirthIsland_Exterior_OnTransition), out in the frame it's added", async () => {
  const game = await session.start({ start: 'after-rival', map: 'BirthIsland_Exterior', x: 15, y: 13 });
  expect(await game.eval((t) => t.var('VAR_OBJ_GFX_ID_0') === t.state!.defines.require('OBJ_EVENT_GFX_DEOXYS_N'))).toBe(true);
  // Hidden (FLAG_HIDE_DEOXYS) until the triangle breaks: BirthIsland_Exterior_EventScript_Deoxys's `addobject`
  expect(await object(game, 2)).toBeUndefined();
  const deoxys = await sheet(game, 'OBJ_EVENT_GFX_DEOXYS_N');
  const seen = await runAndWatch(game, 'Test_AddDeoxys', [['addobject', 'LOCALID_BIRTH_ISLAND_DEOXYS']], 2, 'OBJ_EVENT_GFX_DEOXYS_N');
  // The script runs in the tick after the start and the object is out at its end: the next tick sees it
  expect(seen?.ticks).toBe(2);
  expect(seen?.obj).toMatchObject({ x: 15, y: 3, texture: deoxys.key });
});

test('a script sets VAR_OBJ_GFX_ID_0 to a sheet the map never loaded and adds the object: out in that frame', async () => {
  const game = await session.start({ start: 'after-rival', map: 'FuchsiaCity', x: 8, y: 10 });
  // Control: a sheet the map has (the Chansey's) comes out in the tick the script runs
  const control = await runAndWatch(
    game,
    'Test_DynamicGfxLoaded',
    [['removeobject', String(FUCHSIA_STATUE)], ['setvar', 'VAR_OBJ_GFX_ID_0', 'OBJ_EVENT_GFX_CHANSEY'], ['addobject', String(FUCHSIA_STATUE)]],
    FUCHSIA_STATUE,
    'OBJ_EVENT_GFX_CHANSEY',
  );
  expect(control?.ticks).toBe(2);
  await game.waitIdle();
  // Snorlax: no object on Fuchsia or its neighbours uses it, so its sheet isn't in
  const snorlax = await sheet(game, 'OBJ_EVENT_GFX_SNORLAX');
  expect(snorlax.loaded).toBe(false);
  const seen = await runAndWatch(
    game,
    'Test_DynamicGfxUnloaded',
    [['removeobject', String(FUCHSIA_STATUE)], ['setvar', 'VAR_OBJ_GFX_ID_0', 'OBJ_EVENT_GFX_SNORLAX'], ['addobject', String(FUCHSIA_STATUE)]],
    FUCHSIA_STATUE,
    'OBJ_EVENT_GFX_SNORLAX',
  );
  // The same tick as the control: the frame waited for the sheet, it didn't go on without the object
  expect(seen?.ticks).toBe(2);
  expect(seen?.obj).toMatchObject({ x: 8, y: 8, texture: snorlax.key });
  expect((await sheet(game, 'OBJ_EVENT_GFX_SNORLAX')).loaded).toBe(true);
  await game.waitIdle();
  expect(game.log.filter((l) => l.includes('no sprite loaded'))).toEqual([]);
});

test("Viridian's tutorial old man: his three states by VAR_MAP_SCENE_VIRIDIAN_CITY_OLD_MAN, and his text colour", async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianCity', x: 21, y: 13 });
  const OLD_MAN = 4; // LOCALID_TUTORIAL_MAN: OBJ_EVENT_GFX_VAR_0
  // ViridianCity_OnTransition's three branches (setvar VAR_OBJ_GFX_ID_0, setobjectxyperm, setobjectmovementtype)
  const states = [
    { value: 0, gfx: 'OBJ_EVENT_GFX_OLD_MAN_LYING_DOWN', x: 21, y: 11, movementType: 'MOVEMENT_TYPE_FACE_DOWN' },
    { value: 1, gfx: 'OBJ_EVENT_GFX_OLD_MAN_1', x: 21, y: 8, movementType: 'MOVEMENT_TYPE_LOOK_AROUND' },
    { value: 2, gfx: 'OBJ_EVENT_GFX_OLD_MAN_1', x: 21, y: 6, movementType: 'MOVEMENT_TYPE_LOOK_AROUND' },
  ];
  for (const s of states) {
    await game.eval((t, v) => t.state!.setVar('VAR_MAP_SCENE_VIRIDIAN_CITY_OLD_MAN', v), s.value);
    await warp(game, 'MAP_VIRIDIAN_CITY', 21, 13);
    const { key } = await sheet(game, s.gfx);
    expect(await object(game, OLD_MAN), `state ${s.value}`).toMatchObject({ graphicsId: s.gfx, x: s.x, y: s.y, movementType: s.movementType, texture: key });
  }
  // ContextNpcGetTextColor: the selected object's colour from its resolved graphics (OLD_MAN_1: NPC_TEXT_COLOR_MALE;
  // an unresolved OBJ_EVENT_GFX_VAR_0 would be past sTextColorTable's end: neutral)
  await game.eval(async (t) => {
    await t.walkTo(21, 7);
    await t.face('up');
  });
  await game.press('A');
  await game.waitFor((t) => t.message(), { what: "the old man's message" });
  expect(await game.eval((t) => t.textColor())).toBe('male');
});
