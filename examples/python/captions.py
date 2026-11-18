"""YouTube captions in your preferred languages, printed with timestamps.

Cost: captions_only spends at most 1 credit, and nothing if the video has no captions.
Setup: python -m pip install transcriptdock
Run:   TRANSCRIPTDOCK_API_KEY=td_live_... python captions.py [VIDEO_URL] [LANGS] [PREFERENCE]
       e.g. python captions.py "https://youtu.be/dQw4w9WgXcQ" es,en prefer_creator
"""

import os
import sys
from uuid import uuid4

from transcriptdock import ApiError, JobTimeoutError, TranscriptDock

url = sys.argv[1] if len(sys.argv) > 1 else "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
languages = [code for code in (sys.argv[2] if len(sys.argv) > 2 else "en").split(",") if code]
preference = sys.argv[3] if len(sys.argv) > 3 else "prefer_creator"  # creator_only, automatic_only

client = TranscriptDock(os.environ["TRANSCRIPTDOCK_API_KEY"])

# Generate once per intended operation. Save this key and the returned job ID.
# Reuse the same key and exact body if a submission's response is lost.
submission_key = str(uuid4())
print("Idempotency-Key:", submission_key, file=sys.stderr)

try:
    job = client.create_job(
        {"source": {"url": url},
         "mode": "captions_only",
         "caption_languages": languages,
         "caption_preference": preference,
         "max_credits": 1},
        idempotency_key=submission_key,
    )
    job = client.wait_for_job(job["id"], timeout=120)
except JobTimeoutError as error:
    sys.exit(f"Still running: {error.job}")
except ApiError as error:
    sys.exit(f"{error.code} {error.status} request {error.request_id}")

if job["status"] != "succeeded":
    code = (job.get("error") or {}).get("code")
    print(job["status"], code, file=sys.stderr)
    if code == "LANGUAGE_UNAVAILABLE":
        print("None of those languages exists. Run languages.py to list the tracks.", file=sys.stderr)
    elif code == "NO_CAPTIONS":
        print("No captions. mode auto or transcribe runs AI transcription on paid plans.", file=sys.stderr)
    sys.exit(1)

transcript = client.get_transcript(job["result_id"])
# source_origin: creator_captions, platform_captions (automatic) or speech_recognition
print(transcript["source_origin"], transcript["language"], file=sys.stderr)

# Times come straight from the transcript, in seconds. Never estimate them.
for segment in transcript["segments"][:10]:
    minutes, seconds = divmod(int(segment["start"]), 60)
    print(f"[{minutes}:{seconds:02d}] {segment['text']}")
