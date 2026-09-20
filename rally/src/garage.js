// ============================================================================
// The garage: money in, car out.
//
// Every price and every refusal here comes from shared/rally/career.js, which is
// the same code the server runs when it applies the purchase — the client never
// decides anything, it only shows what the rules already say. The buttons that
// cannot be pressed say why.
//
// Repairs come first. While the hull is short, everything else is closed, and
// the panel says so rather than leaving a row of dead buttons.
// ============================================================================

import { summary } from '../../shared/rally/career.js';
import { STATS } from '../../shared/rally/cars.js';

const REASON = {
  'repair-first': 'repair the car first',
  funds: 'not enough money',
  owned: 'already owned',
  maxed: 'fully upgraded',
  'no-damage': 'nothing to repair',
  'not-owned': 'you do not own that',
  unknown: 'no such thing'
};

const STAT_LABEL = { speed: 'Speed', handling: 'Handling', armour: 'Armour' };
const STAT_BLURB = {
  speed: 'top end and how fast it gets there',
  handling: 'grip and steering — the difference between a corner and a wall',
  armour: 'hull, and the weight to shrug off a shunt'
};

export class Garage {
  /**
   * @param root      the element to draw into
   * @param onAction  (action) => void, sends it to the server
   */
  constructor(root, onAction) {
    this.root = root;
    this.onAction = onAction;
    this.notice = '';
    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.disabled) return;
      const { action, stat, weapon, car } = btn.dataset;
      this.notice = '';
      this.onAction({ action, stat, weapon, car });
    });
  }

  /** the server refused something; say why, next to the thing that failed */
  say(reason) { this.notice = REASON[reason] || reason; }

  render(career, careerKey) {
    if (!careerKey) {
      this.root.innerHTML = '<p class="muted">This browser will not let the game store anything, so there is no ' +
        'record to keep. You can still race: every start is a stock Vagabond with a machine gun, and nothing is saved.</p>';
      return;
    }
    if (!career) { this.root.innerHTML = '<p class="muted">Loading your record…</p>'; return; }
    const s = summary(career);
    const hullPct = Math.round(100 * s.hull / s.maxHull);
    const damaged = !s.healthy;

    const parts = [];
    parts.push(`
      <div class="seat"><span class="who"><b>${esc(s.stats.name)}</b></span>
        <span class="money">${s.money.toLocaleString()}</span></div>
      <div class="seat"><span class="who">Hull</span>
        <span class="tag" style="color:${hullPct > 50 ? 'var(--good)' : hullPct > 25 ? 'var(--accent)' : 'var(--bad)'}">
          ${Math.round(s.hull)} / ${s.maxHull} · ${hullPct}%</span></div>
      <div class="seat"><span class="who">${s.races} races · ${s.wins} wins · ${s.seconds} seconds</span>
        <span class="tag">${s.bestLap ? s.bestLap.toFixed(2) + 's best lap' : 'no lap yet'}</span></div>`);

    if (this.notice) parts.push(`<p class="muted" style="color:var(--bad)">${esc(this.notice)}</p>`);

    parts.push('<h2>Repairs</h2>');
    if (damaged) {
      parts.push(`<p class="muted">Damage carries over from the last race, and nothing else is for sale until it is
        put right. Leave it, and the next bullet may be the last one.</p>
        <button class="wide primary" data-action="repair">Repair for ${s.repairCost.toLocaleString()}</button>`);
      if (s.money < s.repairCost) {
        parts.push(`<p class="muted">You have ${s.money.toLocaleString()}. Spend what you have and it buys
          what it buys; the rest can wait for the next prize.</p>`);
      }
    } else parts.push('<p class="muted">The car is straight. Everything is open.</p>');

    parts.push('<h2>Upgrades</h2>');
    parts.push(`<p class="muted">Bought for this car, and they stay with it when you trade it in.</p>`);
    for (const stat of STATS) {
      const u = s.upgrades[stat];
      const pips = '●'.repeat(u.level) + '○'.repeat(u.max - u.level);
      const label = u.price === null ? 'Maxed' : `Upgrade — ${u.price.toLocaleString()}`;
      parts.push(`<div class="seat">
        <span class="who">${STAT_LABEL[stat]} <span class="tag">${pips}</span><span class="blurb">${STAT_BLURB[stat]}</span></span>
        <button data-action="upgrade" data-stat="${stat}" ${u.price === null || damaged || !u.affordable ? 'disabled' : ''}>${label}</button>
      </div>`);
    }
    parts.push(`<div class="seat"><span class="who">Spiked bumper<span class="blurb">triple damage when you ram, half when you are rammed</span></span>
      ${s.bumper ? '<span class="tag">fitted</span>'
        : `<button data-action="buyBumper" ${damaged || s.money < s.bumperPrice ? 'disabled' : ''}>Fit — ${s.bumperPrice.toLocaleString()}</button>`}</div>`);

    parts.push('<h2>Weapons</h2>');
    parts.push('<p class="muted">Bought once and yours for good, whatever you are driving.</p>');
    for (const w of s.weapons) {
      const btn = w.owned
        ? (w.equipped ? '<span class="tag">equipped</span>'
          : `<button data-action="selectWeapon" data-weapon="${w.id}">Equip</button>`)
        : `<button data-action="buyWeapon" data-weapon="${w.id}" ${damaged || !w.affordable ? 'disabled' : ''}>Buy — ${w.price.toLocaleString()}</button>`;
      parts.push(`<div class="seat"><span class="who">${esc(w.name)}<span class="blurb">${esc(w.blurb)}</span></span>${btn}</div>`);
    }

    parts.push('<h2>Cars</h2>');
    parts.push(`<p class="muted">You drive one car. Buying the next one trades this one in for
      ${s.tradeIn.toLocaleString()}, and the new one starts stock.</p>`);
    for (const car of s.cars) {
      // a cheaper car costs nothing because the trade-in covers it, but that is a
      // step down the ladder and the button should say so rather than "Buy — 0"
      const label = car.cost > 0 ? `Buy — ${car.cost.toLocaleString()}` : 'Trade down';
      const btn = car.owned ? '<span class="tag">yours</span>'
        : `<button data-action="buyCar" data-car="${car.id}" ${damaged || !car.affordable ? 'disabled' : ''}>${label}</button>`;
      parts.push(`<div class="seat${car.owned ? ' me' : ''}"><span class="who">${esc(car.name)}<span class="blurb">${esc(car.blurb)}</span></span>${btn}</div>`);
    }

    parts.push('<h2>Transfer code</h2>');
    parts.push(`<p class="muted">This record lives in this browser and nowhere else. Keep this code somewhere
      safe and you can pick the career up on another machine; lose it and the career goes with it.</p>
      <input readonly value="${esc(careerKey)}" onclick="this.select()">`);

    this.root.innerHTML = parts.join('');
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
