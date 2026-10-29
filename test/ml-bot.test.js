import test from 'node:test';
import assert from 'node:assert/strict';
import { MLP } from '../src/ai/mlp.js';
import { PongBot } from '../src/ai/bot.js';
import { GameEngine } from '../src/engine/game-engine.js';
import { CONFIG } from '../src/shared/config.js';
import { predictImpact, evaluateShot, getTeacherAim } from '../src/ai/physics.js';

test('MLP: initializes, runs deterministic forward pass, and clones correctly', () => {
  const mlp = new MLP([8, 24, 24, 2]);
  const inputs = [0.5, 0.5, 0.0, 0.5, 0.5, 0.5, 0.0, 1.0];

  const out1 = mlp.forward(inputs);
  const out2 = mlp.forward(inputs);

  assert.equal(out1.length, 2);
  assert.equal(out1[0], out2[0]);
  assert.equal(out1[1], out2[1]);
  assert.ok(out1[0] >= -1 && out1[0] <= 1);
  assert.ok(out1[1] >= -1 && out1[1] <= 1);

  // Test serialization & deserialization
  const json = mlp.toJSON();
  const restored = new MLP(json.layerSizes, json);
  const restoredOut = restored.forward(inputs);
  assert.equal(restoredOut[0], out1[0]);
  assert.equal(restoredOut[1], out1[1]);

  // Test clone and mutation
  const clone = mlp.clone();
  clone.mutate(1.0, 0.5); // Force mutation on all weights
  const mutatedOut = clone.forward(inputs);
  assert.notEqual(mutatedOut[0], out1[0]);
});

test('Physics: predictImpact accurately computes landing X and travel time', () => {
  const ball = {
    x: 0.5,
    y: 0.5,
    vx: 0.3,
    vy: -0.4,
    speed: 0.6,
  };

  const impact = predictImpact(ball, 'player1', CONFIG);
  assert.ok(impact !== null);
  assert.ok(impact.landingX >= 0 && impact.landingX <= 1.0);
  assert.ok(impact.timeSec > 0);

  // Ball moving away should return null
  const movingAway = { ...ball, vy: 0.4 };
  assert.equal(predictImpact(movingAway, 'player1', CONFIG), null);
});

test('Physics: evaluateShot and teacherAim provide valid offensive strategies', () => {
  const snap = {
    ball: { x: 0.4, y: 0.3, vx: 0.2, vy: -0.5, speed: 0.6 },
    paddles: { player1: 0.5, player2: 0.5 },
  };

  const teacher = getTeacherAim(snap, 'player1', CONFIG);
  assert.ok(teacher.aimOffset >= -0.85 && teacher.aimOffset <= 0.85);
  assert.ok(teacher.targetPaddleX >= CONFIG.PADDLE_WIDTH / 2 && teacher.targetPaddleX <= 1 - CONFIG.PADDLE_WIDTH / 2);
});

test('PongBot: respects physical speed limits and court boundaries', () => {
  const bot = new PongBot();
  const dt = 1 / CONFIG.TICK_RATE_HZ;
  const maxAllowedDist = (CONFIG.BOT?.PADDLE_SPEED ?? 2.2) * dt;
  const halfWidth = CONFIG.PADDLE_WIDTH / 2;

  const mockSnapshot = {
    phase: 'playing',
    ball: { x: 0.9, y: 0.2, vx: 0.5, vy: -0.5, speed: 0.6 },
    paddles: { player1: 0.5, player2: 0.5 },
  };

  const initialX = bot.currentPaddleX;
  const nextX = bot.update(mockSnapshot, dt);

  const displacement = Math.abs(nextX - initialX);
  assert.ok(
    displacement <= maxAllowedDist + 1e-6,
    `Bot displacement ${displacement} exceeds max physical distance ${maxAllowedDist}`
  );
  assert.ok(nextX >= halfWidth && nextX <= 1 - halfWidth, 'Bot paddle must stay within court boundaries');
});

test('PongBot: intercepts 100% of test balls with high offensive angle and zero jitter', () => {
  const engine = new GameEngine();
  const bot = new PongBot(null, 'player1');
  const dt = 1 / CONFIG.TICK_RATE_HZ;

  let successfulHits = 0;
  let reversals = 0;
  let totalTicks = 0;
  let lastDir = 0;
  const offsets = [];

  for (let round = 0; round < 15; round++) {
    engine.resetBallToCenter(false);
    engine.launchBall();
    // Direct ball toward bot
    engine.state.ball.vy = -Math.abs(engine.state.ball.vy);

    for (let t = 0; t < 250; t++) {
      const snap = engine.getSnapshot();
      const prevX = bot.currentPaddleX;
      const botX = bot.update(snap, dt);
      engine.setPaddlePosition('player1', botX);

      const d = Math.sign(botX - prevX);
      if (d !== 0 && lastDir !== 0 && d !== lastDir) reversals++;
      if (d !== 0) lastDir = d;
      totalTicks++;

      const prevVy = engine.state.ball.vy;
      engine.tick(dt);

      // If ball bounced off bot's paddle
      if (prevVy < 0 && engine.state.ball.vy > 0) {
        successfulHits++;
        const contactOffset = Math.abs((snap.ball.x + CONFIG.BALL_SIZE / 2 - botX) / (CONFIG.PADDLE_WIDTH / 2));
        offsets.push(contactOffset);
        break;
      }
      if (engine.state.ball.y <= 0) {
        break;
      }
    }
  }

  const revsPerSec = reversals / (totalTicks * dt);
  const avgOffset = offsets.reduce((a, b) => a + b, 0) / (offsets.length || 1);

  assert.equal(successfulHits, 15, `PongBot should intercept 15/15 balls; got ${successfulHits}`);
  assert.ok(revsPerSec < 2.0, `Reversals per second must be < 2.0 (got ${revsPerSec.toFixed(2)})`);
  assert.ok(avgOffset > 0.35, `Average impact offset must be > 0.35 (got ${avgOffset.toFixed(2)})`);
});
