// Pure Connect 4 Game Logic
import { CONFIG } from '../../shared/config.js';

export function createEmptyBoard(rows = CONFIG.CONNECT4_ROWS, cols = CONFIG.CONNECT4_COLUMNS) {
  // 2D array: rows x cols. null represents an empty cell.
  // Row 0 is the top row; Row (rows - 1) is the bottom row.
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

export function isValidColumn(col, cols = CONFIG.CONNECT4_COLUMNS) {
  return Number.isInteger(col) && col >= 0 && col < cols;
}

export function canDropPiece(board, col, cols = CONFIG.CONNECT4_COLUMNS) {
  if (!isValidColumn(col, cols)) return false;
  // If top cell is empty, the column is not full
  return board[0][col] === null;
}

export function getLowestEmptyRow(board, col, rows = CONFIG.CONNECT4_ROWS) {
  if (board[0][col] !== null) return -1;
  for (let r = rows - 1; r >= 0; r--) {
    if (board[r][col] === null) {
      return r;
    }
  }
  return -1;
}

export function dropPiece(board, col, player, rows = CONFIG.CONNECT4_ROWS, cols = CONFIG.CONNECT4_COLUMNS) {
  if (!canDropPiece(board, col, cols)) {
    return { success: false, row: -1 };
  }
  const row = getLowestEmptyRow(board, col, rows);
  if (row === -1) {
    return { success: false, row: -1 };
  }

  // Clone board immutably
  const newBoard = board.map(r => [...r]);
  newBoard[row][col] = player;
  return { success: true, row, board: newBoard };
}

export function isBoardFull(board, cols = CONFIG.CONNECT4_COLUMNS) {
  for (let c = 0; c < cols; c++) {
    if (board[0][c] === null) {
      return false;
    }
  }
  return true;
}

export function checkWin(
  board,
  lastRow,
  lastCol,
  rows = CONFIG.CONNECT4_ROWS,
  cols = CONFIG.CONNECT4_COLUMNS,
  winLength = CONFIG.CONNECT4_WIN_LENGTH
) {
  if (lastRow < 0 || lastRow >= rows || lastCol < 0 || lastCol >= cols) return null;
  const player = board[lastRow][lastCol];
  if (!player) return null;

  // Directions: [dRow, dCol] -> Horizontal, Vertical, Diagonal down-right (\), Diagonal up-right (/)
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [-1, 1],
  ];

  for (const [dr, dc] of directions) {
    const cells = [{ row: lastRow, col: lastCol }];

    // Forward
    let r = lastRow + dr;
    let c = lastCol + dc;
    while (r >= 0 && r < rows && c >= 0 && c < cols && board[r][c] === player) {
      cells.push({ row: r, col: c });
      r += dr;
      c += dc;
    }

    // Backward
    r = lastRow - dr;
    c = lastCol - dc;
    while (r >= 0 && r < rows && c >= 0 && c < cols && board[r][c] === player) {
      cells.push({ row: r, col: c });
      r -= dr;
      c -= dc;
    }

    if (cells.length >= winLength) {
      return {
        winner: player,
        winningCells: cells,
      };
    }
  }

  return null;
}

export function evaluateBoardStatus(
  board,
  lastRow,
  lastCol,
  rows = CONFIG.CONNECT4_ROWS,
  cols = CONFIG.CONNECT4_COLUMNS,
  winLength = CONFIG.CONNECT4_WIN_LENGTH
) {
  if (lastRow !== undefined && lastCol !== undefined && lastRow >= 0 && lastCol >= 0) {
    const winResult = checkWin(board, lastRow, lastCol, rows, cols, winLength);
    if (winResult) {
      return { status: 'win', winner: winResult.winner, winningCells: winResult.winningCells };
    }
  }

  if (isBoardFull(board, cols)) {
    return { status: 'draw', winner: null, winningCells: [] };
  }

  return { status: 'playing', winner: null, winningCells: [] };
}
