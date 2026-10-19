// map_preview_screen.c's table and timings (world/mapPreviewScreen.ts), against the decomp's values.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, expect, test } from "vitest";
import { loadMenusData } from "../../src/menus/data";
import {
  GetDungeonMapPreviewScreenInfo,
  MapHasPreviewScreen,
  MapPreview_GetDuration,
  MapPreview_SetFlag,
  MPS_TYPE_ANY,
  MPS_TYPE_CAVE,
  MPS_TYPE_FOREST,
} from "../../src/world/mapPreviewScreen";
import { newBattleEnv, type TestGame } from "./gameData";

let t: TestGame;
const PUBLIC = resolve(__dirname, "../../public");

beforeAll(async () => {
  t = await newBattleEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const path = resolve(PUBLIC, String(url));
    if (!existsSync(path)) return new Response(null, { status: 404 });
    return new Response(readFileSync(path));
  }) as typeof fetch;
  try {
    await loadMenusData("gen");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// sMapPreviewScreenData's sections by type, as map_preview_screen.c lists them
const FORESTS = [
  "VIRIDIAN_FOREST",
  "KANTO_SAFARI_ZONE",
  "POKEMON_MANSION",
  "ROCKET_HIDEOUT",
  "POWER_PLANT",
  "ROCKET_WAREHOUSE",
  "BERRY_FOREST",
  "PATTERN_BUSH",
];
const CAVES = [
  "MT_MOON",
  "DIGLETTS_CAVE",
  "ROCK_TUNNEL",
  "POKEMON_TOWER",
  "SEAFOAM_ISLANDS",
  "SILPH_CO",
  "KANTO_VICTORY_ROAD",
  "CERULEAN_CAVE",
  "MT_EMBER",
  "MONEAN_CHAMBER",
  "DOTTED_HOLE",
  "ICEFALL_CAVE",
  "LOST_CAVE",
  "ALTERING_CAVE",
  "LIPTOO_CHAMBER",
  "WEEPTH_CHAMBER",
  "DILFORD_CHAMBER",
  "SCUFIB_CHAMBER",
  "RIXY_CHAMBER",
  "VIAPOIS_CHAMBER",
];

test("every sMapPreviewScreenData entry, with its type", () => {
  for (const [list, type, other] of [
    [FORESTS, MPS_TYPE_FOREST, MPS_TYPE_CAVE],
    [CAVES, MPS_TYPE_CAVE, MPS_TYPE_FOREST],
  ] as const) {
    for (const sec of list) {
      const id = t.d(`MAPSEC_${sec}`);
      expect(MapHasPreviewScreen(id, MPS_TYPE_ANY), sec).toBe(true);
      expect(MapHasPreviewScreen(id, type), sec).toBe(true);
      expect(MapHasPreviewScreen(id, other), sec).toBe(false);
    }
  }
  expect(MapHasPreviewScreen(t.d("MAPSEC_ROUTE_4"), MPS_TYPE_ANY)).toBe(false);
  expect(GetDungeonMapPreviewScreenInfo(t.d("MAPSEC_PALLET_TOWN"))).toBeNull();
  // The Tanoby chambers share the Monean Chamber's graphics and flag
  expect(
    GetDungeonMapPreviewScreenInfo(t.d("MAPSEC_RIXY_CHAMBER")),
  ).toMatchObject({
    flagId: "FLAG_WORLD_MAP_SEVEN_ISLAND_TANOBY_RUINS_MONEAN_CHAMBER",
    tilesptr: "sMoneanChamberMapPreviewTiles",
  });
});

test("MapPreview_GetDuration: a cave reads its flag, a forest what MapPreview_SetFlag saw", () => {
  const mtMoon = t.d("MAPSEC_MT_MOON");
  t.state.setFlag("FLAG_WORLD_MAP_MT_MOON_1F", false);
  expect(MapPreview_GetDuration(mtMoon)).toBe(120);
  t.state.setFlag("FLAG_WORLD_MAP_MT_MOON_1F", true);
  expect(MapPreview_GetDuration(mtMoon)).toBe(40);

  const forest = t.d("MAPSEC_VIRIDIAN_FOREST");
  t.state.setFlag("FLAG_WORLD_MAP_VIRIDIAN_FOREST", false);
  MapPreview_SetFlag("FLAG_WORLD_MAP_VIRIDIAN_FOREST", t.state); // the first visit's ON_TRANSITION
  expect(t.state.getFlag("FLAG_WORLD_MAP_VIRIDIAN_FOREST")).toBe(true);
  expect(MapPreview_GetDuration(forest)).toBe(120);
  MapPreview_SetFlag("FLAG_WORLD_MAP_VIRIDIAN_FOREST", t.state); // a later one
  expect(MapPreview_GetDuration(forest)).toBe(40);

  expect(MapPreview_GetDuration(t.d("MAPSEC_ROUTE_4"))).toBe(0);
});
