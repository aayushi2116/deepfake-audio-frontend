import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import VideoCallPanel from './components/VideoCallPanel';
import AIDetectionPanel from './components/AIDetectionPanel';
import AudioDetectorView from './components/AudioDetectorView';
import RoomForm from './components/RoomForm';
import { useWebRTC } from './hooks/useWebRTC';
import { useDetection } from './hooks/useDetection';

export default function App() {
  const [roomId, setRoomId] = useState('alpha-7');
  const [clientId, setClientId] = useState(`user-${Math.floor(Math.random() * 900 + 100)}`);
  const [inCall, setInCall] = useState(false);

  // Route state: '/call' or '/detector'
  const [currentRoute, setCurrentRoute] = useState(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname.toLowerCase();
      if (path === '/detector' || path.startsWith('/detector')) {
        return '/detector';
      }
    }
    return '/call';
  });

  // Listen to browser forward/back buttons
  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase();
      if (path === '/detector' || path.startsWith('/detector')) {
        setCurrentRoute('/detector');
      } else {
        setCurrentRoute('/call');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (route) => {
    setCurrentRoute(route);
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', route);
    }
  };

  // Theme Management (Light by default)
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('app-theme') || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.className = theme;
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  // Live WebRTC Audio Detection Model Selection ('original' | 'cond_4b')
  const [liveDetectionModel, setLiveDetectionModel] = useState('webrtc');

  // Initialize Detection WebSocket Hook
  const {
    detectionResult,
    telemetry,
    logs,
    attachAudioTrack
  } = useDetection(clientId, null, null, liveDetectionModel);

  // Initialize WebRTC P2P Hook
  const {
    connectionStatus,
    participantsCount,
    isMuted,
    isCameraOff,
    isScreenSharing,
    localStream,
    remoteStream,
    joinRoom,
    leaveRoom,
    toggleMic,
    toggleCamera,
    toggleScreenShare
  } = useWebRTC({
    roomId,
    clientId,
    onRemoteStream: (stream) => {
      // Direct remote audio track to live detection engine
      const remoteAudioTrack = stream.getAudioTracks()[0];
      if (remoteAudioTrack) {
        attachAudioTrack(remoteAudioTrack);
      }
    }
  });

  const handleStartCall = async (targetRoom, targetClient) => {
    if (targetRoom) setRoomId(targetRoom);
    if (targetClient) setClientId(targetClient);
    setInCall(true);
    await joinRoom(targetRoom, targetClient);
  };

  const handleLeaveCall = () => {
    leaveRoom();
    setInCall(false);
  };

  return (
    <div className="app-container">
      {/* Persistent SaaS Top Navigation Bar */}
      <Navbar
        connectionStatus={inCall ? connectionStatus : 'DISCONNECTED'}
        roomId={roomId}
        participantsCount={inCall ? participantsCount : 1}
        activeTab={currentRoute === '/detector' ? 'detector' : 'call'}
        onTabChange={(tab) => navigateTo(tab === 'detector' ? '/detector' : '/call')}
        theme={theme}
        onToggleTheme={toggleTheme}
        inCall={inCall}
      />

      {/* PAGE 1: STANDALONE FORENSIC FILE DETECTOR */}
      {currentRoute === '/detector' && (
        <main className="detector-container">
          <AudioDetectorView onNavigateBack={() => navigateTo('/call')} />
        </main>
      )}

      {/* PAGE 2: LIVE CALLING (LOBBY OR ACTIVE DASHBOARD) */}
      {currentRoute === '/call' && (
        <>
          {!inCall ? (
            <div className="lobby-wrapper">
              <RoomForm
                initialRoomId={roomId}
                initialClientId={clientId}
                onJoin={handleStartCall}
              />
            </div>
          ) : (
            <main className="live-call-layout">
              {/* Left Column: Video & Call Controls */}
              <VideoCallPanel
                clientId={clientId}
                localStream={localStream}
                remoteStream={remoteStream}
                isMuted={isMuted}
                isCameraOff={isCameraOff}
                isScreenSharing={isScreenSharing}
                onToggleMic={toggleMic}
                onToggleCamera={toggleCamera}
                onToggleScreenShare={toggleScreenShare}
                onLeave={handleLeaveCall}
              />

              {/* Right Column: AI Audio Authenticity Monitor */}
              <AIDetectionPanel
                remoteStream={remoteStream}
                detectionResult={detectionResult}
                telemetry={telemetry}
                logs={logs}
                selectedModel={liveDetectionModel}
                onModelChange={setLiveDetectionModel}
              />
            </main>
          )}
        </>
      )}
    </div>
  );
}
