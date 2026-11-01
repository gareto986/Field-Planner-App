// Local (non-AI) planning engine: quantities, relevance scoring,
// container selection, bin packing and plan statistics.
import { state, itemById, TRANSPORT } from './store.js?v=202611012205';
import { uid, splitList } from './utils.js?v=202611012205';

export const itemVolume = it => {
  if (!it) return 0;
  if (it.volumeL > 0) return it.volumeL;
  const v = (it.lengthCm || 0) * (it.widthCm || 0) * (it.heightCm || 0) / 1000;
  return v > 0 ? v : 0.5;
};
export const isContainer = it => it && (it.category === 'Container' || it.capacityL > 0);
export const isWorn = it => splitList(it?.useCases).includes('worn');

export function limitsFor(transport, people) {
  const t = TRANSPORT[transport];
  if (!t || transport === 'custom') return null;
  return t.total ? { kg: t.kg, l: t.l } : { kg: t.kgPerPerson * people, l: t.lPerPerson * people };
}

export function suggestedQty(it, req) {
  const people = Math.max(1, req.people || 1);
  // With a resupply every N days, carry consumables for one leg only.
  const days = Math.max(1, req.resupplyDays > 0 ? Math.min(req.days || 1, req.resupplyDays) : (req.days || 1));
  let q = 1;
  if (it.consumable && it.perPersonDay > 0) q = Math.ceil(it.perPersonDay * people * days);
  else if (it.perPerson) q = people;
  return q;
}

const words = s => String(s || '').toLowerCase().split(/[^a-z0-9-]+/).filter(w => w.length > 2);

function mustHaveMatch(it, req) {
  const lines = String(req.mustHaves || '').toLowerCase().split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  const name = it.name.toLowerCase();
  return lines.some(l => name.includes(l) || l.includes(name) || words(l).filter(w => w.length > 3).some(w => name.includes(w)));
}

export function relevance(it, req) {
  const uses = splitList(it.useCases), envs = splitList(it.environments);
  const acts = (req.activities || []).map(a => a.toLowerCase());
  const reqEnvs = (req.environments || []).map(e => e.toLowerCase());
  const overnight = (req.days || 1) > 1;
  let score = 0;
  acts.forEach(a => { if (uses.includes(a)) score += 3; });
  reqEnvs.forEach(e => { if (envs.includes(e) || uses.includes(e)) score += 2; });
  if (reqEnvs.length && !envs.includes('all') && envs.length && !reqEnvs.some(e => envs.includes(e))) score -= 3;
  if (overnight && uses.includes('overnight')) score += 3;
  if (!overnight && uses.includes('day-trip')) score += 2;
  if (['Safety', 'Navigation'].includes(it.category) && uses.includes('emergency')) score += 3;
  if (it.category === 'Water' || it.category === 'Food') score += 1;
  if (req.transport === 'vehicle' && uses.includes('vehicle')) score += 2;
  if (['canoe', 'ferry'].includes(req.transport) && (uses.includes('boat') || uses.includes('kayak'))) score += 3;
  if (words(req.notes).some(w => uses.includes(w))) score += 1;
  if (mustHaveMatch(it, req)) score += 100;
  return score;
}

/** Build a full plan from scratch based on the request. */
export function autoPack(req) {
  const maxKg = req.maxWeightKg || Infinity;
  const gear = state.items.filter(i => !isContainer(i));
  let picks = gear.map(it => ({ it, score: relevance(it, req) }))
    .filter(p => p.score >= 3)
    .map(p => ({ ...p, qty: Math.max(1, Math.min(suggestedQty(p.it, req), p.it.qtyOwned || Infinity)) }))
    .sort((a, b) => b.score - a.score);

  // Trim lowest-value items until we fit the weight and volume budgets
  // (leaving headroom for the containers themselves).
  const gearBudget = maxKg * 0.8;
  const volBudget = (req.maxVolumeL || Infinity) * 0.85;
  const vol = p => isWorn(p.it) ? 0 : itemVolume(p.it) * p.qty;
  let total = picks.reduce((s, p) => s + p.it.weightKg * p.qty, 0);
  let totalL = picks.reduce((s, p) => s + vol(p), 0);
  for (let i = picks.length - 1; i >= 0 && (total > gearBudget || totalL > volBudget); i--) {
    if (picks[i].score >= 100) continue;
    total -= picks[i].it.weightKg * picks[i].qty;
    totalL -= vol(picks[i]);
    picks.splice(i, 1);
  }

  const packed = picks.map(p => ({ itemId: p.it.id, qty: p.qty, container: null }));
  const containers = chooseContainers(packed, req);
  const plan = binPack({ containers, packed });
  // Drop containers that ended up empty.
  const used = new Set(plan.packed.map(p => p.container));
  return { ...plan, containers: plan.containers.filter(c => used.has(c.uid)) };
}

function chooseContainers(packed, req) {
  const need = packed.reduce((s, p) => {
    const it = itemById(p.itemId);
    return isWorn(it) ? s : s + itemVolume(it) * p.qty;
  }, 0) * 1.15;
  const cands = state.items.filter(isContainer).map(c => ({ c, score: relevance(c, req) }))
    .sort((a, b) => b.score - a.score || (b.c.capacityL / Math.max(b.c.weightKg, 0.1)) - (a.c.capacityL / Math.max(a.c.weightKg, 0.1)));
  const out = [];
  let cap = 0;
  // On foot: one pack per person first.
  if (req.transport === 'foot' || req.transport === 'ferry') {
    const packs = cands.filter(x => /pack/i.test(x.c.name)).sort((a, b) => b.c.capacityL - a.c.capacityL);
    for (const { c } of packs) {
      for (let n = 0; n < (c.qtyOwned || 1) && out.length < (req.people || 1); n++) { out.push({ uid: uid('C'), itemId: c.id }); cap += c.capacityL; }
    }
  }
  const maxL = req.maxVolumeL || Infinity;
  for (const { c } of cands) {
    const used = out.filter(o => o.itemId === c.id).length;
    for (let n = used; n < (c.qtyOwned || 1) && cap < need && (cap + c.capacityL <= maxL || !out.length); n++) {
      out.push({ uid: uid('C'), itemId: c.id }); cap += c.capacityL;
    }
    if (cap >= need) break;
  }
  return out;
}

/** First-fit-decreasing packing of the plan's items into its containers. */
export function binPack(plan) {
  const bins = plan.containers.map(c => {
    const it = itemById(c.itemId);
    return { uid: c.uid, cap: it?.capacityL || 0, load: it?.maxLoadKg || Infinity, usedL: 0, usedKg: 0 };
  });
  const units = [];
  plan.packed.forEach(p => {
    const it = itemById(p.itemId);
    if (!it) return;
    units.push({ it, qty: p.qty, worn: isWorn(it) });
  });
  units.sort((a, b) => itemVolume(b.it) * b.qty - itemVolume(a.it) * a.qty);

  const out = [];
  const add = (itemId, qty, container) => {
    const ex = out.find(o => o.itemId === itemId && o.container === container);
    if (ex) ex.qty += qty; else out.push({ itemId, qty, container });
  };
  for (const u of units) {
    if (u.worn) { add(u.it.id, u.qty, null); continue; }
    const v = itemVolume(u.it), w = u.it.weightKg;
    let left = u.qty;
    // try to keep the group together first
    const whole = bins.filter(b => b.cap - b.usedL >= v * left && b.load - b.usedKg >= w * left)
      .sort((a, b) => (a.cap - a.usedL) - (b.cap - b.usedL))[0];
    if (whole) { whole.usedL += v * left; whole.usedKg += w * left; add(u.it.id, left, whole.uid); continue; }
    for (const b of [...bins].sort((a, b2) => (b2.cap - b2.usedL) - (a.cap - a.usedL))) {
      const fit = Math.min(left, Math.floor((b.cap - b.usedL) / v), Math.floor((b.load - b.usedKg) / Math.max(w, 1e-6)));
      if (fit > 0) { b.usedL += v * fit; b.usedKg += w * fit; add(u.it.id, fit, b.uid); left -= fit; }
      if (!left) break;
    }
    if (left) add(u.it.id, left, null);
  }
  return { ...plan, packed: out };
}

export function planStats(plan = state.plan) {
  const req = plan.request;
  const byCat = {};
  const perContainer = {};
  plan.containers.forEach(c => {
    const it = itemById(c.itemId);
    perContainer[c.uid] = { cap: it?.capacityL || 0, load: it?.maxLoadKg || 0, usedL: 0, usedKg: 0, selfKg: it?.weightKg || 0 };
  });
  let gearKg = 0, gearL = 0, looseL = 0, count = 0;
  const owned = {};
  plan.packed.forEach(p => {
    const it = itemById(p.itemId);
    if (!it) return;
    const kg = it.weightKg * p.qty, l = itemVolume(it) * p.qty;
    gearKg += kg; gearL += l; count += p.qty;
    owned[it.id] = (owned[it.id] || 0) + p.qty;
    byCat[it.category] = (byCat[it.category] || 0) + kg;
    const pc = perContainer[p.container];
    if (pc) { pc.usedL += l; pc.usedKg += kg; } else if (!isWorn(it)) looseL += l;
  });
  const containerKg = plan.containers.reduce((s, c) => s + (itemById(c.itemId)?.weightKg || 0), 0);
  if (containerKg) byCat.Container = (byCat.Container || 0) + containerKg;
  const capacityL = Object.values(perContainer).reduce((s, c) => s + c.cap, 0);
  const containerUse = {};
  plan.containers.forEach(c => { containerUse[c.itemId] = (containerUse[c.itemId] || 0) + 1; });
  const shortages = [
    ...Object.entries(owned).map(([id, q]) => ({ id, q, have: itemById(id)?.qtyOwned ?? 0 })),
    ...Object.entries(containerUse).map(([id, q]) => ({ id, q, have: itemById(id)?.qtyOwned ?? 0 })),
  ].filter(s => s.have > 0 && s.q > s.have);
  const overfull = plan.containers.filter(c => {
    const pc = perContainer[c.uid];
    return pc.usedL > pc.cap + 1e-6 || (pc.load && pc.usedKg > pc.load + 1e-6);
  }).map(c => c.uid);
  const totalKg = gearKg + containerKg;
  const transportL = capacityL + looseL;
  return {
    totalKg, gearKg, containerKg, gearL, capacityL, looseL, transportL, count, byCat, perContainer, shortages, overfull,
    kgPerPerson: totalKg / Math.max(1, req.people || 1),
    weightPct: req.maxWeightKg ? totalKg / req.maxWeightKg : 0,
    spacePct: capacityL ? Object.values(perContainer).reduce((t, c) => t + c.usedL, 0) / capacityL : 0,
    transportPct: req.maxVolumeL ? transportL / req.maxVolumeL : 0,
  };
}

export function packingSummary(plan = state.plan) {
  const groups = new Map([[null, []]]);
  plan.containers.forEach(c => groups.set(c.uid, []));
  plan.packed.forEach(p => { (groups.get(p.container) || groups.get(null)).push(p); });
  const lines = [];
  for (const [cu, list] of groups) {
    const c = plan.containers.find(x => x.uid === cu);
    const label = c ? (itemById(c.itemId)?.name || c.itemId) : 'Worn / loose';
    if (!list.length && !c) continue;
    lines.push(`${label}: ${list.map(p => `${p.qty}× ${itemById(p.itemId)?.name || p.itemId}`).join(', ') || '(empty)'}`);
  }
  return lines.join('\n');
}
