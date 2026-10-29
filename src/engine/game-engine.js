import { CONFIG } from '../shared/config.js';

export class GameEngine {
  constructor(customConfig = {}) {
    this.config = { ...CONFIG, ...customConfig };
    this.resetMatch();
  }

  resetMatch() {
    this.state = {
      phase: 'waiting', // 'waiting' | 'countdown' | 'playing' | 'ended' | 'paused'
      score: {
        player1: 0, // Host (top)
        player2: 0, // Guest (bottom)
      },
      winner: null,
      countdownTimer: this.config.COUNTDOWN_SECONDS,
      paddles: {
        player1: 0.5, // Center X normalized (0 to 1)
        player2: 0.5,
      },
      ball: {
        x: 0.5 - this.config.BALL_SIZE / 2,
        y: 0.5 - this.ballHeight / 2,
        vx: 0,
        vy: 0,
        speed: this.config.BALL_INITIAL_SPEED,
      },
    };
    this.lastScorer = null;
    this.state.lastHitter = null;
  }

  get ballHeight() {
    return this.config.BALL_SIZE * this.config.COURT_ASPECT_RATIO;
  }

  get paddleTopY() {
    return 0.03;
  }

  get paddleBottomY() {
    return 1.0 - 0.03 - this.config.PADDLE_HEIGHT;
  }

  setPaddlePosition(player, normalizedX) {
    if (this.state.phase === 'ended') return;
    const halfWidth = this.config.PADDLE_WIDTH / 2;
    // Clamp paddle center so the paddle stays inside [0, 1]
    const clampedX = Math.max(halfWidth, Math.min(1 - halfWidth, normalizedX));
    if (player === 'player1' || player === 'player2') {
      this.state.paddles[player] = clampedX;
    }
  }

  startCountdown(preserveSpeed = true) {
    this.state.phase = 'countdown';
    this.state.countdownTimer = this.config.COUNTDOWN_SECONDS;
    this.resetBallToCenter(preserveSpeed);
  }

  resetBallToCenter(preserveSpeed = false) {
    const currentSpeed = preserveSpeed ? this.state.ball.speed : this.config.BALL_INITIAL_SPEED;
    this.state.ball.x = 0.5 - this.config.BALL_SIZE / 2;
    this.state.ball.y = 0.5 - this.ballHeight / 2;
    this.state.ball.vx = 0;
    this.state.ball.vy = 0;
    this.state.ball.speed = currentSpeed;
    this.state.lastHitter = null;
  }

  launchBall() {
    this.state.phase = 'playing';

    // Moderate launch angle: between -25 and +25 degrees from vertical
    const angleDeg = (Math.random() * 50 - 25);
    const angleRad = (angleDeg * Math.PI) / 180;

    // Direct ball towards random player, or towards player who didn't score
    const yDirection = Math.random() < 0.5 ? 1 : -1;

    const speed = this.state.ball.speed;
    this.state.ball.vx = speed * Math.sin(angleRad);
    this.state.ball.vy = yDirection * speed * Math.cos(angleRad) * this.config.COURT_ASPECT_RATIO;
  }

  tick(deltaTime) {
    if (this.state.phase === 'countdown') {
      this.state.countdownTimer -= deltaTime;
      if (this.state.countdownTimer <= 0) {
        this.launchBall();
      }
      return null;
    }

    if (this.state.phase !== 'playing') {
      return null;
    }

    const { ball, paddles } = this.state;
    const ballW = this.config.BALL_SIZE;
    const ballH = this.ballHeight;
    const paddleW = this.config.PADDLE_WIDTH;
    const paddleH = this.config.PADDLE_HEIGHT;

    // Previous ball positions for tunneling prevention
    const prevX = ball.x;
    const prevY = ball.y;

    // Update position
    ball.x += ball.vx * deltaTime;
    ball.y += ball.vy * deltaTime;

    // 1. Side wall collisions (left & right)
    if (ball.x <= 0) {
      ball.x = -ball.x;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x + ballW >= 1.0) {
      ball.x = 2 * (1.0 - ballW) - ball.x;
      ball.vx = -Math.abs(ball.vx);
    }

    // 2. Paddle collisions
    const ballCenterX = ball.x + ballW / 2;

    // Top paddle (Player 1): ball moving upwards (vy < 0)
    const topPaddleY = this.paddleTopY;
    const topPaddleBottom = topPaddleY + paddleH;
    if (
      ball.vy < 0 &&
      ball.y <= topPaddleBottom &&
      prevY >= topPaddleY &&
      ballCenterX >= paddles.player1 - paddleW / 2 &&
      ballCenterX <= paddles.player1 + paddleW / 2
    ) {
      ball.y = topPaddleBottom;
      this.state.lastHitter = 'player1';
      this.handlePaddleBounce(paddles.player1, 1);
    }

    // Bottom paddle (Player 2): ball moving downwards (vy > 0)
    const botPaddleY = this.paddleBottomY;
    if (
      ball.vy > 0 &&
      ball.y + ballH >= botPaddleY &&
      prevY + ballH <= botPaddleY + paddleH &&
      ballCenterX >= paddles.player2 - paddleW / 2 &&
      ballCenterX <= paddles.player2 + paddleW / 2
    ) {
      ball.y = botPaddleY - ballH;
      this.state.lastHitter = 'player2';
      this.handlePaddleBounce(paddles.player2, -1);
    }

    // 3. Goal collisions
    // Top goal: ball through Y <= 0 -> Player 2 scores
    if (ball.y <= 0) {
      return this.handleGoal('player2');
    }

    // Bottom goal: ball through Y + ballH >= 1.0 -> Player 1 scores
    if (ball.y + ballH >= 1.0) {
      return this.handleGoal('player1');
    }

    return null;
  }

  handlePaddleBounce(paddleCenterX, yDirection) {
    const ballCenterX = this.state.ball.x + this.config.BALL_SIZE / 2;
    const halfWidth = this.config.PADDLE_WIDTH / 2;

    // Offset from center of paddle: -1 (left edge) to +1 (right edge)
    const offset = Math.max(-1, Math.min(1, (ballCenterX - paddleCenterX) / halfWidth));

    const maxAngleRad = (this.config.MAX_BOUNCE_ANGLE_DEG * Math.PI) / 180;
    const bounceAngle = offset * maxAngleRad;

    // Increase ball speed
    const maxSpeed = this.config.BALL_INITIAL_SPEED * this.config.BALL_MAX_SPEED_FACTOR;
    this.state.ball.speed = Math.min(
      maxSpeed,
      this.state.ball.speed * (1 + this.config.BALL_SPEED_INCREMENT)
    );

    const speed = this.state.ball.speed;
    this.state.ball.vx = speed * Math.sin(bounceAngle);
    this.state.ball.vy = yDirection * speed * Math.cos(bounceAngle) * this.config.COURT_ASPECT_RATIO;
  }

  handleGoal(scoringPlayer) {
    this.state.score[scoringPlayer] += 1;
    this.lastScorer = scoringPlayer;

    const result = {
      type: 'point',
      scorer: scoringPlayer,
      score: { ...this.state.score },
    };

    if (this.state.score[scoringPlayer] >= this.config.WINNING_SCORE) {
      this.state.phase = 'ended';
      this.state.winner = scoringPlayer;
      result.type = 'end';
      result.winner = scoringPlayer;
    } else {
      this.startCountdown();
    }

    return result;
  }

  getSnapshot() {
    return {
      phase: this.state.phase,
      countdownTimer: Math.ceil(this.state.countdownTimer),
      countdownTimerRaw: this.state.countdownTimer,
      score: { ...this.state.score },
      winner: this.state.winner,
      lastHitter: this.state.lastHitter || null,
      ball: {
        x: this.state.ball.x,
        y: this.state.ball.y,
        vx: this.state.ball.vx,
        vy: this.state.ball.vy,
        speed: this.state.ball.speed,
      },
      paddles: { ...this.state.paddles },
    };
  }
}

