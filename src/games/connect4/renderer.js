import { CONFIG } from '../../shared/config.js';

const COLOR_MAP = {
  default: null,
  cyan: '#00F0FF',
  green: '#00FF66',
  pink: '#FF007F',
  yellow: '#FFE600',
  orange: '#FF6600',
  red: '#FF2A2A',
  purple: '#B026FF',
};

// Alternative fallback colors if both players choose identical colors
const DISTINCT_COLORS = [
  '#00F0FF', // Cyan
  '#FF007F', // Pink
  '#FFE600', // Yellow
  '#00FF66', // Green
  '#FF6600', // Orange
  '#B026FF', // Purple
  '#FF2A2A', // Red
];

export class Connect4Renderer {
  constructor(container, canvas, ctx) {
    this.container = container;
    this.canvas = canvas;
    this.ctx = ctx;
    this.hoverCol = null;
  }

  setHoverColumn(col) {
    this.hoverCol = col;
  }

  // Resolve distinct hex colors for both players:
  // "Both player is represented by a solid disc, matching the color they selected at the inventory.
  // If they have the same color, change one of them to another color."
  resolvePlayerColors(playerColors, fgColor) {
    let p1Hex = COLOR_MAP[playerColors?.player1] || null;
    let p2Hex = COLOR_MAP[playerColors?.player2] || null;

    // If both picked default (or null), give Player 1 white (fgColor) and Player 2 a distinct cyan/accent
    if (!p1Hex && !p2Hex) {
      p1Hex = fgColor;
      p2Hex = '#00F0FF';
    } else if (p1Hex && !p2Hex) {
      // p1 has a color, p2 is default
      p2Hex = p1Hex === fgColor ? '#00F0FF' : fgColor;
    } else if (!p1Hex && p2Hex) {
      // p1 is default, p2 has color
      p1Hex = p2Hex === fgColor ? '#00F0FF' : fgColor;
    } else if (p1Hex === p2Hex) {
      // Both selected the EXACT same color from inventory -> change Player 2 to a contrasting alternative
      for (const alt of DISTINCT_COLORS) {
        if (alt !== p1Hex) {
          p2Hex = alt;
          break;
        }
      }
    }

    return {
      player1: p1Hex,
      player2: p2Hex,
    };
  }

  getLayout(width, height) {
    const cols = CONFIG.CONNECT4_COLUMNS ?? 7;
    const rows = CONFIG.CONNECT4_ROWS ?? 6;

    const totalSlotsY = rows + 1.2;
    const maxCellW = (width * 0.90) / cols;
    const maxCellH = (height * 0.82) / totalSlotsY;
    const cellSize = Math.floor(Math.min(maxCellW, maxCellH));

    const boardW = cellSize * cols;
    const boardH = cellSize * rows;

    const startX = (width - boardW) / 2;
    const startY = (height - boardH) / 2 + cellSize * 0.6;
    const previewY = startY - cellSize * 0.7;

    return {
      cols,
      rows,
      cellSize,
      boardW,
      boardH,
      startX,
      startY,
      previewY,
      radius: Math.floor(cellSize * 0.38),
    };
  }

  getColumnFromMouse(mouseX, mouseY, width, height) {
    const layout = this.getLayout(width, height);
    if (
      mouseX < layout.startX ||
      mouseX > layout.startX + layout.boardW ||
      mouseY < layout.previewY - layout.cellSize ||
      mouseY > layout.startY + layout.boardH
    ) {
      return null;
    }
    const col = Math.floor((mouseX - layout.startX) / layout.cellSize);
    if (col >= 0 && col < layout.cols) {
      return col;
    }
    return null;
  }

  render(state, myRole, playerColors = {}) {
    const W = this.container.getBoundingClientRect().width;
    const H = this.container.getBoundingClientRect().height;
    const ctx = this.ctx;

    const isLight = document.body.classList.contains('light-mode');
    const bgColor = isLight ? '#FFFFFF' : '#000000';
    const fgColor = isLight ? '#000000' : '#FFFFFF';

    // Clear board area
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);

    const layout = this.getLayout(W, H);
    const { cols, rows, cellSize, startX, startY, previewY, radius } = layout;

    // Resolve disc colors matching inventory
    const resolvedColors = this.resolvePlayerColors(playerColors, fgColor);

    // 1. Draw HUD: Turn Indicator & Scores
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const scores = state?.scores || { player1: 0, player2: 0 };
    const myScore = myRole === 'player1' ? (scores.player1 ?? 0) : (scores.player2 ?? 0);
    const oppScore = myRole === 'player1' ? (scores.player2 ?? 0) : (scores.player1 ?? 0);

    const oppRole = myRole === 'player1' ? 'player2' : 'player1';
    const oppDiscColor = resolvedColors[oppRole];
    const myDiscColor = resolvedColors[myRole];

    // Top: Opponent & Score with their disc color indicator
    ctx.font = 'bold 12px Consolas, Courier, monospace';
    ctx.fillStyle = fgColor;
    ctx.fillText(`OPPONENT: ${oppScore}`, W / 2, 28);

    // Small swatch badge next to Opponent & You
    ctx.fillStyle = oppDiscColor;
    ctx.beginPath();
    ctx.arc(W / 2 + 65, 28, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = fgColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Turn indicator or game result banner
    if (state?.status === 'playing') {
      const isMyTurn = state.currentPlayer === myRole;
      ctx.font = 'bold 18px Consolas, Courier, monospace';
      ctx.fillStyle = fgColor;
      ctx.fillText(isMyTurn ? 'YOUR TURN' : "OPPONENT'S TURN", W / 2, 54);
    } else if (state?.status === 'win') {
      const isWin = state.winner === myRole;
      ctx.font = 'bold 20px Consolas, Courier, monospace';
      ctx.fillStyle = fgColor;
      ctx.fillText(isWin ? 'YOU WON!' : 'OPPONENT WON!', W / 2, 54);
    } else if (state?.status === 'draw') {
      ctx.font = 'bold 20px Consolas, Courier, monospace';
      ctx.fillStyle = fgColor;
      ctx.fillText('DRAW!', W / 2, 54);
    }

    // Bottom: You & Score with your disc color indicator
    ctx.font = 'bold 13px Consolas, Courier, monospace';
    ctx.fillStyle = fgColor;
    ctx.fillText(`YOU: ${myScore}`, W / 2, H - 24);

    ctx.fillStyle = myDiscColor;
    ctx.beginPath();
    ctx.arc(W / 2 + 55, H - 24, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = fgColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 2. Draw Column Highlight & Preview Piece (if my turn and column is not full)
    const isMyTurn = state?.status === 'playing' && state?.currentPlayer === myRole;
    if (isMyTurn && this.hoverCol !== null && this.hoverCol >= 0 && this.hoverCol < cols) {
      const colX = startX + this.hoverCol * cellSize;
      const isColAvailable = state.board && state.board[0][this.hoverCol] === null;

      if (isColAvailable) {
        // Column highlight outline
        ctx.strokeStyle = fgColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(colX + 2, startY + 2, cellSize - 4, rows * cellSize - 4);
        ctx.setLineDash([]);

        // Preview piece hovering above the column
        const centerX = colX + cellSize / 2;
        this.drawPiece(ctx, centerX, previewY, myDiscColor, fgColor, true);
      }
    }

    // 3. Draw Grid Slots & Board Outline
    ctx.strokeStyle = fgColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, cols * cellSize, rows * cellSize);

    // Winning cells lookup set
    const winningSet = new Set(
      (state?.winningCells || []).map((c) => `${c.row},${c.col}`)
    );

    // 4. Draw Cells & Pieces
    const board = state?.board || [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cellX = startX + c * cellSize;
        const cellY = startY + r * cellSize;
        const centerX = cellX + cellSize / 2;
        const centerY = cellY + cellSize / 2;

        ctx.strokeStyle = fgColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(cellX, cellY, cellSize, cellSize);

        const occupant = board[r]?.[c];
        const isWinningCell = winningSet.has(`${r},${c}`);

        if (occupant) {
          const pieceColor = resolvedColors[occupant] || fgColor;
          this.drawPiece(ctx, centerX, centerY, pieceColor, fgColor, false, isWinningCell);
        } else {
          // Empty slot circle
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius * 0.75, 0, Math.PI * 2);
          ctx.strokeStyle = fgColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  // Draw solid disc matching the inventory color:
  drawPiece(ctx, x, y, fillColor, fgColor, isPreview = false, isWinning = false) {
    const radius = isPreview ? Math.floor(20) : Math.floor(22);

    ctx.save();
    if (isPreview) {
      ctx.globalAlpha = 0.6;
    }

    // Solid disc filled with player's selected inventory color
    ctx.fillStyle = fillColor;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Crisp high-contrast outline border
    ctx.strokeStyle = fgColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Subtle inner concentric ring for texture
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2);
    ctx.stroke();

    // Winning piece highlight: extra outer square frame
    if (isWinning) {
      ctx.strokeStyle = fgColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(x - radius - 4, y - radius - 4, (radius + 4) * 2, (radius + 4) * 2);
    }

    ctx.restore();
  }
}
