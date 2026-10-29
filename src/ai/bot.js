import { MLP } from './mlp.js';
import { BOT_WEIGHTS } from './bot-weights.js';
import { CONFIG } from '../shared/config.js';
import { predictImpact } from './physics.js';

export class PongBot {
  constructor(weights = null, role = 'player1') {
    this.role = role; // Default: 'player1' (top paddle)
    this.mlp = new MLP([8, 24, 24, 2], weights || BOT_WEIGHTS || undefined);
    this.currentPaddleX = 0.5;
    this.lastAimOffset = 0;
    this.lastTargetPaddleX = 0.5;
  }

  // Extract normalized state features (8 inputs)
  extractFeatures(snapshot) {
    const isTop = this.role === 'player1';
    const isIncoming = (isTop && snapshot.ball.vy < 0) || (!isTop && snapshot.ball.vy > 0);

    const impact = predictImpact(snapshot.ball, this.role, CONFIG);
    const predictedLandingX = impact ? impact.landingX : 0.5;
    const timeToImpact = impact ? Math.min(1.0, impact.timeSec / 2.0) : 1.0;

    const maxSpeed = CONFIG.BALL_INITIAL_SPEED * CONFIG.BALL_MAX_SPEED_FACTOR;
    const normVx = Math.max(-1, Math.min(1, snapshot.ball.vx / maxSpeed));
    const normVy = Math.max(-1, Math.min(1, snapshot.ball.vy / (maxSpeed * CONFIG.COURT_ASPECT_RATIO)));

    const botX = snapshot.paddles[this.role] ?? this.currentPaddleX;
    const oppRole = this.role === 'player1' ? 'player2' : 'player1';
    const oppX = snapshot.paddles[oppRole] ?? 0.5;

    const distLandingToOpp = Math.max(-1, Math.min(1, predictedLandingX - oppX));

    return [
      predictedLandingX,
      timeToImpact,
      normVx,
      normVy,
      botX,
      oppX,
      distLandingToOpp,
      isIncoming ? 1.0 : -1.0,
    ];
  }

  // Calculate next paddle X smoothly without overshoot
  update(snapshot, deltaTime = 1 / CONFIG.TICK_RATE_HZ) {
    this.currentPaddleX = snapshot.paddles[this.role] ?? this.currentPaddleX;
    const halfWidth = CONFIG.PADDLE_WIDTH / 2;
    const botSpeed = CONFIG.BOT?.PADDLE_SPEED ?? 2.2;
    const maxStep = botSpeed * deltaTime;

    if (snapshot.phase !== 'playing') {
      // During countdown or waiting, return smoothly to center
      const centerDiff = 0.5 - this.currentPaddleX;
      if (Math.abs(centerDiff) > 0.001) {
        this.currentPaddleX += Math.sign(centerDiff) * Math.min(Math.abs(centerDiff), maxStep);
      }
      this.currentPaddleX = Math.max(halfWidth, Math.min(1.0 - halfWidth, this.currentPaddleX));
      return this.currentPaddleX;
    }

    const isTop = this.role === 'player1';
    const isIncoming = (isTop && snapshot.ball.vy < 0) || (!isTop && snapshot.ball.vy > 0);

    const features = this.extractFeatures(snapshot);
    const output = this.mlp.forward(features);

    // Output 0: aim offset in [-0.85, 0.85] (with which part of paddle to hit)
    // Output 1: rest position in [0.25, 0.75] (where to rest when ball moves away)
    const aimOffset = Math.max(-0.85, Math.min(0.85, output[0] * 0.85));
    const restX = 0.5 + output[1] * 0.25;

    let targetPaddleX;
    if (isIncoming) {
      const impact = predictImpact(snapshot.ball, this.role, CONFIG);
      const landingX = impact ? impact.landingX : snapshot.ball.x + CONFIG.BALL_SIZE / 2;
      targetPaddleX = landingX - aimOffset * halfWidth;
      this.lastAimOffset = aimOffset;
    } else {
      targetPaddleX = restX;
    }

    // Clamp target to physical court boundaries
    targetPaddleX = Math.max(halfWidth, Math.min(1.0 - halfWidth, targetPaddleX));
    this.lastTargetPaddleX = targetPaddleX;

    // Smooth movement directly towards target without overshoot
    const diff = targetPaddleX - this.currentPaddleX;
    if (Math.abs(diff) > 0.0005) {
      const step = Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
      this.currentPaddleX += step;
    }

    this.currentPaddleX = Math.max(halfWidth, Math.min(1.0 - halfWidth, this.currentPaddleX));
    return this.currentPaddleX;
  }
}
