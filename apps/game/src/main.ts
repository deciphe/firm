import {
  BALANCE, CARDS, EXCUSES, cardDef, displayName, excuseDef, findCard, legalActions, newRun, seedFromString, step, trustMultiplier, valuation,
} from '@firm/sim';
import type { Action, Candle, CardInstance, GameState, Offer } from '@firm/sim';
import { spriteUrl } from './sprites.ts';
import { startBackdrop } from './bg.ts';
import * as J from './juice.ts';

// ================================================================== state

type Mode = 'random' | 'daily' | 'tutorial';
interface UiState {
  s: GameState;
  mode: Mode;
  firm: string;
  tape: Candle[];
  bestIncome: number;
  selected: number | null;
  revealed: string[];
}

let ui: UiState;
let busy = false;
let shownCash = 0;
const bg = startBackdrop(document.getElementById('bg') as HTMLCanvasElement, !J.motionOk());

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const money = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const signed = (n: number): string => `${n >= 0 ? '+' : '-'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const ALL_REVEALS = ['payroll', 'odds', 'trust', 'heat', 'hand'];

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
  ui = { s, mode, firm: mode === 'tutorial' ? 'Your First Firm' : firmName(seed), tape: [], bestIncome: 0, selected: null, revealed: mode === 'tutorial' ? [] : [...ALL_REVEALS] };
  shownCash = s.cash;
  closeOverlays();
  renderAll();
  if (mode === 'tutorial') void tutorial();
}

// ================================================================== labels

const CANDLE: Record<Candle, string> = { chop: 'CHOP', up: 'TREND UP', down: 'TREND DOWN', news: 'NEWS SPIKE' };
const CANDLE_SUB: Record<Candle, string> = { chop: 'traders blow up and rebuy', up: 'traders run toward payouts', down: 'traders run toward payouts', news: 'anything can happen' };

function spriteFor(card: CardInstance): string {
  const def = cardDef(card.def);
  if (!card.revealed && def.disguise) return card.def === 'bot' ? 'bot' : 'retail';
  return card.def === 'botfarm' ? 'botfarm' : card.def;
}
const offerName = (o: Offer): string => (o.kind === 'excuse' ? excuseDef(o.id).name : cardDef(o.id).disguise ?? cardDef(o.id).name);
const offerBlurb = (o: Offer): string => (o.kind === 'excuse' ? excuseDef(o.id).blurb : cardDef(o.id).disguise ? (CARDS.retail?.blurb ?? '') : cardDef(o.id).blurb);
const offerSprite = (o: Offer): string => (o.kind === 'excuse' ? 'excuse' : cardDef(o.id).disguise ? 'retail' : o.id);
function offerTag(o: Offer): string {
  if (o.kind === 'excuse') return 'Excuse';
  const def = cardDef(o.id);
  if (def.disguise) return 'Customer';
  return `${def.kind === 'staff' ? 'Staff' : 'Customer'}${def.rarity === 'rare' ? ' · Rare' : ''}`;
}
const offerRarity = (o: Offer): string => (o.kind === 'excuse' ? 'excuse' : cardDef(o.id).disguise ? 'common' : cardDef(o.id).rarity);

// ================================================================== render

function renderAll(): void {
  renderReveals();
  renderHud();
  renderOdds();
  renderGrid();
  renderFeed();
  renderDock();
  renderHand();
}

function renderReveals(): void {
  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
    el.classList.toggle('veiled', !ui.revealed.includes(el.dataset.reveal ?? ''));
  });
}

function reveal(key: string): void {
  if (ui.revealed.includes(key)) return;
  ui.revealed.push(key);
  renderReveals();
  const el = document.querySelector<HTMLElement>(`[data-reveal="${key}"]`);
  if (el && J.motionOk()) el.animate([{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.06)', opacity: 1 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
  J.tick();
}

function pips(n: number, of: number): string {
  return Array.from({ length: of }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
}

function renderHud(): void {
  const s = ui.s;
  $('#firm-name').textContent = ui.firm;
  $('#day').textContent = `Day ${s.day}`;
  $('#mode').textContent = ui.mode === 'daily' ? `Daily tape` : ui.mode === 'tutorial' ? 'Training' : 'Free run';
  setCash(shownCash);
  $('#trust').textContent = s.trust.toFixed(1);
  $('#trust-pips').innerHTML = pips(Math.round(s.trust * 2), 10);
  $('#trust-mult').textContent = `fees x${trustMultiplier(s.trust).toFixed(2)}`;
  $('#heat').textContent = String(Math.round(s.heat));
  $('#heat-pips').innerHTML = pips(Math.round(s.heat / 10), 10);
  $('#heat-note').textContent = s.heat >= 80 ? 'regulators circling' : s.heat >= 50 ? 'getting noticed' : 'quiet';
  $('#heat-box').classList.toggle('hot', s.heat >= 60);
  bg.setHeat(s.heat / 100);

  const loanDue = s.payroll.loanOwed > 0 && s.payroll.cycle >= s.payroll.loanDueCycle ? s.payroll.loanOwed : 0;
  const due = s.payroll.amount + loanDue;
  const days = s.payroll.dueDay - s.day;
  $('#payroll-amt').textContent = money(due);
  $('#payroll-when').textContent = days <= 0 ? 'due tonight' : `in ${days} day${days === 1 ? '' : 's'}`;
  $('#payroll-fill').style.width = `${Math.max(0, Math.min(1, shownCash / due)) * 100}%`;
  const pr = $('#payroll');
  pr.classList.toggle('short', shownCash < due);
  pr.classList.toggle('danger', shownCash < due && days <= 1);
  $('#payroll-gap').textContent = shownCash >= due ? 'Covered' : `Need ${money(due - shownCash)} more`;
  const loan = $('#loan-note');
  loan.hidden = s.payroll.loanOwed === 0;
  loan.textContent = `Loan ${money(s.payroll.loanOwed)} due at next payroll`;
}

function setCash(v: number): void {
  shownCash = v;
  $('#cash').textContent = money(v);
}

function renderOdds(): void {
  const strip = $('#tape-strip');
  strip.innerHTML = ui.tape.length ? ui.tape.slice(-24).map((c) => `<i class="candle c-${c}"></i>`).join('') : '<span class="tape-empty">No trading yet</span>';
  const f = ui.s.forecast;
  const top = (['chop', 'up', 'down', 'news'] as Candle[]).reduce((a, b) => (f[b] > f[a] ? b : a), 'chop' as Candle);
  $('#forecast').innerHTML = (['chop', 'up', 'down', 'news'] as Candle[])
    .map((c) => `<span class="fc f-${c}${c === top ? ' top' : ''}"><i></i>${c === 'up' ? 'UP' : c === 'down' ? 'DN' : c.toUpperCase()} ${Math.round(f[c] * 100)}%</span>`).join('');
}

function tileHtml(card: CardInstance | null, i: number): string {
  if (!card) return `<button class="tile empty" data-i="${i}" style="--i:${i}" aria-label="Empty slot"><span class="slot-plus">+</span></button>`;
  const def = cardDef(card.def);
  const name = displayName(card);
  const cls = ['tile', def.kind === 'staff' ? 'staff' : '', card.revealed && def.fraud ? 'exposed' : '', def.threshold && card.progress >= def.threshold ? 'due' : ''].join(' ');
  const t = def.threshold ?? 0;
  const seg = t ? `<span class="seg">${Array.from({ length: 10 }, (_, k) => `<i class="${k < Math.round((card.progress / t) * 10) ? 'on' : ''}"></i>`).join('')}</span>` : '';
  const bonus = card.bonus ? `<span class="bonus">+${card.bonus}</span>` : '';
  return `<button class="${cls}" data-i="${i}" data-uid="${card.uid}" style="--i:${i}" aria-label="${name}">${bonus}<img class="spr" src="${spriteUrl(spriteFor(card), card.uid)}" alt=""><span class="tname">${shortName(name)}</span>${seg}</button>`;
}

function shortName(n: string): string {
  const map: Record<string, string> = { 'Chargeback Artist': 'Chargeback', 'Copy-Trade Detector': 'Detector', 'Payout Proof Wall': 'Proof Wall', 'Compliance Officer': 'Compliance', 'Support Agent': 'Support', 'Bulk Customer': 'Bulk Buyer' };
  return map[n] ?? n;
}

function renderGrid(): void {
  const grid = $('#grid');
  grid.innerHTML = ui.s.grid.map((c, i) => tileHtml(c, i)).join('');
  grid.classList.toggle('placing', ui.selected !== null && ui.s.phase === 'draft');
}

function renderFeed(): void {
  $('#feed').innerHTML = ui.s.feed.slice(0, 4).map((p) => `<p class="post t-${p.tone}"><b>${p.handle}</b>${esc(p.text)}</p>`).join('');
}
const esc = (t: string): string => t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);

function renderHand(): void {
  $('#hand').innerHTML = ui.s.excuses.length ? ui.s.excuses.map((e) => `<span class="chip">${excuseDef(e).name}</span>`).join('') : '<span class="chip none">None</span>';
}

function renderDock(): void {
  const s = ui.s;
  const dock = $('#dock');
  if (s.phase === 'morning') {
    const legal = legalActions(s);
    const due = s.payroll.amount + (s.payroll.loanOwed > 0 && s.payroll.cycle >= s.payroll.loanDueCycle ? s.payroll.loanOwed : 0);
    const desperate = ui.mode !== 'tutorial' && s.cash < due && s.payroll.dueDay - s.day <= 1;
    const sale = legal.some((a) => a.type === 'flashSale');
    const loan = legal.some((a) => a.type === 'loan');
    dock.innerHTML = `
      ${desperate ? `<div class="moves">
        <button class="move plate" id="btn-sale" ${sale ? '' : 'disabled'}><b>Flash sale</b><small>+${money(100 + 100 * s.payroll.cycle)} now. 3 unknown customers. Trust drops.</small></button>
        <button class="move plate" id="btn-loan" ${loan ? '' : 'disabled'}><b>Founder loan</b><small>+${money(s.payroll.amount)} now. Repay ${money(Math.round(s.payroll.amount * 1.6))} next payroll.</small></button>
      </div>` : ''}
      <button class="primary" id="btn-tap"><span>OPEN MARKET</span><small>Day ${s.day}${ui.mode !== 'tutorial' ? ' · space' : ''}</small></button>`;
    $('#btn-tap').onclick = () => void onTap();
    if (desperate) {
      $('#btn-sale').onclick = () => { if (gate('sale')) act({ type: 'flashSale' }, 'Flash sale: cash in, strangers in'); };
      $('#btn-loan').onclick = () => { if (gate('loan')) act({ type: 'loan' }, 'Loan taken'); };
      if (!seenTip('moves')) void tip('moves', "Short on payroll? Desperate moves keep you alive. They always cost you later.", '.moves');
    }
  } else if (s.phase === 'draft') {
    const offers = s.offers.map((o, i) => `
      <button class="offer plate r-${offerRarity(o)}${ui.selected === i ? ' sel' : ''}" data-o="${i}">
        <img class="spr" src="${spriteUrl(offerSprite(o), s.nextUid + i)}" alt="">
        <span class="otxt"><span class="otag">${offerTag(o)}</span><b>${offerName(o)}</b><small>${offerBlurb(o)}</small></span>
      </button>`).join('');
    dock.innerHTML = `
      <div class="dhead"><b>${ui.selected === null ? 'HIRE ONE' : 'PLACE IT'}</b><small>${ui.selected === null ? 'or skip' : 'tap an empty slot'}</small></div>
      <div class="offers">${offers}</div>
      <div class="drow">
        <button class="ghost-btn plate" id="btn-skip">Skip</button>
        <button class="ghost-btn plate" id="btn-reroll" ${s.rerolls > 0 ? '' : 'disabled'}>Reroll (${s.rerolls})</button>
      </div>`;
    dock.querySelectorAll<HTMLButtonElement>('.offer').forEach((b) => { b.onclick = () => chooseOffer(Number(b.dataset.o)); });
    $('#btn-skip').onclick = () => { if (!gate('skip')) return; ui.selected = null; act({ type: 'draft', pick: null }); emit('drafted'); };
    $('#btn-reroll').onclick = () => { if (!gate('reroll')) return; ui.selected = null; J.tick(); act({ type: 'reroll' }); };
  } else {
    dock.innerHTML = '';
  }
}

// ================================================================== actions

function act(a: Action, toast?: string): void {
  if (busy) return;
  J.unlockAudio();
  const prev = ui.s;
  ui.s = step(ui.s, a);
  if (a.type === 'flashSale' || a.type === 'loan') { J.cashOut(); bg.pulse('amber', 0.8); animateCash(prev.cash, ui.s.cash, 380); }
  if (toast) flash(toast);
  afterStep(prev);
}

function afterStep(prev: GameState): void {
  const s = ui.s;
  if (s.payroll.cycle > prev.payroll.cycle) {
    const paid = prev.cash - s.cash + (s.cash - prev.cash);
    void paid;
    J.thud(); J.buzz([30, 40, 30]); J.shake($('#game'), 0.5); bg.pulse('red', 0.5);
    showBanner(`-${money(prev.payroll.amount).slice(1)}`, 'PAYROLL PAID', 'bad');
    animateCash(prev.cash, s.cash, 700);
    if (ui.mode === 'tutorial') renderAll();
  } else if (s.phase !== 'dead') {
    shownCash = s.cash;
  }
  renderAll();
  if (s.phase === 'dead') showDeath();
  maybeTips();
}

function chooseOffer(i: number): void {
  const o = ui.s.offers[i];
  if (!o || busy || !gate('select')) return;
  J.unlockAudio();
  J.tick();
  if (o.kind === 'excuse' || o.id === 'botfarm') {
    ui.selected = null;
    act({ type: 'draft', pick: i }, o.kind === 'excuse' ? `${offerName(o)}: added to your excuses` : 'Bulk order placed');
    emit('drafted');
    return;
  }
  ui.selected = ui.selected === i ? null : i;
  renderGrid();
  renderDock();
  if (ui.selected !== null) emit('select');
}

let replaceArmed = -1;
function onTileClick(i: number): void {
  if (busy) return;
  const s = ui.s;
  if (s.phase === 'draft' && ui.selected !== null) {
    if (!gate('place')) return;
    const existing = s.grid[i];
    if (existing && ui.mode === 'tutorial') return;
    if (existing && replaceArmed !== i) {
      replaceArmed = i;
      flash(`Tap again to replace it (${money(BALANCE.severance)} severance)`);
      setTimeout(() => { if (replaceArmed === i) replaceArmed = -1; }, 2500);
      return;
    }
    replaceArmed = -1;
    const pick = ui.selected;
    ui.selected = null;
    J.tick(); J.buzz(8);
    act({ type: 'draft', pick, slot: i }, existing ? 'Replaced' : undefined);
    const tile = document.querySelector<HTMLElement>(`.tile[data-i="${i}"]`);
    if (tile && J.motionOk()) tile.animate([{ transform: 'translateY(-30px) scale(1.2)', opacity: 0 }, { transform: 'translateY(4px) scale(.96)', opacity: 1 }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.3,1)' });
    J.thud();
    emit('placed');
    emit('drafted');
    return;
  }
  const card = s.grid[i];
  if (card && gate('info')) showInfo(card);
}

// ================================================================== the day

async function onTap(): Promise<void> {
  if (busy || ui.s.phase !== 'morning' || !gate('tap')) return;
  J.unlockAudio();
  busy = true;
  document.body.classList.add('busy');
  $('#guide').hidden = true; // Marv steps aside so the payoff is fully visible
  const btn = document.querySelector('#btn-tap');
  btn?.classList.add('press');
  const prev = ui.s;
  const next = step(prev, { type: 'tap' });
  const report = next.lastReport;
  if (!report) { busy = false; return; }

  await revealCandle(report.candle);

  const grid = $('#grid');
  let running = prev.cash;
  let k = 0;
  const ordered = prev.grid
    .map((c, i) => ({ c, i }))
    .filter((x): x is { c: CardInstance; i: number } => x.c !== null)
    .map(({ c, i }) => ({ i, r: report.results.find((r) => r.uid === c.uid) }))
    .filter((x) => x.r && x.r.cash !== 0);
  for (const { i, r } of ordered) {
    if (!r) continue;
    const tile = grid.querySelector<HTMLElement>(`.tile[data-i="${i}"]`);
    running += r.cash;
    if (tile) popTile(tile, r.cash, r.base);
    setCash(running);
    renderPayrollOnly(running);
    if (r.cash > 0) { J.coin(k); J.buzz(6); } else { J.loss(); J.buzz([20, 30, 20]); }
    k++;
    await J.wait(Math.max(55, 150 - k * 9));
  }

  const income = report.income;
  const record = income > ui.bestIncome && prev.day > 2;
  if (income > ui.bestIncome) ui.bestIncome = income;
  ui.tape.push(report.candle);
  const scale = Math.min(1, Math.abs(income) / Math.max(200, prev.payroll.amount * 0.6));
  J.shake($('#game'), scale * 0.8);
  bg.pulse(income >= 0 ? 'mint' : 'red', 0.4 + scale);
  if (record) { $('#cash-box').classList.add('fire'); J.fanfare(); setTimeout(() => $('#cash-box').classList.remove('fire'), 2600); }
  showBanner(signed(income), record ? 'NEW RECORD DAY' : `${CANDLE[report.candle]} · ${report.results.filter((r) => r.cash > 0).length} paid`, income >= 0 ? 'good' : 'bad');
  await J.wait(700);

  ui.s = next;
  shownCash = next.cash;
  busy = false;
  btn?.classList.remove('press');
  document.body.classList.remove('busy');
  renderAll();

  for (const uid of report.spawned) {
    const tile = document.querySelector<HTMLElement>(`.tile[data-uid="${uid}"]`);
    if (tile && J.motionOk()) tile.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
  }
  emit('tap-done');
  if (next.phase === 'payout') {
    J.alarm(); J.buzz([40, 60, 40]); bg.pulse('amber', 0.7);
    await J.wait(260);
    openPayout();
  } else if (next.phase === 'dead') {
    showDeath();
  }
  maybeTips();
}

function renderPayrollOnly(cash: number): void {
  const s = ui.s;
  const due = s.payroll.amount;
  $('#payroll-fill').style.width = `${Math.max(0, Math.min(1, cash / due)) * 100}%`;
}

async function revealCandle(c: Candle): Promise<void> {
  const box = $('#reveal');
  box.className = 'reveal on';
  box.innerHTML = '<i class="big-candle"></i><span>...</span>';
  bg.boost(0.6);
  const candle = box.querySelector<HTMLElement>('.big-candle');
  if (candle && J.motionOk()) candle.animate([{ height: '8px', transform: 'translateY(0)' }, { height: '70px' }, { height: '30px' }, { height: '84px' }, { height: '56px' }], { duration: 640, easing: 'ease-in-out', fill: 'forwards' });
  for (let t = 0; t < 5; t++) { J.tick(); await J.wait(120); }
  box.classList.add(`c-${c}`);
  const label = box.querySelector('span');
  if (label) label.innerHTML = `${CANDLE[c]}`;
  if (c === 'chop') J.coin(0); else if (c === 'news') J.alarm(); else J.thud();
  J.buzz(c === 'chop' ? 10 : 30);
  bg.pulse(c === 'chop' ? 'mint' : c === 'news' ? 'amber' : c === 'up' ? 'mint' : 'red', 0.5);
  if (J.motionOk()) box.animate([{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 160 });
  await J.wait(520);
  box.className = 'reveal';
}

function popTile(tile: HTMLElement, cash: number, base: number): void {
  const f = document.createElement('span');
  f.className = `chipf ${cash >= 0 ? '' : 'neg'}`;
  const boost = base > 0 && cash > 0 && cash !== base ? `<em>x${(cash / base).toFixed(cash / base >= 10 ? 0 : 1)}</em>` : '';
  f.innerHTML = `<b>${signed(cash)}</b>${boost}`;
  tile.appendChild(f);
  if (J.motionOk()) {
    tile.animate([{ transform: 'translateY(0) rotate(0)' }, { transform: 'translateY(-6px) rotate(-3deg) scale(1.08)' }, { transform: 'translateY(0) rotate(2deg)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
    f.animate([{ transform: 'translate(-50%, 6px) scale(.6)', opacity: 0 }, { transform: 'translate(-50%, -10px) scale(1.15)', opacity: 1, offset: 0.25 }, { transform: 'translate(-50%, -18px) scale(1)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%, -30px)', opacity: 0 }], { duration: 900, easing: 'ease-out', fill: 'forwards' });
  }
  setTimeout(() => f.remove(), 920);
}

function animateCash(from: number, to: number, ms: number): void {
  const start = performance.now();
  const stepFn = (now: number): void => {
    const t = Math.min(1, (now - start) / ms);
    setCash(from + (to - from) * (1 - Math.pow(1 - t, 3)));
    renderHud();
    if (t < 1) requestAnimationFrame(stepFn);
  };
  requestAnimationFrame(stepFn);
}

let bannerTimer = 0;
function showBanner(big: string, small: string, tone: 'good' | 'bad'): void {
  const b = $('#banner');
  b.innerHTML = `<b>${big}</b><small>${small}</small>`;
  b.className = `banner on ${tone}`;
  if (J.motionOk()) b.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.2)', opacity: 1, offset: 0.4 }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 300, easing: 'ease-out' });
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => { b.className = 'banner'; }, 1300);
}

let flashTimer = 0;
function flash(text: string): void {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => t.classList.remove('on'), 2200);
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
  const short = after < s.payroll.amount;
  const exposed = card.revealed && def.fraud;
  const excuses = [...new Set(s.excuses)].map((e) => {
    const ex = EXCUSES[e];
    const uses = s.stats.excuseUses[e] ?? 0;
    return `<button class="excuse plate" data-ex="${e}"><b>${ex?.name ?? e}</b><small>${ex?.blurb ?? ''}${uses ? ` Used ${uses}x already.` : ''}</small></button>`;
  }).join('');

  const m = $('#payout');
  m.hidden = false;
  m.innerHTML = `
    <div class="ticket" role="dialog" aria-modal="true" aria-labelledby="po-title">
      <p class="eyebrow" id="po-title">Payout request${s.queue.length > 1 ? ` · ${s.queue.length} waiting` : ''}</p>
      <div class="pcard${exposed ? ' exposed' : ''}" id="pcard">
        <img class="spr" src="${spriteUrl(spriteFor(card), card.uid)}" alt="">
        <span class="pname">${displayName(card)}</span>
        <span class="pmeta">${card.age} day${card.age === 1 ? '' : 's'} on the book${card.payouts ? ` · paid ${card.payouts}x before` : ''}${card.stalls ? ` · stalled ${card.stalls}/2` : ''}</span>
        ${exposed ? `<span class="evidence">Exposed: ${def.name}. You have evidence.</span>` : '<span class="pmeta">wants paying</span>'}
        <strong class="pamt" id="pamt" style="grid-column: 1 / -1">$0</strong>
      </div>
      <p class="consequence ${short ? 'warn' : ''}">Cash ${money(s.cash)} → <b>${money(after)}</b> if you pay. Payroll ${money(s.payroll.amount)} ${days <= 0 ? 'tonight' : `in ${days} day${days === 1 ? '' : 's'}`}.</p>
      <div class="pact">
        <button class="pay" id="po-pay" ${canPay ? '' : 'disabled'}>${canPay ? 'PAY' : 'NO CASH'}</button>
        <button class="stall plate" id="po-stall" ${canStall ? '' : 'disabled'}>Stall 3 days</button>
      </div>
      <p class="eyebrow">Or deny with</p>
      <div class="excuses">${excuses || '<p class="noex">No excuses in hand.</p>'}</div>
      <button class="ghost-them" id="po-ghost">Ghost them <small>no excuse, big Trust and Heat hit</small></button>
    </div>`;

  const amt = $('#pamt');
  const start = performance.now();
  const dur = J.motionOk() ? 650 : 1;
  let lastTick = 0;
  const count = (now: number): void => {
    const t = Math.min(1, (now - start) / dur);
    amt.textContent = money(req.amount * (1 - Math.pow(1 - t, 3)));
    if (now - lastTick > 55 && t < 1) { J.tick(); lastTick = now; }
    if (t < 1) requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
  if (J.motionOk()) {
    $('#pcard').animate([{ transform: 'rotateY(90deg) scale(.8)' }, { transform: 'rotateY(0) scale(1.04)' }, { transform: 'none' }], { duration: 360, easing: 'ease-out' });
    m.querySelector('.ticket')?.animate([{ transform: 'translateY(40px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
  }
  $('#po-pay').onclick = () => { if (gate('pay')) void decide({ type: 'payout', decision: 'pay' }, 'PAID'); };
  $('#po-stall').onclick = () => { if (gate('stall')) void decide({ type: 'payout', decision: 'stall' }, 'STALLED'); };
  $('#po-ghost').onclick = () => { if (gate('deny')) void decide({ type: 'payout', decision: 'deny' }, 'GHOSTED'); };
  m.querySelectorAll<HTMLButtonElement>('.excuse').forEach((b) => {
    b.onclick = () => { if (gate('deny')) void decide({ type: 'payout', decision: 'deny', excuse: b.dataset.ex ?? '' }, excuseDef(b.dataset.ex ?? 'terms').stallDays ? 'UNDER REVIEW' : 'DENIED'); };
  });
  emit('payout-open');
}

async function decide(a: Action, stampText: string): Promise<void> {
  if (busy) return;
  busy = true;
  const prev = ui.s;
  ui.s = step(ui.s, a);
  const st = document.createElement('span');
  st.className = `stamp ${stampText === 'PAID' ? 'ok' : 'no'}`;
  st.textContent = stampText;
  $('#pcard').appendChild(st);
  if (J.motionOk()) st.animate([{ transform: 'translate(-50%,-50%) scale(3) rotate(-12deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1) rotate(-12deg)', opacity: 1 }], { duration: 140, easing: 'ease-in', fill: 'forwards' });
  if (stampText === 'PAID') { J.cashOut(); J.buzz([20, 30, 20]); bg.pulse('mint', 0.8); animateCash(prev.cash, ui.s.cash, 500); }
  else { J.stamp(); J.buzz(45); bg.pulse('red', 0.9); J.shake($('#payout .ticket'), 0.4); }
  await J.wait(700);
  busy = false;
  emit('payout-done');
  if (ui.s.phase === 'payout') { openPayout(); renderHud(); renderFeed(); return; }
  $('#payout').hidden = true;
  shownCash = ui.s.cash;
  renderAll();
  if (ui.s.phase === 'dead') showDeath();
  maybeTips();
}

// ================================================================== info + death

function showInfo(card: CardInstance): void {
  const def = cardDef(card.def);
  const hidden = !card.revealed && def.disguise;
  const t = def.threshold;
  const sheet = $('#info');
  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="ticket" role="dialog" aria-modal="true">
      <div class="irow"><img class="spr" src="${spriteUrl(spriteFor(card), card.uid)}" alt=""><div><b>${displayName(card)}</b><small>${def.kind === 'staff' ? 'Staff' : 'Customer'}${card.revealed && def.fraud ? ' · exposed fraud' : ''}</small></div></div>
      <p class="desc">${hidden ? (CARDS.retail?.blurb ?? '') : def.blurb}</p>
      <dl>
        ${t ? `<dt>Payout progress</dt><dd>${card.progress} / ${t}</dd>` : ''}
        ${card.bonus ? `<dt>Upsold</dt><dd>+${card.bonus} a day</dd>` : ''}
        <dt>On the book</dt><dd>${card.age} day${card.age === 1 ? '' : 's'}</dd>
        ${card.payouts ? `<dt>Payouts so far</dt><dd>${card.payouts}</dd>` : ''}
      </dl>
      <button class="ghost-btn plate" id="info-close">Close</button>
    </div>`;
  $('#info-close').onclick = () => { sheet.hidden = true; };
  sheet.onclick = (e) => { if (e.target === sheet) sheet.hidden = true; };
}

const CAUSE: Record<string, string> = { payroll: 'Missed payroll', trust: 'Nobody trusts you', heat: 'Shut down by regulators' };

function showDeath(): void {
  const s = ui.s;
  guideStop();
  $('#payout').hidden = true;
  $('#info').hidden = true;
  J.thud(); J.buzz([80, 60, 120]); bg.pulse('red', 1.4); J.shake($('#game'), 1);
  const best = store<{ days: number; val: number }>('best') ?? { days: 0, val: 0 };
  const newBest = s.stats.peakValuation > best.val && ui.mode !== 'tutorial';
  if (newBest) store('best', { days: s.day, val: s.stats.peakValuation });
  const near = s.cause === 'payroll' ? `${money(s.shortBy)} short` : s.cause === 'trust' ? 'Trust hit zero' : 'Heat hit 100';
  const share = `${ui.firm} lasted ${s.day} days on FIRM. Peak valuation ${money(s.stats.peakValuation)}. ${CAUSE[s.cause ?? 'payroll']}: ${near.toLowerCase()}.`;
  const d = $('#death');
  d.hidden = false;
  d.innerHTML = `
    <div class="dcard plate" role="dialog" aria-modal="true" aria-labelledby="d-title">
      <p class="eyebrow">Firm closed · day ${s.day}</p>
      <h2 id="d-title">${ui.firm}</h2>
      <p class="cause"><b>${CAUSE[s.cause ?? 'payroll']}</b><span>${near}</span></p>
      <div class="dstats">
        <div><small>Days</small><b>${s.day}</b></div>
        <div><small>Peak value</small><b>${money(s.stats.peakValuation)}</b></div>
        <div><small>Trust</small><b>${s.trust.toFixed(1)}</b></div>
        <div><small>Paid</small><b>${s.stats.payoutsPaid}</b></div>
        <div><small>Denied</small><b>${s.stats.payoutsDenied}</b></div>
        <div><small>Fraud caught</small><b>${s.stats.fraudCaught}</b></div>
      </div>
      <p class="best">${newBest ? 'New personal best' : best.val ? `Best ${money(best.val)} · ${best.days} days` : ''}</p>
      <button class="primary" id="d-new"><span>NEW FIRM</span><small>space</small></button>
      <div class="drow">
        <button class="ghost-btn plate" id="d-daily">Daily tape</button>
        <button class="ghost-btn plate" id="d-copy">Copy result</button>
      </div>
    </div>`;
  if (J.motionOk()) d.querySelector('.dcard')?.animate([{ transform: 'translateY(60px) rotate(-2deg)', opacity: 0 }, { transform: 'translateY(-6px) rotate(1deg)', opacity: 1, offset: 0.7 }, { transform: 'none' }], { duration: 420, easing: 'ease-out' });
  $('#d-new').onclick = () => { J.tick(); newGame('random'); };
  $('#d-daily').onclick = () => { J.tick(); newGame('daily'); };
  $('#d-copy').onclick = () => { navigator.clipboard?.writeText(share).then(() => flash('Copied'), () => flash(share)); };
}

function closeOverlays(): void {
  for (const id of ['#payout', '#death', '#info']) $(id).hidden = true;
}

// ================================================================== Marv, the guide

type Gate = 'tap' | 'select' | 'place' | 'skip' | 'reroll' | 'pay' | 'stall' | 'deny' | 'info' | 'sale' | 'loan';
let allowed: Set<Gate> | null = null;
const waiters = new Map<string, () => void>();
let guideToken = 0;

function gate(g: Gate): boolean {
  if (!allowed || allowed.has(g)) return true;
  J.loss();
  const marv = document.querySelector<HTMLElement>('#guide .marv');
  if (marv && J.motionOk()) J.shake(marv, 0.3);
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
    if (!el) { hole.className = 'hole none'; return; }
    const r = el.getBoundingClientRect();
    const pad = 6;
    hole.className = 'hole';
    Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const lowHalf = r.top + r.height / 2 > window.innerHeight * 0.55;
    marv.classList.toggle('top', o.top ?? lowHalf);
  };
  place();
  allowed = o.wait ? new Set(o.allow ?? []) : new Set();
  marv.innerHTML = `
    <div class="face plate"><img class="spr" src="${spriteUrl('cfo')}" alt="Marv"></div>
    <div class="bubble plate"><span class="who">Marv · your CFO</span><p id="g-text"></p>
      <div class="row"><span class="hint">${o.hint ?? ''}</span>${o.wait ? '' : '<button class="next" id="g-next">Next</button>'}</div>
    </div>`;
  const p = $('#g-text');
  marv.classList.remove('quiet');
  let i = 0;
  let skip = false;
  const typing = (async () => {
    while (i < o.text.length && token === guideToken) {
      if (skip) { i = o.text.length; break; }
      i++;
      p.textContent = o.text.slice(0, i);
      if (o.text[i - 1] !== ' ' && i % 2 === 0) J.tick();
      await J.wait(o.text[i - 1] === '.' ? 160 : 18);
    }
    p.textContent = o.text;
    marv.classList.add('quiet');
  })();
  const onResize = (): void => place();
  window.addEventListener('resize', onResize);
  if (o.wait) {
    await waitFor(o.wait);
  } else {
    await new Promise<void>((res) => {
      const next = $('#g-next');
      next.onclick = () => {
        if (i < o.text.length) { skip = true; return; }
        J.tick();
        res();
      };
    });
  }
  await typing;
  window.removeEventListener('resize', onResize);
  allowed = null;
  if (token === guideToken) { g.hidden = true; hole.className = 'hole none'; }
}

function guideStop(): void {
  guideToken++;
  allowed = null;
  waiters.clear();
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
  if (ui.mode === 'tutorial' || ui.s.phase === 'dead') return;
  if (ui.s.grid.some((c) => c?.revealed && cardDef(c.def).fraud)) void tip('fraud', 'Your analyst caught fraud. Deny them and the evidence protects your Trust.', '.tile.exposed');
  else if (ui.s.heat >= 40) void tip('heat40', 'Heat is climbing. Denials and bot accounts draw regulators. At 100 they shut you down.', '#heat-box');
}

/** The guided first three days. Forced candles and offers make every lesson land. */
async function tutorial(): Promise<void> {
  const token = guideToken;
  const live = (): boolean => token === guideToken && ui.mode === 'tutorial';
  const force = (c: Candle): void => { ui.s = { ...ui.s, forecast: { chop: 0, up: 0, down: 0, news: 0, [c]: 1 } }; };
  const offers = (o: Offer[]): void => { ui.s = { ...ui.s, offers: o }; renderDock(); };

  await J.wait(500);
  // Day 1
  await say({ text: "Welcome to FIRM. I'm Marv, your CFO. You just opened a prop firm.", target: null });
  if (!live()) return;
  await say({ text: 'These are your customers. Traders pay you a fee to take your trading challenge.', target: '.felt' });
  if (!live()) return;
  await say({ text: "Most of them blow up and buy again. That's how firms make money.", target: '.felt' });
  if (!live()) return;
  force('chop');
  await say({ text: 'Open the market. Every day prints one candle, and every trader reacts to it.', target: '#btn-tap', hint: 'Tap OPEN MARKET', wait: 'tap-done', allow: ['tap'] });
  if (!live()) return;
  offers([{ kind: 'card', id: 'affiliate' }, { kind: 'card', id: 'gambler' }, { kind: 'excuse', id: 'kyc' }]);
  await say({ text: 'Chop day. Everyone blew up and paid you. That number up top is your cash.', target: '#cash-box' });
  if (!live()) return;
  await say({ text: 'Every day you hire one card. Take the Affiliate. Staff boost the 8 squares around them.', target: '.offers', hint: 'Tap the Affiliate', wait: 'select', allow: ['select'] });
  if (!live()) return;
  await say({ text: 'Put them next to as many Gamblers as you can. Placement is everything.', target: '.felt', hint: 'Tap an empty slot', wait: 'placed', allow: ['place'], top: true });
  if (!live()) return;
  // Day 2
  reveal('payroll');
  await say({ text: 'This is payroll. Every 5 days, and it grows every time. Miss it once and the firm is dead.', target: '#payroll' });
  if (!live()) return;
  reveal('odds');
  await say({ text: 'These are the odds for the next candle. Chop pays you. Trends push traders toward a payout.', target: '#odds' });
  if (!live()) return;
  force('up');
  await say({ text: 'Open the market. Watch for the x1.5 your Affiliate adds.', target: '#btn-tap', hint: 'Tap OPEN MARKET', wait: 'tap-done', allow: ['tap'] });
  if (!live()) return;
  await say({ text: 'Trend day. See the yellow bars under your Grinders? When one fills, that trader wants paying.', target: '.tile[data-i="7"]', top: true });
  if (!live()) return;
  offers([{ kind: 'card', id: 'grinder' }, { kind: 'card', id: 'discordmod' }, { kind: 'card', id: 'retail' }]);
  await say({ text: 'Hire whoever you like, or skip.', target: '.dock', hint: 'Hire or skip', wait: 'drafted', allow: ['select', 'place', 'skip', 'reroll'] });
  if (!live()) return;
  // Day 3
  force('chop');
  await say({ text: 'Day 3. Open the market.', target: '#btn-tap', hint: 'Tap OPEN MARKET', wait: 'payout-open', allow: ['tap'] });
  if (!live()) return;
  await say({ text: 'A trader passed your challenge. Now you owe them real money.', target: '#pcard', top: true });
  if (!live()) return;
  reveal('hand');
  await say({ text: 'Pay to build Trust. Stall to buy time. Deny with an excuse to keep the cash. Everyone is watching.', target: '.pact', hint: 'Make the call', wait: 'payout-done', allow: ['pay', 'stall', 'deny'], top: true });
  if (!live()) return;
  await J.wait(300);
  reveal('trust');
  await say({ text: 'Trust multiplies every fee you earn. Paying people builds it. Denying them burns it.', target: '#trust-box' });
  if (!live()) return;
  reveal('heat');
  await say({ text: 'Heat is the regulators. Ghost people and fill your book with bots, and they come knocking.', target: '#heat-box' });
  if (!live()) return;
  store('tutorialDone', true);
  ui.mode = 'random';
  renderHud();
  await say({ text: "That's the job. You're on your own now. Survive as long as you can, boss.", target: null });
}

// ================================================================== boot

function boot(data: { ui?: UiState }): void {
  if (data.ui?.s) {
    ui = data.ui;
    ui.revealed = ui.revealed ?? [...ALL_REVEALS];
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
    const t = (e.target as HTMLElement).closest<HTMLElement>('.tile');
    if (t?.dataset.i) onTileClick(Number(t.dataset.i));
  });
  grid.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !J.motionOk()) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('.tile:not(.empty)');
    grid.querySelectorAll<HTMLElement>('.tile.tilt').forEach((x) => { if (x !== t) { x.classList.remove('tilt'); x.style.rotate = ''; x.style.scale = ''; } });
    if (!t) return;
    const r = t.getBoundingClientRect();
    const dx = (e.clientX - r.left) / r.width - 0.5;
    const dy = (e.clientY - r.top) / r.height - 0.5;
    t.classList.add('tilt');
    t.style.rotate = `${-dy} ${dx} 0 ${Math.hypot(dx, dy) * 22}deg`;
    t.style.scale = '1.06';
  });
  grid.addEventListener('pointerleave', () => grid.querySelectorAll<HTMLElement>('.tile.tilt').forEach((x) => { x.classList.remove('tilt'); x.style.rotate = ''; x.style.scale = ''; }));
  const mute = $('#mute');
  J.setMuted(store<boolean>('muted') ?? false);
  const paintMute = (): void => { mute.textContent = J.isMuted() ? 'Muted' : 'Sound'; mute.setAttribute('aria-pressed', String(!J.isMuted())); };
  paintMute();
  mute.onclick = () => { J.unlockAudio(); J.setMuted(!J.isMuted()); store('muted', J.isMuted()); paintMute(); };
  $('#new-run').onclick = () => { if (!busy && ui.mode !== 'tutorial') newGame('random'); };
  window.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if ((e.target as HTMLElement).tagName === 'BUTTON' && e.key === 'Enter') return;
    if (!$('#death').hidden) { e.preventDefault(); newGame('random'); return; }
    if (ui.s.phase === 'morning' && $('#payout').hidden) { e.preventDefault(); void onTap(); }
  });
}

// Debug hook for screenshots and tests.
(window as unknown as { __firm: unknown }).__firm = {
  get state() { return ui.s; },
  get ui() { return ui; },
  load(seed: number) { guideStop(); ui = { s: newRun(seed), mode: 'random', firm: firmName(seed), tape: [], bestIncome: 0, selected: null, revealed: [...ALL_REVEALS] }; shownCash = ui.s.cash; closeOverlays(); renderAll(); },
  tutorial() { newGame('tutorial'); },
  set(patch: Partial<GameState>) { ui.s = { ...ui.s, ...patch }; shownCash = ui.s.cash; renderAll(); },
  act(a: Action) { ui.s = step(ui.s, a); shownCash = ui.s.cash; renderAll(); return ui.s.phase; },
  tape(c: Candle[]) { ui.tape = c; renderOdds(); },
  openPayout, showDeath, guideStop, tap: onTap,
  valuation: () => valuation(ui.s),
};

interface Hot { snapshot?: (fn: () => unknown) => void; ready?: (fn: (data: { ui?: UiState }) => void) => void; data?: { ui?: UiState } }
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
hot?.snapshot?.(() => ({ ui }));
if (hot?.ready) hot.ready(boot); else boot(hot?.data ?? {});
