import { createMiniGrid, formatScore } from "./ui.js";
import { readBest, writeBest } from "./storage.js";

const COLS = 8;
const ROWS = 8;

const SHAPE_ROWS = [
  { rows: ["X"], weight: 3 },
  { rows: ["XX"], weight: 4 },
  { rows: ["X", "X"], weight: 4 },
  { rows: ["XXX"], weight: 4 },
  { rows: ["X", "X", "X"], weight: 4 },
  { rows: ["XXXX"], weight: 2 },
  { rows: ["X", "X", "X", "X"], weight: 2 },
  { rows: ["XX", "XX"], weight: 4 },
  { rows: ["XXX", "XXX"], weight: 1 },
  { rows: ["XX", "XX", "XX"], weight: 1 },
  { rows: ["XXX", "XXX", "XXX"], weight: 1 },
  { rows: ["XXX", "X.."], weight: 3 },
  { rows: ["XXX", "..X"], weight: 3 },
  { rows: ["X..", "XXX"], weight: 3 },
  { rows: ["..X", "XXX"], weight: 3 },
  { rows: ["XXX", "X..", "X.."], weight: 2 },
  { rows: ["XXX", "..X", "..X"], weight: 2 },
  { rows: ["X..", "X..", "XXX"], weight: 2 },
  { rows: ["..X", "..X", "XXX"], weight: 2 },
  { rows: ["XX", "X."], weight: 3 },
  { rows: ["XX", ".X"], weight: 3 },
  { rows: ["X.", "XX"], weight: 3 },
  { rows: [".X", "XX"], weight: 3 },
  { rows: ["XXX", ".X."], weight: 2 },
  { rows: [".X.", "XXX"], weight: 2 },
  { rows: ["X.", "XX", "X."], weight: 2 },
  { rows: [".X", "XX", ".X"], weight: 2 },
  { rows: ["X.X", "XXX"], weight: 2 },
  { rows: ["XX", "X.", "X."], weight: 2 },
  { rows: ["XX", ".X", ".X"], weight: 2 },
  { rows: ["XXX", "X.X"], weight: 1 },
  { rows: ["XXX", "X..", "X.X"], weight: 1 },
];

const SHAPES = SHAPE_ROWS.map((entry, id) => {
  const matrix = entry.rows.map((row) => row.split("").map((char) => (char === "X" ? 1 : 0)));
  const cells = [];
  matrix.forEach((row, r) => row.forEach((on, c) => {
    if (on) cells.push([r, c]);
  }));
  return {
    id,
    matrix,
    w: matrix[0].length,
    h: matrix.length,
    cells,
    size: cells.length,
    weight: entry.weight,
  };
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const vibrate = (ms) => {
  if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(ms);
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class BlastGame {
  constructor(ui, sound) {
    this.ui = ui;
    this.sound = sound;
    this.grid = new Uint8Array(COLS * ROWS);
    this.pieces = [];
    this.best = readBest("blast");
    this.score = 0;
    this.lines = 0;
    this.combo = 0;
    this.nextId = 1;
    this.busy = false;
    this.over = false;
    this.started = false;
    this.recordBeaten = false;
    this.selectedId = null;
    this.cursor = null;
    this.preview = null;
    this.pending = null;
    this.drag = null;
    this.runId = 0;

    this.ui.tray.addEventListener("pointerdown", (event) => this.onTrayPointerDown(event));
    this.ui.tray.addEventListener("keydown", (event) => this.onTrayKeyDown(event));
    document.addEventListener("pointermove", (event) => this.onPointerMove(event), { passive: false });
    document.addEventListener("pointerup", (event) => this.onPointerUp(event));
    document.addEventListener("pointercancel", () => this.cancelInteraction());
    this.ui.tray.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  /* ---------------- lifecycle ---------------- */

  activate() {
    this.ui.prepareBoard(COLS, ROWS);
    if (!this.started) {
      this.reset();
      return;
    }
    this.render();
    this.updateTrayState();
    this.updateHud();
    if (this.over) this.showGameOver();
    else this.ui.hideOverlay();
  }

  deactivate() {
    this.cancelInteraction();
    this.clearPreview();
  }

  reset() {
    this.runId += 1;
    if (this.drag || this.pending) this.cancelInteraction();
    this.grid.fill(0);
    this.score = 0;
    this.lines = 0;
    this.combo = 0;
    this.pieces = [];
    this.selectedId = null;
    this.cursor = null;
    this.busy = false;
    this.over = false;
    this.started = true;
    this.recordBeaten = false;
    this.ui.hideOverlay();
    this.newTray();
    this.render();
    this.updateHud();
  }

  /* ---------------- pieces ---------------- */

  randomShape(occupancy) {
    const weighted = [];
    let total = 0;
    for (const shape of SHAPES) {
      let weight = shape.weight;
      const area = shape.w * shape.h;
      if (occupancy > 0.5 && area >= 9) weight *= 0.35;
      else if (occupancy > 0.66 && area >= 6) weight *= 0.6;
      weighted.push([shape, weight]);
      total += weight;
    }
    let roll = Math.random() * total;
    for (const [shape, weight] of weighted) {
      roll -= weight;
      if (roll <= 0) return shape;
    }
    return SHAPES[0];
  }

  makePiece(shape) {
    return {
      id: this.nextId++,
      shape,
      tint: 1 + Math.floor(Math.random() * 8),
      used: false,
      w: shape.w,
      h: shape.h,
    };
  }

  rollTray(occupancy) {
    return [this.makePiece(this.randomShape(occupancy)), this.makePiece(this.randomShape(occupancy)), this.makePiece(this.randomShape(occupancy))];
  }

  newTray() {
    const filled = this.grid.reduce((sum, value) => sum + (value ? 1 : 0), 0);
    const occupancy = filled / this.grid.length;
    let candidates = this.rollTray(occupancy);
    let attempts = 0;
    while (!candidates.some((piece) => this.findAnyPlacement(piece)) && attempts < 60) {
      candidates = this.rollTray(occupancy);
      attempts += 1;
    }
    if (!candidates.some((piece) => this.findAnyPlacement(piece))) {
      const dotShape = SHAPES.find((shape) => shape.size === 1);
      const dot = this.makePiece(dotShape);
      if (this.findAnyPlacement(dot)) candidates[0] = dot;
    }
    this.pieces = candidates;
    this.selectedId = null;
    this.cursor = null;
    this.renderTray();
  }

  getPiece(id) {
    return this.pieces.find((piece) => piece.id === id) || null;
  }

  selectedPiece() {
    return this.selectedId === null ? null : this.getPiece(this.selectedId);
  }

  canPlace(piece, row, col) {
    if (row < 0 || col < 0 || row + piece.h > ROWS || col + piece.w > COLS) return false;
    for (const [dr, dc] of piece.shape.cells) {
      if (this.grid[(row + dr) * COLS + (col + dc)]) return false;
    }
    return true;
  }

  findAnyPlacement(piece) {
    for (let row = ROWS - piece.h; row >= 0; row -= 1) {
      for (let col = 0; col <= COLS - piece.w; col += 1) {
        if (this.canPlace(piece, row, col)) return { row, col };
      }
    }
    return null;
  }

  hasMoves() {
    return this.pieces.some((piece) => !piece.used && this.findAnyPlacement(piece));
  }

  /* ---------------- rendering ---------------- */

  render() {
    const cells = this.ui.cells;
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      cell.className = "cell";
      const value = this.grid[i];
      if (value) cell.classList.add("is-filled", `tint-${value}`);
    }
  }

  updatePreview(preview) {
    this.render();
    this.preview = preview;
    if (!preview) return;
    for (const index of preview.cells) {
      const cell = this.ui.cells[index];
      if (!cell) continue;
      if (preview.valid) cell.classList.add("is-preview", `tint-${preview.tint}`);
      else cell.classList.add("is-bad");
    }
    if (preview.valid) {
      for (const index of preview.willClear) {
        this.ui.cells[index]?.classList.add("is-willclear");
      }
    }
  }

  clearPreview() {
    if (!this.preview) return;
    this.preview = null;
    this.render();
  }

  buildPreview(piece, row, col) {
    const cells = [];
    for (const [dr, dc] of piece.shape.cells) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) cells.push(r * COLS + c);
    }
    const valid = this.canPlace(piece, row, col);
    const willClear = new Set();
    if (valid) {
      const copy = this.grid.slice();
      for (const index of cells) copy[index] = piece.tint;
      for (let r = 0; r < ROWS; r += 1) {
        if (Array.from({ length: COLS }, (_, c) => copy[r * COLS + c]).every(Boolean)) {
          for (let c = 0; c < COLS; c += 1) willClear.add(r * COLS + c);
        }
      }
      for (let c = 0; c < COLS; c += 1) {
        if (Array.from({ length: ROWS }, (_, r) => copy[r * COLS + c]).every(Boolean)) {
          for (let r = 0; r < ROWS; r += 1) willClear.add(r * COLS + c);
        }
      }
    }
    return { pieceId: piece.id, tint: piece.tint, row, col, cells, valid, willClear };
  }

  renderTray() {
    const fragment = document.createDocumentFragment();
    for (const piece of this.pieces) {
      const slot = document.createElement("div");
      slot.className = "tray-slot is-hoverable";
      slot.dataset.id = String(piece.id);
      if (piece.used) slot.classList.add("is-used");
      if (this.selectedId === piece.id) slot.classList.add("is-selected");

      const pieceEl = document.createElement("div");
      pieceEl.className = "piece";
      pieceEl.dataset.id = String(piece.id);
      pieceEl.tabIndex = piece.used ? -1 : 0;
      pieceEl.setAttribute("role", "button");
      pieceEl.setAttribute("aria-label", `Peça de ${piece.shape.size} blocos`);
      pieceEl.appendChild(createMiniGrid(piece.shape.matrix, piece.tint));
      slot.appendChild(pieceEl);
      fragment.appendChild(slot);
    }
    this.ui.tray.replaceChildren(fragment);
  }

  updateTrayState() {
    for (const slot of this.ui.tray.querySelectorAll(".tray-slot")) {
      const piece = this.getPiece(Number(slot.dataset.id));
      if (!piece) continue;
      slot.classList.toggle("is-used", piece.used);
      slot.classList.toggle("is-selected", piece.id === this.selectedId);
      const pieceEl = slot.querySelector(".piece");
      if (pieceEl) {
        pieceEl.tabIndex = piece.used ? -1 : 0;
        pieceEl.setAttribute("aria-disabled", piece.used ? "true" : "false");
      }
    }
  }

  /* ---------------- input ---------------- */

  onTrayPointerDown(event) {
    if (this.busy || this.over) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const pieceEl = event.target.closest(".piece");
    if (!pieceEl) return;
    const piece = this.getPiece(Number(pieceEl.dataset.id));
    if (!piece || piece.used) return;
    event.preventDefault();
    this.pending = {
      piece,
      pieceEl,
      slot: pieceEl.closest(".tray-slot"),
      startX: event.clientX,
      startY: event.clientY,
      pointerType: event.pointerType || "mouse",
    };
  }

  onTrayKeyDown(event) {
    const pieceEl = event.target.closest(".piece");
    if (!pieceEl || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    const piece = this.getPiece(Number(pieceEl.dataset.id));
    if (piece && !piece.used) this.selectPiece(piece);
  }

  onPointerMove(event) {
    if (!this.pending) return;
    if (!this.drag) {
      const distance = Math.hypot(event.clientX - this.pending.startX, event.clientY - this.pending.startY);
      if (distance < 7) return;
      this.beginDrag();
    }
    event.preventDefault();
    this.updateDrag(event);
  }

  onPointerUp() {
    if (!this.pending) return;
    const { piece } = this.pending;
    if (this.drag) {
      const target = this.drag.target;
      if (target && target.row !== null && this.canPlace(piece, target.row, target.col)) {
        this.finishDrag(true);
        this.pending = null;
        this.drag = null;
        this.place(piece, target.row, target.col);
        return;
      }
      this.finishDrag(false);
      this.pending = null;
      this.drag = null;
      this.clearPreview();
      this.sound.invalid();
      this.pending.slot?.classList.add("is-denied");
      setTimeout(() => this.pending?.slot?.classList.remove("is-denied"), 340);
      return;
    }
    this.pending = null;
    if (!this.busy && !this.over) this.selectPiece(piece);
  }

  cancelInteraction() {
    if (this.drag) this.finishDrag(false);
    this.pending = null;
    this.drag = null;
    this.clearPreview();
  }

  beginDrag() {
    const { piece, pieceEl, slot, pointerType } = this.pending;
    const metrics = this.ui.boardMetrics();
    const cell = metrics.cellW;
    const gap = metrics.gapX;
    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.style.gridTemplateColumns = `repeat(${piece.w}, ${cell}px)`;
    ghost.style.gridAutoRows = `${cell}px`;
    ghost.style.gap = `${gap}px`;
    for (let r = 0; r < piece.h; r += 1) {
      for (let c = 0; c < piece.w; c += 1) {
        const on = piece.shape.matrix[r][c] === 1;
        const block = document.createElement("span");
        block.className = `ghost-cell ${on ? `is-on tint-${piece.tint}` : "is-off"}`;
        ghost.appendChild(block);
      }
    }
    const width = piece.w * cell + (piece.w - 1) * gap;
    const height = piece.h * cell + (piece.h - 1) * gap;
    ghost.style.width = `${width}px`;
    ghost.style.height = `${height}px`;
    document.body.appendChild(ghost);
    pieceEl.style.opacity = "0.22";
    slot.classList.add("is-dragging");
    this.selectedId = null;
    this.cursor = null;
    this.updateTrayState();
    this.clearPreview();
    this.drag = { piece, pieceEl, slot, pointerType, ghost, ghostW: width, ghostH: height, target: null };
  }

  finishDrag(accepted) {
    if (!this.drag) return;
    const { ghost, pieceEl, slot } = this.drag;
    pieceEl.style.opacity = "";
    slot.classList.remove("is-dragging");
    if (accepted) {
      ghost.remove();
    } else {
      ghost.style.transition = "opacity .16s ease, transform .16s ease";
      ghost.style.opacity = "0";
      ghost.style.transform = "scale(.9)";
      setTimeout(() => ghost.remove(), 180);
    }
  }

  updateDrag(event) {
    if (!this.drag) return;
    const { piece, ghost, pointerType, ghostW, ghostH } = this.drag;
    const metrics = this.ui.boardMetrics();
    const left = event.clientX - ghostW / 2;
    const top = pointerType === "touch"
      ? event.clientY - ghostH - metrics.cellH * 0.75
      : event.clientY - ghostH / 2;
    ghost.style.left = `${left}px`;
    ghost.style.top = `${top}px`;

    const colRaw = Math.round((left - metrics.x0) / metrics.pitchX);
    const rowRaw = Math.round((top - metrics.y0) / metrics.pitchY);
    const outside = rowRaw > ROWS - 1 || colRaw > COLS - 1 || rowRaw + piece.h <= 0 || colRaw + piece.w <= 0;
    if (outside) {
      this.drag.target = null;
      this.clearPreview();
      ghost.classList.add("is-invalid");
      return;
    }
    const row = clamp(rowRaw, 0, ROWS - piece.h);
    const col = clamp(colRaw, 0, COLS - piece.w);
    this.drag.target = { row, col };
    const preview = this.buildPreview(piece, row, col);
    this.updatePreview(preview);
    ghost.classList.toggle("is-invalid", !preview.valid);
  }

  selectPiece(piece) {
    if (this.busy || this.over || piece.used) return;
    if (this.selectedId === piece.id) {
      this.deselect();
      return;
    }
    const spot = this.findAnyPlacement(piece);
    if (!spot) {
      this.deny(piece);
      return;
    }
    this.selectedId = piece.id;
    this.cursor = spot;
    this.updateTrayState();
    this.updatePreview(this.buildPreview(piece, spot.row, spot.col));
    this.sound.click();
  }

  deselect() {
    this.selectedId = null;
    this.cursor = null;
    this.clearPreview();
    this.updateTrayState();
  }

  deny(piece) {
    this.sound.invalid();
    const slot = this.ui.tray.querySelector(`.tray-slot[data-id="${piece.id}"]`);
    slot?.classList.add("is-denied");
    setTimeout(() => slot?.classList.remove("is-denied"), 340);
  }

  moveCursor(dx, dy) {
    const piece = this.selectedPiece();
    if (!piece || !this.cursor) return false;
    const row = clamp(this.cursor.row + dy, 0, ROWS - piece.h);
    const col = clamp(this.cursor.col + dx, 0, COLS - piece.w);
    this.cursor = { row, col };
    this.updatePreview(this.buildPreview(piece, row, col));
    return true;
  }

  placeSelected() {
    const piece = this.selectedPiece();
    if (!piece || !this.cursor) return;
    if (this.canPlace(piece, this.cursor.row, this.cursor.col)) {
      this.place(piece, this.cursor.row, this.cursor.col);
    } else {
      this.sound.invalid();
      this.ui.shake();
      this.ui.toast("Essa peça não cabe aí.");
    }
  }

  handleKey(event) {
    if (this.over) {
      if (event.key === "Enter" || event.key === " ") {
        this.reset();
        return true;
      }
      return false;
    }
    if (this.busy) return false;
    if (event.key === "Escape" && this.selectedId !== null) {
      this.deselect();
      return true;
    }
    if (this.selectedId === null) return false;
    switch (event.key) {
      case "ArrowLeft": return this.moveCursor(-1, 0);
      case "ArrowRight": return this.moveCursor(1, 0);
      case "ArrowUp": return this.moveCursor(0, -1);
      case "ArrowDown": return this.moveCursor(0, 1);
      case "Enter":
      case " ":
        this.placeSelected();
        return true;
      default:
        return false;
    }
  }

  /* ---------------- placing & scoring ---------------- */

  async place(piece, row, col) {
    if (this.busy || this.over || !this.canPlace(piece, row, col)) return;
    const token = this.runId;
    this.busy = true;
    this.selectedId = null;
    this.cursor = null;
    this.clearPreview();

    const placed = [];
    for (const [dr, dc] of piece.shape.cells) {
      const index = (row + dr) * COLS + (col + dc);
      this.grid[index] = piece.tint;
      placed.push(index);
    }
    piece.used = true;
    this.score += piece.shape.size;
    this.sound.place();
    vibrate(9);
    this.render();
    for (const index of placed) this.ui.cells[index].classList.add("is-pop");
    setTimeout(() => placed.forEach((index) => this.ui.cells[index]?.classList.remove("is-pop")), 320);
    this.updateTrayState();

    const fullRows = [];
    const fullCols = [];
    for (let r = 0; r < ROWS; r += 1) {
      if (Array.from({ length: COLS }, (_, c) => this.grid[r * COLS + c]).every(Boolean)) fullRows.push(r);
    }
    for (let c = 0; c < COLS; c += 1) {
      if (Array.from({ length: ROWS }, (_, r) => this.grid[r * COLS + c]).every(Boolean)) fullCols.push(c);
    }

    if (fullRows.length || fullCols.length) {
      const lines = fullRows.length + fullCols.length;
      const clearSet = new Set();
      for (const r of fullRows) for (let c = 0; c < COLS; c += 1) clearSet.add(r * COLS + c);
      for (const c of fullCols) for (let r = 0; r < ROWS; r += 1) clearSet.add(r * COLS + c);

      this.combo += 1;
      this.lines += lines;
      const gain = (lines * 10 + (lines > 1 ? (lines - 1) * 15 : 0)) * Math.max(1, this.combo);
      this.score += gain;
      this.saveBest();
      this.updateHud({ bumpScore: true, bumpCombo: true });

      this.sound.clear(lines, this.combo);
      vibrate(lines > 1 ? 32 : 16);
      if (lines > 1 || this.combo >= 2) this.ui.shake();

      let cx = 0;
      let cy = 0;
      for (const index of clearSet) {
        this.ui.cells[index].classList.add("is-clearing");
        this.ui.burstAtCell(index, this.grid[index], 3);
        const center = this.ui.cellCenter(index);
        cx += center.x;
        cy += center.y;
      }
      cx /= clearSet.size;
      cy /= clearSet.size;
      this.ui.floatScore(`+${formatScore(gain)}`, cx, cy, this.combo > 1);
      const label = this.combo >= 2
        ? `COMBO x${this.combo}`
        : lines >= 4 ? "EXPLOSÃO!" : lines === 3 ? "TRIPLA!" : lines === 2 ? "DUPLA!" : "LINHA!";
      this.ui.showBanner(label, this.combo >= 2);

      await sleep(390);
      if (token !== this.runId) return;
      for (const index of clearSet) this.grid[index] = 0;
      this.render();
    } else {
      if (this.combo > 0) this.combo = 0;
      this.saveBest();
      this.updateHud();
    }

    if (this.pieces.every((item) => item.used)) {
      await sleep(200);
      if (token !== this.runId) return;
      this.newTray();
      this.sound.click();
    }

    this.busy = false;
    this.updateHud();
    if (!this.hasMoves()) this.gameOver();
  }

  saveBest() {
    if (this.score > this.best) {
      this.best = this.score;
      this.recordBeaten = true;
      writeBest("blast", this.best);
    }
  }

  updateHud(options = {}) {
    this.ui.setHud({
      score: this.score,
      best: this.best,
      combo: this.combo > 0 ? `x${this.combo}` : "—",
      lines: this.lines,
      bumpScore: options.bumpScore,
      bumpCombo: options.bumpCombo,
    });
  }

  /* ---------------- end state ---------------- */

  showGameOver() {
    const plural = this.lines === 1 ? "linha" : "linhas";
    this.ui.showOverlay({
      eyebrow: "Modo Blast",
      title: this.recordBeaten ? "Novo recorde!" : "Fim de jogo",
      text: `${formatScore(this.score)} pontos • ${this.lines} ${plural} limpas.`,
      primaryLabel: "Jogar de novo",
      onPrimary: () => this.reset(),
    });
  }

  gameOver() {
    if (this.over) return;
    this.over = true;
    this.busy = false;
    this.selectedId = null;
    this.cursor = null;
    this.clearPreview();
    this.saveBest();
    this.updateHud();
    this.sound.gameOver();
    vibrate(60);
    if (this.recordBeaten) this.ui.confetti(80);
    this.showGameOver();
  }
}