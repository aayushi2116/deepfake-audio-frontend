import React, { useRef, useEffect } from 'react';
import { ShieldCheck, AlertTriangle, Activity, Radio, Cpu, Sparkles, Wifi } from 'lucide-react';

export default function AIDetectionPanel({
  remoteStream,
  detectionResult,
  telemetry,
  logs = [],
  selectedModel = 'webrtc',
  onModelChange
}) {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  const hasRemoteAudio = Boolean(
    remoteStream &&
    remoteStream.getAudioTracks &&
    remoteStream.getAudioTracks().length > 0 &&
    remoteStream.getAudioTracks().some(t => t.readyState === 'live')
  );

  const isBuffering = Boolean(detectionResult?.is_buffering);
  const hasResult = Boolean(
    detectionResult &&
    detectionResult.label &&
    detectionResult.label !== 'BUFFERING' &&
    detectionResult.confidence !== undefined
  );

  // Class probabilities
  const realPct = detectionResult?.real_pct !== undefined
    ? Number(detectionResult.real_pct)
    : (detectionResult?.real_probability !== undefined ? Math.round(detectionResult.real_probability * 100) : 0);
  const fakePct = detectionResult?.fake_pct !== undefined
    ? Number(detectionResult.fake_pct)
    : (detectionResult?.fake_probability !== undefined ? Math.round(detectionResult.fake_probability * 100) : 0);

  const isAnomaly = Boolean(detectionResult?.is_anomaly || detectionResult?.label === 'FAKE');

  // Active Model identification
  const activeModelTag = (detectionResult?.model_version || selectedModel || 'webrtc').toLowerCase();
  const isWebRTC = activeModelTag === 'webrtc';
  const isC4B = activeModelTag === 'cond_4b' || activeModelTag.includes('4b');

  const activeModelDisplayName = isWebRTC
    ? 'WebRTC Calibrated (best_webrtc_model)'
    : isC4B
      ? 'Condition 4B Robust'
      : 'Production Baseline';

  const activeThresholdLabel = isWebRTC
    ? '83% (τ* = 0.83)'
    : isC4B
      ? '37% (τ* = 0.37)'
      : '50% (τ = 0.50)';

  // Determine current monitoring state
  let statusBadgeClass = 'standby';
  let statusText = 'Standby';

  if (!hasRemoteAudio) {
    statusBadgeClass = 'standby';
    statusText = 'Awaiting Peer Audio';
  } else if (isBuffering) {
    statusBadgeClass = 'buffering';
    statusText = 'Buffering Frames';
  } else if (hasResult) {
    if (isAnomaly) {
      statusBadgeClass = 'synthetic';
      statusText = 'Synthetic Detected';
    } else if (realPct >= 15) {
      statusBadgeClass = 'authentic';
      statusText = 'Authentic Voice';
    } else {
      statusBadgeClass = 'warning';
      statusText = 'Inconclusive';
    }
  }

  // Real-time Waveform Canvas attached to remote audio track
  useEffect(() => {
    if (!remoteStream || remoteStream.getAudioTracks().length === 0) return;

    let audioCtx;
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;

      audioCtx = new AudioCtxClass();
      const source = audioCtx.createMediaStreamSource(remoteStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');

      const isDarkMode = () => document.documentElement.getAttribute('data-theme') === 'dark';

      const draw = () => {
        animationRef.current = requestAnimationFrame(draw);
        analyser.getByteTimeDomainData(dataArray);

        const dark = isDarkMode();
        ctx.fillStyle = dark ? '#0e1524' : '#f8fafc';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.lineWidth = 1.75;
        ctx.strokeStyle = dark ? '#6366f1' : '#4f46e5';
        ctx.beginPath();

        const sliceWidth = (canvas.width * 1.0) / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * canvas.height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }

        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.stroke();
      };

      draw();
    } catch (e) {
      console.warn('[Waveform] AudioContext setup notice:', e);
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
    };
  }, [remoteStream]);

  return (
    <div className="detection-panel">
      {/* Primary Card: Authenticity Verdict & Meter */}
      <div className="panel-card">
        <div className="panel-header-compact">
          <h2 className="panel-title">
            <Radio size={16} color="var(--primary)" />
            <span>Audio Authenticity Monitor</span>
          </h2>
          <span className={`status-badge ${statusBadgeClass}`}>
            <span className="status-pulse" />
            <span>{statusText}</span>
          </span>
        </div>

        {/* Model Selection Control */}
        <div className="live-model-selector-bar">
          <div className="live-model-btn-group" role="radiogroup" aria-label="WebRTC Model Selection">
            <button
              type="button"
              id="live-model-btn-webrtc"
              className={`live-model-btn ${selectedModel === 'webrtc' ? 'active' : ''}`}
              onClick={() => onModelChange && onModelChange('webrtc')}
              title="WebRTC Calibrated model (τ* = 0.83)"
            >
              <Wifi size={12} />
              <span>WebRTC (&tau;* = 0.83)</span>
            </button>
            <button
              type="button"
              id="live-model-btn-original"
              className={`live-model-btn ${selectedModel === 'original' ? 'active' : ''}`}
              onClick={() => onModelChange && onModelChange('original')}
              title="Standard ASVspoof 2019 baseline model (τ = 0.50)"
            >
              <Cpu size={12} />
              <span>Production (&tau; = 0.50)</span>
            </button>
            <button
              type="button"
              id="live-model-btn-cond4b"
              className={`live-model-btn ${selectedModel === 'cond_4b' ? 'active' : ''}`}
              onClick={() => onModelChange && onModelChange('cond_4b')}
              title="Condition 4B Robust with Opus/Codec augmentation (τ* = 0.37)"
            >
              <Sparkles size={12} />
              <span>Condition 4B (&tau;* = 0.37)</span>
            </button>
          </div>
        </div>

        {/* Dynamic Verdict Presentation */}
        {!hasRemoteAudio ? (
          <div style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <Activity size={24} style={{ margin: '0 auto 6px', color: 'var(--text-muted)', display: 'block' }} />
            <div style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
              Waiting for remote audio stream...
            </div>
            <div style={{ fontSize: '0.74rem', marginTop: '3px' }}>
              Deepfake analysis will activate automatically once speech frames arrive.
            </div>
          </div>
        ) : isBuffering ? (
          <div style={{ padding: '14px 12px', textAlign: 'center', background: 'var(--primary-subtle)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--primary-text)' }}>
              {detectionResult?.status || 'Buffering speech frames (3.0s window)...'}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--primary-text)', marginTop: '2px', opacity: 0.85 }}>
              Analyzing acoustic spectrum across frequency bands...
            </div>
          </div>
        ) : (
          <div className="meter-wrapper">
            <div className="meter-labels-row">
              <span className="meter-label-left">Authentic: {realPct.toFixed(1)}%</span>
              <span className="meter-label-right">Synthetic: {fakePct.toFixed(1)}%</span>
            </div>

            <div className="meter-track" role="progressbar" aria-valuenow={realPct} aria-valuemin="0" aria-valuemax="100">
              <div className="meter-fill-authentic" style={{ width: `${Math.min(100, Math.max(0, realPct))}%` }} />
              <div className="meter-fill-synthetic" style={{ width: `${Math.min(100, Math.max(0, fakePct))}%` }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', fontSize: '0.82rem' }}>
              {isAnomaly ? (
                <>
                  <AlertTriangle size={15} color="var(--synthetic)" />
                  <span style={{ fontWeight: 700, color: 'var(--synthetic)' }}>
                    High Anomaly Probability (Deepfake Voice Flagged)
                  </span>
                </>
              ) : (
                <>
                  <ShieldCheck size={15} color="var(--authentic)" />
                  <span style={{ fontWeight: 700, color: 'var(--authentic)' }}>
                    Authentic Voice Confirmed (Natural Vocal Tract)
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Live Audio Waveform Monitor */}
        <div className="waveform-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            <span>Live Audio Waveform</span>
            <span>{hasRemoteAudio ? '16 kHz Mono' : 'Inactive'}</span>
          </div>
          <canvas ref={canvasRef} width="480" height="72" className="waveform-canvas" />
        </div>

        {/* Active Model Telemetry Indicator */}
        <div className="live-model-telemetry">
          <span>Checkpoint: <strong>{activeModelDisplayName}</strong></span>
          <span>Threshold: <strong>{activeThresholdLabel}</strong></span>
        </div>

        {/* Essential Acoustic Telemetry Metrics */}
        <div className="metrics-row">
          <div className="metric-card-compact">
            <span className="metric-card-label">RMS Energy</span>
            <span className="metric-card-value">{(telemetry?.rms ?? 0.0).toFixed(4)}</span>
          </div>
          <div className="metric-card-compact">
            <span className="metric-card-label">Zero-Crossing</span>
            <span className="metric-card-value">{(telemetry?.zcr ?? 0.0).toFixed(4)}</span>
          </div>
          <div className="metric-card-compact">
            <span className="metric-card-label">Spectral Flux</span>
            <span className="metric-card-value">{(telemetry?.flux ?? 0.0).toFixed(4)}</span>
          </div>
        </div>
      </div>

      {/* Secondary Card: Recent Detection Events */}
      <div className="panel-card" style={{ gap: '10px' }}>
        <div className="panel-header-compact">
          <h3 className="panel-title" style={{ fontSize: '0.84rem' }}>Recent Detection Events</h3>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Last 4 events</span>
        </div>

        <div className="event-log-container">
          {logs.length === 0 ? (
            <div className="log-entry-row">
              <span className="log-entry-dot" style={{ backgroundColor: 'var(--text-muted)' }} />
              <span className="log-entry-msg">
                {hasRemoteAudio ? 'Stream connected. Awaiting speech...' : 'Standing by for active call...'}
              </span>
            </div>
          ) : (
            logs.slice(-4).map((log, index) => {
              const dotColor = log.level === 'warn'
                ? 'var(--synthetic)'
                : log.level === 'amber'
                  ? 'var(--warning)'
                  : 'var(--authentic)';

              return (
                <div key={index} className="log-entry-row">
                  <span className="log-entry-time">{log.time}</span>
                  <span className="log-entry-dot" style={{ backgroundColor: dotColor }} />
                  <span className="log-entry-msg" title={log.message}>{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}