// mode "auto": captions when the video has them, AI transcription when it does not.
//
// Cost: 1 credit with captions. Otherwise AI transcription at 2 credits per started minute,
//       60 second minimum. MAX_CREDITS (default 20) caps it: 20 covers up to 10 minutes.
//       Longer videos fail with BUDGET_EXCEEDED and nothing is charged. Paid plans only.
// Run:  TRANSCRIPTDOCK_API_KEY=td_live_... node auto-fallback.mjs VIDEO_URL [MAX_CREDITS]
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
    const error = new Error(
      `${res.status} ${data.error?.code ?? "HTTP_ERROR"}: ${data.error?.message ?? res.statusText}` +
        ` (request ${data.request_id ?? res.headers.get("x-request-id")})`,
    );
    error.code = data.error?.code;
    throw error;
  }
  return text ? res.text() : res.json();
}

async function waitForJob(id, timeoutMs = 30 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await api("GET", `/v1/jobs/${id}?wait=25`);
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    if (Date.now() > deadline) throw new Error(`Job ${id} is still ${job.status}. Check it again later.`);
    await sleep(1000);
  }
}

const [url, maxArg] = process.argv.slice(2);
if (!url) {
  console.error("Usage: node auto-fallback.mjs VIDEO_URL [MAX_CREDITS]");
  process.exit(2);
}
const maxCredits = Number.parseInt(maxArg ?? "20", 10);
console.error(`Cap: ${maxCredits} credits, so AI transcription up to ${maxCredits / 2} minutes.`);

// Optional: confirm this key's plan allows auto for YouTube before spending anything.
const capabilities = await api("GET", "/v1/capabilities");
if (!capabilities.youtube.auto) {
  console.error("auto is not available on this plan. AI transcription needs a paid plan.");
  process.exit(1);
}

const idempotencyKey = randomUUID();
console.error(`Idempotency-Key: ${idempotencyKey}`);
const created = await api("POST", "/v1/jobs", {
  idempotencyKey,
  body: { source: { url }, mode: "auto", max_credits: maxCredits },
});

const job = await waitForJob(created.id);
if (job.status !== "succeeded") {
  console.error(`Job ${job.status}: ${job.error?.code} ${job.error?.message ?? ""}`);
  if (job.error?.code === "BUDGET_EXCEEDED") console.error("The video is longer than the cap allows. Nothing was charged.");
  process.exit(1);
}

const transcript = await api("GET", `/v1/transcripts/${job.result_id}`);
// billing.kind: captions (1 credit), ai_transcription (per minute) or cached (free).
console.error(
  `Paid for ${job.billing.kind}: ${job.billing.credits_charged} credit(s).` +
    ` Timing: ${transcript.timing_granularity}. Origin: ${transcript.source_origin}.`,
);
console.log(await api("GET", `/v1/transcripts/${job.result_id}/export?format=srt`, { text: true }));
