import React from 'react';
import { Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff } from 'lucide-react';

export default function CallControls({
  isMuted = false,
  isCameraOff = false,
  isScreenSharing = false,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onLeave
}) {
  return (
    <div className="call-controls-container" role="toolbar" aria-label="Call controls">
      {/* Microphone Toggle */}
      <button
        type="button"
        className={`ctrl-btn ${isMuted ? 'muted' : ''}`}
        onClick={onToggleMic}
        title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        aria-pressed={!isMuted}
      >
        {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
      </button>

      {/* Camera Toggle */}
      <button
        type="button"
        className={`ctrl-btn ${isCameraOff ? 'muted' : ''}`}
        onClick={onToggleCamera}
        title={isCameraOff ? 'Turn on camera' : 'Turn off camera'}
        aria-label={isCameraOff ? 'Turn on camera' : 'Turn off camera'}
        aria-pressed={!isCameraOff}
      >
        {isCameraOff ? <VideoOff size={18} /> : <Video size={18} />}
      </button>

      {/* Screen Sharing Toggle */}
      <button
        type="button"
        className={`ctrl-btn ${isScreenSharing ? 'active-share' : ''}`}
        onClick={onToggleScreenShare}
        title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
        aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
        aria-pressed={isScreenSharing}
      >
        <MonitorUp size={18} />
      </button>

      {/* Leave Call Action */}
      <button
        type="button"
        className="ctrl-btn danger"
        onClick={onLeave}
        title="Leave call"
        aria-label="Leave call"
      >
        <PhoneOff size={18} />
      </button>
    </div>
  );
}
