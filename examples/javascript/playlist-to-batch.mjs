// List a YouTube playlist, then fetch captions for its videos in one batch.
//
// Cost: 1 credit for the playlist page, plus 1 credit per video that has captions.
//       Videos without captions fail for free (captions_only never starts AI transcription).
// Plan: items per batch are 1 on the free plan, 10 on Starter, 25 on Pro, 50 on Scale.
//       Keep LIMIT at or below your plan's batch size.
// Run:  TRANSCRIPTDOCK_API_KEY=td_live_... node playlist-to-batch.mjs PLAYLIST [LIMIT]
//       PLAYLIST is a playlist id or URL. LIMIT defaults to 5.
// Node 18 or newer. No dependencies.

import { randomUUID } from "node:crypto";

const API = "https://www.transcriptdock.com";
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

// Read a resource every few seconds until isDone(resource) is true.
async function pollUntil(path, isDone, { everyMs = 3000, timeoutMs = 10 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const resource = await api("GET", path);
    if (isDone(resource)) return resource;
    if (Date.now() > deadline) throw new Error(`${path} is still ${resource.status}. Check it again later.`);
    await sleep(everyMs);
  }
}

const [playlist, limitArg] = process.argv.slice(2);
if (!playlist) {
  console.error("Usage: node playlist-to-batch.mjs PLAYLIST [LIMIT]");
  process.exit(2);
}
const limit = Number.parseInt(limitArg ?? "5", 10);

// 1. One page of the playlist (1 credit). next_cursor would fetch the next page.
const queued = await api("POST", "/v1/video-discoveries", {
  idempotencyKey: randomUUID(),
  body: { kind: "youtube_playlist_videos", playlist, limit },
});
const discovery = await pollUntil(`/v1/video-discoveries/${queued.id}`, (d) => d.status === "succeeded" || d.status === "failed");
if (discovery.status === "failed") throw new Error(`Discovery failed: ${discovery.error?.code}`);
console.error(`Found ${discovery.videos.length} video(s). More pages: ${discovery.next_cursor ? "yes" : "no"}`);
if (discovery.videos.length === 0) process.exit(0);

// 2. One batch of caption jobs. The whole batch is accepted or rejected together.
const batchKey = randomUUID(); // save it: resending the same body with it never creates a second batch
console.error(`Idempotency-Key: ${batchKey}`);
const created = await api("POST", "/v1/batches", {
  idempotencyKey: batchKey,
  body: {
    items: discovery.videos.map((video) => ({
      source: { url: video.url },
      mode: "captions_only",
      caption_languages: ["en"],
      max_credits: 1,
    })),
  },
});

// 3. Wait for every item to be final. A webhook (batch.completed) avoids polling.
const finished = new Set(["succeeded", "partial_success", "failed", "cancelled"]);
const batch = await pollUntil(`/v1/batches/${created.id}`, (b) => finished.has(b.status), { everyMs: 5000, timeoutMs: 20 * 60_000 });
console.error(`Batch ${batch.status}: ${batch.succeeded_items} with captions, ${batch.failed_items} without`);

// 4. Print each transcript's opening.
for (const item of batch.items) {
  const video = discovery.videos[item.item_index];
  const job = await api("GET", `/v1/jobs/${item.job_id}`);
  if (job.status !== "succeeded") {
    console.log(`\n# ${video.title ?? video.url}\n(${job.status}: ${job.error?.code ?? ""})`);
    continue;
  }
  const text = await api("GET", `/v1/transcripts/${job.result_id}/export?format=txt`, { text: true });
  console.log(`\n# ${video.title ?? video.url}\n${text.slice(0, 300)}${text.length > 300 ? "..." : ""}`);
}
