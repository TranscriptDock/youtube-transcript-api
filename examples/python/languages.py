"""List a YouTube video's caption tracks, then fetch the transcript in one of them.

Cost: 1 credit for the language discovery, then at most 1 credit for the captions.
Setup: python -m pip install transcriptdock
Run:   TRANSCRIPTDOCK_API_KEY=td_live_... python languages.py VIDEO_URL [LANGUAGE_CODE]
       Without LANGUAGE_CODE it only lists the tracks (1 credit).
"""

import os
import sys
import time
from uuid import uuid4

from transcriptdock import TranscriptDock

if len(sys.argv) < 2:
    sys.exit("Usage: python languages.py VIDEO_URL [LANGUAGE_CODE]")
url = sys.argv[1]
wanted = sys.argv[2] if len(sys.argv) > 2 else None

client = TranscriptDock(os.environ["TRANSCRIPTDOCK_API_KEY"])

# 1. Queue the discovery. It runs in the background like a job.
discovery = client.create_language_discovery({"source": {"url": url}}, idempotency_key=str(uuid4()))

# 2. Read it until it is final.
deadline = time.monotonic() + 120
while discovery["status"] in ("queued", "processing"):
    if time.monotonic() > deadline:
        sys.exit(f"Discovery {discovery['id']} is still {discovery['status']}.")
    time.sleep(2)
    discovery = client.get_language_discovery(discovery["id"])

if discovery["status"] != "succeeded":
    sys.exit(f"Discovery failed: {discovery.get('error')}")

print("Default:", discovery["default_language"], "Original:", discovery["original_language"])
for lang in discovery["languages"]:
    flags = [lang["origin"]] + [name for name in ("is_default", "is_original") if lang[name]]
    print(f"{lang['code']:<10} {lang['display_name']} ({', '.join(flags)})")

if not wanted:
    sys.exit(0)

# 3. Fetch the captions in the chosen track. origin "automatic" is YouTube's automatic captions.
track = next((lang for lang in discovery["languages"] if lang["code"] == wanted), None)
if track is None:
    sys.exit(f"No {wanted} track on this video.")

job = client.create_job(
    {"source": {"url": url},
     "mode": "captions_only",
     "caption_languages": [wanted],
     "caption_preference": "automatic_only" if track["origin"] == "automatic" else "creator_only",
     "max_credits": 1},
    idempotency_key=str(uuid4()),
)
job = client.wait_for_job(job["id"], timeout=120)
if job["status"] != "succeeded":
    sys.exit(f"{job['status']}: {job.get('error')}")
print()
print(client.export_transcript(job["result_id"], "txt"))
