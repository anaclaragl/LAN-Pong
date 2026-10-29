// Exact physics prediction and trajectory analysis for PongBot
import { CONFIG } from '../shared/config.js';

export function getBallDimensions(config = CONFIG) {
  const ballW = config.BALL_SIZE;
  const ballH = ballW * config.COURT_ASPECT_RATIO;
  return { ballW, ballH };
}

// Predict where the ball center will land at targetY with exact wall bounce reflections
export function predictLandingX(startX, startY, vx, vy, targetY, config = CONFIG) {
  if (Math.abs(vy) < 1e-6) return startX + config.BALL_SIZE / 2;
  const time = (targetY - startY) / vy;
  if (time <= 0) return startX + config.BALL_SIZE / 2;

  const ballW = config.BALL_SIZE;
  const rawX = startX + vx * time;
  const courtW = 1.0 - ballW;

  const doubleW = 2 * courtW;
  let folded = rawX % doubleW;
  if (folded < 0) folded += doubleW;
  if (folded > courtW) folded = doubleW - folded;

  return folded + ballW / 2;
}

// Predict full impact parameters when the ball reaches the target player's paddle line
export function predictImpact(ball, role = 'player1', config = CONFIG) {
  const { ballW, ballH } = getBallDimensions(config);
  const isTop = role === 'player1';

  // If ball is moving away from the paddle line, return null
  if (isTop && ball.vy >= 0) return null;
  if (!isTop && ball.vy <= 0) return null;

  const targetY = isTop ? 0.03 + config.PADDLE_HEIGHT : 1.0 - 0.03 - config.PADDLE_HEIGHT - ballH;
  const timeSec = (targetY - ball.y) / ball.vy;

  if (timeSec < 0) return null;

  const landingX = predictLandingX(ball.x, ball.y, ball.vx, ball.vy, targetY, config);

  // Calculate number of wall reflections to determine vx at impact
  const courtW = 1.0 - ballW;
  const rawX = ball.x + ball.vx * timeSec;
  const bounces = Math.floor(Math.abs(rawX) / courtW);
  const vxAtImpact = bounces % 2 === 1 ? -ball.vx : ball.vx;

  return {
    landingX,
    timeSec,
    vxAtImpact,
    vyAtImpact: ball.vy,
    targetY,
  };
}

// Evaluate bounce shot for a candidate paddle offset [-1, 1]
// Returns how much travel speed the opponent would need to intercept it
export function evaluateShot(landingX, offset, role = 'player1', oppPaddleX = 0.5, currentSpeed = CONFIG.BALL_INITIAL_SPEED, config = CONFIG) {
  const { ballW, ballH } = getBallDimensions(config);
  const isTop = role === 'player1';
  const yDirection = isTop ? 1 : -1; // Heading toward opponent

  const maxAngleRad = (config.MAX_BOUNCE_ANGLE_DEG * Math.PI) / 180;
  const bounceAngle = offset * maxAngleRad;

  const maxSpeed = config.BALL_INITIAL_SPEED * config.BALL_MAX_SPEED_FACTOR;
  const newSpeed = Math.min(maxSpeed, currentSpeed * (1 + config.BALL_SPEED_INCREMENT));

  const newVx = newSpeed * Math.sin(bounceAngle);
  const newVy = yDirection * newSpeed * Math.cos(bounceAngle) * config.COURT_ASPECT_RATIO;

  const startY = isTop ? 0.03 + config.PADDLE_HEIGHT : 1.0 - 0.03 - config.PADDLE_HEIGHT - ballH;
  const oppTargetY = isTop ? 1.0 - 0.03 - config.PADDLE_HEIGHT - ballH : 0.03 + config.PADDLE_HEIGHT;

  const oppLandingX = predictLandingX(landingX - ballW / 2, startY, newVx, newVy, oppTargetY, config);
  const flightTime = Math.abs((oppTargetY - startY) / newVy);

  const travelDist = Math.abs(oppLandingX - oppPaddleX);
  const requiredSpeed = travelDist / flightTime;

  return {
    oppLandingX,
    flightTime,
    travelDist,
    requiredSpeed,
    newSpeed,
  };
}

// Teacher coach: finds optimal offensive aim offset that puts maximum pressure on opponent
export function getTeacherAim(snapshot, role = 'player1', config = CONFIG) {
  const impact = predictImpact(snapshot.ball, role, config);
  if (!impact) {
    return {
      aimOffset: 0,
      targetPaddleX: 0.5,
      restX: 0.5,
    };
  }

  const oppRole = role === 'player1' ? 'player2' : 'player1';
  const oppPaddleX = snapshot.paddles[oppRole];
  const halfWidth = config.PADDLE_WIDTH / 2;

  let bestOffset = 0;
  let maxPressure = -Infinity;

  // Test candidate offsets from -0.85 to +0.85
  for (let o = -0.85; o <= 0.85; o += 0.05) {
    const candidatePaddleX = impact.landingX - o * halfWidth;

    // Must be reachable within court bounds
    if (candidatePaddleX < halfWidth || candidatePaddleX > 1.0 - halfWidth) {
      continue;
    }

    const shot = evaluateShot(impact.landingX, o, role, oppPaddleX, snapshot.ball.speed, config);
    // Score based on required opponent speed, distance from opponent, and sharp angle bonus
    const angleBonus = Math.abs(o) * 2.5;
    const score = shot.requiredSpeed * 2.0 + shot.travelDist * 3.0 + angleBonus;

    if (score > maxPressure) {
      maxPressure = score;
      bestOffset = o;
    }
  }

  const targetPaddleX = Math.max(halfWidth, Math.min(1.0 - halfWidth, impact.landingX - bestOffset * halfWidth));

  return {
    aimOffset: bestOffset,
    targetPaddleX,
    restX: 0.5,
  };
}
