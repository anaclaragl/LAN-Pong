import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MLP } from '../src/ai/mlp.js';
import { GameEngine } from '../src/engine/game-engine.js';
import { CONFIG } from '../src/shared/config.js';
import { predictImpact, getTeacherAim } from '../src/ai/physics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const weightsPath = path.join(rootDir, 'src', 'ai', 'bot-weights.js');

const mlp = new MLP([8, 24, 24, 2]);

const NUM_SAMPLES = 45000;
const EPOCHS = 3;
const LEARNING_RATE = 0.007;

const ballW = CONFIG.BALL_SIZE;
const maxSpeed = CONFIG.BALL_INITIAL_SPEED * CONFIG.BALL_MAX_SPEED_FACTOR;

for (let epoch = 1; epoch <= EPOCHS; epoch++) {
  let totalLoss = 0;

  for (let s = 0; s < NUM_SAMPLES; s++) {
    // Generate synthetic state
    const ballX = Math.random() * (1.0 - ballW);
    const ballY = 0.06 + Math.random() * 0.88;
    const speed = CONFIG.BALL_INITIAL_SPEED * (1 + Math.random() * (CONFIG.BALL_MAX_SPEED_FACTOR - 1));
    const angle = (Math.random() * 110 - 55) * Math.PI / 180;
    const isIncoming = Math.random() < 0.75;
    const yDir = isIncoming ? -1 : 1;

    const vx = speed * Math.sin(angle);
    const vy = yDir * speed * Math.cos(angle) * CONFIG.COURT_ASPECT_RATIO;

    const botX = CONFIG.PADDLE_WIDTH / 2 + Math.random() * (1.0 - CONFIG.PADDLE_WIDTH);
    const oppX = CONFIG.PADDLE_WIDTH / 2 + Math.random() * (1.0 - CONFIG.PADDLE_WIDTH);

    const snapshot = {
      ball: { x: ballX, y: ballY, vx, vy, speed },
      paddles: { player1: botX, player2: oppX },
    };

    const impact = predictImpact(snapshot.ball, 'player1', CONFIG);
    const predictedLandingX = impact ? impact.landingX : 0.5;
    const timeToImpact = impact ? Math.min(1.0, impact.timeSec / 2.0) : 1.0;
    const normVx = Math.max(-1, Math.min(1, vx / maxSpeed));
    const normVy = Math.max(-1, Math.min(1, vy / (maxSpeed * CONFIG.COURT_ASPECT_RATIO)));
    const distLandingToOpp = Math.max(-1, Math.min(1, predictedLandingX - oppX));

    const inputs = [
      predictedLandingX,
      timeToImpact,
      normVx,
      normVy,
      botX,
      oppX,
      distLandingToOpp,
      isIncoming ? 1.0 : -1.0,
    ];

    if (isIncoming) {
      const teacher = getTeacherAim(snapshot, 'player1', CONFIG);
      const targetAim = Math.max(-1, Math.min(1, teacher.aimOffset / 0.85));
      mlp.trainSample(inputs, [targetAim, 0.0], LEARNING_RATE, [1, 0]);
    } else {
      // Strategic rest position: center, with slight anticipation towards opponent side
      const restTarget = 0.5 + (oppX - 0.5) * 0.2;
      const targetRest = (restTarget - 0.5) / 0.25;
      mlp.trainSample(inputs, [0.0, targetRest], LEARNING_RATE, [0, 1]);
    }
  }
}


function evaluateMatch(candidateMlp) {
  let score = 0;
  const dt = 1 / CONFIG.TICK_RATE_HZ;
  const botSpeed = CONFIG.BOT?.PADDLE_SPEED ?? 2.2;
  const maxStep = botSpeed * dt;
  const halfWidth = CONFIG.PADDLE_WIDTH / 2;

  // Run matches against 2 opponents: an offensive teacher and a reactive tracker
  for (let matchType = 0; matchType < 2; matchType++) {
    const engine = new GameEngine();
    engine.launchBall();

    let botPaddleX = 0.5;
    let oppPaddleX = 0.5;

    for (let step = 0; step < 900; step++) {
      if (engine.state.phase !== 'playing') {
        if (engine.state.phase === 'ended') break;
        engine.launchBall();
      }

      const snap = engine.getSnapshot();

      // Bot decision
      const impact = predictImpact(snap.ball, 'player1', CONFIG);
      const predictedLandingX = impact ? impact.landingX : 0.5;
      const timeToImpact = impact ? Math.min(1.0, impact.timeSec / 2.0) : 1.0;
      const normVx = Math.max(-1, Math.min(1, snap.ball.vx / maxSpeed));
      const normVy = Math.max(-1, Math.min(1, snap.ball.vy / (maxSpeed * CONFIG.COURT_ASPECT_RATIO)));
      const distLandingToOpp = Math.max(-1, Math.min(1, predictedLandingX - oppPaddleX));
      const isIncoming = snap.ball.vy < 0;

      const inputs = [
        predictedLandingX,
        timeToImpact,
        normVx,
        normVy,
        botPaddleX,
        oppPaddleX,
        distLandingToOpp,
        isIncoming ? 1.0 : -1.0,
      ];

      const out = candidateMlp.forward(inputs);
      const aimOffset = Math.max(-0.85, Math.min(0.85, out[0] * 0.85));
      const restX = 0.5 + out[1] * 0.25;

      const targetX = isIncoming ? predictedLandingX - aimOffset * halfWidth : restX;
      const clampedTargetX = Math.max(halfWidth, Math.min(1.0 - halfWidth, targetX));

      const diff = clampedTargetX - botPaddleX;
      if (Math.abs(diff) > 0.0005) {
        botPaddleX += Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
      }
      botPaddleX = Math.max(halfWidth, Math.min(1.0 - halfWidth, botPaddleX));
      engine.setPaddlePosition('player1', botPaddleX);

      // Opponent motion
      if (matchType === 0) {
        // Tracker opponent
        const oppTarget = snap.ball.x + ballW / 2;
        const oppDiff = oppTarget - oppPaddleX;
        oppPaddleX += Math.sign(oppDiff) * Math.min(Math.abs(oppDiff), botSpeed * 0.9 * dt);
      } else {
        // Smart offensive opponent
        const oppImpact = predictImpact(snap.ball, 'player2', CONFIG);
        const oppTarget = oppImpact ? oppImpact.landingX + 0.3 * halfWidth : 0.5;
        const oppDiff = oppTarget - oppPaddleX;
        oppPaddleX += Math.sign(oppDiff) * Math.min(Math.abs(oppDiff), botSpeed * dt);
      }
      oppPaddleX = Math.max(halfWidth, Math.min(1.0 - halfWidth, oppPaddleX));
      engine.setPaddlePosition('player2', oppPaddleX);

      const prevVy = snap.ball.vy;
      const evt = engine.tick(dt);

      if (prevVy < 0 && engine.state.ball.vy > 0) {
        // Successful hit bonus + offensive angle bonus
        const contactOffset = Math.abs((snap.ball.x + ballW / 2 - botPaddleX) / halfWidth);
        score += 20 + contactOffset * 30; // Rewards angling the shot!
      }

      if (evt) {
        if (evt.type === 'point') {
          if (evt.scorer === 'player1') score += 100;
          if (evt.scorer === 'player2') score -= 80;
        } else if (evt.type === 'end') {
          if (evt.winner === 'player1') score += 200;
          break;
        }
      }
    }
  }

  return score;
}

const POP_SIZE = 12;
const GENERATIONS = 12;
let population = [mlp.clone()];

for (let i = 1; i < POP_SIZE; i++) {
  const mutant = mlp.clone();
  mutant.mutate(0.04, 0.03);
  population.push(mutant);
}

let bestModel = mlp;
let bestFitness = -Infinity;

for (let g = 0; g < GENERATIONS; g++) {
  const scores = population.map((cand) => evaluateMatch(cand));

  const indexed = scores.map((s, idx) => ({ score: s, mlp: population[idx] }));
  indexed.sort((a, b) => b.score - a.score);

  if (indexed[0].score > bestFitness) {
    bestFitness = indexed[0].score;
    bestModel = indexed[0].mlp.clone();
  }

  process.stdout.write(`Generation ${g + 1}/${GENERATIONS} | Best Score: ${indexed[0].score}\r`);

  const nextGen = [indexed[0].mlp.clone(), indexed[1].mlp.clone(), indexed[2].mlp.clone()];
  while (nextGen.length < POP_SIZE) {
    const parent = indexed[Math.floor(Math.random() * 3)].mlp;
    const child = parent.clone();
    child.mutate(0.05, 0.03);
    nextGen.push(child);
  }
  population = nextGen;
}


// Validation & Diagnostic Metrics
const testEngine = new GameEngine();
let hits = 0;
let missed = 0;
let offsets = [];
let reversals = 0;
let ticks = 0;
let lastDir = 0;
const dt = 1 / CONFIG.TICK_RATE_HZ;
const botSpeed = CONFIG.BOT?.PADDLE_SPEED ?? 2.2;
const maxStep = botSpeed * dt;
const halfWidth = CONFIG.PADDLE_WIDTH / 2;

for (let r = 0; r < 40; r++) {
  testEngine.resetBallToCenter(false);
  testEngine.launchBall();
  testEngine.state.ball.vy = -Math.abs(testEngine.state.ball.vy);

  let pX = 0.5;
  for (let t = 0; t < 300; t++) {
    const snap = testEngine.getSnapshot();
    const impact = predictImpact(snap.ball, 'player1', CONFIG);
    const predictedLandingX = impact ? impact.landingX : 0.5;
    const timeToImpact = impact ? Math.min(1.0, impact.timeSec / 2.0) : 1.0;
    const normVx = Math.max(-1, Math.min(1, snap.ball.vx / maxSpeed));
    const normVy = Math.max(-1, Math.min(1, snap.ball.vy / (maxSpeed * CONFIG.COURT_ASPECT_RATIO)));
    const distLandingToOpp = Math.max(-1, Math.min(1, predictedLandingX - 0.5));
    const isIncoming = snap.ball.vy < 0;

    const inputs = [
      predictedLandingX,
      timeToImpact,
      normVx,
      normVy,
      pX,
      0.5,
      distLandingToOpp,
      isIncoming ? 1.0 : -1.0,
    ];

    const out = bestModel.forward(inputs);
    const aimOffset = Math.max(-0.85, Math.min(0.85, out[0] * 0.85));
    const restX = 0.5 + out[1] * 0.25;

    const targetX = isIncoming ? predictedLandingX - aimOffset * halfWidth : restX;
    const clampedTargetX = Math.max(halfWidth, Math.min(1.0 - halfWidth, targetX));

    const prevX = pX;
    const diff = clampedTargetX - pX;
    if (Math.abs(diff) > 0.0005) {
      pX += Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
    }
    pX = Math.max(halfWidth, Math.min(1.0 - halfWidth, pX));
    testEngine.setPaddlePosition('player1', pX);

    const d = Math.sign(pX - prevX);
    if (d !== 0 && lastDir !== 0 && d !== lastDir) reversals++;
    if (d !== 0) lastDir = d;
    ticks++;

    const prevVy = testEngine.state.ball.vy;
    testEngine.tick(dt);

    if (prevVy < 0 && testEngine.state.ball.vy > 0) {
      hits++;
      const contactOffset = Math.abs((snap.ball.x + ballW / 2 - pX) / halfWidth);
      offsets.push(contactOffset);
      break;
    }
    if (testEngine.state.ball.y <= 0) {
      missed++;
      break;
    }
  }
}

const avgOffset = offsets.reduce((a, b) => a + b, 0) / (offsets.length || 1);
const revsPerSec = reversals / (ticks * dt);

// Save model weights
const weightsJson = bestModel.toJSON();
const fileContent = `// Pre-trained Neural Network weights for PongBot V2
// Generated automatically by scripts/train-bot.js
export const BOT_WEIGHTS = ${JSON.stringify(weightsJson, null, 2)};
`;

fs.writeFileSync(weightsPath, fileContent, 'utf-8');