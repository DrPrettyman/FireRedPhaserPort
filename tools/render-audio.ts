// Dev script: renders songs / SEs with the port's m4a engine headless and writes a WAV to listen to: what the
// speakers get through the output's sound circuit (the DirectSound FIFOs and the PSG synth, outputCore.ts's
// SoundCircuit, as the worklet plays them). Needs `npm run extract` (public/gen/audio/).
//
//   npx vite-node tools/render-audio.ts MUS_TITLE 1200 /path/to/out.wav [mono] [nopsg]
//
// Prints the length, the FIFOs' RMS (s8 units) and the speakers' AC RMS with and without the PSG. Several names
// (comma-separated) start together on frame 0. The WAV is 53,516 Hz stereo (896 samples per GBA frame).

import { writeFileSync } from 'node:fs';
import { SetPokemonCryStereo, m4aSongNumStart } from '../src/audio/m4a';
import { haveGenAudio, loadGenAudio, peak, render, rms, speakerRms, speakers, toWav } from '../tests/audioRender';

const [names = 'MUS_TITLE', framesArg = '1200', out, ...flags] = process.argv.slice(2);
if (!haveGenAudio()) throw new Error('public/gen/audio/ is missing: run npm run extract');
const songs = loadGenAudio();
SetPokemonCryStereo(flags.includes('mono') ? 0 : 1);
const ids = names.split(',').map((n) => {
  const id = songs.idByName.get(n.toUpperCase());
  if (id === undefined) throw new Error(`no song ${n}`);
  return id;
});
const frames = Number(framesArg);
const r = render(frames, (f) => {
  if (f === 0) for (const id of ids) m4aSongNumStart(id);
});
const withPsg = speakers(r);
const withoutPsg = speakers(r, { psg: false });
console.log(
  `${names}: ${frames} frames; FIFOs: RMS ${rms(r).toFixed(2)}, peak ${peak(r)}; speakers: RMS ${speakerRms(withPsg).toFixed(4)} ` +
    `(without the PSG ${speakerRms(withoutPsg).toFixed(4)})`,
);
if (out) {
  writeFileSync(out, toWav(flags.includes('nopsg') ? withoutPsg : withPsg));
  console.log(`wrote ${out} (53,516 Hz stereo)`);
}
