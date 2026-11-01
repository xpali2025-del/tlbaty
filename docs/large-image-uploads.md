# Large image upload reliability

The reported failure occurs after pressing Save and is more frequent for large
images. It has not been reproduced on the reporter's device or against their R2
bucket. This patch addresses two concrete weaknesses in the shared client path:

- One WebP encode at quality 0.82 had no byte-size target. Even a 4 MB image reduced
  to 3 MB passed the old uncompressed-fallback guard and could still be uploaded.
- PUT used a deadline of 15 seconds plus one second per 40 KB. An 80 KB upload had
  only 17 seconds, even if bytes were still being transferred.

## Changes shared by all admin image forms

Products (main/gallery), categories, ads, slides, brands, reviews, couriers,
notifications, payment-account images and the site logo already call
`uploadFormImages`; no per-screen switch is required.

Compression now tries WebP at qualities 0.82 and 0.72, then reduces dimensions to
75% and 50% of the initial fitted dimensions when necessary. There are at most six
encodes, no cropping or upscaling, and no output larger than the original. Output
sizes are targets, not guarantees:

| Usage | Initial longest edge | Target |
| --- | ---: | ---: |
| Products / ads | 1600 px | 500 KiB |
| Slides | 1920 px | 500 KiB |
| Categories / site logo | 800 px | 250 KiB |
| Brands / couriers | 600 px | 150 KiB |
| Reviews | 400 px | 100 KiB |
| Payment-account images | 400 px | 150 KiB |
| Notifications | 1200 px | 350 KiB |

Images under 200 KiB and AVIF remain unchanged. The existing 20 MiB original-input
limit remains. Any prepared result above 1.5 MiB is rejected with an Arabic
compression message before requesting an upload URL, including results that were
reduced but are still too large. A result between its target and 1.5 MiB may upload.
Only one image is decoded/prepared at a time. Decoded bitmaps, temporary image URLs
and canvas buffers are released. Browsers with missing/rejecting `createImageBitmap`
fall back to an image element. A browser that falls back to PNG encoding retains
the true MIME type, extension and transparency.

Browser PUT now uses XMLHttpRequest upload progress. An attempt aborts after 60
seconds without new uploaded bytes, or after two minutes total. Increasing byte
counts extend the idle deadline, not the total deadline. Sending all bytes does
not mean success: the uploader waits for a successful HTTP response. Five bounded
attempts, existing backoff, offline waiting and permanent HTTP-error handling are
retained. Non-browser environments without XHR use fetch with a two-minute cap.
Retries resend the whole file to the same URL; this is not multipart/resumable
upload. No credentials are attached to the cross-origin request beyond the signed
URL, and Content-Type remains the only explicitly set header.

## Validation and rollout

- Automated coverage includes all ten folders, portrait/aspect-ratio preservation,
  bounded encode steps, browser-decoder fallback and cleanup, PNG MIME fallback,
  still-large-result rejection, slow progress, stalls, repeated byte counts,
  total timeout, HTTP 403, retries and timer/listener cleanup.
- 627 tests passed across 51 files with two test workers. Production build,
  typecheck, bundle budgets and all 13 smoke checks passed. Smoke checks used a
  temporary copy of the existing script with `-H 127.0.0.1` to accommodate the
  execution sandbox. Changed TypeScript files pass lint without warnings.
- Compression/XHR tests simulate browser APIs. A real Chromium run could not be
  completed: the browser was absent and its download returned invalid archives.
  No production latency, image-quality, mobile-memory or R2/CORS result is claimed.

No dependency, database migration, worker or R2 configuration change is included.
This is a separate review from catalog-save PR #50; neither depends on the other.
Before production deployment, test several actual large phone images and a
transparent logo on the affected phone/browser, using a slow upload connection.
Verify resulting dimensions, visual detail and transparency, then a successful
signed PUT followed by a successful entity save. Verify offline recovery and an
explicit storage rejection. Do not publish signed URLs in diagnostic logs.

Persistent CORS, DNS/TLS, expired URLs, signing-action failures, actual loss of
connectivity or browser termination can still cause failures. This patch does not
claim those are the reported cause or solve them by merely lengthening a timeout.
The R2 signed URL still expires after 15 minutes; prolonged offline waits may
require a fresh Save attempt. Existing stored images and ad videos are unchanged.

References: [XHR upload events](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/upload),
[canvas encoding and PNG fallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob).
