// Canvas 2D renderer for Volley. Draws in field coordinates (y up, ground at 0) via a transform.
import {
  FIELD_W, FIELD_H, NET_X, NET_HALF_W, NET_HEIGHT, BALL_R, BLOB_HEIGHT, BLOB_JUMP_V, MAX_TOUCHES, TEAM_NAMES,
} from '../../shared/volley/constants.js';
import { blobCircles } from '../../shared/volley/sim.js';

const GROUND_H = 40; // sand strip below the playing ground
const VIEW_W = FIELD_W;
const VIEW_H = FIELD_H + GROUND_H;

// Squash-and-stretch is purely cosmetic: a spring per blob whose rest length reacts to the
// blob's vertical velocity (taller while rising, flatter while falling) and gets knocked
// downward on landing and ball contact. The simulation and collisions never see it.
const SQUASH = {
  stiffness: 210,   // spring pulling the stretch back to its velocity-driven target
  damping: 15,      // how quickly the wobble settles
  velScale: 0.28,   // how much vertical velocity stretches or squashes the body
  landImpulse: 4.5, // downward kick applied the instant a blob touches the ground
  hitImpulse: 3,    // downward kick applied when a blob strikes the ball
  min: -0.22,       // most it can squash (short and wide)
  max: 0.45,        // most it can stretch (tall and thin)
  widthGive: 0.55,  // how much width shrinks as height grows, for a roughly constant volume
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const TEAM_COLORS = [
  { main: '#3b82f6', dark: '#1d4ed8', light: '#93c5fd' },
  { main: '#ef4444', dark: '#b91c1c', light: '#fca5a5' },
];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.clouds = Array.from({ length: 5 }, (_, i) => ({ x: (i * 197) % FIELD_W, y: 330 + ((i * 53) % 130), s: 0.7 + (i % 3) * 0.25 }));
    this.squash = new Map(); // slot -> spring state for squash-and-stretch
    this.lastTime = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.dpr = dpr;
    this.scale = Math.min(w / VIEW_W, h / VIEW_H);
    this.ox = (w - VIEW_W * this.scale) / 2;
    this.oy = (h - VIEW_H * this.scale) / 2;
  }

  /** Field y (up) to view y (down). */
  fy(y) {
    return FIELD_H - y;
  }

  draw(state, { mySlot = -1, names = [], time = 0, phaseText = '' } = {}) {
    const { ctx } = this;
    const { dpr, scale, ox, oy } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();

    const dt = this.lastTime ? clamp(time - this.lastTime, 0, 1 / 30) : 0;
    this.lastTime = time;

    this.drawBackground(time);
    if (state) {
      this.updateSquash(state, dt);
      this.drawZones(state, mySlot);
      this.drawNet();
      this.drawShadows(state);
      for (const blob of state.blobs) {
        this.drawBlob(blob, names[blob.slot], blob.slot === mySlot, this.stretchOf(blob.slot));
      }
      this.drawBall(state.ball);
      this.drawHud(state, phaseText);
    } else {
      this.drawNet();
    }
    ctx.restore();
  }

  stretchOf(slot) {
    const st = this.squash.get(slot);
    return st ? st.s : 0;
  }

  /** Advance the squash-and-stretch spring for every blob by `dt` seconds. */
  updateSquash(state, dt) {
    const ball = state.ball;
    for (const blob of state.blobs) {
      let st = this.squash.get(blob.slot);
      if (!st) {
        st = { s: 0, v: 0, wasGround: blob.onGround, hitTick: ball.lastHitTick };
        this.squash.set(blob.slot, st);
      }
      if (dt <= 0) continue;
      // landing: the blob just met the ground, so flatten it
      if (blob.onGround && !st.wasGround) st.v -= SQUASH.landImpulse;
      st.wasGround = blob.onGround;
      // ball contact: this blob just struck the ball, so give it a jolt
      if (ball.lastHit === blob.slot && ball.lastHitTick !== st.hitTick) {
        st.v -= SQUASH.hitImpulse;
        st.hitTick = ball.lastHitTick;
      }
      // rise -> stretch tall, fall -> compress; a damped spring chases that target
      const target = clamp((blob.vy || 0) / BLOB_JUMP_V, -1, 1) * SQUASH.velScale;
      st.v += (SQUASH.stiffness * (target - st.s) - SQUASH.damping * st.v) * dt;
      st.s = clamp(st.s + st.v * dt, SQUASH.min, SQUASH.max);
    }
  }

  drawBackground(time) {
    const { ctx } = this;
    const sky = ctx.createLinearGradient(0, 0, 0, FIELD_H);
    sky.addColorStop(0, '#5aa9f0');
    sky.addColorStop(1, '#cfeeff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_W, FIELD_H);

    // sun
    ctx.fillStyle = 'rgba(255, 244, 180, 0.95)';
    ctx.beginPath();
    ctx.arc(690, 90, 42, 0, Math.PI * 2);
    ctx.fill();

    // slow clouds
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const c of this.clouds) {
      const x = ((c.x + time * 8 * c.s) % (FIELD_W + 200)) - 100;
      const y = this.fy(c.y);
      for (const [dx, dy, r] of [[0, 0, 22], [22, -8, 18], [-20, -6, 16], [40, 2, 14]]) {
        ctx.beginPath();
        ctx.arc(x + dx * c.s, y + dy * c.s, r * c.s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // hills
    ctx.fillStyle = '#7cc47f';
    ctx.beginPath();
    ctx.moveTo(0, FIELD_H);
    for (let x = 0; x <= FIELD_W; x += 20) {
      const h = 40 + 30 * Math.sin(x / 90) + 20 * Math.sin(x / 37 + 1);
      ctx.lineTo(x, FIELD_H - h);
    }
    ctx.lineTo(FIELD_W, FIELD_H);
    ctx.closePath();
    ctx.fill();

    // sand
    const sand = ctx.createLinearGradient(0, FIELD_H, 0, VIEW_H);
    sand.addColorStop(0, '#f2d58a');
    sand.addColorStop(1, '#d9b25f');
    ctx.fillStyle = sand;
    ctx.fillRect(0, FIELD_H, VIEW_W, GROUND_H);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, FIELD_H, VIEW_W, 3);
  }

  drawZones(state, mySlot) {
    const { ctx } = this;
    for (const blob of state.blobs) {
      const col = TEAM_COLORS[blob.team];
      const mine = blob.slot === mySlot;
      const x0 = blob.zone.min - 33;
      const x1 = blob.zone.max + 33;
      ctx.fillStyle = mine ? `${col.main}66` : `${col.main}22`;
      ctx.fillRect(x0, FIELD_H + 3, x1 - x0, GROUND_H - 3);
      ctx.strokeStyle = mine ? col.dark : `${col.dark}88`;
      ctx.lineWidth = mine ? 3 : 1.5;
      ctx.strokeRect(x0 + 1, FIELD_H + 6, x1 - x0 - 2, GROUND_H - 12);
    }
  }

  drawNet() {
    const { ctx } = this;
    const top = this.fy(NET_HEIGHT);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(NET_X - NET_HALF_W, top, NET_HALF_W * 2, NET_HEIGHT);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    for (let y = top; y < FIELD_H; y += 12) {
      ctx.beginPath();
      ctx.moveTo(NET_X - NET_HALF_W, y);
      ctx.lineTo(NET_X + NET_HALF_W, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#334155';
    ctx.fillRect(NET_X - NET_HALF_W, top, NET_HALF_W * 2, NET_HEIGHT);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#fff';
    ctx.fillRect(NET_X - 1, top, 2, NET_HEIGHT);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(NET_X, top, NET_HALF_W, 0, Math.PI * 2);
    ctx.fill();
  }

  drawShadows(state) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    const shadow = (x, h, w) => {
      const k = Math.max(0.3, 1 - h / 700);
      ctx.beginPath();
      ctx.ellipse(x, FIELD_H + 6, w * k, 6 * k, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const blob of state.blobs) shadow(blob.x, blob.y, 34);
    shadow(state.ball.x, state.ball.y, BALL_R);
  }

  drawBlob(blob, name, mine, stretch = 0) {
    const { ctx } = this;
    const col = TEAM_COLORS[blob.team];
    const [head, body] = blobCircles(blob);
    // sy > 1 taller, sx < 1 narrower (and the reverse when squashed), anchored at the feet
    const sy = 1 + stretch;
    const sx = Math.max(0.5, 1 - stretch * SQUASH.widthGive);
    // a circle at field height c.y sits (c.y - blob.y) above the feet; scale that gap and its radii
    const place = (c) => ({
      x: c.x,
      cy: this.fy(blob.y + (c.y - blob.y) * sy),
      rx: c.r * sx,
      ry: c.r * sy,
    });
    for (const c of [body, head]) {
      const p = place(c);
      const r = Math.max(p.rx, p.ry);
      const g = ctx.createRadialGradient(p.x - p.rx * 0.35, p.cy - p.ry * 0.35, r * 0.1, p.x, p.cy, r);
      g.addColorStop(0, col.light);
      g.addColorStop(0.6, col.main);
      g.addColorStop(1, col.dark);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.x, p.cy, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // eyes look toward the net, riding the stretched head
    const look = blob.team === 0 ? 1 : -1;
    const hp = place(head);
    for (const side of [-1, 1]) {
      const ex = hp.x + (look * 9 + side * 7) * sx;
      const ey = hp.cy - 4 * sy;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 5.5 * sx, 6.5 * sy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.ellipse(ex + look * 2 * sx, ey + 1 * sy, 2.6 * sx, 2.6 * sy, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // name tag floats just above the (possibly stretched) head
    ctx.font = `${mine ? 'bold ' : ''}13px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const ty = this.fy(blob.y + BLOB_HEIGHT * sy + 8);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText(name || '', blob.x + 1, ty + 1);
    ctx.fillStyle = mine ? '#fde68a' : '#fff';
    ctx.fillText(name || '', blob.x, ty);
    if (mine) {
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.moveTo(blob.x, ty - 20);
      ctx.lineTo(blob.x - 7, ty - 30);
      ctx.lineTo(blob.x + 7, ty - 30);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawBall(ball) {
    const { ctx } = this;
    const cy = this.fy(ball.y);
    ctx.save();
    ctx.translate(ball.x, cy);
    ctx.beginPath();
    ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(-BALL_R, -BALL_R, BALL_R * 2, BALL_R * 2);
    ctx.rotate(-ball.angle);
    ctx.fillStyle = '#d97706';
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 3);
      ctx.fillRect(-BALL_R, -4, BALL_R * 2, 8);
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ball.x, cy, BALL_R - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(ball.x - 8, cy - 8, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  drawHud(state, phaseText) {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText(`${state.score[0]}  :  ${state.score[1]}`, NET_X + 2, 14);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${state.score[0]}  :  ${state.score[1]}`, NET_X, 12);
    ctx.font = 'bold 16px system-ui, sans-serif';
    for (const team of [0, 1]) {
      const x = NET_X + (team === 0 ? -110 : 110);
      ctx.fillStyle = TEAM_COLORS[team].main;
      ctx.fillText(TEAM_NAMES[team].toUpperCase(), x, 24);
      // touch counter
      for (let i = 0; i < MAX_TOUCHES; i++) {
        const used = state.touchTeam === team && state.touches > i;
        ctx.beginPath();
        ctx.arc(x - 14 + i * 14, 52, 5, 0, Math.PI * 2);
        ctx.fillStyle = used ? TEAM_COLORS[team].main : 'rgba(255,255,255,0.35)';
        ctx.fill();
      }
      if (state.serving === team && state.phase !== 'over') {
        ctx.fillStyle = '#fde68a';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText('serving', x, 62);
        ctx.font = 'bold 16px system-ui, sans-serif';
      }
    }
    if (phaseText) {
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(phaseText, NET_X, 84);
    }
  }
}
