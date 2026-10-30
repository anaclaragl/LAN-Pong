import { CONFIG } from '../../shared/config.js';
import { GameEngine } from '../../engine/game-engine.js';

export class PongGameModule {
  constructor(customConfig = {}) {
    this.id = 'pong';
    this.title = 'Pong';
    this.config = { ...CONFIG, ...customConfig };
    this.engine = new GameEngine(this.config);
    this.scores = { player1: 0, player2: 0 };
  }

  init(config) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    this.engine.resetMatch();
    this.engine.startCountdown(false);
  }

  resetForRematch() {
    this.engine.resetMatch();
    this.engine.startCountdown(false);
  }

  onInput(player, input) {
    if (input?.type === 'paddle' && typeof input.x === 'number') {
      this.engine.setPaddlePosition(player, input.x);
      return { success: true };
    }
    return { success: false };
  }

  tick(deltaTime) {
    const event = this.engine.tick(deltaTime);
    if (event?.type === 'end') {
      if (event.winner) {
        this.scores[event.winner] = (this.scores[event.winner] || 0) + 1;
      }
    }
    return event;
  }

  getState() {
    return this.engine.getSnapshot();
  }

  isFinished() {
    return this.engine.state.phase === 'ended';
  }
}
