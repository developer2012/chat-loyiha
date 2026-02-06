const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 30000,
  pingInterval: 10000
});

const PORT = process.env.PORT || 3000;

// SocketID -> {id,name,level,joinedAt,roomId}
const users = new Map();
// roomId -> [socketIdA, socketIdB]
const rooms = new Map();

let queues = {
  A1: [],
  A2: [],
  B1: [],
  B2: [],
  C1: [],
  C2: []
};

app.use(express.static(path.join(__dirname)));

app.get("/", (req, res) => {
  res.sendFile(path.resolve(__dirname, "index.html"));
});

function safeRemoveFromQueues(socketId) {
  for (const lvl of Object.keys(queues)) {
    queues[lvl] = queues[lvl].filter(u => u.id !== socketId);
  }
}

function tryMatch(socket, profile) {
  const level = profile.level;
  const q = queues[level];

  // queue'dan tirik partner topish
  while (q.length > 0) {
    const partner = q.shift();
    const partnerSocket = io.sockets.sockets.get(partner.id);

    if (!partnerSocket) continue;
    if (partnerSocket.id === socket.id) continue;
    if (!users.has(partnerSocket.id)) continue;

    // Room yaratamiz
    const roomId = "session_" + uuidv4();

    socket.join(roomId);
    partnerSocket.join(roomId);

    profile.roomId = roomId;
    users.get(partnerSocket.id).roomId = roomId;

    rooms.set(roomId, [socket.id, partnerSocket.id]);

    // role: initiator / receiver
    socket.emit("match_found", {
      partner: { name: users.get(partnerSocket.id).name, level: users.get(partnerSocket.id).level },
      role: "initiator",
      roomId
    });

    partnerSocket.emit("match_found", {
      partner: { name: profile.name, level: profile.level },
      role: "receiver",
      roomId
    });

    return true;
  }

  // Partner topilmasa queue'ga qo‘shamiz
  q.push({ id: socket.id, at: Date.now() });
  return false;
}

io.on("connection", (socket) => {
  console.log(`[CONNECTED] ${socket.id}`);

  socket.on("register_user", (data) => {
    try {
      if (!data || !data.name || !data.level) return;

      const level = String(data.level).toUpperCase();
      if (!queues[level]) return;

      const profile = {
        id: socket.id,
        name: String(data.name).trim().slice(0, 24),
        level,
        joinedAt: Date.now(),
        roomId: null
      };

      users.set(socket.id, profile);

      // oldingi queue’dan tozalash (agar qayta register bo‘lsa)
      safeRemoveFromQueues(socket.id);

      // match
      const matched = tryMatch(socket, profile);

      if (!matched) {
        socket.emit("queue_waiting", { level });
      }
    } catch (e) {
      console.error("register_user error:", e);
    }
  });

  // WEBRTC signal relay
  socket.on("signal", (data) => {
    const u = users.get(socket.id);
    if (!u || !u.roomId) return;
    socket.to(u.roomId).emit("signal", data);
  });

  socket.on("message", (msg) => {
    const u = users.get(socket.id);
    if (!u || !u.roomId) return;

    const clean = String(msg || "").trim();
    if (!clean) return;

    io.to(u.roomId).emit("message", {
      sender: u.name,
      text: clean.slice(0, 800),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    });
  });

  socket.on("leave", () => {
    const u = users.get(socket.id);
    if (!u) return;

    // room bo‘lsa partnerga aytamiz
    if (u.roomId) {
      socket.to(u.roomId).emit("partner_disconnected");
      rooms.delete(u.roomId);
      socket.leave(u.roomId);
    }

    safeRemoveFromQueues(socket.id);
    users.delete(socket.id);
  });

  socket.on("disconnect", () => {
    const u = users.get(socket.id);

    if (u && u.roomId) {
      socket.to(u.roomId).emit("partner_disconnected");
      rooms.delete(u.roomId);
    }

    safeRemoveFromQueues(socket.id);
    users.delete(socket.id);

    console.log(`[DISCONNECTED] ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`>>> LANGPRO CORE ON PORT ${PORT} <<<`);
});
