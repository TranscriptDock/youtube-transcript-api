// List a YouTube video's caption tracks, then fetch the transcript in one of them.
//
// Cost: 1 credit for the language discovery, then at most 1 credit for the captions.
// Run:  TRANSCRIPTDOCK_API_KEY=td_live_... node languages.mjs VIDEO_URL [LANGUAGE_CODE]
//       Without LANGUAGE_CODE it only lists the tracks (1 credit).
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

async function waitForJob(id, timeoutMs = 10 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await api("GET", `/v1/jobs/${id}?wait=25`);
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    if (Date.now() > deadline) throw new Error(`Job ${id} is still ${job.status}. Check it again later.`);
    await sleep(1000);
  }
}

const [url, wanted] = process.argv.slice(2);
if (!url) {
  console.error("Usage: node languages.mjs VIDEO_URL [LANGUAGE_CODE]");
  process.exit(2);
}

// 1. Queue the language discovery. It runs in the background like a job.
let discovery = await api("POST", "/v1/language-discoveries", {
  idempotencyKey: randomUUID(),
  body: { source: { url } },
});

// 2. Read it until it is final. Discoveries have no long poll, so wait a little between reads.
const deadline = Date.now() + 2 * 60_000;
while (discovery.status === "queued" || discovery.status === "processing") {
  if (Date.now() > deadline) throw new Error(`Discovery ${discovery.id} is still ${discovery.status}.`);
  await sleep(2000);
  discovery = await api("GET", `/v1/language-discoveries/${discovery.id}`);
}
if (discovery.status !== "succeeded") {
  console.error(`Discovery failed: ${discovery.error?.code} ${discovery.error?.message ?? ""}`);
  process.exit(1);
}

console.log(`Default ${discovery.default_language ?? "none"}, original ${discovery.original_language ?? "unknown"}`);
for (const lang of discovery.languages) {
  const flags = [lang.origin, lang.is_default && "default", lang.is_original && "original"].filter(Boolean).join(", ");
  console.log(`${lang.code.padEnd(10)} ${lang.display_name} (${flags})`);
}
if (!wanted) process.exit(0);

// 3. Fetch the captions in the chosen track. origin "automatic" means YouTube's automatic captions.
const track = discovery.languages.find((lang) => lang.code === wanted);
if (!track) {
  console.error(`No ${wanted} track on this video.`);
  process.exit(1);
}

const created = await api("POST", "/v1/jobs", {
  idempotencyKey: randomUUID(),
  body: {
    source: { url },
    mode: "captions_only",
    caption_languages: [wanted],
    caption_preference: track.origin === "automatic" ? "automatic_only" : "creator_only",
    max_credits: 1,
  },
});
const job = await waitForJob(created.id);
if (job.status !== "succeeded") {
  console.error(`Job ${job.status}: ${job.error?.code}`);
  process.exit(1);
}
console.log("\n" + (await api("GET", `/v1/transcripts/${job.result_id}/export?format=txt`, { text: true })));
