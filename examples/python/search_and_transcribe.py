"""Search YouTube, then fetch the captions of the top result.

Cost: 1 credit for the search page, then at most 1 credit for the captions.
Setup: python -m pip install transcriptdock
Run:   TRANSCRIPTDOCK_API_KEY=td_live_... python search_and_transcribe.py "QUERY"
"""

import os
import sys
import time
from uuid import uuid4

from transcriptdock import JobTimeoutError, TranscriptDock

if len(sys.argv) < 2:
    sys.exit('Usage: python search_and_transcribe.py "QUERY"')
query = sys.argv[1]

client = TranscriptDock(os.environ["TRANSCRIPTDOCK_API_KEY"])

# 1. Search (1 credit per page). Results are kept for 24 hours.
discovery = client.create_video_discovery(
    {"kind": "youtube_search", "query": query, "limit": 5},
    idempotency_key=str(uuid4()),
)
deadline = time.monotonic() + 120
while discovery["status"] in ("queued", "processing"):
    if time.monotonic() > deadline:
        sys.exit(f"Search {discovery['id']} is still {discovery['status']}.")
    time.sleep(2)
    discovery = client.get_video_discovery(discovery["id"])

if discovery["status"] != "succeeded" or not discovery["videos"]:
    sys.exit(f"No results: {discovery.get('error')}")

for index, video in enumerate(discovery["videos"]):
    print(f"{index + 1}. {video['title']} ({video['channel_title']}, {video['view_count_text']})",
          file=sys.stderr)

top = discovery["videos"][0]

# 2. Captions of the top result.
submission_key = str(uuid4())
print("Idempotency-Key:", submission_key, file=sys.stderr)
job = client.create_job(
    {"source": {"url": top["url"]}, "mode": "captions_only", "max_credits": 1},
    idempotency_key=submission_key,
)
try:
    job = client.wait_for_job(job["id"], timeout=120)
except JobTimeoutError as error:
    sys.exit(f"Still running: {error.job}")

if job["status"] != "succeeded":
    sys.exit(f"{job['status']}: {job.get('error')}")

print(f"\n# {top['title']}\n{top['url']}\n")
print(client.export_transcript(job["result_id"], "txt"))
