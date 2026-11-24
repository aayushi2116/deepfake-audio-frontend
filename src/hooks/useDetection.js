import { useState, useEffect, useRef, useCallback } from 'react';
import { DetectionService } from '../services/detection';

const INITIAL_RESULT = {
  status: 'Ready',
  confidence: 1.0,
  is_anomaly: false,
  features: { rms_energy: 0, zcr: 0, spectral_flux: 0 }
};

export function useDetection(clientId, initialStream = null, targetPeerId = null, selectedModel = 'webrtc') {
  const [stream, setStream] = useState(initialStream);
  const [detectionResult, setDetectionResult] = useState(INITIAL_RESULT);
  const [history, setHistory] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [hasAudioTracks, setHasAudioTracks] = useState(() => Boolean(initialStream && initialStream.getAudioTracks().length > 0));

  const detectionServiceRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const silentGainRef = useRef(null);

  // Reset detection state when active model changes to prevent stale verdict display
  useEffect(() => {
    setDetectionResult(INITIAL_RESULT);
  }, [selectedModel]);

  // Sync stream state if initialStream prop changes
  useEffect(() => {
    if (initialStream) {
      setStream(initialStream);
      setIsAnalyzing(true);
    }
  }, [initialStream]);

  // Dynamic attachment function for MediaStream or MediaStreamTrack
  const attachAudioTrack = useCallback((trackOrStream) => {
    if (!trackOrStream) return;
    if (trackOrStream instanceof MediaStream) {
      setStream(trackOrStream);
      setIsAnalyzing(true);
    } else if (typeof MediaStreamTrack !== 'undefined' && trackOrStream instanceof MediaStreamTrack) {
      const newStream = new MediaStream([trackOrStream]);
      setStream(newStream);
      setIsAnalyzing(true);
    }
  }, []);

  const handleResult = useCallback((result) => {
    setDetectionResult(result);
    setHistory((prev) => [
      {
        timestamp: new Date().toLocaleTimeString(),
        targetPeerId,
        ...result
      },
      ...prev.slice(0, 19) // keep last 20 events
    ]);
  }, [targetPeerId]);

  // Teardown helper for Web Audio pipeline
  const cleanupAudioGraph = useCallback(() => {
    if (processorNodeRef.current) {
      try {
        processorNodeRef.current.onaudioprocess = null;
        processorNodeRef.current.disconnect();
      } catch (err) {
        // Safe ignore
      }
      processorNodeRef.current = null;
    }
    if (silentGainRef.current) {
      try {
        silentGainRef.current.disconnect();
      } catch (err) {
        // Safe ignore
      }
      silentGainRef.current = null;
    }
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch (err) {
        // Safe ignore
      }
      sourceNodeRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        if (audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close();
        }
      } catch (err) {
        // Safe ignore
      }
      audioContextRef.current = null;
    }
  }, []);

  const startDetection = useCallback(() => {
    setIsAnalyzing(true);
  }, []);

  const stopDetection = useCallback(() => {
    setIsAnalyzing(false);
    cleanupAudioGraph();
    if (detectionServiceRef.current) {
      detectionServiceRef.current.disconnect();
      detectionServiceRef.current = null;
    }
    setDetectionResult(INITIAL_RESULT);
  }, [cleanupAudioGraph]);

  // Monitor audio track presence on the selected MediaStream
  useEffect(() => {
    if (!stream) {
      setHasAudioTracks(false);
      return;
    }

    const checkAudioTracks = () => {
      const audioTracks = stream.getAudioTracks();
      setHasAudioTracks(audioTracks.length > 0);
    };

    checkAudioTracks();

    const handleTrackAdded = (e) => {
      if (!e.track || e.track.kind === 'audio') {
        checkAudioTracks();
      }
    };

    const handleTrackRemoved = (e) => {
      if (!e.track || e.track.kind === 'audio') {
        checkAudioTracks();
      }
    };

    stream.addEventListener('addtrack', handleTrackAdded);
    stream.addEventListener('removetrack', handleTrackRemoved);

    return () => {
      stream.removeEventListener('addtrack', handleTrackAdded);
      stream.removeEventListener('removetrack', handleTrackRemoved);
    };
  }, [stream]);

  // Manage Detection WebSocket connection lifecycle
  useEffect(() => {
    if (!isAnalyzing || !clientId) {
      if (detectionServiceRef.current) {
        detectionServiceRef.current.disconnect();
        detectionServiceRef.current = null;
      }
      return;
    }

    const sessionKey = targetPeerId ? `${clientId}_${targetPeerId}` : clientId;
    const service = new DetectionService(sessionKey, handleResult, selectedModel);
    service.connect();
    detectionServiceRef.current = service;

    return () => {
      service.disconnect();
      if (detectionServiceRef.current === service) {
        detectionServiceRef.current = null;
      }
    };
  }, [isAnalyzing, clientId, targetPeerId, handleResult, selectedModel]);

  // Manage Web Audio capture pipeline lifecycle
  useEffect(() => {
    if (!isAnalyzing || !stream || !hasAudioTracks) {
      cleanupAudioGraph();
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      cleanupAudioGraph();
      return;
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        console.error('[Detection Hook] Web Audio API is not supported in this browser.');
        return;
      }

      const audioCtx = new AudioContextClass({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch((err) => {
          console.warn('[Detection Hook] AudioContext resume failed:', err);
        });
      }

      const source = audioCtx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      // 4096 samples at 16kHz = ~256ms chunk
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorNodeRef.current = processor;

      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      silentGainRef.current = silentGain;

      processor.onaudioprocess = (e) => {
        if (!detectionServiceRef.current) return;

        // Agar remote track muted/disabled hai toh buffering band rakhein
        const currentTrack = stream.getAudioTracks()[0];
        if (!currentTrack || !currentTrack.enabled || currentTrack.muted) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);

        // RMS energy check: pure silence (0.0000) backend ko mat bhejein
        let sumSq = 0;
        for (let i = 0; i < inputData.length; i++) {
          sumSq += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sumSq / inputData.length);
        if (rms < 0.002) {
          return;
        }

        // Convert Float32Array to 16-bit PCM Int16Array
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        detectionServiceRef.current.sendAudioChunk(pcmData.buffer);
      };

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);
    } catch (err) {
      console.error('[Detection Hook] AudioContext processing error:', err);
    }

    return () => {
      cleanupAudioGraph();
    };
  }, [isAnalyzing, stream, hasAudioTracks, cleanupAudioGraph]);

  // Teardown everything on unmount
  useEffect(() => {
    return () => {
      stopDetection();
    };
  }, [stopDetection]);

  // Derived real acoustic telemetry
  const telemetry = {
    rms: detectionResult?.features?.rms_energy ?? 0.0,
    zcr: detectionResult?.features?.zcr ?? 0.0,
    flux: detectionResult?.features?.spectral_flux ?? 0.0
  };

  // Convert real detection history into structured logs
  const logs = history.map((item) => {
    const isFake = Boolean(item.is_anomaly || item.label === 'FAKE');
    const isBuffering = Boolean(item.is_buffering);
    let level = 'info';
    let message = item.status || 'Audio chunk analyzed';

    if (isBuffering) {
      level = 'info';
      message = `Buffering: ${item.samples_buffered || 0}/${item.samples_needed || 48000} samples`;
    } else if (isFake) {
      level = 'warn';
      message = `Deepfake alert! Fake: ${item.fake_pct ?? (item.confidence * 100).toFixed(1)}%`;
    } else {
      level = 'ok';
      message = `Authentic human speech confirmed (Real: ${item.real_pct ?? 100}%)`;
    }

    return {
      time: item.timestamp || new Date().toLocaleTimeString(),
      level,
      message
    };
  });

  return {
    detectionResult,
    telemetry,
    logs,
    history,
    isAnalyzing,
    startDetection,
    stopDetection,
    attachAudioTrack
  };
}
