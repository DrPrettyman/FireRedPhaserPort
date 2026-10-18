// Dev script: renders songs / SEs with the port's m4a engine headless and writes a WAV to listen to (what the
// speakers get, without the PSG parts until W-m4a 4). Needs `npm run extract` (public/gen/audio/).
//
//   npx vite-node tools/render-audio.ts MUS_TITLE 1200 /path/to/out.wav [mono]
//
// Prints each song's length and RMS. Several names (comma-separated) start together on frame 0.

import { writeFileSync } from 'node:fs';
import { SetPokemonCryStereo, m4aSongNumStart } from '../src/audio/m4a';
import { haveGenAudio, loadGenAudio, peak, render, rms, toWav } from '../tests/audioRender';

const [names = 'MUS_TITLE', framesArg = '1200', out, mode] = process.argv.slice(2);
if (!haveGenAudio()) throw new Error('public/gen/audio/ is missing: run npm run extract');
const songs = loadGenAudio();
SetPokemonCryStereo(mode === 'mono' ? 0 : 1);
const ids = names.split(',').map((n) => {
  const id = songs.idByName.get(n.toUpperCase());
  if (id === undefined) throw new Error(`no song ${n}`);
  return id;
});
const frames = Number(framesArg);
const r = render(frames, (f) => {
  if (f === 0) for (const id of ids) m4aSongNumStart(id);
});
console.log(`${names}: ${frames} frames, ${r.fifoA.length} samples per FIFO, RMS ${rms(r).toFixed(2)}, peak ${peak(r)}`);
if (out) {
  writeFileSync(out, toWav(r));
  console.log(`wrote ${out} (13,379 Hz stereo)`);
}
