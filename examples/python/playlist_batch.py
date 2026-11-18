"""List a YouTube playlist, fetch captions for its videos in one batch, print each transcript.

Cost: 1 credit for the playlist page, plus 1 credit per video that has captions.
      Videos without captions fail for free (captions_only never starts AI transcription).
Plan: items per batch are 1 on the free plan, 10 on Starter, 25 on Pro, 50 on Scale.
      Keep LIMIT at or below your plan's batch size.
Setup: python -m pip install transcriptdock
Run:   TRANSCRIPTDOCK_API_KEY=td_live_... python playlist_batch.py PLAYLIST [LIMIT]
"""

import os
import sys
import time
from uuid import uuid4

from transcriptdock import TranscriptDock

if len(sys.argv) < 2:
    sys.exit("Usage: python playlist_batch.py PLAYLIST [LIMIT]")
playlist = sys.argv[1]
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 5

client = TranscriptDock(os.environ["TRANSCRIPTDOCK_API_KEY"])


def poll(read, resource_id, done, every=3, timeout=600):
    """Call read(resource_id) every few seconds until done(resource) is true."""
    deadline = time.monotonic() + timeout
    while True:
        resource = read(resource_id)
        if done(resource):
            return resource
        if time.monotonic() > deadline:
            sys.exit(f"{resource_id} is still {resource['status']}. Check it again later.")
        time.sleep(every)


# 1. One page of the playlist (1 credit). next_cursor would fetch the next page.
queued = client.create_video_discovery(
    {"kind": "youtube_playlist_videos", "playlist": playlist, "limit": limit},
    idempotency_key=str(uuid4()),
)
discovery = poll(client.get_video_discovery, queued["id"],
                 lambda d: d["status"] in ("succeeded", "failed"))
if discovery["status"] == "failed":
    sys.exit(f"Discovery failed: {discovery.get('error')}")
videos = discovery["videos"]
print(f"Found {len(videos)} video(s). More pages: {bool(discovery['next_cursor'])}", file=sys.stderr)
if not videos:
    sys.exit(0)

# 2. One batch of caption jobs. Save the key: resending the same body with it
#    returns the original batch instead of creating a second one.
batch_key = str(uuid4())
print("Idempotency-Key:", batch_key, file=sys.stderr)
batch = client.create_batch(
    {"items": [{"source": {"url": v["url"]}, "mode": "captions_only",
                "caption_languages": ["en"], "max_credits": 1} for v in videos]},
    idempotency_key=batch_key,
)

# 3. Wait for every item to be final. A batch.completed webhook avoids polling.
batch = poll(client.get_batch, batch["id"],
             lambda b: b["status"] in ("succeeded", "partial_success", "failed", "cancelled"),
             every=5, timeout=1200)
print(f"Batch {batch['status']}: {batch['succeeded_items']} with captions, "
      f"{batch['failed_items']} without", file=sys.stderr)

# 4. Print each transcript's opening.
for item in batch["items"]:
    video = videos[item["item_index"]]
    job = client.get_job(item["job_id"])
    print(f"\n# {video['title'] or video['url']}")
    if job["status"] != "succeeded":
        print(f"({job['status']}: {(job.get('error') or {}).get('code')})")
        continue
    text = client.export_transcript(job["result_id"], "txt")
    print(text[:300] + ("..." if len(text) > 300 else ""))
