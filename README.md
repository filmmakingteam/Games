# Basic Rummy Multiplayer (starter project)

A mobile-friendly, original Basic Rummy web-game prototype. It supports 2–10 real players in a room, room codes/invite links, configurable hand sizes, no jokers, automatic deck selection, drawing/discarding, valid sets/runs, and a win when a player legally empties their hand. A local demo mode includes simple computer opponents.

## Important limitations of this first version
- Online multiplayer works when this Node.js server is running and publicly reachable. It is not a hosted website by itself.
- Computer opponents are currently available only in the local demo mode, not as network-room seats.
- Player reconnection/session recovery, persistent accounts, chat, anti-cheat hardening, and production deployment configuration are not included yet.
- This is a starter implementation of basic draw/discard rummy inspired by common rules; confirm the precise rules you want before treating it as a final release.

## Run on a computer
1. Install Node.js 18 or newer.
2. Extract the ZIP and open a terminal in the project folder.
3. Run `npm install`
4. Run `npm start`
5. Open `http://localhost:3000`

## Test on phones on the same Wi-Fi
1. Start the server on your computer.
2. Find your computer's local IP address (for example `192.168.1.25`).
3. On phones connected to the same Wi-Fi, open `http://192.168.1.25:3000`.
4. Create a room on one phone and share the code with the others.
5. Allow inbound TCP port 3000 through your computer's firewall if needed.

## Play from different locations
Deploy this project to a Node.js hosting service that supports WebSockets/Socket.IO, then share its HTTPS URL. A free tier may be enough for testing, subject to provider limits and sleep/usage policies. Do not use `localhost` for players on different networks.

## Rules in this build
- Each player draws one card from the stock or top of the discard pile, then may lay down one or more valid melds and discards one card to finish their turn.
- Sets: 3+ cards of the same rank, with distinct suits.
- Runs: 3+ consecutive ranks in the same suit. Ace is low only (A-2-3).
- The first player to legally empty their hand wins.
- Deck count is automatically calculated to deal all hands and retain at least 11 cards for stock plus opening discard.

## Deck formula
`decks = ceil((players × cardsPerPlayer + 11) / 52)`, minimum one deck. The extra 11 reserves a draw pile and opening discard; exact remaining cards vary with the chosen settings.

## Production checklist
- Add proper reconnect support and rejoin tokens.
- Add server-side turn timers and disconnect handling.
- Add automated tests for meld validation, deck calculation, and win conditions.
- Add a proper rules/help screen and test on real Android/iOS browsers.
- Add secure deployment settings, rate limiting, logging, and room cleanup.
