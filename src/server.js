import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Bonjour } from 'bonjour-service';
import { CONFIG } from './shared/config.js';
import { GAME_REGISTRY } from './shared/registry.js';
import { LobbyManager } from './lobby/lobby-manager.js';
import { PongGameModule } from './games/pong/index.js';
import { Connect4Module } from './games/connect4/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

export function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name];
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

export function createHttpHandler(serverInstance) {
  return (req, res) => {
    let reqPath = req.url.split('?')[0];

    // API endpoint for match info
    if (reqPath === '/api/info') {
      const localIP = getLocalIP();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          hostname: CONFIG.HOST_NAME,
          localIP,
          port: req.socket.localPort,
        })
      );
      return;
    }

    if (reqPath === '/' || reqPath === '') {
      reqPath = '/index.html';
    }

    let filePath;
    if (reqPath === '/config.js') {
      filePath = path.join(rootDir, 'src', 'shared', 'config.js');
    } else if (
      reqPath.startsWith('/src/shared/') ||
      reqPath.startsWith('/src/engine/') ||
      reqPath.startsWith('/src/ai/') ||
      reqPath.startsWith('/src/games/') ||
      reqPath.startsWith('/src/lobby/')
    ) {
      filePath = path.join(rootDir, reqPath);
    } else {
      filePath = path.join(publicDir, reqPath);
    }

    // Prevent directory traversal
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('500 Internal Server Error');
        }
        return;
      }

      const ext = path.extname(filePath);
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    });
  };
}

export class PongServer {
  constructor(port = CONFIG.PORT, options = {}) {
    this.initialPort = port;
    this.port = port;
    this.clients = {
      player1: null, // Host (WebSocket)
      player2: null, // Guest (WebSocket)
    };
    this.ipConnections = new Map();
    this.maxConnectionsPerIp = options.maxConnectionsPerIp ?? CONFIG.SECURITY?.MAX_CONNECTIONS_PER_IP ?? 2;

    this.currentGameId = null;
    this.currentGame = null;
    this.gameLoopInterval = null;
    this._defaultEngine = new PongGameModule().engine;

    // Connect 4 persistent session scores
    this.connect4Scores = { player1: 0, player2: 0 };

    this.lobby = new LobbyManager({
      countdownSeconds: options.countdownSeconds ?? CONFIG.GAME_START_COUNTDOWN_SECONDS ?? 2,
    });

    this.lobby.onVoteChangeCallback = (data) => {
      this.broadcast({
        type: 'votes',
        ...data.votes,
        countdown: data.countdown,
        selectedGame: data.selectedGame,
      });
    };

    this.lobby.onGameStartCallback = (gameId) => {
      this.launchGame(gameId);
    };

    this.bonjour = null;
    this.httpServer = null;
    this.wss = null;
  }

  // Backwards compatibility getter for test suite
  get engine() {
    if (this.currentGameId === 'pong' && this.currentGame) {
      return this.currentGame.engine;
    }
    // Return a default engine if none is active
    if (!this._defaultEngine) {
      this._defaultEngine = new PongGameModule().engine;
    }
    return this._defaultEngine;
  }

  async start() {
    return new Promise((resolve, reject) => {
      const tryPort = (portToTry) => {
        const server = http.createServer(createHttpHandler(this));

        server.once('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.log(`Port ${portToTry} in use, trying ${portToTry + 1}...`);
            tryPort(portToTry + 1);
          } else {
            reject(err);
          }
        });

        server.listen(portToTry, '0.0.0.0', () => {
          this.port = server.address().port;
          this.httpServer = server;
          this.setupWebSocketServer();
          if (this.port > 0 && process.env.NODE_ENV !== 'test') {
            this.startMDNS();
          }
          resolve(this.port);
        });
      };

      tryPort(this.initialPort);
    });
  }

  setupWebSocketServer() {
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws, req) => {
      // 1. IP Connection Limiting
      const clientIp = req?.socket?.remoteAddress || '127.0.0.1';
      const currentIpCount = this.ipConnections.get(clientIp) || 0;
      const maxPerIp = this.maxConnectionsPerIp;

      if (currentIpCount >= maxPerIp) {
        ws.send(JSON.stringify({ type: 'error', message: 'Too many connections from this IP' }));
        ws.close(1008, 'Too many connections from this IP');
        return;
      }

      this.ipConnections.set(clientIp, currentIpCount + 1);
      ws.clientIp = clientIp;

      // Rate limit tracker per socket
      ws.rateLimit = {
        count: 0,
        windowStart: Date.now(),
      };

      // Anti-teleport / paddle tracking
      ws.lastPaddleX = 0.5;
      ws.lastPaddleTime = performance.now();

      ws.on('close', () => {
        if (ws.clientIp) {
          const count = this.ipConnections.get(ws.clientIp) || 1;
          if (count <= 1) {
            this.ipConnections.delete(ws.clientIp);
          } else {
            this.ipConnections.set(ws.clientIp, count - 1);
          }
          ws.clientIp = null;
        }
        this.handleClientDisconnect(ws);
      });

      // Determine player slot
      let role = null;
      if (!this.clients.player1 || this.clients.player1.readyState !== WebSocket.OPEN) {
        role = 'player1';
        this.clients.player1 = ws;
      } else if (!this.clients.player2 || this.clients.player2.readyState !== WebSocket.OPEN) {
        role = 'player2';
        this.clients.player2 = ws;
      } else {
        // Match is full
        ws.send(JSON.stringify({ type: 'error', message: 'Match full' }));
        ws.close(1008, 'Match full');
        return;
      }

      ws.role = role;

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(ws, message);
        } catch (e) {
          console.error('Invalid message received:', e.message);
        }
      });

      // Notify player of connection assignment and registry
      ws.send(
        JSON.stringify({
          type: 'assigned',
          role: ws.role,
          config: CONFIG,
          registry: GAME_REGISTRY,
          colors: {
            player1: this.clients.player1?.customColor || null,
            trails_player1: this.clients.player1?.customTrail || null,
            player2: this.clients.player2?.customColor || null,
            trails_player2: this.clients.player2?.customTrail || null,
          },
        })
      );

      // If both players are connected, transition to Lobby Screen
      if (
        this.clients.player1 &&
        this.clients.player1.readyState === WebSocket.OPEN &&
        this.clients.player2 &&
        this.clients.player2.readyState === WebSocket.OPEN
      ) {
        this.enterLobby();
      }
    });
  }

  enterLobby() {
    if (this._defaultEngine) {
      this._defaultEngine.state.phase = 'paused';
    }
    if (this.currentGame?.engine) {
      this.currentGame.engine.state.phase = 'paused';
    }

    this.stopCurrentGame();
    this.lobby.reset();

    this.broadcast({
      type: 'lobby',
      registry: GAME_REGISTRY,
      votes: this.lobby.getVotes(),
      config: CONFIG,
      colors: {
        player1: this.clients.player1?.customColor || null,
        player2: this.clients.player2?.customColor || null,
      },
    });
  }

  handleClientMessage(ws, message) {
    if (!message || typeof message !== 'object') return;

    // Rate limiting
    const nowMs = Date.now();
    const maxRate = CONFIG.SECURITY?.MAX_PADDLE_RATE_PER_SEC ?? 70;
    if (!ws.rateLimit) {
      ws.rateLimit = { count: 0, windowStart: nowMs };
    }
    if (nowMs - ws.rateLimit.windowStart >= 1000) {
      ws.rateLimit.windowStart = nowMs;
      ws.rateLimit.count = 0;
    }
    ws.rateLimit.count++;
    if (ws.rateLimit.count > maxRate) {
      return;
    }

    switch (message.type) {
      // 1. Lobby voting message: { type: 'vote', gameId: string | null }
      case 'vote': {
        const gameId = message.gameId === undefined ? null : message.gameId;
        this.lobby.setVote(ws.role, gameId);
        break;
      }

      // 2. Pong paddle movement
      case 'paddle': {
        if (typeof message.x !== 'number' || !Number.isFinite(message.x) || message.x < 0.0 || message.x > 1.0) {
          return;
        }

        const nowPerf = performance.now();
        const minDt = CONFIG.SECURITY?.MIN_DELTA_TIME_SEC ?? 0.005;
        const maxSpeed = CONFIG.SECURITY?.MAX_PADDLE_SPEED ?? 5.0;
        const jitterTol = CONFIG.SECURITY?.JITTER_TOLERANCE ?? 0.05;

        const dt = Math.max(minDt, (nowPerf - (ws.lastPaddleTime ?? nowPerf)) / 1000);
        const maxAllowedDist = (maxSpeed * dt) + jitterTol;
        const currentX = ws.lastPaddleX ?? 0.5;
        const deltaX = message.x - currentX;
        const dist = Math.abs(deltaX);

        let targetX = message.x;
        if (dist > maxAllowedDist) {
          targetX = currentX + Math.sign(deltaX) * maxAllowedDist;
        }

        ws.lastPaddleX = targetX;
        ws.lastPaddleTime = nowPerf;

        if (this.currentGame && this.currentGameId === 'pong') {
          this.currentGame.onInput(ws.role, { type: 'paddle', x: targetX });
        } else if (this._defaultEngine) {
          this._defaultEngine.setPaddlePosition(ws.role, targetX);
        }
        break;
      }

      // 3. Connect 4 move message: { type: 'move', column: number }
      case 'move': {
        if (this.currentGame && this.currentGameId === 'connect4') {
          const res = this.currentGame.onInput(ws.role, { type: 'move', column: message.column });
          if (res.success) {
            const state = this.currentGame.getState();
            this.broadcast({
              type: 'state',
              board: state.board,
              currentPlayer: state.currentPlayer,
              status: state.status,
              winningCells: state.winningCells,
              scores: state.scores,
              lastMove: state.lastMove,
            });

            if (state.status === 'win' || state.status === 'draw') {
              this.broadcast({
                type: 'end',
                result: state.status,
                winner: state.winner,
                winningCells: state.winningCells,
                scores: state.scores,
              });
            }
          }
        }
        break;
      }

      case 'customize': {
        if (typeof message.color === 'string') {
          ws.customColor = message.color;
        }
        if (typeof message.trail === 'string') {
          ws.customTrail = message.trail;
        }
        if (ws.customColor || ws.customTrail) {
          this.broadcast({
            type: 'player_custom',
            role: ws.role,
            color: ws.customColor || null,
            trail: ws.customTrail || null,
          });
        }
        break;
      }

      // Rematch: returns both players to lobby with cleared votes
      case 'rematch': {
        this.enterLobby();
        break;
      }
    }
  }

  handleClientDisconnect(ws) {
    if (ws.role === 'player1') {
      this.clients.player1 = null;
    } else if (ws.role === 'player2') {
      this.clients.player2 = null;
    }

    if (this._defaultEngine) {
      this._defaultEngine.state.phase = 'paused';
    }
    if (this.currentGame?.engine) {
      this.currentGame.engine.state.phase = 'paused';
    }

    this.stopCurrentGame();
    this.lobby.reset();

    this.broadcast({
      type: 'opponent_disconnected',
      disconnectedRole: ws.role,
      message: 'Opponent disconnected',
    });
  }

  launchGame(gameId) {
    this.stopCurrentGame();
    this.currentGameId = gameId;

    if (gameId === 'pong') {
      this.currentGame = new PongGameModule();
      this.currentGame.init();

      if (this.clients.player1) {
        this.clients.player1.lastPaddleX = 0.5;
        this.clients.player1.lastPaddleTime = performance.now();
      }
      if (this.clients.player2) {
        this.clients.player2.lastPaddleX = 0.5;
        this.clients.player2.lastPaddleTime = performance.now();
      }

      // Notify clients of game_start and pong 'start'
      this.broadcast({
        type: 'game_start',
        gameId: 'pong',
        config: CONFIG,
      });

      if (this.clients.player1?.readyState === WebSocket.OPEN) {
        this.clients.player1.send(
          JSON.stringify({
            type: 'start',
            role: 'player1',
            config: CONFIG,
            state: this.currentGame.getState(),
            colors: {
              player1: this.clients.player1?.customColor || null,
              trails_player1: this.clients.player1?.customTrail || null,
              player2: this.clients.player2?.customColor || null,
              trails_player2: this.clients.player2?.customTrail || null,
            },
          })
        );
      }

      if (this.clients.player2?.readyState === WebSocket.OPEN) {
        this.clients.player2.send(
          JSON.stringify({
            type: 'start',
            role: 'player2',
            config: CONFIG,
            state: this.currentGame.getState(),
            colors: {
              player1: this.clients.player1?.customColor || null,
              trails_player1: this.clients.player1?.customTrail || null,
              player2: this.clients.player2?.customColor || null,
              trails_player2: this.clients.player2?.customTrail || null,
            },
          })
        );
      }

      this.startGameLoop();
    } else if (gameId === 'connect4') {
      this.currentGame = new Connect4Module();
      // Reuse persisted scores
      this.currentGame.scores = this.connect4Scores;
      this.currentGame.init();

      this.broadcast({
        type: 'game_start',
        gameId: 'connect4',
        config: CONFIG,
        state: this.currentGame.getState(),
        colors: {
          player1: this.clients.player1?.customColor || null,
          player2: this.clients.player2?.customColor || null,
        },
      });
    }
  }

  startGameLoop() {
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
    }

    const intervalMs = 1000 / CONFIG.TICK_RATE_HZ;
    const deltaTime = 1 / CONFIG.TICK_RATE_HZ;

    this.gameLoopInterval = setInterval(() => {
      if (!this.currentGame || this.currentGameId !== 'pong') return;

      const event = this.currentGame.tick(deltaTime);
      const snapshot = this.currentGame.getState();

      if (event) {
        if (event.type === 'point') {
          this.broadcast({
            type: 'point',
            scorer: event.scorer,
            score: event.score,
            state: snapshot,
          });
        } else if (event.type === 'end') {
          this.broadcast({
            type: 'end',
            winner: event.winner,
            score: snapshot.score,
            state: snapshot,
          });
          clearInterval(this.gameLoopInterval);
          this.gameLoopInterval = null;
          return;
        }
      }

      this.broadcast({
        type: 'state',
        state: snapshot,
      });
    }, intervalMs);
  }

  stopCurrentGame() {
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
      this.gameLoopInterval = null;
    }
    this.currentGame = null;
    this.currentGameId = null;
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    if (this.clients.player1?.readyState === WebSocket.OPEN) {
      this.clients.player1.send(payload);
    }
    if (this.clients.player2?.readyState === WebSocket.OPEN) {
      this.clients.player2.send(payload);
    }
  }

  startMDNS() {
    try {
      this.bonjour = new Bonjour();
      this.bonjour.publish({
        name: CONFIG.HOST_NAME,
        type: 'http',
        port: this.port,
      });
      console.log(`mDNS announced: http://${CONFIG.HOST_NAME}.local:${this.port}`);
    } catch (err) {
      console.warn('mDNS announcement failed (LAN IP fallback available):', err.message);
    }
  }

  stop() {
    if (this._defaultEngine) {
      this._defaultEngine.state.phase = 'paused';
    }
    if (this.currentGame?.engine) {
      this.currentGame.engine.state.phase = 'paused';
    }

    this.stopCurrentGame();
    this.lobby.reset();

    if (this.bonjour) {
      try {
        this.bonjour.unpublishAll();
        this.bonjour.destroy();
      } catch (e) {}
    }

    if (this.clients.player1) {
      try { this.clients.player1.terminate(); } catch (e) {}
      this.clients.player1 = null;
    }
    if (this.clients.player2) {
      try { this.clients.player2.terminate(); } catch (e) {}
      this.clients.player2 = null;
    }

    if (this.wss) {
      for (const client of this.wss.clients) {
        try { client.terminate(); } catch (e) {}
      }
      this.wss.close();
      this.wss = null;
    }

    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer.closeAllConnections?.();
      this.httpServer = null;
    }

    this.ipConnections.clear();
  }
}

// Auto-run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = new PongServer(CONFIG.PORT);
  server.start().then((port) => {
    const ip = getLocalIP();
    console.log('====================================================');
    console.log(' LOCALPONG MULTI-GAME SERVER RUNNING (LAN)');
    console.log('====================================================');
    console.log(` Local access: http://localhost:${port}`);
    console.log(` mDNS access:  http://${CONFIG.HOST_NAME}.local:${port}`);
    console.log(` LAN IP access: http://${ip}:${port}`);
    console.log('====================================================');

    const cleanup = () => {
      console.log('\nShutting down server...');
      server.stop();
      process.exit();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
