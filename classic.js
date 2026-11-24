import { createMiniGrid, formatScore } from "./ui.js";
import { readBest, writeBest } from "./storage.js";

const COLS = 10;
const ROWS = 20;
const LINE_SCORES = [0, 100, 300, 500, 800];

const TETROMINOES = {
  I: { tint: 1, rows: ["....", "XXXX", "....", "...."] },
  O: { tint: 4, rows: ["XX", "XX"] },
  T: { tint: 5, rows: [".X.", "XXX", "..."] },
  S: { tint: 3, rows: [".XX", "XX.", "..."] },
  Z: { tint: 6, rows: ["XX.", ".XX", "..."] },
  J: { tint: 7, rows: ["X..", "XXX", "..."] },
  L: { tint: 2, rows: ["..X", "XXX", "..."] },
};
const TYPES = Object.keys(TETROMINOES);

const toMatrix = (rows) => rows.map((row) => row.split("").map((char) => (char === "X" ? 1 : 0)));

function trimMatrix(matrix) {
  let minRow = ROWS;
  let minCol = COLS;
  let maxRow = -1;
  let maxCol = -1;
  matrix.forEach((row, r) => row.forEach((on, c) => {
    if (!on) return;
    minRow = Math.min(minRow, r);
    maxRow = Math.max(maxRow, r);
    minCol = Math.min(minCol, c);
    maxCol = Math.max(maxCol, c);
  }));
  if (maxRow < 0) return [[1]];
  return matrix.slice(minRow, maxRow + 1).map((row) => row.slice(minCol, maxCol + 1));
}

function rotateCW(matrix) {
  return matrix[0].map((_, col) => matrix.map((row) => row[col]).reverse());
}

const vibrate = (ms) => {
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(ms);
};
const shamble = (items) => {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

export class ClassicGame {
  constructor(ui, sound) {
    this.ui = ui;
    this.sound = sound;
    this.grid = new Uint8Array(COLS * ROWS);
    this.best = readBest("classic");
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.queue = [];
    this.bag = [];
    this.holdType = null;
    this.canHold = true;
    this.active = null;
    this.clearingRows = [];
    this.paused = false;
    this.over = false;
    this.busy = false;
    this.started = false;
    this.activeMode = false;
    this.recordBeaten = false;
    this.raf = null;
    this.lastTime = 0;
    this.acc = 0;
    this.runId = 0;

    this.bindControls();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.activeMode && this.started && !this.over && !this.paused) {
        this.togglePause();
      }
    });
  }

  /* ---------------- lifecycle ---------------- */

  activate() {
    this.activeMode = true;
    this.ui.prepareBoard(COLS, ROWS);
    if (!this.started) {
      this.reset();
      return;
    }
    this.render();
    this.renderQueue();
    this.updateHud();
    if (this.over) {
      this.showGameOver();
    } else {
      this.paused = false;
      this.ui.hideOverlay();
      this.startLoop();
    }
  }

  deactivate() {
    this.activeMode = false;
    this.stopLoop();
    this.paused = true;
  }

  reset() {
    this.runId += 1;
    this.stopLoop();
    this.grid.fill(0);
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.queue = [];
    this.bag = [];
    this.holdType = null;
    this.canHold = true;
    this.active = null;
    this.clearingRows = [];
    this.paused = false;
    this.over = false;
    this.busy = false;
    this.started = true;
    this.recordBeaten = false;
    this.acc = 0;
    this.ui.hideOverlay();
    this.fillQueue();
    this.spawn();
    this.renderQueue();
    this.updateHud();
    this.startLoop();
  }

  startLoop() {
    if (this.raf || !this.activeMode) return;
    this.lastTime = performance.now();
    this.acc = 0;
    const loop = (now) => {
      this.raf = requestAnimationFrame(loop);
      if (!this.activeMode || this.paused || this.over || this.busy || !this.active) {
        this.lastTime = now;
        return;
      }
      const delta = Math.min(now - this.lastTime, 120);
      this.lastTime = now;
      this.acc += delta;
      if (this.acc >= this.dropInterval()) {
        this.acc = 0;
        this.stepDown();
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  dropInterval() {
    return Math.max(90, 800 * Math.pow(0.85, this.level - 1));
  }

  /* ---------------- pieces ---------------- */

  fillQueue() {
    while (this.queue.length < 5) {
      if (!this.bag.length) this.bag = shamble(TYPES);
      this.queue.push(this.bag.shift());
    }
  }

  makeActive(type) {
    const definition = TETROMINOES[type];
    const matrix = toMatrix(definition.rows);
    return {
      type,
      matrix,
      x: Math.floor((COLS - matrix[0].length) / 2),
      y: 0,
      tint: definition.tint,
    };
  }

  spawn() {
    this.fillQueue();
    const type = this.queue.shift();
    this.fillQueue();
    this.active = this.makeActive(type);
    this.canHold = true;
    this.acc = 0;
    if (this.collides(this.active.matrix, this.active.x, this.active.y)) {
      this.active = null;
      this.gameOver();
      return;
    }
    this.render();
    this.renderQueue();
    this.updateHud();
  }

  collides(matrix, x, y) {
    for (let r = 0; r < matrix.length; r += 1) {
      for (let c = 0; c < matrix[r].length; c += 1) {
        if (!matrix[r][c]) continue;
        const gx = x + c;
        const gy = y + r;
        if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
        if (gy >= 0 && this.grid[gy * COLS + gx]) return true;
      }
    }
    return false;
  }

  move(dx) {
    if (!this.isPlayable()) return false;
    if (this.collides(this.active.matrix, this.active.x + dx, this.active.y)) return false;
    this.active.x += dx;
    this.acc = 0;
    this.render();
    this.sound.move();
    return true;
  }

  rotate(direction = 1) {
    if (!this.isPlayable()) return false;
    let matrix = this.active.matrix;
    const turns = direction > 0 ? 1 : 3;
    for (let i = 0; i < turns; i += 1) matrix = rotateCW(matrix);
    const kicks = [
      [0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1],
    ];
    for (const [dx, dy] of kicks) {
      const x = this.active.x + dx;
      const y = this.active.y + dy;
      if (!this.collides(matrix, x, y)) {
        this.active.matrix = matrix;
        this.active.x = x;
        this.active.y = y;
        this.acc = 0;
        this.render();
        this.sound.rotate();
        return true;
      }
    }
    return false;
  }

  stepDown() {
    if (!this.isPlayable()) return;
    if (this.collides(this.active.matrix, this.active.x, this.active.y + 1)) {
      this.lock();
      return;
    }
    this.active.y += 1;
    this.render();
  }

  softDrop() {
    if (!this.isPlayable()) return;
    if (this.collides(this.active.matrix, this.active.x, this.active.y + 1)) {
      this.lock();
      return;
    }
    this.active.y += 1;
    this.score += 1;
    this.acc = 0;
    this.saveBest();
    this.updateHud();
    this.render();
  }

  hardDrop() {
    if (!this.isPlayable()) return;
    let distance = 0;
    while (!this.collides(this.active.matrix, this.active.x, this.active.y + 1)) {
      this.active.y += 1;
      distance += 1;
    }
    if (distance > 0) {
      this.score += distance * 2;
      this.saveBest();
      this.updateHud({ bumpScore: true });
    }
    this.sound.drop();
    vibrate(12);
    this.lock();
  }

  hold() {
    if (!this.isPlayable() || !this.canHold) return;
    const currentType = this.active.type;
    if (this.holdType) {
      const swap = this.holdType;
      this.holdType = currentType;
      this.active = this.makeActive(swap);
      if (this.collides(this.active.matrix, this.active.x, this.active.y)) {
        this.active = null;
        this.gameOver();
        return;
      }
    } else {
      this.holdType = currentType;
      this.fillQueue();
      this.active = this.makeActive(this.queue.shift());
      if (this.collides(this.active.matrix, this.active.x, this.active.y)) {
        this.active = null;
        this.gameOver();
        return;
      }
    }
    this.canHold = false;
    this.acc = 0;
    this.sound.hold();
    this.render();
    this.renderQueue();
  }

  isPlayable() {
    return this.activeMode && !this.paused && !this.over && !this.busy && Boolean(this.active);
  }

  /* ---------------- locking / lines ---------------- */

  lock() {
    if (!this.active) return;
    const piece = this.active;
    this.active = null;
    this.busy = true;
    const token = this.runId;
    let lockedAbove = false;

    for (let r = 0; r < piece.matrix.length; r += 1) {
      for (let c = 0; c < piece.matrix[r].length; c += 1) {
        if (!piece.matrix[r][c]) continue;
        const gy = piece.y + r;
        const gx = piece.x + c;
        if (gy < 0) {
          lockedAbove = true;
          continue;
        }
        this.grid[gy * COLS + gx] = piece.tint;
      }
    }

    if (lockedAbove) {
      this.busy = false;
      this.render();
      this.gameOver();
      return;
    }

    const fullRows = [];
    for (let r = 0; r < ROWS; r += 1) {
      if (Array.from({ length: COLS }, (_, c) => this.grid[r * COLS + c]).every(Boolean)) fullRows.push(r);
    }

    if (!fullRows.length) {
      this.render();
      this.busy = false;
      this.spawn();
      return;
    }

    const count = fullRows.length;
    this.clearingRows = fullRows;
    this.render();
    let centerY = 0;
    for (const r of fullRows) {
      for (let c = 0; c < COLS; c += 1) {
        const index = r * COLS + c;
        this.ui.cells[index].classList.add("is-clearing");
        this.ui.burstAtCell(index, this.grid[index], 2);
        centerY += this.ui.cellCenter(index).y;
      }
    }
    centerY /= count * COLS;

    const previousLevel = this.level;
    const gain = LINE_SCORES[Math.min(count, 4)] * this.level;
    this.score += gain;
    this.lines += count;
    this.level = 1 + Math.floor(this.lines / 10);
    this.saveBest();
    this.updateHud({ bumpScore: true });
    this.sound.clear(count);
    vibrate(count >= 3 ? 30 : 14);
    if (count >= 3) this.ui.shake();
    this.ui.showBanner(count === 4 ? "TETRIS!" : count === 3 ? "TRIPLA!" : count === 2 ? "DUPLA!" : "LINHA!", count === 4);
    const shell = this.ui.boardShell.getBoundingClientRect();
    this.ui.floatScore(`+${formatScore(gain)}`, shell.width / 2, centerY);
    if (this.level > previousLevel) {
      this.sound.levelUp();
      this.ui.toast(`Nível ${this.level}! A peça cai mais rápido.`);
    }

    setTimeout(() => {
      if (token !== this.runId) return;
      this.clearingRows = [];
      this.collapseRows(fullRows);
      this.render();
      this.busy = false;
      this.spawn();
    }, 300);
  }

  collapseRows(fullRows) {
    const full = new Set(fullRows);
    const kept = [];
    for (let r = 0; r < ROWS; r += 1) {
      if (!full.has(r)) kept.push(Array.from(this.grid.slice(r * COLS, (r + 1) * COLS)));
    }
    while (kept.length < ROWS) kept.unshift(new Array(COLS).fill(0));
    const flat = new Uint8Array(ROWS * COLS);
    kept.forEach((row, r) => row.forEach((value, c) => {
      flat[r * COLS + c] = value;
    }));
    this.grid = flat;
  }

  /* ---------------- rendering ---------------- */

  render() {
    const cells = this.ui.cells;
    for (let i = 0; i < cells.length; i += 1) {
      cells[i].className = "cell";
      const value = this.grid[i];
      if (value) cells[i].classList.add("is-filled", `tint-${value}`);
    }
    if (this.active && !this.over) {
      const { matrix, x, y, tint } = this.active;
      const activeIndices = new Set();
      const ghostCells = [];
      const activeCells = [];
      for (let r = 0; r < matrix.length; r += 1) {
        for (let c = 0; c < matrix[r].length; c += 1) {
          if (!matrix[r][c]) continue;
          activeCells.push([x + c, y + r]);
        }
      }
      for (const [gx, gy] of activeCells) {
        if (gy >= 0 && gy < ROWS && gx >= 0 && gx < COLS) activeIndices.add(gy * COLS + gx);
      }
      let ghostY = y;
      while (!this.collides(matrix, x, ghostY + 1)) ghostY += 1;
      if (ghostY !== y) {
        for (let r = 0; r < matrix.length; r += 1) {
          for (let c = 0; c < matrix[r].length; c += 1) {
            if (!matrix[r][c]) continue;
            const gx = x + c;
            const gy = ghostY + r;
            if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) continue;
            const index = gy * COLS + gx;
            if (!activeIndices.has(index)) ghostCells.push(index);
          }
        }
      }
      for (const index of ghostCells) cells[index].classList.add("is-ghost", `tint-${tint}`);
      for (const index of activeIndices) cells[index].classList.add("is-active", `tint-${tint}`);
    }
    if (this.clearingRows.length) {
      for (const r of this.clearingRows) {
        for (let c = 0; c < COLS; c += 1) cells[r * COLS + c].classList.add("is-clearing");
      }
    }
  }

  renderQueue() {
    this.fillQueue();
    const fragment = document.createDocumentFragment();
    for (const type of this.queue.slice(0, 3)) {
      fragment.appendChild(createMiniGrid(trimMatrix(toMatrix(TETROMINOES[type].rows)), TETROMINOES[type].tint));
    }
    this.ui.nextQueue.replaceChildren(fragment);
    if (this.holdType) {
      this.ui.holdSlot.replaceChildren(
        createMiniGrid(trimMatrix(toMatrix(TETROMINOES[this.holdType].rows)), TETROMINOES[this.holdType].tint),
      );
      this.ui.holdSlot.classList.toggle("is-empty", !this.canHold);
    } else {
      this.ui.holdSlot.innerHTML = '<span class="hold-slot__empty">C</span>';
      this.ui.holdSlot.classList.remove("is-empty");
    }
  }

  /* ---------------- input ---------------- */

  bindControls() {
    for (const button of this.ui.touchControls.querySelectorAll(".ctrl")) {
      const action = button.dataset.action;
      let repeatTimer = null;
      let startTimer = null;
      const fire = () => this.action(action);
      const stop = () => {
        clearTimeout(startTimer);
        clearInterval(repeatTimer);
        startTimer = null;
        repeatTimer = null;
        button.classList.remove("is-pressed");
      };
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        button.classList.add("is-pressed");
        this.sound.ensure();
        fire();
        if (["left", "right", "down"].includes(action)) {
          startTimer = setTimeout(() => {
            repeatTimer = setInterval(fire, action === "down" ? 45 : 75);
          }, 230);
        }
      });
      button.addEventListener("pointerup", stop);
      button.addEventListener("pointercancel", stop);
      button.addEventListener("lostpointercapture", stop);
      button.addEventListener("contextmenu", (event) => event.preventDefault());
    }
  }

  action(name) {
    if (!this.isPlayable()) return;
    switch (name) {
      case "left": this.move(-1); break;
      case "right": this.move(1); break;
      case "rotate": this.rotate(1); break;
      case "down": this.softDrop(); break;
      case "drop": this.hardDrop(); break;
      case "hold": this.hold(); break;
      default: break;
    }
  }

  togglePause() {
    if (!this.started || this.over || this.busy) return;
    this.paused = !this.paused;
    this.sound.click();
    if (!this.paused) {
      this.ui.hideOverlay();
      this.startLoop();
      return;
    }
    this.ui.showOverlay({
      eyebrow: "Tetris clássico",
      title: "Pausado",
      text: "Respire fundo. O tabuleiro espera por você.",
      primaryLabel: "Continuar",
      onPrimary: () => this.togglePause(),
      secondaryLabel: "Recomeçar",
      onSecondary: () => this.reset(),
    });
  }

  handleKey(event) {
    if (!this.activeMode) return false;
    const key = event.key;
    if (key === "p" || key === "P" || key === "Escape") {
      this.togglePause();
      return true;
    }
    if (this.over) {
      if (key === "Enter" || key === " ") {
        this.reset();
        return true;
      }
      return false;
    }
    if (!this.isPlayable()) return false;
    switch (key) {
      case "ArrowLeft": this.move(-1); return true;
      case "ArrowRight": this.move(1); return true;
      case "ArrowDown": this.softDrop(); return true;
      case "ArrowUp":
      case "x":
      case "X":
        if (!event.repeat) this.rotate(1);
        return true;
      case "z":
      case "Z":
        if (!event.repeat) this.rotate(-1);
        return true;
      case " ":
        if (!event.repeat) this.hardDrop();
        return true;
      case "c":
      case "C":
      case "Shift":
        if (!event.repeat) this.hold();
        return true;
      default: return false;
    }
  }

  /* ---------------- end state ---------------- */

  saveBest() {
    if (this.score > this.best) {
      this.best = this.score;
      this.recordBeaten = true;
      writeBest("classic", this.best);
    }
  }

  updateHud(options = {}) {
    this.ui.setHud({
      score: this.score,
      best: this.best,
      lines: this.lines,
      level: this.level,
      bumpScore: options.bumpScore,
    });
  }

  showGameOver() {
    this.ui.showOverlay({
      eyebrow: "Tetris clássico",
      title: this.recordBeaten ? "Novo recorde!" : "Fim de jogo",
      text: `${formatScore(this.score)} pontos • ${this.lines} linhas • nível ${this.level}.`,
      primaryLabel: "Jogar de novo",
      onPrimary: () => this.reset(),
    });
  }

  gameOver() {
    if (this.over) return;
    this.over = true;
    this.paused = false;
    this.busy = false;
    this.active = null;
    this.clearingRows = [];
    this.saveBest();
    this.render();
    this.updateHud();
    this.sound.gameOver();
    vibrate(60);
    if (this.recordBeaten) this.ui.confetti(80);
    this.showGameOver();
  }
}