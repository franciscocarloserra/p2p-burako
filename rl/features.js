// Observation and candidate-action encoding for the RL policy. Shared by training (env.js) and the in-browser bot.
import {R, validate, isWild, isCanasta, team, color, num, value} from '../game.js?v=2026-11-18.1';

export const NT = 53;            // tile types: 4 colors x 13 + comodín (the two decks collapse)
export const MAXM = 10;          // melds summarized per side
export const MF = 12;            // features per meld summary
export const OBS = NT * 6 + 2 * MAXM * MF + 14;
export const CF = 5 + NT + 9;
const tt = id => id >= 104 ? 52 : id % 52;
const counts = (ids, out, off) => { for (const i of ids) out[off + tt(i)] += 1; };

// Seat p sees: own hand, pozo, own/rival melds, tiles the rival is known to hold (taken from the pozo), counters.
export function rivalOf(s, p) { return s.ffa ? team((p + 1) % s.n, s) : 1 - team(p, s); }

function meldSummary(m, out, off) {
  const nat = m.t.filter(i => !isWild(i)), vs = nat.map(num);
  out[off] = m.t.length / R.canastaLen; out[off + 1] = m.w ? 1 : 0; out[off + 2] = isCanasta(m) ? 1 : 0;
  out[off + 3] = new Set(vs).size > 1 ? 1 : 0;
  out[off + 4 + (nat.length ? color(nat[0]) : 4)] = 1;
  out[off + 9] = vs.length ? Math.min(...vs) / 13 : 0; out[off + 10] = vs.length ? Math.max(...vs) / 13 : 0;
  out[off + 11] = m.t.length === R.canastaLen - 1 ? 1 : 0;
}

export function encodeObs(s, p, known, out = new Float32Array(OBS)) {
  out.fill(0);
  const me = team(p, s), rv = rivalOf(s, p), hand = s.hands[p];
  counts(hand, out, 0);
  counts(s.pozo, out, NT);
  if (s.pozo.length) out[NT * 2 + tt(s.pozo.at(-1))] = 1;
  counts(s.melds[me].flatMap(m => m.t), out, NT * 3);
  counts(s.melds[rv].flatMap(m => m.t), out, NT * 4);
  counts(known ?? [], out, NT * 5);
  let o = NT * 6;
  for (const [side, base] of [[me, o], [rv, o + MAXM * MF]]) {
    const ms = [...s.melds[side]].sort((a, b) => b.t.length - a.t.length).slice(0, MAXM);
    ms.forEach((m, k) => meldSummary(m, out, base + k * MF));
  }
  o += 2 * MAXM * MF;
  const rivalSeat = s.ffa ? (p + 1) % s.n : (p + 1) % (s.n ?? 2);
  const canas = side => s.melds[side].filter(isCanasta);
  const sc = [hand.length / 20, (s.hands[rivalSeat]?.length ?? 0) / 20, s.mazo.length / 60, s.muertos.length / 2,
    s.muerto[me] ? 1 : 0, s.muerto[rv] ? 1 : 0, canas(me).length / 3, canas(rv).length / 3,
    canas(me).some(m => !m.w) ? 1 : 0, canas(rv).some(m => !m.w) ? 1 : 0, s.phase === 'draw' ? 1 : 0,
    s.pozo.length / 20, s.pozo.filter(isWild).length / 2, hand.filter(isWild).length / 3];
  sc.forEach((v, k) => out[o + k] = v);
  return out;
}

// Legal-looking candidate actions. Melds are 3 tiles (longer ones grow with adds); adds are one tile.
// keep: unless the hand can empty into the muerto or a close, never meld/add down below 2 tiles.
export function candidates(s, p) {
  const hand = s.hands[p], me = team(p, s), mine = s.melds[me];
  if (s.phase === 'draw') return s.pozo.length ? [{type: 'draw'}, {type: 'pozo'}] : [{type: 'draw'}];
  const canEmpty = (!s.muerto[me] && s.muertos.length) || mine.some(isCanasta);
  const room = k => canEmpty || hand.length - k >= 2;
  const out = [], seen = new Set();
  const push = a => { const k = a.type + ':' + (a.meld ?? '') + ':' + (a.ids ?? [a.id]).map(tt).sort((x, y) => x - y).join(','); if (!seen.has(k)) { seen.add(k); out.push(a); } };
  if (room(3)) {
    const nats = hand.filter(i => !isWild(i)), wl = hand.filter(isWild).sort((a, b) => num(b) - num(a) || a - b);
    const twos = hand.filter(i => i < 104 && num(i) === 2);
    const pick = (c, v) => hand.find(i => i < 104 && color(i) === c && (num(i) === v || (v === 14 && num(i) === 1)));
    for (let c = 0; c < 4; c++) for (let v = 1; v <= 12; v++) {
      const ids = [], miss = [];
      for (let x = v; x < v + 3; x++) { const i = pick(c, x); i != null ? ids.push(i) : miss.push(x); }
      if (miss.length === 0) { const m = validate(ids); if (m) push({type: 'meld', ids}); }
      if (miss.length === 1) for (const w of [wl.find(i => i >= 104), wl.find(i => i < 104 && !ids.includes(i))]) {
        if (w == null || ids.includes(w)) continue;
        const t = [...ids, w]; if (validate(t)) push({type: 'meld', ids: t});
      }
    }
    for (let v = 1; v <= 13; v++) {
      if (v === 2) { if (twos.length >= 3) push({type: 'meld', ids: twos.slice(0, 3)}); continue; }
      const g = nats.filter(i => num(i) === v).sort((a, b) => color(a) - color(b));
      if (g.length >= 3) push({type: 'meld', ids: g.slice(0, 3)});
      if (g.length >= 2) for (const w of [wl.find(i => i >= 104), wl.find(i => i < 104)]) if (w != null) push({type: 'meld', ids: [g[0], g[1], w]});
    }
  }
  if (room(1)) for (const i of hand) for (let k = 0; k < mine.length; k++) {
    const m = validate([...mine[k].t, i], mine[k].low);
    if (m) push({type: 'add', meld: k, ids: [i]});
  }
  for (const i of hand) push({type: 'discard', id: i});
  return out;
}

const TYPES = ['draw', 'pozo', 'meld', 'add', 'discard'];
export function encodeCands(s, p, cands, out = new Float32Array(cands.length * CF)) {
  out.fill(0);
  const hand = s.hands[p], mine = s.melds[team(p, s)];
  cands.forEach((a, k) => {
    const o = k * CF, ids = a.ids ?? (a.id != null ? [a.id] : a.type === 'pozo' ? s.pozo : []);
    out[o + TYPES.indexOf(a.type)] = 1;
    counts(ids, out, o + 5);
    const f = o + 5 + NT;
    out[f] = ids.length / 10; out[f + 1] = ids.filter(isWild).length / 2; out[f + 2] = ids.reduce((x, i) => x + value(i), 0) / 100;
    if (a.type === 'add') {
      const old = mine[a.meld], m = validate([...old.t, ...a.ids], old.low);
      out[f + 3] = m.t.length / R.canastaLen; out[f + 4] = isCanasta(m) && !isCanasta(old) ? 1 : 0;
      out[f + 5] = m.w && !old.w ? 1 : 0; out[f + 6] = isCanasta(old) ? 1 : 0;
    }
    if (a.type === 'meld') out[f + 5] = validate(a.ids).w ? 1 : 0;
    out[f + 7] = (hand.length - (a.type === 'pozo' ? -s.pozo.length : a.type === 'draw' ? -1 : ids.length)) / 20;
    out[f + 8] = a.type === 'discard' && s.pozo.length === 0 ? 1 : 0;
  });
  return out;
}
