const WebSocket = require('ws');
const http = require('http');

// Create HTTP server
const server = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            rooms: rooms.size,
            connections: wss.clients.size,
            timestamp: new Date().toISOString()
        }));
        return;
    }
    
    // Default response for other routes
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
        message: 'Video Call Signaling Server',
        endpoints: ['/health', 'ws:// for WebSocket connections']
    }));
});

// Create WebSocket server
const wss = new WebSocket.Server({ 
    server,
    perMessageDeflate: false
});

// Store room data
const rooms = new Map();

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
    const clientId = generateId();
    console.log(`Client connected: ${clientId}`);
    
    ws.id = clientId;
    ws.isAlive = true;

    // Heartbeat to check if connection is alive
    ws.on('pong', () => {
        ws.isAlive = true;
    });

    // Handle messages from client
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleClientMessage(ws, message);
        } catch (error) {
            console.error('Error parsing message:', error);
            sendToClient(ws, {
                type: 'error',
                message: 'Invalid message format'
            });
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);
        handleClientDisconnection(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
        console.error(`WebSocket error for client ${clientId}:`, error);
    });

    // Send connection confirmation
    sendToClient(ws, {
        type: 'connected',
        clientId: clientId
    });
});

// Heartbeat interval (check every 30 seconds)
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
            console.log('Terminating dead connection:', ws.id);
            return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping(null, false, true);
    });
}, 30000);

// Handle client messages
function handleClientMessage(ws, message) {
    console.log(`Message from ${ws.id}:`, message.type);
    
    switch (message.type) {
        case 'create-room':
            handleCreateRoom(ws, message);
            break;
        case 'join-room':
            handleJoinRoom(ws, message);
            break;
        case 'leave-room':
            handleLeaveRoom(ws, message);
            break;
        case 'offer':
            handleOffer(ws, message);
            break;
        case 'answer':
            handleAnswer(ws, message);
            break;
        case 'ice-candidate':
            handleIceCandidate(ws, message);
            break;
        case 'ping':
            // Respond to ping
            sendToClient(ws, { type: 'pong' });
            break;
        default:
            console.log('Unknown message type:', message.type);
            sendToClient(ws, {
                type: 'error',
                message: `Unknown message type: ${message.type}`
            });
    }
}

// Handle room creation
function handleCreateRoom(ws, message) {
    const { roomId } = message;
    
    if (!roomId) {
        sendToClient(ws, {
            type: 'error',
            message: 'Room ID is required'
        });
        return;
    }
    
    if (rooms.has(roomId)) {
        sendToClient(ws, {
            type: 'error',
            message: 'Room already exists'
        });
        return;
    }
    
    // Create new room
    rooms.set(roomId, {
        participants: new Map([[ws.id, ws]]),
        createdAt: new Date()
    });
    
    // Add room to client
    ws.roomId = roomId;
    
    sendToClient(ws, {
        type: 'room-created',
        roomId: roomId,
        participants: Array.from(rooms.get(roomId).participants.keys())
    });
    
    console.log(`Room created: ${roomId} by ${ws.id}`);
}

// Handle room joining
function handleJoinRoom(ws, message) {
    const { roomId } = message;
    
    if (!roomId) {
        sendToClient(ws, {
            type: 'error',
            message: 'Room ID is required'
        });
        return;
    }
    
    if (!rooms.has(roomId)) {
        sendToClient(ws, {
            type: 'error',
            message: 'Room does not exist'
        });
        return;
    }
    
    const room = rooms.get(roomId);
    
    // Add client to room
    room.participants.set(ws.id, ws);
    ws.roomId = roomId;
    
    // Notify the joining client
    sendToClient(ws, {
        type: 'room-joined',
        roomId: roomId,
        participants: Array.from(room.participants.keys())
    });
    
    // Notify other participants in the room
    broadcastToRoom(roomId, ws, {
        type: 'user-joined',
        userId: ws.id,
        roomId: roomId,
        participants: Array.from(room.participants.keys())
    });
    
    console.log(`User ${ws.id} joined room: ${roomId}`);
}

// Handle room leaving
function handleLeaveRoom(ws, message) {
    const roomId = message.roomId || ws.roomId;
    
    if (!roomId || !rooms.has(roomId)) {
        return;
    }
    
    const room = rooms.get(roomId);
    room.participants.delete(ws.id);
    
    // Notify other participants
    broadcastToRoom(roomId, ws, {
        type: 'user-left',
        userId: ws.id,
        roomId: roomId,
        participants: Array.from(room.participants.keys())
    });
    
    // Clean up room if empty
    if (room.participants.size === 0) {
        rooms.delete(roomId);
        console.log(`Room deleted: ${roomId}`);
    }
    
    ws.roomId = null;
    console.log(`User ${ws.id} left room: ${roomId}`);
}

// Handle WebRTC offer
function handleOffer(ws, message) {
    const { roomId, offer } = message;
    
    if (!roomId || !rooms.has(roomId)) {
        sendToClient(ws, {
            type: 'error',
            message: 'Room not found'
        });
        return;
    }
    
    // Forward offer to other participants
    broadcastToRoom(roomId, ws, {
        type: 'offer',
        offer: offer,
        from: ws.id,
        roomId: roomId
    });
}

// Handle WebRTC answer
function handleAnswer(ws, message) {
    const { roomId, answer } = message;
    
    if (!roomId || !rooms.has(roomId)) {
        sendToClient(ws, {
            type: 'error',
            message: 'Room not found'
        });
        return;
    }
    
    // Forward answer to other participants
    broadcastToRoom(roomId, ws, {
        type: 'answer',
        answer: answer,
        from: ws.id,
        roomId: roomId
    });
}

// Handle ICE candidate
function handleIceCandidate(ws, message) {
    const { roomId, candidate } = message;
    
    if (!roomId || !rooms.has(roomId)) {
        sendToClient(ws, {
            type: 'error',
            message: 'Room not found'
        });
        return;
    }
    
    // Forward ICE candidate to other participants
    broadcastToRoom(roomId, ws, {
        type: 'ice-candidate',
        candidate: candidate,
        from: ws.id,
        roomId: roomId
    });
}

// Handle client disconnection
function handleClientDisconnection(ws) {
    if (ws.roomId) {
        handleLeaveRoom(ws, { roomId: ws.roomId });
    }
}

// Broadcast message to all clients in a room except sender
function broadcastToRoom(roomId, sender, message) {
    if (!rooms.has(roomId)) {
        return;
    }
    
    const room = rooms.get(roomId);
    let sentCount = 0;
    
    room.participants.forEach((client, clientId) => {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            sendToClient(client, message);
            sentCount++;
        }
    });
    
    console.log(`Broadcasted ${message.type} to ${sentCount} clients in room ${roomId}`);
}

// Send message to a specific client
function sendToClient(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(message));
        } catch (error) {
            console.error('Error sending message to client:', error);
        }
    }
}

// Generate unique client ID
function generateId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Signaling server running on port ${PORT}`);
    console.log(`📍 Health check: http://0.0.0.0:${PORT}/health`);
    console.log(`🔗 WebSocket endpoint: ws://0.0.0.0:${PORT}`);
});