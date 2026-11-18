---
name: youtube-transcript-api
description: Get YouTube transcripts, captions and subtitles (creator or automatic, in a chosen language) with the Transcript Dock HTTP API, list a video's caption languages, and find videos by search, channel or playlist. Use when the user shares a YouTube link or asks what a YouTube video, Short, channel or playlist says, or wants SRT or VTT subtitles. Spends the user's credits, so follow the cost rules.
---

# YouTube transcripts with Transcript Dock

Every transcript is an asynchronous job: submit, wait, then read or export. Full reference: https://www.transcriptdock.com/docs/api-reference

## When to use

- A YouTube link (`watch?v=`, `youtu.be/`, `/shorts/`, `/live/`) and a request for its transcript, captions, subtitles, quotes or a summary.
- "Which languages does this video have captions in?"
- "Find videos about X" or "transcribe the latest videos on this channel or playlist".

Not for private, members only or age gated videos (they fail), translation (not offered) or speaker labels (not offered).

## Setup

- Base URL `https://www.transcriptdock.com`. Always `www`: the apex redirects and drops the `Authorization` header.
- Header `Authorization: Bearer $TRANSCRIPTDOCK_API_KEY` from the environment. Never print the key, put it in a URL or ask for it in chat. If it is missing, tell the user to create one at https://www.transcriptdock.com/dashboard.
- POST bodies are JSON with `Content-Type: application/json`.

## Step 1. Check the plan (free)

`GET /v1/capabilities` (with the key) shows `youtube.captions_only`, `youtube.auto` and `youtube.transcribe` for this plan. `GET /v1/usage` shows `plan` and `credits_remaining`. The free plan has captions only.

## Step 2. Submit captions first

```bash
KEY_ID="$(uuidgen 2>/dev/null || date +%s%N)"   # generate ONCE per intended job and remember it
curl -sS -X POST https://www.transcriptdock.com/v1/jobs \
  -H "Authorization: Bearer $TRANSCRIPTDOCK_API_KEY" \
  -H "Idempotency-Key: $KEY_ID" \
  -H "Content-Type: application/json" \
  -d '{"source":{"url":"VIDEO_URL"},"mode":"captions_only","caption_languages":["en"],"caption_preference":"prefer_creator","max_credits":1}'
```

- `captions_only` costs 1 credit on success and 0 when there are no captions. Always start here.
- `caption_languages`: up to 5 codes in order of preference. Omit or send `[]` for the video's default track.
- `caption_preference`: `prefer_creator` (default), `creator_only` or `automatic_only` (YouTube's automatic captions).
- If the user asks for a language and you do not know whether a track exists, run a language discovery first (1 credit, see below) or tell the user it may fail with `LANGUAGE_UNAVAILABLE`.
- `Idempotency-Key` is required. If a response is lost, resend the SAME body with the SAME key. Never retry with a new key.
- Always send `max_credits`. It is ignored for `captions_only` and protects you if the mode changes.
- A `200` instead of `202` means the workspace already had this result, at no cost.

## Step 3. Wait (free)

`GET /v1/jobs/{id}?wait=25` holds up to 25 seconds and returns when the job is final. Repeat until `status` is `succeeded`, `failed` or `cancelled`. Stop after about 10 minutes and give the user the job id. Reads are limited to 120 a minute, so never poll in a tight loop.

## Step 4. Read or export (free)

- `GET /v1/transcripts/{result_id}`: `text`, `segments` (`start`, `end` in seconds, `text`), `words` (AI only), `timing_granularity`, `source_origin` (`creator_captions`, `platform_captions`, `speech_recognition`), `language`.
- `GET /v1/transcripts/{result_id}/export?format=txt|json|srt|vtt`.

## When there are no captions

If the job fails with `NO_CAPTIONS`, nothing was charged. STOP and ask the user before AI transcription:

- It costs 2 credits per started minute, minimum 2 credits. A 12 minute video is 24 credits.
- It needs a paid plan.
- It returns word timing.

Only on a clear yes, submit a NEW job with `"mode":"auto"` (or `"transcribe"`), a NEW idempotency key and `max_credits` set to the estimate. If it fails with `BUDGET_EXCEEDED`, nothing was charged: ask before raising the cap.

## Caption languages (1 credit)

```bash
curl -sS -X POST https://www.transcriptdock.com/v1/language-discoveries \
  -H "Authorization: Bearer $TRANSCRIPTDOCK_API_KEY" -H "Idempotency-Key: $KEY_ID" \
  -H "Content-Type: application/json" -d '{"source":{"url":"VIDEO_URL"}}'
```

Then `GET /v1/language-discoveries/{id}` every 2 seconds until `status` is `succeeded` or `failed`. `languages[]` has `code`, `display_name`, `origin` (`creator` or `automatic`), `is_default` and `is_original`. Use the codes in `caption_languages`.

## Finding videos (1 credit per page)

`POST /v1/video-discoveries` with an idempotency key and one of:

- `{"kind":"youtube_search","query":"...","limit":10}`
- `{"kind":"youtube_channel_videos","channel":"@handle","limit":10}`
- `{"kind":"youtube_channel_search","channel":"@handle","query":"...","limit":10}`
- `{"kind":"youtube_playlist_videos","playlist":"PL...","limit":20}`

Then `GET /v1/video-discoveries/{id}` until `succeeded`. Each video has `url`, `title`, `channel_title`, `duration_s`, `published_text`, `view_count`. Pass `next_cursor` as `cursor` for another page, but tell the user each page costs 1 credit. Use the `url` values for jobs or a batch (`POST /v1/batches` with `items`; 1 item on the free plan, 10 Starter, 25 Pro, 50 Scale). Show the user the list and the total cost before transcribing many videos.

## Errors

| Code | What to do |
|---|---|
| `NO_CAPTIONS` | Ask before AI transcription (above). |
| `LANGUAGE_UNAVAILABLE` | Run a language discovery or drop `caption_languages`. |
| `PLAN_REQUIRED` | AI transcription and larger batches need a paid plan. |
| `INSUFFICIENT_BALANCE` | Out of credits. Do not retry. |
| `BUDGET_EXCEEDED` | Over `max_credits`, nothing charged. Ask before raising. |
| `SOURCE_PRIVATE`, `SOURCE_NOT_FOUND`, `SOURCE_AUTH_REQUIRED`, `SOURCE_REGION_RESTRICTED` | Not publicly reachable. Tell the user. Never try to bypass. |
| `INVALID_CURSOR` | The discovery cursor expired. Start from the first page. |
| `RATE_LIMITED` | Wait `retry_after_seconds`, then resend with the same idempotency key. |
| `retryable: true` | Back off and resend with the same key, a few times at most. |
| `retryable: false` | Do not retry unchanged. Explain and quote `request_id`. |

## Never invent timestamps

- Quote times only from `segments[].start` and `end` (or `words[]`) of the transcript you fetched. They are seconds: 75.4 is 1:15.
- Caption timing is per cue. Do not present it as word level timing.
- If `timing_granularity` is `none`, say there is no timing.
- Quote text exactly. If something is not in the transcript, say so instead of guessing.
- A YouTube link with `&t=` is fine to build from a real `start` value: `https://www.youtube.com/watch?v=ID&t=75s`.
