/**
 * ====================================================================
 * LANGPRO ENTERPRISE CHAT ENGINE v3.0 (SENIOR ARCHITECTURE)
 * ====================================================================
 * Author: Gemini AI Collaboration
 * Features: 
 * - High-performance WebRTC Signaling
 * - Advanced Room Management
 * - Memory Leak Protection
 * - Dynamic Peer-to-Peer Handshaking
 * ====================================================================
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const colors = require('colors');
const fs = require('fs');

// --- 1. CORE SERVER INITIALIZATION ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    connectTimeout: 45000,
    pingTimeout: 30000,
    pingInterval: 10000,
    transports: ['websocket', 'polling']
});

// --- 2. GLOBAL CONSTANTS ---
const PORT = process.env.PORT || 3000;
const MAX_QUEUE_SIZE = 500;
const ROOM_ID_PREFIX = 'lp_room_';

// --- 3. SYSTEM STATE (IN-MEMORY DATABASE) ---
const GlobalState = {
    activeUsers: new Map(),
    activeRooms: new Map(),
    matchmaking: {
        "A1": [], "A2": [], "B1": [], "B2": [], "C1": [], "C2": []
    },
    performance: {
        totalMatches: 0,
        failedSignals: 0,
        messagesProcessed: 0,
        startTime: Date.now()
    }
};

// --- 4. ADVANCED LOGGER SYSTEM ---
const SysLog = {
    info: (msg) => console.log(`${'[INFO]'.blue} ${new Date().toLocaleTimeString()} - ${msg}`),
    success: (msg) => console.log(`${'[OK]'.green} ${new Date().toLocaleTimeString()} - ${msg.bold}`),
    warn: (msg) => console.log(`${'[WARN]'.yellow} ${new Date().toLocaleTimeString()} - ${msg}`),
    error: (msg) => console.log(`${'[ERR]'.red} ${new Date().toLocaleTimeString()} - ${msg.toUpperCase()}`),
    signal: (msg) => console.log(`${'[RTC]'.magenta} ${msg}`)
};

// --- 5. MIDDLEWARE & STATIC ASSETS ---
app.use(express.static(path.join(__dirname)));
app.use(express.json());

// --- 6. ROUTES ---
app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'index.html'));
});

// System Monitor API
app.get('/api/status', (req, res) => {
    res.status(200).json({
        online: true,
        users: GlobalState.activeUsers.size,
        rooms: GlobalState.activeRooms.size,
        uptime: Math.floor((Date.now() - GlobalState.performance.startTime) / 1000) + 's',
        stats: GlobalState.performance
    });
});

// --- 7. MATCHMAKING CORE ALGORITHM ---
const processMatchmaking = (socket, level) => {
    const queue = GlobalState.matchmaking[level];

    if (queue.length > 0) {
        // Partner topildi
        const partnerRef = queue.shift();
        const partnerSocket = io.sockets.sockets.get(partnerRef.id);

        if (!partnerSocket || partnerSocket.id === socket.id) {
            SysLog.warn(`Partner ${partnerRef.id} not available, retrying...`);
            return processMatchmaking(socket, level);
        }

        const roomId = ROOM_ID_PREFIX + uuidv4();
        
        // Room Management
        socket.join(roomId);
        partnerSocket.join(roomId);
        
        socket.currentRoomId = roomId;
        partnerSocket.currentRoomId = roomId;

        const roomMetadata = {
            id: roomId,
            participants: [socket.id, partnerSocket.id],
            level: level,
            startTime: Date.now()
        };

        GlobalState.activeRooms.set(roomId, roomMetadata);
        GlobalState.performance.totalMatches++;

        // WebRTC Role Assignment
        // Caller (Offer yuboruvchi) va Receiver (Answer yuboruvchi)
        const userA = GlobalState.activeUsers.get(socket.id);
        const userB = GlobalState.activeUsers.get(partnerSocket.id);

        // Notify User A (Caller)
        socket.emit('match_found', {
            roomId: roomId,
            partner: { name: userB.name, level: userB.level },
            role: 'caller' 
        });

        // Notify User B (Receiver)
        partnerSocket.emit('match_found', {
            roomId: roomId,
            partner: { name: userA.name, level: userA.level },
            role: 'receiver'
        });

        SysLog.success(`VOICE BRIDGE: ${userA.name} <==> ${userB.name} [Room: ${roomId}]`);
    } else {
        // Navbatga qo'shish
        const userData = GlobalState.activeUsers.get(socket.id);
        GlobalState.matchmaking[level].push({ id: socket.id, name: userData.name });
        SysLog.info(`${userData.name} is waiting in ${level} queue...`);
    }
};

// --- 8. SOCKET.IO REAL-TIME ENGINE ---
io.on('connection', (socket) => {
    SysLog.info(`Connection attempt: ${socket.id}`);

    // [A] Registration
    socket.on('register_user', (payload) => {
        if (!payload.name || !payload.level) {
            return socket.emit('sys_error', 'Ma'lumotlar to'liq emas');
        }

        const userProfile = {
            id: socket.id,
            name: payload.name.substring(0, 20),
            level: payload.level,
            joinedAt: Date.now()
        };

        GlobalState.activeUsers.set(socket.id, userProfile);
        SysLog.info(`User Registered: ${userProfile.name} [${userProfile.level}]`);

        processMatchmaking(socket, userProfile.level);
    });

    // [B] WEBRTC SIGNALING RELAY (OVOZ UCHUN ENG MUHIM QISM)
    socket.on('signal', (data) => {
        if (socket.currentRoomId) {
            // Signalni xonadagi boshqa foydalanuvchiga yuborish
            socket.to(socket.currentRoomId).emit('signal', data);
            
            if (data.offer) SysLog.signal(`OFFER from ${socket.id}`);
            if (data.answer) SysLog.signal(`ANSWER from ${socket.id}`);
            if (data.candidate) SysLog.signal(`ICE_CANDIDATE relaying...`);
        } else {
            GlobalState.performance.failedSignals++;
        }
    });

    // [C] Message Handling
    socket.on('message', (text) => {
        const user = GlobalState.activeUsers.get(socket.id);
        if (user && socket.currentRoomId) {
            socket.to(socket.currentRoomId).emit('message', {
                sender: user.name,
                text: text,
                timestamp: new Date().toLocaleTimeString()
            });
            GlobalState.performance.messagesProcessed++;
        }
    });

    // [D] Typing Indicator
    socket.on('typing_status', (status) => {
        if (socket.currentRoomId) {
            socket.to(socket.currentRoomId).emit('partner_typing', status);
        }
    });

    // [E] Disconnection & Cleanup
    socket.on('disconnect', () => {
        const user = GlobalState.activeUsers.get(socket.id);
        if (user) {
            // Remove from matchmaking queues
            Object.keys(GlobalState.matchmaking).forEach(lvl => {
                GlobalState.matchmaking[lvl] = GlobalState.matchmaking[lvl].filter(u => u.id !== socket.id);
            });

            // Handle room cleanup
            if (socket.currentRoomId) {
                socket.to(socket.currentRoomId).emit('partner_disconnected');
                GlobalState.activeRooms.delete(socket.currentRoomId);
                SysLog.warn(`Session Terminated: ${socket.currentRoomId}`);
            }

            GlobalState.activeUsers.delete(socket.id);
            SysLog.info(`Client ${user.name} offline.`);
        }
    });
});

// --- 9. AUTO-MAINTENANCE (MEMORY MONITOR) ---
setInterval(() => {
    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
    SysLog.info(`Memory Usage: ${Math.round(memoryUsage)}MB | Active Users: ${GlobalState.activeUsers.size}`);
    
    // Clean orphan rooms
    GlobalState.activeRooms.forEach((room, id) => {
        if (Date.now() - room.startTime > 3600000) { // 1 soatdan ko'p bo'lsa
            GlobalState.activeRooms.delete(id);
        }
    });
}, 300000); // Har 5 daqiqada

// --- 10. SERVER STARTUP ---
const bootstrap = () => {
    try {
        server.listen(PORT, () => {
            process.stdout.write('\x1Bc'); // Clear terminal
            console.log("=====================================================".blue);
            console.log("   🛡️  LANGPRO SENIOR BACKEND CORE v3.0 ONLINE     ".white.bgBlue.bold);
            console.log("=====================================================".blue);
            console.log(`${'>>'.green} SERVER_PORT: ${PORT.toString().yellow}`);
            console.log(`${'>>'.green} WEBRTC_RELAY: ACTIVE`.cyan);
            console.log(`${'>>'.green} ENGINE_VERSION: NODE_${process.version}`);
            console.log(`${'>>'.green} STATUS: WAITING_FOR_CONNECTIONS...`);
            console.log("=====================================================".blue);
        });
    } catch (e) {
        SysLog.error(`FATAL STARTUP ERROR: ${e.message}`);
        process.exit(1);
    }
};

bootstrap();

// Global Exception Handler
process.on('uncaughtException', (err) => SysLog.error(`UNCAUGHT: ${err.message}`));
process.on('unhandledRejection', (reason) => SysLog.error(`REJECTION: ${reason}`));