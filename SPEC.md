# Technical Specification: Pong over Local Network

Version 0.1 (draft) · October 29, 2026

## 1. Overview

A two-player Pong game, each player on a different machine, both connected to the same local network (LAN). The court is vertical: each player controls a horizontal paddle, one at the top and the other at the bottom of the screen. The paddle is moved sideways with the mouse. A single ball is hit back and forth between the players. The look is minimalist, black and white only.

## 2. Scope

**In scope**

- Match between 2 players on different machines on the same LAN.
- Individual score per player.
- Paddle control by mouse, on the horizontal axis only.
- Ball physics with bounces off the side walls and the paddles.
- Minimalist black and white interface.

**Out of scope (version 0.1)**

- Play over the internet (outside the LAN).
- More than 2 players or spectators.
- Accounts, ranking, history persistence.
- Sounds, elaborate animations, color themes.
- Player versus computer (AI).

## 3. Functional requirements

| ID | Requirement |
| --- | --- |
| FR01 | The game must work on a local network. |
| FR02 | A match has exactly 2 players, each on a different machine. |
| FR03 | Each player has an individual score counter, visible to both. |
| FR04 | Each player's paddle moves horizontally following the mouse. |
| FR05 | There is a single ball in play, which the players hit back with their paddles. |
| FR06 | When hitting the side walls, the ball bounces normally (angle reflection). |
| FR07 | A player scores when the ball hits the wall opposite to their paddle. |

## 4. Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR01 | Minimalist look, strictly black and white (no shades of gray, gradients or colors). |

Proposed complementary requirements (subject to your approval):

| ID | Requirement |
| --- | --- |
| NFR02 | Low perceived latency: the game state must be updated at least 60 frames per second on the client. |
| NFR03 | The connection must be simple: only the host runs the program, and the guest opens a fixed address (pong.local) in the browser, without typing an IP. |
| NFR04 | The game must run in modern browsers (Chrome, Firefox, Edge). The host needs Node.js on Windows, macOS or Linux; the guest installs nothing. |
| NFR05 | All game parameters live in a single global configuration (section 8.1), changeable without touching the logic. |

## 5. Game rules

### 5.1 Court

- Rectangular court in vertical (portrait) orientation, black background, white elements.
- Top wall and bottom wall: these are the "goals".
- Left and right walls: they reflect the ball.
- Dashed white center line, purely decorative, dividing the court in half.

### 5.2 Positions

| Player | Role | Paddle | Wall where they score |
| --- | --- | --- | --- |
| Player 1 (host) | Top | Next to the top wall | Bottom wall |
| Player 2 (guest) | Bottom | Next to the bottom wall | Top wall |

Note: rule FR07 is read as follows: a ball that hits the wall where the opponent's paddle is gives a point to the other player. In other words, whoever lets the ball through loses the point.

### 5.3 Paddle

- Movement on the X axis only, following the mouse's horizontal position.
- The paddle is limited by the side walls (it does not leave the court).
- Fixed Y position.
- Each player sees their own paddle at the bottom of their screen (the view is mirrored for the host, see section 6.4).

### 5.4 Ball

- A white ball, square or round, fixed size.
- Side wall: inverts the horizontal component of the velocity.
- Paddle: inverts the vertical component of the velocity. The exit angle depends on the point of the paddle that was hit (center = straight, edges = more inclined).
- Goal wall: gives a point and ends the rally.
- Speed increases with each paddle hit (BALL\_SPEED\_INCREMENT), up to the limit BALL\_MAX\_SPEED\_FACTOR.

### 5.5 Scoring and match cycle

1. On start, the ball sits still at the center during a 3-second countdown.
2. The ball leaves in a random direction, with a moderate angle.
3. When the ball hits a goal wall, the opponent gets 1 point.
4. The score is updated, the ball returns to the center and the countdown restarts.
5. The match ends when a player reaches WINNING\_SCORE (default: 10 points, defined in the global configuration).
6. At the end, the winner is shown, with the option to play again.

## 6. Architecture

### 6.1 Network model

Proposal: authoritative host model, with a single Node server on the host's machine.

- The **host** runs the simulation (ball physics, collisions, score) and is the single source of truth.
- The **guest** only sends the position of their paddle and receives the game state to render.
- The host also plays, so it runs the simulation and the client at the same time.

### 6.2 Protocol

Communication over WebSocket (TCP) on the LAN, JSON messages. Alternative: UDP, which reduces latency but requires handling packet loss.

| Message | Direction | Content |
| --- | --- | --- |
| `join` | Guest → Host | Request to join the match |
| `start` | Host → Guest | Match start and player roles |
| `paddle` | Each client → the other | Normalized X position of the paddle (0 to 1) |
| `state` | Host → Guest | Ball position and velocity, paddle positions, score, match phase |
| `point` | Host → Guest | Who scored and the new score |
| `end` | Host → Guest | End of match and winner |
| `rematch` | Both | Request for a new match |

Suggested frequency: `state` at 60 Hz, `paddle` on each mouse movement (limited to 60 Hz).

### 6.3 Discovery and connection

1. The host runs the Node program (`npm start`) and opens the game in the browser at `localhost`. The server announces itself on the network as `pong.local` (mDNS), and the screen shows this address and the IP as an alternative.
2. The guest installs nothing: they open `http://pong.local:PORT` in the browser on their own machine.
3. The guest's page connects to the server over WebSocket. With the connection active, the match starts.

If the name pong.local does not resolve (some routers and networks block mDNS), the guest uses the IP shown on the host's screen.

### 6.4 Coordinates and mirroring

- All positions travel in normalized coordinates (0 to 1), independent of screen resolution.
- Each player sees their own paddle at the bottom. For the top player (host), the view is mirrored on both axes (180° rotation) so that both players' experience is identical.

### 6.5 Suggested technology

Chosen: web application in Node.js, played in the browser.

- Node.js server with the `ws` library serving the HTML and acting as host.
- Client in HTML5 Canvas and JavaScript.
- The host runs the Node program (npm start) and announces it on the network as pong.local (mDNS, bonjour-service package). The host plays on localhost and the guest on pong.local.

Discarded for now, option B: desktop application in Python with `pygame` and `socket`.

Discarded for now, option C: Godot or Unity with native networking (more effort for such a simple visual).

## 7. Interface

### 7.1 Palette and style

- Background: `#000000`. Elements: `#FFFFFF`. No other color.
- Monospaced, sans-serif font (e.g.: `Courier`, `Consolas`).
- No shadows, gradients, rounded borders or effects.

### 7.2 Screens

| Screen | Elements |
| --- | --- |
| Start menu | Title "PONG", buttons "Create match" and "Join" |
| Waiting for player | Match address (pong.local and IP), text "Waiting for opponent..." |
| Join | Address field (pong.local or IP), button "Connect" |
| Game | Court, paddles, ball, score, countdown |
| End of match | Winner, final score, button "Play again" |

### 7.3 Game screen

- Score of both players in large white numbers, one on each side of the center line (or one above and the other below), labeled "YOU" and "OPPONENT".
- Paddles: white rectangles.
- Ball: white square.
- Mouse cursor hidden during the match.

## 8. Initial parameters (adjustable)

| Parameter | Initial value |
| --- | --- |
| Court aspect ratio | 3:4 (portrait) |
| Paddle width | 15% of court width |
| Paddle thickness | 2% of court height |
| Ball size | 2% of court width |
| Initial ball speed | 0.5 court widths per second |
| Speed increase per hit | 3% (capped at 2x the initial) |
| Score to win | 10 |
| Countdown | 3 seconds |
| Update rate | 60 Hz |

### 8.1 Global configuration

All the parameters above live in a single configuration file, with no hard-coded values scattered through the code. To change the winning score or the ball speed, it is enough to edit this file. The host sends the configuration to the guest in the `start` message, so both play with the same values.

```js
// config.js: the single place with game values
export const CONFIG = {
  WINNING_SCORE: 10,           // points to win the match
  COUNTDOWN_SECONDS: 3,        // countdown before each rally
  TICK_RATE_HZ: 60,            // updates per second
  COURT_ASPECT_RATIO: 3 / 4,   // width / height
  PADDLE_WIDTH: 0.15,          // fraction of court width
  PADDLE_HEIGHT: 0.02,         // fraction of court height
  BALL_SIZE: 0.02,             // fraction of court width
  BALL_INITIAL_SPEED: 0.5,     // court widths per second
  BALL_SPEED_INCREMENT: 0.03,  // increase per paddle hit
  BALL_MAX_SPEED_FACTOR: 2,    // cap, multiple of the initial speed
  MAX_BOUNCE_ANGLE_DEG: 60,    // maximum exit angle off the paddle
  PORT: 8080,                  // match server port
  HOST_NAME: 'pong',           // mDNS name (pong.local)
};
```

## 9. Error handling

- **Guest cannot connect:** error message suggesting to check the firewall, whether both are on the same network and whether the host has already created the match.
- **Disconnection during the match:** match paused and message "Opponent disconnected", returning to the menu.
- **Port in use:** the host tries the next available port and shows the final port.
- **Third player trying to join:** connection refused with the message "Match full".

## 10. Acceptance criteria

1. Two machines on the same LAN can start and finish a match.
2. Each paddle follows the mouse on the horizontal axis only, without leaving the court.
3. The ball bounces off the side walls and the paddles consistently on both screens.
4. When the ball hits a goal wall, the opposing player gets 1 point, and the score appears the same on both machines.
5. The look uses only black and white.
6. Disconnection is detected and reported to the remaining player.

## 11. Decisions and open points

Confirmed on October 29, 2026: vertical court, win at 10 points (global variable), ball acceleration, Node.js, browser, connection without typing an IP (host runs Node, guest opens pong.local), physics values and exit angle that varies with the point of impact on the paddle. Still open, to be validated on the real network:

1. **Resolution of `pong.local`:** depends on mDNS working on the network. If it fails in testing, the IP shown on the host's screen is plan B.
