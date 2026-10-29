import { CONFIG } from './config.js';

// DOM elements
const container = document.getElementById('game-container');
const canvas = document.getElementById('court');
const ctx = canvas.getContext('2d');

const screenMenu = document.getElementById('screen-menu');
const screenWaiting = document.getElementById('screen-waiting');
const screenJoin = document.getElementById('screen-join');
const screenInventory = document.getElementById('screen-inventory');
const screenCountdown = document.getElementById('screen-countdown');
const screenGameOver = document.getElementById('screen-gameover');
const screenMessage = document.getElementById('screen-message');

const countdownNumber = document.getElementById('countdown-number');
const winnerBanner = document.getElementById('winner-banner');
const finalScore = document.getElementById('final-score');
const messageTitle = document.getElementById('message-title');
const messageText = document.getElementById('message-text');

const btnCreate = document.getElementById('btn-create');
const btnInventory = document.getElementById('btn-inventory');
const btnCancelInventory = document.getElementById('btn-cancel-inventory');
const btnShowJoin = document.getElementById('btn-show-join');
const btnCancelWaiting = document.getElementById('btn-cancel-waiting');
const btnConnect = document.getElementById('btn-connect');
const btnCancelJoin = document.getElementById('btn-cancel-join');
const btnRematch = document.getElementById('btn-rematch');
const btnMessageAck = document.getElementById('btn-message-ack');
const hostAddressInput = document.getElementById('host-address');
const themeToggleBtn = document.getElementById('theme-toggle');

const inventoryColorsContainer = document.getElementById('inventory-colors');
const previewPaddle = document.getElementById('preview-paddle');
const previewColorName = document.getElementById('preview-color-name');

const infoMdns = document.getElementById('info-mdns');
const infoIp = document.getElementById('info-ip');

// State
let ws = null;
let myRole = null; // 'player1' (Host, top) | 'player2' (Guest, bottom)
let latestState = null;
let lastSentPaddleX = null;
let lastPaddleSendTime = 0;
let hostInfo = null;

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

let selectedColorId = localStorage.getItem('pong-paddle-color') || 'default';
let opponentColorId = null;

function getColorObj(id) {
  return PADDLE_COLORS.find((c) => c.id === id) || PADDLE_COLORS[0];
}

function resolveColorHex(colorId, fallbackHex) {
  const c = getColorObj(colorId);
  return c.hex || fallbackHex;
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
    updatePreview(selectedColorId);
  });
}

// Inventory management
function initInventory() {
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
      updatePreview(color.id);
    });

    btn.addEventListener('mouseleave', () => {
      updatePreview(selectedColorId);
    });

    btn.addEventListener('click', () => {
      selectedColorId = color.id;
      localStorage.setItem('pong-paddle-color', selectedColorId);
      updateInventoryActiveBtn();
      updatePreview(selectedColorId);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'customize', color: selectedColorId }));
      }
    });

    inventoryColorsContainer.appendChild(btn);
  });

  updatePreview(selectedColorId);
}

function updateInventoryActiveBtn() {
  const buttons = inventoryColorsContainer?.querySelectorAll('.color-option');
  buttons?.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.colorId === selectedColorId);
  });
}

function updatePreview(colorId) {
  const color = getColorObj(colorId);
  if (previewColorName) {
    previewColorName.textContent = color.name;
  }
  if (previewPaddle) {
    const isLight = document.body.classList.contains('light-mode');
    const fg = isLight ? '#000000' : '#FFFFFF';
    previewPaddle.style.backgroundColor = color.hex || fg;
  }
}

// Screen management
function showScreen(screen) {
  [screenMenu, screenWaiting, screenJoin, screenInventory, screenCountdown, screenGameOver, screenMessage].forEach((s) => {
    s?.classList.remove('active');
  });
  if (screen) {
    screen.classList.add('active');
  }

  // Update mouse cursor visibility
  if (!screen && (latestState?.phase === 'playing' || latestState?.phase === 'countdown')) {
    container.classList.add('in-game');
  } else {
    container.classList.remove('in-game');
  }

  // Toggle button visibility: show only on Start Menu, Waiting for Opponent, Join Match, and Inventory
  if (themeToggleBtn) {
    const isAllowedScreen = screen === screenMenu || screen === screenWaiting || screen === screenJoin || screen === screenInventory;
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
    // If not running directly from host server, fallback to current window location
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

// Coordinate transformation helpers
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

// Mouse input handler
container.addEventListener('mousemove', (event) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!latestState || (latestState.phase !== 'playing' && latestState.phase !== 'countdown')) return;

  const rect = container.getBoundingClientRect();
  const mouseScreenX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  const normalizedScreenX = mouseScreenX / rect.width;

  // Convert to canonical X
  // For Host (Player 1, 180° rotated): canonicalX = 1 - normalizedScreenX
  // For Guest (Player 2, direct): canonicalX = normalizedScreenX
  const canonicalX = myRole === 'player1' ? 1.0 - normalizedScreenX : normalizedScreenX;

  // Throttle sends to ~60Hz
  const now = performance.now();
  if (now - lastPaddleSendTime >= 16 || lastSentPaddleX === null) {
    if (Math.abs(canonicalX - (lastSentPaddleX || 0)) > 0.001) {
      ws.send(JSON.stringify({ type: 'paddle', x: canonicalX }));
      lastSentPaddleX = canonicalX;
      lastPaddleSendTime = now;
    }
  }
});

// WebSocket connection
function connect(address) {
  const host = address || window.location.host || 'localhost:8080';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${host}`;

  if (ws) {
    ws.close();
  }

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('Connected to Pong server at', wsUrl);
    if (selectedColorId && selectedColorId !== 'default') {
      ws.send(JSON.stringify({ type: 'customize', color: selectedColorId }));
    }
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
    console.log('WebSocket connection closed:', event.code, event.reason);
    if (event.reason === 'Match full') {
      messageTitle.textContent = 'MATCH FULL';
      messageText.textContent = 'A 2-player match is already in progress on this host.';
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
      latestState = msg.state;
      if (msg.colors) {
        const oppRole = myRole === 'player1' ? 'player2' : 'player1';
        opponentColorId = msg.colors[oppRole] || null;
      }
      if (myRole === 'player1') {
        showScreen(screenWaiting);
      }
      break;

    case 'start':
      if (msg.role) {
        myRole = msg.role;
      }
      if (msg.colors) {
        const oppRole = myRole === 'player1' ? 'player2' : 'player1';
        opponentColorId = msg.colors[oppRole] || null;
      }
      latestState = msg.state;
      finalScore.textContent = '0 - 0';
      showScreen(screenCountdown);
      container.classList.add('in-game');
      break;

    case 'player_custom':
      if (msg.role && msg.role !== myRole) {
        opponentColorId = msg.color;
      }
      break;

    case 'state':
      latestState = msg.state;
      updateGameState();
      break;

    case 'point':
      latestState = msg.state;
      updateGameState();
      break;

    case 'end':
      latestState = msg.state;
      handleMatchEnd(msg.winner, msg.score);
      break;

    case 'opponent_disconnected':
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

  if (latestState.phase === 'countdown') {
    showScreen(screenCountdown);
    countdownNumber.textContent = latestState.countdownTimer;
    container.classList.add('in-game');
  } else if (latestState.phase === 'playing') {
    showScreen(null);
    container.classList.add('in-game');
  } else if (latestState.phase === 'ended') {
    handleMatchEnd(latestState.winner, latestState.score);
  }
}

function handleMatchEnd(winner, score) {
  const currentScore = score || latestState?.score || { player1: 0, player2: 0 };
  const isWinner = winner === myRole;
  winnerBanner.textContent = isWinner ? 'YOU WON!' : 'OPPONENT WON!';

  const myScore = myRole === 'player1' ? (currentScore.player1 ?? 0) : (currentScore.player2 ?? 0);
  const oppScore = myRole === 'player1' ? (currentScore.player2 ?? 0) : (currentScore.player1 ?? 0);
  finalScore.textContent = `${myScore} - ${oppScore}`;

  showScreen(screenGameOver);
}

// UI Button actions
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

btnRematch.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'rematch' }));
  }
});

btnMessageAck.addEventListener('click', () => {
  latestState = null;
  if (ws) ws.close();
  showScreen(screenMenu);
});

// Rendering Loop
function render() {
  requestAnimationFrame(render);

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
  ctx.setLineDash([]); // Reset line dash

  // Scores
  if (latestState) {
    const p1Score = latestState.score.player1;
    const p2Score = latestState.score.player2;

    const myScore = myRole === 'player1' ? p1Score : p2Score;
    const oppScore = myRole === 'player1' ? p2Score : p1Score;

    ctx.fillStyle = fgColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Opponent score (Top half)
    ctx.font = 'bold 12px Consolas, Courier, monospace';
    ctx.fillText('OPPONENT', W / 2, H * 0.22);
    ctx.font = 'bold 44px Consolas, Courier, monospace';
    ctx.fillText(String(oppScore), W / 2, H * 0.32);

    // My score (Bottom half)
    ctx.font = 'bold 44px Consolas, Courier, monospace';
    ctx.fillText(String(myScore), W / 2, H * 0.68);
    ctx.font = 'bold 12px Consolas, Courier, monospace';
    ctx.fillText('YOU', W / 2, H * 0.78);
  }

  // Draw paddles and ball only when game state is active
  if (latestState) {
    const paddleW = CONFIG.PADDLE_WIDTH * W;
    const paddleH = CONFIG.PADDLE_HEIGHT * H;

    // Paddle 1 (Host) canonical Y = 0.03
    const p1Y_screen = toScreenY(0.03);
    const p1X_screen = toScreenX(latestState.paddles.player1);

    // Paddle 2 (Guest) canonical Y = 1 - 0.03 - PADDLE_HEIGHT
    const p2Y_screen = toScreenY(1.0 - 0.03 - CONFIG.PADDLE_HEIGHT);
    const p2X_screen = toScreenX(latestState.paddles.player2);

    const myPaddleColor = resolveColorHex(selectedColorId, fgColor);
    const oppPaddleColor = resolveColorHex(opponentColorId, fgColor);

    const p1Color = myRole === 'player1' ? myPaddleColor : oppPaddleColor;
    const p2Color = myRole === 'player2' ? myPaddleColor : oppPaddleColor;

    // When Host is rotated 180°, top & bottom swap visually:
    // P1 (Host) is rendered at bottom: p1Y_screen - paddleH
    // P2 (Guest) is rendered at top: p2Y_screen
    if (myRole === 'player1') {
      // Host view: P1 (self) is at bottom
      ctx.fillStyle = p1Color;
      ctx.fillRect(p1X_screen - paddleW / 2, p1Y_screen - paddleH, paddleW, paddleH);
      // P2 (opponent) is at top
      ctx.fillStyle = p2Color;
      ctx.fillRect(p2X_screen - paddleW / 2, p2Y_screen, paddleW, paddleH);
    } else {
      // Guest view: P1 (opponent) is at top
      ctx.fillStyle = p1Color;
      ctx.fillRect(p1X_screen - paddleW / 2, p1Y_screen, paddleW, paddleH);
      // P2 (self) is at bottom
      ctx.fillStyle = p2Color;
      ctx.fillRect(p2X_screen - paddleW / 2, p2Y_screen, paddleW, paddleH);
    }

    // Ball (theme square)
    ctx.fillStyle = fgColor;
    const ballW = CONFIG.BALL_SIZE * W;
    const ballH = CONFIG.BALL_SIZE * CONFIG.COURT_ASPECT_RATIO * H;
    const ballScreenX = toScreenX(latestState.ball.x);
    const ballScreenY = toScreenY(latestState.ball.y);

    if (myRole === 'player1') {
      // Offset by ball dimension when inverted
      ctx.fillRect(ballScreenX - ballW, ballScreenY - ballH, ballW, ballH);
    } else {
      ctx.fillRect(ballScreenX, ballScreenY, ballW, ballH);
    }
  }
}

// Initial setup
fetchHostInfo();
render();
