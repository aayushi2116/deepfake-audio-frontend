import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  Mic,
  MicOff,
  CheckCircle2,
  AlertTriangle,
  FileAudio,
  AlertCircle,
  RefreshCw,
  Cpu,
  Sparkles,
  Wifi,
  ChevronDown,
  ChevronUp,
  X
} from 'lucide-react';

const defaultHttpHost = (typeof window !== 'undefined' && window.location.hostname) ? window.location.hostname : 'localhost';
const defaultHttpProto = (typeof window !== 'undefined' && window.location.protocol) ? window.location.protocol : 'http:';
const API_BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || `${defaultHttpProto}//${defaultHttpHost}:8000`;

function encodeWAV(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

export default function AudioDetectorView({ onNavigateBack }) {
  const [selectedModel, setSelectedModel] = useState('webrtc'); // 'webrtc' | 'mic' | 'original' | 'cond_4b'
  const [selectedFile, setSelectedFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [showGuidelines, setShowGuidelines] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [recordCountdown, setRecordCountdown] = useState(5);
  const recordingTimerRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  const processSelectedFile = (file) => {
    setError(null);
    setAnalysisResult(null);

    if (file.size > 25 * 1024 * 1024) {
      setError('File exceeds maximum upload size of 25 MB.');
      return;
    }

    setSelectedFile(file);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(URL.createObjectURL(file));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleAnalyzeUpload = async () => {
    if (!selectedFile) {
      setError('Please select or record an audio file first.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const url = `${API_BASE_URL}/api/detect?model=${encodeURIComponent(selectedModel)}`;
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errorMsg = `Upload failed with HTTP ${response.status}`;
        try {
          const errorData = await response.json();
          if (errorData.detail) errorMsg = errorData.detail;
        } catch (_) {}
        throw new Error(errorMsg);
      }

      const data = await response.json();
      if (!data || !data.result) {
        throw new Error('Received invalid response from detection server.');
      }
      setAnalysisResult(data.result);
    } catch (err) {
      setError(err.message || 'An error occurred while analyzing the audio file.');
    } finally {
      setIsLoading(false);
    }
  };

  // Standalone 5-second Mic Test (routes exclusively to best_mic_model.pth)
  const handleStartMicTest = async () => {
    setError(null);
    setAnalysisResult(null);
    setSelectedModel('mic');
    setIsRecording(true);
    setRecordCountdown(5);

    let audioContext;
    let stream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      mediaStreamRef.current = stream;

      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtxClass({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      const recordedChunks = [];
      processor.onaudioprocess = (e) => {
        const channelData = e.inputBuffer.getChannelData(0);
        recordedChunks.push(new Float32Array(channelData));
      };

      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;

      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      let timeLeft = 5;
      recordingTimerRef.current = setInterval(() => {
        timeLeft -= 1;
        setRecordCountdown(timeLeft);

        if (timeLeft <= 0) {
          clearInterval(recordingTimerRef.current);
          processor.disconnect();
          source.disconnect();
          silentGain.disconnect();
          if (audioContext.state !== 'closed') audioContext.close();

          if (stream) {
            stream.getTracks().forEach((track) => track.stop());
          }

          setIsRecording(false);

          let totalLen = 0;
          for (let i = 0; i < recordedChunks.length; i++) {
            totalLen += recordedChunks[i].length;
          }
          const merged = new Float32Array(totalLen);
          let offset = 0;
          for (let i = 0; i < recordedChunks.length; i++) {
            merged.set(recordedChunks[i], offset);
            offset += recordedChunks[i].length;
          }

          const wavBlob = encodeWAV(merged, 16000);
          const wavFile = new File([wavBlob], `mic_test_${Date.now()}.wav`, { type: 'audio/wav' });
          processSelectedFile(wavFile);
        }
      }, 1000);
    } catch (err) {
      setIsRecording(false);
      setError(err.message || 'Microphone access denied or unavailable.');
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setAnalysisResult(null);
    setError(null);
  };

  const isAnomaly = Boolean(analysisResult?.is_anomaly || analysisResult?.label === 'FAKE');
  const realPct = analysisResult?.real_pct !== undefined ? Number(analysisResult.real_pct) : 0;
  const fakePct = analysisResult?.fake_pct !== undefined ? Number(analysisResult.fake_pct) : 0;

  return (
    <div className="detector-container">
      <div className="detector-header">
        <span className="detector-eyebrow">Offline Audio Forensics</span>
        <h1 className="detector-title">Audio Deepfake Detection</h1>
        <p className="detector-desc">
          Upload an audio recording or capture microphone speech to analyze whether the voice contains synthetic vocoder artifacts.
        </p>
      </div>

      {/* Model Selection */}
      <div className="model-toggle-row" role="radiogroup" aria-label="Detection Model Selection">
        {/* Model 1: WebRTC / Mic Calibrated */}
        <div
          id="model-opt-webrtc"
          className={`model-option-card ${selectedModel === 'webrtc' || selectedModel === 'mic' ? 'selected' : ''}`}
          onClick={() => setSelectedModel('webrtc')}
          role="radio"
          aria-checked={selectedModel === 'webrtc' || selectedModel === 'mic'}
          tabIndex={0}
        >
          <input
            type="radio"
            name="modelSelection"
            checked={selectedModel === 'webrtc' || selectedModel === 'mic'}
            onChange={() => setSelectedModel('webrtc')}
            className="model-radio"
          />
          <div className="model-option-content">
            <span className="model-option-title">
              <Wifi size={14} color="var(--primary)" />
              <span>WebRTC &amp; Mic Calibrated</span>
            </span>
            <span className="model-option-desc">
              Calibrated for live browser microphones, Opus codecs, and real-world speech.
            </span>
          </div>
        </div>

        {/* Model 2: Production Baseline */}
        <div
          id="model-opt-original"
          className={`model-option-card ${selectedModel === 'original' ? 'selected' : ''}`}
          onClick={() => setSelectedModel('original')}
          role="radio"
          aria-checked={selectedModel === 'original'}
          tabIndex={0}
        >
          <input
            type="radio"
            name="modelSelection"
            checked={selectedModel === 'original'}
            onChange={() => setSelectedModel('original')}
            className="model-radio"
          />
          <div className="model-option-content">
            <span className="model-option-title">
              <Cpu size={14} color="var(--primary)" />
              <span>Production Baseline</span>
            </span>
            <span className="model-option-desc">
              Standard ASVspoof 2019 baseline model (&tau; = 0.50) for studio FLAC/WAV files.
            </span>
          </div>
        </div>

        {/* Model 3: Condition 4B Fine-Tuned */}
        <div
          id="model-opt-cond4b"
          className={`model-option-card ${selectedModel === 'cond_4b' ? 'selected' : ''}`}
          onClick={() => setSelectedModel('cond_4b')}
          role="radio"
          aria-checked={selectedModel === 'cond_4b'}
          tabIndex={0}
        >
          <input
            type="radio"
            name="modelSelection"
            checked={selectedModel === 'cond_4b'}
            onChange={() => setSelectedModel('cond_4b')}
            className="model-radio"
          />
          <div className="model-option-content">
            <span className="model-option-title">
              <Sparkles size={14} color="var(--warning)" />
              <span>Condition 4B Robust</span>
              <span className="model-badge-exp">Experimental</span>
            </span>
            <span className="model-option-desc">
              Fine-tuned with lossy Opus/MP3 codec augmentation &amp; neural vocoders (&tau;* = 0.37).
            </span>
          </div>
        </div>
      </div>

      {/* Audio Input (Upload & Mic Split) */}
      <div className="input-method-grid">
        <div
          className={`dropzone-box ${selectedFile ? 'has-file' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Click or drop an audio file"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".wav,.mp3,.flac,.ogg,audio/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <UploadCloud size={24} className="dropzone-icon" />
          <span className="dropzone-main-text">
            {selectedFile ? 'Replace selected audio file' : 'Drop an audio file here or browse'}
          </span>
          <span className="dropzone-sub-text">
            WAV, MP3, FLAC, OGG &bull; Max 25 MB
          </span>
        </div>

        <div className="mic-record-box">
          <button
            type="button"
            className={`mic-action-btn ${isRecording ? 'recording' : ''}`}
            onClick={handleStartMicTest}
            disabled={isRecording || isLoading}
            title={isRecording ? `Recording (${recordCountdown}s)` : 'Record 5-second speech'}
            aria-label="Record speech from microphone"
          >
            {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <span className="mic-box-title">
            {isRecording ? `Recording... (${recordCountdown}s)` : 'Quick Mic Test'}
          </span>
          <span className="mic-box-desc">
            Capture 5 seconds of voice via microphone
          </span>
        </div>
      </div>

      {selectedFile && (
        <div className="selected-audio-bar">
          <div className="selected-audio-info">
            <FileAudio size={18} color="var(--primary)" />
            <div>
              <div className="selected-audio-name">{selectedFile.name}</div>
              <div className="selected-audio-size">
                {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB &bull; Ready for inference
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn-remove-audio"
            onClick={handleReset}
            title="Remove selected audio"
          >
            <X size={14} />
            <span>Remove</span>
          </button>
        </div>
      )}

      {audioUrl && (
        <audio controls src={audioUrl} style={{ width: '100%', height: '36px', borderRadius: 'var(--radius-md)' }} />
      )}

      {error && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 14px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: 'var(--synthetic-subtle)',
          border: '1px solid var(--synthetic-border)',
          color: 'var(--synthetic-text)',
          fontSize: '0.82rem'
        }}>
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      <button
        id="analyze-audio-btn"
        type="button"
        className="btn-analyze-submit"
        onClick={handleAnalyzeUpload}
        disabled={!selectedFile || isLoading || isRecording}
      >
        {isLoading ? (
          <>
            <RefreshCw size={16} className="spin" />
            <span>Analyzing Audio via Neural Network...</span>
          </>
        ) : (
          <>
            <Cpu size={16} />
            <span>Analyze Audio</span>
          </>
        )}
      </button>

      {analysisResult && (
        <div className="result-display-card">
          <div className={`result-verdict-banner ${isAnomaly ? 'synthetic' : realPct >= 15 ? 'authentic' : 'warning'}`}>
            {isAnomaly ? (
              <AlertTriangle size={24} style={{ flexShrink: 0 }} />
            ) : (
              <CheckCircle2 size={24} style={{ flexShrink: 0 }} />
            )}
            <div>
              <div className="result-verdict-title">
                {isAnomaly ? 'Synthetic / Deepfake Detected' : 'Authentic Human Speech'}
              </div>
              <div className="result-verdict-subtitle">
                {isAnomaly
                  ? 'Acoustic artifacts match neural vocoder or TTS conversion signatures.'
                  : 'Vocal tract frequency patterns match genuine human speech characteristics.'}
              </div>
            </div>
          </div>

          <div className="meter-wrapper">
            <div className="meter-labels-row">
              <span className="meter-label-left">Authentic: {realPct.toFixed(1)}%</span>
              <span className="meter-label-right">Synthetic: {fakePct.toFixed(1)}%</span>
            </div>
            <div className="meter-track">
              <div className="meter-fill-authentic" style={{ width: `${Math.min(100, Math.max(0, realPct))}%` }} />
              <div className="meter-fill-synthetic" style={{ width: `${Math.min(100, Math.max(0, fakePct))}%` }} />
            </div>
          </div>

          <div className="meta-info-grid">
            <div className="meta-info-cell">
              <span className="meta-info-label">Model Used</span>
              <span className="meta-info-val">
                {analysisResult.model_version === 'mic'
                  ? 'Mic Calibrated'
                  : analysisResult.model_version === 'webrtc'
                    ? 'WebRTC Calibrated'
                    : analysisResult.model_version === 'cond_4b'
                      ? 'Condition 4B'
                      : 'Production'}
              </span>
            </div>
            <div className="meta-info-cell">
              <span className="meta-info-label">Threshold</span>
              <span className="meta-info-val">
                {analysisResult.threshold_used !== undefined
                  ? `τ = ${analysisResult.threshold_used}`
                  : 'τ = 0.50'}
              </span>
            </div>
            <div className="meta-info-cell">
              <span className="meta-info-label">Latency</span>
              <span className="meta-info-val">{analysisResult.processing_time_ms} ms</span>
            </div>
            <div className="meta-info-cell">
              <span className="meta-info-label">Windows</span>
              <span className="meta-info-val">
                {analysisResult.windows_analyzed ?? 1} / {analysisResult.total_windows ?? 1}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="details-expander">
        <div
          className="details-summary"
          onClick={() => setShowTechnicalDetails(prev => !prev)}
          role="button"
          tabIndex={0}
        >
          <span>Acoustic Metrics &amp; Architecture Details</span>
          {showTechnicalDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
        {showTechnicalDetails && (
          <div className="details-content">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '12px' }}>
              <div>
                <strong>RMS Energy:</strong> {analysisResult?.features?.rms_energy ?? '--'}
              </div>
              <div>
                <strong>Zero-Crossing:</strong> {analysisResult?.features?.zcr ?? '--'}
              </div>
              <div>
                <strong>Spectral Flux:</strong> {analysisResult?.features?.spectral_flux ?? '--'}
              </div>
            </div>
            <div>
              <strong>Neural Pipeline:</strong> 16 kHz Mono PCM &rarr; 40-band MFCC + Log-Mel Spectrogram &rarr; 2D CNN (Spectral Texture) &rarr; BiLSTM (Temporal Prosody) &rarr; Self-Attention Pooling &rarr; Calibrated Logit Classification.
            </div>
          </div>
        )}
      </div>

      <div className="details-expander">
        <div
          className="details-summary"
          onClick={() => setShowGuidelines(prev => !prev)}
          role="button"
          tabIndex={0}
        >
          <span>Evaluation Guidelines &amp; Codec Notice</span>
          {showGuidelines ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
        {showGuidelines && (
          <div className="details-content">
            <p style={{ margin: '0 0 6px 0' }}>
              <strong>Authentic Speech Profile:</strong> Natural breathing cycles, organic pitch contours, and uncompressed high-frequency phase harmonics.
            </p>
            <p style={{ margin: 0 }}>
              <strong>Acoustic Domain Notice:</strong> Production model weights evaluate against standard studio baselines. Lossy compression (e.g. WhatsApp, phone audio) introduces band-limiting artifacts that may affect baseline scores.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}