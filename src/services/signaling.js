/**
 * Signaling service using WebSocket to exchange WebRTC offers, answers, and ICE candidates.
 */
export class SignalingService {
  constructor(roomId, clientId, onMessageCallback) {
    this.roomId = roomId;
    this.clientId = clientId;
    this.onMessageCallback = onMessageCallback;
    this.socket = null;
  }

  connect(serverUrl) {
    const defaultWsHost = (typeof window !== 'undefined' && window.location.hostname) ? window.location.hostname : 'localhost';
    const defaultWsProto = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'wss:' : 'ws:';
    const baseUrl = (
      serverUrl ||
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_URL) ||
      `${defaultWsProto}//${defaultWsHost}:8000`
    ).replace(/\/+$/, '');

    const encodedRoomId = encodeURIComponent(this.roomId);
    const encodedClientId = encodeURIComponent(this.clientId);
    const wsUrl = `${baseUrl}/ws/signaling/${encodedRoomId}/${encodedClientId}`;
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log(`[Signaling] Connected to room ${this.roomId} as ${this.clientId}`);
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (this.onMessageCallback) {
          this.onMessageCallback(data);
        }
      } catch (err) {
        console.error('[Signaling] Failed to parse message', err);
      }
    };

    this.socket.onerror = (error) => {
      console.error('[Signaling] WebSocket error:', error);
    };

    this.socket.onclose = () => {
      console.log('[Signaling] WebSocket disconnected');
    };
  }

  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    } else {
      console.warn('[Signaling] WebSocket is not open. Queuing/dropped:', data);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
