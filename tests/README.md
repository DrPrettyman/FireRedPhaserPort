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
`speed` (logic ticks per frame, default 8) and `textSpeed` (default fast).

The game is driven through `window.__test` (`src/dev/testHooks.ts`, dev builds only). In a test,
`game.eval((t, ...args) => ..., ...args)` runs a function in the page with `t` = `__test`. The function is
sent as source text, so it can't use the test file's variables: pass them as arguments.

| | |
|---|---|
| **Input** | A virtual gamepad that the game samples with the keyboard, once per logic tick. `game.press('A')` taps a button for 2 ticks. `t.walk(dir, n)` / `t.walkTo(x, y)` (pathfinding) / `t.face(dir)` / `t.enterWarp()` (stairs, mats). |
| **Mashing** | `game.mashUntil(t => cond)` presses A until `cond` holds. The check runs in the page at the start of every tick, so a press can't land on a menu that just opened. `answers: [[/nickname/, 'B']]` presses another button while the message matches. `trace: true` logs the messages it went through. |
| **State** | `t.field()` (map, x, y, facing, script, …), `t.idle()`, `t.message()`, `t.party()`, `t.money()`, `t.itemCount('POTION')`, `t.flag(...)`, `t.var(...)`, `t.trainerDefeated('BUG_CATCHER_RICK')`, `t.battle()` (battlers, the player's `controller` function, the last battle `message`), `t.gbaScreen()` (e.g. `CB2_BuyMenu`, `CB2_NamingScreen`), `t.snapshot()` (every set flag and var), `t.state` (the GameState itself). |
| **Events** | Milestones the game reports: `map`, `script`, `trainerApproach`, `battleTransition` (`transition`), `battleTransitionEnd` (`black`: share of black pixels in its last frame), `battleStart`, `battleEnd`, `whiteOut`, `evolution` (`from`, `to`, `stopped`), `mapTransition` (a cave's flash screen: `from`, `to`), `barnDoorWipe`. Use `game.mark()` then `game.waitForEvent(type, { since })`. |
| **Setup** | `t.setParty([...])`, `t.startWildBattle({ species, level })`, `t.forceBattleTransition('SWIRL')` (every battle uses B_TRANSITION_SWIRL), `t.seed(n)`, `t.state.bag.add(...)`. |
| **Battle** | `game.chooseAction('FIGHT' \| 'BAG' \| 'POKEMON' \| 'RUN')` waits for the action menu. Pressing A at the menu picks FIGHT and then the first move, so `mashUntil(battleEnd)` fights a battle to the end. |

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

Runs are close to deterministic, not exactly: the RNG is seeded, but the number of logic ticks between
two harness calls depends on wall-clock time. Write scenarios that hold whatever the dice say.
