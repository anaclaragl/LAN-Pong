import { CONFIG } from './config.js';
import { GAME_REGISTRY } from '/src/shared/registry.js';
import { GameEngine } from '/src/engine/game-engine.js';
import { PongBot } from '/src/ai/bot.js';
import { Connect4Renderer } from '/src/games/connect4/renderer.js';

// DOM elements
const container = document.getElementById('game-container');
const canvas = document.getElementById('court');
const ctx = canvas.getContext('2d');

const screenMenu = document.getElementById('screen-menu');
const screenWaiting = document.getElementById('screen-waiting');
const screenJoin = document.getElementById('screen-join');
const screenLobby = document.getElementById('screen-lobby');
const screenInventory = document.getElementById('screen-inventory');
const screenCountdown = document.getElementById('screen-countdown');
const screenGameOver = document.getElementById('screen-gameover');
const screenMessage = document.getElementById('screen-message');

const countdownNumber = document.getElementById('countdown-number');
const winnerBanner = document.getElementById('winner-banner');
const finalScore = document.getElementById('final-score');
const messageTitle = document.getElementById('message-title');
const messageText = document.getElementById('message-text');

const lobbyGamesGrid = document.getElementById('lobby-games-grid');
const lobbyStatusText = document.getElementById('lobby-status-text');
const lobbyCountdownBox = document.getElementById('lobby-countdown-box');
const lobbyCountdownVal = document.getElementById('lobby-countdown-val');
const btnLeaveLobby = document.getElementById('btn-leave-lobby');

const btnVsBot = document.getElementById('btn-vs-bot');
const btnCreate = document.getElementById('btn-create');
const btnInventory = document.getElementById('btn-inventory');
const btnCancelInventory = document.getElementById('btn-cancel-inventory');
const btnShowJoin = document.getElementById('btn-show-join');
const btnCancelWaiting = document.getElementById('btn-cancel-waiting');
const btnConnect = document.getElementById('btn-connect');
const btnCancelJoin = document.getElementById('btn-cancel-join');
const btnRematch = document.getElementById('btn-rematch');
const btnGameoverMenu = document.getElementById('btn-gameover-menu');
const btnMessageAck = document.getElementById('btn-message-ack');
const hostAddressInput = document.getElementById('host-address');
const themeToggleBtn = document.getElementById('theme-toggle');

const tabPaddle = document.getElementById('tab-paddle');
const tabTrail = document.getElementById('tab-trail');
const inventoryColorsContainer = document.getElementById('inventory-colors');
const inventoryTrailsContainer = document.getElementById('inventory-trails');
const previewPaddle = document.getElementById('preview-paddle');
const previewTrailCanvas = document.getElementById('preview-trail-canvas');
const previewColorName = document.getElementById('preview-item-name') || document.getElementById('preview-color-name');

const infoMdns = document.getElementById('info-mdns');
const infoIp = document.getElementById('info-ip');

// State
let ws = null;
let myRole = null; // 'player1' (Host) | 'player2' (Guest)
let activeGameId = null; // 'pong' | 'connect4' | null
let latestState = null;
let lastSentPaddleX = null;
let lastPaddleSendTime = 0;
let hostInfo = null;

// Lobby State
let currentVotes = { host: null, guest: null };
let myVote = null;

// Offline Mode State
let isOfflineMode = false;
let localEngine = null;
let mlBot = null;
let offlineInterval = null;

// Connect 4 Client Renderer
const connect4Renderer = new Connect4Renderer(container, canvas, ctx);

// Inventory & Customization State
const PADDLE_COLORS = [
  { id: 'default', name: 'CLASSIC', hex: null },
  { id: 'cyan', name: 'CYAN', hex: '#00F0FF' },
  { id: 'green', name: 'NEON GREEN', hex: '#00FF66' },
  { id: 'pink', name: 'HOT PINK', hex: '#FF007F' },
  { id: 'yellow', name: 'YELLOW', hex: '#FFE600' },
  { id: 'orange', name: 'ORANGE', hex: '#FF6600' },
  { id: 'red', name: 'CRIMSON', hex: '#FF2A2A' },
  { id: 'purple', name: 'PURPLE', hex: '#B026FF' },
];

const BALL_TRAILS = [
  { id: 'classic', name: 'CLASSIC', color: null, desc: 'Fading echoes' },
  { id: 'cyan', name: 'CYAN LASER', color: '#00F0FF', desc: 'Laser beam' },
  { id: 'fire', name: 'FIRE EMBER', color: '#FF4500', desc: 'Fiery blaze' },
  { id: 'matrix', name: 'MATRIX', color: '#00FF66', desc: 'Digital pixels' },
  { id: 'pink', name: 'SYNTH PINK', color: '#FF007F', desc: 'Magenta glow' },
  { id: 'yellow', name: 'ELECTRIC', color: '#FFE600', desc: 'Golden lightning' },
  { id: 'purple', name: 'PURPLE HAZE', color: '#B026FF', desc: 'Violet aura' },
  { id: 'rainbow', name: 'RAINBOW', color: 'rainbow', desc: 'Chromatic prism' },
];

let selectedColorId = localStorage.getItem('pong-paddle-color') || 'default';
let selectedTrailId = localStorage.getItem('pong-ball-trail') || 'classic';
let opponentColorId = null;
let opponentTrailId = null;
let activeInvTab = 'paddle';

// Trail buffer for Pong match
const trailHistory = [];
const MAX_TRAIL_LENGTH = 16;

function getColorObj(id) {
  return PADDLE_COLORS.find((c) => c.id === id) || PADDLE_COLORS[0];
}

function getTrailObj(id) {
  return BALL_TRAILS.find((t) => t.id === id) || BALL_TRAILS[0];
}

function resolveColorHex(colorId, fallbackHex) {
  const c = getColorObj(colorId);
  return c.hex || fallbackHex;
}

// Draw trail segment
function drawTrailSegment(targetCtx, p, alpha, fgColor) {
  const trailId = p.trailId || 'classic';
  const size = p.w * (0.35 + 0.65 * alpha);

  targetCtx.save();
  if (trailId === 'classic') {
    targetCtx.fillStyle = fgColor;
    targetCtx.globalAlpha = alpha * 0.4;
    targetCtx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
  } else if (trailId === 'cyan') {
    targetCtx.fillStyle = '#00F0FF';
    targetCtx.globalAlpha = alpha * 0.65;
    targetCtx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
  } else if (trailId === 'fire') {
    const fireColors = ['#FF1100', '#FF4400', '#FF7700', '#FFAA00', '#FFEE33'];
    const idx = Math.min(fireColors.length - 1, Math.floor(alpha * fireColors.length));
    targetCtx.fillStyle = fireColors[idx];
    targetCtx.globalAlpha = alpha * 0.8;
    const jx = (Math.random() - 0.5) * (1 - alpha) * 4;
    const jy = (Math.random() - 0.5) * (1 - alpha) * 4;
    targetCtx.fillRect(p.x - size / 2 + jx, p.y - size / 2 + jy, size * 0.9, size * 0.9);
  } else if (trailId === 'matrix') {
    targetCtx.fillStyle = '#00FF66';
    targetCtx.globalAlpha = alpha * 0.7;
    const snapSize = Math.max(3, Math.round(size * 0.85));
    targetCtx.fillRect(p.x - snapSize / 2, p.y - snapSize / 2, snapSize, snapSize);
  } else if (trailId === 'pink') {
    targetCtx.fillStyle = '#FF007F';
    targetCtx.globalAlpha = alpha * 0.65;
    targetCtx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
  } else if (trailId === 'yellow') {
    targetCtx.fillStyle = '#FFE600';
    targetCtx.globalAlpha = alpha * 0.7;
    const spark = (Math.random() - 0.5) * 3;
    targetCtx.fillRect(p.x - size / 2 + spark, p.y - size / 2, size, size);
  } else if (trailId === 'purple') {
    targetCtx.fillStyle = '#B026FF';
    targetCtx.globalAlpha = alpha * 0.7;
    targetCtx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
  } else if (trailId === 'rainbow') {
    const hue = (p.time * 0.35 + alpha * 180) % 360;
    targetCtx.fillStyle = `hsl(${hue}, 100%, 55%)`;
    targetCtx.globalAlpha = alpha * 0.75;
    targetCtx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
  }
  targetCtx.restore();
}

// Theme management
function initTheme() {
  const savedTheme = localStorage.getItem('pong-theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
  }
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    const isLight = document.body.classList.contains('light-mode');
    localStorage.setItem('pong-theme', isLight ? 'light' : 'dark');
    updatePreview(activeInvTab === 'paddle' ? selectedColorId : selectedTrailId);
  });
}

// Mini preview court animation for ball trail
let previewBallX = 30;
let previewBallY = 30;
let previewBallVx = 2.2;
let previewBallVy = 0.8;
const previewTrailHistory = [];
let currentPreviewTrailId = selectedTrailId;

function runPreviewTrailAnimation() {
  if (previewTrailCanvas) {
    const pCtx = previewTrailCanvas.getContext('2d');
    const rect = previewTrailCanvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      if (previewTrailCanvas.width !== rect.width || previewTrailCanvas.height !== rect.height) {
        previewTrailCanvas.width = rect.width;
        previewTrailCanvas.height = rect.height;
      }
      const W = previewTrailCanvas.width;
      const H = previewTrailCanvas.height;

      pCtx.clearRect(0, 0, W, H);

      if (screenInventory?.classList.contains('active')) {
        previewBallX += previewBallVx;
        previewBallY += previewBallVy;
        if (previewBallX <= 16 || previewBallX >= W - 16) previewBallVx *= -1;
        if (previewBallY <= 10 || previewBallY >= H - 10) previewBallVy *= -1;

        previewTrailHistory.push({
          x: previewBallX,
          y: previewBallY,
          w: 8,
          h: 8,
          trailId: currentPreviewTrailId,
          time: performance.now(),
        });
        if (previewTrailHistory.length > 14) previewTrailHistory.shift();

        const isLight = document.body.classList.contains('light-mode');
        const fg = isLight ? '#000000' : '#FFFFFF';

        for (let i = 0; i < previewTrailHistory.length; i++) {
          const p = previewTrailHistory[i];
          const alpha = (i + 1) / previewTrailHistory.length;
          drawTrailSegment(pCtx, p, alpha, fg);
        }

        pCtx.fillStyle = fg;
        pCtx.fillRect(previewBallX - 4, previewBallY - 4, 8, 8);
      }
    }
  }

  requestAnimationFrame(runPreviewTrailAnimation);
}

// Inventory UI
function initInventory() {
  initPaddleColorsUI();
  initBallTrailsUI();
  setupInventoryTabs();
  runPreviewTrailAnimation();
  updatePreview(selectedColorId);
}

function setupInventoryTabs() {
  tabPaddle?.addEventListener('click', () => {
    activeInvTab = 'paddle';
    tabPaddle.classList.add('active');
    tabTrail?.classList.remove('active');
    if (inventoryColorsContainer) inventoryColorsContainer.style.display = 'grid';
    if (inventoryTrailsContainer) inventoryTrailsContainer.style.display = 'none';
    currentPreviewTrailId = selectedTrailId;
    updatePreview(selectedColorId);
  });

  tabTrail?.addEventListener('click', () => {
    activeInvTab = 'trail';
    tabTrail.classList.add('active');
    tabPaddle?.classList.remove('active');
    if (inventoryColorsContainer) inventoryColorsContainer.style.display = 'none';
    if (inventoryTrailsContainer) inventoryTrailsContainer.style.display = 'grid';
    currentPreviewTrailId = selectedTrailId;
    updatePreview(selectedTrailId);
  });
}

function initPaddleColorsUI() {
  if (!inventoryColorsContainer) return;
  inventoryColorsContainer.innerHTML = '';

  PADDLE_COLORS.forEach((color) => {
    const btn = document.createElement('button');
    btn.className = `color-option ${color.id === selectedColorId ? 'active' : ''}`;
    btn.dataset.colorId = color.id;
    btn.title = color.name;
    btn.setAttribute('aria-label', color.name);

    const swatch = document.createElement('span');
    swatch.className = `color-swatch ${color.id === 'default' ? 'swatch-default' : ''}`;
    if (color.hex) {
      swatch.style.backgroundColor = color.hex;
    }

    btn.appendChild(swatch);

    btn.addEventListener('mouseenter', () => {
      if (activeInvTab === 'paddle') updatePreview(color.id);
    });

    btn.addEventListener('mouseleave', () => {
      if (activeInvTab === 'paddle') updatePreview(selectedColorId);
    });

    btn.addEventListener('click', () => {
      selectedColorId = color.id;
      localStorage.setItem('pong-paddle-color', selectedColorId);
      updateInventoryActiveBtn();
      updatePreview(selectedColorId);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'customize', color: selectedColorId, trail: selectedTrailId }));
      }
    });

    inventoryColorsContainer.appendChild(btn);
  });
}

function initBallTrailsUI() {
  if (!inventoryTrailsContainer) return;
  inventoryTrailsContainer.innerHTML = '';

  BALL_TRAILS.forEach((trail) => {
    const btn = document.createElement('button');
    btn.className = `trail-option ${trail.id === selectedTrailId ? 'active' : ''}`;
    btn.dataset.trailId = trail.id;
    btn.title = trail.desc || trail.name;
    btn.setAttribute('aria-label', trail.name);

    const badge = document.createElement('span');
    badge.className = 'trail-badge';
    if (trail.color === 'rainbow') {
      badge.style.background = 'linear-gradient(45deg, #FF0055, #FFEE00, #00FF66, #00F0FF)';
    } else if (trail.color) {
      badge.style.backgroundColor = trail.color;
    } else {
      badge.className += ' swatch-default';
    }

    const label = document.createElement('span');
    label.className = 'trail-label';
    label.textContent = trail.name;

    btn.appendChild(badge);
    btn.appendChild(label);

    btn.addEventListener('mouseenter', () => {
      currentPreviewTrailId = trail.id;
      if (activeInvTab === 'trail') updatePreview(trail.id);
    });

    btn.addEventListener('mouseleave', () => {
      currentPreviewTrailId = selectedTrailId;
      if (activeInvTab === 'trail') updatePreview(selectedTrailId);
    });

    btn.addEventListener('click', () => {
      selectedTrailId = trail.id;
      currentPreviewTrailId = selectedTrailId;
      localStorage.setItem('pong-ball-trail', selectedTrailId);
      updateInventoryActiveBtn();
      updatePreview(selectedTrailId);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'customize', color: selectedColorId, trail: selectedTrailId }));
      }
    });

    inventoryTrailsContainer.appendChild(btn);
  });
}

function updateInventoryActiveBtn() {
  const colorBtns = inventoryColorsContainer?.querySelectorAll('.color-option');
  colorBtns?.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.colorId === selectedColorId);
  });

  const trailBtns = inventoryTrailsContainer?.querySelectorAll('.trail-option');
  trailBtns?.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.trailId === selectedTrailId);
  });
}

function updatePreview(itemId) {
  const isLight = document.body.classList.contains('light-mode');
  const fg = isLight ? '#000000' : '#FFFFFF';

  if (activeInvTab === 'paddle') {
    const color = getColorObj(itemId);
    if (previewColorName) {
      previewColorName.textContent = color.name;
    }
    if (previewPaddle) {
      previewPaddle.style.backgroundColor = color.hex || fg;
    }
  } else {
    const trail = getTrailObj(itemId);
    if (previewColorName) {
      previewColorName.textContent = trail.name;
    }
    if (previewPaddle) {
      const currentColor = getColorObj(selectedColorId);
      previewPaddle.style.backgroundColor = currentColor.hex || fg;
    }
  }
}

// Screen management
function showScreen(screen) {
  [
    screenMenu,
    screenWaiting,
    screenJoin,
    screenLobby,
    screenInventory,
    screenCountdown,
    screenGameOver,
    screenMessage,
  ].forEach((s) => {
    s?.classList.remove('active');
  });
  if (screen) {
    screen.classList.add('active');
  }

  // Update mouse cursor visibility
  container.classList.remove('in-game', 'connect4-active');
  if (!screen) {
    if (activeGameId === 'pong') {
      container.classList.add('in-game');
    } else if (activeGameId === 'connect4') {
      container.classList.add('connect4-active');
    }
  }

  if (themeToggleBtn) {
    const isAllowedScreen =
      screen === screenMenu ||
      screen === screenWaiting ||
      screen === screenJoin ||
      screen === screenLobby ||
      screen === screenInventory;
    themeToggleBtn.classList.toggle('hidden', !isAllowedScreen);
  }
}

initTheme();
initInventory();
showScreen(screenMenu);

// Fetch host info for display
async function fetchHostInfo() {
  try {
    const res = await fetch('/api/info');
    if (res.ok) {
      hostInfo = await res.json();
      infoMdns.textContent = `http://${hostInfo.hostname}.local:${hostInfo.port}`;
      infoIp.textContent = `http://${hostInfo.localIP}:${hostInfo.port}`;
      if (!hostAddressInput.value) {
        hostAddressInput.value = window.location.host;
      }
    }
  } catch (e) {
    hostAddressInput.value = window.location.host || 'localhost:8080';
  }
}

// Canvas sizing
function resizeCanvas() {
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.resetTransform?.();
  ctx.scale(dpr, dpr);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Coordinate transformation helpers for Pong
function toScreenX(canonicalX) {
  const rect = container.getBoundingClientRect();
  if (myRole === 'player1') {
    return (1.0 - canonicalX) * rect.width;
  }
  return canonicalX * rect.width;
}

function toScreenY(canonicalY) {
  const rect = container.getBoundingClientRect();
  if (myRole === 'player1') {
    return (1.0 - canonicalY) * rect.height;
  }
  return canonicalY * rect.height;
}

// Mouse movement listener
container.addEventListener('mousemove', (event) => {
  const rect = container.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  if (activeGameId === 'connect4') {
    const col = connect4Renderer.getColumnFromMouse(mouseX, mouseY, rect.width, rect.height);
    connect4Renderer.setHoverColumn(col);
    return;
  }

  if (activeGameId === 'pong') {
    if (isOfflineMode) {
      if (!localEngine || (latestState?.phase !== 'playing' && latestState?.phase !== 'countdown')) return;
      const mouseScreenX = Math.max(0, Math.min(rect.width, mouseX));
      const normalizedScreenX = mouseScreenX / rect.width;
      localEngine.setPaddlePosition('player2', normalizedScreenX);
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!latestState || (latestState.phase !== 'playing' && latestState.phase !== 'countdown')) return;

    const mouseScreenX = Math.max(0, Math.min(rect.width, mouseX));
    const normalizedScreenX = mouseScreenX / rect.width;
    const canonicalX = myRole === 'player1' ? 1.0 - normalizedScreenX : normalizedScreenX;

    const now = performance.now();
    if (now - lastPaddleSendTime >= 16 || lastSentPaddleX === null) {
      if (Math.abs(canonicalX - (lastSentPaddleX || 0)) > 0.001) {
        ws.send(JSON.stringify({ type: 'paddle', x: canonicalX }));
        lastSentPaddleX = canonicalX;
        lastPaddleSendTime = now;
      }
    }
  }
});

// Click listener for Connect 4 piece drop
container.addEventListener('click', (event) => {
  if (activeGameId !== 'connect4') return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!latestState || latestState.status !== 'playing') return;
  if (latestState.currentPlayer !== myRole) return;

  const rect = container.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  const col = connect4Renderer.getColumnFromMouse(mouseX, mouseY, rect.width, rect.height);

  if (col !== null) {
    ws.send(JSON.stringify({ type: 'move', column: col }));
  }
});

// -------------------------------------------------------------
// Lobby & Voting System
// -------------------------------------------------------------
function buildLobbyUI() {
  if (!lobbyGamesGrid) return;
  lobbyGamesGrid.innerHTML = '';

  GAME_REGISTRY.forEach((game) => {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.dataset.gameId = game.id;

    // Title & description
    const title = document.createElement('div');
    title.className = 'game-card-title';
    title.textContent = game.title;

    const desc = document.createElement('div');
    desc.className = 'game-card-desc';
    desc.textContent = game.description;

    // Vote indicator container
    const indicators = document.createElement('div');
    indicators.className = 'vote-indicators';
    indicators.id = `indicators-${game.id}`;

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(indicators);

    // Click handler to toggle vote
    card.addEventListener('click', () => {
      sendVote(game.id);
    });

    lobbyGamesGrid.appendChild(card);
  });

  updateLobbyVoteDisplay();
}

function sendVote(gameId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  // If clicking already voted card, send null to remove vote
  const nextVote = myVote === gameId ? null : gameId;
  myVote = nextVote;
  ws.send(JSON.stringify({ type: 'vote', gameId: nextVote }));
}

function updateLobbyVoteDisplay(countdown = null, selectedGame = null) {
  // Clear all badges
  document.querySelectorAll('.vote-indicators').forEach((el) => {
    el.innerHTML = '';
  });
  document.querySelectorAll('.game-card').forEach((card) => {
    card.classList.remove('my-vote');
  });

  // Host vote (circle with 1)
  if (currentVotes.host) {
    const hostContainer = document.getElementById(`indicators-${currentVotes.host}`);
    if (hostContainer) {
      const b1 = document.createElement('div');
      b1.className = 'vote-badge';
      b1.textContent = '1';
      b1.title = 'Host (Player 1)';
      hostContainer.appendChild(b1);
    }
  }

  // Guest vote (circle with 2)
  if (currentVotes.guest) {
    const guestContainer = document.getElementById(`indicators-${currentVotes.guest}`);
    if (guestContainer) {
      const b2 = document.createElement('div');
      b2.className = 'vote-badge';
      b2.textContent = '2';
      b2.title = 'Guest (Player 2)';
      guestContainer.appendChild(b2);
    }
  }

  // Highlight my voted card
  if (myVote) {
    const myCard = document.querySelector(`.game-card[data-game-id="${myVote}"]`);
    myCard?.classList.add('my-vote');
  }

  // Countdown banner
  if (countdown !== null && countdown > 0) {
    lobbyCountdownBox.style.display = 'block';
    lobbyCountdownVal.textContent = countdown;
    lobbyStatusText.textContent = `Both voted for ${selectedGame?.toUpperCase()}!`;
  } else {
    lobbyCountdownBox.style.display = 'none';
    if (currentVotes.host && currentVotes.guest && currentVotes.host !== currentVotes.guest) {
      lobbyStatusText.textContent = 'Votes differ! Agree on a game to start.';
    } else if (currentVotes.host || currentVotes.guest) {
      lobbyStatusText.textContent = 'Waiting for other player to vote...';
    } else {
      lobbyStatusText.textContent = 'Click a card to vote. Both must agree!';
    }
  }
}

// -------------------------------------------------------------
// Offline Mode (Pong vs Bot)
// -------------------------------------------------------------
function startOfflineMatch() {
  if (ws) {
    ws.close();
    ws = null;
  }

  isOfflineMode = true;
  activeGameId = 'pong';
  myRole = 'player2';
  opponentColorId = 'cyan';
  opponentTrailId = 'matrix';

  localEngine = new GameEngine();
  mlBot = new PongBot(null, 'player1');
  trailHistory.length = 0;
  finalScore.textContent = '0 - 0';

  localEngine.resetMatch();
  localEngine.startCountdown(false);
  latestState = localEngine.getSnapshot();

  showScreen(screenCountdown);
  container.classList.add('in-game');

  if (offlineInterval) {
    clearInterval(offlineInterval);
  }

  const intervalMs = 1000 / CONFIG.TICK_RATE_HZ;
  const dt = 1 / CONFIG.TICK_RATE_HZ;

  offlineInterval = setInterval(() => {
    if (!isOfflineMode || !localEngine) return;

    const botX = mlBot.update(localEngine.getSnapshot(), dt);
    localEngine.setPaddlePosition('player1', botX);

    const evt = localEngine.tick(dt);
    latestState = localEngine.getSnapshot();

    if (evt) {
      if (evt.type === 'point') {
        updateGameState();
      } else if (evt.type === 'end') {
        updateGameState();
        clearInterval(offlineInterval);
        offlineInterval = null;
        return;
      }
    }

    updateGameState();
  }, intervalMs);
}

function stopOfflineMode() {
  isOfflineMode = false;
  activeGameId = null;
  if (offlineInterval) {
    clearInterval(offlineInterval);
    offlineInterval = null;
  }
  localEngine = null;
  mlBot = null;
  latestState = null;
  showScreen(screenMenu);
}

// -------------------------------------------------------------
// WebSocket Connection & Protocol
// -------------------------------------------------------------
function connect(address) {
  if (isOfflineMode) {
    stopOfflineMode();
  }

  const host = address || window.location.host || 'localhost:8080';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${host}`;

  if (ws) {
    ws.close();
  }

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'customize', color: selectedColorId, trail: selectedTrailId }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (e) {
      console.error('Failed to parse message:', e);
    }
  };

  ws.onclose = (event) => {
    activeGameId = null;
    if (event.reason === 'Match full') {
      messageTitle.textContent = 'MATCH FULL';
      messageText.textContent = 'A 2-player match is already in progress on this host.';
      showScreen(screenMessage);
    } else if (event.reason === 'Too many connections from this IP') {
      messageTitle.textContent = 'CONNECTION LIMIT';
      messageText.textContent = 'Too many active connections from your IP address.';
      showScreen(screenMessage);
    } else if (latestState && latestState.phase !== 'ended') {
      messageTitle.textContent = 'DISCONNECTED';
      messageText.textContent = 'Connection to the match server was lost.';
      showScreen(screenMessage);
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
  };
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'assigned':
      myRole = msg.role;
      if (msg.colors) {
        const oppRole = myRole === 'player1' ? 'player2' : 'player1';
        opponentColorId = msg.colors[oppRole] || null;
      }
      if (myRole === 'player1') {
        showScreen(screenWaiting);
      }
      break;

    case 'lobby':
      activeGameId = null;
      latestState = null;
      if (msg.colors) {
        const oppRole = myRole === 'player1' ? 'player2' : 'player1';
        opponentColorId = msg.colors[oppRole] || null;
      }
      currentVotes = msg.votes || { host: null, guest: null };
      myVote = myRole === 'player1' ? currentVotes.host : currentVotes.guest;
      buildLobbyUI();
      showScreen(screenLobby);
      break;

    case 'votes':
      currentVotes = { host: msg.host, guest: msg.guest };
      myVote = myRole === 'player1' ? currentVotes.host : currentVotes.guest;
      updateLobbyVoteDisplay(msg.countdown, msg.selectedGame);
      break;

    case 'game_start':
      activeGameId = msg.gameId;
      latestState = msg.state || null;
      if (msg.colors) {
        const oppRole = myRole === 'player1' ? 'player2' : 'player1';
        opponentColorId = msg.colors[oppRole] || null;
      }
      if (activeGameId === 'pong') {
        trailHistory.length = 0;
        finalScore.textContent = '0 - 0';
        showScreen(screenCountdown);
        container.classList.add('in-game');
      } else if (activeGameId === 'connect4') {
        showScreen(null);
        container.classList.add('connect4-active');
      }
      break;

    case 'start': // Legacy & Pong start message
      activeGameId = 'pong';
      if (msg.role) myRole = msg.role;
      latestState = msg.state;
      trailHistory.length = 0;
      finalScore.textContent = '0 - 0';
      showScreen(screenCountdown);
      container.classList.add('in-game');
      break;

    case 'state':
      latestState = msg.state || msg;
      updateGameState();
      break;

    case 'point':
      latestState = msg.state;
      updateGameState();
      break;

    case 'end':
      latestState = msg.state || msg;
      handleMatchEnd(msg);
      break;

    case 'opponent_disconnected':
      activeGameId = null;
      messageTitle.textContent = 'MATCH PAUSED';
      messageText.textContent = 'Opponent disconnected from the match.';
      showScreen(screenMessage);
      break;

    case 'error':
      messageTitle.textContent = 'ERROR';
      messageText.textContent = msg.message;
      showScreen(screenMessage);
      break;
  }
}

function updateGameState() {
  if (!latestState) return;

  if (activeGameId === 'pong') {
    if (latestState.phase === 'countdown') {
      showScreen(screenCountdown);
      countdownNumber.textContent = latestState.countdownTimer;
      container.classList.add('in-game');
    } else if (latestState.phase === 'playing') {
      showScreen(null);
      container.classList.add('in-game');
    } else if (latestState.phase === 'ended') {
      handleMatchEnd(latestState);
    }
  } else if (activeGameId === 'connect4') {
    if (latestState.status === 'playing') {
      showScreen(null);
      container.classList.add('connect4-active');
    }
  }
}

function handleMatchEnd(msg) {
  if (activeGameId === 'pong') {
    const winner = msg.winner;
    const score = msg.score || latestState?.score || { player1: 0, player2: 0 };
    const isWinner = winner === myRole;
    winnerBanner.textContent = isWinner ? 'YOU WON!' : 'OPPONENT WON!';

    const myScore = myRole === 'player1' ? (score.player1 ?? 0) : (score.player2 ?? 0);
    const oppScore = myRole === 'player1' ? (score.player2 ?? 0) : (score.player1 ?? 0);
    finalScore.textContent = `${myScore} - ${oppScore}`;

    showScreen(screenGameOver);
  } else if (activeGameId === 'connect4') {
    // Show win/draw banner on Connect 4 board, then allow returning to lobby
    const result = msg.result || latestState?.status;
    const winner = msg.winner || latestState?.winner;
    const scores = msg.scores || latestState?.scores || { player1: 0, player2: 0 };

    if (result === 'win') {
      winnerBanner.textContent = winner === myRole ? 'YOU WON!' : 'OPPONENT WON!';
    } else {
      winnerBanner.textContent = "IT'S A DRAW!";
    }

    const myScore = myRole === 'player1' ? (scores.player1 ?? 0) : (scores.player2 ?? 0);
    const oppScore = myRole === 'player1' ? (scores.player2 ?? 0) : (scores.player1 ?? 0);
    finalScore.textContent = `${myScore} - ${oppScore}`;

    // Give 1.5s to admire winning 4 pieces before showing game over overlay
    setTimeout(() => {
      showScreen(screenGameOver);
    }, 1500);
  }
}

// -------------------------------------------------------------
// UI Button Listeners
// -------------------------------------------------------------
if (btnVsBot) {
  btnVsBot.addEventListener('click', () => {
    startOfflineMatch();
  });
}

btnCreate.addEventListener('click', () => {
  connect(window.location.host);
});

if (btnInventory) {
  btnInventory.addEventListener('click', () => {
    updateInventoryActiveBtn();
    updatePreview(selectedColorId);
    showScreen(screenInventory);
  });
}

if (btnCancelInventory) {
  btnCancelInventory.addEventListener('click', () => {
    showScreen(screenMenu);
  });
}

btnShowJoin.addEventListener('click', () => {
  showScreen(screenJoin);
});

btnCancelWaiting.addEventListener('click', () => {
  if (ws) ws.close();
  showScreen(screenMenu);
});

btnCancelJoin.addEventListener('click', () => {
  showScreen(screenMenu);
});

btnConnect.addEventListener('click', () => {
  const addr = hostAddressInput.value.trim();
  if (addr) {
    connect(addr);
  }
});

btnLeaveLobby?.addEventListener('click', () => {
  if (ws) ws.close();
  showScreen(screenMenu);
});

btnRematch.addEventListener('click', () => {
  if (isOfflineMode) {
    startOfflineMatch();
  } else if (ws && ws.readyState === WebSocket.OPEN) {
    // Returns both players to lobby with cleared votes
    ws.send(JSON.stringify({ type: 'rematch' }));
  }
});

if (btnGameoverMenu) {
  btnGameoverMenu.addEventListener('click', () => {
    if (isOfflineMode) {
      stopOfflineMode();
    } else if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'rematch' }));
    } else {
      showScreen(screenMenu);
    }
  });
}

btnMessageAck.addEventListener('click', () => {
  latestState = null;
  activeGameId = null;
  if (ws) ws.close();
  showScreen(screenMenu);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isOfflineMode) {
    stopOfflineMode();
  }
});

// -------------------------------------------------------------
// Main Render Loop
// -------------------------------------------------------------
function render() {
  requestAnimationFrame(render);

  if (activeGameId === 'connect4') {
    connect4Renderer.render(latestState, myRole, {
      player1: myRole === 'player1' ? selectedColorId : opponentColorId,
      player2: myRole === 'player2' ? selectedColorId : opponentColorId,
    });
    return;
  }

  // Otherwise render Pong
  const rect = container.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;

  const isLight = document.body.classList.contains('light-mode');
  const bgColor = isLight ? '#FFFFFF' : '#000000';
  const fgColor = isLight ? '#000000' : '#FFFFFF';

  // Clear court
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  // Decorative dashed center line
  ctx.strokeStyle = fgColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Scores
  if (latestState && activeGameId === 'pong') {
    const p1Score = latestState.score.player1;
    const p2Score = latestState.score.player2;

    const myScore = myRole === 'player1' ? p1Score : p2Score;
    const oppScore = myRole === 'player1' ? p2Score : p1Score;

    ctx.fillStyle = fgColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const oppLabel = isOfflineMode ? 'BOT' : 'OPPONENT';
    ctx.font = 'bold 12px Consolas, Courier, monospace';
    ctx.fillText(oppLabel, W / 2, H * 0.22);
    ctx.font = 'bold 44px Consolas, Courier, monospace';
    ctx.fillText(String(oppScore), W / 2, H * 0.32);

    ctx.font = 'bold 44px Consolas, Courier, monospace';
    ctx.fillText(String(myScore), W / 2, H * 0.68);
    ctx.font = 'bold 12px Consolas, Courier, monospace';
    ctx.fillText('YOU', W / 2, H * 0.78);
  }

  // Draw paddles and ball only when Pong is active
  if (latestState && activeGameId === 'pong') {
    const paddleW = CONFIG.PADDLE_WIDTH * W;
    const paddleH = CONFIG.PADDLE_HEIGHT * H;

    const p1Y_screen = toScreenY(0.03);
    const p1X_screen = toScreenX(latestState.paddles.player1);

    const p2Y_screen = toScreenY(1.0 - 0.03 - CONFIG.PADDLE_HEIGHT);
    const p2X_screen = toScreenX(latestState.paddles.player2);

    const myPaddleColor = resolveColorHex(selectedColorId, fgColor);
    const oppPaddleColor = resolveColorHex(opponentColorId, fgColor);

    const p1Color = myRole === 'player1' ? myPaddleColor : oppPaddleColor;
    const p2Color = myRole === 'player2' ? myPaddleColor : oppPaddleColor;

    if (myRole === 'player1') {
      ctx.fillStyle = p1Color;
      ctx.fillRect(p1X_screen - paddleW / 2, p1Y_screen - paddleH, paddleW, paddleH);
      ctx.fillStyle = p2Color;
      ctx.fillRect(p2X_screen - paddleW / 2, p2Y_screen, paddleW, paddleH);
    } else {
      ctx.fillStyle = p1Color;
      ctx.fillRect(p1X_screen - paddleW / 2, p1Y_screen, paddleW, paddleH);
      ctx.fillStyle = p2Color;
      ctx.fillRect(p2X_screen - paddleW / 2, p2Y_screen, paddleW, paddleH);
    }

    // Ball & Trail
    const ballW = CONFIG.BALL_SIZE * W;
    const ballH = CONFIG.BALL_SIZE * CONFIG.COURT_ASPECT_RATIO * H;
    const ballScreenX = toScreenX(latestState.ball.x);
    const ballScreenY = toScreenY(latestState.ball.y);
    const ballActualX = myRole === 'player1' ? ballScreenX - ballW : ballScreenX;
    const ballActualY = myRole === 'player1' ? ballScreenY - ballH : ballScreenY;
    const ballCenterX = ballActualX + ballW / 2;
    const ballCenterY = ballActualY + ballH / 2;

    let activeTrailId = 'classic';
    if (latestState.lastHitter === 'player1') {
      activeTrailId = myRole === 'player1' ? selectedTrailId : opponentTrailId;
    } else if (latestState.lastHitter === 'player2') {
      activeTrailId = myRole === 'player2' ? selectedTrailId : opponentTrailId;
    }

    if (latestState.phase === 'playing') {
      trailHistory.push({
        x: ballCenterX,
        y: ballCenterY,
        w: ballW,
        h: ballH,
        trailId: activeTrailId || 'classic',
        time: performance.now(),
      });
      if (trailHistory.length > MAX_TRAIL_LENGTH) {
        trailHistory.shift();
      }
    } else {
      trailHistory.length = 0;
    }

    for (let i = 0; i < trailHistory.length; i++) {
      const p = trailHistory[i];
      const alpha = (i + 1) / trailHistory.length;
      drawTrailSegment(ctx, p, alpha, fgColor);
    }

    ctx.fillStyle = fgColor;
    ctx.fillRect(ballActualX, ballActualY, ballW, ballH);
  }
}

fetchHostInfo();
render();
