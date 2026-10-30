import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyBoard,
  canDropPiece,
  dropPiece,
  isBoardFull,
  checkWin,
  evaluateBoardStatus,
} from '../src/games/connect4/logic.js';

test('Connect 4: initializes empty board with correct dimensions', () => {
  const board = createEmptyBoard(6, 7);
  assert.equal(board.length, 6);
  assert.equal(board[0].length, 7);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      assert.equal(board[r][c], null);
    }
  }
});

test('Connect 4: dropPiece drops into the lowest empty cell', () => {
  let board = createEmptyBoard(6, 7);

  // Drop 1 in column 3
  const res1 = dropPiece(board, 3, 'player1', 6, 7);
  assert.equal(res1.success, true);
  assert.equal(res1.row, 5); // bottom row
  board = res1.board;
  assert.equal(board[5][3], 'player1');

  // Drop 2 in column 3
  const res2 = dropPiece(board, 3, 'player2', 6, 7);
  assert.equal(res2.success, true);
  assert.equal(res2.row, 4); // one row above
  board = res2.board;
  assert.equal(board[4][3], 'player2');
});

test('Connect 4: rejects invalid column or full column', () => {
  let board = createEmptyBoard(6, 7);

  // Negative column
  assert.equal(canDropPiece(board, -1, 7), false);
  assert.equal(dropPiece(board, -1, 'player1', 6, 7).success, false);

  // Out of bounds column
  assert.equal(canDropPiece(board, 7, 7), false);
  assert.equal(dropPiece(board, 7, 'player1', 6, 7).success, false);

  // Fill column 0 (6 rows)
  for (let i = 0; i < 6; i++) {
    const res = dropPiece(board, 0, 'player1', 6, 7);
    assert.equal(res.success, true);
    board = res.board;
  }

  // 7th drop in column 0 must fail
  assert.equal(canDropPiece(board, 0, 7), false);
  const overflowRes = dropPiece(board, 0, 'player2', 6, 7);
  assert.equal(overflowRes.success, false);
});

test('Connect 4: detects horizontal win', () => {
  let board = createEmptyBoard(6, 7);
  // Place player1 pieces at (5, 0), (5, 1), (5, 2), (5, 3)
  for (let c = 0; c < 3; c++) {
    board = dropPiece(board, c, 'player1', 6, 7).board;
    const status = evaluateBoardStatus(board, 5, c, 6, 7, 4);
    assert.equal(status.status, 'playing');
  }

  // Winning drop at (5, 3)
  const dropRes = dropPiece(board, 3, 'player1', 6, 7);
  board = dropRes.board;
  const status = evaluateBoardStatus(board, dropRes.row, 3, 6, 7, 4);

  assert.equal(status.status, 'win');
  assert.equal(status.winner, 'player1');
  assert.equal(status.winningCells.length, 4);
});

test('Connect 4: detects vertical win', () => {
  let board = createEmptyBoard(6, 7);
  // Stack 4 player2 pieces in column 4: rows 5, 4, 3, 2
  for (let i = 0; i < 3; i++) {
    board = dropPiece(board, 4, 'player2', 6, 7).board;
    const status = evaluateBoardStatus(board, 5 - i, 4, 6, 7, 4);
    assert.equal(status.status, 'playing');
  }

  // 4th piece
  const dropRes = dropPiece(board, 4, 'player2', 6, 7);
  board = dropRes.board;
  const status = evaluateBoardStatus(board, dropRes.row, 4, 6, 7, 4);

  assert.equal(status.status, 'win');
  assert.equal(status.winner, 'player2');
  assert.equal(status.winningCells.length, 4);
});

test('Connect 4: detects diagonal down-right (\\) win', () => {
  let board = createEmptyBoard(6, 7);
  // Create setup for diagonal:
  // col 0: 1 p1 (row 5)
  // col 1: 1 other, 1 p1 (row 4)
  // col 2: 2 other, 1 p1 (row 3)
  // col 3: 3 other, 1 p1 (row 2)
  board = dropPiece(board, 0, 'player1', 6, 7).board;

  board = dropPiece(board, 1, 'player2', 6, 7).board;
  board = dropPiece(board, 1, 'player1', 6, 7).board;

  board = dropPiece(board, 2, 'player2', 6, 7).board;
  board = dropPiece(board, 2, 'player2', 6, 7).board;
  board = dropPiece(board, 2, 'player1', 6, 7).board;

  board = dropPiece(board, 3, 'player2', 6, 7).board;
  board = dropPiece(board, 3, 'player2', 6, 7).board;
  board = dropPiece(board, 3, 'player2', 6, 7).board;
  const finalDrop = dropPiece(board, 3, 'player1', 6, 7);
  board = finalDrop.board;

  const status = evaluateBoardStatus(board, finalDrop.row, 3, 6, 7, 4);
  assert.equal(status.status, 'win');
  assert.equal(status.winner, 'player1');
  assert.equal(status.winningCells.length, 4);
});

test('Connect 4: detects diagonal up-right (/) win', () => {
  let board = createEmptyBoard(6, 7);
  // Create setup for diagonal:
  // col 3: 1 p2 (row 5)
  // col 2: 1 other, 1 p2 (row 4)
  // col 1: 2 other, 1 p2 (row 3)
  // col 0: 3 other, 1 p2 (row 2)
  board = dropPiece(board, 3, 'player2', 6, 7).board;

  board = dropPiece(board, 2, 'player1', 6, 7).board;
  board = dropPiece(board, 2, 'player2', 6, 7).board;

  board = dropPiece(board, 1, 'player1', 6, 7).board;
  board = dropPiece(board, 1, 'player1', 6, 7).board;
  board = dropPiece(board, 1, 'player2', 6, 7).board;

  board = dropPiece(board, 0, 'player1', 6, 7).board;
  board = dropPiece(board, 0, 'player1', 6, 7).board;
  board = dropPiece(board, 0, 'player1', 6, 7).board;
  const finalDrop = dropPiece(board, 0, 'player2', 6, 7);
  board = finalDrop.board;

  const status = evaluateBoardStatus(board, finalDrop.row, 0, 6, 7, 4);
  assert.equal(status.status, 'win');
  assert.equal(status.winner, 'player2');
  assert.equal(status.winningCells.length, 4);
});

test('Connect 4: detects draw when board is completely filled without winner', () => {
  // Fill 6x7 with a known draw pattern:
  // e.g. alternate 1 1 2 2 1 1 2 ...
  let board = createEmptyBoard(6, 7);
  const pattern = [
    ['player1', 'player1', 'player2', 'player2', 'player1', 'player1', 'player2'],
    ['player2', 'player2', 'player1', 'player1', 'player2', 'player2', 'player1'],
    ['player1', 'player1', 'player2', 'player2', 'player1', 'player1', 'player2'],
    ['player2', 'player2', 'player1', 'player1', 'player2', 'player2', 'player1'],
    ['player1', 'player1', 'player2', 'player2', 'player1', 'player1', 'player2'],
    ['player2', 'player2', 'player1', 'player1', 'player2', 'player2', 'player1'],
  ];

  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      board[r][c] = pattern[r][c];
    }
  }

  assert.equal(isBoardFull(board, 7), true);
  // Verify no winner
  const status = evaluateBoardStatus(board, 0, 6, 6, 7, 4);
  assert.equal(status.status, 'draw');
  assert.equal(status.winner, null);
});

