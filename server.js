/**
 * LangPro - Senior Level Backend Architecture
 * Real-time Language Exchange Engine with WebRTC & Socket.io
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const color = require('colors'); // Agar o'rnatilmagan bo'lsa: npm install colors

// --- SERVER SETUP ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 60000,
});

// --- MIDDLEWARES & STATIC ASSETS ---
app.use(express.static(__dirname));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- DATA STRUCTURES (Memory Optimized) ---
const activeUsers = new Map(); // Global user registry
const activeRooms = new Map(); // Current active sessions
const matchmakingQueues = {
    "A1": [], "A2": [], "B1": [], "B2": [], "C1": [], "C2": []
};

// --- LOGGING UTILITY ---
const logger = {
    info: (msg) => console.log(`[${new Date().toLocaleTimeString()}] ℹ️  ${msg}`.cyan),
    success: (msg) => console.log(`[${new Date().toLocaleTimeString()}] ✅ ${msg}`.green.bold),
    warn: (msg) => console.log(`[${new Date().toLocaleTimeString()}] ⚠️  ${msg}`.yellow),
    error: (msg) => console.log(`[${new Date().toLocaleTimeString()}] ❌ ${msg}`.red.underline)
};

// --- CORE MATCHMAKING LOGIC ---
const handleMatchmaking = (socket, user) => {
    const queue = matchmakingQueues[user.level];
    
    // Check if there is a waiting peer
    if (queue.length > 0) {
        const partner = queue.shift();
        
        // Ensure partner is still connected
        const partnerSocket = io.sockets.sockets.get(partner.id);
        if (!partnerSocket) {
            logger.warn(`Partner ${partner.name} disconnected. Re-searching...`);
            return handleMatchmaking(socket, user);
        }

        const roomId = `room_${uuidv4()}`;
        
        // Create Room Data
        const sessionData = {
            id: roomId,
            participants: [socket.id, partner.id],
            metadata: { level: user.level, startTime: Date.now() }
        };

        // Network Layer: Join Room
        socket.join(roomId);
        partnerSocket.join(roomId);
        
        // Store session info in socket instances
        socket.currentRoom = roomId;
        partnerSocket.currentRoom = roomId;
        
        activeRooms.set(roomId, sessionData);

        // Notify Clients
        io.to(roomId).emit('match_found', {
            roomId: roomId,
            partner: { name: partner.name, level: partner.level },
            timestamp: Date.now()
        });

        logger.success(`Session Established: ${user.name} 🤝 ${partner.name} (${user.level})`);
    } else {
        // No match found, add to queue
        queue.push({ id: socket.id, name: user.name, level: user.level });
        logger.info(`${user.name} (${user.level}) is now in queue.`);
    }
};

// --- SOCKET.IO EVENT HANDLERS ---
io.on('connection', (socket) => {
    logger.info(`New raw connection established: ${socket.id}`);

    /**
     * @event register_user
     * Initializes user profile and enters matchmaking
     */
    socket.on('register_user', (payload) => {
        try {
            const { name, level } = payload;
            if (!name || !level) throw new Error("Invalid registration data");

            const profile = {
                id: socket.id,
                name: name.substring(0, 20),
                level: level,
                joinedAt: Date.now()
            };

            activeUsers.set(socket.id, profile);
            logger.info(`User Registered: ${profile.name} [${profile.level}]`);
            
            handleMatchmaking(socket, profile);
        } catch (err) {
            logger.error(`Registration Error: ${err.message}`);
            socket.emit('system_error', { message: "Internal Server Error" });
        }
    });

    /**
     * @event message
     * Relays text chat messages within the assigned room
     */
    socket.on('message', (text) => {
        const room = socket.currentRoom;
        const user = activeUsers.get(socket.id);

        if (room && user) {
            socket.to(room).emit('message', {
                senderId: socket.id,
                senderName: user.name,
                content: text,
                time: new Date().toLocaleTimeString()
            });
            logger.info(`[MSG] ${user.name} in ${room}: ${text.substring(0, 30)}...`);
        }
    });

    /**
     * @event signal
     * WebRTC Signaling relay (Offers, Answers, IceCandidates)
     */
    socket.on('signal', (payload) => {
        const room = socket.currentRoom;
        if (room) {
            // Forward signaling data to the other party
            socket.to(room).emit('signal', payload);
        }
    });

    /**
     * @event typing
     * UX Feature: Show typing indicator
     */
    socket.on('typing', (isTyping) => {
        const room = socket.currentRoom;
        if (room) {
            socket.to(room).emit('partner_typing', { typing: isTyping });
        }
    });

    /**
     * @event disconnect
     * Graceful cleanup of resources
     */
    socket.on('disconnect', (reason) => {
        const user = activeUsers.get(socket.id);
        const room = socket.currentRoom;

        if (user) {
            // Remove from matchmaking queues
            const queue = matchmakingQueues[user.level];
            const index = queue.findIndex(u => u.id === socket.id);
            if (index !== -1) queue.splice(index, 1);

            // Notify partner if in a room
            if (room) {
                socket.to(room).emit('partner_disconnected', { name: user.name });
                activeRooms.delete(room);
                logger.warn(`Room ${room} dissolved due to disconnect.`);
            }

            activeUsers.delete(socket.id);
            logger.info(`User ${user.name} disconnected (${reason})`);
        }
    });
});

// --- SERVER LIFECYCLE ---
const PORT = process.env.PORT || 3000;

const startServer = () => {
    try {
        server.listen(PORT, () => {
            console.clear();
            console.log("===============================================".blue);
            console.log("   🚀 LANGPRO SENIOR REAL-TIME ENGINE START   ".white.bgBlue.bold);
            console.log("===============================================".blue);
            console.log(`📡 Status:    Online`.green);
            console.log(`🔗 Endpoint:  http://localhost:${PORT}`.white);
            console.log(`📦 Node Ver:  ${process.version}`.white);
            console.log(`⏱️  Time:      ${new Date().toLocaleString()}`.white);
            console.log("-----------------------------------------------".blue);
        });
    } catch (err) {
        logger.error(`Critical Failure: ${err.message}`);
        process.exit(1);
    }
};

// Error handling for the process
process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

startServer();

// Total Lines: Approximately 200-250 lines with comments and structure.