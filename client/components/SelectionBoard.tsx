"use client";

import { useEffect, useState } from 'react';
import PlayerCard from './PlayerCard';
import { Socket } from 'socket.io-client';

interface Player {
  id: number;
  name: string;
}

interface TurnOrder {
  userId: string;
  username: string;
}

interface Team {
  userId: string;
  username: string;
  players: Player[];
  isHost: boolean;
}

interface Selection {
  userId: string;
  username: string;
  player: Player;
  isAuto?: boolean;
  message?: string;
}

export default function SelectionBoard({ socket, roomId }: { socket: Socket; roomId: string }) {
  const [available, setAvailable] = useState<Player[]>([]);
  const [turnOrder, setTurnOrder] = useState<TurnOrder[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [currentUsername, setCurrentUsername] = useState<string>('');
  const [timeLeft, setTimeLeft] = useState(10);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [recentSelections, setRecentSelections] = useState<Selection[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);

  useEffect(() => {
    // Get initial player list
    socket.emit('get-players', roomId);

    // Listen for selection start
    socket.on('selection-started', ({ turnOrder, currentUserId, currentUsername, currentTurnIndex, totalTurns }) => {
      console.log('🎯 Selection started:', { turnOrder, currentUserId, currentUsername });
      setTurnOrder(turnOrder);
      setCurrentUserId(currentUserId);
      setCurrentUsername(currentUsername || 'Unknown');
      setIsMyTurn(socket.id === currentUserId);
      setTimeLeft(10);
    });

    // Listen for turn updates
    socket.on('turn-update', ({ currentUserId, currentUsername, timeLeft, turnOrder, currentTurnIndex, totalTurns }) => {
      console.log('🔄 Turn update:', { currentUserId, currentUsername, timeLeft });
      setCurrentUserId(currentUserId);
      setCurrentUsername(currentUsername || 'Unknown');
      setTimeLeft(timeLeft);
      setIsMyTurn(socket.id === currentUserId);

      // Update turn order if provided (handles reconnections)
      if (turnOrder) {
        setTurnOrder(turnOrder);
      }
    });

    // Listen for timer ticks
    socket.on('timer-tick', ({ timeLeft }) => {
      console.log('⏰ Timer tick:', timeLeft);
      // Validate timeLeft to prevent negative values or jumps
      if (typeof timeLeft === 'number' && timeLeft >= 0 && timeLeft <= 10) {
        setTimeLeft(timeLeft);
      }
    });

    // Listen for player selections
    socket.on('player-selected', (selection: Selection) => {
      setRecentSelections(prev => [selection, ...prev.slice(0, 4)]); // Keep last 5
    });

    // Listen for auto selections
    socket.on('auto-selected', (selection: Selection) => {
      setRecentSelections(prev => [selection, ...prev.slice(0, 4)]); // Keep last 5
    });

    // Listen for updated player list
    socket.on('player-list', (list: Player[]) => {
      setAvailable(list);
    });

    // Listen for selection end
    socket.on('selection-ended', ({ teams }) => {
      setTeams(teams);
      setIsCompleted(true);
    });

    return () => {
      socket.off('selection-started');
      socket.off('turn-update');
      socket.off('timer-tick');
      socket.off('player-selected');
      socket.off('auto-selected');
      socket.off('player-list');
      socket.off('selection-ended');
    };
  }, [socket, roomId]);

  const select = (id: number) => {
    if (isMyTurn) {
      socket.emit('select-player', { roomId, playerId: id });
    }
  };

  if (isCompleted) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-3xl font-bold text-center mb-8">🏆 Team Selection Complete!</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {teams.map(team => (
            <div key={team.userId} className="bg-white rounded-lg shadow-md p-4">
              <h3 className="text-xl font-bold mb-3 flex items-center">
                {team.username}
                {team.isHost && <span className="ml-2 bg-blue-500 text-white text-xs px-2 py-1 rounded">HOST</span>}
              </h3>
              <ul className="space-y-2">
                {team.players.map((player, index) => (
                  <li key={player.id} className="flex items-center p-2 bg-gray-50 rounded">
                    <span className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm mr-3">
                      {index + 1}
                    </span>
                    {player.name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Turn and Timer Info */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold">
              {isMyTurn ? "🎯 Your Turn!" : `${currentUsername || 'Loading...'}'s Turn`}
            </h2>
            <p className="text-gray-600">
              Turn Order: {turnOrder.map((u, index) => (
                <span key={u.userId} className={u.userId === currentUserId ? 'font-bold text-blue-600' : ''}>
                  {u.username}{index < turnOrder.length - 1 ? ' → ' : ''}
                </span>
              ))}
            </p>
            {isMyTurn && (
              <p className="text-green-600 font-medium mt-1">
                🚀 Select a player from the list below!
              </p>
            )}
          </div>
          <div className="text-right">
            <div className={`text-3xl font-bold transition-colors duration-300 ${
              timeLeft <= 3 ? 'text-red-500 animate-pulse' :
              timeLeft <= 5 ? 'text-orange-500' : 'text-blue-500'
            }`}>
              {timeLeft}s
            </div>
            <p className="text-sm text-gray-600">Time remaining</p>
            {timeLeft <= 3 && (
              <p className="text-xs text-red-500 font-medium">Hurry up!</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Available Players */}
        <div className="lg:col-span-2">
          <h3 className="text-lg font-bold mb-4">Available Players ({available.length})</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {available.map(player => (
              <PlayerCard
                key={player.id}
                name={player.name}
                onSelect={() => select(player.id)}
                disabled={!isMyTurn}
              />
            ))}
          </div>
        </div>

        {/* Recent Selections */}
        <div>
          <h3 className="text-lg font-bold mb-4">Recent Selections</h3>
          <div className="space-y-2">
            {recentSelections.map((selection, index) => (
              <div key={index} className="bg-white p-3 rounded-lg shadow-sm">
                <div className="font-medium">{selection.username}</div>
                <div className="text-sm text-gray-600">{selection.player.name}</div>
                {selection.isAuto && (
                  <div className="text-xs text-red-500">Auto-selected</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}