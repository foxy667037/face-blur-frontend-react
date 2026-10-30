# Face Privacy Studio

React and Vite frontend for the Face Anonymization API.

## Run locally

Start the backend from `backend/` as described in its README, then open a
second PowerShell terminal:

```powershell
cd ..\frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal (normally
<http://localhost:5173>). The backend allows this development origin by
default.

The API defaults to `http://127.0.0.1:8000`. To use another API origin, set
`VITE_API_BASE_URL` in a local `.env` file, for example:

```text
VITE_API_BASE_URL=http://127.0.0.1:8000
```

The value is the API origin only; the frontend adds `/api/anonymize`.
By default, images are sent to the API running on your own machine. If you
override this with a remote origin, the selected image is sent to that server;
only use an API you trust.

## Image handling

The browser checks supported file extensions and the 10 MiB upload limit
before sending. The backend remains authoritative for validation. Image
previews use temporary browser object URLs; the source image is not uploaded
until processing starts. The API returns a PNG, and its metadata headers
populate the result summary. Temporary preview and result URLs are revoked
when replaced or when the page is closed.

Supported upload formats are JPEG, PNG, BMP, WebP, and TIFF. Whether an image
can be previewed before processing depends on the browser's built-in image
decoder; files without a local preview can still be submitted to the API.
The bundled FastAPI backend processes uploads in memory and does not save
them.

## Live video

Select **Live video** and then **Enable camera** to request browser camera
permission. The page captures at no more than 640 x 360 and targets 5 frames
per second. Frames are sent sequentially over one persistent WebSocket to
`/api/video/ws` on the configured API origin. The returned, processed frames
are drawn in the preview; the original camera feed is never presented as the
anonymized result. Blur/pixelation settings can be changed while connected.

The browser processes at most one frame at a time and does not queue stale
frames. **Disable camera** or leaving video mode closes the connection and
stops every camera track. If processing fails, the processed preview is
cleared and the camera session stops; source frames are not used as a
fallback. Frames remain in memory and are sent only to the configured API.
Use only a trusted API origin. YuNet can miss faces, and zero reported
detections do not establish that a frame contains no face.

Recording and video download are not implemented yet. The next milestone will
record only processed canvas output.

## Checks

Run the mocked React connection/cleanup tests and production build with:

```powershell
npm test
npm run build
```

The frontend tests mock camera access, WebSocket responses, and processed
frame decoding. They verify the frame protocol, processed-only rendering,
blur/pixelation settings, and camera/socket cleanup; they are not a physical
camera or YuNet integration test.
