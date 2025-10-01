const WebSocket = require('ws');
const http = require('http');
const url = require('url');

// Create HTTP server
const server = http.createServer();
const wss = new WebSocket.Server({ 
    server,
    // Enable CORS for all origins (for development)
    perMessageDeflate: false
});

// Store room data
const rooms = new Map();

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
    const parameters = url.parse(req.url, true);
    const clientId = generateId();
    
    console.log(`Client connected: ${clientId}`);
    ws.id = clientId;
    
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
        default:
            console.log('Unknown message type:', message.type);
    }
}

// Handle room creation
function handleCreateRoom(ws, message) {
    const { roomId } = message;
    
    if (rooms.has(roomId)) {
        sendToClient(ws, {
            type: 'error',
            message: 'Room already exists'
        });
        return;
    }
    
    // Create new room
    rooms.set(roomId, {
        participants: new Set([ws.id]),
        creator: ws.id
    });
    
    // Add room to client
    ws.roomId = roomId;
    
    sendToClient(ws, {
        type: 'room-created',
        roomId: roomId,
        participants: Array.from(rooms.get(roomId).participants)
    });
    
    console.log(`Room created: ${roomId} by ${ws.id}`);
}

// Handle room joining
function handleJoinRoom(ws, message) {
    const { roomId } = message;
    
    if (!rooms.has(roomId)) {
        sendToClient(ws, {
            type: 'error',
            message: 'Room does not exist'
        });
        return;
    }
    
    const room = rooms.get(roomId);
    
    // Add client to room
    room.participants.add(ws.id);
    ws.roomId = roomId;
    
    // Notify the joining client
    sendToClient(ws, {
        type: 'room-joined',
        roomId: roomId,
        participants: Array.from(room.participants)
    });
    
    // Notify other participants in the room
    broadcastToRoom(roomId, ws, {
        type: 'user-joined',
        userId: ws.id,
        participants: Array.from(room.participants)
    });
    
    console.log(`User ${ws.id} joined room: ${roomId}`);
}

// Handle room leaving
function handleLeaveRoom(ws, message) {
    const { roomId } = message;
    
    if (!rooms.has(roomId)) {
        return;
    }
    
    const room = rooms.get(roomId);
    room.participants.delete(ws.id);
    
    // Notify other participants
    broadcastToRoom(roomId, ws, {
        type: 'user-left',
        userId: ws.id,
        participants: Array.from(room.participants)
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
    
    if (!rooms.has(roomId)) {
        return;
    }
    
    // Forward offer to other participants
    broadcastToRoom(roomId, ws, {
        type: 'offer',
        offer: offer,
        from: ws.id
    });
}

// Handle WebRTC answer
function handleAnswer(ws, message) {
    const { roomId, answer } = message;
    
    if (!rooms.has(roomId)) {
        return;
    }
    
    // Forward answer to other participants
    broadcastToRoom(roomId, ws, {
        type: 'answer',
        answer: answer,
        from: ws.id
    });
}

// Handle ICE candidate
function handleIceCandidate(ws, message) {
    const { roomId, candidate } = message;
    
    if (!rooms.has(roomId)) {
        return;
    }
    
    // Forward ICE candidate to other participants
    broadcastToRoom(roomId, ws, {
        type: 'ice-candidate',
        candidate: candidate,
        from: ws.id
    });
}

// Handle client disconnection
function handleClientDisconnection(ws) {
    if (ws.roomId) {
        const room = rooms.get(ws.roomId);
        if (room) {
            room.participants.delete(ws.id);
            
            // Notify other participants
            broadcastToRoom(ws.roomId, ws, {
                type: 'user-left',
                userId: ws.id,
                participants: Array.from(room.participants)
            });
            
            // Clean up room if empty
            if (room.participants.size === 0) {
                rooms.delete(ws.roomId);
                console.log(`Room deleted: ${ws.roomId}`);
            }
        }
    }
}

// Broadcast message to all clients in a room except sender
function broadcastToRoom(roomId, sender, message) {
    if (!rooms.has(roomId)) {
        return;
    }
    
    const room = rooms.get(roomId);
    let sentCount = 0;
    
    wss.clients.forEach(client => {
        if (client !== sender && 
            client.readyState === WebSocket.OPEN && 
            room.participants.has(client.id)) {
            sendToClient(client, message);
            sentCount++;
        }
    });
    
    console.log(`Broadcasted ${message.type} to ${sentCount} clients in room ${roomId}`);
}

// Send message to a specific client
function sendToClient(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

// Generate unique client ID
function generateId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

// Health check endpoint
server.on('request', (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            rooms: rooms.size,
            connections: wss.clients.size 
        }));
        return;
    }
});

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
    console.log(`Health check available at http://localhost:${PORT}/health`);
});