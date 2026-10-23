const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_, res) => res.json({ ok: true, game: "Basic Rummy" }));

const rooms = new Map();
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function makeDeck(deckCount) {
  const deck = [];
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) for (let i = 0; i < RANKS.length; i++) {
      deck.push({ id: `${d}-${suit}-${RANKS[i]}`, suit, rank: RANKS[i], value: i + 1 });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function requiredDecks(players, handSize) {
  // Leave at least 11 cards for a stock pile and the opening discard.
  return Math.max(1, Math.ceil((players * handSize + 11) / 52));
}
function publicState(room, viewerId) {
  return {
    code: room.code, status: room.status, hostId: room.hostId,
    settings: room.settings, currentTurn: room.currentTurn,
    stockCount: room.stock.length, discardTop: room.discard[room.discard.length - 1] || null,
    players: room.players.map(p => ({
      id: p.id, name: p.name, isHost: p.id === room.hostId,
      isYou: p.id === viewerId, connected: p.connected,
      handCount: p.hand.length, melds: p.melds
    })),
    hand: (room.players.find(p => p.id === viewerId) || {}).hand || [],
    discard: room.discard.slice(-8),
    winnerId: room.winnerId,
    message: room.message
  };
}
function emitRoom(room) {
  for (const p of room.players) if (p.connected) {
    io.to(p.id).emit("state", publicState(room, p.id));
  }
}
function getRoom(socket) {
  const room = rooms.get(socket.data.roomCode);
  if (!room) throw new Error("Room not found.");
  return room;
}
function errorTo(socket, msg) { socket.emit("notice", { type: "error", message: msg }); }
function startGame(room) {
  const n = room.players.length, h = room.settings.handSize;
  if (n < 2) throw new Error("At least 2 players are needed to start.");
  const decks = requiredDecks(n, h);
  const cards = makeDeck(decks);
  room.players.forEach(p => { p.hand = []; p.melds = []; });
  for (let i = 0; i < h; i++) for (const p of room.players) p.hand.push(cards.pop());
  room.stock = cards;
  room.discard = [room.stock.pop()];
  room.currentTurn = 0;
  room.status = "playing";
  room.winnerId = null;
  room.message = `Game started with ${decks} deck${decks === 1 ? "" : "s"} and ${h} cards per player.`;
  room.drawn = null;
}
function cardValue(card) {
  return card.rank === "A" ? 1 : (["J","Q","K"].includes(card.rank) ? 10 : Number(card.rank));
}
function validMeld(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;
  const sameRank = cards.every(c => c.rank === cards[0].rank);
  if (sameRank && new Set(cards.map(c => c.suit)).size === cards.length) return true;
  const sameSuit = cards.every(c => c.suit === cards[0].suit);
  if (!sameSuit) return false;
  const vals = cards.map(c => c.rank === "A" ? 1 : (c.rank === "J" ? 11 : c.rank === "Q" ? 12 : c.rank === "K" ? 13 : Number(c.rank))).sort((a,b)=>a-b);
  return vals.every((v,i) => i === 0 || v === vals[i-1] + 1);
}
function maybeWin(room, player) {
  if (player.hand.length === 0) {
    room.status = "finished";
    room.winnerId = player.id;
    room.message = `${player.name} wins!`;
    return true;
  }
  return false;
}
io.on("connection", socket => {
  socket.on("createRoom", ({ name, handSize }) => {
    try {
      name = String(name || "Player").trim().slice(0, 20) || "Player";
      handSize = Math.max(3, Math.min(20, Number(handSize) || 7));
      const code = crypto.randomBytes(3).toString("hex").toUpperCase();
      const room = {
        code, hostId: socket.id, status: "lobby",
        settings: { handSize, maxPlayers: 10, decks: null, jokers: false },
        players: [{ id: socket.id, name, hand: [], melds: [], connected: true }],
        stock: [], discard: [], currentTurn: 0, winnerId: null, message: "Waiting for players.",
        drawn: null
      };
      rooms.set(code, room); socket.data.roomCode = code;
      socket.emit("joined", { code }); emitRoom(room);
    } catch (e) { errorTo(socket, e.message); }
  });
  socket.on("joinRoom", ({ code, name }) => {
    try {
      code = String(code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) throw new Error("That room code was not found.");
      if (room.status !== "lobby") throw new Error("This game has already started.");
      if (room.players.length >= 10) throw new Error("This room already has 10 players.");
      name = String(name || "Player").trim().slice(0, 20) || "Player";
      if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) name += ` ${room.players.length + 1}`;
      room.players.push({ id: socket.id, name, hand: [], melds: [], connected: true });
      socket.data.roomCode = code; socket.emit("joined", { code }); room.message = `${name} joined the room.`; emitRoom(room);
    } catch (e) { errorTo(socket, e.message); }
  });
  socket.on("setHandSize", ({ handSize }) => {
    try {
      const room = getRoom(socket);
      if (socket.id !== room.hostId) throw new Error("Only the host can change settings.");
      if (room.status !== "lobby") throw new Error("Settings cannot be changed during a game.");
      room.settings.handSize = Math.max(3, Math.min(20, Number(handSize) || 7));
      emitRoom(room);
    } catch(e) { errorTo(socket, e.message); }
  });
  socket.on("startGame", () => {
    try {
      const room = getRoom(socket);
      if (socket.id !== room.hostId) throw new Error("Only the host can start the game.");
      startGame(room); emitRoom(room);
    } catch(e) { errorTo(socket, e.message); }
  });
  socket.on("draw", ({ from }) => {
    try {
      const room = getRoom(socket);
      if (room.status !== "playing") throw new Error("The game is not in progress.");
      const player = room.players[room.currentTurn];
      if (player.id !== socket.id) throw new Error("It is not your turn.");
      if (room.drawn) throw new Error("You have already drawn a card. Discard or meld first.");
      let card;
      if (from === "discard") card = room.discard.pop();
      else card = room.stock.pop();
      if (!card) throw new Error("No cards available in that pile.");
      player.hand.push(card); room.drawn = { playerId: player.id, cardId: card.id };
      room.message = `${player.name} drew from the ${from === "discard" ? "discard pile" : "stock pile"}.`;
      emitRoom(room);
    } catch(e) { errorTo(socket, e.message); }
  });
  socket.on("meld", ({ cardIds }) => {
    try {
      const room = getRoom(socket);
      if (room.status !== "playing") throw new Error("The game is not in progress.");
      const player = room.players[room.currentTurn];
      if (player.id !== socket.id) throw new Error("It is not your turn.");
      if (!room.drawn || room.drawn.playerId !== player.id) throw new Error("Draw a card before laying down a meld.");
      if (!Array.isArray(cardIds) || new Set(cardIds).size !== cardIds.length) throw new Error("Select 3 or more different cards.");
      const cards = cardIds.map(id => player.hand.find(c => c.id === id));
      if (cards.some(c => !c) || !validMeld(cards)) throw new Error("Those cards do not form a valid set or run.");
      player.hand = player.hand.filter(c => !cardIds.includes(c.id));
      player.melds.push(cards);
      room.message = `${player.name} laid down a meld.`;
      if (maybeWin(room, player)) { emitRoom(room); return; }
      emitRoom(room);
    } catch(e) { errorTo(socket, e.message); }
  });
  socket.on("discardCard", ({ cardId }) => {
    try {
      const room = getRoom(socket);
      if (room.status !== "playing") throw new Error("The game is not in progress.");
      const player = room.players[room.currentTurn];
      if (player.id !== socket.id) throw new Error("It is not your turn.");
      if (!room.drawn || room.drawn.playerId !== player.id) throw new Error("Draw a card before discarding.");
      const idx = player.hand.findIndex(c => c.id === cardId);
      if (idx < 0) throw new Error("Card not found in your hand.");
      const [card] = player.hand.splice(idx, 1);
      room.discard.push(card);
      room.drawn = null;
      if (maybeWin(room, player)) { emitRoom(room); return; }
      room.currentTurn = (room.currentTurn + 1) % room.players.length;
      room.message = `${player.name} discarded ${card.rank}${card.suit}.`;
      if (room.stock.length === 0) {
        // Recycle all but the top discard into a freshly shuffled stock.
        if (room.discard.length > 1) {
          const top = room.discard.pop();
          room.stock = room.discard.splice(0);
          for (let i = room.stock.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [room.stock[i],room.stock[j]]=[room.stock[j],room.stock[i]]; }
          room.discard = [top];
        }
      }
      emitRoom(room);
    } catch(e) { errorTo(socket, e.message); }
  });
  socket.on("newGame", () => {
    try {
      const room = getRoom(socket);
      if (socket.id !== room.hostId) throw new Error("Only the host can start a rematch.");
      room.status = "lobby"; room.winnerId = null; room.message = "Ready for another game."; room.stock=[]; room.discard=[]; room.drawn=null;
      room.players.forEach(p => { p.hand=[]; p.melds=[]; });
      emitRoom(room);
    } catch(e) { errorTo(socket, e.message); }
  });
  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.id);
    if (p) { p.connected = false; room.message = `${p.name} disconnected.`; }
    emitRoom(room);
    // Keep the room alive briefly so a reconnecting player can see the room, but this starter project does not yet implement session recovery.
    setTimeout(() => {
      const current = rooms.get(room.code);
      if (current && current.players.every(x => !x.connected)) rooms.delete(room.code);
    }, 60000);
  });
});
server.listen(PORT, () => console.log(`Basic Rummy server running at http://localhost:${PORT}`));
