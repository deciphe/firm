import {
  BALANCE, CARDS, EXCUSES, cardDef, displayName, excuseDef, findCard, legalActions, newRun, offerPrice, rerollPrice, seedFromString, step, trustMultiplier, valuation,
} from '@firm/sim';
import type { Action, Candle, CardInstance, GameState, Offer } from '@firm/sim';
import { stippleArt, startSky } from './stipple.ts';
import * as J from './juice.ts';

// ================================================================== state

type Mode = 'random' | 'daily' | 'tutorial';
interface Score { base: number; mult: number; today: number }
interface UiState { s: GameState; mode: Mode; firm: string; tape: Candle[]; bestIncome: number; selected: number | null; revealed: string[]; score: Score }

let ui: UiState;
let busy = false;
let shownCash = 0;
const sky = startSky(document.getElementById('sky') as HTMLCanvasElement, !J.motionOk());

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const money = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const signed = (n: number): string => `${n >= 0 ? '+' : '-'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const esc = (t: string): string => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
const ALL_REVEALS = ['payroll', 'odds', 'trust', 'hand'];

function store<T>(key: string, value?: T): T | null {
  try {
    if (value !== undefined) { localStorage.setItem(`firm:${key}`, JSON.stringify(value)); return value; }
    const raw = localStorage.getItem(`firm:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

const FIRST = ['Halcyon', 'Ironbark', 'Bluefin', 'Northgate', 'Kestrel', 'Obsidian', 'Copperline', 'Tidewater', 'Silverpine', 'Redwick', 'Granite', 'Lantern', 'Saltmarsh', 'Hollowbrook', 'Quarry', 'Westlight'];
const SECOND = ['Capital', 'Funding', 'Prop', 'Markets', 'Trading Co.', 'Partners'];
const firmName = (seed: number): string => `${FIRST[seed % FIRST.length]} ${SECOND[Math.floor(seed / 7) % SECOND.length]}`;
function todaySeed(): { seed: number; label: string } {
  const d = new Date();
  const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { seed: seedFromString(`daily:${label}`), label };
}

function newGame(mode: Mode): void {
  guideStop();
  const seed = mode === 'daily' ? todaySeed().seed : mode === 'tutorial' ? 20261020 : (Math.floor(Math.random() * 2 ** 31) >>> 0);
  let s = newRun(seed);
  if (mode === 'tutorial') {
    const grid = s.grid.map((c) => (c ? { ...c } : null));
    const g = grid[7];
    if (g) g.progress = 6;
    s = { ...s, grid };
  }
  if (mode === 'tutorial') s = { ...s, cash: 500 };
  ui = { s, mode, firm: mode === 'tutorial' ? 'Your first firm' : firmName(seed), tape: [], bestIncome: 0, selected: null, revealed: mode === 'tutorial' ? [] : [...ALL_REVEALS], score: { base: 0, mult: 1, today: 0 } };
  shownCash = s.cash;
  closeOverlays();
  renderAll();
  if (mode === 'tutorial') void tutorial();
}

// ================================================================== card faces

const CANDLE: Record<Candle, string> = { chop: 'CHOP', up: 'TREND UP', down: 'TREND DOWN', news: 'NEWS' };
const CANDLE_SUB: Record<Candle, string> = { chop: 'traders blow up and rebuy', up: 'traders run at their payouts', down: 'traders run at their payouts', news: 'anything can happen' };

function artFor(card: CardInstance): string {
  const def = cardDef(card.def);
  if (!card.revealed && def.disguise) return card.def === 'bot' ? 'bot' : 'retail';
  return card.def;
}
const offerArt = (o: Offer): string => (o.kind === 'excuse' ? 'excuse' : cardDef(o.id).disguise ? 'retail' : o.id);
const offerName = (o: Offer): string => (o.kind === 'excuse' ? excuseDef(o.id).name : cardDef(o.id).disguise ?? cardDef(o.id).name);
const offerBlurb = (o: Offer): string => (o.kind === 'excuse' ? excuseDef(o.id).blurb : cardDef(o.id).disguise ? (CARDS.retail?.blurb ?? '') : cardDef(o.id).blurb);
function offerTag(o: Offer): string {
  if (o.kind === 'excuse') return 'Excuse';
  const def = cardDef(o.id);
  if (def.disguise) return 'Customer';
  return def.kind === 'staff' ? (def.rarity === 'rare' ? 'Rare staff' : 'Staff') : def.rarity === 'rare' ? 'Rare customer' : 'Customer';
}
const offerRarity = (o: Offer): string => (o.kind === 'excuse' ? 'excuse' : cardDef(o.id).disguise ? 'common' : cardDef(o.id).rarity);
const SHORT: Record<string, string> = { 'Chargeback Artist': 'Chargeback', 'Copy-Trade Detector': 'Detector', 'Payout Proof Wall': 'Proof Wall', 'Compliance Officer': 'Compliance', 'Support Agent': 'Support', 'Bulk Customer': 'Bulk Buyer', 'Borrowed ID': 'Borrowed ID' };
const shortName = (n: string): string => SHORT[n] ?? n;

/** Typical daily fee shown in a card's corner, like a playing card's rank. */
function feeLabel(card: CardInstance): string {
  const def = cardDef(card.def);
  if (def.kind === 'staff') return 'STAFF';
  const sample: Record<string, number> = { gambler: 30, grinder: 12, retail: 26, scalper: 8, trendbro: 38, copyring: 18, hedger: 25, ghost: 28, chargeback: 40, whale: 110, influencer: 0, bot: 12, vet: 0, botfarm: 0 };
  const base = (!card.revealed && def.disguise ? sample.retail : sample[card.def]) ?? 0;
  return base ? `$${base + card.bonus}` : '$0';
}

function cardHtml(card: CardInstance, i: number, cls = ''): string {
  const def = cardDef(card.def);
  const t = def.threshold ?? 0;
  const filled = t ? Math.round((card.progress / t) * 10) : 0;
  const classes = ['card', cls, def.kind === 'staff' ? 'staff' : '', def.rarity === 'rare' && (card.revealed || !def.disguise) ? 'rare' : '', card.revealed && def.fraud ? 'exposed' : '', t && card.progress >= t ? 'due' : ''].join(' ');
  return `<button class="${classes}" data-i="${i}" data-uid="${card.uid}" style="--i:${i}" aria-label="${esc(displayName(card))}">
    <span class="fee">${feeLabel(card)}<small>${def.kind === 'staff' ? '' : card.revealed && def.fraud ? 'fraud' : ''}</small></span>
    <span class="art"><img src="${stippleArt(artFor(card))}" alt=""></span>
    <span class="nm">${esc(shortName(displayName(card)))}</span>
    <span class="prog">${t ? Array.from({ length: 10 }, (_, k) => `<i class="${k < filled ? 'on' : ''}"></i>`).join('') : ''}</span>
    ${card.revealed && def.fraud ? '<span class="stamp">FRAUD</span>' : ''}
    ${card.bonus ? `<span class="bonus">+${card.bonus}</span>` : ''}
  </button>`;
}

// ================================================================== render

function renderAll(): void {
  renderReveals(); renderRun(); renderTop(); renderGrid(); renderBar(); renderShop();
}

function renderReveals(): void {
  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => el.classList.toggle('veiled', !ui.revealed.includes(el.dataset.reveal ?? '')));
}
function reveal(key: string): void {
  if (ui.revealed.includes(key)) return;
  ui.revealed.push(key);
  renderReveals();
  const el = document.querySelector<HTMLElement>(`[data-reveal="${key}"]`);
  if (el && J.motionOk()) el.animate([{ transform: 'scale(.85)', opacity: 0 }, { transform: 'scale(1.03)', opacity: 1 }, { transform: 'none' }], { duration: 300, easing: 'ease-out' });
  J.tick();
}

const dots = (n: number, of: number): string => Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');

function renderRun(): void {
  const s = ui.s;
  $('#firm-name').textContent = `${ui.firm} · Day ${s.day}`;
  setCash(shownCash);
  $('#trust').textContent = s.trust.toFixed(1);
  $('#trust-dots').innerHTML = dots(Math.round(s.trust * 2), 10);
  $('#heat').textContent = String(Math.round(s.heat));
  $('#heat-dots').innerHTML = dots(Math.round(s.heat / 10), 10);
  $('#heat-meter').classList.toggle('hot', s.heat >= 60);
  sky.setHeat(s.heat / 100);
  $('#day').textContent = String(s.day);
  $('#cycle').textContent = String(s.payroll.cycle);
  $('#rerolls').textContent = money(rerollPrice(s));
  $('#booked').textContent = String(s.grid.filter(Boolean).length);
  setScore(ui.score);

  const loanDue = s.payroll.loanOwed > 0 && s.payroll.cycle >= s.payroll.loanDueCycle ? s.payroll.loanOwed : 0;
  const due = s.payroll.amount + loanDue;
  const days = s.payroll.dueDay - s.day;
  $('#payroll-amt').textContent = money(due);
  $('#payroll-when').textContent = days <= 0 ? 'due tonight' : `in ${days} day${days === 1 ? '' : 's'}`;
  const elapsed = BALANCE.cycleDays - Math.max(0, days) - 1;
  $('#daydots').innerHTML = dots(Math.max(0, elapsed), BALANCE.cycleDays);
  $('#payroll-fill').style.width = `${Math.max(0, Math.min(1, shownCash / due)) * 100}%`;
  const pr = $('#payroll');
  pr.classList.toggle('short', shownCash < due);
  pr.classList.toggle('danger', shownCash < due && days <= 1);
  $('#payroll-gap').textContent = shownCash >= due ? `Covered · next ${money(Math.round(s.payroll.amount * BALANCE.payrollGrowth / 10) * 10)}` : `Need ${money(due - shownCash)} more${loanDue ? ' (includes loan)' : ''}`;
}

function setCash(v: number): void { shownCash = v; $('#cash').textContent = money(v); }
function setScore(sc: Score): void {
  $('#base').textContent = Math.round(sc.base).toLocaleString('en-US');
  $('#mult').textContent = sc.mult.toFixed(sc.mult >= 10 ? 0 : 2);
  $('#today').textContent = signed(sc.today);
}

function renderTop(): void {
  $('#excuses').innerHTML = (ui.s.excuses.length ? ui.s.excuses.map((e) => `<span class="ex-chip">${excuseDef(e).name}</span>`).join('') : '<span class="ex-chip none">No excuses</span>');
  const f = ui.s.forecast;
  const odds = (['chop', 'up', 'down', 'news'] as Candle[]).map((c) => `${c === 'down' ? 'Dn' : c[0]?.toUpperCase() + c.slice(1)} ${Math.round(f[c] * 100)}%`).join(' · ');
  const short = (['chop', 'up', 'down', 'news'] as Candle[]).map((c) => `${c === 'chop' ? 'C' : c === 'up' ? 'U' : c === 'down' ? 'D' : 'N'}${Math.round(f[c] * 100)}`).join(' ');
  $('#tape').innerHTML = `${ui.tape.slice(-16).map((c) => `<i class="c-${c}"></i>`).join('')}<span class="sub odds-txt"><span class="odds-long">Next: ${odds}</span><span class="odds-short">Next ${short}</span></span>`;
}

function renderGrid(): void {
  const grid = $('#grid');
  grid.innerHTML = ui.s.grid.map((c, i) => (c ? cardHtml(c, i) : `<button class="slot" data-i="${i}" aria-label="Empty slot">+</button>`)).join('');
  grid.classList.toggle('placing', ui.selected !== null && ui.s.phase === 'draft');
}

function renderBar(): void {
  const s = ui.s;
  const bar = $('#bar');
  if (s.phase !== 'morning') { bar.innerHTML = ''; return; }
  const legal = legalActions(s);
  const due = s.payroll.amount + (s.payroll.loanOwed > 0 && s.payroll.cycle >= s.payroll.loanDueCycle ? s.payroll.loanOwed : 0);
  const desperate = ui.mode !== 'tutorial' && s.cash < due && s.payroll.dueDay - s.day <= 1;
  bar.innerHTML = `
    ${desperate ? `<div class="moves">
      <button class="move" id="btn-sale" ${legal.some((a) => a.type === 'flashSale') ? '' : 'disabled'}><b>Flash sale</b><small>+${money(100 + 100 * s.payroll.cycle)} now · 3 unknown customers · Trust drops</small></button>
      <button class="move" id="btn-loan" ${legal.some((a) => a.type === 'loan') ? '' : 'disabled'}><b>Founder loan</b><small>+${money(s.payroll.amount)} now · repay ${money(Math.round(s.payroll.amount * 1.6))} next payroll</small></button>
    </div>` : ''}
    <button class="cta" id="btn-tap"><b>Open market</b><small>Day ${s.day}${ui.mode !== 'tutorial' ? ' · space' : ''}</small></button>`;
  $('#btn-tap').onclick = () => void onTap();
  if (desperate) {
    $('#btn-sale').onclick = () => { if (gate('sale')) act({ type: 'flashSale' }, 'Flash sale. Cash in, strangers in.'); };
    $('#btn-loan').onclick = () => { if (gate('loan')) act({ type: 'loan' }, 'Loan taken. It comes back with interest.'); };
    if (!seenTip('moves')) void tip('moves', 'Short on payroll. Desperate moves keep you alive tonight, and they always cost you later.', '.moves');
  }
}

function renderShop(): void {
  const s = ui.s;
  const shop = $('#shop');
  if (s.phase !== 'draft') { shop.hidden = true; return; }
  shop.hidden = false;
  shop.classList.toggle('placing', ui.selected !== null);
  if (ui.selected !== null) {
    const o = s.offers[ui.selected];
    shop.innerHTML = `<div class="shop-in"><div class="shop-head"><b>Place ${o ? esc(offerName(o)) : ''}</b><small>tap a slot on the book</small></div><div class="shop-row"><button class="btn2" id="sh-cancel">Back to shop</button><button class="btn2" id="sh-skip">Skip today</button></div></div>`;
    $('#sh-cancel').onclick = () => { ui.selected = null; renderGrid(); renderShop(); };
    $('#sh-skip').onclick = () => { if (!gate('skip')) return; ui.selected = null; act({ type: 'draft', pick: null }); emit('drafted'); };
    return;
  }
  shop.innerHTML = `<div class="shop-in">
    <div class="shop-head"><b>Hire</b><small>cash ${money(s.cash)} · payroll ${money(s.payroll.amount)} in ${Math.max(0, s.payroll.dueDay - s.day)}d</small></div>
    <div class="offers">${s.offers.map((o, i) => `
      <button class="offer r-${offerRarity(o)}${s.cash < offerPrice(o) ? ' broke' : ''}" data-o="${i}" style="--i:${i}" ${s.cash < offerPrice(o) ? 'aria-disabled="true"' : ''}><span class="price">${money(offerPrice(o))}</span>
        <span class="otag">${offerTag(o)}</span><img src="${stippleArt(offerArt(o))}" alt=""><b>${esc(offerName(o))}</b><small>${esc(offerBlurb(o))}</small>
      </button>`).join('')}</div>
    <div class="shop-row"><button class="btn2" id="sh-reroll" ${s.cash >= rerollPrice(s) ? '' : 'disabled'}>Reroll · ${money(rerollPrice(s))}</button><button class="btn2 gold" id="sh-skip">Skip</button></div>
  </div>`;
  shop.querySelectorAll<HTMLButtonElement>('.offer').forEach((b) => { b.onclick = () => chooseOffer(Number(b.dataset.o)); });
  $('#sh-reroll').onclick = () => { if (!gate('reroll')) return; J.tick(); act({ type: 'reroll' }); };
  $('#sh-skip').onclick = () => { if (!gate('skip')) return; act({ type: 'draft', pick: null }); emit('drafted'); };
  const inner = shop.querySelector<HTMLElement>('.shop-in');
  if (inner && J.motionOk() && !shop.dataset.open) inner.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.3,1)' });
  shop.dataset.open = '1';
}

// ================================================================== actions

function act(a: Action, toast?: string): void {
  if (busy) return;
  J.unlockAudio();
  const prev = ui.s;
  ui.s = step(ui.s, a);
  if (a.type === 'flashSale' || a.type === 'loan') { J.cashOut(); sky.pulse('gold', 0.8); animateCash(prev.cash, ui.s.cash, 420); }
  if (a.type === 'draft') delete $('#shop').dataset.open;
  if (toast) flash(toast);
  afterStep(prev);
}

function afterStep(prev: GameState): void {
  const s = ui.s;
  if (s.payroll.cycle > prev.payroll.cycle) {
    J.thud(); J.buzz([30, 40, 30]); J.shake($('#game'), 0.45); sky.pulse('clay', 0.6);
    flash(`Payroll paid · ${money(prev.payroll.amount)}`);
    animateCash(prev.cash, s.cash, 700);
  } else if (s.phase !== 'dead') {
    shownCash = s.cash;
  }
  renderAll();
  if (s.phase === 'dead') showDeath();
  maybeTips();
}

function chooseOffer(i: number): void {
  const o = ui.s.offers[i];
  if (!o || busy) return;
  if (ui.s.cash < offerPrice(o)) { J.loss(); flash(`Can't afford ${offerName(o)} · ${money(offerPrice(o))}`); return; }
  if (!gate('select')) return;
  J.unlockAudio(); J.tick();
  if (o.kind === 'excuse' || o.id === 'botfarm') {
    act({ type: 'draft', pick: i }, o.kind === 'excuse' ? `${offerName(o)} added to your excuses` : 'Bulk order placed');
    emit('drafted');
    return;
  }
  ui.selected = i;
  renderGrid(); renderShop();
  emit('select');
}

let replaceArmed = -1;
function onGridClick(i: number): void {
  if (busy) return;
  const s = ui.s;
  if (s.phase === 'draft' && ui.selected !== null) {
    if (!gate('place')) return;
    const existing = s.grid[i];
    if (existing && ui.mode === 'tutorial') return;
    if (existing && replaceArmed !== i) {
      replaceArmed = i;
      flash(`Tap again to replace it · ${money(BALANCE.severance)} severance`);
      setTimeout(() => { if (replaceArmed === i) replaceArmed = -1; }, 2500);
      return;
    }
    replaceArmed = -1;
    const pick = ui.selected;
    ui.selected = null;
    J.tick(); J.buzz(8);
    act({ type: 'draft', pick, slot: i }, existing ? 'Replaced' : undefined);
    const el = document.querySelector<HTMLElement>(`#grid [data-i="${i}"]`);
    if (el && J.motionOk()) el.animate([{ transform: 'translateY(-60px) rotate(-8deg) scale(1.15)', opacity: 0 }, { transform: 'translateY(4px) rotate(1deg) scale(.97)', opacity: 1, offset: .7 }, { transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.2,.8,.3,1)' });
    J.thud();
    emit('placed'); emit('drafted');
    return;
  }
  const card = s.grid[i];
  if (card && gate('info')) showInfo(card);
}

// ================================================================== the day (Balatro-style scoring)

async function onTap(): Promise<void> {
  if (busy || ui.s.phase !== 'morning' || !gate('tap')) return;
  J.unlockAudio();
  busy = true;
  document.body.classList.add('busy');
  $('#guide').hidden = true;
  hideTip();
  document.querySelector('#btn-tap')?.classList.add('press');
  const prev = ui.s;
  const next = step(prev, { type: 'tap' });
  const report = next.lastReport;
  if (!report) { busy = false; return; }

  await revealCandle(report.candle);

  // Score card by card: blue fees build up, the clay mult builds where staff and Trust kick in.
  const sc: Score = { base: 0, mult: 1, today: 0 };
  ui.score = sc;
  setScore(sc);
  let pos = 0;
  let neg = 0;
  let k = 0;
  const order = prev.grid.map((c, i) => ({ c, i })).filter((x): x is { c: CardInstance; i: number } => x.c !== null);
  for (const { c, i } of order) {
    const r = report.results.find((x) => x.uid === c.uid);
    if (!r || r.cash === 0) continue;
    const el = document.querySelector<HTMLElement>(`#grid [data-i="${i}"]`);
    if (r.cash > 0) {
      sc.base += r.base > 0 ? r.base : r.cash;
      pos += r.cash;
      sc.mult = sc.base ? pos / sc.base : 1;
    } else {
      neg += r.cash;
    }
    sc.today = pos + neg;
    setScore(sc);
    bump('.chipbox');
    if (r.cash > 0 && r.base > 0 && r.cash !== r.base) bump('.multbox');
    if (el) popCard(el, r.cash, r.base);
    if (r.cash > 0) { J.coin(k); J.buzz(6); } else { J.loss(); J.buzz([20, 30, 20]); }
    k++;
    await J.wait(Math.max(70, 190 - k * 10));
  }
  sc.today = report.income;
  setScore(sc);
  bump('#today-box', 1.25);
  const record = report.income > ui.bestIncome && prev.day > 2;
  if (report.income > ui.bestIncome) ui.bestIncome = report.income;
  ui.tape.push(report.candle);
  const scale = Math.min(1, Math.abs(report.income) / Math.max(200, prev.payroll.amount * 0.6));
  J.shake($('#game'), scale * 0.7);
  sky.pulse(report.income >= 0 ? 'gold' : 'clay', 0.3 + scale);
  if (record) { $('#today-box').classList.add('fire'); J.fanfare(); setTimeout(() => $('#today-box').classList.remove('fire'), 2600); }
  animateCash(prev.cash, next.cash, 520);
  await J.wait(620);

  ui.s = next;
  shownCash = next.cash;
  busy = false;
  document.body.classList.remove('busy');
  renderAll();
  for (const uid of report.spawned) {
    const el = document.querySelector<HTMLElement>(`#grid [data-uid="${uid}"]`);
    if (el && J.motionOk()) el.animate([{ transform: 'scale(0) rotate(-20deg)' }, { transform: 'scale(1.1) rotate(3deg)' }, { transform: 'none' }], { duration: 320, easing: 'ease-out' });
  }
  emit('tap-done');
  if (next.phase === 'payout') {
    J.alarm(); J.buzz([40, 60, 40]); sky.pulse('gold', 0.6);
    await J.wait(280);
    openPayout();
  } else if (next.phase === 'dead') {
    showDeath();
  }
  maybeTips();
}

function bump(sel: string, s = 1.12): void {
  const el = document.querySelector<HTMLElement>(sel);
  if (el && J.motionOk()) el.animate([{ transform: 'scale(1)' }, { transform: `scale(${s}) rotate(-1.5deg)` }, { transform: 'none' }], { duration: 180, easing: 'ease-out' });
}

async function revealCandle(c: Candle): Promise<void> {
  const box = $('#reveal');
  box.className = 'reveal on';
  box.innerHTML = '<i class="candle"></i><span>&nbsp;</span><small>&nbsp;</small>';
  const candle = box.querySelector<HTMLElement>('.candle');
  if (candle && J.motionOk()) candle.animate([{ height: '8px' }, { height: '74px' }, { height: '30px' }, { height: '90px' }, { height: '58px' }], { duration: 640, easing: 'ease-in-out', fill: 'forwards' });
  for (let t = 0; t < 5; t++) { J.tick(); await J.wait(120); }
  box.classList.add(`c-${c}`);
  const span = box.querySelector('span');
  const small = box.querySelector('small');
  if (span) span.textContent = CANDLE[c];
  if (small) small.textContent = CANDLE_SUB[c];
  if (c === 'chop') J.coin(0); else if (c === 'news') J.alarm(); else J.thud();
  J.buzz(c === 'chop' ? 10 : 30);
  sky.pulse(c === 'down' ? 'clay' : c === 'news' ? 'gold' : 'paper', 0.5);
  if (J.motionOk()) box.animate([{ transform: 'scale(1.12)' }, { transform: 'none' }], { duration: 170 });
  await J.wait(560);
  box.className = 'reveal';
}

function popCard(el: HTMLElement, cash: number, base: number): void {
  const p = document.createElement('span');
  p.className = `pop ${cash < 0 ? 'neg' : ''}`;
  const boosted = cash > 0 && base > 0 && cash !== base;
  p.innerHTML = cash < 0 ? `<b>${signed(cash)}</b>` : `<b>+${base > 0 ? base : cash}</b>${boosted ? `<em>×${(cash / base).toFixed(1)}</em>` : ''}`;
  el.appendChild(p);
  if (J.motionOk()) {
    el.animate([{ transform: 'none' }, { transform: 'translateY(-10px) rotate(-4deg) scale(1.1)' }, { transform: 'translateY(0) rotate(2deg)' }, { transform: 'none' }], { duration: 300, easing: 'ease-out' });
    p.animate([{ transform: 'translate(-50%, 8px) scale(.5)', opacity: 0 }, { transform: 'translate(-50%, -14px) scale(1.15)', opacity: 1, offset: .25 }, { transform: 'translate(-50%, -20px) scale(1)', opacity: 1, offset: .75 }, { transform: 'translate(-50%, -30px)', opacity: 0 }], { duration: 950, easing: 'ease-out', fill: 'forwards' });
  }
  setTimeout(() => p.remove(), 960);
}

function animateCash(from: number, to: number, ms: number): void {
  const start = performance.now();
  const f = (now: number): void => {
    const t = Math.min(1, (now - start) / ms);
    setCash(from + (to - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(f); else renderRun();
  };
  requestAnimationFrame(f);
}

let toastTimer = 0;
function flash(text: string): void {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('on'), 2300);
}

// ================================================================== payout desk

function openPayout(): void {
  const s = ui.s;
  const req = s.queue[0];
  if (!req) return;
  const found = findCard(s, req.uid);
  if (!found) return;
  const { card } = found;
  const def = cardDef(card.def);
  const legal = legalActions(s);
  const canPay = legal.some((a) => a.type === 'payout' && a.decision === 'pay');
  const canStall = legal.some((a) => a.type === 'payout' && a.decision === 'stall');
  const days = s.payroll.dueDay - s.day;
  const after = s.cash - req.amount;
  const exposed = card.revealed && def.fraud;
  const m = $('#payout');
  m.hidden = false;
  m.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="po-title">
      <p class="eyebrow" id="po-title">Payout request${s.queue.length > 1 ? ` · ${s.queue.length} waiting` : ''}</p>
      <div class="req" id="pcard">
        ${cardHtml(card, -1)}
        <div class="who"><b>${esc(displayName(card))}</b>
          <span>${card.age} day${card.age === 1 ? '' : 's'} on the book${card.payouts ? ` · paid ${card.payouts}× before` : ''}${card.stalls ? ` · stalled ${card.stalls}/2` : ''}</span>
          ${exposed ? `<span class="evidence">Exposed ${def.name.toLowerCase()}. You have evidence, so denying costs no Trust.</span>` : '<span>Passed your challenge and wants paying.</span>'}
          <div class="amt" id="pamt">$0</div></div>
      </div>
      <p class="conseq ${after < s.payroll.amount ? 'warn' : ''}">Cash ${money(s.cash)} → <b>${money(after)}</b> if you pay. Payroll ${money(s.payroll.amount)} ${days <= 0 ? 'tonight' : `in ${days} day${days === 1 ? '' : 's'}`}.</p>
      <div class="pact"><button class="pay" id="po-pay" ${canPay ? '' : 'disabled'}>${canPay ? 'PAY' : 'NO CASH'}</button><button class="btn2" id="po-stall" ${canStall ? '' : 'disabled'}>Stall 3 days</button></div>
      <p class="eyebrow">Or deny with</p>
      <div class="denies">${[...new Set(s.excuses)].map((e) => { const ex = EXCUSES[e]; const used = s.stats.excuseUses[e] ?? 0; return `<button class="deny" data-ex="${e}"><b>${ex?.name ?? e}</b><small>${ex?.blurb ?? ''}${used ? ` Used ${used}× already.` : ''}</small></button>`; }).join('') || '<p class="conseq">No excuses in hand.</p>'}</div>
      <button class="ghost" id="po-ghost">Ghost them<small>no excuse · big Trust and Heat hit</small></button>
    </div>`;
  const amt = $('#pamt');
  const start = performance.now();
  const dur = J.motionOk() ? 680 : 1;
  let last = 0;
  const count = (now: number): void => {
    const t = Math.min(1, (now - start) / dur);
    amt.textContent = money(req.amount * (1 - Math.pow(1 - t, 3)));
    if (now - last > 60 && t < 1) { J.tick(); last = now; }
    if (t < 1) requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
  if (J.motionOk()) {
    m.querySelector('.sheet')?.animate([{ transform: 'translateY(60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.3,1)' });
    m.querySelector('.req .card')?.animate([{ transform: 'rotateY(90deg) scale(.7)' }, { transform: 'rotateY(0) scale(1.06)' }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
  }
  $('#po-pay').onclick = () => { if (gate('pay')) void decide({ type: 'payout', decision: 'pay' }, 'PAID'); };
  $('#po-stall').onclick = () => { if (gate('stall')) void decide({ type: 'payout', decision: 'stall' }, 'STALLED'); };
  $('#po-ghost').onclick = () => { if (gate('deny')) void decide({ type: 'payout', decision: 'deny' }, 'GHOSTED'); };
  m.querySelectorAll<HTMLButtonElement>('.deny').forEach((b) => { b.onclick = () => { if (gate('deny')) void decide({ type: 'payout', decision: 'deny', excuse: b.dataset.ex ?? '' }, excuseDef(b.dataset.ex ?? 'terms').stallDays ? 'IN REVIEW' : 'DENIED'); }; });
  emit('payout-open');
}

async function decide(a: Action, stampText: string): Promise<void> {
  if (busy) return;
  busy = true;
  const prev = ui.s;
  ui.s = step(ui.s, a);
  const st = document.createElement('span');
  st.className = `bigstamp ${stampText === 'PAID' ? 'ok' : 'no'}`;
  st.textContent = stampText;
  $('#pcard').style.position = 'relative';
  $('#pcard').appendChild(st);
  if (J.motionOk()) st.animate([{ transform: 'translate(-50%,-50%) scale(3) rotate(-12deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1) rotate(-12deg)', opacity: 1 }], { duration: 150, easing: 'ease-in', fill: 'forwards' });
  if (stampText === 'PAID') { J.cashOut(); J.buzz([20, 30, 20]); sky.pulse('gold', 0.8); animateCash(prev.cash, ui.s.cash, 500); }
  else { J.stamp(); J.buzz(45); sky.pulse('clay', 0.9); J.shake($('#payout .sheet'), 0.4); }
  await J.wait(720);
  busy = false;
  emit('payout-done');
  if (ui.s.phase === 'payout') { openPayout(); renderRun(); return; }
  $('#payout').hidden = true;
  shownCash = ui.s.cash;
  renderAll();
  if (ui.s.phase === 'dead') showDeath();
  maybeTips();
}

// ================================================================== info, tooltips, how-to, death

function infoBody(card: CardInstance): string {
  const def = cardDef(card.def);
  const hidden = !card.revealed && def.disguise;
  return hidden ? (CARDS.retail?.blurb ?? '') : def.blurb;
}

function showInfo(card: CardInstance): void {
  const def = cardDef(card.def);
  const t = def.threshold;
  const sheet = $('#info');
  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="info-row">${cardHtml(card, -1)}<div><b>${esc(displayName(card))}</b><p>${esc(infoBody(card))}</p></div></div>
      <dl class="kv">
        ${t ? `<dt>Payout progress</dt><dd>${card.progress} / ${t}</dd>` : ''}
        ${card.bonus ? `<dt>Upsold</dt><dd>+${card.bonus} a day</dd>` : ''}
        <dt>On the book</dt><dd>${card.age} day${card.age === 1 ? '' : 's'}</dd>
        ${card.payouts ? `<dt>Payouts so far</dt><dd>${card.payouts}</dd>` : ''}
      </dl>
      <button class="btn2" id="info-close">Close</button>
    </div>`;
  $('#info-close').onclick = () => { sheet.hidden = true; };
  sheet.onclick = (e) => { if (e.target === sheet) sheet.hidden = true; };
}

function showTip(el: HTMLElement, card: CardInstance): void {
  const tip = $('#tip');
  const def = cardDef(card.def);
  const t = def.threshold;
  tip.innerHTML = `<span class="t-tag">${def.kind === 'staff' ? 'Staff' : card.revealed && def.fraud ? 'Fraud' : 'Customer'}</span><b>${esc(displayName(card))}</b>${esc(infoBody(card))}${t ? `<br>Payout at ${t}/${t} · now ${card.progress}` : ''}`;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const left = r.right + 12 + 220 < window.innerWidth ? r.right + 12 : r.left - 232;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, Math.min(window.innerHeight - tip.offsetHeight - 8, r.top))}px`;
}
function hideTip(): void { $('#tip').hidden = true; }

function showHow(): void {
  const sheet = $('#info');
  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="how-title">
      <p class="eyebrow" id="how-title">How FIRM works</p>
      <ol class="how">
        <li><span><b>Open the market.</b> Each day prints one candle. Every customer on the book reacts and pays you <b class="k-chip">fees</b>.</span></li>
        <li><span><b>Hire carefully.</b> One card a day, paid in cash. Staff boost the 8 cards around them and build your <b class="k-mult">mult</b>. Fees × mult = today's take. Every hire is cash you won't have at payroll.</span></li>
        <li><span><b>Trends pay them.</b> Chop days mostly pay you. Trend days fill traders' dots. A full card wants a <b class="k-gold">payout</b>.</span></li>
        <li><span><b>Pay, stall, or deny.</b> Paying builds Trust, which multiplies every fee. Denying keeps cash but burns Trust and adds Heat. Fraud you've exposed can be denied for free.</span></li>
        <li><span><b>Make payroll.</b> Every 5 days, and it grows each time. Miss it and the firm closes. Heat at 100 closes it too.</span></li>
      </ol>
      <div class="drow"><button class="btn2" id="how-tour">Replay tour</button><button class="btn2 gold" id="how-close">Got it</button></div>
    </div>`;
  $('#how-close').onclick = () => { sheet.hidden = true; };
  $('#how-tour').onclick = () => { sheet.hidden = true; newGame('tutorial'); };
  sheet.onclick = (e) => { if (e.target === sheet) sheet.hidden = true; };
}

const CAUSE: Record<string, string> = { payroll: 'Missed payroll', trust: 'Nobody trusts you', heat: 'Shut down by regulators' };

function showDeath(): void {
  const s = ui.s;
  guideStop();
  $('#payout').hidden = true; $('#info').hidden = true; $('#shop').hidden = true;
  J.thud(); J.buzz([80, 60, 120]); sky.pulse('clay', 1.2); J.shake($('#game'), 0.9);
  const best = store<{ days: number; val: number }>('best') ?? { days: 0, val: 0 };
  const newBest = s.stats.peakValuation > best.val && ui.mode !== 'tutorial';
  if (newBest) store('best', { days: s.day, val: s.stats.peakValuation });
  const near = s.cause === 'payroll' ? `${money(s.shortBy)} short` : s.cause === 'trust' ? 'Trust hit zero' : 'Heat hit 100';
  const share = `${ui.firm} lasted ${s.day} days on FIRM. Peak valuation ${money(s.stats.peakValuation)}. ${CAUSE[s.cause ?? 'payroll']}, ${near.toLowerCase()}.`;
  const d = $('#death');
  d.hidden = false;
  d.innerHTML = `
    <div class="dcard" role="dialog" aria-modal="true" aria-labelledby="d-title">
      <img class="moon" src="${stippleArt('vet')}" alt="" style="display:none">
      <p class="eyebrow">Firm closed · day ${s.day}</p>
      <h2 id="d-title">${esc(ui.firm)}</h2>
      <p class="cause">${CAUSE[s.cause ?? 'payroll']}<span>${near}</span></p>
      <div class="dstats">
        <div><small>Days</small><b>${s.day}</b></div><div><small>Peak value</small><b>${money(s.stats.peakValuation)}</b></div><div><small>Trust</small><b>${s.trust.toFixed(1)}</b></div>
        <div><small>Paid</small><b>${s.stats.payoutsPaid}</b></div><div><small>Denied</small><b>${s.stats.payoutsDenied}</b></div><div><small>Fraud caught</small><b>${s.stats.fraudCaught}</b></div>
      </div>
      <p class="best">${newBest ? 'New personal best' : best.val ? `Best ${money(best.val)} · ${best.days} days` : ''}</p>
      <button class="cta" id="d-new"><b>New firm</b><small>space</small></button>
      <div class="drow"><button class="btn2" id="d-daily">Daily tape</button><button class="btn2" id="d-copy">Copy result</button></div>
    </div>`;
  if (J.motionOk()) d.querySelector('.dcard')?.animate([{ transform: 'translateY(80px) rotate(-3deg)', opacity: 0 }, { transform: 'translateY(-6px) rotate(1deg)', opacity: 1, offset: .7 }, { transform: 'none' }], { duration: 460, easing: 'ease-out' });
  $('#d-new').onclick = () => { J.tick(); newGame('random'); };
  $('#d-daily').onclick = () => { J.tick(); newGame('daily'); };
  $('#d-copy').onclick = () => { navigator.clipboard?.writeText(share).then(() => flash('Copied'), () => flash(share)); };
}

function closeOverlays(): void { for (const id of ['#payout', '#death', '#info', '#shop']) $(id).hidden = true; hideTip(); }

// ================================================================== Marv

type Gate = 'tap' | 'select' | 'place' | 'skip' | 'reroll' | 'pay' | 'stall' | 'deny' | 'info' | 'sale' | 'loan';
let allowed: Set<Gate> | null = null;
const waiters = new Map<string, () => void>();
let guideToken = 0;

function gate(g: Gate): boolean {
  if (!allowed || allowed.has(g)) return true;
  J.loss();
  const marv = document.querySelector<HTMLElement>('#guide .marv');
  if (marv) J.shake(marv, 0.3);
  return false;
}
function emit(ev: string): void { const w = waiters.get(ev); if (w) { waiters.delete(ev); w(); } }
const waitFor = (ev: string): Promise<void> => new Promise((r) => waiters.set(ev, r));

interface Say { text: string; target?: string | null; hint?: string; wait?: string; allow?: Gate[]; top?: boolean }

async function say(o: Say): Promise<void> {
  const token = guideToken;
  const g = $('#guide');
  g.hidden = false;
  const hole = g.querySelector<HTMLElement>('.hole');
  const marv = g.querySelector<HTMLElement>('.marv');
  if (!hole || !marv) return;
  const place = (): void => {
    const el = o.target ? document.querySelector<HTMLElement>(o.target) : null;
    if (!el) { hole.className = 'hole none'; marv.classList.toggle('top', o.top ?? false); return; }
    const r = el.getBoundingClientRect();
    hole.className = 'hole';
    Object.assign(hole.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    marv.classList.toggle('top', o.top ?? r.top + r.height / 2 > window.innerHeight * 0.55);
  };
  place();
  allowed = o.wait ? new Set(o.allow ?? []) : new Set();
  marv.innerHTML = `
    <div class="face"><img src="${stippleArt('cfo')}" alt="Marv"></div>
    <div class="bubble"><span class="who">Marv · your CFO</span><p id="g-text"></p>
      <div class="row"><span class="hint">${o.hint ?? ''}</span>${o.wait ? '' : '<button class="next" id="g-next">Next</button>'}</div></div>`;
  const p = $('#g-text');
  let i = 0;
  let skip = false;
  const typing = (async () => {
    while (i < o.text.length && token === guideToken) {
      if (skip) { i = o.text.length; break; }
      i++;
      p.textContent = o.text.slice(0, i);
      if (o.text[i - 1] !== ' ' && i % 3 === 0) J.tick();
      await J.wait(o.text[i - 1] === '.' ? 150 : 16);
    }
    p.textContent = o.text;
  })();
  const onResize = (): void => place();
  window.addEventListener('resize', onResize);
  if (o.wait) await waitFor(o.wait);
  else await new Promise<void>((res) => { $('#g-next').onclick = () => { if (i < o.text.length) { skip = true; return; } J.tick(); res(); }; });
  await typing;
  window.removeEventListener('resize', onResize);
  allowed = null;
  if (token === guideToken) { g.hidden = true; hole.className = 'hole none'; }
}

function guideStop(): void {
  guideToken++; allowed = null; waiters.clear();
  const g = document.getElementById('guide');
  if (g) g.hidden = true;
}
function seenTip(id: string): boolean { return (store<string[]>('tips') ?? []).includes(id); }
async function tip(id: string, text: string, target: string | null): Promise<void> {
  if (seenTip(id) || ui.mode === 'tutorial' || !$('#guide').hidden) return;
  store('tips', [...(store<string[]>('tips') ?? []), id]);
  await say({ text, target });
}
function maybeTips(): void {
  if (ui.mode === 'tutorial' || ui.s.phase !== 'morning' || !$('#payout').hidden || !$('#info').hidden) return;
  if (ui.s.grid.some((c) => c?.revealed && cardDef(c.def).fraud)) void tip('fraud', 'Your analyst caught fraud. Deny them when they ask for a payout, and the evidence protects your Trust.', '.card.exposed');
  else if (ui.s.heat >= 40) void tip('heat40', 'Heat is climbing. Denials and bot accounts draw regulators. At 100 they shut you down.', '#heat-meter');
}

/** The guided first three days. Forced candles and offers so every lesson lands. */
async function tutorial(): Promise<void> {
  const token = guideToken;
  const live = (): boolean => token === guideToken && ui.mode === 'tutorial';
  const force = (c: Candle): void => { ui.s = { ...ui.s, forecast: { chop: 0, up: 0, down: 0, news: 0, [c]: 1 } }; };
  const offers = (o: Offer[]): void => { ui.s = { ...ui.s, offers: o }; renderShop(); };

  await J.wait(500);
  await say({ text: "Welcome to FIRM. I'm Marv, your CFO. You just opened a prop firm.", target: null }); if (!live()) return;
  await say({ text: 'This is the book. Each card is a customer paying you to take your trading challenge.', target: '.felt' }); if (!live()) return;
  await say({ text: "Most of them blow up and pay again. That's how firms make money.", target: '.felt' }); if (!live()) return;
  force('chop');
  await say({ text: 'Open the market. Every day prints one candle, and every card reacts.', target: '#btn-tap', hint: 'Tap OPEN MARKET', wait: 'tap-done', allow: ['tap'] }); if (!live()) return;
  offers([{ kind: 'card', id: 'affiliate' }, { kind: 'card', id: 'gambler' }, { kind: 'excuse', id: 'kyc' }]);
  await say({ text: 'Blue is fees, clay is your multiplier. Fees times mult is what you made today.', target: '.score' }); if (!live()) return;
  await say({ text: 'After every day you can hire one card, if you can afford it. Every dollar you spend is a dollar short at payroll. Take the Affiliate: staff boost the 8 cards around them.', target: '.offers', hint: 'Tap the Affiliate', wait: 'select', allow: ['select'] }); if (!live()) return;
  await say({ text: 'Put them next to as many Gamblers as you can. Placement is the whole game.', target: '.felt', hint: 'Tap an empty slot', wait: 'placed', allow: ['place'], top: true }); if (!live()) return;
  reveal('payroll');
  await say({ text: 'This is payroll. Every 5 days, and it grows every time. Miss it once and the firm is dead.', target: '#payroll' }); if (!live()) return;
  reveal('odds');
  await say({ text: 'Up here are the last candles and tomorrow\'s odds. Chop pays you. Trends push traders toward a payout.', target: '#tape' }); if (!live()) return;
  force('up');
  await say({ text: 'Open the market. Watch the clay mult jump when the Affiliate fires.', target: '#btn-tap', hint: 'Tap OPEN MARKET', wait: 'tap-done', allow: ['tap'] }); if (!live()) return;
  await say({ text: 'Trend day. See the dots on your Grinder filling up? A full card wants paying.', target: '#grid [data-i="7"]', top: true }); if (!live()) return;
  offers([{ kind: 'card', id: 'grinder' }, { kind: 'card', id: 'discordmod' }, { kind: 'card', id: 'retail' }]);
  await say({ text: 'Hire whoever you like, or skip.', target: '.shop-in', hint: 'Hire or skip', wait: 'drafted', allow: ['select', 'place', 'skip', 'reroll'], top: true }); if (!live()) return;
  force('chop');
  await say({ text: 'Day 3. Open the market.', target: '#btn-tap', hint: 'Tap OPEN MARKET', wait: 'payout-open', allow: ['tap'] }); if (!live()) return;
  await say({ text: 'A trader passed your challenge. Now you owe them real money.', target: '#pcard', top: true }); if (!live()) return;
  reveal('hand');
  await say({ text: 'Pay and Trust grows. Stall to buy time. Deny with an excuse to keep the cash, but everyone is watching.', target: '.pact', hint: 'Make the call', wait: 'payout-done', allow: ['pay', 'stall', 'deny'], top: true }); if (!live()) return;
  await J.wait(300);
  reveal('trust');
  await say({ text: 'Trust multiplies every fee. Heat is the regulators. Keep one high and the other low.', target: '.meters' }); if (!live()) return;
  store('tutorialDone', true);
  ui.mode = 'random';
  renderRun();
  await say({ text: "That's the job. From here it only gets harder. Payroll grows every cycle and every hire competes with it. Tap ? for the rules. Good luck, boss.", target: null });
}

// ================================================================== boot

function boot(data: { ui?: UiState }): void {
  if (data.ui?.s) {
    ui = data.ui;
    ui.score = ui.score ?? { base: 0, mult: 1, today: 0 };
    if (ui.mode === 'tutorial') { ui.mode = 'random'; ui.revealed = [...ALL_REVEALS]; }
    shownCash = ui.s.cash;
    renderAll();
    if (ui.s.phase === 'payout') openPayout();
    if (ui.s.phase === 'dead') showDeath();
  } else {
    newGame(store<boolean>('tutorialDone') ? 'random' : 'tutorial');
  }
  const grid = $('#grid');
  grid.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (t?.dataset.i) onGridClick(Number(t.dataset.i));
  });
  grid.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || busy || !window.matchMedia('(hover: hover)').matches) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('.card');
    const card = t?.dataset.uid ? ui.s.grid.find((c) => c?.uid === Number(t.dataset.uid)) : null;
    if (t && card) showTip(t, card); else hideTip();
  });
  grid.addEventListener('pointerleave', hideTip);
  const mute = $('#mute');
  J.setMuted(store<boolean>('muted') ?? false);
  const paint = (): void => { mute.textContent = J.isMuted() ? 'Muted' : 'Sound'; };
  paint();
  mute.onclick = () => { J.unlockAudio(); J.setMuted(!J.isMuted()); store('muted', J.isMuted()); paint(); };
  $('#how-btn').onclick = showHow;
  $('#how-btn2').onclick = showHow;
  $('#new-run').onclick = () => { if (!busy) newGame('random'); };
  window.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if ((e.target as HTMLElement).tagName === 'BUTTON' && e.key === 'Enter') return;
    if (!$('#death').hidden) { e.preventDefault(); newGame('random'); return; }
    if (ui.s.phase === 'morning' && $('#payout').hidden && $('#guide').hidden) { e.preventDefault(); void onTap(); }
  });
}

(window as unknown as { __firm: unknown }).__firm = {
  get state() { return ui.s; },
  get ui() { return ui; },
  load(seed: number) { guideStop(); ui = { s: newRun(seed), mode: 'random', firm: firmName(seed), tape: [], bestIncome: 0, selected: null, revealed: [...ALL_REVEALS], score: { base: 0, mult: 1, today: 0 } }; shownCash = ui.s.cash; closeOverlays(); renderAll(); },
  tutorial() { newGame('tutorial'); },
  set(patch: Partial<GameState>) { ui.s = { ...ui.s, ...patch }; shownCash = ui.s.cash; renderAll(); },
  act(a: Action) { ui.s = step(ui.s, a); shownCash = ui.s.cash; renderAll(); return ui.s.phase; },
  openPayout, showDeath, showHow, guideStop, tap: onTap,
  valuation: () => valuation(ui.s),
  trustMultiplier,
};

interface Hot { snapshot?: (fn: () => unknown) => void; ready?: (fn: (data: { ui?: UiState }) => void) => void; data?: { ui?: UiState } }
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
hot?.snapshot?.(() => ({ ui }));
if (hot?.ready) hot.ready(boot); else boot(hot?.data ?? {});
