import { useState, useRef, useCallback, useEffect } from 'react';
import { SignalingService } from '../services/signaling';

function resolveIceServers() {
  const defaultStun = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ];

  const envStun = typeof import.meta !== 'undefined' && import.meta.env?.VITE_STUN_URLS;
  const stunServers = envStun
    ? envStun.split(',').map(u => ({ urls: u.trim() })).filter(s => s.urls)
    : defaultStun;

  const envTurnUrls = typeof import.meta !== 'undefined' && (import.meta.env?.VITE_TURN_URLS || import.meta.env?.VITE_TURN_URL);
  const envTurnUser = typeof import.meta !== 'undefined' && import.meta.env?.VITE_TURN_USERNAME;
  const envTurnCred = typeof import.meta !== 'undefined' && (import.meta.env?.VITE_TURN_CREDENTIAL || import.meta.env?.VITE_TURN_PASSWORD);

  if (envTurnUrls) {
    const urls = envTurnUrls.split(',').map(u => u.trim()).filter(Boolean);
    const turnServer = { urls };
    if (envTurnUser) turnServer.username = envTurnUser;
    if (envTurnCred) turnServer.credential = envTurnCred;
    return [...stunServers, turnServer];
  }

  return stunServers;
}

export function useWebRTC({ roomId, clientId, onRemoteStream }) {
  const [connectionStatus, setConnectionStatus] = useState('DISCONNECTED');
  const [participantsCount, setParticipantsCount] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const signalingRef = useRef(null);
  const screenTrackRef = useRef(null);
  const remotePeerIdRef = useRef(null);
  const iceCandidatesQueueRef = useRef([]);
  const activeRoomIdRef = useRef(roomId);
  const activeClientIdRef = useRef(clientId);
  const isCreatingOfferRef = useRef(false);

  // Synchronize ref with prop updates
  useEffect(() => {
    activeRoomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    activeClientIdRef.current = clientId;
  }, [clientId]);

  const createSyntheticMediaStream = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const dst = audioCtx.createMediaStreamDestination();
      const audioTrack = dst.stream.getAudioTracks()[0];

      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 640, 480);
      const videoStream = canvas.captureStream ? canvas.captureStream(15) : null;
      const videoTrack = videoStream ? videoStream.getVideoTracks()[0] : null;

      const stream = new MediaStream();
      if (audioTrack) stream.addTrack(audioTrack);
      if (videoTrack) stream.addTrack(videoTrack);
      return stream;
    } catch (e) {
      console.warn('[WebRTC] Synthetic stream creation warning:', e);
      return new MediaStream();
    }
  };

  const startLocalMedia = async () => {
    if (localStreamRef.current && localStreamRef.current.active) {
      return localStreamRef.current;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error(
        '[WebRTC] navigator.mediaDevices unavailable! Open via http://localhost:5173 or enable chrome://flags/#unsafely-treat-insecure-origin-as-secure for this IP.'
      );
      const fallbackStream = createSyntheticMediaStream();
      localStreamRef.current = fallbackStream;
      setLocalStream(fallbackStream);
      return fallbackStream;
    }

    // Tier 1: Ideal constraints (16kHz audio for detection engine + 720p video)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 16000
        },
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (err1) {
      console.warn('[WebRTC] Ideal media constraints failed, attempting basic constraints:', err1);
    }

    // Tier 2: Basic audio + video
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (err2) {
      console.warn('[WebRTC] Basic audio/video failed, attempting audio only:', err2);
    }

    // Tier 3: Audio only with canvas video track
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, 640, 480);
      if (canvas.captureStream) {
        const vidStream = canvas.captureStream(15);
        if (vidStream && vidStream.getVideoTracks()[0]) {
          stream.addTrack(vidStream.getVideoTracks()[0]);
        }
      }
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (err3) {
      console.warn('[WebRTC] Media devices unavailable, utilizing silent fallback stream:', err3);
    }

    // Tier 4: Silent AudioContext + Canvas stream fallback
    const fallbackStream = createSyntheticMediaStream();
    localStreamRef.current = fallbackStream;
    setLocalStream(fallbackStream);
    return fallbackStream;
  };

  const drainIceCandidates = async (pc) => {
    if (!pc || !pc.remoteDescription) return;
    const queue = iceCandidatesQueueRef.current;
    while (queue.length > 0) {
      const candidate = queue.shift();
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[WebRTC] Failed to add queued ICE candidate:', err);
      }
    }
  };

  const createPeerConnection = useCallback((currentRoomId, currentClientId) => {
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (e) {
        // safe ignore
      }
    }

    const pc = new RTCPeerConnection({
      iceServers: resolveIceServers()
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && signalingRef.current) {
        signalingRef.current.send({
          type: 'candidate',
          candidate: event.candidate,
          target: remotePeerIdRef.current || undefined,
          room_id: currentRoomId,
          client_id: currentClientId
        });
      }
    };

    pc.ontrack = (event) => {
      console.log('[WebRTC] ontrack received streams:', event.streams.length);
      const [stream] = event.streams;
      if (stream) {
        remoteStreamRef.current = stream;
        setRemoteStream(stream);
        setParticipantsCount(2);
        if (onRemoteStream) {
          onRemoteStream(stream);
        }
        stream.getTracks().forEach((track) => {
          track.onended = () => {
            if (stream.getTracks().every((t) => t.readyState === 'ended')) {
              setRemoteStream(null);
              remoteStreamRef.current = null;
              setParticipantsCount(1);
            }
          };
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState.toUpperCase();
      console.log(`[WebRTC] Peer connection state: ${state}`);
      setConnectionStatus(state);
      if (state === 'CONNECTED') {
        setParticipantsCount(2);
      } else if (state === 'DISCONNECTED' || state === 'FAILED' || state === 'CLOSED') {
        setParticipantsCount(1);
        setRemoteStream(null);
        remoteStreamRef.current = null;
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState.toUpperCase();
      console.log(`[WebRTC] ICE connection state: ${state}`);
      if (state === 'CONNECTED' || state === 'COMPLETED') {
        setConnectionStatus('CONNECTED');
        setParticipantsCount(2);
      } else if (state === 'FAILED' || state === 'DISCONNECTED' || state === 'CLOSED') {
        if (pc.connectionState !== 'connected') {
          setConnectionStatus(state);
        }
      }
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    peerConnectionRef.current = pc;
    return pc;
  }, [onRemoteStream]);

  const joinRoom = async (overrideRoomId, overrideClientId) => {
    const activeRoom = overrideRoomId || activeRoomIdRef.current;
    const activeClient = overrideClientId || activeClientIdRef.current;
    activeRoomIdRef.current = activeRoom;
    activeClientIdRef.current = activeClient;

    await startLocalMedia();

    iceCandidatesQueueRef.current = [];
    remotePeerIdRef.current = null;
    isCreatingOfferRef.current = false;

    const getActivePeerConnection = () => {
      if (!peerConnectionRef.current || peerConnectionRef.current.signalingState === 'closed') {
        return createPeerConnection(activeRoom, activeClient);
      }
      return peerConnectionRef.current;
    };

    signalingRef.current = new SignalingService(activeRoom, activeClient, async (msg) => {
      try {
        console.log(`[WebRTC Signaling] Received msg:`, msg.type, msg);
        const currentPC = getActivePeerConnection();

        // --- CASE 1: Another user joined the room -> Initiate SDP Offer ---
        if (msg.type === 'user-joined') {
          const joiningClientId = msg.clientId || msg.sender;
          if (joiningClientId === activeClient) return;

          console.log(`[WebRTC] Peer joined (${joiningClientId}). Initiating SDP offer...`);
          remotePeerIdRef.current = joiningClientId;
          setParticipantsCount(2);

          if (isCreatingOfferRef.current) return;
          isCreatingOfferRef.current = true;

          try {
            const offer = await currentPC.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true
            });
            await currentPC.setLocalDescription(offer);
            signalingRef.current.send({
              type: 'offer',
              sdp: offer,
              target: joiningClientId,
              room_id: activeRoom,
              client_id: activeClient
            });
            console.log(`[WebRTC] Sent SDP offer to ${joiningClientId}`);
          } finally {
            isCreatingOfferRef.current = false;
          }
        }

        // --- CASE 2: Incoming SDP Offer ---
        else if (msg.type === 'offer') {
          const senderId = msg.sender || msg.client_id;
          console.log(`[WebRTC] Received SDP offer from ${senderId}`);
          remotePeerIdRef.current = senderId;
          setParticipantsCount(2);

          await currentPC.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          await drainIceCandidates(currentPC);

          const answer = await currentPC.createAnswer();
          await currentPC.setLocalDescription(answer);

          signalingRef.current.send({
            type: 'answer',
            sdp: answer,
            target: senderId,
            room_id: activeRoom,
            client_id: activeClient
          });
          console.log(`[WebRTC] Sent SDP answer to ${senderId}`);
        }

        // --- CASE 3: Incoming SDP Answer ---
        else if (msg.type === 'answer') {
          console.log(`[WebRTC] Received SDP answer`);
          if (currentPC.signalingState === 'have-local-offer') {
            await currentPC.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            await drainIceCandidates(currentPC);
            console.log(`[WebRTC] Remote description set for answer`);
          } else {
            console.warn(`[WebRTC] Received answer but signalingState is ${currentPC.signalingState}`);
          }
        }

        // --- CASE 4: Incoming ICE Candidate ---
        else if (msg.type === 'candidate' && msg.candidate) {
          if (currentPC.remoteDescription && currentPC.remoteDescription.type) {
            try {
              await currentPC.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (err) {
              console.warn(`[WebRTC] Error adding ICE candidate:`, err);
            }
          } else {
            iceCandidatesQueueRef.current.push(msg.candidate);
          }
        }

        // --- CASE 5: User Left ---
        else if (msg.type === 'user-left') {
          const leftId = msg.clientId || msg.sender;
          console.log(`[WebRTC] User left:`, leftId);
          if (!remotePeerIdRef.current || remotePeerIdRef.current === leftId) {
            remotePeerIdRef.current = null;
            setRemoteStream(null);
            remoteStreamRef.current = null;
            setParticipantsCount(1);
            setConnectionStatus('STANDBY');
            iceCandidatesQueueRef.current = [];

            // Re-prepare clean peer connection for next peer
            createPeerConnection(activeRoom, activeClient);
          }
        }
      } catch (err) {
        console.error('[WebRTC] Signaling message handling error:', err);
      }
    });

    signalingRef.current.connect();
    setConnectionStatus('CONNECTING');
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleCamera = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOff(!videoTrack.enabled);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!peerConnectionRef.current) return;
    const senders = peerConnectionRef.current.getSenders();
    const videoSender = senders.find((s) => s.track && s.track.kind === 'video');

    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        screenTrackRef.current = screenTrack;

        if (videoSender) {
          videoSender.replaceTrack(screenTrack);
        }

        screenTrack.onended = () => {
          if (videoSender && localStreamRef.current) {
            videoSender.replaceTrack(localStreamRef.current.getVideoTracks()[0]);
          }
          setIsScreenSharing(false);
        };

        setIsScreenSharing(true);
      } catch (err) {
        console.error('[WebRTC] Screen sharing cancelled or failed:', err);
      }
    } else {
      if (screenTrackRef.current) {
        screenTrackRef.current.stop();
        screenTrackRef.current = null;
      }
      if (videoSender && localStreamRef.current) {
        videoSender.replaceTrack(localStreamRef.current.getVideoTracks()[0]);
      }
      setIsScreenSharing(false);
    }
  };

  const leaveRoom = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (screenTrackRef.current) {
      screenTrackRef.current.stop();
      screenTrackRef.current = null;
    }
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (e) {
        // safe ignore
      }
      peerConnectionRef.current = null;
    }
    if (signalingRef.current) {
      signalingRef.current.send({
        type: 'user-left',
        clientId: activeClientIdRef.current,
        room_id: activeRoomIdRef.current
      });
      signalingRef.current.disconnect();
      signalingRef.current = null;
    }
    remotePeerIdRef.current = null;
    iceCandidatesQueueRef.current = [];
    isCreatingOfferRef.current = false;
    setLocalStream(null);
    setRemoteStream(null);
    remoteStreamRef.current = null;
    setConnectionStatus('DISCONNECTED');
    setParticipantsCount(1);
    setIsScreenSharing(false);
    setIsMuted(false);
    setIsCameraOff(false);
  };

  useEffect(() => {
    return () => leaveRoom();
  }, []);

  return {
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
  };
}