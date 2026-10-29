import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../src/engine/game-engine.js';
import { CONFIG } from '../src/shared/config.js';

test('GameEngine initializes with correct configuration and default values', () => {
  const engine = new GameEngine();
  const snapshot = engine.getSnapshot();

  assert.equal(snapshot.phase, 'waiting');
  assert.equal(snapshot.score.player1, 0);
  assert.equal(snapshot.score.player2, 0);
  assert.equal(snapshot.paddles.player1, 0.5);
  assert.equal(snapshot.paddles.player2, 0.5);
  assert.equal(snapshot.winner, null);
  assert.equal(engine.config.WINNING_SCORE, CONFIG.WINNING_SCORE);
  assert.equal(engine.config.COURT_ASPECT_RATIO, 0.75);
});

test('Paddle position clamping prevents paddles from exiting the court', () => {
  const engine = new GameEngine();
  const halfWidth = CONFIG.PADDLE_WIDTH / 2;

  // Move far left
  engine.setPaddlePosition('player1', -0.5);
  assert.equal(engine.getSnapshot().paddles.player1, halfWidth);

  // Move far right
  engine.setPaddlePosition('player2', 1.5);
  assert.equal(engine.getSnapshot().paddles.player2, 1 - halfWidth);

  // Normal position
  engine.setPaddlePosition('player1', 0.4);
  assert.equal(engine.getSnapshot().paddles.player1, 0.4);
});

test('Side wall collisions invert vx and reflect ball inside court bounds', () => {
  const engine = new GameEngine();
  engine.state.phase = 'playing';

  // Test left wall bounce
  engine.state.ball.x = 0.01;
  engine.state.ball.vx = -0.5;
  engine.state.ball.vy = 0;
  engine.tick(0.05); // x would move to 0.01 - 0.025 = -0.015 -> bounces to +0.015
  assert.ok(engine.state.ball.vx > 0, 'vx should be inverted to positive');
  assert.ok(engine.state.ball.x >= 0, 'ball should stay within left wall');

  // Test right wall bounce
  engine.state.ball.x = 1.0 - CONFIG.BALL_SIZE - 0.01;
  engine.state.ball.vx = 0.5;
  engine.state.ball.vy = 0;
  engine.tick(0.05);
  assert.ok(engine.state.ball.vx < 0, 'vx should be inverted to negative');
  assert.ok(engine.state.ball.x + CONFIG.BALL_SIZE <= 1.0, 'ball should stay within right wall');
});

test('Paddle collision increases speed and angles ball according to impact offset', () => {
  const engine = new GameEngine();
  engine.state.phase = 'playing';

  // Bottom paddle hit (Player 2)
  const paddleX = 0.5;
  engine.state.paddles.player2 = paddleX;
  const initialSpeed = engine.state.ball.speed;

  // Center hit
  engine.state.ball.x = paddleX - CONFIG.BALL_SIZE / 2; // Exact center
  engine.state.ball.y = engine.paddleBottomY - engine.ballHeight + 0.001;
  engine.state.ball.vx = 0;
  engine.state.ball.vy = 0.2; // moving down
  engine.tick(0.01);

  assert.ok(engine.state.ball.vy < 0, 'Ball should bounce upwards');
  assert.ok(Math.abs(engine.state.ball.vx) < 0.001, 'Center hit should result in near zero vx');
  assert.ok(engine.state.ball.speed > initialSpeed, 'Speed should increase on paddle hit');

  // Edge hit (right side)
  const speedBeforeEdgeHit = engine.state.ball.speed;
  engine.state.ball.x = paddleX + CONFIG.PADDLE_WIDTH / 2 - CONFIG.BALL_SIZE;
  engine.state.ball.y = engine.paddleBottomY - engine.ballHeight + 0.001;
  engine.state.ball.vy = 0.2;
  engine.tick(0.01);

  assert.ok(engine.state.ball.vx > 0, 'Right edge hit should angle ball to the right');
  assert.ok(engine.state.ball.speed > speedBeforeEdgeHit, 'Speed should increase again');
});

test('Ball speed does not exceed BALL_MAX_SPEED_FACTOR * initial speed', () => {
  const engine = new GameEngine();
  engine.state.phase = 'playing';
  const maxAllowedSpeed = CONFIG.BALL_INITIAL_SPEED * CONFIG.BALL_MAX_SPEED_FACTOR;

  // Simulate multiple paddle bounces
  for (let i = 0; i < 50; i++) {
    engine.handlePaddleBounce(0.5, -1);
  }

  assert.ok(
    engine.state.ball.speed <= maxAllowedSpeed + 0.00001,
    `Speed ${engine.state.ball.speed} should be capped at ${maxAllowedSpeed}`
  );
});

test('Goal scoring awards points correctly and triggers countdown or end', () => {
  const engine = new GameEngine({ WINNING_SCORE: 3 });

  // Top goal: Player 2 scores
  engine.state.phase = 'playing';
  engine.state.ball.y = -0.01;
  const result1 = engine.tick(0.01);

  assert.equal(result1.type, 'point');
  assert.equal(result1.scorer, 'player2');
  assert.equal(engine.state.score.player2, 1);
  assert.equal(engine.state.phase, 'countdown');

  // Score until win
  engine.state.phase = 'playing';
  engine.state.ball.y = -0.01;
  engine.tick(0.01); // 2 points

  engine.state.phase = 'playing';
  engine.state.ball.y = -0.01;
  const resultWin = engine.tick(0.01); // 3 points -> WIN

  assert.equal(resultWin.type, 'end');
  assert.equal(resultWin.winner, 'player2');
  assert.equal(engine.state.phase, 'ended');
});

test('180-degree coordinate mirroring transforms coordinates symmetrically', () => {
  // Transformation helper for Host:
  // Render: (x, y) -> (1 - x, 1 - y)
  // Input: normalized mouse X -> (1 - mouseX) for canonical coordinate
  const canonicalBallX = 0.3;
  const canonicalBallY = 0.2;

  const hostViewX = 1 - canonicalBallX; // 0.7
  const hostViewY = 1 - canonicalBallY; // 0.8

  // When Host moves mouse to right edge (hostView = 0.9), canonical paddle is 1 - 0.9 = 0.1
  const hostMouseX = 0.9;
  const canonicalPaddleX = 1 - hostMouseX;
  assert.ok(Math.abs(canonicalPaddleX - 0.1) < 1e-6);

  // When rendered back on host screen:
  const hostRenderedPaddleX = 1 - canonicalPaddleX;
  assert.ok(Math.abs(hostRenderedPaddleX - hostMouseX) < 1e-6);
});

test('Ball speed is preserved across rounds until a player wins the game', () => {
  const engine = new GameEngine({ WINNING_SCORE: 2, COUNTDOWN_SECONDS: 1 });
  assert.equal(engine.state.ball.speed, CONFIG.BALL_INITIAL_SPEED);

  engine.startCountdown(false);
  assert.equal(engine.state.ball.speed, CONFIG.BALL_INITIAL_SPEED);

  // Complete countdown
  engine.tick(1.1);
  assert.equal(engine.state.phase, 'playing');

  // Simulate 3 paddle bounces to increase speed
  engine.handlePaddleBounce(0.5, 1);
  engine.handlePaddleBounce(0.5, -1);
  engine.handlePaddleBounce(0.5, 1);
  const increasedSpeed = engine.state.ball.speed;
  assert.ok(increasedSpeed > CONFIG.BALL_INITIAL_SPEED, 'Speed should have increased');

  // Player 2 scores
  engine.state.ball.y = -0.01;
  const pointEvent = engine.tick(0.01);
  assert.equal(pointEvent.type, 'point');
  assert.equal(engine.state.phase, 'countdown');

  // The speed in the new round during countdown should equal the increased speed before scoring
  assert.equal(engine.state.ball.speed, increasedSpeed);

  // Countdown finishes and ball launches
  engine.tick(1.1);
  assert.equal(engine.state.phase, 'playing');
  assert.equal(engine.state.ball.speed, increasedSpeed);

  // Simulate another bounce in round 2
  engine.handlePaddleBounce(0.5, 1);
  const round2Speed = engine.state.ball.speed;
  assert.ok(round2Speed > increasedSpeed, 'Speed should increase further in round 2');

  // Final score reaches winning score (2)
  engine.state.ball.y = -0.01;
  const winEvent = engine.tick(0.01);
  assert.equal(winEvent.type, 'end');
  assert.equal(engine.state.phase, 'ended');

  // Next game reset resets speed back to initial
  engine.resetMatch();
  assert.equal(engine.state.ball.speed, CONFIG.BALL_INITIAL_SPEED);
});
