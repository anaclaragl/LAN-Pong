import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { PongServer } from '../src/server.js';

process.env.NODE_ENV = 'test';

test('Connect 4: 2-player network game flow, moves, turn enforcement, and win', async () => {
  const server = new PongServer(0, { maxConnectionsPerIp: 10, countdownSeconds: 0.05 });
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

    // Wait for lobby message
    await new Promise((res) => setTimeout(res, 50));
    assert.ok(p1Msgs.some((m) => m.type === 'lobby'));

    // Both vote for connect4
    p1.send(JSON.stringify({ type: 'vote', gameId: 'connect4' }));
    p2.send(JSON.stringify({ type: 'vote', gameId: 'connect4' }));

    // Wait for countdown + game_start
    await new Promise((res) => setTimeout(res, 120));
    const p1Start = p1Msgs.find((m) => m.type === 'game_start');
    assert.ok(p1Start, 'Should receive game_start');
    assert.equal(p1Start.gameId, 'connect4');

    // Test turn rejection: Player 2 attempts move first out of turn
    p2.send(JSON.stringify({ type: 'move', column: 3 }));
    await new Promise((res) => setTimeout(res, 30));
    assert.equal(server.currentGame.board[5][3], null, 'Move out of turn should be rejected');

    // Player 1 drops in column 0
    p1.send(JSON.stringify({ type: 'move', column: 0 }));
    await new Promise((res) => setTimeout(res, 30));
    assert.equal(server.currentGame.board[5][0], 'player1');
    assert.equal(server.currentGame.currentPlayer, 'player2');

    // Player 2 drops in column 1
    p2.send(JSON.stringify({ type: 'move', column: 1 }));
    await new Promise((res) => setTimeout(res, 30));
    assert.equal(server.currentGame.board[5][1], 'player2');
    assert.equal(server.currentGame.currentPlayer, 'player1');

    // Simulate winning sequence for Player 1: columns 0, 0, 0 (vertical win)
    p1.send(JSON.stringify({ type: 'move', column: 0 }));
    await new Promise((res) => setTimeout(res, 20));
    p2.send(JSON.stringify({ type: 'move', column: 1 }));
    await new Promise((res) => setTimeout(res, 20));

    p1.send(JSON.stringify({ type: 'move', column: 0 }));
    await new Promise((res) => setTimeout(res, 20));
    p2.send(JSON.stringify({ type: 'move', column: 1 }));
    await new Promise((res) => setTimeout(res, 20));

    // 4th piece in column 0 by Player 1
    p1.send(JSON.stringify({ type: 'move', column: 0 }));
    await new Promise((res) => setTimeout(res, 40));

    const endMsg = p1Msgs.find((m) => m.type === 'end');
    assert.ok(endMsg, 'Should broadcast end message');
    assert.equal(endMsg.result, 'win');
    assert.equal(endMsg.winner, 'player1');
    assert.equal(server.currentGame.scores.player1, 1);

    // Test Rematch voting: p1 sends rematch -> returns both to lobby
    p1.send(JSON.stringify({ type: 'rematch' }));
    await new Promise((res) => setTimeout(res, 40));

    const lobbyAfterRematch = p1Msgs.filter((m) => m.type === 'lobby');
    assert.ok(lobbyAfterRematch.length >= 2, 'Should return to lobby upon rematch request');

    p1.close();
    p2.close();
  } finally {
    server.stop();
  }
});

