# YouTube API reference (compact)

The YouTube parts of the Transcript Dock `/v1` API on one page. Full reference: [transcriptdock.com/docs/api-reference](https://www.transcriptdock.com/docs/api-reference). Contract: [OpenAPI 3.1](https://www.transcriptdock.com/docs/openapi.yaml). Every source and endpoint: [transcriptdock-api](https://github.com/TranscriptDock/transcriptdock-api).

## Basics

- Base URL `https://www.transcriptdock.com` (always `www`).
- `Authorization: Bearer td_live_...` from the [dashboard](https://www.transcriptdock.com/dashboard).
- `Idempotency-Key` (8 to 128 printable ASCII characters) is required on every POST below. Same key and body replays the original at no cost. A different body is `409 IDEMPOTENCY_CONFLICT`.
- Every response has `X-Request-Id`.

## Accepted links

`youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/shorts/...`, `youtube.com/live/...`. Public videos only. Up to 2 hours.

## Create a job: `POST /v1/jobs`

| Field | Notes |
|---|---|
| `source.url` | The YouTube link |
| `mode` | `captions_only` (1 credit, never AI), `auto` (captions else AI), `transcribe` (AI). AI needs a paid plan. |
| `caption_languages` | Up to 5 BCP 47 codes in order, e.g. `["es","en"]`. Empty means the default track. |
| `caption_preference` | `prefer_creator` (default), `creator_only`, `automatic_only` |
| `language` | Spoken language hint for AI transcription only |
| `max_credits` | AI spend cap. 2 credits per started minute, 60 second minimum. Ignored for `captions_only`. |
| `webhook_endpoint_id` | Receives `job.succeeded` or `job.failed` |
| `metadata` | Up to 10 string values, echoed in webhooks |

Returns `202` (queued) or `200` (already in your workspace, `billing.kind: "cached"`, free).

## Wait: `GET /v1/jobs/{id}?wait=25`

Holds up to 25 seconds and returns when `status` is `succeeded`, `failed` or `cancelled`. `result_id` is the transcript id. `error` has `code`, `message`, `retryable`. `billing` has `credits_reserved`, `credits_charged`, `kind`.

## Transcript: `GET /v1/transcripts/{id}`

`text`, `segments` (`start`, `end` seconds, `text`), `words` (AI only), `timing_granularity` (`segment` for captions, `word` for AI), `source_origin` (`creator_captions`, `platform_captions`, `speech_recognition`), `language`, `duration_seconds`, `recognition`, `created_at`.

Export: `GET /v1/transcripts/{id}/export?format=txt|json|srt|vtt`. Free and repeatable.

## Caption languages: `POST /v1/language-discoveries`

Body `{"source":{"url":"https://www.youtube.com/watch?v=..."}}`. 1 credit. Read `GET /v1/language-discoveries/{id}` until `status` is `succeeded` or `failed`.

Result: `languages[]` with `code`, `display_name`, `native_name`, `origin` (`creator` or `automatic`), `is_original`, `is_default`, `timed_text`; plus `default_language`, `original_language`, `expires_at`.

## Find videos: `POST /v1/video-discoveries`

| `kind` | Fields |
|---|---|
| `youtube_search` | `query` (1 to 200 characters) |
| `youtube_channel_videos` | `channel`: `@handle`, channel id or URL |
| `youtube_channel_search` | `channel` and `query` |
| `youtube_playlist_videos` | `playlist`: id or URL |

Common: `limit` 1 to 50 (default 20), `cursor` from the previous `next_cursor`. 1 credit per page. Read `GET /v1/video-discoveries/{id}` until `status` is `succeeded` or `failed`. Results are kept 24 hours.

Each video: `platform`, `video_id`, `url`, `title`, `channel_id`, `channel_title`, `duration_s`, `published_at`, `published_text`, `view_count`, `view_count_text`, `thumbnail_url`. YouTube listings carry relative publish and view text, with exact counts only when YouTube gives them.

## Batches: `POST /v1/batches`

`items`: an array of job bodies. Items per batch: 1 free, 10 Starter, 25 Pro, 50 Scale. Accepted or rejected as a whole. `GET /v1/batches/{id}` returns `status` (`queued`, `processing`, `succeeded`, `partial_success`, `failed`, `cancelled`), counters and `items` with each `job_id`.

## Errors you will meet on YouTube

| Code | HTTP | Meaning |
|---|---|---|
| `NO_CAPTIONS` | 422 | No captions and the mode was `captions_only`. Free. |
| `LANGUAGE_UNAVAILABLE` | 422 | None of `caption_languages` exists on the video. |
| `SOURCE_PRIVATE` / `SOURCE_AUTH_REQUIRED` / `SOURCE_REGION_RESTRICTED` / `SOURCE_NOT_FOUND` | 422 | The video is not publicly reachable. |
| `PLAN_REQUIRED` | 402 | AI transcription or a larger batch on the free plan. |
| `BUDGET_EXCEEDED` | 402 | Measured cost above `max_credits`. Nothing charged. |
| `INVALID_CURSOR` | 422 | A discovery cursor expired. Start again. |
| `RATE_LIMITED` | 429 | Wait `Retry-After`. |

Every code: [error list](https://www.transcriptdock.com/docs/api-reference#error-codes).
