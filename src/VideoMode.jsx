import { useEffect, useRef, useState } from "react";
import useCanvasRecording from "./useCanvasRecording.js";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000")
  .replace(/\/+$/, "");
const FRAME_INTERVAL_MS = 200;
const FRAME_WIDTH_LIMIT = 640;
const FRAME_HEIGHT_LIMIT = 360;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createWebSocketUrl() {
  const apiUrl = new URL(API_BASE_URL);
  apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
  apiUrl.pathname = `${apiUrl.pathname.replace(/\/+$/, "")}/api/video/ws`;
  return apiUrl.toString();
}

function waitForSocket(socket) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The video-processing connection timed out."));
    }, 10000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not connect to the video-processing service."));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("The video-processing connection closed before it opened."));
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

function receiveFrame(socket) {
  return new Promise((resolve, reject) => {
    let metadata = null;
    const cleanup = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const onError = () => {
      cleanup();
      reject(new Error("The video-processing connection failed."));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("The video-processing connection was closed."));
    };
    const onMessage = (event) => {
      if (typeof event.data === "string") {
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch {
          cleanup();
          reject(new Error("The video service returned invalid frame metadata."));
          return;
        }
        if (payload.type === "error") {
          cleanup();
          reject(new Error(payload.error || "Frame processing failed."));
          return;
        }
        if (payload.type !== "frame_result") {
          cleanup();
          reject(new Error("The video service returned an unexpected response."));
          return;
        }
        metadata = payload;
        return;
      }
      if (!(event.data instanceof Blob) || !metadata) {
        cleanup();
        reject(new Error("The video service returned an invalid image frame."));
        return;
      }
      cleanup();
      resolve({ metadata, blob: event.data });
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

function waitForNextFrame(session, delay) {
  return new Promise((resolve) => {
    session.timerResolve = resolve;
    session.timer = window.setTimeout(() => {
      session.timer = null;
      session.timerResolve = null;
      resolve();
    }, delay);
  });
}

function VideoMode() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const sessionRef = useRef(null);
  const attemptRef = useRef(null);
  const mountedRef = useRef(false);
  const settingsRef = useRef({ method: "blur", strength: 15 });
  const previousFrameAtRef = useRef(null);
  const [method, setMethod] = useState("blur");
  const [strength, setStrength] = useState(15);
  const [connecting, setConnecting] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [status, setStatus] = useState("Camera is off");
  const [error, setError] = useState("");
  const [stats, setStats] = useState(null);
  const [processedFrameReady, setProcessedFrameReady] = useState(false);
  const recording = useCanvasRecording();

  useEffect(() => {
    settingsRef.current = { method, strength };
  }, [method, strength]);

  function clearOutput() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#e8ede9";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  function stopSession(updateUi = true, unmounting = false) {
    if (!unmounting) {
      recording.stopRecording("Recording finalized because video processing stopped.");
      setProcessedFrameReady(false);
    }
    if (attemptRef.current) {
      attemptRef.current.cancelled = true;
      attemptRef.current = null;
    }
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      session.active = false;
      if (session.timer) window.clearTimeout(session.timer);
      session.timerResolve?.();
      for (const track of session.stream.getTracks()) track.stop();
      if (session.socket && (session.socket.readyState === WebSocket.OPEN
        || session.socket.readyState === WebSocket.CONNECTING)) {
        session.socket.close();
      }
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    clearOutput();
    previousFrameAtRef.current = null;
    if (updateUi && mountedRef.current) {
      setCameraActive(false);
      setConnecting(false);
      setStats(null);
      setProcessedFrameReady(false);
      setError("");
      setStatus("Camera is off");
    }
  }

  function failSession(session, message) {
    if (sessionRef.current !== session) return;
    stopSession(false);
    if (mountedRef.current) {
      setCameraActive(false);
      setConnecting(false);
      setStats(null);
      setError(message);
      setStatus("Processing stopped");
    }
  }

  async function processFrames(session) {
    const video = videoRef.current;
    const outputCanvas = canvasRef.current;
    const sourceCanvas = document.createElement("canvas");
    const sourceContext = sourceCanvas.getContext("2d", { alpha: false });
    const outputContext = outputCanvas?.getContext("2d", { alpha: false });
    if (!video || !outputCanvas || !sourceContext || !outputContext) {
      throw new Error("This browser could not initialize frame processing.");
    }

    const scale = Math.min(
      1,
      FRAME_WIDTH_LIMIT / video.videoWidth,
      FRAME_HEIGHT_LIMIT / video.videoHeight,
    );
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    outputCanvas.width = width;
    outputCanvas.height = height;
    clearOutput();
    let sequence = 0;

    while (session.active && session.socket.readyState === WebSocket.OPEN) {
      const frameStartedAt = performance.now();
      sourceContext.drawImage(video, 0, 0, width, height);
      const frameBlob = await new Promise((resolve) => {
        sourceCanvas.toBlob(resolve, "image/jpeg", 0.76);
      });
      if (!frameBlob) throw new Error("Could not encode a camera frame.");
      if (frameBlob.size > 1_000_000) {
        throw new Error("The encoded camera frame exceeded the service limit.");
      }

      const settings = settingsRef.current;
      session.socket.send(JSON.stringify({
        type: "frame",
        sequence,
        method: settings.method,
        strength: settings.strength,
      }));
      session.socket.send(frameBlob);
      const { metadata, blob } = await receiveFrame(session.socket);
      if (!session.active) return;
      if (metadata.sequence !== sequence
        || metadata.width !== width
        || metadata.height !== height) {
        throw new Error("The video service returned mismatched frame metadata.");
      }

      const processedFrame = await createImageBitmap(blob);
      if (!session.active) {
        processedFrame.close();
        return;
      }
      outputContext.drawImage(processedFrame, 0, 0, width, height);
      processedFrame.close();
      setProcessedFrameReady(true);

      const now = performance.now();
      const fps = previousFrameAtRef.current
        ? 1000 / (now - previousFrameAtRef.current)
        : 0;
      previousFrameAtRef.current = now;
      setStats({
        faceCount: metadata.face_count,
        processedFaceCount: metadata.processed_face_count,
        anonymized: metadata.anonymized,
        processingMs: metadata.processing_ms,
        fps,
      });
      setStatus("Connected · processing frames");
      sequence += 1;

      const remainingDelay = Math.max(
        0,
        FRAME_INTERVAL_MS - (performance.now() - frameStartedAt),
      );
      await waitForNextFrame(session, remainingDelay);
    }
  }

  async function enableCamera() {
    if (sessionRef.current || attemptRef.current || connecting) return;
    setError("");
    setStats(null);
    setConnecting(true);
    setProcessedFrameReady(false);
    setStatus("Requesting camera access…");
    const attempt = { cancelled: false };
    attemptRef.current = attempt;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not available in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: FRAME_WIDTH_LIMIT },
          height: { ideal: FRAME_HEIGHT_LIMIT },
          frameRate: { ideal: 15, max: 30 },
        },
      });
      if (attemptRef.current !== attempt || attempt.cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      const session = {
        active: true,
        stream,
        socket: null,
        timer: null,
        timerResolve: null,
      };
      sessionRef.current = session;
      const video = videoRef.current;
      video.srcObject = stream;
      await new Promise((resolve, reject) => {
        if (video.videoWidth && video.videoHeight) {
          resolve();
          return;
        }
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error("Could not read camera frames."));
      });
      await video.play();
      if (!session.active) return;

      const socket = new WebSocket(createWebSocketUrl());
      session.socket = socket;
      socket.binaryType = "blob";
      socket.addEventListener("close", () => {
        failSession(session, "The video-processing connection was closed.");
      });
      socket.addEventListener("error", () => {
        failSession(session, "The video-processing connection failed.");
      });
      setStatus("Connecting to YuNet processor…");
      await waitForSocket(socket);
      if (!session.active) {
        socket.close();
        return;
      }
      attemptRef.current = null;
      setConnecting(false);
      setCameraActive(true);
      setStatus("Connected · starting frame processing");
      await processFrames(session);
    } catch (startError) {
      const session = sessionRef.current;
      const message = startError instanceof DOMException
        && startError.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access and try again."
        : startError instanceof DOMException && startError.name === "NotFoundError"
          ? "No camera is available on this device."
          : startError.message || "Could not start video anonymization.";
      if (session) {
        failSession(session, message);
      } else if (attemptRef.current === attempt) {
        attemptRef.current = null;
        for (const track of videoRef.current?.srcObject?.getTracks?.() || []) {
          track.stop();
        }
        if (videoRef.current) videoRef.current.srcObject = null;
        if (mountedRef.current) {
          setConnecting(false);
          setCameraActive(false);
          setProcessedFrameReady(false);
          setStatus("Camera is off");
          setError(message);
        }
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopSession(false, true);
    };
  }, []);

  const minimumStrength = method === "pixelate" ? 2 : 1;
  const recordingActive = recording.recordingState === "recording";
  const recordingFinalizing = recording.recordingState === "finalizing";
  const recordingReady = recording.recordingState === "ready";

  return (
    <section className="video-workspace" aria-labelledby="video-heading">
      <video ref={videoRef} className="video-source" muted playsInline aria-hidden="true" />
      <div className="panel video-panel">
        <div className="section-heading">
          <div className="step-number">01</div>
          <div>
            <h2 id="video-heading">Live camera anonymization</h2>
            <p>Your camera frames are processed by the existing Python YuNet service.</p>
          </div>
        </div>

        <div className="video-preview" aria-label="Processed camera preview">
          <canvas ref={canvasRef} aria-label="Anonymized video output" />
          {!cameraActive && (
            <div className="video-placeholder">
              <span className="video-placeholder-icon">●</span>
              <strong>{connecting ? "Connecting to camera…" : "Processed preview appears here"}</strong>
              <span>The original camera feed is not shown as the anonymized result.</span>
            </div>
          )}
          <span className={`video-status${cameraActive ? " video-status-active" : ""}`} role="status">
            <span />{status}
          </span>
        </div>

        <div className="video-stats" aria-live="polite">
          <span><strong>{stats?.faceCount ?? "—"}</strong> faces detected</span>
          <span><strong>{stats?.processingMs ?? "—"}</strong> ms processing</span>
          <span><strong>{stats ? stats.fps.toFixed(1) : "—"}</strong> FPS received</span>
        </div>
        <div className="recording-state" role="status">
          <span className={recordingActive ? "recording-indicator recording-indicator-active" : "recording-indicator"} />
          Recording: <strong>{recordingActive ? "Recording" : recordingFinalizing ? "Finalizing" : recordingReady ? "Ready" : recording.recordingState === "error" ? "Error" : "Idle"}</strong>
          {(recordingActive || recordingReady) && <span> · {recording.formattedDuration}</span>}
          {recordingReady && <span> · {formatBytes(recording.recordingSize)}</span>}
        </div>
        {recording.recordingNotice && (
          <p className="video-recording-notice">{recording.recordingNotice}</p>
        )}
        {recording.recordingError && (
          <div className="error-message" role="alert"><span>!</span>{recording.recordingError}</div>
        )}
        {recordingReady && recording.recordingUrl && (
          <div className="recorded-video">
            <video
              controls
              playsInline
              preload="metadata"
              src={recording.recordingUrl}
              aria-label="Recorded anonymized video preview"
            />
            <div className="recording-actions">
              <a
                className="button button-primary"
                href={recording.recordingUrl}
                download={recording.recordingFilename}
              >
                Download Video
              </a>
              <button
                className="button button-secondary"
                type="button"
                onClick={recording.discardRecording}
              >
                Discard Recording
              </button>
            </div>
          </div>
        )}
        {stats && stats.faceCount === 0 && (
          <p className="video-zero-note" role="status">
            No face detected in this frame. This does not confirm that no face is present.
          </p>
        )}
        {error && <div className="error-message" role="alert"><span>!</span>{error}</div>}
      </div>

      <section className="panel video-controls" aria-label="Video controls">
        <div className="section-heading">
          <div className="step-number">02</div>
          <div>
            <h2>Processing controls</h2>
            <p>One frame is sent at a time; frames are not queued.</p>
          </div>
        </div>

        <div className="method-options" role="radiogroup" aria-label="Video anonymization method">
          <button
            className={`method-card${method === "blur" ? " method-selected" : ""}`}
            type="button"
            role="radio"
            aria-checked={method === "blur"}
            onClick={() => {
              setMethod("blur");
              setStrength((current) => Math.max(1, current));
            }}
          >
            <span className="method-art blur-art"><span /><span /><span /></span>
            <span className="method-text"><strong>Gaussian blur</strong><small>Soft, smooth finish</small></span>
            <span className="radio-indicator" />
          </button>
          <button
            className={`method-card${method === "pixelate" ? " method-selected" : ""}`}
            type="button"
            role="radio"
            aria-checked={method === "pixelate"}
            onClick={() => {
              setMethod("pixelate");
              setStrength((current) => Math.max(2, current));
            }}
          >
            <span className="method-art pixel-art"><i /><i /><i /><i /><i /><i /><i /><i /><i /></span>
            <span className="method-text"><strong>Pixelation</strong><small>Classic mosaic effect</small></span>
            <span className="radio-indicator" />
          </button>
        </div>

        <div className="strength-header">
          <label htmlFor="video-strength">Anonymization strength</label>
          <output htmlFor="video-strength" className="strength-value">{strength}</output>
        </div>
        <input
          id="video-strength"
          className="strength-slider"
          type="range"
          min={minimumStrength}
          max="50"
          step="1"
          value={strength}
          onChange={(event) => setStrength(Number(event.target.value))}
          style={{ "--range-progress": `${((strength - minimumStrength) / (50 - minimumStrength)) * 100}%` }}
        />
        <div className="slider-labels"><span>Subtle</span><span>Balanced</span><span>Strong</span></div>

        <div className="video-actions">
          <button className="button button-primary" type="button" disabled={connecting || cameraActive} onClick={enableCamera}>
            {connecting ? <><span className="spinner" /> Connecting…</> : "Start Camera"}
          </button>
          <button className="button button-secondary" type="button" disabled={!connecting && !cameraActive} onClick={() => stopSession()}>
            Stop Camera
          </button>
          <button
            className="button button-record"
            type="button"
            disabled={!cameraActive || !processedFrameReady || recordingActive || recordingFinalizing}
            onClick={() => recording.startRecording(canvasRef.current, processedFrameReady)}
          >
            {recordingActive ? "Recording…" : "Start Recording"}
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={!recordingActive}
            onClick={() => recording.stopRecording()}
          >
            {recordingFinalizing ? "Finalizing…" : "Stop Recording"}
          </button>
        </div>
        <p className="privacy-note"><span aria-hidden="true">◆</span> Frames are processed in memory. Detection can miss faces; blur and pixelation do not guarantee anonymity.</p>
      </section>
    </section>
  );
}

export default VideoMode;
