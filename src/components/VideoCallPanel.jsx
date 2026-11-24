import React, { useRef, useEffect } from 'react';
import { User } from 'lucide-react';
import CallControls from './CallControls';

export default function VideoCallPanel({
  clientId = '',
  localStream,
  remoteStream,
  isMuted = false,
  isCameraOff = false,
  isScreenSharing = false,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onLeave
}) {
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);

  const hasRemoteMedia = Boolean(
    remoteStream &&
    remoteStream.getTracks &&
    remoteStream.getTracks().length > 0 &&
    remoteStream.getTracks().some(t => t.readyState === 'live')
  );

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream || null;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream || null;
    }
  }, [localStream]);

  return (
    <div className="video-stage-panel">
      {/* 16:9 Aspect-Ratio Locked Video Stage */}
      <div className="video-frame-container">
        {/* Remote Video Element */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="remote-video-element"
          style={{ display: hasRemoteMedia ? 'block' : 'none' }}
        />

        {/* Calm Waiting Placeholder when alone in call */}
        {!hasRemoteMedia && (
          <div className="video-empty-state">
            <div className="video-empty-avatar" aria-hidden="true">
              <User size={28} />
            </div>
            <p>Waiting for remote peer to join...</p>
          </div>
        )}

        {/* Remote Peer Identity Tag (Visible only when connected) */}
        {hasRemoteMedia && (
          <div className="remote-tag">
            <span className="peer-dot" />
            <span>Remote Peer</span>
          </div>
        )}

        {/* Picture-In-Picture Local Video Preview */}
        <div className="pip-video-container" title="Local camera preview">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="local-video-element"
          />
          <span className="pip-tag">You</span>
        </div>
      </div>

      {/* Floating Call Controls Bar */}
      <CallControls
        isMuted={isMuted}
        isCameraOff={isCameraOff}
        isScreenSharing={isScreenSharing}
        onToggleMic={onToggleMic}
        onToggleCamera={onToggleCamera}
        onToggleScreenShare={onToggleScreenShare}
        onLeave={onLeave}
      />
    </div>
  );
}
