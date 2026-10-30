import { useEffect, useRef, useState } from "react";
import VideoMode from "./VideoMode.jsx";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "bmp", "webp", "tif", "tiff"]);
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/bmp",
  "image/webp",
  "image/tiff",
]);
const ACCEPTED_TYPES =
  ".jpg,.jpeg,.png,.bmp,.webp,.tif,.tiff,image/jpeg,image/png,image/bmp,image/webp,image/tiff";
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000")
  .replace(/\/+$/, "");

function useObjectUrl(value) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!value) {
      setUrl(null);
      return undefined;
    }

    const nextUrl = URL.createObjectURL(value);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [value]);

  return url;
}

function Icon({ name, size = 20 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  if (name === "spark") {
    return <svg {...common}><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></svg>;
  }
  if (name === "upload") {
    return <svg {...common}><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M20 16.5v2A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-2" /></svg>;
  }
  if (name === "image") {
    return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m21 15-5-5L5 20" /></svg>;
  }
  if (name === "download") {
    return <svg {...common}><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></svg>;
  }
  if (name === "shield") {
    return <svg {...common}><path d="M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
  }
  if (name === "close") {
    return <svg {...common}><path d="m18 6-12 12M6 6l12 12" /></svg>;
  }
  return null;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMethod(method) {
  return method === "blur" ? "Gaussian blur" : "Pixelation";
}

function UploadCard({
  file,
  imageUrl,
  dimensions,
  previewUnavailable,
  onChoose,
  onClear,
  onPreviewError,
  isDragging,
  onDragState,
}) {
  const pickerRef = useRef(null);

  function handleDrop(event) {
    event.preventDefault();
    onDragState(false);
    onChoose(event.dataTransfer.files?.[0]);
  }

  return (
    <section className="panel upload-panel" aria-labelledby="upload-heading">
      <div className="section-heading">
        <div className="step-number">01</div>
        <div>
          <h2 id="upload-heading">Add an image</h2>
          <p>Choose a photo with one or more faces.</p>
        </div>
      </div>

      <input
        ref={pickerRef}
        className="visually-hidden"
        type="file"
        accept={ACCEPTED_TYPES}
        onChange={(event) => {
          onChoose(event.target.files?.[0]);
          event.target.value = "";
        }}
        aria-label="Choose an image to anonymize"
      />

      {!file ? (
        <div
          className={`dropzone${isDragging ? " dropzone-active" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            onDragState(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) onDragState(false);
          }}
          onDrop={handleDrop}
        >
          <div className="upload-icon"><Icon name="upload" size={24} /></div>
          <strong>Drop your image here</strong>
          <span className="dropzone-or">or</span>
          <button className="button button-secondary" type="button" onClick={() => pickerRef.current?.click()}>
            Browse files
          </button>
          <p className="format-hint">JPG, PNG, BMP, WebP or TIFF <span>·</span> up to 10 MB</p>
        </div>
      ) : (
        <div className="image-card">
          <div className="image-frame">
            {imageUrl && !previewUnavailable ? (
              <img
                src={imageUrl}
                alt={`Preview of ${file.name}`}
                onError={() => onPreviewError(true)}
                onLoad={() => onPreviewError(false)}
              />
            ) : (
              <div className="preview-placeholder">
                <Icon name="image" size={30} />
                <span>Preview unavailable in this browser</span>
                <small>You can still try processing this file.</small>
              </div>
            )}
            <span className="image-tag">Original</span>
          </div>
          <div className="file-details">
            <div className="file-type-icon"><Icon name="image" /></div>
            <div className="file-copy">
              <strong title={file.name}>{file.name}</strong>
              <span>{dimensions ? `${dimensions.width} × ${dimensions.height} px` : formatBytes(file.size)}</span>
            </div>
            <button className="icon-button" type="button" onClick={onClear} aria-label="Remove image" title="Remove image">
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function App() {
  const [mode, setMode] = useState("image");
  const [file, setFile] = useState(null);
  const [method, setMethod] = useState("blur");
  const [strength, setStrength] = useState(15);
  const [result, setResult] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [dimensions, setDimensions] = useState(null);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const requestController = useRef(null);
  const imageUrl = useObjectUrl(file);
  const resultUrl = useObjectUrl(result);
  const minimumStrength = method === "pixelate" ? 2 : 1;

  useEffect(() => {
    if (!imageUrl) {
      setDimensions(null);
      return undefined;
    }

    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active) setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      if (active) setPreviewUnavailable(true);
    };
    image.src = imageUrl;
    return () => {
      active = false;
    };
  }, [imageUrl]);

  useEffect(() => () => requestController.current?.abort(), []);

  function chooseFile(nextFile) {
    if (!nextFile) return;
    const extension = nextFile.name.split(".").pop()?.toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension) && !ALLOWED_MIME_TYPES.has(nextFile.type)) {
      requestController.current?.abort();
      requestController.current = null;
      setProcessing(false);
      setError("That file type is not supported. Choose a JPG, PNG, BMP, WebP, or TIFF image.");
      setFile(null);
      setResult(null);
      setMetadata(null);
      setDimensions(null);
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      requestController.current?.abort();
      requestController.current = null;
      setProcessing(false);
      setError("This image is larger than 10 MB. Choose a smaller file.");
      setFile(null);
      setResult(null);
      setMetadata(null);
      setDimensions(null);
      return;
    }
    if (nextFile.size === 0) {
      requestController.current?.abort();
      requestController.current = null;
      setProcessing(false);
      setError("This file is empty. Choose a different image.");
      setFile(null);
      setResult(null);
      setMetadata(null);
      setDimensions(null);
      return;
    }

    requestController.current?.abort();
    requestController.current = null;
    setProcessing(false);
    setFile(nextFile);
    setResult(null);
    setMetadata(null);
    setDimensions(null);
    setPreviewUnavailable(false);
    setError("");
  }

  function clearImage() {
    requestController.current?.abort();
    requestController.current = null;
    setProcessing(false);
    setFile(null);
    setResult(null);
    setMetadata(null);
    setDimensions(null);
    setPreviewUnavailable(false);
    setError("");
  }

  async function processImage() {
    if (!file || processing) return;
    const controller = new AbortController();
    requestController.current = controller;
    setProcessing(true);
    setError("");
    setResult(null);
    setMetadata(null);

    const form = new FormData();
    form.append("file", file);
    form.append("method", method);
    form.append("strength", String(strength));
    form.append("margin", "0");

    try {
      const response = await fetch(`${API_BASE_URL}/api/anonymize`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        let detail = `The server could not process this image (HTTP ${response.status}).`;
        try {
          const payload = await response.json();
          if (typeof payload.detail === "string") detail = payload.detail;
        } catch {
          // Keep the status-based message when the API does not return JSON.
        }
        throw new Error(detail);
      }

      const resultBlob = await response.blob();
      if (!resultBlob.type.startsWith("image/")) {
        throw new Error("The server returned an unexpected response. Please try again.");
      }
      setMetadata({
        faceCount: Number(response.headers.get("X-Face-Count") || 0),
        processedFaceCount: Number(response.headers.get("X-Processed-Face-Count") || 0),
        anonymized: response.headers.get("X-Anonymized") === "true",
        method: response.headers.get("X-Anonymization-Method") || method,
        strength: Number(response.headers.get("X-Anonymization-Strength") || strength),
      });
      setResult(resultBlob);
    } catch (requestError) {
      if (requestError.name === "AbortError") return;
      setError(
        requestError instanceof TypeError
          ? `Could not connect to the API at ${API_BASE_URL}. Check that the backend is running and try again.`
          : requestError.message || "Something went wrong while processing the image.",
      );
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setProcessing(false);
      }
    }
  }

  const downloadName = file
    ? `${file.name.replace(/\.[^.]+$/, "") || "image"}-anonymized.png`
    : "anonymized-image.png";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Face Privacy Studio home">
          <span className="brand-mark"><Icon name="shield" size={21} /></span>
          <span>Face Privacy <b>Studio</b></span>
        </a>
        <nav className="mode-switch" aria-label="Anonymization mode">
          <button
            type="button"
            className={mode === "image" ? "mode-selected" : ""}
            aria-pressed={mode === "image"}
            onClick={() => setMode("image")}
          >
            Images
          </button>
          <button
            type="button"
            className={mode === "video" ? "mode-selected" : ""}
            aria-pressed={mode === "video"}
            onClick={() => setMode("video")}
          >
            Live video
          </button>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="eyebrow"><span className="status-dot" /> PRIVATE BY DESIGN</div>
          <h1>{mode === "image" ? <>Your photos.<br /><span>Your privacy.</span></> : <>Your camera.<br /><span>Your privacy.</span></>}</h1>
          <p>
            {mode === "image"
              ? <>Blur or pixelate faces in your images in seconds.<br className="desktop-break" /> Your original image is processed in memory, never stored.</>
              : <>Blur or pixelate faces in a live camera preview.<br className="desktop-break" /> Processed frames are returned from your configured API.</>}
          </p>
        </section>

        {mode === "video" ? <VideoMode /> : <div className="workspace">
          <div className="workflow-column">
            <UploadCard
              file={file}
              imageUrl={imageUrl}
              dimensions={dimensions}
              previewUnavailable={previewUnavailable}
              onChoose={chooseFile}
              onClear={clearImage}
              onPreviewError={(value = true) => setPreviewUnavailable(value)}
              isDragging={isDragging}
              onDragState={setIsDragging}
            />

            <section className="panel controls-panel" aria-labelledby="controls-heading">
              <div className="section-heading">
                <div className="step-number">02</div>
                <div>
                  <h2 id="controls-heading">Choose your style</h2>
                  <p>Set how faces should be anonymized.</p>
                </div>
              </div>

              <div className="method-options" role="radiogroup" aria-label="Anonymization method">
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
                <label htmlFor="strength">Anonymization strength</label>
                <output htmlFor="strength" className="strength-value">{strength}</output>
              </div>
              <input
                id="strength"
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

              {error && <div className="error-message" role="alert"><span>!</span>{error}</div>}

              <button className="button button-primary process-button" type="button" disabled={!file || processing} onClick={processImage}>
                {processing ? <><span className="spinner" /> Processing image…</> : <><Icon name="spark" size={19} /> Anonymize faces</>}
              </button>
              <p className="privacy-note"><Icon name="shield" size={15} /> Images are not stored or used to train models.</p>
            </section>
          </div>

          <section className={`panel result-panel${resultUrl ? " result-ready" : ""}`} aria-labelledby="result-heading">
            <div className="section-heading result-heading">
              <div className="step-number">03</div>
              <div>
                <h2 id="result-heading">Your result</h2>
                <p>{resultUrl ? "Ready to save or use." : "Your anonymized image will appear here."}</p>
              </div>
            </div>

            {resultUrl ? (
              <>
                <div className="result-image-frame">
                  <img src={resultUrl} alt="Anonymized result" />
                  <span className="image-tag result-tag">Anonymized</span>
                </div>
                <div className={`result-summary${metadata?.anonymized ? "" : " summary-no-faces"}`} role="status">
                  <span className="summary-icon"><Icon name={metadata?.anonymized ? "shield" : "image"} size={17} /></span>
                  <div>
                      <strong>{metadata?.anonymized
                        ? `${metadata.processedFaceCount} ${metadata.processedFaceCount === 1 ? "face" : "faces"} anonymized`
                        : metadata?.faceCount > 0
                          ? "Faces detected, but none could be processed"
                          : "No faces detected"}</strong>
                      <span>{metadata?.anonymized
                        ? `${formatMethod(metadata.method)} · strength ${metadata.strength}`
                        : metadata?.faceCount > 0
                          ? "No detected regions overlapped the image; it is unchanged."
                          : "The image is returned unchanged. Try another photo."}</span>
                  </div>
                </div>
                <a className="button button-primary download-button" href={resultUrl} download={downloadName}>
                  <Icon name="download" size={19} /> Download image
                </a>
              </>
            ) : (
              <div className="result-empty">
                <div className="empty-art">
                  <div className="empty-picture"><span className="empty-sun" /><span className="empty-hill hill-one" /><span className="empty-hill hill-two" /></div>
                  <span className="empty-spark spark-one">✦</span>
                  <span className="empty-spark spark-two">✧</span>
                </div>
                <strong>{processing ? "Working on your image" : "A little more privacy, coming up"}</strong>
                <span>{processing ? "Detecting and anonymizing faces…" : "Add a photo and choose a style to get started."}</span>
                {processing && <div className="progress-track"><span /></div>}
              </div>
            )}
          </section>
        </div>}

        {mode === "image" && <section className="how-it-works" id="how-it-works">
          <span className="how-icon"><Icon name="shield" size={19} /></span>
          <div>
            <strong>Private, from start to finish</strong>
            <p>Your image is sent to the configured Face Privacy API (localhost by default). The bundled API does not save uploads. Only use a server you trust. Blur and pixelation help obscure faces but cannot guarantee that someone is unidentifiable.</p>
          </div>
          {metadata && <span className="face-count">{metadata.faceCount} detected</span>}
        </section>}
      </main>

      <footer><span>FACE PRIVACY STUDIO</span><span>Made for a more private internet.</span></footer>
    </div>
  );
}

export default App;
