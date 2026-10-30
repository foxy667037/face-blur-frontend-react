// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import VideoMode from "./VideoMode.jsx";

const sockets = [];
const processedBitmap = { close: vi.fn() };
const mediaRecorders = [];
const recordingUrls = [];

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static closeBeforeOpen = false;

  constructor(url) {
    this.url = url;
    this.readyState = WebSocket.CONNECTING;
    this.listeners = new Map();
    this.sent = [];
    this.pendingMetadata = null;
    sockets.push(this);
    queueMicrotask(() => {
      if (MockWebSocket.closeBeforeOpen) {
        this.close();
        return;
      }
      this.readyState = WebSocket.OPEN;
      this.dispatch("open");
    });
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ type, ...event });
    }
  }

  send(data) {
    this.sent.push(data);
    if (typeof data === "string") {
      this.pendingMetadata = JSON.parse(data);
      return;
    }

    const request = this.pendingMetadata;
    queueMicrotask(() => {
      this.dispatch("message", {
        data: JSON.stringify({
          type: "frame_result",
          sequence: request.sequence,
          width: 640,
          height: 360,
          face_count: 1,
          processed_face_count: 1,
          anonymized: true,
          method: request.method,
          strength: request.strength,
          processing_ms: 24,
        }),
      });
      this.dispatch("message", {
        data: new Blob(["processed"], { type: "image/jpeg" }),
      });
    });
  }

  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.dispatch("close");
  }
}

class MockMediaRecorder {
  static supportedTypes = new Set(["video/webm;codecs=vp8", "video/webm"]);

  static isTypeSupported(mimeType) {
    return MockMediaRecorder.supportedTypes.has(mimeType);
  }

  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = options.mimeType;
    this.state = "inactive";
    this.ondataavailable = null;
    this.onerror = null;
    this.onstop = null;
    mediaRecorders.push(this);
  }

  start(timeslice) {
    this.timeslice = timeslice;
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") throw new Error("Recorder is inactive");
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["final processed frame"], { type: this.mimeType }),
    });
    queueMicrotask(() => this.onstop?.());
  }
}

describe("VideoMode", () => {
  let track;
  let context;
  let outputContext;
  let stream;
  let recordingTrack;
  let recordingStream;
  let previewCanvas;

  beforeEach(() => {
    sockets.length = 0;
    mediaRecorders.length = 0;
    recordingUrls.length = 0;
    MockWebSocket.closeBeforeOpen = false;
    MockMediaRecorder.supportedTypes = new Set([
      "video/webm;codecs=vp8",
      "video/webm",
    ]);
    track = { stop: vi.fn() };
    stream = { getTracks: () => [track] };
    recordingTrack = { stop: vi.fn(), kind: "video" };
    recordingStream = {
      getTracks: () => [recordingTrack],
      getVideoTracks: () => [recordingTrack],
    };
    context = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
    };
    outputContext = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
    };

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
      configurable: true,
      get: () => 640,
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
      configurable: true,
      get: () => 360,
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContext() {
      return this === previewCanvas ? outputContext : context;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["camera"], { type: "image/jpeg" }));
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: function captureStream(frameRate) {
        expect(this).toBe(previewCanvas);
        expect(frameRate).toBe(5);
        expect(this.width).toBe(640);
        expect(this.height).toBe(360);
        return recordingStream;
      },
    });
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(processedBitmap));
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);
    class MockURL extends URL {}
    MockURL.createObjectURL = vi.fn((blob) => {
      const url = `blob:recording-${recordingUrls.length + 1}`;
      recordingUrls.push({ url, blob });
      return url;
    });
    MockURL.revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", MockURL);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete HTMLCanvasElement.prototype.captureStream;
  });

  async function startVideo() {
    previewCanvas = screen.getByLabelText("Anonymized video output");
    fireEvent.click(screen.getByRole("button", { name: "Start Camera" }));
    await screen.findByText("1", { selector: ".video-stats strong" });
  }

  it("sends one frame over the socket and displays only the returned processed frame", async () => {
    render(<VideoMode />);
    await startVideo();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe("ws://127.0.0.1:8000/api/video/ws");
    expect(sockets[0].sent).toHaveLength(2);
    expect(JSON.parse(sockets[0].sent[0])).toMatchObject({
      type: "frame",
      sequence: 0,
      method: "blur",
      strength: 15,
    });
    expect(sockets[0].sent[1]).toBeInstanceOf(Blob);
    expect(outputContext.drawImage).toHaveBeenCalledWith(
      processedBitmap,
      0,
      0,
      640,
      360,
    );

    fireEvent.click(screen.getByRole("radio", { name: /Pixelation/ }));
    await waitFor(() => expect(sockets[0].sent).toHaveLength(4));
    expect(JSON.parse(sockets[0].sent[2])).toMatchObject({
      sequence: 1,
      method: "pixelate",
      strength: 15,
    });

    fireEvent.click(screen.getByRole("button", { name: "Stop Camera" }));
    await waitFor(() => {
      expect(track.stop).toHaveBeenCalledOnce();
      expect(sockets[0].readyState).toBe(WebSocket.CLOSED);
    });
  });

  it("stops the camera and closes the socket when the component unmounts", async () => {
    const { unmount } = render(<VideoMode />);
    await startVideo();

    unmount();

    expect(track.stop).toHaveBeenCalledOnce();
    expect(sockets[0].readyState).toBe(WebSocket.CLOSED);
  });

  it("reports a socket closed before opening and releases the camera", async () => {
    MockWebSocket.closeBeforeOpen = true;
    render(<VideoMode />);

    fireEvent.click(screen.getByRole("button", { name: "Start Camera" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The video-processing connection was closed.");
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("does not start until a processed frame is available", () => {
    render(<VideoMode />);

    expect(screen.getByRole("button", { name: "Start Recording" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Start Recording" }));

    expect(mediaRecorders).toHaveLength(0);
  });

  it("records only the processed canvas and finalizes its final chunk for preview and download", async () => {
    render(<VideoMode />);
    await startVideo();

    fireEvent.click(screen.getByRole("button", { name: "Start Recording" }));

    expect(mediaRecorders).toHaveLength(1);
    expect(mediaRecorders[0].stream).toBe(recordingStream);
    expect(mediaRecorders[0].stream).not.toBe(stream);
    expect(mediaRecorders[0].mimeType).toBe("video/webm;codecs=vp8");
    expect(mediaRecorders[0].timeslice).toBe(1000);
    expect(outputContext.drawImage).toHaveBeenCalledWith(
      processedBitmap,
      0,
      0,
      640,
      360,
    );
    expect(screen.getByText("Recording", { selector: ".recording-state strong" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stop Recording" }));
    const preview = await screen.findByLabelText("Recorded anonymized video preview");
    const download = screen.getByRole("link", { name: "Download Video" });
    expect(preview.getAttribute("src")).toBe(download.getAttribute("href"));
    expect(download.getAttribute("download")).toMatch(
      /^anonymized-video-\d{4}-\d{2}-\d{2}-\d{6}\.webm$/,
    );
    expect(recordingUrls[0].blob.type).toBe("video/webm;codecs=vp8");
    expect(recordingUrls[0].blob.size).toBeGreaterThan(0);
    expect(await recordingUrls[0].blob.text()).toBe("final processed frame");
    expect(await screen.findByText("Ready", { selector: ".recording-state strong" })).toBeTruthy();
    expect(recordingTrack.stop).toHaveBeenCalledOnce();
  });

  it("shows an actionable error when WebM recording is unsupported", async () => {
    MockMediaRecorder.supportedTypes = new Set();
    render(<VideoMode />);
    await startVideo();

    fireEvent.click(screen.getByRole("button", { name: "Start Recording" }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((alert) => alert.textContent.includes(
      "This browser does not support WebM video recording.",
    ))).toBe(true);
    expect(mediaRecorders).toHaveLength(0);
    expect(recordingTrack.stop).not.toHaveBeenCalled();
  });

  it("stops recording on processing failure without using the raw camera stream", async () => {
    render(<VideoMode />);
    await startVideo();
    fireEvent.click(screen.getByRole("button", { name: "Start Recording" }));

    sockets[0].close();

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((alert) => alert.textContent.includes(
      "The video-processing connection was closed.",
    ))).toBe(true);
    expect(mediaRecorders[0].stream).toBe(recordingStream);
    expect(mediaRecorders[0].stream).not.toBe(stream);
    expect(recordingTrack.stop).toHaveBeenCalledOnce();
    expect(await screen.findByText("Ready", { selector: ".recording-state strong" })).toBeTruthy();
    expect(screen.getByText(/Recording finalized because video processing stopped/)).toBeTruthy();
    expect(outputContext.drawImage).toHaveBeenCalledTimes(1);
    expect(outputContext.drawImage.mock.calls[0][0]).toBe(processedBitmap);
  });

  it("revokes replaced and discarded recording URLs across repeated sessions", async () => {
    render(<VideoMode />);
    await startVideo();

    fireEvent.click(screen.getByRole("button", { name: "Start Recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop Recording" }));
    await screen.findByRole("link", { name: "Download Video" });
    const firstUrl = recordingUrls[0].url;

    fireEvent.click(screen.getByRole("button", { name: "Start Recording" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
    fireEvent.click(screen.getByRole("button", { name: "Stop Recording" }));
    await waitFor(() => expect(recordingUrls).toHaveLength(2));
    const secondUrl = recordingUrls[1].url;

    fireEvent.click(screen.getByRole("button", { name: "Discard Recording" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(secondUrl);
    expect(screen.queryByRole("link", { name: "Download Video" })).toBeNull();
    expect(screen.queryByLabelText("Recorded anonymized video preview")).toBeNull();
  });

  it("releases a finalized recording URL when the component unmounts", async () => {
    const { unmount } = render(<VideoMode />);
    await startVideo();
    fireEvent.click(screen.getByRole("button", { name: "Start Recording" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop Recording" }));
    await screen.findByRole("link", { name: "Download Video" });
    const url = recordingUrls[0].url;

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(recordingTrack.stop).toHaveBeenCalledOnce();
  });
});
