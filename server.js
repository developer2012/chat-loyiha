/**
 * LANGPRO ENTERPRISE CHAT ENGINE v4.0
 * FULL ARCHITECTURE FOR WEBRTC SIGNALING AND REAL-TIME MESH NETWORKS
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const colors = require('colors');

// --- SERVER CONFIGURATION ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 60000,
    transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 3000;

// --- GLOBAL DATABASE (IN-MEMORY) ---
const DB = {
    users: new Map(),
    rooms: new Map(),
    queues: { "A1": [], "A2": [], "B1": [], "B2": [], "C1": [], "C2": [] },
    metrics: {
        totalConnections: 0,
        activeSignals: 0,
        messagesSent: 0,
        startTime: Date.now()
    }
};

// --- MIDDLEWARE ---
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// --- ROUTES ---
app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'index.html'));
});

// System Diagnostics API
app.get('/system/health', (req, res) => {
    res.json({
        status: "operational",
        uptime: Math.floor((Date.now() - DB.metrics.startTime) / 1000) + "s",
        active_users: DB.users.size,
        active_rooms: DB.rooms.size,
        performance: DB.metrics
    });
});

// --- MATCHMAKING ENGINE ---
function engineMatch(socket, level) {
    const targetQueue = DB.queues[level];
    
    if (targetQueue.length > 0) {
        const partnerData = targetQueue.shift();
        const partnerSocket = io.sockets.sockets.get(partnerData.id);

        if (!partnerSocket || partnerSocket.id === socket.id) {
            return engineMatch(socket, level);
        }

        const sessionID = `session_${uuidv4()}`;
        socket.join(sessionID);
        partnerSocket.join(sessionID);

        socket.sessionID = sessionID;
        partnerSocket.sessionID = sessionID;

        DB.rooms.set(sessionID, {
            id: sessionID,
            peers: [socket.id, partnerSocket.id],
            timestamp: Date.now()
        });

        // SIGNAL ROLES (Ovoz aniq borishi uchun rollar shart)
        socket.emit('match_found', {
            sessionID,
            partner: { name: DB.users.get(partnerSocket.id).name },
            role: 'initiator' // Chaqiruvchi
        });

        partnerSocket.emit('match_found', {
            sessionID,
            partner: { name: DB.users.get(socket.id).name },
            role: 'receiver' // Qabul qiluvchi
        });

        console.log(`[MATCH] ${sessionID} created between ${socket.id} and ${partnerSocket.id}`.green);
    } else {
        DB.queues[level].push({ id: socket.id });
        console.log(`[QUEUE] User ${socket.id} joined ${level}`.yellow);
    }
}

// --- REAL-TIME GATEWAY ---
io.on('connection', (socket) => {
    DB.metrics.totalConnections++;

    socket.on('register_user', (data) => {
        // XAVFSIZLIK: Tutuq belgilari muammosi hal qilingan
        if (!data.name || !data.level) {
            return socket.emit('sys_error', "Ma'lumotlar yetarli emas.");
        }

        DB.users.set(socket.id, {
            id: socket.id,
            name: data.name.substring(0, 25),
            level: data.level,
            joinedAt: Date.now()
        });

        engineMatch(socket, data.level);
    });

    // WEBRTC SIGNALING RELAY (Ovoz uzatish markazi)
    socket.on('signal', (payload) => {
        if (socket.sessionID) {
            DB.metrics.activeSignals++;
            socket.to(socket.sessionID).emit('signal', payload);
        }
    });

    socket.on('message', (content) => {
        const sender = DB.users.get(socket.id);
        if (sender && socket.sessionID) {
            DB.metrics.messagesSent++;
            io.to(socket.sessionID).emit('message', {
                user: sender.name,
                text: content,
                time: new Date().toLocaleTimeString()
            });
        }
    });

    socket.on('disconnect', () => {
        const user = DB.users.get(socket.id);
        if (user) {
            // Queuelarni tozalash
            Object.keys(DB.queues).forEach(l => {
                DB.queues[l] = DB.queues[l].filter(q => q.id !== socket.id);
            });

            if (socket.sessionID) {
                socket.to(socket.sessionID).emit('partner_offline');
                DB.rooms.delete(socket.sessionID);
            }
            DB.users.delete(socket.id);
        }
    });
});

server.listen(PORT, () => {
    console.log("=========================================".cyan);
    console.log("   LANGPRO ENTERPRISE ENGINE IS LIVE     ".bold.white.bgBlue);
    console.log(`   PORT: ${PORT} | STATUS: READY`.cyan);
    console.log("=========================================".cyan);
});