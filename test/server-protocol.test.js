import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { PongServer } from '../src/server.js';

test('PongServer starts and serves /api/info and static assets', async () => {
  const server = new PongServer(0); // 0 lets OS assign free port
  const port = await server.start();

  try {
    const resInfo = await fetch(`http://127.0.0.1:${port}/api/info`);
    assert.equal(resInfo.status, 200);
    const data = await resInfo.json();
    assert.equal(data.hostname, 'pong');
    assert.ok(data.localIP);
    assert.equal(data.port, port);

    // Verify index.html
    const resHtml = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(resHtml.status, 200);
    assert.ok(resHtml.headers.get('content-type').includes('text/html'));
    const htmlText = await resHtml.text();
    assert.ok(htmlText.includes('<canvas id="court">'));

    // Verify style.css
    const resCss = await fetch(`http://127.0.0.1:${port}/style.css`);
    assert.equal(resCss.status, 200);
    assert.ok(resCss.headers.get('content-type').includes('text/css'));

    // Verify client.js
    const resJs = await fetch(`http://127.0.0.1:${port}/client.js`);
    assert.equal(resJs.status, 200);
    assert.ok(resJs.headers.get('content-type').includes('application/javascript'));

    // Verify config.js
    const resConfig = await fetch(`http://127.0.0.1:${port}/config.js`);
    assert.equal(resConfig.status, 200);
    assert.ok(resConfig.headers.get('content-type').includes('application/javascript'));
  } finally {
    server.stop();
  }
});

test('PongServer manages 2-player match lifecycle and rejects 3rd player', async () => {
  const server = new PongServer(0);
  const port = await server.start();

  const wsUrl = `ws://127.0.0.1:${port}`;

  try {
    // 1. Connect Player 1
    const p1 = new WebSocket(wsUrl);
    const p1Messages = [];
    p1.on('message', (d) => p1Messages.push(JSON.parse(d.toString())));

    await new Promise((res) => p1.on('open', res));

    // Wait for assigned message
    await new Promise((res) => setTimeout(res, 50));
    assert.ok(p1Messages.some((m) => m.type === 'assigned' && m.role === 'player1'));

    // 2. Connect Player 2
    const p2 = new WebSocket(wsUrl);
    const p2Messages = [];
    p2.on('message', (d) => p2Messages.push(JSON.parse(d.toString())));

    await new Promise((res) => p2.on('open', res));

    // Both should receive 'start' message
    await new Promise((res) => setTimeout(res, 100));

    const p1Start = p1Messages.find((m) => m.type === 'start');
    const p2Start = p2Messages.find((m) => m.type === 'start');

    assert.ok(p1Start, 'Player 1 should receive start message');
    assert.equal(p1Start.role, 'player1');

    assert.ok(p2Start, 'Player 2 should receive start message');
    assert.equal(p2Start.role, 'player2');

    // 3. Connect 3rd player (should be rejected)
    const p3 = new WebSocket(wsUrl);
    const p3Messages = [];
    p3.on('message', (d) => p3Messages.push(JSON.parse(d.toString())));

    const p3Closed = new Promise((resolve) => {
      p3.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    const closeInfo = await p3Closed;
    assert.ok(
      p3Messages.some((m) => m.type === 'error' && m.message === 'Match full'),
      'Player 3 should receive match full error'
    );
    assert.equal(closeInfo.reason, 'Match full');

    // 4. Test paddle movement message
    p1.send(JSON.stringify({ type: 'paddle', x: 0.75 }));
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(server.engine.state.paddles.player1, 0.75);

    // 5. Test disconnection handling
    p2.close();
    await new Promise((res) => setTimeout(res, 50));

    const p1DisconnectMsg = p1Messages.find((m) => m.type === 'opponent_disconnected');
    assert.ok(p1DisconnectMsg, 'Player 1 should be notified of opponent disconnection');
    assert.equal(server.engine.state.phase, 'paused');

    p1.close();
  } finally {
    server.stop();
  }
});
