import { CONFIG } from '../../shared/config.js';
import {
  createEmptyBoard,
  canDropPiece,
  dropPiece,
  evaluateBoardStatus,
} from './logic.js';

export class Connect4Module {
  constructor(customConfig = {}) {
    this.id = 'connect4';
    this.title = 'Connect 4';
    this.config = { ...CONFIG, ...customConfig };
    this.scores = { player1: 0, player2: 0 };
    this.startingPlayer = 'player1';
    this.init();
  }

  init(config) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    this.board = createEmptyBoard(this.config.CONNECT4_ROWS, this.config.CONNECT4_COLUMNS);
    this.currentPlayer = this.startingPlayer;
    this.status = 'playing'; // 'playing' | 'win' | 'draw'
    this.winner = null;
    this.winningCells = [];
    this.lastMove = null;
  }

  resetForRematch() {
    // Alternate starting player on rematch
    this.startingPlayer = this.startingPlayer === 'player1' ? 'player2' : 'player1';
    this.init();
  }

  // Common interface: onInput(player, input)
  // Input: { type: 'move', column: number }
  onInput(player, input) {
    if (this.status !== 'playing') {
      return { success: false, reason: 'Game finished' };
    }
    if (player !== this.currentPlayer) {
      return { success: false, reason: 'Out of turn' };
    }
    if (!input || typeof input.column !== 'number') {
      return { success: false, reason: 'Invalid column input' };
    }

    const col = input.column;
    if (!canDropPiece(this.board, col, this.config.CONNECT4_COLUMNS)) {
      return { success: false, reason: 'Column is full or invalid' };
    }

    const dropRes = dropPiece(
      this.board,
      col,
      player,
      this.config.CONNECT4_ROWS,
      this.config.CONNECT4_COLUMNS
    );

    if (!dropRes.success) {
      return { success: false, reason: 'Drop failed' };
    }

    this.board = dropRes.board;
    this.lastMove = { row: dropRes.row, col, player };

    const evalResult = evaluateBoardStatus(
      this.board,
      dropRes.row,
      col,
      this.config.CONNECT4_ROWS,
      this.config.CONNECT4_COLUMNS,
      this.config.CONNECT4_WIN_LENGTH
    );

    this.status = evalResult.status;
    this.winner = evalResult.winner;
    this.winningCells = evalResult.winningCells;

    if (this.status === 'win') {
      this.scores[this.winner] = (this.scores[this.winner] || 0) + 1;
    } else if (this.status === 'playing') {
      // Toggle player turn
      this.currentPlayer = this.currentPlayer === 'player1' ? 'player2' : 'player1';
    }

    return {
      success: true,
      row: dropRes.row,
      col,
      status: this.status,
      winner: this.winner,
      winningCells: this.winningCells,
    };
  }

  // Common interface: getState()
  getState() {
    return {
      board: this.board,
      currentPlayer: this.currentPlayer,
      status: this.status,
      winner: this.winner,
      winningCells: this.winningCells,
      scores: { ...this.scores },
      lastMove: this.lastMove,
    };
  }

  // Common interface: isFinished()
  isFinished() {
    return this.status === 'win' || this.status === 'draw';
  }

  // Optional tick() if game has physics; Connect 4 is turn-based so returns null
  tick(deltaTime) {
    return null;
  }
}

