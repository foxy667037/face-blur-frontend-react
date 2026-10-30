import { useEffect, useRef, useState } from "react";

const RECORDING_FRAME_RATE = 5;
const WEBM_MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

function selectRecordingMimeType(Recorder = globalThis.MediaRecorder) {
  if (!Recorder || typeof Recorder.isTypeSupported !== "function") {
    throw new Error("Video recording is not supported by this browser.");
  }

  for (const mimeType of WEBM_MIME_TYPES) {
    if (Recorder.isTypeSupported(mimeType)) return mimeType;
  }
  throw new Error("This browser does not support WebM video recording.");
}

function formatRecordingTimestamp(date) {
  const twoDigits = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    twoDigits(date.getMonth() + 1),
    twoDigits(date.getDate()),
  ].join("-") + `-${twoDigits(date.getHours())}${twoDigits(date.getMinutes())}${twoDigits(date.getSeconds())}`;
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function stopTracks(stream) {
  for (const track of stream?.getTracks() || []) track.stop();
}

function useCanvasRecording() {
  const [recordingState, setRecordingState] = useState("idle");
  const [recordingError, setRecordingError] = useState("");
  const [recordingNotice, setRecordingNotice] = useState("");
  const [recordingUrl, setRecordingUrl] = useState("");
  const [recordingFilename, setRecordingFilename] = useState("");
  const [recordingMimeType, setRecordingMimeType] = useState("");
  const [recordingSize, setRecordingSize] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const recorderRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const recordingUrlRef = useRef("");
  const timerRef = useRef(null);
  const mountedRef = useRef(false);

  function updateIfMounted(update) {
    if (mountedRef.current) update();
  }

  function revokeRecordingUrl() {
    if (!recordingUrlRef.current) return;
    URL.revokeObjectURL(recordingUrlRef.current);
    recordingUrlRef.current = "";
  }

  function clearSavedRecording() {
    revokeRecordingUrl();
    setRecordingUrl("");
    setRecordingFilename("");
    setRecordingMimeType("");
    setRecordingSize(0);
    setElapsedSeconds(0);
  }

  function releaseRecordingStream() {
    stopTracks(recordingStreamRef.current);
    recordingStreamRef.current = null;
  }

  function finishRecording(session) {
    if (recorderRef.current !== session.recorder) return;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    recorderRef.current = null;
    releaseRecordingStream();

    if (session.failureReason) {
      chunksRef.current = [];
      updateIfMounted(() => {
        setRecordingState("error");
        setRecordingError(session.failureReason);
      });
      return;
    }
    if (!session.stopRequested) {
      updateIfMounted(() => {
        setRecordingNotice("The recorder stopped unexpectedly; available processed frames were finalized.");
      });
    }

    const mimeType = session.recorder.mimeType || session.mimeType;
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];
    if (blob.size === 0) {
      updateIfMounted(() => {
        setRecordingState("error");
        setRecordingError("The recording did not contain any video data.");
      });
      return;
    }

    revokeRecordingUrl();
    const url = URL.createObjectURL(blob);
    recordingUrlRef.current = url;
    const filename = `anonymized-video-${formatRecordingTimestamp(new Date())}.webm`;
    updateIfMounted(() => {
      setRecordingUrl(url);
      setRecordingFilename(filename);
      setRecordingMimeType(blob.type || mimeType);
      setRecordingSize(blob.size);
      setElapsedSeconds(Math.floor((Date.now() - session.startedAt) / 1000));
      setRecordingState("ready");
    });
  }

  function stopRecording(notice = "") {
    const recorder = recorderRef.current;
    if (!recorder) return false;

    if (notice) setRecordingNotice(notice);
    if (recorder.state === "inactive") {
      setRecordingState("finalizing");
      return true;
    }

    setRecordingState("finalizing");
    recorder.recordingSession.stopRequested = true;
    try {
      recorder.stop();
    } catch {
      const session = recorder.recordingSession;
      if (session) {
        session.failureReason = "The recording could not be finalized.";
        finishRecording(session);
      }
      return false;
    }
    return true;
  }

  function startRecording(canvas, processedFrameReady) {
    if (recorderRef.current) return false;
    if (!processedFrameReady || !canvas || canvas.width < 1 || canvas.height < 1) {
      setRecordingError("Wait for a processed camera frame before recording.");
      return false;
    }
    if (typeof canvas.captureStream !== "function") {
      setRecordingError("This browser cannot capture the processed video preview.");
      return false;
    }

    let mimeType;
    let stream;
    try {
      mimeType = selectRecordingMimeType();
      stream = canvas.captureStream(RECORDING_FRAME_RATE);
      if (stream.getVideoTracks().length === 0) {
        throw new Error("The processed preview did not provide a video track.");
      }
    } catch (error) {
      stopTracks(stream);
      setRecordingError(error.message || "Could not capture the processed preview.");
      return false;
    }

    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      stopTracks(stream);
      setRecordingError("The browser could not start WebM video recording.");
      return false;
    }

    const session = {
      recorder,
      mimeType,
      startedAt: Date.now(),
      failureReason: "",
      stopRequested: false,
    };
    recorder.recordingSession = session;
    recorderRef.current = recorder;
    recordingStreamRef.current = stream;
    chunksRef.current = [];
    clearSavedRecording();
    setRecordingError("");
    setRecordingNotice("");
    setElapsedSeconds(0);

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      session.failureReason = "Video recording failed before it could be finalized.";
      setRecordingError(session.failureReason);
      setRecordingState("finalizing");
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          finishRecording(session);
        }
      } else {
        finishRecording(session);
      }
    };
    recorder.onstop = () => finishRecording(session);

    try {
      recorder.start(1000);
    } catch {
      recorderRef.current = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      chunksRef.current = [];
      releaseRecordingStream();
      setRecordingState("error");
      setRecordingError("The browser could not start WebM video recording.");
      return false;
    }

    timerRef.current = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - session.startedAt) / 1000));
    }, 250);
    setRecordingState("recording");
    return true;
  }

  function discardRecording() {
    if (recorderRef.current) return false;
    clearSavedRecording();
    setRecordingError("");
    setRecordingNotice("");
    setRecordingState("idle");
    return true;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = null;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") recorder.stop();
      }
      releaseRecordingStream();
      chunksRef.current = [];
      revokeRecordingUrl();
    };
  }, []);

  return {
    recordingState,
    recordingError,
    recordingNotice,
    recordingUrl,
    recordingFilename,
    recordingMimeType,
    recordingSize,
    elapsedSeconds,
    formattedDuration: formatDuration(elapsedSeconds),
    startRecording,
    stopRecording,
    discardRecording,
  };
}

export default useCanvasRecording;
