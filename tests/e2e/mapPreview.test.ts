// Map preview screens (map_preview_screen.c): the banner naming a dungeon as the player walks in. A cave's
// (MPS_TYPE_CAVE) shows on the GBA layer during CB2_DoChangeMap (fldeff_flash.c's RunMapPreviewScreen), then the cave
// flash; a forest's (MPS_TYPE_FOREST) over the field as it fades in (Task_RunMapPreviewScreenForest). Both stay up
// MapPreview_GetDuration frames: 120 the first time, 40 once the map's setworldmapflag has run.

import { expect, test } from "vitest";
import { useGame, type Game } from "./harness";

const session = useGame();

/**
 * Watch the next cave preview in the page: the frames its task holds in state 4 (MapPreview_GetDuration + 1: the
 * frame that counts past the duration starts the fade), the change-map tasks it went through, and whether the GBA
 * screen showed something other than black while it held.
 */
function watchCavePreview(game: Game) {
  return game.eval((t) => {
    let held = 0;
    let shown = false;
    let mapsec = -1;
    const tasks: string[] = [];
    return t
      .until(() => {
        const task = t.changeMapTask();
        if (task && tasks[tasks.length - 1] !== task) tasks.push(task);
        const p = t.mapPreview();
        if (p?.kind === "cave" && p.state === 4) {
          held++;
          mapsec = p.mapsec;
          if ((t.field()?.gbaScreenBlack ?? 1) < 0.5) shown = true;
        }
        return tasks.length > 0 && !task;
      }, 20000)
      .then((ok) => ({ ok, held, shown, mapsec, tasks }));
  });
}

/** The same for a forest preview: the frames in state 3 (the hold), in state 4 (the blend out), and the field's lock. */
function watchForestPreview(game: Game) {
  return game.eval((t) => {
    let held = 0;
    let blending = 0;
    let idleWhileUp = false;
    let mapsec = -1;
    let seen = false;
    let lastBlend: [number, number] | undefined;
    return t
      .until(() => {
        const p = t.mapPreview();
        if (p?.kind === "forest") {
          seen = true;
          mapsec = p.mapsec;
          if (p.state === 3) held++;
          if (p.state === 4) {
            blending++;
            lastBlend = "eva" in p ? [p.eva, p.evb] : undefined;
          }
          if (t.idle()) idleWhileUp = true;
          return false;
        }
        return seen;
      }, 20000)
      .then((ok) => ({
        ok,
        held,
        blending,
        idleWhileUp,
        mapsec,
        lastBlend,
        idleAfter: t.idle(),
      }));
  });
}

test("walking into Mt. Moon shows its banner for 120 frames, then 40, and the flash follows", async () => {
  const game = await session.start({
    start: "after-rival",
    map: "Route4",
    x: 19,
    y: 6,
  });
  await game.waitIdle();
  let mark = await game.mark();
  let watch = watchCavePreview(game);
  await game.eval((t) => t.walk("up", 1));
  let seen = await watch;
  expect(seen.ok).toBe(true);
  expect(seen.held).toBe(121);
  expect(seen.shown).toBe(true);
  // Task_MapPreviewScreen_0's last state hands the task to Task_FlashTransition_Enter_1: the cave's flash
  expect(seen.tasks).toEqual([
    "Task_MapPreviewScreen_0",
    "Task_FlashTransition_Enter_1",
    "Task_FlashTransition_Enter_2",
    "Task_FlashTransition_Enter_3",
  ]);
  const ev = await game.waitForEvent("mapPreview", { since: mark });
  expect(ev).toMatchObject({ kind: "cave", duration: 120 });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.map)).toBe("MtMoon_1F");
  expect(await game.eval((t) => t.flag("FLAG_WORLD_MAP_MT_MOON_1F"))).toBe(
    true,
  );

  // Out to Route 4 (no preview: MapHasPreviewScreen is about the destination) and back in
  mark = await game.mark();
  expect(await game.eval((t) => t.enterWarp())).toBe("Route4");
  expect(
    (await game.eval((t, since) => t.events(since), mark)).some(
      (e) => e.type === "mapPreview",
    ),
  ).toBe(false);
  await game.waitIdle();
  await game.eval((t) => t.walkTo(19, 6)); // off the cave mouth
  mark = await game.mark();
  watch = watchCavePreview(game);
  await game.eval((t) => t.walk("up", 1));
  seen = await watch;
  expect(seen.held).toBe(41);
  expect(await game.waitForEvent("mapPreview", { since: mark })).toMatchObject({
    kind: "cave",
    duration: 40,
    mapsec: seen.mapsec,
  });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.map)).toBe("MtMoon_1F");
});

test("holding B cuts a cave banner short", async () => {
  const game = await session.start({
    start: "after-rival",
    map: "Route4",
    x: 19,
    y: 6,
  });
  await game.waitIdle();
  const watch = watchCavePreview(game);
  await game.eval((t) => t.walk("up", 1));
  // JOY_HELD(B_BUTTON) in state 4: the fade to white starts on the first frame it's held
  await game.eval(async (t) => {
    await t.until(() => t.mapPreview()?.state === 4, 20000);
    t.hold("B");
  });
  const seen = await watch;
  await game.eval((t) => t.release("B"));
  expect(seen.held).toBeGreaterThan(0);
  expect(seen.held).toBeLessThan(121);
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.map)).toBe("MtMoon_1F");
});

test("Viridian Forest’s banner holds over the field as it fades in, then blends out", async () => {
  // Route 2's south gate: (7, 1) is the warp into the forest
  const game = await session.start({
    start: "after-rival",
    map: "Route2_ViridianForest_SouthEntrance",
    x: 7,
    y: 2,
  });
  await game.waitIdle();
  let mark = await game.mark();
  let watch = watchForestPreview(game);
  await game.eval((t) => t.walk("up", 1));
  let seen = await watch;
  expect(seen.ok).toBe(true);
  // Task_RunMapPreviewScreenForest: state 3 counts past MapPreview_GetDuration, state 4 steps EVB up and EVA down
  // every third frame until (0, 16): 47 frames
  expect(seen.held).toBe(121);
  expect(seen.blending).toBe(47);
  expect(seen.lastBlend).toEqual([1, 16]);
  expect(seen.idleWhileUp).toBe(false); // the warp's exit task waits for ForestMapPreviewScreenIsRunning
  expect(await game.waitForEvent("mapPreview", { since: mark })).toMatchObject({
    kind: "forest",
    duration: 120,
  });
  // No map name popup: the banner replaces it (LoadMapInStepsLocal's state 12)
  expect(
    (await game.eval((t, since) => t.events(since), mark)).some(
      (e) => e.type === "mapNamePopup",
    ),
  ).toBe(false);
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.map)).toBe("ViridianForest");
  expect(await game.eval((t) => t.mapPreview())).toBeFalsy();

  // Back out to the gate and in again: MapPreview_SetFlag found the flag set, so 40 frames
  expect(await game.eval((t) => t.enterWarp())).toBe(
    "Route2_ViridianForest_SouthEntrance",
  );
  await game.waitIdle();
  await game.eval((t) => t.walkTo(7, 2));
  mark = await game.mark();
  watch = watchForestPreview(game);
  await game.eval((t) => t.walk("up", 1));
  seen = await watch;
  expect(seen.held).toBe(41);
  expect(await game.waitForEvent("mapPreview", { since: mark })).toMatchObject({
    kind: "forest",
    duration: 40,
  });
  await game.waitIdle();
});

test("Icefall Cave (Four Island) has its own banner", async () => {
  const game = await session.start({
    start: "after-rival",
    map: "FourIsland",
    x: 38,
    y: 13,
  });
  await game.mashUntil((t) => t.idle(), { button: "B" }); // the rival's ON_FRAME scene on arrival
  await game.eval((t) => t.walkTo(38, 13)); // (it moves the player aside)
  const mark = await game.mark();
  const watch = watchCavePreview(game);
  await game.eval((t) => t.walk("up", 1));
  const seen = await watch;
  expect(seen.held).toBe(121);
  expect(seen.shown).toBe(true);
  expect(await game.waitForEvent("mapPreview", { since: mark })).toMatchObject({
    kind: "cave",
    duration: 120,
  });
  await game.waitIdle();
  expect(await game.eval((t) => t.field()?.map)).toBe(
    "FourIsland_IcefallCave_Entrance",
  );
});

test("a warp inside one section shows no banner (Mt. Moon 1F to B1F)", async () => {
  // MtMoon_1F's (5, 6) leads down to B1F: both MAPSEC_MT_MOON
  const game = await session.start({
    start: "after-rival",
    map: "MtMoon_1F",
    x: 5,
    y: 7,
  });
  await game.waitIdle();
  const mark = await game.mark();
  const watch = game.eval((t) => {
    let shown = false;
    return t
      .until(
        () => (
          (shown ||= !!t.mapPreview()),
          t.field()?.map !== "MtMoon_1F" && t.idle()
        ),
        20000,
      )
      .then(() => shown);
  });
  await game.eval((t) => t.walk("up", 1));
  expect(await watch).toBe(false);
  expect(await game.eval((t) => t.field()?.map)).toBe("MtMoon_B1F");
  const events = await game.eval((t, since) => t.events(since), mark);
  expect(
    events.some((e) => e.type === "mapPreview" || e.type === "mapTransition"),
  ).toBe(false);
});
