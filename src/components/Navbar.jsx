import React from 'react';
import { Sun, Moon, Video, FileAudio, Users } from 'lucide-react';

export default function Navbar({
  connectionStatus = 'DISCONNECTED',
  roomId = '',
  participantsCount = 1,
  activeTab = 'call',
  onTabChange,
  theme = 'light',
  onToggleTheme,
  inCall = false
}) {
  const isConnected = connectionStatus === 'CONNECTED';
  const isConnecting = connectionStatus === 'CONNECTING';

  return (
    <header className="top-navbar">
      {/* Brand Logo & Name */}
      <div className="nav-brand">
        <div className="nav-brand-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 2v20M17 5v14M7 9v6M22 10v4M2 11v2" />
          </svg>
        </div>
        <span>Voice Authenticator</span>
        <span className="nav-brand-badge">AI</span>
      </div>

      {/* Navigation Segmented Tabs */}
      {onTabChange && (
        <nav className="nav-tabs" aria-label="Main Navigation">
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'call' ? 'active' : ''}`}
            onClick={() => onTabChange('call')}
            aria-pressed={activeTab === 'call'}
          >
            <Video size={14} />
            <span>Live Call</span>
          </button>
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'upload' || activeTab === 'detector' ? 'active' : ''}`}
            onClick={() => onTabChange('detector')}
            aria-pressed={activeTab === 'upload' || activeTab === 'detector'}
          >
            <FileAudio size={14} />
            <span>File Detector</span>
          </button>
        </nav>
      )}

      {/* Right Controls */}
      <div className="nav-actions">
        {/* Active Call Metadata (Displayed only during an active call) */}
        {inCall && (
          <div className="nav-call-pill" title={`Connected to room ${roomId}`}>
            <span
              className={`status-indicator ${isConnected ? 'connected' : isConnecting ? 'connecting' : ''}`}
            />
            <span className="room-tag">{roomId}</span>
            <span>&bull;</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Users size={12} />
              {participantsCount}
            </span>
          </div>
        )}

        {/* Theme Toggle Button */}
        {onToggleTheme && (
          <button
            type="button"
            className="nav-icon-btn"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle visual theme"
          >
            {theme === 'dark' ? <Sun size={15} color="#f59e0b" /> : <Moon size={15} color="#6366f1" />}
          </button>
        )}
      </div>
    </header>
  );
}
