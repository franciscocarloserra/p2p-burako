// RL policy (PPO self-play, rl/train.py) playing in the browser. 1 vs 1 only: that is what it was trained on.
// load() fetches rlbot.bin once; step(s, p) returns the greedy action, like botStep in bot.js.
import {encodeObs, encodeCands, candidates, OBS, CF} from './features.js?v=2026-11-18.1';

let W = null;
const f16 = h => { const e = (h >> 10) & 31, m = h & 1023, sg = h & 32768 ? -1 : 1;
  return sg * (e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15)); };

export function fromBuffer(buf) {
  const [H, obs, cf] = new Uint32Array(buf, 0, 3);
  if (obs !== OBS || cf !== CF) throw new Error('rlbot.bin does not match features.js');
  const raw = new Uint16Array(buf, 12), lut = new Float32Array(65536).map((_, i) => f16(i));
  let o = 0;
  const take = n => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = lut[raw[o + i]]; o += n; return a; };
  const lin = (out, inp) => ({W: take(out * inp), b: take(out), out, inp});
  W = {H, st0: lin(H, OBS), st2: lin(H, H), ca0: lin(H / 2, CF), sc0: lin(H / 2, H + H / 2), sc2: lin(1, H / 2)};
}

let loading = null;
export const ready = () => !!W;
export const load = () => loading ??= fetch(new URL('rlbot.bin', import.meta.url)).then(r => r.arrayBuffer()).then(fromBuffer);

// y = relu?(W x + b), reading x from x[xo..] and W columns [c0, c0+n) of a layer with L.inp columns
function mv(L, x, xo, n, c0, y, relu, add) {
  for (let r = 0; r < L.out; r++) {
    let acc = add ? add[r] : L.b[r]; const w = r * L.inp + c0;
    for (let k = 0; k < n; k++) acc += L.W[w + k] * x[xo + k];
    y[r] = relu && acc < 0 ? 0 : acc;
  }
  return y;
}

// Tiles the rival took from the pozo and has not shown yet, as env.js tracks them. Kept per seat across calls.
const mem = {};
function known(s, p) {
  const m = mem[p] ??= {id: null, after: null, k: []};
  if (m.id !== s.id + ':' + s.round) Object.assign(m, {id: s.id + ':' + s.round, after: null, k: []});
  if (s.phase === 'draw' && m.after) {
    const pz = s.pozo, a = m.after;
    if (!(pz.length === a.length + 1 && a.every((x, i) => pz[i] === x))) m.k.push(...a);
    m.after = null;
  }
  const shown = new Set([...s.pozo, ...s.melds.flat().flatMap(x => x.t)]);
  return m.k = m.k.filter(i => !shown.has(i));
}

export function step(s, p) {
  const cs = candidates(s, p), k = known(s, p);
  let a = cs[0];
  if (cs.length > 1) {
    const {H} = W, h1 = mv(W.st0, encodeObs(s, p, k), 0, OBS, 0, new Float32Array(H), true);
    const e = mv(W.st2, h1, 0, H, 0, new Float32Array(H), true);
    const pre = mv(W.sc0, e, 0, H, 0, new Float32Array(H / 2), false);   // state half of the scorer, shared by all candidates
    const cf = encodeCands(s, p, cs), c = new Float32Array(H / 2), z = new Float32Array(H / 2), out = new Float32Array(1);
    let best = -Infinity;
    cs.forEach((x, i) => {
      mv(W.ca0, cf, i * CF, CF, 0, c, true);
      mv(W.sc0, c, 0, H / 2, H, z, true, pre);
      const v = mv(W.sc2, z, 0, H / 2, 0, out, false)[0];
      if (v > best) best = v, a = x;
    });
  }
  if (a.type === 'discard') mem[p].after = [...s.pozo, a.id];
  return a;
}
