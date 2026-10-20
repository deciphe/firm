import {
  BALANCE, CARDS, EXCUSES, cardDef, displayName, excuseDef, findCard, legalActions, newRun, seedFromString, step,
  trustMultiplier, valuation,
} from '@firm/sim';
import type { Action, Candle, CardInstance, GameState, Offer } from '@firm/sim';
import { spriteUrl } from './sprites.ts';
import * as J from './juice.ts';

// ------------------------------------------------------------------ state

type Mode = 'random' | 'daily';
interface UiState {
  s: GameState;
  mode: Mode;
  firm: string;
  tape: Candle[];
  bestIncome: number;
  selected: number | null;
}

let ui: UiState;
let busy = false;
let shownCash = 0;

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

const money = (n: number): string => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
const signed = (n: number): string => `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

const FIRST = ['Halcyon', 'Ironbark', 'Bluefin', 'Northgate', 'Kestrel', 'Obsidian', 'Copperline', 'Tidewater', 'Silverpine', 'Redwick', 'Granite', 'Lantern', 'Saltmarsh', 'Hollowbrook', 'Quarry', 'Westlight'];
const SECOND = ['Capital', 'Funding', 'Prop', 'Markets', 'Trading Co.', 'Partners'];
function firmName(seed: number): string {
  return `${FIRST[seed % FIRST.length]} ${SECOND[Math.floor(seed / 7) % SECOND.length]}`;
}

function todaySeed(): { seed: number; label: string } {
  const d = new Date();
  const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { seed: seedFromString(`daily:${label}`), label };
}

function store<T>(key: string, value?: T): T | null {
  try {
    if (value !== undefined) { localStorage.setItem(`firm:${key}`, JSON.stringify(value)); return value; }
    const raw = localStorage.getItem(`firm:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch { return null; }
}

function newGame(mode: Mode): void {
  const seed = mode === 'daily' ? todaySeed().seed : (Math.floor(Math.random() * 2 ** 31) >>> 0);
  ui = { s: newRun(seed), mode, firm: firmName(seed), tape: [], bestIncome: 0, selected: null };
  shownCash = ui.s.cash;
  closeOverlays();
  renderAll();
}

// ------------------------------------------------------------------ labels

const CANDLE_LABEL: Record<Candle, string> = { chop: 'CHOP', up: 'TREND UP', down: 'TREND DOWN', news: 'NEWS SPIKE' };

function spriteFor(card: CardInstance): string {
  const def = cardDef(card.def);
  if (!card.revealed && def.disguise) return card.def === 'bot' ? 'bot' : 'retail';
  return card.def;
}

function offerName(o: Offer): string {
  if (o.kind === 'excuse') return excuseDef(o.id).name;
  const def = cardDef(o.id);
  return def.disguise ?? def.name;
}

function offerBlurb(o: Offer): string {
  if (o.kind === 'excuse') return excuseDef(o.id).blurb;
  const def = cardDef(o.id);
  return def.disguise ? (CARDS.retail?.blurb ?? '') : def.blurb;
}

function offerSprite(o: Offer): string {
  if (o.kind === 'excuse') return 'excuse';
  const def = cardDef(o.id);
  return def.disguise ? 'retail' : o.id;
}

function offerTag(o: Offer): string {
  if (o.kind === 'excuse') return 'Excuse';
  const def = cardDef(o.id);
  if (def.disguise) return 'Customer';
  return def.kind === 'staff' ? 'Staff' : 'Customer';
}

// ------------------------------------------------------------------ render

function renderAll(): void {
  renderHud();
  renderTape();
  renderGrid();
  renderFeed();
  renderDock();
}

function renderHud(): void {
  const s = ui.s;
  $('#firm-name').textContent = ui.firm;
  $('#day').textContent = `Day ${s.day}`;
  $('#mode').textContent = ui.mode === 'daily' ? `Daily tape ${todaySeed().label}` : 'Free run';
  setCash(shownCash);
  const stars = Math.round(s.trust * 10) / 10;
  $('#trust').textContent = stars.toFixed(1);
  $('#trust-fill').style.width = `${(s.trust / BALANCE.maxTrust) * 100}%`;
  $('#trust-mult').textContent = `fees ×${trustMultiplier(s.trust).toFixed(2)}`;
  $('#heat').textContent = String(Math.round(s.heat));
  $('#heat-fill').style.width = `${(s.heat / BALANCE.maxHeat) * 100}%`;
  $('#heat-box').classList.toggle('hot', s.heat >= 60);

  const loanDue = s.payroll.loanOwed > 0 && s.payroll.cycle >= s.payroll.loanDueCycle ? s.payroll.loanOwed : 0;
  const due = s.payroll.amount + loanDue;
  const days = s.payroll.dueDay - s.day;
  $('#payroll-amt').textContent = money(due);
  $('#payroll-when').textContent = days <= 0 ? 'due tonight' : `due in ${days} day${days === 1 ? '' : 's'}`;
  const pct = Math.max(0, Math.min(1, shownCash / due));
  $('#payroll-fill').style.width = `${pct * 100}%`;
  $('#payroll').classList.toggle('short', shownCash < due);
  $('#payroll').classList.toggle('danger', shownCash < due && days <= 1);
  $('#heat-note').textContent = s.heat >= 80 ? 'regulators circling' : s.heat >= 50 ? 'getting noticed' : 'safe';
  $('#payroll-gap').textContent = shownCash >= due ? 'Covered' : `Need ${money(due - shownCash)} more`;
  $('#loan-note').hidden = s.payroll.loanOwed === 0;
  $('#loan-note').textContent = `Loan ${money(s.payroll.loanOwed)} due at payroll ${s.payroll.loanDueCycle}`;
}

function setCash(v: number): void {
  shownCash = v;
  $('#cash').textContent = money(v);
}

function renderTape(): void {
  const strip = $('#tape-strip');
  strip.innerHTML = ui.tape.length ? '' : '<span class="tape-empty">No trading yet</span>';
  for (const c of ui.tape.slice(-14)) {
    const el = document.createElement('i');
    el.className = `candle c-${c}`;
    strip.appendChild(el);
  }
  const f = ui.s.forecast;
  $('#forecast').innerHTML = (['chop', 'up', 'down', 'news'] as Candle[])
    .map((c) => `<span class="fc f-${c}"><b style="width:${Math.round(f[c] * 100)}%"></b><em>${c === 'up' ? 'UP' : c === 'down' ? 'DOWN' : c.toUpperCase()} ${Math.round(f[c] * 100)}%</em></span>`)
    .join('');
}

function tileHtml(card: CardInstance | null, i: number): string {
  if (!card) return `<button class="tile empty" data-i="${i}" aria-label="Empty slot"><span class="slot-plus">+</span></button>`;
  const def = cardDef(card.def);
  const name = displayName(card);
  const exposed = card.revealed && def.fraud ? ' exposed' : '';
  const staff = def.kind === 'staff' ? ' staff' : '';
  const t = def.threshold ?? 0;
  const prog = t ? `<span class="prog"><b style="width:${Math.min(100, (card.progress / t) * 100)}%"></b></span>` : '';
  const due = t && card.progress >= t ? ' due' : '';
  const bonus = card.bonus ? `<span class="bonus">+${card.bonus}</span>` : '';
  return `<button class="tile${staff}${exposed}${due}" data-i="${i}" data-uid="${card.uid}" aria-label="${name}">
    ${bonus}<img src="${spriteUrl(spriteFor(card))}" alt="" width="32" height="32">
    <span class="tname">${name}</span>${prog}</button>`;
}

function renderGrid(): void {
  const grid = $('#grid');
  grid.innerHTML = ui.s.grid.map((c, i) => tileHtml(c, i)).join('');
  const placing = ui.selected !== null && ui.s.phase === 'draft';
  grid.classList.toggle('placing', placing);
}

function renderFeed(): void {
  $('#feed').innerHTML = ui.s.feed.slice(0, 2)
    .map((p) => `<p class="post t-${p.tone}"><b>${p.handle}</b> ${escapeHtml(p.text)}</p>`).join('');
}

function escapeHtml(t: string): string {
  return t.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);
}

function renderDock(): void {
  const s = ui.s;
  const dock = $('#dock');
  if (s.phase === 'morning') {
    const legal = legalActions(s);
    const sale = legal.some((a) => a.type === 'flashSale');
    const loan = legal.some((a) => a.type === 'loan');
    dock.innerHTML = `
      <div class="moves">
        <button class="move" id="btn-sale" ${sale ? '' : 'disabled'}><b>Flash sale</b><small>+${money(100 + 100 * s.payroll.cycle)} now · 3 unknown customers · −Trust</small></button>
        <button class="move" id="btn-loan" ${loan ? '' : 'disabled'}><b>Founder loan</b><small>+${money(s.payroll.amount)} now · repay ${money(Math.round(s.payroll.amount * 1.6))} next payroll</small></button>
      </div>
      <button class="primary" id="btn-tap"><span>Open the market</span><small>Day ${s.day}</small></button>`;
    $('#btn-tap').onclick = onTap;
    $('#btn-sale').onclick = () => act({ type: 'flashSale' }, 'Flash sale');
    $('#btn-loan').onclick = () => act({ type: 'loan' }, 'Loan taken');
  } else if (s.phase === 'draft') {
    const offers = s.offers.map((o, i) => `
      <button class="offer r-${o.kind === 'excuse' ? 'excuse' : cardDef(o.id).rarity}${ui.selected === i ? ' sel' : ''}" data-o="${i}">
        <span class="otag">${offerTag(o)}</span>
        <img src="${spriteUrl(offerSprite(o))}" alt="" width="32" height="32">
        <b>${offerName(o)}</b><small>${offerBlurb(o)}</small>
      </button>`).join('');
    const hint = ui.selected === null ? 'Hire one. Placement matters: staff boost their neighbours.' : 'Tap a slot on the book to place it.';
    dock.innerHTML = `
      <p class="dhint">${hint}</p>
      <div class="offers">${offers}</div>
      <div class="drow">
        <button class="ghost-btn" id="btn-skip">Skip</button>
        <button class="ghost-btn" id="btn-reroll" ${s.rerolls > 0 ? '' : 'disabled'}>Reroll (${s.rerolls})</button>
      </div>`;
    dock.querySelectorAll<HTMLButtonElement>('.offer').forEach((b) => { b.onclick = () => chooseOffer(Number(b.dataset.o)); });
    $('#btn-skip').onclick = () => { ui.selected = null; act({ type: 'draft', pick: null }); };
    $('#btn-reroll').onclick = () => { ui.selected = null; act({ type: 'reroll' }); };
  } else {
    dock.innerHTML = '';
  }
  renderHand();
}

function renderHand(): void {
  $('#hand').innerHTML = ui.s.excuses.length
    ? ui.s.excuses.map((e) => `<span class="chip">${excuseDef(e).name}</span>`).join('')
    : '<span class="chip none">No excuses</span>';
}

// ------------------------------------------------------------------ actions

function act(a: Action, toast?: string): void {
  if (busy) return;
  J.unlockAudio();
  const prev = ui.s;
  ui.s = step(ui.s, a);
  if (a.type === 'flashSale' || a.type === 'loan') { J.cashOut(); animateCash(prev.cash, ui.s.cash, 380); }
  if (toast) flash(toast);
  afterStep(prev);
}

function afterStep(prev: GameState): void {
  const s = ui.s;
  if (s.payroll.cycle > prev.payroll.cycle) {
    const paid = prev.payroll.amount + (prev.payroll.loanOwed > 0 && s.payroll.loanOwed === 0 ? prev.payroll.loanOwed : 0);
    J.thud();
    J.buzz([30, 40, 30]);
    J.shake($('#app'), 0.5);
    flash(`Payroll paid −${money(paid).slice(1)} · next ${money(s.payroll.amount)}`);
    animateCash(prev.cash + (s.cash - prev.cash) + paid, s.cash, 600);
  } else if (s.phase !== 'dead') {
    shownCash = s.cash;
  }
  renderAll();
  if (s.phase === 'dead') showDeath();
}

function chooseOffer(i: number): void {
  const o = ui.s.offers[i];
  if (!o || busy) return;
  J.unlockAudio();
  J.tick();
  if (o.kind === 'excuse' || o.id === 'botfarm') {
    ui.selected = null;
    act({ type: 'draft', pick: i }, o.kind === 'excuse' ? `${offerName(o)} added to your excuses` : 'Bulk order placed');
    return;
  }
  ui.selected = ui.selected === i ? null : i;
  renderGrid();
  renderDock();
}

function onTileClick(i: number): void {
  if (busy) return;
  const s = ui.s;
  if (s.phase === 'draft' && ui.selected !== null) {
    const pick = ui.selected;
    const existing = s.grid[i];
    if (existing && !confirmReplace(i)) return;
    ui.selected = null;
    J.tick();
    J.buzz(8);
    act({ type: 'draft', pick, slot: i }, existing ? `Replaced (−${money(BALANCE.severance).slice(1)} severance)` : undefined);
    const tile = document.querySelector<HTMLElement>(`.tile[data-i="${i}"]`);
    if (tile && J.motionOk()) tile.animate([{ transform: 'scale(.6)', opacity: 0.2 }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
    return;
  }
  const card = s.grid[i];
  if (card) showInfo(card);
}

let replaceArmed = -1;
function confirmReplace(i: number): boolean {
  if (replaceArmed === i) { replaceArmed = -1; return true; }
  replaceArmed = i;
  flash(`Tap again to replace it (−${money(BALANCE.severance).slice(1)} severance)`);
  setTimeout(() => { if (replaceArmed === i) replaceArmed = -1; }, 2500);
  return false;
}

// ------------------------------------------------------------------ the day

async function onTap(): Promise<void> {
  if (busy || ui.s.phase !== 'morning') return;
  J.unlockAudio();
  busy = true;
  document.body.classList.add('busy');
  const prev = ui.s;
  const next = step(prev, { type: 'tap' });
  const report = next.lastReport;
  if (!report) { busy = false; return; }

  // 1. The candle: suspense, then the reveal.
  await revealCandle(report.candle);

  // 2. Fees, one tile at a time, climbing in pitch.
  const grid = $('#grid');
  let running = prev.cash;
  let k = 0;
  const ordered = prev.grid
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c !== null)
    .map(({ c, i }) => ({ i, r: report.results.find((r) => r.uid === (c as CardInstance).uid) }))
    .filter((x) => x.r && x.r.cash !== 0);
  for (const { i, r } of ordered) {
    if (!r) continue;
    const tile = grid.querySelector<HTMLElement>(`.tile[data-i="${i}"]`);
    running += r.cash;
    if (tile) popTile(tile, r.cash);
    setCash(running);
    if (r.cash > 0) { J.coin(k); J.buzz(6); } else { J.loss(); J.buzz([20, 30, 20]); }
    k++;
    await J.wait(Math.max(45, 120 - k * 7));
  }

  // 3. The total lands.
  const income = report.income;
  const record = income > ui.bestIncome && ui.s.day > 2;
  if (income > ui.bestIncome) ui.bestIncome = income;
  ui.tape.push(report.candle);
  const scale = Math.min(1, Math.abs(income) / Math.max(200, prev.payroll.amount * 0.6));
  J.shake($('#app'), scale * 0.8);
  if (record) { $('#cash-box').classList.add('fire'); J.fanfare(); setTimeout(() => $('#cash-box').classList.remove('fire'), 2600); }
  banner(`${CANDLE_LABEL[report.candle]} · ${signed(income)}${record ? ' · RECORD' : ''}`, income >= 0 ? 'good' : 'bad');
  await J.wait(260);

  ui.s = next;
  shownCash = next.cash;
  busy = false;
  document.body.classList.remove('busy');
  renderAll();

  for (const uid of report.spawned) {
    const tile = document.querySelector<HTMLElement>(`.tile[data-uid="${uid}"]`);
    if (tile && J.motionOk()) tile.animate([{ transform: 'scale(0)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
  }
  if (next.phase === 'payout') {
    J.alarm();
    J.buzz([40, 60, 40]);
    await J.wait(240);
    openPayout();
  } else if (next.phase === 'dead') {
    showDeath();
  }
}

async function revealCandle(c: Candle): Promise<void> {
  const box = $('#reveal');
  box.className = 'reveal on';
  box.innerHTML = '<i class="big-candle"></i><span>Market open</span>';
  const candle = box.querySelector<HTMLElement>('.big-candle');
  if (candle && J.motionOk()) {
    candle.animate([{ height: '6px' }, { height: '58px' }, { height: '40px' }, { height: '64px' }], { duration: 520, easing: 'ease-in-out' });
  }
  for (let t = 0; t < 4; t++) { J.tick(); await J.wait(110); }
  box.classList.add(`c-${c}`);
  const label = box.querySelector('span');
  if (label) label.textContent = CANDLE_LABEL[c];
  if (c === 'chop') J.coin(0); else if (c === 'news') J.alarm(); else J.thud();
  J.buzz(c === 'chop' ? 10 : 30);
  await J.wait(380);
  box.className = 'reveal';
}

function popTile(tile: HTMLElement, cash: number): void {
  const f = document.createElement('span');
  f.className = `float ${cash >= 0 ? 'pos' : 'neg'}`;
  f.textContent = signed(cash);
  tile.appendChild(f);
  if (J.motionOk()) {
    tile.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
    f.animate([{ transform: 'translate(-50%, 0)', opacity: 1 }, { transform: 'translate(-50%, -26px)', opacity: 0 }], { duration: 700, easing: 'ease-out', fill: 'forwards' });
  }
  setTimeout(() => f.remove(), 720);
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
function banner(text: string, tone: 'good' | 'bad'): void {
  const b = $('#banner');
  b.textContent = text;
  b.className = `banner on ${tone}`;
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => { b.className = 'banner'; }, 1800);
}

let flashTimer = 0;
function flash(text: string): void {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => t.classList.remove('on'), 2200);
}

// ------------------------------------------------------------------ payout desk

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
  const queued = s.queue.length;

  const excuses = [...new Set(s.excuses)].map((e) => {
    const ex = EXCUSES[e];
    const uses = s.stats.excuseUses[e] ?? 0;
    return `<button class="excuse" data-ex="${e}"><b>${ex?.name ?? e}</b><small>${ex?.blurb ?? ''}${uses ? ` · used ${uses}× (hurts more)` : ''}</small></button>`;
  }).join('');

  const m = $('#payout');
  m.hidden = false;
  m.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="po-title">
      <p class="eyebrow" id="po-title">Payout request${queued > 1 ? ` · ${queued} waiting` : ''}</p>
      <div class="pcard${exposed ? ' exposed' : ''}" id="pcard">
        <img src="${spriteUrl(spriteFor(card))}" alt="" width="64" height="64">
        <div>
          <b class="pname">${displayName(card)}</b>
          <span class="pmeta">${card.age} day${card.age === 1 ? '' : 's'} on the book${card.payouts ? ` · paid ${card.payouts}× before` : ''}${card.stalls ? ` · stalled ${card.stalls}/2` : ''}</span>
          ${exposed ? `<span class="evidence">Exposed: ${def.name}. Denial is backed by evidence.</span>` : ''}
        </div>
        <strong class="pamt" id="pamt">$0</strong>
      </div>
      <p class="consequence ${short ? 'warn' : ''}">Cash ${money(s.cash)} → <b>${money(after)}</b> if you pay · payroll ${money(s.payroll.amount)} ${days <= 0 ? 'tonight' : `in ${days}d`}</p>
      <div class="pact">
        <button class="pay" id="po-pay" ${canPay ? '' : 'disabled'}>${canPay ? 'Pay' : 'Not enough cash'}</button>
        <button class="stall" id="po-stall" ${canStall ? '' : 'disabled'}>Stall 3 days</button>
      </div>
      <p class="eyebrow">Or deny with</p>
      <div class="excuses">${excuses || '<p class="noex">No excuses in hand.</p>'}</div>
      <button class="ghost-them" id="po-ghost">Ghost them <small>no excuse · big Trust and Heat hit</small></button>
    </div>`;

  const amt = $('#pamt');
  const start = performance.now();
  const dur = J.motionOk() ? 520 : 1;
  const count = (now: number): void => {
    const t = Math.min(1, (now - start) / dur);
    amt.textContent = money(req.amount * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
  const pcard = $('#pcard');
  if (J.motionOk()) pcard.animate([{ transform: 'rotateY(90deg)' }, { transform: 'rotateY(0)' }], { duration: 300, easing: 'ease-out' });

  $('#po-pay').onclick = () => decide({ type: 'payout', decision: 'pay' }, 'PAID');
  $('#po-stall').onclick = () => decide({ type: 'payout', decision: 'stall' }, 'STALLED');
  $('#po-ghost').onclick = () => decide({ type: 'payout', decision: 'deny' }, 'GHOSTED');
  m.querySelectorAll<HTMLButtonElement>('.excuse').forEach((b) => {
    b.onclick = () => decide({ type: 'payout', decision: 'deny', excuse: b.dataset.ex ?? '' }, excuseDef(b.dataset.ex ?? 'terms').stallDays ? 'UNDER REVIEW' : 'DENIED');
  });
}

async function decide(a: Action, stampText: string): Promise<void> {
  if (busy) return;
  busy = true;
  const prev = ui.s;
  ui.s = step(ui.s, a);
  const pcard = $('#pcard');
  const st = document.createElement('span');
  st.className = `stamp ${stampText === 'PAID' ? 'ok' : 'no'}`;
  st.textContent = stampText;
  pcard.appendChild(st);
  if (J.motionOk()) st.animate([{ transform: 'translate(-50%,-50%) scale(2.4) rotate(-14deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1) rotate(-14deg)', opacity: 1 }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
  if (stampText === 'PAID') { J.cashOut(); J.buzz([20, 30, 20]); animateCash(prev.cash, ui.s.cash, 500); } else { J.stamp(); J.buzz(45); J.shake($('#payout .sheet'), 0.35); }
  await J.wait(620);
  busy = false;
  if (ui.s.phase === 'payout') { openPayout(); renderHud(); renderFeed(); return; }
  $('#payout').hidden = true;
  shownCash = ui.s.cash;
  renderAll();
  if (ui.s.phase === 'dead') showDeath();
}

// ------------------------------------------------------------------ info + death

function showInfo(card: CardInstance): void {
  const def = cardDef(card.def);
  const hidden = !card.revealed && def.disguise;
  const blurb = hidden ? (CARDS.retail?.blurb ?? '') : def.blurb;
  const t = def.threshold;
  const sheet = $('#info');
  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="sheet small" role="dialog" aria-modal="true">
      <div class="irow"><img src="${spriteUrl(spriteFor(card))}" alt="" width="48" height="48"><div><b>${displayName(card)}</b><small>${def.kind === 'staff' ? 'Staff' : 'Customer'}${card.revealed && def.fraud ? ' · exposed fraud' : ''}</small></div></div>
      <p>${blurb}</p>
      <dl>
        ${t ? `<dt>Payout progress</dt><dd>${card.progress} / ${t}</dd>` : ''}
        ${card.bonus ? `<dt>Upsold</dt><dd>+${card.bonus} a day</dd>` : ''}
        <dt>On the book</dt><dd>${card.age} days</dd>
        ${card.payouts ? `<dt>Payouts so far</dt><dd>${card.payouts}</dd>` : ''}
      </dl>
      <button class="ghost-btn" id="info-close">Close</button>
    </div>`;
  $('#info-close').onclick = () => { sheet.hidden = true; };
  sheet.onclick = (e) => { if (e.target === sheet) sheet.hidden = true; };
}

const CAUSE: Record<string, string> = {
  payroll: 'Missed payroll',
  trust: 'Nobody trusted you anymore',
  heat: 'Regulators shut you down',
};

function showDeath(): void {
  const s = ui.s;
  $('#payout').hidden = true;
  $('#info').hidden = true;
  J.thud();
  J.buzz([80, 60, 120]);
  const best = store<{ days: number; val: number }>('best') ?? { days: 0, val: 0 };
  const newBest = s.stats.peakValuation > best.val;
  if (newBest) store('best', { days: s.day, val: s.stats.peakValuation });
  if (ui.mode === 'daily') store(`daily:${todaySeed().label}`, { days: s.day, val: s.stats.peakValuation });
  const near = s.cause === 'payroll' ? `${money(s.shortBy)} short` : s.cause === 'trust' ? 'Trust hit zero' : 'Heat hit 100';
  const share = `${ui.firm} lasted ${s.day} days on FIRM. Peak valuation ${money(s.stats.peakValuation)}. Cause of death: ${CAUSE[s.cause ?? 'payroll']}, ${near.toLowerCase()}.`;
  const d = $('#death');
  d.hidden = false;
  d.innerHTML = `
    <div class="dcard" role="dialog" aria-modal="true" aria-labelledby="d-title">
      <p class="eyebrow">Firm closed</p>
      <h2 id="d-title">${ui.firm}</h2>
      <p class="cause">${CAUSE[s.cause ?? 'payroll']}<span>${near}</span></p>
      <div class="dstats">
        <div><small>Days survived</small><b>${s.day}</b></div>
        <div><small>Peak valuation</small><b>${money(s.stats.peakValuation)}</b></div>
        <div><small>Payouts paid</small><b>${s.stats.payoutsPaid}</b></div>
        <div><small>Payouts denied</small><b>${s.stats.payoutsDenied}</b></div>
        <div><small>Fraud caught</small><b>${s.stats.fraudCaught}</b></div>
        <div><small>Final trust</small><b>${s.trust.toFixed(1)}</b></div>
      </div>
      <p class="best">${newBest ? 'New personal best' : `Best: ${money(best.val)} over ${best.days} days`}</p>
      <button class="primary" id="d-new"><span>Start a new firm</span></button>
      <div class="drow">
        <button class="ghost-btn" id="d-daily">Today's tape</button>
        <button class="ghost-btn" id="d-copy">Copy result</button>
      </div>
    </div>`;
  if (J.motionOk()) d.querySelector('.dcard')?.animate([{ transform: 'translateY(40px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'ease-out' });
  $('#d-new').onclick = () => { J.tick(); newGame('random'); };
  $('#d-daily').onclick = () => { J.tick(); newGame('daily'); };
  $('#d-copy').onclick = () => {
    navigator.clipboard?.writeText(share).then(() => flash('Copied'), () => flash(share));
  };
}

function closeOverlays(): void {
  for (const id of ['#payout', '#death', '#info']) $(id).hidden = true;
}

// ------------------------------------------------------------------ boot

function boot(data: { ui?: UiState }): void {
  if (data.ui?.s) {
    ui = data.ui;
    shownCash = ui.s.cash;
    renderAll();
    if (ui.s.phase === 'payout') openPayout();
    if (ui.s.phase === 'dead') showDeath();
  } else {
    newGame('random');
  }
  $('#grid').addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.tile');
    if (t?.dataset.i) onTileClick(Number(t.dataset.i));
  });
  const mute = $('#mute');
  J.setMuted(store<boolean>('muted') ?? false);
  const paintMute = (): void => { mute.textContent = J.isMuted() ? 'Sound off' : 'Sound on'; mute.setAttribute('aria-pressed', String(!J.isMuted())); };
  paintMute();
  mute.onclick = () => { J.unlockAudio(); J.setMuted(!J.isMuted()); store('muted', J.isMuted()); paintMute(); };
  $('#new-run').onclick = () => { if (!busy) newGame('random'); };
}

// Debug hook for screenshots and tests (dev builds and Playwright).
(window as unknown as { __firm: unknown }).__firm = {
  get state() { return ui.s; },
  load(seed: number) { ui = { s: newRun(seed), mode: 'random', firm: firmName(seed), tape: [], bestIncome: 0, selected: null }; shownCash = ui.s.cash; closeOverlays(); renderAll(); },
  set(patch: Partial<GameState>) { ui.s = { ...ui.s, ...patch }; shownCash = ui.s.cash; renderAll(); },
  act(a: Action) { ui.s = step(ui.s, a); shownCash = ui.s.cash; renderAll(); return ui.s.phase; },
  tape(c: Candle[]) { ui.tape = c; renderTape(); },
  openPayout,
  showDeath,
  tap: onTap,
  valuation: () => valuation(ui.s),
};

interface Hot { snapshot?: (fn: () => unknown) => void; ready?: (fn: (data: { ui?: UiState }) => void) => void; data?: { ui?: UiState } }
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
hot?.snapshot?.(() => ({ ui }));
if (hot?.ready) hot.ready(boot); else boot(hot?.data ?? {});
