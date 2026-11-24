import React, { useState } from 'react';
import { Video, Sparkles, ArrowRight } from 'lucide-react';

export default function RoomForm({ initialRoomId = 'mentor-room', initialClientId = '', onJoin }) {
  const [roomId, setRoomId] = useState(initialRoomId);
  const [userName, setUserName] = useState(initialClientId);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!roomId.trim()) return;
    const finalUserName = userName.trim() || `User_${Math.floor(1000 + Math.random() * 9000)}`;
    onJoin(roomId.trim(), finalUserName);
  };

  const generateRandomRoom = () => {
    const randomId = `room-${Math.random().toString(36).substring(2, 8)}`;
    setRoomId(randomId);
  };

  return (
    <div className="join-card">
      <div className="join-card-header">
        <div className="join-icon-badge" aria-hidden="true">
          <Video size={20} />
        </div>
        <h1 className="join-title">Join a Call</h1>
        <p className="join-subtitle">
          Connect to a peer-to-peer session with real-time AI voice authenticity monitoring.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="join-form">
        <div className="form-group">
          <label htmlFor="user-name-input" className="form-label">
            Your Name or Identifier
          </label>
          <input
            id="user-name-input"
            className="form-input"
            type="text"
            placeholder="e.g. Alice"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            autoComplete="name"
          />
        </div>

        <div className="form-group">
          <label htmlFor="room-id-input" className="form-label">
            Room ID
          </label>
          <div className="input-wrapper">
            <input
              id="room-id-input"
              className="form-input"
              type="text"
              placeholder="e.g. secure-room-101"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              required
              style={{ paddingRight: '90px' }}
            />
            <button
              type="button"
              className="input-inline-btn"
              onClick={generateRandomRoom}
              title="Generate a random room ID"
            >
              <Sparkles size={12} />
              <span>Random</span>
            </button>
          </div>
        </div>

        <button
          id="join-room-btn"
          type="submit"
          className="btn-join"
        >
          <span>Join Call</span>
          <ArrowRight size={16} />
        </button>
      </form>
    </div>
  );
}
