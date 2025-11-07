import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, render_template, request, send_file
from yt_dlp import YoutubeDL

"""
LocalTools YouTube Downloader
----------------------------
Flask application that powers the local-only YouTube downloader tool.
"""
BASE_DIR = Path(__file__).resolve().parent
DOWNLOAD_DIR = BASE_DIR / "downloads"
DOWNLOAD_DIR.mkdir(exist_ok=True)

app = Flask(__name__, static_folder="static", template_folder="templates")


class DownloaderError(Exception):
    """Raised when a download- or metadata-related issue occurs."""


def _validate_url(url: Optional[str]) -> str:
    if not url or not url.strip():
        raise DownloaderError("Please provide a URL.")
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        raise DownloaderError("URL must start with http:// or https://")
    if "youtube" not in url and "youtu.be" not in url:
        raise DownloaderError("Only YouTube URLs are supported in this version.")
    return url


def _sanitize_filename(name: str) -> str:
    """Keep filenames filesystem-safe while remaining human friendly."""
    sanitized = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    sanitized = re.sub(r"_+", "_", sanitized).strip("._")
    return sanitized or "download"


def _base_ydl_opts() -> Dict[str, Any]:
    """Common youtube-dl options for both metadata and download flows."""
    return {
        "quiet": True,
        "noprogress": True,
        "no_warnings": True,
        "cachedir": False,
        "noplaylist": True,
        "ignoreerrors": False,
    }


def _format_response(info: Dict[str, Any]) -> Dict[str, Any]:
    """Extract only the fields the UI needs to render a preview."""
    def _summarize_format(fmt: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "format_id": fmt.get("format_id"),
            "ext": fmt.get("ext"),
            "height": fmt.get("height"),
            "filesize": fmt.get("filesize"),
            "format_note": fmt.get("format_note"),
            "fps": fmt.get("fps"),
        }

    formats: List[Dict[str, Any]] = []
    for fmt in info.get("formats", []):
        if fmt.get("acodec") == "none" and fmt.get("vcodec") == "none":
            continue
        if fmt.get("ext") not in {"mp4", "webm", "m4a", "mp3"}:
            continue
        formats.append(_summarize_format(fmt))

    return {
        "title": info.get("title"),
        "uploader": info.get("uploader"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "formats": formats,
    }


@app.route("/")
@app.route("/index")
@app.route("/index.html")
@app.route("/templates/index.html")
def index() -> str:
    """Serve the primary UI regardless of legacy template paths."""
    return render_template("index.html")


@app.route("/info", methods=["POST"])
def get_info():
    payload = request.get_json(silent=True) or {}
    try:
        url = _validate_url(payload.get("url"))
        ydl_opts = {**_base_ydl_opts(), "skip_download": True}
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except DownloaderError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # pragma: no cover - network/lib errors
        return jsonify({"error": f"Failed to fetch metadata: {exc}"}), 500

    return jsonify(_format_response(info))


@app.route("/download", methods=["POST"])
def download_video():
    payload = request.get_json(silent=True) or {}
    try:
        url = _validate_url(payload.get("url"))
        format_id = payload.get("format_id")
        download_type = (payload.get("download_type") or "video").lower()
        ydl_opts = _base_ydl_opts()

        filename_template = _sanitize_filename(payload.get("preferred_name") or "%(title)s-%(id)s")
        ydl_opts["outtmpl"] = str(DOWNLOAD_DIR / f"{filename_template}.%(ext)s")

        if download_type == "audio":
            # Force best available audio and convert it to MP3 via ffmpeg.
            ydl_opts["format"] = "bestaudio/best"
            ydl_opts["postprocessors"] = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }
            ]
        elif format_id:
            # Honor the explicit format coming from the dropdown list.
            ydl_opts["format"] = format_id
        else:
            # Fallback to best video + audio combination when nothing is selected.
            ydl_opts["format"] = "bv*+ba/best"

        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            file_path = Path(ydl.prepare_filename(info))
    except DownloaderError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # pragma: no cover - network/lib errors
        return jsonify({"error": f"Download failed: {exc}"}), 500

    if not file_path.exists():
        return jsonify({"error": "Downloaded file not found."}), 500

    return send_file(file_path, as_attachment=True, download_name=file_path.name)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
