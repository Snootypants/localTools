# LocalTools — YouTube Downloader v1

LocalTools is a privacy-first toolbox that runs entirely on your machine. Phase 1 ships a YouTube downloader with Flask + yt-dlp, delivering a single-page UI at `http://localhost:5000`.

## Features

- Local-only processing with Flask backend and simple HTML/JS frontend
- Metadata preview (title, uploader, runtime, thumbnail) before downloading
- Format dropdown populated from yt-dlp responses
- Supports full video downloads or audio-only (MP3) conversions
- Downloads saved to `./downloads` and streamed back to the browser

## Requirements

- macOS (tested on 14+/Apple Silicon) with Python 3.12+
- `ffmpeg` accessible on your PATH (`brew install ffmpeg` if missing)

## Quick Start

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python server.py
```

Then visit <http://localhost:5000>, paste a YouTube URL, fetch metadata, pick a format, and download.

## Project Layout

```
localTools/
├── server.py          # Flask app + yt-dlp integration
├── requirements.txt   # pinned dependencies
├── README.md
├── static/
│   ├── script.js      # frontend logic for info + download flows
│   └── style.css      # dark-mode UI styles
├── templates/
│   └── index.html     # single-page interface
└── downloads/         # output files (gitignored)
```

## Notes

- Routes: `/` renders the UI, `/info` returns metadata JSON, `/download` streams the file.
- URL validation + explicit error messages guard against invalid inputs.
- Audio downloads use ffmpeg via yt-dlp postprocessors. Ensure `ffmpeg` is installed.
- Future expansion: add more tools via Flask blueprints under `/tools/<name>`.

## Troubleshooting

- `ModuleNotFoundError`: confirm the virtual environment is activated before running the server.
- `ffmpeg not found`: install via Homebrew (`brew install ffmpeg`) or update `PATH` so yt-dlp can locate it.
- Permission issues on `downloads/`: ensure the directory is writable by your user.

## License

All Rights Reserved. You can't copy this and it's not for sharing.
