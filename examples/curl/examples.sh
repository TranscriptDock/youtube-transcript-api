#!/usr/bin/env bash
# Transcript Dock YouTube examples with cURL.
#
# Usage:
#   export TRANSCRIPTDOCK_API_KEY="td_live_..."
#   bash examples.sh help
#
# Each command is one API call. Commands that create jobs or discoveries spend
# real credits; the cost is written next to each one. Nothing runs unless you
# name a command.
#
# Needs: bash, curl. The "wait" command also needs jq.

set -euo pipefail

API="https://www.transcriptdock.com" # always www: the apex domain redirects

# A fresh idempotency key. Set IDEMPOTENCY_KEY yourself to replay a request
# whose response you lost: same key and same body returns the original job.
new_key() {
  if [ -n "${IDEMPOTENCY_KEY:-}" ]; then
    printf '%s' "$IDEMPOTENCY_KEY"
  elif command -v uuidgen >/dev/null 2>&1; then
    uuidgen
  elif [ -r /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  else
    printf 'td-%s-%s%s' "$(date +%s)" "$RANDOM" "$RANDOM"
  fi
}

need_key() {
  : "${TRANSCRIPTDOCK_API_KEY:?Set TRANSCRIPTDOCK_API_KEY to your td_live_ key}"
}

# Refuse values that would break the hand written JSON bodies below.
safe() {
  case "$1" in
    *'"'* | *'\'* ) echo "Refusing a value with quotes or backslashes: $1" >&2; exit 2 ;;
  esac
  printf '%s' "$1"
}

# GET with the API key. --fail-with-body prints the error envelope on 4xx/5xx.
get() {
  need_key
  curl -sS --fail-with-body \
    -H "Authorization: Bearer $TRANSCRIPTDOCK_API_KEY" \
    "$API$1"
}

# POST JSON with the API key and an idempotency key (printed to stderr so you can save it).
post() {
  need_key
  local key
  key="$(new_key)"
  echo "Idempotency-Key: $key" >&2
  curl -sS --fail-with-body -X POST \
    -H "Authorization: Bearer $TRANSCRIPTDOCK_API_KEY" \
    -H "Idempotency-Key: $key" \
    -H "Content-Type: application/json" \
    -d "$2" \
    "$API$1"
}

# Accept only a positive whole number (used for max_credits and limits).
num() {
  case "$1" in
    '' | *[!0-9]* | 0) echo "Expected a positive whole number, got: $1" >&2; exit 2 ;;
  esac
  printf '%s' "$1"
}

need_jq() {
  command -v jq >/dev/null 2>&1 || { echo "This command needs jq." >&2; exit 2; }
}

# "es,en" -> ["es","en"]
json_list() {
  local out="" item
  IFS=',' read -r -a parts <<< "$1"
  for item in "${parts[@]}"; do
    [ -n "$item" ] && out="$out\"$(safe "$item")\","
  done
  printf '[%s]' "${out%,}"
}

usage() {
  cat <<'EOF'
Commands (cost in brackets):

  capabilities                      What the API supports. No key needed. [free]
  usage                             Your plan and credit balance. [free]
  captions URL [LANGS]              Captions, e.g. LANGS=es,en in order of preference.
                                    CAPTION_PREFERENCE=prefer_creator|creator_only|automatic_only. [1 credit, 0 if none]
  languages URL                     List the video's caption tracks. [1 credit]
  language-result ID                Read a language discovery. [free]
  search QUERY [LIMIT]              Search YouTube. [1 credit per page]
  channel CHANNEL [LIMIT]           A channel's videos (@handle, id or URL). [1 credit per page]
  channel-search CHANNEL QUERY [L]  Search inside one channel. [1 credit per page]
  playlist PLAYLIST [LIMIT] [CURSOR] A playlist's videos (id or URL). [1 credit per page]
  discovery ID                      Read a video discovery. [free]
  batch URL [URL...]                Captions for several videos in one request. [1 per item with captions]
  auto URL [MAX_CREDITS]            Captions, else AI transcription. Paid plans. Default cap 20 (10 minutes). [<= MAX_CREDITS]
  job JOB_ID                        Read a job once. [free]
  wait JOB_ID                       Long poll until the job is final (needs jq). [free]
  transcript RESULT_ID              The transcript as JSON. [free]
  export RESULT_ID FORMAT           txt, json, srt or vtt. [free]
EOF
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  capabilities)
    if [ -n "${TRANSCRIPTDOCK_API_KEY:-}" ]; then get "/v1/capabilities"; else curl -sS --fail-with-body "$API/v1/capabilities"; fi
    ;;

  usage)
    get "/v1/usage"
    ;;

  captions)
    # captions_only never starts AI transcription. It fails with NO_CAPTIONS (free)
    # when the video has none, or LANGUAGE_UNAVAILABLE when none of LANGS exists.
    url="$(safe "${1:?URL required}")"
    langs="$(json_list "${2:-}")"
    pref="$(safe "${CAPTION_PREFERENCE:-prefer_creator}")"
    post "/v1/jobs" "{\"source\":{\"url\":\"$url\"},\"mode\":\"captions_only\",\"caption_languages\":$langs,\"caption_preference\":\"$pref\",\"max_credits\":1}"
    ;;

  languages)
    # Returns 202 with a discovery id. Read it with: language-result ID
    url="$(safe "${1:?URL required}")"
    post "/v1/language-discoveries" "{\"source\":{\"url\":\"$url\"}}"
    ;;

  language-result)
    get "/v1/language-discoveries/${1:?ID required}"
    ;;

  search)
    query="$(safe "${1:?QUERY required}")"
    limit="$(num "${2:-10}")"
    post "/v1/video-discoveries" "{\"kind\":\"youtube_search\",\"query\":\"$query\",\"limit\":$limit}"
    ;;

  channel)
    channel="$(safe "${1:?CHANNEL required}")"
    limit="$(num "${2:-10}")"
    post "/v1/video-discoveries" "{\"kind\":\"youtube_channel_videos\",\"channel\":\"$channel\",\"limit\":$limit}"
    ;;

  channel-search)
    channel="$(safe "${1:?CHANNEL required}")"
    query="$(safe "${2:?QUERY required}")"
    limit="$(num "${3:-10}")"
    post "/v1/video-discoveries" "{\"kind\":\"youtube_channel_search\",\"channel\":\"$channel\",\"query\":\"$query\",\"limit\":$limit}"
    ;;

  playlist)
    # Pass the previous result's next_cursor as CURSOR for the next page.
    playlist="$(safe "${1:?PLAYLIST required}")"
    limit="$(num "${2:-20}")"
    cursor=""
    if [ -n "${3:-}" ]; then cursor=",\"cursor\":\"$(safe "$3")\""; fi
    post "/v1/video-discoveries" "{\"kind\":\"youtube_playlist_videos\",\"playlist\":\"$playlist\",\"limit\":$limit$cursor}"
    ;;

  discovery)
    get "/v1/video-discoveries/${1:?ID required}"
    ;;

  batch)
    # Items per batch: 1 on the free plan, 10 Starter, 25 Pro, 50 Scale.
    [ "$#" -ge 1 ] || { echo "batch needs at least one URL" >&2; exit 2; }
    items=""
    for u in "$@"; do
      u="$(safe "$u")"
      items="$items{\"source\":{\"url\":\"$u\"},\"mode\":\"captions_only\",\"max_credits\":1},"
    done
    post "/v1/batches" "{\"items\":[${items%,}]}"
    ;;

  auto)
    # 1 credit when captions exist. Otherwise AI transcription at 2 credits per
    # started minute, 60 second minimum. Above the cap: BUDGET_EXCEEDED, nothing charged.
    url="$(safe "${1:?URL required}")"
    max="$(num "${2:-20}")"
    post "/v1/jobs" "{\"source\":{\"url\":\"$url\"},\"mode\":\"auto\",\"max_credits\":$max}"
    ;;

  job)
    get "/v1/jobs/${1:?JOB_ID required}"
    ;;

  wait)
    need_jq
    id="${1:?JOB_ID required}"
    deadline=$(( $(date +%s) + ${TIMEOUT_SECONDS:-600} ))
    while :; do
      body="$(get "/v1/jobs/$id?wait=25")"
      status="$(printf '%s' "$body" | jq -r .status)"
      echo "status: $status" >&2
      case "$status" in
        succeeded | failed | cancelled) printf '%s\n' "$body"; break ;;
      esac
      if [ "$(date +%s)" -ge "$deadline" ]; then echo "Still running. Run wait again later." >&2; exit 1; fi
      sleep 1
    done
    ;;

  transcript)
    get "/v1/transcripts/${1:?RESULT_ID required}"
    ;;

  export)
    get "/v1/transcripts/${1:?RESULT_ID required}/export?format=${2:-txt}"
    ;;

  help | -h | --help)
    usage
    ;;

  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 2
    ;;
esac
