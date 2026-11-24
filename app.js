import { UI } from "./ui.js";
import { Sound } from "./sound.js";
import { BlastGame } from "./blast.js";
import { ClassicGame } from "./classic.js";
import { readSetting, writeSetting } from "./storage.js";

const ui = new UI();
const sound = new Sound();
const games = {
  blast: new BlastGame(ui, sound),
  classic: new ClassicGame(ui, sound),
};

const byId = (id) => document.getElementById(id);
const tabs = Array.from(document.querySelectorAll(".mode-btn"));
const soundBtn = byId("soundBtn");
const installBtn = byId("installBtn");
const helpBtn = byId("helpBtn");
const restartBtn = byId("restartBtn");
const pauseBtn = byId("pauseBtn");
const modeHint = byId("modeHint");
const installText = byId("installText");
const modalInstallBtn = byId("modalInstallBtn");

let mode = readSetting("mode", "blast");
if (!games[mode]) mode = "blast";
let current = games[mode];
let deferredPrompt = null;
let refreshing = false;

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () =>
  /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function syncSoundButton() {
  soundBtn.setAttribute("aria-pressed", String(sound.enabled));
  soundBtn.setAttribute("aria-label", sound.enabled ? "Desativar som" : "Ativar som");
  soundBtn.title = sound.enabled ? "Desativar som" : "Ativar som";
}

function setMode(next, { initial = false } = {}) {
  if (!games[next]) return;
  if (current && current !== games[next]) current.deactivate();
  current = games[next];
  mode = next;

  document.body.dataset.mode = next;
  ui.boardShell.dataset.mode = next;
  ui.tray.hidden = next !== "blast";
  ui.touchControls.hidden = next !== "classic";
  pauseBtn.hidden = next !== "classic";
  ui.comboStat.hidden = next !== "blast";
  ui.linesStat.hidden = next !== "classic";
  ui.levelStat.hidden = next !== "classic";
  modeHint.textContent = next === "blast"
    ? "Arraste as peças para o tabuleiro. Complete linhas ou colunas para explodi-las!"
    : "Setas para mover, ↑ ou X para girar, espaço para derrubar. C guarda a peça na reserva.";

  for (const tab of tabs) {
    const active = tab.dataset.mode === next;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  }

  ui.hideOverlay();
  current.activate();
  writeSetting("mode", next);
  if (!initial) sound.click();
}

function updateInstallUI() {
  const available = !isStandalone() && Boolean(deferredPrompt || isIOS());
  installBtn.hidden = !available;
  modalInstallBtn.hidden = !available;
  if (!available) {
    if (isStandalone()) installText.textContent = "Você já está usando o app instalado.";
    return;
  }
  if (deferredPrompt) {
    installBtn.setAttribute("aria-label", "Instalar aplicativo");
    modalInstallBtn.textContent = "Instalar";
    installText.textContent = "Instale como app: abre em tela cheia e funciona sem internet.";
  } else {
    installBtn.setAttribute("aria-label", "Como instalar o aplicativo");
    modalInstallBtn.textContent = "Como instalar";
    installText.textContent = "No iPhone/iPad: toque em Compartilhar → Adicionar à Tela de Início.";
  }
}

async function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice.catch(() => ({ outcome: "dismissed" }));
    deferredPrompt = null;
    updateInstallUI();
    if (outcome === "accepted") ui.toast("App instalado. Boa sorte!", { duration: 3200 });
    return;
  }
  if (isIOS()) {
    ui.toast("No Safari: Compartilhar → Adicionar à Tela de Início.", { duration: 7000 });
    return;
  }
  ui.toast("Abra o menu do navegador e escolha “Instalar app”.", { duration: 6000 });
}

/* ---------------- events ---------------- */

for (const tab of tabs) {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
}

soundBtn.addEventListener("click", () => {
  sound.setEnabled(!sound.enabled);
  syncSoundButton();
  if (sound.enabled) sound.click();
});

restartBtn.addEventListener("click", () => {
  current.reset();
  sound.click();
});

pauseBtn.addEventListener("click", () => {
  if (mode === "classic") games.classic.togglePause();
});

helpBtn.addEventListener("click", () => ui.openModal());
byId("modalClose").addEventListener("click", () => ui.closeModal());
document.querySelector("[data-close-modal]").addEventListener("click", () => ui.closeModal());
installBtn.addEventListener("click", installApp);
modalInstallBtn.addEventListener("click", installApp);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  updateInstallUI();
});
window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  updateInstallUI();
  ui.toast("App instalado com sucesso!", { duration: 3200 });
});

window.addEventListener("keydown", (event) => {
  if (!ui.modal.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      ui.closeModal();
    }
    return;
  }
  const target = event.target;
  if (target?.closest?.("input, textarea, select")) return;
  if ((event.key === " " || event.key === "Enter") && target?.closest?.("button")) return;
  if (current.handleKey?.(event)) event.preventDefault();
});

document.addEventListener("pointerdown", () => sound.ensure(), { once: true, passive: true });
window.addEventListener("keydown", () => sound.ensure(), { once: true, passive: true });
ui.board.addEventListener("contextmenu", (event) => event.preventDefault());

window.addEventListener("offline", () => {
  ui.toast("Sem internet — o jogo continua funcionando.", { duration: 3200 });
});
window.addEventListener("online", () => {
  ui.toast("Conexão restaurada!", { duration: 2200 });
});

/* ---------------- PWA service worker ---------------- */

function offerUpdate(registration) {
  if (!registration.waiting) return;
  ui.toast("Nova versão disponível.", {
    actionLabel: "Atualizar",
    duration: 12000,
    onAction: () => {
      refreshing = true;
      registration.waiting?.postMessage({ type: "SKIP_WAITING" });
    },
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  try {
    const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    if (registration.waiting) offerUpdate(registration);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) offerUpdate(registration);
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    if (!readSetting("offlineIntroShown", false)) {
      setTimeout(() => {
        if (ui.toastEl.classList.contains("is-show")) return;
        ui.toast("Tudo pronto: o jogo funciona offline.", { duration: 3600 });
        writeSetting("offlineIntroShown", true);
      }, 2600);
    }
  } catch (error) {
    console.warn("Service worker indisponível:", error);
  }
}

/* ---------------- boot ---------------- */

syncSoundButton();
setMode(mode, { initial: true });
updateInstallUI();
window.addEventListener("load", registerServiceWorker, { once: true });
