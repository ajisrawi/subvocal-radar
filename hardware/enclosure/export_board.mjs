// Exports the routed board as plain geometry for the enclosure / render scripts:
// outline, top-side pads (world mm), traces, vias and component bodies. Uses openpcb's own pad transform.
//   node hardware/enclosure/export_board.mjs  ->  hardware/enclosure/build/board_geometry.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPENPCB = process.env.OPENPCB_DIR ?? join(homedir(), 'Documents', 'PCB Router 2022');
const { padToBoard } = await import(pathToFileURL(`${OPENPCB}/packages/cli/dist/editor/src/model.js`));
const p = JSON.parse(readFileSync(join(HERE, '..', 'subvocal-radar.openboard.json'), 'utf8'));

const pads = [];
for (const c of p.components) {
  const fp = p.footprints[c.footprint];
  for (const pad of fp.pads) {
    const at = padToBoard(c, pad);
    const rot = ((c.rot + (pad.rot ?? 0)) % 180 + 180) % 180;
    const swap = rot === 90;
    pads.push({ ref: c.ref, id: pad.id, x: at.x, y: at.y, w: swap ? pad.h : pad.w, h: swap ? pad.w : pad.h, shape: pad.shape, th: pad.th, drill: pad.drill ?? 0, side: c.side });
  }
}
const comps = p.components.map((c) => {
  const fp = p.footprints[c.footprint];
  return { ref: c.ref, footprint: c.footprint, value: c.value, x: c.x, y: c.y, rot: c.rot, side: c.side, body: fp.body };
});
const out = {
  outline: p.outline,
  pads,
  traces: p.traces.map((t) => ({ layer: t.layer, width: t.width, points: t.points })),
  vias: p.vias.map((v) => ({ x: v.x, y: v.y, d: v.diameter ?? p.rules.viaDiameter, drill: v.drill ?? p.rules.viaDrill })),
  components: comps,
};
mkdirSync(join(HERE, 'build'), { recursive: true });
writeFileSync(join(HERE, 'build', 'board_geometry.json'), JSON.stringify(out));
console.log(JSON.stringify({ pads: pads.length, traces: out.traces.length, vias: out.vias.length, components: comps.length }));
