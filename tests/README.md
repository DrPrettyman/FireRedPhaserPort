# Tests

```
npm test            # unit tests (Node, ~1 s)
npm run test:watch  # unit tests, re-run on save
npm run test:e2e    # the real game in headless Chrome (~20 s)
npm run test:all    # both
npx vitest run tests/e2e/trainerBattle.test.ts -t "losing"   # one file / one test
```

Both suites read the extracted data, so run `npm run extract` first. The e2e suite also needs Google Chrome
(set `CHROME_PATH` if it isn't in the usual place). It starts its own Vite dev server; set `E2E_BASE_URL`
to reuse one that is already running.

## Unit tests (`tests/unit/`)

Pure game logic in Node: RNG, Pokémon creation and stats, the bag and game state, the charmap, the battle
damage formula. `gameData.ts` builds the same objects the game does (`newGame()`: Defines, Charmap,
PokemonData, GameState; `newBattleEnv()` also runs `initBattleEnv` with the battle JSON) from
`public/gen`. Modules that import Phaser can't be loaded here; test those end to end.

`scriptCoverage.test.ts` checks the decomp's scripts against what the port handles; see docs/DEV_NOTES.md
("Script coverage") for what to do when it fails.

Expected values should come from somewhere other than the code under test: a formula written out
independently, a value from the games (e.g. a level-100 Mewtwo's stats), or the decomp.

## End-to-end tests (`tests/e2e/`)

Each file gets one headless Chrome, and `session.start(options)` loads the game fresh:

```ts
const session = useGame();

test('...', async () => {
  const game = await session.start({ start: 'after-rival', map: 'ViridianForest', x: 41, y: 45,
                                     party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await game.walk('right');
  await game.waitForEvent('trainerApproach');
  ...
});
```

Start options: `map`/`x`/`y`, `start: 'after-rival' | 'evolution'` (+ `starter`; see `src/dev/startPresets.ts`), `party`, `seed` (default 1),
`speed` (logic ticks per frame, default 8), `textSpeed` (default fast) and `query` (more URL parameters, e.g.
`{ audio: '1' }`). Every load starts with an empty save
slot (localStorage) unless `keepSave: true`; with a save and no `map`/`start`, the game boots to the main menu, so
pass `mainMenu: true` to wait for it instead of the field (see saveContinue.test.ts). The harness skips the copyright
screen, the intro, the title screen and Oak's speech: it loads the game with `?skipIntro` (dev only), which boots to the main menu with a save
and straight into the new game without one (NEW GAME on that main menu skips Oak's speech too), as the game did
before the title screen existed. Pass `intro: true` to boot like the game and return as soon as the copyright screen is up (intro.test.ts), or
`title: true` to boot like the game does through the copyright screen and the intro to the title screen (and
Oak's speech on NEW GAME); `load()` then waits for the title screen (see titleScreen.test.ts).

The game is driven through `window.__test` (`src/dev/testHooks.ts`, dev builds only). In a test,
`game.eval((t, ...args) => ..., ...args)` runs a function in the page with `t` = `__test`. The function is
sent as source text, so it can't use the test file's variables: pass them as arguments.

| | |
|---|---|
| **Input** | A virtual gamepad that the game samples with the keyboard, once per logic tick. `game.press('A')` taps a button for 2 ticks. `game.realKey('KeyM')` sends a real key press through the browser instead (a user gesture, the mute key: audioOutput.test.ts). `t.walk(dir, n)` / `t.walkTo(x, y)` (pathfinding) / `t.face(dir)` / `t.enterWarp()` (stairs, mats). |
| **Mashing** | `game.mashUntil(t => cond)` presses A until `cond` holds. The check runs in the page at the start of every tick, so a press can't land on a menu that just opened. `answers: [[/nickname/, 'B']]` presses another button while the message matches. `trace: true` logs the messages it went through. |
| **State** | `t.field()` (map, x, y, facing, script, …), `t.idle()`, `t.message()`, `t.party()`, `t.money()`, `t.itemCount('POTION')`, `t.flag(...)`, `t.var(...)`, `t.trainerDefeated('BUG_CATCHER_RICK')`, `t.battle()` (battlers, the player's `controller` function, the last battle `message`), `t.gbaScreen()` (e.g. `CB2_BuyMenu`, `CB2_NamingScreen`), `t.snapshot()` (every set flag and var), `t.state` (the GameState itself). |
| **Events** | Milestones the game reports: `map`, `script`, `trainerApproach`, `battleTransition` (`transition`), `battleTransitionEnd` (`black`: share of black pixels in its last frame), `battleStart`, `battleEnd`, `whiteOut`, `evolution` (`from`, `to`, `stopped`), `mapTransition` (a cave's flash screen or preview: `from`, `to`), `mapPreview` (a map preview screen's banner: `kind` cave / forest, `mapsec`, `duration`), `barnDoorWipe`, `mapNamePopupText` (each name the map name popup prints: `text`), `multichoice` (a multichoice menu opened: `mcId`), `copyrightScreen` (`cb2`), `introCB` (`cb`: each SetIntroCB), `titleScreen`, `titleScene` (`scene`: each SetTitleScreenScene), `mainMenu`, `oakSpeech`. Use `game.mark()` then `game.waitForEvent(type, { since })`. |
| **Setup** | `t.setParty([...])`, `t.startWildBattle({ species, level })`, `t.forceBattleTransition('SWIRL')` (every battle uses B_TRANSITION_SWIRL), `t.seed(n)`, `t.state.bag.add(...)`. |
| **Battle** | `game.chooseAction('FIGHT' \| 'BAG' \| 'POKEMON' \| 'RUN')` waits for the action menu. Pressing A at the menu picks FIGHT and then the first move, so `mashUntil(battleEnd)` fights a battle to the end. |
| **Screens** | `game.waitForBag()` / `game.waitForPartyMenu()` after opening the bag or the party menu (from the start menu, in battle, from an item): they wait until its main callback runs (`t.gbaScreen()` is `CB2_BagMenuRun` / `CB2_UpdatePartyMenu`) and its palette fade is over (`t.paletteFadeActive()`), which is when it takes input. `game.waitForScreen('CB2_...')` does the same for another GBA-layer screen. Don't use a fixed `waitFrames` instead: the screens load their graphics asynchronously, so under load it can end before they're up. |

A test fails if the page throws or logs `console.error`. When a test fails, the harness saves a screenshot to
`tests/e2e/__output__/<test name>.png` and prints the page's last console lines.

### Writing a new scenario

1. Start as close to the action as you can (`?start=after-rival&map=...`), and give the player a party
   that makes the outcome certain (a level-100 Mewtwo to win, a level-2 Magikarp with Splash to lose).
2. Find the steps with `mashUntil(..., { trace: true })` and `game.screenshot('name')`. GBA-layer
   screens (bag, shop, naming screen) have no message probe, so look at the screenshots there.
3. Wait on state and events, not on time. If something has to settle first, wait in ticks
   (`t.waitFrames(n)`, `t.until(() => ...)`), never in milliseconds.
4. Assert what the player would notice (party, money, bag, map, flags), plus the event the game reported.
5. Anything that lasts only a few ticks (a movement action, a jump, the moment an anim ends, a sprite or a
   register value mid-anim, the foe's sprite while Reflect's wall is up) must be watched in the page, not polled
   from Node: under load, a poll can arrive after it's over. Start an in-page watcher (`game.watch(t => ...)`, or
   `game.eval(async (t) => { await t.until(...); ... })`) before it can happen and await it afterwards; do
   hold + watch + release in one eval. What lasts ~150 ticks can be too short as well: the map name popup after a
   load can be over before the harness's `ready` poll and the next one come back, so the hooks log it
   (`mapNamePopupText`). Reseed right before a roll with `reseedAfterAnims` (battleAnimHelpers.ts), which uses
   `t.seedWhen(pred, n)` to seed inside the exact tick (an awaited `t.seed()` lands wherever the frame's batch
   of ticks ends), or seed and press in one eval (`pressSeeded`): in battle VBlankCB_Battle calls Random()
   every tick, as on the GBA, so a seed and a press in two evals are as many rolls apart as ticks ran between
   the round trips (Sweet Kiss missed under load). The same goes for an `await t.until(...)` followed by `t.waitFrames(n)`: the
   wait starts where the batch ends, possibly dozens of ticks late. To check something exactly n ticks after an
   event, or to compare two reads n ticks apart, count inside one `until` predicate (mapNamePopup.test.ts,
   fieldEffects' tile animation: two evals 40 ticks apart were 80 apart under load, a whole flower cycle). Read
   what you check inside the predicate too: `t.until` only returns whether it held, and the game moves on after
   (Baton Pass's party screen replaces the battle sprites right after its anim ends). The same for `mashUntil`:
   have its predicate return the value (the Silph Scope's ghost is renamed ~50 ticks into the anim the mash
   waited for, and a read from Node after the mash came after that).
   A watcher that `import()`s modules before its `until` starts late by the import's time: load them in an
   awaited eval first (inGameTrades' trade scene missed CB2_InitInGameTrade's single frame that way).
   Several tests here failed only when four e2e runs shared the machine.
6. Don't answer a prompt with one press after a fixed wait: if the question is still printing, the press only
   speeds the text up and the next mash answers it instead. Mash the answer button itself (a catch's "Give a
   nickname...?": `mashUntil(..., { button: 'B' })`), use `answers`, or wait in the page for the prompt.
   The same goes for `mashUntil(a menu opened)` followed by a press to pick from it: a menu without an input
   delay takes input in the tick it opens (as on the GBA, its task runs in the frame the script creates it), so
   the mash's last press may already have picked its first item, and the press meant for the menu lands on
   whatever comes next. Mash on to what the choice leads to instead (mainPathLeftovers' cable club).
7. A tick limit (`t.until(pred, maxFrames)`) that spans a warp or anything else that loads files has to allow
   for the load: the game keeps ticking while a map loads, so leaving the player's house took ~185 ticks idle
   and 1,221 under load. Use a generous limit (20000) there; it's only there to fail rather than hang.
8. `mashUntil` / `waitFor` also have a wall-clock `timeout` (120 s by default). A whole battle mashed through runs
   ~10k ticks, which at load ~230 took longer than that (storyLeague's Champion, batch 2 of SIDE_PLAN.md): give
   long mashes a larger `timeout` and let the frame budget (`maxFrames`) be the real bound.
9. Don't assert real-time output statistics (the audio worklet's `dropped` / `underruns`): the browser's frame
   loop stalls under load and ticks several frames at once, so they depend on the machine, not the code
   (audioOutput's tone test failed this way at load ~90 in batch 9).
10. Don't dev-start on a map with trainers and then teleport (`warp`, `t.warpTo`) elsewhere: a trainer can spot
   the player while the start loads, and its EventScript_DoTrainerBattleFromApproach carries on into the next map
   and never ends there (postgameSevenIsland's chambers, batch 10). Start on the map you test, or wait for the
   field to be idle with no script before the warp.
11. Talking to a wandering NPC: being next to it and facing it isn't enough, it can step away before the A press
   lands, and A then talks to nobody. Press A for a few frames until a script starts (`t.mash(t => t.field()?.script,
   'A', 12)`) and walk up again if none did (ssAnne.test.ts's `talkTo`, batch 11).

Runs are close to deterministic, not exactly: the RNG is seeded, but the number of logic ticks between
two harness calls depends on wall-clock time. Write scenarios that hold whatever the dice say.
