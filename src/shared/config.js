// config.js: the single place with game values
export const CONFIG = {
  WINNING_SCORE: 3,           // points to win the match
  COUNTDOWN_SECONDS: 3,        // countdown before each rally
  TICK_RATE_HZ: 60,            // updates per second
  COURT_ASPECT_RATIO: 3 / 4,   // width / height
  PADDLE_WIDTH: 0.15,          // fraction of court width
  PADDLE_HEIGHT: 0.02,         // fraction of court height
  BALL_SIZE: 0.02,             // fraction of court width
  BALL_INITIAL_SPEED: 0.6,     // court widths per second
  BALL_SPEED_INCREMENT: 0.06,  // increase per paddle hit
  BALL_MAX_SPEED_FACTOR: 2,    // cap, multiple of the initial speed
  MAX_BOUNCE_ANGLE_DEG: 60,    // maximum exit angle off the paddle
  PORT: 8080,                  // match server port
  HOST_NAME: 'pong',           // mDNS name (pong.local)
};

