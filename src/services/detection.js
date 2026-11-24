/**
 * Audio Detection Service handles streaming audio chunks to backend for voice/deepfake classification.
 */
export class DetectionService {
  constructor(clientId, onDetectionResult, model = 'webrtc') {
    this.clientId = clientId;
    this.onDetectionResult = onDetectionResult;
    this.model = model || 'webrtc';
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

    const encodedClientId = encodeURIComponent(this.clientId);
    const modelParam = encodeURIComponent(this.model || 'webrtc');
    const wsUrl = `${baseUrl}/ws/detection/${encodedClientId}?model=${modelParam}`;
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log(`[Detection] Connected for client ${this.clientId} using model ${this.model}`);
    };

    this.socket.onmessage = (event) => {
      try {
        const result = JSON.parse(event.data);
        if (this.onDetectionResult) {
          this.onDetectionResult(result);
        }
      } catch (err) {
        console.error('[Detection] Parse error:', err);
      }
    };

    this.socket.onerror = (err) => {
      console.error('[Detection] WebSocket error:', err);
    };

    this.socket.onclose = () => {
      console.log('[Detection] WebSocket disconnected');
    };
  }

  sendAudioChunk(chunk) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(chunk);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}