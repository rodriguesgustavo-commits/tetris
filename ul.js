import { readSetting, writeSetting } from "./storage.js";

const TINT_COLORS = {
  1: ["#22d3ee", "#a5f3fc"],
  2: ["#ff3ea5", "#ffb3d9"],
  3: ["#a3e635", "#e4f9a8"],
  4: ["#fbbf24", "#fde68a"],
  5: ["#a78bfa", "#ddd6fe"],
  6: ["#fb7185", "#fecdd3"],
  7: ["#60a5fa", "#bfdbfe"],
  8: ["#34d399", "#a7f3d0"],
};

const ALL_COLORS = Object.values(TINT_COLORS).flat();

export const formatScore = (value) =>
  Math.max(0, Math.floor(value || 0)).toLocaleString("pt-BR");

/** Builds the little 0/1 block matrix used by the tray, next queue and hold. */
export function createMiniGrid(matrix, tint) {
  const grid = document.createElement("div");
  grid.className = "mini-grid";
  const width = matrix[0]?.length || 1;
  grid.style.gridTemplateColumns = `repeat(${width}, var(--u, 12px))`;
  for (const row of matrix) {
    for (const on of row) {
      const cell = document.createElement("span");
      cell.className = `mini-cell ${on ? `is-on tint-${tint}` : "is-off"}`;
      grid.appendChild(cell);
    }
  }
  return grid;
}

export class UI {
  constructor() {
    const byId = (id) => document.getElementById(id);
    this.boardShell = byId("boardShell");
    this.board = byId("board");
    this.tray = byId("tray");
    this.touchControls = byId("touchControls");
    this.scoreEl = byId("score");
    this.bestEl = byId("best");
    this.comboEl = byId("combo");
    this.linesEl = byId("lines");
    this.levelEl = byId("level");
    this.comboStat = byId("comboStat");
    this.linesStat = byId("linesStat");
    this.levelStat = byId("levelStat");
    this.banner = byId("banner");
    this.overlay = byId("overlay");
    this.overlayEyebrow = byId("overlayEyebrow");
    this.overlayTitle = byId("overlayTitle");
    this.overlayText = byId("overlayText");
    this.overlayBtn = byId("overlayBtn");
    this.overlayRestartBtn = byId("overlayRestartBtn");
    this.toastEl = byId("toast");
    this.toastMsg = byId("toastMsg");
    this.toastAction = byId("toastAction");
    this.modal = byId("modal");
    this.modalClose = byId("modalClose");
    this.nextQueue = byId("nextQueue");
    this.holdSlot = byId("holdSlot");
    this.fx = byId("fx");
    this.fxCtx = this.fx.getContext("2d");
    this.cells = [];
    this.cols = 8;
    this.rows = 8;
    this.particles = [];
    this.fxRaf = null;
    this.lastFxTime = 0;
    this.fxW = 0;
    this.fxH = 0;
    this.toastTimer = null;
    this.bannerTimer = null;
    this.bumpTimers = new WeakMap();

    if ("ResizeObserver" in window) {
      this.resizeObserver = new ResizeObserver(() => this.resizeFx());
      this.resizeObserver.observe(this.boardShell);
    } else {
      window.addEventListener("resize", () => this.resizeFx());
    }
    this.resizeFx();

    this.toastAction.addEventListener("click", () => {
      const handler = this.toastAction._handler;
      this.hideToast();
      if (handler) handler();
    });
  }

  /* ---------------- board ---------------- */

  prepareBoard(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.boardShell.style.setProperty("--cols", cols);
    this.boardShell.style.setProperty("--rows", rows);
    this.board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    this.board.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    const fragment = document.createDocumentFragment();
    this.cells = [];
    for (let i = 0; i < cols * rows; i += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.index = String(i);
      cell.setAttribute("role", "gridcell");
      fragment.appendChild(cell);
      this.cells.push(cell);
    }
    this.board.replaceChildren(fragment);
    this.clearFx();
    requestAnimationFrame(() => this.resizeFx());
  }

  boardMetrics() {
    const rect = this.board.getBoundingClientRect();
    const style = getComputedStyle(this.board);
    const borderX = parseFloat(style.borderLeftWidth) || 0;
    const borderY = parseFloat(style.borderTopWidth) || 0;
    const padX = parseFloat(style.paddingLeft) || 0;
    const padY = parseFloat(style.paddingTop) || 0;
    const gapX = parseFloat(style.columnGap) || 0;
    const gapY = parseFloat(style.rowGap) || 0;
    const cellW = (rect.width - 2 * borderX - 2 * padX - gapX * (this.cols - 1)) / this.cols;
    const cellH = (rect.height - 2 * borderY - 2 * padY - gapY * (this.rows - 1)) / this.rows;
    return {
      rect,
      x0: rect.left + borderX + padX,
      y0: rect.top + borderY + padY,
      gapX,
      gapY,
      cellW,
      cellH,
      pitchX: cellW + gapX,
      pitchY: cellH + gapY,
    };
  }

  cellCenter(index) {
    const cell = this.cells[index];
    if (!cell) return { x: 0, y: 0 };
    const rect = cell.getBoundingClientRect();
    const shell = this.boardShell.getBoundingClientRect();
    return {
      x: rect.left - shell.left + rect.width / 2,
      y: rect.top - shell.top + rect.height / 2,
    };
  }

  /* ---------------- HUD ---------------- */

  bump(el) {
    if (!el) return;
    el.classList.remove("is-bump");
    void el.offsetWidth;
    el.classList.add("is-bump");
    clearTimeout(this.bumpTimers.get(el));
    this.bumpTimers.set(el, setTimeout(() => el.classList.remove("is-bump"), 420));
  }

  setHud(values = {}) {
    if (values.score !== undefined) {
      const text = formatScore(values.score);
      if (this.scoreEl.textContent !== text) {
        this.scoreEl.textContent = text;
        if (values.bumpScore) this.bump(this.scoreEl);
      }
    }
    if (values.best !== undefined) {
      const text = formatScore(values.best);
      if (this.bestEl.textContent !== text) {
        this.bestEl.textContent = text;
        if (values.bumpScore) this.bump(this.bestEl);
      }
    }
    if (values.combo !== undefined && this.comboEl.textContent !== values.combo) {
      this.comboEl.textContent = values.combo;
      if (values.bumpCombo) this.bump(this.comboEl);
    }
    if (values.lines !== undefined) this.linesEl.textContent = String(values.lines);
    if (values.level !== undefined) this.levelEl.textContent = String(values.level);
  }

  /* ---------------- Feedback ---------------- */

  showBanner(text, gold = false) {
    clearTimeout(this.bannerTimer);
    this.banner.textContent = text;
    this.banner.classList.remove("is-show", "is-gold");
    void this.banner.offsetWidth;
    if (gold) this.banner.classList.add("is-gold");
    this.banner.classList.add("is-show");
    this.bannerTimer = setTimeout(() => {
      this.banner.classList.remove("is-show", "is-gold");
    }, 1100);
  }

  floatScore(text, x, y, isCombo = false) {
    const float = document.createElement("span");
    float.className = `float-score${isCombo ? " is-combo" : ""}`;
    float.textContent = text;
    float.style.left = `${x}px`;
    float.style.top = `${y}px`;
    this.boardShell.appendChild(float);
    float.addEventListener("animationend", () => float.remove(), { once: true });
    setTimeout(() => float.remove(), 1300);
  }

  shake() {
    this.boardShell.classList.remove("is-shaking");
    void this.boardShell.offsetWidth;
    this.boardShell.classList.add("is-shaking");
    setTimeout(() => this.boardShell.classList.remove("is-shaking"), 420);
  }

  toast(message, options = {}) {
    const { actionLabel = null, onAction = null, duration = 3800 } = options;
    clearTimeout(this.toastTimer);
    this.toastMsg.textContent = message;
    this.toastAction._handler = onAction;
    if (actionLabel && onAction) {
      this.toastAction.textContent = actionLabel;
      this.toastAction.hidden = false;
    } else {
      this.toastAction.hidden = true;
    }
    this.toastEl.classList.add("is-show");
    this.toastTimer = setTimeout(() => this.hideToast(), duration);
  }

  hideToast() {
    clearTimeout(this.toastTimer);
    this.toastEl.classList.remove("is-show");
    this.toastAction._handler = null;
  }

  showOverlay({ eyebrow = "Tetris Blast", title, text, primaryLabel, onPrimary, secondaryLabel = null, onSecondary = null }) {
    this.overlayEyebrow.textContent = eyebrow;
    this.overlayTitle.textContent = title;
    this.overlayText.textContent = text;
    this.overlayBtn.textContent = primaryLabel || "Continuar";
    this.overlayBtn.onclick = () => onPrimary?.();
    if (secondaryLabel) {
      this.overlayRestartBtn.textContent = secondaryLabel;
      this.overlayRestartBtn.hidden = false;
      this.overlayRestartBtn.onclick = () => onSecondary?.();
    } else {
      this.overlayRestartBtn.hidden = true;
      this.overlayRestartBtn.onclick = null;
    }
    this.overlay.hidden = false;
    setTimeout(() => {
      if (!this.overlay.hidden) this.overlayBtn.focus({ preventScroll: true });
    }, 60);
  }

  hideOverlay() {
    this.overlay.hidden = true;
    this.overlayBtn.onclick = null;
    this.overlayRestartBtn.onclick = null;
  }

  /* ---------------- Particles ---------------- */

  resizeFx() {
    const rect = this.boardShell.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.fxW = rect.width;
    this.fxH = rect.height;
    this.fx.width = Math.round(rect.width * dpr);
    this.fx.height = Math.round(rect.height * dpr);
    this.fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clearFx() {
    if (this.fxRaf) cancelAnimationFrame(this.fxRaf);
    this.fxRaf = null;
    this.particles.length = 0;
    this.fxCtx.clearRect(0, 0, this.fxW, this.fxH);
  }

  spawnParticles({ x, y, color, count = 10, speed = 180, gravity = 620, size = 6, life = 0.8 }) {
    for (let i = 0; i < count; i += 1) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const velocity = speed * (0.5 + Math.random() * 0.8);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        size: size * (0.55 + Math.random() * 0.9),
        color,
        life: life * (0.7 + Math.random() * 0.55),
        maxLife: life,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 12,
        gravity,
      });
    }
    if (!this.fxRaf) {
      this.lastFxTime = performance.now();
      this.fxRaf = requestAnimationFrame((time) => this.runFx(time));
    }
  }

  burstAtCell(index, tint = 1, count = 6) {
    const position = this.cellCenter(index);
    const colors = TINT_COLORS[tint] || ALL_COLORS;
    this.spawnParticles({
      x: position.x,
      y: position.y,
      color: colors[Math.floor(Math.random() * colors.length)],
      count,
      speed: 200,
      size: Math.max(4, Math.min(9, this.cellWApprox() * 0.22)),
      life: 0.72,
    });
  }

  cellWApprox() {
    const metrics = this.boardMetrics();
    return metrics.cellW;
  }

  confetti(count = 70) {
    for (let i = 0; i < count; i += 1) {
      this.spawnParticles({
        x: Math.random() * this.fxW,
        y: -10 - Math.random() * this.fxH * 0.2,
        color: ALL_COLORS[Math.floor(Math.random() * ALL_COLORS.length)],
        count: 1,
        speed: 40,
        gravity: 180,
        size: 5 + Math.random() * 6,
        life: 2 + Math.random(),
      });
    }
  }

  runFx(now) {
    const ctx = this.fxCtx;
    const dt = Math.min((now - this.lastFxTime) / 1000, 0.04);
    this.lastFxTime = now;
    ctx.clearRect(0, 0, this.fxW, this.fxH);

    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
      const alpha = Math.min(1, p.life / (p.maxLife * 0.6));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      const s = p.size;
      const r = Math.min(s * 0.32, 3);
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(-s / 2, -s / 2, s, s * 0.7, r);
      } else {
        ctx.rect(-s / 2, -s / 2, s, s * 0.7);
      }
      ctx.fill();
      ctx.restore();
    }

    if (this.particles.length) {
      this.fxRaf = requestAnimationFrame((time) => this.runFx(time));
    } else {
      this.fxRaf = null;
      ctx.clearRect(0, 0, this.fxW, this.fxH);
    }
  }

  /* ---------------- Misc ---------------- */

  openModal() {
    this.modal.hidden = false;
    document.body.classList.add("is-modal-open");
    setTimeout(() => this.modalClose.focus({ preventScroll: true }), 40);
  }

  closeModal() {
    this.modal.hidden = true;
    document.body.classList.remove("is-modal-open");
  }

  remember(key, value) {
    return readSetting(key, value);
  }

  forget(key, value) {
    writeSetting(key, value);
  }
}
