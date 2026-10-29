import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { PongServer } from '../src/server.js';
import { CONFIG } from '../src/shared/config.js';

process.env.NODE_ENV = 'test';

test('Security: Rejects invalid, non-finite, and out-of-bounds paddle inputs', async () => {
  const server = new PongServer(0);
  const port = await server.start();
  const wsUrl = `ws://127.0.0.1:${port}`;

  try {
    const ws = new WebSocket(wsUrl);
    await new Promise((res) => ws.on('open', res));
    await new Promise((res) => setTimeout(res, 50));

    const initialPos = server.engine.state.paddles.player1;
    assert.equal(initialPos, 0.5);

    // Negative value
    ws.send(JSON.stringify({ type: 'paddle', x: -0.2 }));
    await new Promise((res) => setTimeout(res, 30));
    assert.equal(server.engine.state.paddles.player1, 0.5);

    // Greater than 1.0
    ws.send(JSON.stringify({ type: 'paddle', x: 1.2 }));
    await new Promise((res) => setTimeout(res, 30));
    assert.equal(server.engine.state.paddles.player1, 0.5);

    // NaN
    ws.send(JSON.stringify({ type: 'paddle', x: NaN }));
    await new Promise((res) => setTimeout(res, 30));
    assert.equal(server.engine.state.paddles.player1, 0.5);

    // String input
    ws.send(JSON.stringify({ type: 'paddle', x: '0.8' }));
    await new Promise((res) => setTimeout(res, 30));
    assert.equal(server.engine.state.paddles.player1, 0.5);

    ws.close();
  } finally {
    server.stop();
  }
});

test('Security: Anti-teleportation limits instant paddle jumps across the court', async () => {
  const server = new PongServer(0);
  const port = await server.start();
  const wsUrl = `ws://127.0.0.1:${port}`;

  try {
    const ws = new WebSocket(wsUrl);
    await new Promise((res) => ws.on('open', res));
    await new Promise((res) => setTimeout(res, 50));

    // Initial position is 0.5
    // Attempt instant jump to 0.95 immediately (0ms dt)
    ws.send(JSON.stringify({ type: 'paddle', x: 0.95 }));
    await new Promise((res) => setTimeout(res, 30));

    const posAfterJump = server.engine.state.paddles.player1;
    // Position must be clamped according to max speed + jitter tolerance, not teleported to 0.95
    assert.ok(
      posAfterJump < 0.9,
      `Paddle position should be clamped; got ${posAfterJump}, expected < 0.9`
    );
    assert.ok(
      posAfterJump > 0.5,
      `Paddle position should move towards target; got ${posAfterJump}, expected > 0.5`
    );

    ws.close();
  } finally {
    server.stop();
  }
});

test('Security: Rate limiting drops excess messages beyond configured limit', async () => {
  const server = new PongServer(0);
  const port = await server.start();
  const wsUrl = `ws://127.0.0.1:${port}`;

  try {
    const ws = new WebSocket(wsUrl);
    await new Promise((res) => ws.on('open', res));
    await new Promise((res) => setTimeout(res, 50));

    const playerSocket = server.clients.player1;
    assert.ok(playerSocket);

    // Send 100 messages rapidly in under 50ms
    const maxAllowed = CONFIG.SECURITY.MAX_PADDLE_RATE_PER_SEC; // 70
    for (let i = 0; i < 100; i++) {
      ws.send(JSON.stringify({ type: 'paddle', x: 0.5 }));
    }

    await new Promise((res) => setTimeout(res, 80));

    // Check that socket rateLimit counter registered attempts and excess were dropped
    assert.ok(playerSocket.rateLimit.count > maxAllowed);

    ws.close();
  } finally {
    server.stop();
  }
});

test('Security: Enforces connection limit per IP address', async () => {
  const server = new PongServer(0);
  const port = await server.start();
  const wsUrl = `ws://127.0.0.1:${port}`;

  try {
    // 1st connection from 127.0.0.1
    const ws1 = new WebSocket(wsUrl);
    await new Promise((res) => ws1.on('open', res));

    // 2nd connection from 127.0.0.1
    const ws2 = new WebSocket(wsUrl);
    await new Promise((res) => ws2.on('open', res));

    await new Promise((res) => setTimeout(res, 50));
    assert.equal(server.ipConnections.get('127.0.0.1') || server.ipConnections.get('::1') || server.ipConnections.get('::ffff:127.0.0.1'), 2);

    // 3rd connection from 127.0.0.1 should be rejected
    const ws3 = new WebSocket(wsUrl);
    const ws3Messages = [];
    ws3.on('message', (d) => ws3Messages.push(JSON.parse(d.toString())));

    const ws3Closed = new Promise((resolve) => {
      ws3.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    const closeInfo = await ws3Closed;
    assert.equal(closeInfo.code, 1008);
    assert.equal(closeInfo.reason, 'Too many connections from this IP');
    assert.ok(ws3Messages.some((m) => m.type === 'error' && m.message.includes('Too many connections')));

    // Close ws2 and verify a new connection can now connect
    ws2.close();
    await new Promise((res) => setTimeout(res, 50));

    const ws4 = new WebSocket(wsUrl);
    await new Promise((res) => ws4.on('open', res));
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(ws4.readyState, WebSocket.OPEN);

    ws1.close();
    ws4.close();
  } finally {
    server.stop();
  }
});

