import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { PongServer } from '../src/server.js';

process.env.NODE_ENV = 'test';

test('Lobby voting: broadcasts independent votes in real time even when players vote for different games', async () => {
  const server = new PongServer(0, { maxConnectionsPerIp: 10, countdownSeconds: 2 });
  const port = await server.start();
  const wsUrl = `ws://127.0.0.1:${port}`;

  try {
    const p1 = new WebSocket(wsUrl);
    const p1Msgs = [];
    p1.on('message', (d) => p1Msgs.push(JSON.parse(d.toString())));
    await new Promise((res) => p1.on('open', res));

    const p2 = new WebSocket(wsUrl);
    const p2Msgs = [];
    p2.on('message', (d) => p2Msgs.push(JSON.parse(d.toString())));
    await new Promise((res) => p2.on('open', res));

    // Both connect -> lobby message
    await new Promise((res) => setTimeout(res, 50));
    assert.ok(p1Msgs.some((m) => m.type === 'lobby'));
    assert.ok(p2Msgs.some((m) => m.type === 'lobby'));

    // Step 1: Host votes for 'pong' while guest has not voted
    p1.send(JSON.stringify({ type: 'vote', gameId: 'pong' }));
    await new Promise((res) => setTimeout(res, 50));

    const p1Vote1 = p1Msgs.filter((m) => m.type === 'votes').at(-1);
    const p2Vote1 = p2Msgs.filter((m) => m.type === 'votes').at(-1);
    assert.ok(p1Vote1, 'p1 should receive votes message after voting');
    assert.ok(p2Vote1, 'p2 should receive votes message when opponent votes');
    assert.equal(p1Vote1.host, 'pong');
    assert.equal(p1Vote1.guest, null);
    assert.equal(p2Vote1.host, 'pong');
    assert.equal(p2Vote1.guest, null);

    // Step 2: Guest votes for 'connect4' (different game!)
    p2.send(JSON.stringify({ type: 'vote', gameId: 'connect4' }));
    await new Promise((res) => setTimeout(res, 50));

    const p1Vote2 = p1Msgs.filter((m) => m.type === 'votes').at(-1);
    const p2Vote2 = p2Msgs.filter((m) => m.type === 'votes').at(-1);
    assert.equal(p1Vote2.host, 'pong', 'Host vote should still be pong');
    assert.equal(p1Vote2.guest, 'connect4', 'Guest vote should be connect4');
    assert.equal(p2Vote2.host, 'pong');
    assert.equal(p2Vote2.guest, 'connect4');
    assert.equal(p1Vote2.countdown, null, 'No countdown when votes differ');

    // Step 3: Host changes vote to 'connect4' (agreement!)
    p1.send(JSON.stringify({ type: 'vote', gameId: 'connect4' }));
    await new Promise((res) => setTimeout(res, 50));

    const p1Vote3 = p1Msgs.filter((m) => m.type === 'votes').at(-1);
    assert.equal(p1Vote3.host, 'connect4');
    assert.equal(p1Vote3.guest, 'connect4');
    assert.ok(p1Vote3.countdown > 0, 'Countdown should begin on agreement');

    p1.close();
    p2.close();
  } finally {
    server.stop();
  }
});

