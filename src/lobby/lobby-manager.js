import { GAME_REGISTRY } from '../shared/registry.js';
import { CONFIG } from '../shared/config.js';

export class LobbyManager {
  constructor(options = {}) {
    this.countdownSeconds = options.countdownSeconds ?? CONFIG.GAME_START_COUNTDOWN_SECONDS ?? 2;
    this.votes = {
      player1: null, // Host vote (gameId | null)
      player2: null, // Guest vote (gameId | null)
    };
    this.countdownTimer = null;
    this.selectedGame = null;
    this.onGameStartCallback = null;
    this.onVoteChangeCallback = null;
    this.countdownInterval = null;
  }

  getVotes() {
    return {
      host: this.votes.player1,
      guest: this.votes.player2,
    };
  }

  reset() {
    this.clearCountdown();
    this.votes.player1 = null;
    this.votes.player2 = null;
    this.selectedGame = null;
  }

  clearCountdown() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.countdownTimer = null;
  }

  // player: 'player1' (Host) | 'player2' (Guest)
  // gameId: string | null
  setVote(player, gameId) {
    if (player !== 'player1' && player !== 'player2') {
      return { success: false, reason: 'Invalid player' };
    }

    if (gameId !== null) {
      const exists = GAME_REGISTRY.some((g) => g.id === gameId);
      if (!exists) {
        return { success: false, reason: 'Unknown game' };
      }
    }

    // Toggle logic: clicking the card you already voted for removes your vote
    if (this.votes[player] === gameId) {
      this.votes[player] = null;
    } else {
      this.votes[player] = gameId;
    }

    this.checkAgreement();

    // Broadcast updated vote state whenever a vote changes (even if votes differ or no agreement yet)
    if (!this.countdownInterval && this.onVoteChangeCallback) {
      this.onVoteChangeCallback({
        votes: this.getVotes(),
        countdown: null,
        selectedGame: null,
      });
    }

    return { success: true, votes: this.getVotes() };
  }

  checkAgreement() {
    const v1 = this.votes.player1;
    const v2 = this.votes.player2;

    // Both voted for the same valid game
    if (v1 && v2 && v1 === v2) {
      if (!this.countdownInterval) {
        this.startAgreementCountdown(v1);
      }
    } else {
      // Disagreement or missing vote cancels any active countdown
      if (this.countdownInterval) {
        this.clearCountdown();
        if (this.onVoteChangeCallback) {
          this.onVoteChangeCallback({
            votes: this.getVotes(),
            countdown: null,
            selectedGame: null,
          });
        }
      }
    }
  }

  startAgreementCountdown(gameId) {
    this.selectedGame = gameId;
    let remaining = this.countdownSeconds;
    this.countdownTimer = remaining;

    if (this.onVoteChangeCallback) {
      this.onVoteChangeCallback({
        votes: this.getVotes(),
        countdown: remaining,
        selectedGame: gameId,
      });
    }

    if (remaining <= 0) {
      this.clearCountdown();
      if (this.onGameStartCallback) {
        this.onGameStartCallback(gameId);
      }
      return;
    }

    const stepMs = remaining < 1 ? Math.max(10, Math.round(remaining * 1000)) : 1000;
    this.countdownInterval = setInterval(() => {
      remaining -= stepMs / 1000;
      this.countdownTimer = remaining;

      if (remaining <= 0.001) {
        this.clearCountdown();
        if (this.onGameStartCallback) {
          this.onGameStartCallback(gameId);
        }
      } else {
        if (this.onVoteChangeCallback) {
          this.onVoteChangeCallback({
            votes: this.getVotes(),
            countdown: Math.ceil(remaining),
            selectedGame: gameId,
          });
        }
      }
    }, stepMs);
  }
}
