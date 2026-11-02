// Bot vs bot arena with duplicate deals: every seed is played twice with seats swapped, so deal luck cancels out.
// node selfplay.js [seeds=2000] [botA=bot.js] [botB=bot.js] [paramsA json] [paramsB json] [--json]
// Runs on all cores. match() is exported for tune.js.
import {Worker, isMainThread, workerData, parentPort} from 'node:worker_threads';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {cpus} from 'node:os';

const SEED0 = 1;
const TURN_CAP = 400;   // safety stop for a hand that never ends
const V = '?v=2026-10-30.3';
const KEYS = ['total', 'juegos', 'canastas', 'cierre', 'mano', 'muerto'];
const zero = () => ({hands: 0, total: 0, juegos: 0, canastas: 0, cierre: 0, mano: 0, muerto: 0, closes: 0, muertoTaken: 0,
  pozoTakes: 0, pozoTiles: 0, fedPozo: 0, discards: 0, turns: 0, errors: 0, melds: 0, adds: 0, wildsInHand: 0});

async function play({from, to, a, b, pa, pb}) {
  let rng = 0;
  const mulberry = () => { rng |= 0; rng = rng + 0x6D2B79F5 | 0; let t = Math.imul(rng ^ rng >>> 15, 1 | rng); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return (t ^ t >>> 14) >>> 0; };
  globalThis.crypto.getRandomValues = x => { for (let i = 0; i < x.length; i++) x[i] = mulberry(); return x; };
  const G = await import(new URL('./game.js' + V, import.meta.url).href);
  const load = async (path, side, params) => {
    const m = await import(pathToFileURL(path).href + V + '&side=' + side);
    if (params) Object.assign(m.B, params);
    return m.botStep;
  };
  const bots = [await load(a, 'a', pa), await load(b, 'b', pb)];
  const st = [zero(), zero()], diffs = [];
  let deckOut = 0, capped = 0;
  function hand(seed, botOfSeat) {
    rng = seed;
    const s = G.newState(seed + ':' + botOfSeat[0], {name: 'S0'}, 2);
    s.players.push({name: 'S1'});
    G.deal(s);
    let turns = 0, lastDiscarder = null;
    while (s.phase !== 'over' && turns < TURN_CAP) {
      const p = s.turn, k = botOfSeat[p], phase = s.phase;
      const act = bots[k](s, p);
      const err = G.act(s, p, act);
      if (err) { st[k].errors++; if (G.act(s, p, phase === 'draw' ? {type: 'draw'} : {type: 'discard', id: s.hands[p][0]})) break; continue; }
      if (act.type === 'pozo') { st[k].pozoTakes++; st[k].pozoTiles += s.hands[p].length; if (lastDiscarder != null && lastDiscarder !== k) st[lastDiscarder].fedPozo++; }
      if (act.type === 'meld') st[k].melds++;
      if (act.type === 'add') st[k].adds++;
      if (act.type === 'discard') { st[k].discards++; lastDiscarder = k; turns++; st[k].turns++; }
    }
    if (s.phase !== 'over') { capped++; G.endRound(s, null); }
    if (s.log === 'the deck ran out') deckOut++;
    const res = [0, 0];
    for (let p = 0; p < 2; p++) {
      const k = botOfSeat[p], r = s.last[p], x = st[k];
      x.hands++; for (const q of KEYS) x[q] += r[q];
      if (r.cierre) x.closes++;
      if (s.muerto[p]) x.muertoTaken++;
      x.wildsInHand += s.hands[p].filter(G.isWild).length;
      res[k] = r.total;
    }
    return res[0] - res[1];
  }
  for (let i = from; i < to; i++) {
    const x = hand(SEED0 + i, [0, 1]), y = hand(SEED0 + i, [1, 0]);
    if (x != null && y != null) diffs.push((x + y) / 2);
  }
  return {st, diffs, deckOut, capped};
}

// Plays `seeds` duplicate pairs split across all cores; returns aggregated stats.
export async function match(seeds, a = 'bot.js', b = 'bot.js', pa = null, pb = null) {
  const n = cpus().length, per = Math.ceil(seeds / n), file = fileURLToPath(import.meta.url);
  const parts = await Promise.all(Array.from({length: n}, (_, w) => new Promise((ok, ko) => {
    const wk = new Worker(file, {workerData: {from: w * per, to: Math.min(seeds, (w + 1) * per), a, b, pa, pb}});
    wk.once('message', ok); wk.once('error', ko);
  })));
  const st = [zero(), zero()], diffs = [];
  let deckOut = 0, capped = 0;
  for (const r of parts) {
    for (let k = 0; k < 2; k++) for (const q in st[k]) st[k][q] += r.st[k][q];
    diffs.push(...r.diffs); deckOut += r.deckOut; capped += r.capped;
  }
  const m = diffs.length, mean = diffs.reduce((x, y) => x + y, 0) / m;
  const sd = Math.sqrt(diffs.reduce((x, d) => x + (d - mean) ** 2, 0) / (m - 1));
  return {pairs: m, mean, ci: 1.96 * sd / Math.sqrt(m), sd, ahead: diffs.filter(d => d > 0).length / m, st, deckOut: deckOut / (2 * seeds), capped};
}

if (!isMainThread) parentPort.postMessage(await play(workerData));
else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter(x => x !== '--json'), json = process.argv.includes('--json');
  const t0 = Date.now();
  const r = await match(+(args[0] ?? 2000), args[1], args[2], args[3] && JSON.parse(args[3]), args[4] && JSON.parse(args[4]));
  if (json) { console.log(JSON.stringify(r)); process.exit(0); }
  const f = (x, d = 1) => x.toFixed(d);
  console.log(`${r.pairs} duplicate pairs in ${f((Date.now() - t0) / 1000)}s, capped ${r.capped}, deck ran out ${f(100 * r.deckOut)}%`);
  console.log(`A - B per hand: ${f(r.mean)} ± ${f(r.ci)} (95%), sd ${f(r.sd)}, A ahead in ${f(100 * r.ahead)}% of pairs`);
  const rows = KEYS.map(k => [k + '/hand', x => x[k] / x.hands])
    .concat([['close %', x => 100 * x.closes / x.hands], ['muerto %', x => 100 * x.muertoTaken / x.hands],
      ['pozo takes/hand', x => x.pozoTakes / x.hands], ['hand after pozo', x => x.pozoTiles / Math.max(1, x.pozoTakes)],
      ['fed rival pozo/hand', x => x.fedPozo / x.hands], ['turns/hand', x => x.turns / x.hands],
      ['melds/hand', x => x.melds / x.hands], ['adds/hand', x => x.adds / x.hands],
      ['wilds left in hand', x => x.wildsInHand / x.hands], ['errors', x => x.errors]]);
  console.log('stat'.padEnd(22) + 'A'.padStart(10) + 'B'.padStart(10));
  for (const [k, fn] of rows) console.log(k.padEnd(22) + f(fn(r.st[0]), 2).padStart(10) + f(fn(r.st[1]), 2).padStart(10));
}
