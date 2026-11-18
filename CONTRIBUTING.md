# Contributing

Thanks for helping improve YouTube Transcript API. This repository holds examples, docs and an agent skill for the hosted [Transcript Dock API](https://www.transcriptdock.com/docs). The API service itself is not in this repo.

## Issues

Issues are welcome for:

- an example that fails, or reads badly
- docs in this repo that disagree with the API's behaviour
- an endpoint, option or example you would like to see

Please include the `X-Request-Id` header (or `request_id` in the error body) when you report API behaviour. Never paste an API key, a webhook secret or a signed upload URL into an issue.

## Pull requests

Example pull requests are welcome. Keep them in the style of the existing files:

- Read the key from `TRANSCRIPTDOCK_API_KEY`. Never hard code keys.
- Send an `Idempotency-Key` on every create and set `max_credits` on every job.
- JavaScript examples use plain `fetch` on Node 18 or newer, with no dependencies.
- Python examples use the published [`transcriptdock`](https://pypi.org/project/transcriptdock/) package.
- Do not call AI transcription without saying in a comment what it costs.
- Prose is plain, short sentences.

Check syntax before you open the pull request. These checks do not call the API:

```bash
for f in examples/javascript/*.mjs; do node --check "$f"; done
python -m py_compile examples/python/*.py
bash -n examples/curl/examples.sh
```

Delete any `__pycache__` folders before you commit. Please do not run examples against production in CI: they spend real credits.

## Security

Report security issues privately by email to [transcriptdock@volods.com](mailto:transcriptdock@volods.com). Do not open a public issue for them.

## License

By contributing you agree that your contribution is released under the [MIT License](./LICENSE).
