// YouTube captions in your preferred languages, printed with timestamps and exported as VTT.
//
// Cost: captions_only spends at most 1 credit, and nothing if the video has no captions.
// Run:  TRANSCRIPTDOCK_API_KEY=td_live_... node captions.mjs [VIDEO_URL] [LANGS] [PREFERENCE]
//       e.g. node captions.mjs "https://youtu.be/dQw4w9WgXcQ" es,en prefer_creator
// Node 18 or newer. No dependencies.

import { randomUUID } from "node:crypto";

const API = "https://www.transcriptdock.com"; // always www: the apex domain redirects
const KEY = process.env.TRANSCRIPTDOCK_API_KEY;
if (!KEY) {
  console.error("Set TRANSCRIPTDOCK_API_KEY to your td_live_ key.");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(method, path, { body, idempotencyKey, text = false } = {}) {
  const headers = { Authorization: `Bearer ${KEY}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      `${res.status} ${data.error?.code ?? "HTTP_ERROR"}: ${data.error?.message ?? res.statusText}` +
        ` (request ${data.request_id ?? res.headers.get("x-request-id")})`,
    );
  }
  return text ? res.text() : res.json();
}

async function waitForJob(id, timeoutMs = 10 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await api("GET", `/v1/jobs/${id}?wait=25`);
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    if (Date.now() > deadline) throw new Error(`Job ${id} is still ${job.status}. Check it again later.`);
    await sleep(1000);
  }
}

// 75.4 -> "1:15"
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

const url = process.argv[2] ?? "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const captionLanguages = (process.argv[3] ?? "en").split(",").filter(Boolean); // up to 5, in order
const captionPreference = process.argv[4] ?? "prefer_creator"; // or creator_only, automatic_only

const idempotencyKey = randomUUID(); // save it: replaying the same body with it costs nothing
console.error(`Idempotency-Key: ${idempotencyKey}`);

const created = await api("POST", "/v1/jobs", {
  idempotencyKey,
  body: {
    source: { url },
    mode: "captions_only",
    caption_languages: captionLanguages,
    caption_preference: captionPreference,
    max_credits: 1, // ignored for captions_only, kept so a switch to auto stays capped
  },
});

const job = await waitForJob(created.id);
if (job.status !== "succeeded") {
  const code = job.error?.code;
  console.error(`Job ${job.status}: ${code} ${job.error?.message ?? ""}`);
  if (code === "LANGUAGE_UNAVAILABLE") console.error("None of those languages exists. Try languages.mjs to list the tracks.");
  if (code === "NO_CAPTIONS") console.error("No captions. See auto-fallback.mjs for AI transcription (paid plans).");
  process.exit(1);
}

const transcript = await api("GET", `/v1/transcripts/${job.result_id}`);
// source_origin: creator_captions, platform_captions (automatic) or speech_recognition
console.error(`${transcript.source_origin}, language ${transcript.language}, ${transcript.segments.length} segments`);

// Times come straight from the transcript, in seconds. Never estimate them.
for (const segment of transcript.segments.slice(0, 10)) {
  console.log(`[${clock(segment.start)}] ${segment.text}`);
}

console.log("\n" + (await api("GET", `/v1/transcripts/${job.result_id}/export?format=vtt`, { text: true })));
