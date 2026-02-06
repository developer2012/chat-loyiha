/**
 * LangPro - Senior Level Enterprise Chat Engine
 * Real-time Communication with WebRTC Signaling & Advanced Matchmaking
 * Version: 2.1.0
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const colors = require('colors');
const fs = require('fs');

// --- INITIALIZATION ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 30000,
    pingInterval: 10000
});

// --- CONSTANTS & CONFIG ---
const PORT = process.env.PORT || 3000;
const MAX_MSG_LENGTH = 1000;
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 daqiqa

// --- STATE MANAGEMENT (In-Memory Database) ---
const State = {
    users: new Map(), // All online users
    rooms: new Map(), // Active chat sessions
    queue: {
        "A1": [], "A2": [], "B1": [], "B2": [], "C1": [], "C2": []
    },
    stats: {
        totalConnections: 0,
        totalMessages: 0,
        totalMatches: 0
    }
};

// --- LOGGING SYSTEM ---
const Logger = {
    log: (msg, type = 'info') => {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}]`.grey;
        let formattedMsg;

        switch (type) {
            case 'success': formattedMsg = `${'✓'.green} ${msg.bold}`; break;
            case 'error': formattedMsg = `${'✗'.red} ${msg.red.bold}`; break;
            case 'warn': formattedMsg = `${'!'.yellow} ${msg.yellow}`; break;
            default: formattedMsg = `${'i'.cyan} ${msg}`;
        }
        console.log(`${prefix} ${formattedMsg}`);
    }
};

// --- MIDDLEWARES ---
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// --- ROUTES ---
app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'index.html'));
});

// Health check endpoint for monitoring
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        uptime: process.uptime(),
        activeUsers: State.users.size,
        activeRooms: State.rooms.size
    });
});

// --- CORE MATCHMAKING LOGIC ---
const attemptMatch = (socket, level) => {
    const queue = State.queue[level];

    if (queue.length > 0) {
        const partnerInfo = queue.shift();
        const partnerSocket = io.sockets.sockets.get(partnerInfo.id);

        if (!partnerSocket) {
            Logger.log(`Partner ${partnerInfo.name} disconnected while in queue`, 'warn');
            return attemptMatch(socket, level);
        }

        const roomId = `room_${uuidv4()}`;
        
        // Setup room
        socket.join(roomId);
        partnerSocket.join(roomId);
        
        socket.currentRoom = roomId;
        partnerSocket.currentRoom = roomId;

        const roomData = {
            id: roomId,
            users: [socket.id, partnerSocket.id],
            createdAt: Date.now(),
            level: level
        };

        State.rooms.set(roomId, roomData);
        State.stats.totalMatches++;

        // Notify both parties
        const user = State.users.get(socket.id);
        const partner = State.users.get(partnerSocket.id);

        io.to(roomId).emit('match_found', {
            roomId,
            partner: { name: partner.name, level: partner.level },
            me: { name: user.name }
        });

        partnerSocket.emit('match_found', {
            roomId,
            partner: { name: user.name, level: user.level },
            me: { name: partner.name }
        });

        Logger.log(`Match Created: ${user.name} ↔ ${partner.name} [${level}]`, 'success');
    } else {
        const userData = State.users.get(socket.id);
        State.queue[level].push({ id: socket.id, name: userData.name });
        Logger.log(`${userData.name} added to ${level} queue`);
    }
};

// --- SOCKET.IO HANDLING ---
io.on('connection', (socket) => {
    State.stats.totalConnections++;
    Logger.log(`New connection established: ${socket.id.substring(0,6)}...`);

    // 1. User Registration
    socket.on('register_user', (data) => {
        try {
            if (!data.name || !data.level) throw new Error("Invalid registration data");

            const newUser = {
                id: socket.id,
                name: data.name.substring(0, 25),
                level: data.level,
                registeredAt: Date.now()
            };

            State.users.set(socket.id, newUser);
            Logger.log(`User Registered: ${newUser.name} (${newUser.level})`, 'success');

            attemptMatch(socket, newUser.level);
        } catch (err) {
            Logger.log(`Registration failed: ${err.message}`, 'error');
            socket.emit('error_msg', "Ro'yxatdan o'tishda xatolik yuz berdi.");
        }
    });

    // 2. Messaging Logic
    socket.on('message', (text) => {
        const user = State.users.get(socket.id);
        if (user && socket.currentRoom && text.length <= MAX_MSG_LENGTH) {
            socket.to(socket.currentRoom).emit('message', {
                sender: user.name,
                text: text,
                time: new Date().toLocaleTimeString()
            });
            State.stats.totalMessages++;
        }
    });

    // 3. WebRTC Signaling Relay
    socket.on('signal', (payload) => {
        if (socket.currentRoom) {
            socket.to(socket.currentRoom).emit('signal', payload);
        }
    });

    // 4. Typing Indicator
    socket.on('typing', (isTyping) => {
        if (socket.currentRoom) {
            socket.to(socket.currentRoom).emit('partner_typing', isTyping);
        }
    });

    // 5. Clean Disconnect
    socket.on('disconnect', () => {
        const user = State.users.get(socket.id);
        if (user) {
            // Remove from queue
            State.queue[user.level] = State.queue[user.level].filter(u => u.id !== socket.id);

            // Handle active room cleanup
            if (socket.currentRoom) {
                socket.to(socket.currentRoom).emit('partner_disconnected');
                State.rooms.delete(socket.currentRoom);
                Logger.log(`Room ${socket.currentRoom} closed.`, 'warn');
            }

            State.users.delete(socket.id);
            Logger.log(`User ${user.name} offline.`);
        }
    });
});

// --- AUTO-CLEANUP CRON (Memory Management) ---
setInterval(() => {
    Logger.log(`System Status: ${State.users.size} Users Online | ${State.rooms.size} Active Rooms`);
    // Bu yerda eski xonalarni tozalash mantiqi bo'lishi mumkin
}, 60000 * 5); // Har 5 daqiqada

// --- SERVER START ---
const startServer = () => {
    try {
        server.listen(PORT, () => {
            console.clear();
            console.log("===============================================".blue);
            console.log("   🚀 LANGPRO SENIOR CHAT ENGINE STARTED      ".white.bgBlue.bold);
            console.log("===============================================".blue);
            console.log(`📡 Port: ${PORT}`);
            console.log(`🏠 Mode: Production`);
            console.log(`🛠️  Node: ${process.version}`);
            console.log("===============================================".blue);
        });
    } catch (err) {
        Logger.log(`Server startup failed: ${err.message}`, 'error');
        process.exit(1);
    }
};

startServer();

// Error handling for global process
process.on('unhandledRejection', (reason, promise) => {
    Logger.log(`Unhandled Rejection: ${reason}`, 'error');
});