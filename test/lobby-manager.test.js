import test from 'node:test';
import assert from 'node:assert/strict';
import { LobbyManager } from '../src/lobby/lobby-manager.js';

test('LobbyManager: records and toggles votes', () => {
  const lobby = new LobbyManager({ countdownSeconds: 2 });
  assert.deepEqual(lobby.getVotes(), { host: null, guest: null });

  // Host votes for Pong
  const r1 = lobby.setVote('player1', 'pong');
  assert.equal(r1.success, true);
  assert.deepEqual(lobby.getVotes(), { host: 'pong', guest: null });

  // Host clicks Pong again -> toggles off (null)
  const r2 = lobby.setVote('player1', 'pong');
  assert.equal(r2.success, true);
  assert.deepEqual(lobby.getVotes(), { host: null, guest: null });

  // Host votes Connect 4
  lobby.setVote('player1', 'connect4');
  assert.deepEqual(lobby.getVotes(), { host: 'connect4', guest: null });
});

test('LobbyManager: starts countdown only when both players vote for same game', (t, done) => {
  const lobby = new LobbyManager({ countdownSeconds: 1 });

  let countdownStarted = false;
  lobby.onVoteChangeCallback = (info) => {
    if (info.countdown !== null) {
      countdownStarted = true;
    }
  };

  lobby.onGameStartCallback = (gameId) => {
    assert.equal(gameId, 'connect4');
    done();
  };

  // Host votes connect4, Guest votes pong (diff)
  lobby.setVote('player1', 'connect4');
  lobby.setVote('player2', 'pong');
  assert.equal(countdownStarted, false);

  // Guest changes vote to connect4 (agree)
  lobby.setVote('player2', 'connect4');
  assert.equal(countdownStarted, true);
});

test('LobbyManager: changing vote cancels countdown if agreement is broken', () => {
  const lobby = new LobbyManager({ countdownSeconds: 3 });
  let cancelled = false;

  lobby.onVoteChangeCallback = (info) => {
    if (info.countdown === null && info.selectedGame === null) {
      cancelled = true;
    }
  };

  lobby.setVote('player1', 'pong');
  lobby.setVote('player2', 'pong');
  assert.equal(lobby.selectedGame, 'pong');

  // Guest unvotes
  lobby.setVote('player2', 'pong');
  assert.equal(cancelled, true);
  assert.equal(lobby.countdownTimer, null);
});

