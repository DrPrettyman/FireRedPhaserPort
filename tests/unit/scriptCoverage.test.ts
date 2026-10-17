// Script coverage: every script command, special, std script, movement action and scripted field effect the
// decomp's event scripts (public/gen/scripts/scripts.json) use, checked against what the port handles:
// ScriptEngine's command table, specials.ts's SPECIALS + ScriptEngine's TRAINER_SPECIALS + the specials other
// modules add with registerSpecials, MovementRunner's dispatch, the field effect natives registered with
// registerFieldEffectNatives. What the port doesn't handle must be in scriptCoverageGaps.ts, tagged by where the
// game needs it; the test fails on a new gap (tag it, or port it) and on a fixed one (take it off the list).
//
// registerSpecials / registerFieldEffectNatives are called from modules that import Phaser, so their tables are
// read from the source text here (the object literal's keys), not imported.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import type { ObjectEvent } from '../../src/entities/ObjectEvent';
import { MovementRunner } from '../../src/script/MovementRunner';
import { ScriptEngine, TRAINER_SPECIALS } from '../../src/script/ScriptEngine';
import { SPECIALS } from '../../src/script/specials';
import { readGen } from './gameData';
import { KNOWN_GAPS, type GapKind } from './scriptCoverageGaps';

interface ScriptsJson {
  code: string[][];
  labels: Record<string, number>;
  defines: Record<string, number>;
  stdScripts: string[];
  macros?: { event: string[]; movement: string[]; map: string[] };
}

interface MapJson {
  name: string;
  objectEvents?: { script?: string }[];
  coordEvents?: { script?: string }[];
  bgEvents?: { script?: string }[];
}

const scripts = readGen<ScriptsJson>('scripts/scripts.json');
const fieldEffectScripts = readGen<Record<string, string[][]>>('field_effects/scripts.json');
const SRC = resolve(__dirname, '../../src');
const MAPS = resolve(__dirname, '../../public/gen/maps');

// ------------------------------------------------------------------ what the port handles

/** The keys of the object literals passed to `callee(...)` anywhere under src/ (registerSpecials({ A, B: ... })). */
function registeredNames(callee: string): Set<string> {
  const names = new Set<string>();
  const files = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    const text = readFileSync(join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    for (const m of text.matchAll(new RegExp(`(?<!function )\\b${callee}\\(\\s*\\{`, 'g'))) {
      let depth = 0;
      let entryStart = true;
      for (let i = m.index + m[0].length - 1; i < text.length; i++) {
        const c = text[i];
        if ('{(['.includes(c)) depth++;
        else if ('})]'.includes(c)) {
          if (--depth === 0) break;
        } else if (depth === 1 && c === ',') entryStart = true;
        else if (depth === 1 && entryStart && /[A-Za-z_$]/.test(c)) {
          names.add(/^[\w$]+/.exec(text.slice(i))![0]);
          entryStart = false;
        }
        if (depth === 1 && c === '{') entryStart = true;
      }
    }
  }
  return names;
}

const engine = new ScriptEngine(...(Array(8).fill({}) as ConstructorParameters<typeof ScriptEngine>));
const handledCommands = new Set(engine.commandNames);
const handledSpecials = new Set([...Object.keys(SPECIALS), ...TRAINER_SPECIALS, ...registeredNames('registerSpecials')]);
const fieldEffectNatives = registeredNames('registerFieldEffectNatives');

/** Run one action through MovementRunner on a stub object; its dispatch logs `[movement] unimplemented` otherwise. */
function movementHandled(op: string): boolean {
  const stub = {
    isMoving: false,
    tileX: 0,
    tileY: 0,
    face() {},
    move() {},
    setVisible() {},
    sprite: { visible: true, setFrame() {} },
  } as unknown as ObjectEvent;
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  try {
    new MovementRunner(stub, [[op], ['step_end']], 0, stub, () => true).tick();
    return !debug.mock.calls.some((c) => String(c[0]).includes('unimplemented'));
  } finally {
    debug.mockRestore();
  }
}

// ------------------------------------------------------------------ what the scripts use

const { code, labels, defines, stdScripts } = scripts;
const macros = scripts.macros;

/** The std script a callstd / gotostd / msgbox runs (ScrCmd_callstd: gStdScripts[n]). */
function stdLabel(op: string, args: string[]): string | undefined {
  if (op === 'callstd' || op === 'gotostd') return stdScripts[defines[args[0]] ?? -1];
  if (op === 'msgbox') return stdScripts[defines[args[1] ?? 'MSGBOX_DEFAULT'] ?? -1];
  return undefined;
}

type OpKind = 'command' | 'movement' | 'data';

function opKind(op: string): OpKind | undefined {
  if (op.startsWith('.') || op.startsWith('#') || macros!.map.includes(op)) return 'data';
  if (macros!.movement.includes(op)) return 'movement';
  if (macros!.event.includes(op)) return 'command';
  return undefined;
}

/** Each gap's key (`kind name`) -> the instruction indices that use it. */
function findGaps(): Map<string, number[]> {
  const gaps = new Map<string, number[]>();
  const add = (kind: GapKind, name: string, i: number) => {
    const key = `${kind} ${name}`;
    gaps.set(key, [...(gaps.get(key) ?? []), i]);
  };
  const movementCache = new Map<string, boolean>();
  code.forEach(([op, ...args], i) => {
    const kind = opKind(op);
    if (kind === 'movement') {
      if (!movementCache.has(op)) movementCache.set(op, movementHandled(op));
      if (!movementCache.get(op)) add('movement', op, i);
      return;
    }
    if (kind !== 'command') return;
    if (!handledCommands.has(op)) add('command', op, i);
    if (op === 'special' && !handledSpecials.has(args[0])) add('special', args[0], i);
    if (op === 'specialvar' && !handledSpecials.has(args[1])) add('special', args[1], i);
    if (op === 'callstd' || op === 'gotostd' || op === 'msgbox') {
      const label = stdLabel(op, args);
      if (label === undefined || labels[label] === undefined) add('std', args[op === 'msgbox' ? 1 : 0] ?? 'MSGBOX_DEFAULT', i);
    }
    if (op === 'dofieldeffect' && args[0].startsWith('FLDEFF_')) {
      const script = fieldEffectScripts[args[0]];
      const natives = (script ?? []).filter(([o]) => o.endsWith('callnative')).map((s) => s[s.length - 1]);
      if (!script || natives.some((n) => !fieldEffectNatives.has(n))) add('fieldeffect', args[0], i);
    }
  });
  return gaps;
}

// ------------------------------------------------------------------ where they're used

/** The label each instruction sits under (the nearest one at or before it). */
const enclosingLabel: string[] = (() => {
  const at = new Map<number, string>();
  for (const [name, i] of Object.entries(labels)) if (!at.has(i)) at.set(i, name);
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < code.length; i++) out.push((current = at.get(i) ?? current));
  return out;
})();

const TERMINATORS = new Set(['end', 'return', 'goto', 'gotostd', 'step_end']);

/** Every instruction reachable from a map's scripts (map scripts, objects, coord and bg events). */
function reachableFrom(map: MapJson): Set<number> {
  const seen = new Set<number>();
  const queue: number[] = [];
  const push = (label: string | undefined) => {
    const i = label === undefined ? undefined : labels[label];
    if (i !== undefined && !seen.has(i)) queue.push(i);
  };
  push(`${map.name}_MapScripts`);
  for (const e of [...(map.objectEvents ?? []), ...(map.coordEvents ?? []), ...(map.bgEvents ?? [])]) push(e.script);
  while (queue.length) {
    for (let i = queue.pop()!; i < code.length && !seen.has(i); i++) {
      const [op, ...args] = code[i];
      if (op.startsWith('.') || op.startsWith('#')) break;
      seen.add(i);
      for (const a of args) push(a);
      push(stdLabel(op, args));
      if (TERMINATORS.has(op)) break;
    }
  }
  return seen;
}

/** Each gap's users: the maps whose scripts reach it, or the enclosing label of code no map reaches. */
function gapUsers(gaps: Map<string, number[]>): Map<string, string[]> {
  const byIndex = new Map<number, Set<string>>();
  for (const file of readdirSync(MAPS).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
    const map = JSON.parse(readFileSync(join(MAPS, file), 'utf8')) as MapJson;
    const seen = reachableFrom(map);
    for (const indices of gaps.values()) {
      for (const i of indices) {
        if (!seen.has(i)) continue;
        if (!byIndex.has(i)) byIndex.set(i, new Set());
        byIndex.get(i)!.add(map.name);
      }
    }
  }
  const users = new Map<string, string[]>();
  for (const [key, indices] of gaps) {
    const set = new Set<string>();
    for (const i of indices) for (const u of byIndex.get(i) ?? [`(${enclosingLabel[i]})`]) set.add(u);
    users.set(key, [...set].sort());
  }
  return users;
}

// ------------------------------------------------------------------ the checks

describe('script coverage', () => {
  test('scripts.json lists the macro names (rerun `npm run extract` if not)', () => {
    expect(macros, 'scripts.json has no `macros`: rerun `npm run extract`').toBeDefined();
  });

  test('every op in the scripts is a command, movement action, map macro or directive', () => {
    const unknown = [...new Set(code.map(([op]) => op).filter((op) => !opKind(op)))];
    expect(unknown, 'ops no macro file defines: add their macro file to `macros` in tools/extract.py').toEqual([]);
  });

  test('the gaps match scriptCoverageGaps.ts', () => {
    const gaps = findGaps();
    const known = new Map(KNOWN_GAPS.map((g) => [`${g.kind} ${g.name}`, g]));
    const added = [...gaps.keys()].filter((k) => !known.has(k));
    const fixed = [...known.keys()].filter((k) => !gaps.has(k));
    const users = gapUsers(new Map(added.map((k) => [k, gaps.get(k)!])));
    const lines: string[] = [];
    if (added.length) {
      lines.push(
        'New gaps: the scripts use these and the port does not handle them. Port them, or add them to',
        'tests/unit/scriptCoverageGaps.ts with a tag (read the decomp scripts that use them):',
        ...added.map((k) => {
          const [kind, name] = k.split(' ');
          // tag '?' on purpose: pasted as is, it fails the typecheck until someone picks one
          const entry = { kind: kind as GapKind, name, tag: '?', where: users.get(k)!.join(', ') };
          return `  ${JSON.stringify(entry)},`;
        }),
      );
    }
    if (fixed.length) {
      lines.push('Fixed gaps: the port handles these now; take them off tests/unit/scriptCoverageGaps.ts:', ...fixed.map((k) => `  ${k}`));
    }
    expect(lines.join('\n')).toBe('');
  });

  test('the known gaps are listed once each', () => {
    const keys = KNOWN_GAPS.map((g) => `${g.kind} ${g.name}`);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
});
