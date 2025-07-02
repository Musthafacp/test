const socketIo = require('socket.io');

// Predefined cricket players (20 players)
const ALL_PLAYERS = [
  { id: 1, name: 'Virat Kohli' },
  { id: 2, name: 'Rohit Sharma' },
  { id: 3, name: 'MS Dhoni' },
  { id: 4, name: 'Sachin Tendulkar' },
  { id: 5, name: 'Sourav Ganguly' },
  { id: 6, name: 'Anil Kumble' },
  { id: 7, name: 'Kapil Dev' },
  { id: 8, name: 'Rahul Dravid' },
  { id: 9, name: 'VVS Laxman' },
  { id: 10, name: 'Yuvraj Singh' },
  { id: 11, name: 'Hardik Pandya' },
  { id: 12, name: 'Jasprit Bumrah' },
  { id: 13, name: 'Ravindra Jadeja' },
  { id: 14, name: 'Bhuvneshwar Kumar' },
  { id: 15, name: 'Shikhar Dhawan' },
  { id: 16, name: 'KL Rahul' },
  { id: 17, name: 'Shreyas Iyer' },
  { id: 18, name: 'Rishabh Pant' },
  { id: 19, name: 'Mohammed Shami' },
  { id: 20, name: 'Ishant Sharma' }
];

// In-memory storage for rooms: key = roomId, value = { host, users, status, availablePlayers, turnOrder, currentTurnIndex, timer }
const rooms = new Map();

function registerSocketHandlers(server) {
  const io = socketIo(server, {
    cors: {
      origin: ['http://localhost:3000', 'http://localhost:3001'],
      methods: ['GET', 'POST'],
      credentials: true
    },
    allowEIO3: true
  });

  io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    // Create room
    socket.on('create-room', (username) => {
      if (!username || username.trim() === '') {
        socket.emit('error', { message: 'Username is required' });
        return;
      }

      const roomId = generateRoomId();
      rooms.set(roomId, {
        host: socket.id,
        users: new Map([[socket.id, { username: username.trim(), players: [] }]]),
        status: 'waiting',
        availablePlayers: [...ALL_PLAYERS],
        turnOrder: [],
        currentTurnIndex: 0,
        timer: null,
        countdownInterval: null
      });
      socket.join(roomId);

      // inform creator
      socket.emit('room-created', { roomId, hostId: socket.id, isHost: true });

      // broadcast full user list
      const userList = getUserList(roomId);
      io.to(roomId).emit('user-list', userList);

      console.log(`Room ${roomId} created by ${username.trim()}`);
    });

    // Join room
    socket.on('join-room', ({ roomId, username }) => {
      const room = rooms.get(roomId);
      if (!room || room.status !== 'waiting') {
        socket.emit('error', { message: 'Invalid room or already started' });
        return;
      }

      // Check if this socket is already in the room
      const isAlreadyInRoom = room.users.has(socket.id);

      if (!isAlreadyInRoom) {
        // Check if username is already taken by a different socket
        const existingUser = Array.from(room.users.entries()).find(([socketId, user]) =>
          user.username === username && socketId !== socket.id
        );
        if (existingUser) {
          socket.emit('error', { message: 'Username already taken in this room' });
          return;
        }

        // Add user to room
        room.users.set(socket.id, { username, players: [] });
        console.log(`${username} joined room ${roomId}. Total users: ${room.users.size}`);
      } else {
        console.log(`${username} rejoined room ${roomId} with same socket`);
      }

      // Always join the socket to the room (handles reconnections)
      socket.join(roomId);

      // confirm join
      socket.emit('room-joined', { roomId, hostId: room.host, isHost: socket.id === room.host });

      // broadcast updated user list to all users in room
      const userList = getUserList(roomId);
      console.log(`Broadcasting user list to room ${roomId}:`, userList);
      io.to(roomId).emit('user-list', userList);

      // notify others that someone joined (only if new user)
      if (!isAlreadyInRoom) {
        socket.to(roomId).emit('user-joined', { username, userId: socket.id });
      }
    });

    // Send available players
    socket.on('get-players', (roomId) => {
      const room = rooms.get(roomId);
      if (room) socket.emit('player-list', room.availablePlayers);
    });

    // Send user list (fallback for clients that missed the broadcast)
    socket.on('get-user-list', (roomId) => {
      const room = rooms.get(roomId);
      if (room) {
        const userList = getUserList(roomId);
        console.log(`Sending user list to ${socket.id} for room ${roomId}:`, userList);
        socket.emit('user-list', userList);
      }
    });

    // Start selection (only host)
    socket.on('start-selection', (roomId) => {
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      if (socket.id !== room.host) {
        socket.emit('error', { message: 'Only the host can start the selection' });
        return;
      }
      if (room.status !== 'waiting') {
        socket.emit('error', { message: 'Selection has already started or completed' });
        return;
      }
      if (room.users.size < 2) {
        socket.emit('error', { message: 'Need at least 2 players to start' });
        return;
      }

      room.status = 'selection';
      room.turnOrder = shuffleArray([...room.users.keys()]);
      room.currentTurnIndex = 0;

      const turnOrderWithNames = room.turnOrder.map(id => ({
        userId: id,
        username: room.users.get(id)?.username || 'Unknown'
      }));

      // notify start and turn order with complete information
      io.to(roomId).emit('selection-started', {
        turnOrder: turnOrderWithNames,
        currentUserId: room.turnOrder[0],
        currentUsername: room.users.get(room.turnOrder[0])?.username || 'Unknown',
        currentTurnIndex: 0,
        totalTurns: room.turnOrder.length
      });

      console.log(`Selection in room ${roomId} started. Turn order:`, turnOrderWithNames.map(u => u.username).join(' → '));
      advanceTurn(io, roomId);
    });

    // Player selects
    socket.on('select-player', ({ roomId, playerId }) => {
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }
      if (room.status !== 'selection') {
        socket.emit('error', { message: 'Selection is not active' });
        return;
      }
      if (!room.users.has(socket.id)) {
        socket.emit('error', { message: 'You are not in this room' });
        return;
      }

      processSelection(io, roomId, socket.id, playerId, false);
    });

    // Disconnect cleanup
    socket.on('disconnect', () => {
      rooms.forEach((room, roomId) => {
        if (room.users.has(socket.id)) {
          const user = room.users.get(socket.id);
          room.users.delete(socket.id);

          // If host disconnects, assign new host
          if (room.host === socket.id && room.users.size > 0) {
            room.host = room.users.keys().next().value;
            console.log(`New host assigned in room ${roomId}: ${room.host}`);
          }

          // If room becomes empty, clean it up
          if (room.users.size === 0) {
            if (room.timer) clearTimeout(room.timer);
            if (room.countdownInterval) clearInterval(room.countdownInterval);
            rooms.delete(roomId);
            console.log(`Room ${roomId} deleted - no users remaining`);
          } else {
            // Update user list for remaining users
            io.to(roomId).emit('user-list', getUserList(roomId));

            // If selection was in progress and it was this user's turn, advance turn
            if (room.status === 'selection' && room.turnOrder[room.currentTurnIndex] === socket.id) {
              room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
              advanceTurn(io, roomId);
            }
          }

          console.log(`Removed ${user?.username || socket.id} from room ${roomId}`);
        }
      });
    });
  });
}

// Helpers
function generateRoomId() {
  return Math.random().toString(36).slice(2,7).toUpperCase();
}
function shuffleArray(arr) {
  return arr.sort(() => Math.random()-0.5);
}
function getUserList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.users.entries()).map(([id, u]) => ({ userId: id, username: u.username, isHost: id===room.host }));
}

function advanceTurn(io, roomId) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'selection') return;

  // Clear any existing timers
  if (room.timer) clearTimeout(room.timer);
  if (room.countdownInterval) clearInterval(room.countdownInterval);

  const currentUserId = room.turnOrder[room.currentTurnIndex];
  const currentUser = room.users.get(currentUserId);

  if (!currentUser) {
    console.error(`User not found for turn: ${currentUserId} in room ${roomId}`);
    return;
  }

  console.log(`Turn advanced in room ${roomId}: ${currentUser.username}'s turn (${room.currentTurnIndex + 1}/${room.turnOrder.length})`);

  // Send comprehensive turn update with all necessary info
  const turnData = {
    currentUserId,
    currentUsername: currentUser.username,
    timeLeft: 10,
    turnOrder: room.turnOrder.map(id => ({
      userId: id,
      username: room.users.get(id)?.username || 'Unknown'
    })),
    currentTurnIndex: room.currentTurnIndex,
    totalTurns: room.turnOrder.length
  };

  io.to(roomId).emit('turn-update', turnData);

  // Start countdown timer with proper cleanup
  let timeLeft = 10;
  room.countdownInterval = setInterval(() => {
    timeLeft--;
    io.to(roomId).emit('timer-tick', { timeLeft });

    if (timeLeft <= 0) {
      clearInterval(room.countdownInterval);
      room.countdownInterval = null;
    }
  }, 1000);

  // Auto-select after 10 seconds
  room.timer = setTimeout(() => {
    if (room.countdownInterval) {
      clearInterval(room.countdownInterval);
      room.countdownInterval = null;
    }

    const roomRef = rooms.get(roomId);
    if (!roomRef || !roomRef.availablePlayers.length) return;

    const rand = roomRef.availablePlayers[Math.floor(Math.random() * roomRef.availablePlayers.length)];
    processSelection(io, roomId, currentUserId, rand.id, true);
  }, 10000);
}

function processSelection(io, roomId, userId, playerId, isAuto) {
  const room = rooms.get(roomId);
  if (!room || room.status !== 'selection') return;

  // Clear any existing timers
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  if (room.countdownInterval) {
    clearInterval(room.countdownInterval);
    room.countdownInterval = null;
  }

  const current = room.turnOrder[room.currentTurnIndex];
  if (userId!==current) return;  // not this user's turn

  const idx = room.availablePlayers.findIndex(p=>p.id===playerId);
  if (idx<0) return;

  const [player] = room.availablePlayers.splice(idx,1);
  room.users.get(userId).players.push(player);

  // Emit different events for manual vs auto selection
  if (isAuto) {
    io.to(roomId).emit('auto-selected', {
      userId,
      username: room.users.get(userId).username,
      player,
      message: `${room.users.get(userId).username} was auto-assigned ${player.name}`
    });
  } else {
    io.to(roomId).emit('player-selected', {
      userId,
      username: room.users.get(userId).username,
      player
    });
  }

  // Send updated available players list
  io.to(roomId).emit('player-list', room.availablePlayers);

  // Check if selection is complete
  const done = Array.from(room.users.values()).every(u=>u.players.length===5);
  if (done) {
    room.status = 'completed';
    const finalTeams = getUserList(roomId).map(u => ({
      userId: u.userId,
      username: u.username,
      players: room.users.get(u.userId).players,
      isHost: u.isHost
    }));
    io.to(roomId).emit('selection-ended', { teams: finalTeams });
    return;
  }

  // Move to next turn
  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
  advanceTurn(io, roomId);
}

module.exports = { registerSocketHandlers };
