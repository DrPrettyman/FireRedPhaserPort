// Drives the real game in headless Chrome over the DevTools protocol (no dependencies), through the
// dev-only `window.__test` hooks (src/dev/testHooks.ts). Usage, in a test file:
//
//   const session = useGame();
//   test('...', async () => {
//     const game = await session.start({ start: 'after-rival', map: 'ViridianForest', x: 41, y: 45 });
//     await game.walk('right');
//     await game.waitForEvent('battleStart');
//   });
//
// `game.eval(fn, ...args)` runs `fn(__test, ...args)` in the page; fn must be self-contained (it is sent
// as source text, so it can't close over test-file variables; pass them as args instead).

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, expect, inject } from 'vitest';
import type { MonSpec, TestApi, TestEvent } from '../../src/dev/testHooks';
import type { Button } from '../../src/input/Input';
import type { Direction } from '../../src/world/direction';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((p): p is string => !!p);

/** Screenshots of failed tests (and `game.screenshot`) land here. */
export const OUTPUT_DIR = resolve(__dirname, '__output__');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a successful wait returns: the predicate's value, minus the falsy cases. */
type Truthy<T> = Exclude<T, false | 0 | '' | null | undefined>;

// ------------------------------------------------------------------ Chrome + CDP

class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners: ((method: string, params: any) => void)[] = [];

  private constructor(private ws: WebSocket) {
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p?.reject(new Error(`${msg.error.message} ${msg.error.data ?? ''}`));
        else p?.resolve(msg.result);
      } else for (const l of this.listeners) l(msg.method, msg.params);
    };
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error(`Could not connect to ${url}`));
    });
    return new Cdp(ws);
  }

  send<T = any>(method: string, params: object = {}): Promise<T> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(listener: (method: string, params: any) => void): void {
    this.listeners.push(listener);
  }

  close(): void {
    this.ws.close();
  }
}

class Browser {
  private constructor(
    private proc: ChildProcess,
    private profile: string,
    readonly cdp: Cdp,
  ) {}

  static async launch(): Promise<Browser> {
    const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
    if (!chrome) throw new Error('Chrome not found: set CHROME_PATH');
    const profile = mkdtempSync(join(tmpdir(), 'firered-e2e-'));
    const proc = spawn(
      chrome,
      [
        '--headless=new',
        '--enable-unsafe-swiftshader',
        '--remote-debugging-port=0',
        '--window-size=720,480',
        // Keep rAF and timers at full speed even though nothing is "visible".
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    // Chrome writes the port it picked to DevToolsActivePort in the profile.
    const portFile = join(profile, 'DevToolsActivePort');
    let port: string | undefined;
    for (let i = 0; i < 100 && !port; i++) {
      await sleep(100);
      if (existsSync(portFile)) port = readFileSync(portFile, 'utf8').split('\n')[0];
    }
    if (!port) throw new Error('Chrome did not open a DevTools port');
    let pageWs: string | undefined;
    for (let i = 0; i < 50 && !pageWs; i++) {
      try {
        const targets: { type: string; webSocketDebuggerUrl: string }[] = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        pageWs = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
      } catch {
        await sleep(100);
      }
    }
    if (!pageWs) throw new Error('No Chrome page target');
    const cdp = await Cdp.connect(pageWs);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    return new Browser(proc, profile, cdp);
  }

  async close(): Promise<void> {
    this.cdp.close();
    this.proc.kill();
    await new Promise((r) => (this.proc.exitCode !== null ? r(null) : this.proc.once('exit', r)));
    rmSync(this.profile, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ the game

export interface StartOptions {
  /** Map folder name and local position (?map=&x=&y=). */
  map?: string;
  x?: number;
  y?: number;
  /** Start preset (?start=after-rival, or the evolution test bed). */
  start?: 'after-rival' | 'evolution';
  starter?: 'bulbasaur' | 'squirtle' | 'charmander';
  /** GBA RNG seed (default 1). */
  seed?: number;
  /** Logic ticks per frame (default 8). */
  speed?: number;
  /** Options text speed (default fast). */
  textSpeed?: 'slow' | 'mid' | 'fast';
  /** Replace the party once the field is up. */
  party?: MonSpec[];
  /** Keep the save slot (localStorage) from before; by default every load starts with it empty. */
  keepSave?: boolean;
  /**
   * Boot to the main menu (a save exists and no map/start preset is given): wait for its scene to start
   * instead of for the field.
   */
  mainMenu?: boolean;
  /**
   * Boot like the game: the title screen first (wait for it instead of for the field). Without it the harness
   * passes `?skipIntro`, which boots to the main menu (with a save) or the new game.
   */
  title?: boolean;
  /**
   * Boot like the game and return as soon as the copyright screen is up (it and the intro come before the title
   * screen; intro.test.ts).
   */
  intro?: boolean;
  /** More URL parameters (e.g. `{ audio: '1' }`, audioOutput.test.ts). */
  query?: Record<string, string>;
}

export interface WaitOptions {
  /** Real-time limit in ms (default 30 s). */
  timeout?: number;
  /** What we were waiting for, for the error message. */
  what?: string;
}

export class Game {
  /** Uncaught page exceptions and console.error lines since the last load. */
  errors: string[] = [];
  /** Every console line since the last load (for debugging a failure). */
  log: string[] = [];

  constructor(
    private cdp: Cdp,
    private baseUrl: string,
  ) {
    cdp.on((method, params) => {
      if (method === 'Runtime.consoleAPICalled') {
        const text = params.args.map((a: any) => a.value ?? a.description).join(' ');
        this.log.push(`[${params.type}] ${text}`);
        if (params.type === 'error') this.errors.push(text);
      } else if (method === 'Runtime.exceptionThrown') {
        const d = params.exceptionDetails;
        const text = d.exception?.description ?? d.text;
        this.log.push(`[exception] ${text}`);
        this.errors.push(text);
      }
    });
  }

  /** Load the game with these options and wait until the field is up. */
  async load(opts: StartOptions = {}): Promise<this> {
    const q = new URLSearchParams();
    if (opts.map) q.set('map', opts.map);
    if (opts.x !== undefined) q.set('x', String(opts.x));
    if (opts.y !== undefined) q.set('y', String(opts.y));
    if (opts.start) q.set('start', opts.start);
    if (opts.starter) q.set('starter', opts.starter);
    q.set('seed', String(opts.seed ?? 1));
    q.set('speed', String(opts.speed ?? 8));
    q.set('textSpeed', opts.textSpeed ?? 'fast');
    if (!opts.title && !opts.intro) q.set('skipIntro', '1');
    for (const [k, v] of Object.entries(opts.query ?? {})) q.set(k, v);
    this.errors = [];
    this.log = [];
    if (!opts.keepSave) await this.clearSave();
    await this.cdp.send('Page.navigate', { url: `${this.baseUrl}/?${q}` });
    await this.waitFor(() => typeof (window as any).__test !== 'undefined', { what: 'test hooks', timeout: 60_000, raw: true });
    if (opts.intro) {
      await this.waitFor((t) => t.events().some((e) => e.type === 'copyrightScreen'), { what: 'the copyright screen', timeout: 60_000 });
      return this;
    }
    if (opts.title) {
      await this.waitFor((t) => t.events().some((e) => e.type === 'titleScreen'), { what: 'the title screen', timeout: 60_000 });
      return this;
    }
    if (opts.mainMenu) {
      await this.waitFor((t) => t.events().some((e) => e.type === 'mainMenu'), { what: 'the main menu', timeout: 60_000 });
      return this;
    }
    await this.waitFor((t) => t.events().some((e) => e.type === 'ready'), { what: 'the field to load', timeout: 60_000 });
    if (opts.party) await this.eval((t, party) => t.setParty(party), opts.party);
    return this;
  }

  /**
   * A real key press through the browser (DevTools Input.dispatchKeyEvent), for what listens to the page's own
   * keyboard events rather than the virtual pad: the audio output's user gesture and mute key (audioOutput.test.ts).
   * `code` is a KeyboardEvent code of a letter key, e.g. 'KeyM'. Turns on focus emulation first: without it, a
   * dispatched key turns headless Chrome's page hidden, and Phaser stops its loop.
   */
  async realKey(code: string): Promise<void> {
    const letter = code.replace(/^Key/, '');
    const k = { code, key: letter.toLowerCase(), windowsVirtualKeyCode: letter.charCodeAt(0), nativeVirtualKeyCode: letter.charCodeAt(0) };
    await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: k.key, ...k });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
  }

  /** Empty the game's localStorage (the save slot) before the next load. */
  async clearSave(): Promise<void> {
    await this.cdp.send('Storage.clearDataForOrigin', { origin: new URL(this.baseUrl).origin, storageTypes: 'local_storage' });
  }

  /** Run `fn(__test, ...args)` in the page and return its (JSON) result. */
  async eval<R, A extends unknown[]>(fn: (t: TestApi, ...args: A) => R | Promise<R>, ...args: A): Promise<R> {
    return this.evalRaw(`(${fn.toString()})(window.__test, ...${JSON.stringify(args)})`);
  }

  private async evalRaw<R>(expression: string): Promise<R> {
    // DevTools only holds a weak handle on the promise it awaits; once the page resolves it, a GC before
    // the inspector's callback runs fails the call with "Promise was collected" (common mid-battle, where
    // each frame allocates a lot). So the page keeps the promise alive until a task after it settles.
    expression = `(() => {
      const p = Promise.resolve(${expression});
      const keep = (window.__e2eKeep ??= new Set());
      keep.add(p);
      p.finally(() => setTimeout(() => keep.delete(p), 0)).catch(() => {});
      return p;
    })()`;
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`In page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value as R;
  }

  /** Poll `fn(__test)` until it returns something truthy; returns that value. */
  waitFor<R>(fn: (t: TestApi) => R, opts: WaitOptions & { raw?: boolean } = {}): Promise<Truthy<R>> {
    const expr = opts.raw ? `(${fn.toString()})()` : `(${fn.toString()})(window.__test)`;
    return this.poll(expr, { ...opts, what: opts.what ?? fn.toString() });
  }

  /**
   * Start watching, in the page and tick by tick, for `fn(__test)` to return something truthy, and resolve with
   * that value (read in that tick). For anything that lasts only a few ticks (a sprite, a register value mid-anim):
   * a `waitFor` poll from here can arrive after it's over. Start it before the thing can happen, without awaiting,
   * and await it afterwards. Rejects after `maxFrames` ticks (default 20000) without it.
   */
  watch<R>(fn: (t: TestApi) => R, opts: { maxFrames?: number; what?: string } = {}): Promise<Truthy<R>> {
    // (a throw counts as not yet: it would otherwise escape from the tick that checks it)
    const expr = `(async () => {
      const fn = ${fn.toString()};
      let v;
      const held = await window.__test.until(() => {
        try { v = fn(window.__test); } catch { v = undefined; }
        return v;
      }, ${opts.maxFrames ?? 20000});
      return held ? v : null;
    })()`;
    const p = this.evalRaw<R | null>(expr).then((v) => {
      if (!v) throw new Error(`Never saw ${opts.what ?? fn.toString()}`);
      return v as Truthy<R>;
    });
    p.catch(() => {}); // a test that fails before awaiting it shouldn't also report an unhandled rejection
    return p;
  }

  /**
   * Wait until the GBA-layer screen whose main callback is `callback2` (`t.gbaScreen()`) runs and its palette
   * fade is over, i.e. it takes input: the bag (`CB2_BagMenuRun`, item_menu.c's Task_BagMenu_HandleInput
   * returns while gPaletteFade.active), the party menu (`CB2_UpdatePartyMenu`). The screens load their
   * graphics asynchronously, so a fixed wait after opening one can end before it's up on a loaded machine.
   */
  async waitForScreen(callback2: string, opts: WaitOptions = {}): Promise<void> {
    const expr = `window.__test.gbaScreen() === ${JSON.stringify(callback2)} && !window.__test.paletteFadeActive()`;
    await this.poll(expr, { what: `${callback2} to take input`, ...opts });
  }

  /** The bag is up and has faded in (see waitForScreen). */
  waitForBag(opts: WaitOptions = {}): Promise<void> {
    return this.waitForScreen('CB2_BagMenuRun', { what: 'the bag to take input', ...opts });
  }

  /** The party menu is up and has faded in (see waitForScreen). */
  waitForPartyMenu(opts: WaitOptions = {}): Promise<void> {
    return this.waitForScreen('CB2_UpdatePartyMenu', { what: 'the party menu to take input', ...opts });
  }

  /** Poll a page expression until it's truthy (errors propagate unless `raw`). */
  private async poll<R>(expr: string, opts: WaitOptions & { raw?: boolean }): Promise<Truthy<R>> {
    const timeout = opts.timeout ?? 30_000;
    const end = Date.now() + timeout;
    let last: unknown;
    while (Date.now() < end) {
      try {
        last = await this.evalRaw<R>(expr);
        if (last) return last as Truthy<R>;
      } catch (e) {
        if (!opts.raw) throw e;
      }
      await sleep(20);
    }
    throw new Error(`Timed out after ${timeout} ms waiting for ${opts.what}${await this.context()}`);
  }

  /** Field position, current scenes and the last few events, for error messages. */
  private async context(): Promise<string> {
    try {
      const c = await this.evalRaw(`({ scenes: __test.scenes(), field: { ...__test.field(), message: __test.message() }, events: __test.events().slice(-8).map(e => e.type + (e.label ? ':' + e.label : '') + (e.map ? ':' + e.map : '')) })`);
      return `\n  state: ${JSON.stringify(c)}\n  last console: ${this.log.slice(-5).join(' | ')}`;
    } catch {
      return '';
    }
  }

  /** Tap buttons for `frames` logic ticks; resolves once they have been released. */
  press(buttons: Button | Button[], frames = 2, gap = 2): Promise<void> {
    return this.eval((t, b, f, gp) => t.press(b, f, gp), buttons, frames, gap);
  }

  /** Tap a button `n` times. */
  async pressTimes(button: Button, n: number): Promise<void> {
    for (let i = 0; i < n; i++) await this.press(button);
  }

  /** Walk `tiles` steps (see TestApi.walk); returns where the player stopped. */
  walk(dir: Direction, tiles = 1): Promise<{ x: number; y: number; map: string; arrived: boolean }> {
    return this.eval((t, d, n) => t.walk(d, n), dir, tiles);
  }

  /** Wait (in the page, frame-exact) until the field takes input. */
  async waitIdle(opts: WaitOptions = {}): Promise<void> {
    await this.waitFor((t) => t.idle(), { what: 'the field to be idle', ...opts });
  }

  /**
   * Press A (or `button`) until `fn(__test)` is truthy; returns its value. Gets through dialogue, and YES
   * on YES/NO prompts. `answers` picks another button while the field message matches, e.g.
   * `[[/nickname/, 'B']]` to say NO to a nickname. `trace` logs the messages seen (for writing a test).
   * Runs in the page (TestApi.mash), so a press never lands on a menu that opened since the last check.
   */
  async mashUntil<R>(
    fn: (t: TestApi) => R,
    opts: WaitOptions & { button?: Button; answers?: [RegExp, Button][]; trace?: boolean; maxFrames?: number } = {},
  ): Promise<Truthy<R>> {
    const answers = (opts.answers ?? []).map(([re, b]) => [re.source, re.flags, b]);
    const call = `__test.mash(${fn.toString()}, ${JSON.stringify(opts.button ?? 'A')}, ${opts.maxFrames ?? 20000}, ${JSON.stringify(answers)})`;
    const timeout = opts.timeout ?? 120_000;
    const result = await Promise.race([
      this.evalRaw<{ value: R; messages: string[] }>(call),
      sleep(timeout).then(() => undefined),
    ]);
    if (opts.trace && result) for (const m of result.messages) console.log(`[message] ${m}`);
    if (result?.value) return result.value as Truthy<R>;
    throw new Error(`Gave up pressing ${opts.button ?? 'A'} waiting for ${opts.what ?? fn.toString()}${await this.context()}`);
  }

  /** Wait until the battle's action menu (FIGHT / BAG / POKéMON / RUN) takes input, pressing A through text before it. */
  async waitForActionMenu(opts: WaitOptions = {}): Promise<void> {
    // (The bundler may suffix the name to avoid a clash: HandleInputChooseAction2.)
    await this.mashUntil((t) => t.battle()?.controller?.startsWith('HandleInputChooseAction'), { what: 'the battle action menu', ...opts });
    await this.eval((t) => t.waitFrames(2));
  }

  /** At the action menu: move the cursor to `action` and select it. */
  async chooseAction(action: 'FIGHT' | 'BAG' | 'POKEMON' | 'RUN'): Promise<void> {
    await this.waitForActionMenu();
    // The cursor remembers its last position: home it to FIGHT (top left), then move.
    await this.press('UP');
    await this.press('LEFT');
    if (action === 'BAG' || action === 'RUN') await this.press('RIGHT');
    if (action === 'POKEMON' || action === 'RUN') await this.press('DOWN');
    await this.press('A');
  }

  /** The field message box's text while it's open. */
  message(): Promise<string | undefined> {
    return this.eval((t) => t.message());
  }

  /** Events since `since` (a seq number from `mark()`). */
  events(since = 0): Promise<TestEvent[]> {
    return this.eval((t, s) => t.events(s), since);
  }

  /** The current event sequence number, to look for events after this point. */
  mark(): Promise<number> {
    return this.eval((t) => t.lastSeq());
  }

  /** Wait for an event of `type` after `since` (default: any time since load). */
  async waitForEvent(type: string, opts: WaitOptions & { since?: number } = {}): Promise<TestEvent> {
    const since = opts.since ?? 0;
    const end = Date.now() + (opts.timeout ?? 30_000);
    while (Date.now() < end) {
      const e = (await this.events(since)).find((ev) => ev.type === type);
      if (e) return e;
      await sleep(20);
    }
    throw new Error(`Timed out waiting for event ${type}${opts.what ? ` (${opts.what})` : ''}${await this.context()}`);
  }

  /** Save a PNG of the page to tests/e2e/__output__/<name>.png. */
  async screenshot(name: string): Promise<string> {
    const r = await this.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const file = join(OUTPUT_DIR, `${name.replace(/[^\w.-]+/g, '_')}.png`);
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
}

// ------------------------------------------------------------------ vitest wiring

/**
 * One Chrome per test file; each `session.start()` reloads the game fresh. After every test: a
 * screenshot if it failed, and a failure if the page threw or logged console.error.
 */
export function useGame(): { start(opts?: StartOptions): Promise<Game> } {
  let browser: Browser | undefined;
  let game: Game | undefined;
  let started = false;

  beforeAll(async () => {
    browser = await Browser.launch();
    game = new Game(browser.cdp, inject('baseUrl'));
  });

  afterAll(async () => {
    await browser?.close();
  });

  afterEach(async (ctx) => {
    if (!game || !started) return;
    started = false;
    if (ctx.task.result?.state === 'fail') {
      const file = await game.screenshot(ctx.task.name).catch(() => undefined);
      if (file) console.log(`screenshot: ${file}`);
      console.log(`last console lines:\n  ${game.log.slice(-15).join('\n  ')}`);
    }
    expect(game.errors, 'page errors').toEqual([]);
  });

  return {
    async start(opts: StartOptions = {}) {
      if (!game) throw new Error('Browser not launched');
      started = true;
      return game.load(opts);
    },
  };
}
