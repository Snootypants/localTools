import re
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from flask import Flask, jsonify, render_template, request, send_file
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

"""
LocalTools YouTube Downloader
----------------------------
Flask application that powers the local-only YouTube downloader tool.
"""
BASE_DIR = Path(__file__).resolve().parent
DOWNLOAD_DIR = BASE_DIR / "downloads"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_YOUTUBE_HOSTS = {
    "youtu.be",
    "youtube.com",
    "www.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
}
YOUTUBE_HOST_SUFFIXES = (".youtube.com", ".youtube-nocookie.com")

app = Flask(__name__, static_folder="static", template_folder="templates")


class DownloaderError(Exception):
    """Raised when a download- or metadata-related issue occurs."""


def _validate_url(url: Optional[str]) -> str:
    """Ensure the provided URL is a supported YouTube endpoint."""
    if not url or not url.strip():
        raise DownloaderError("Please provide a URL.")

    cleaned = url.strip()
    if not cleaned.startswith(("http://", "https://")):
        raise DownloaderError("URL must start with http:// or https://")

    parsed = urlparse(cleaned)
    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise DownloaderError("Only YouTube URLs are supported in this version.")

    if hostname not in ALLOWED_YOUTUBE_HOSTS and not hostname.endswith(YOUTUBE_HOST_SUFFIXES):
        raise DownloaderError("Only YouTube URLs are supported in this version.")

    sanitized = urlunparse(parsed._replace(fragment=""))
    return sanitized


def _ensure_english_locale(url: str) -> str:
    """Append query params that force YouTube to respond in English."""
    parsed = urlparse(url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    query["hl"] = ["en"]
    query["persist_hl"] = ["1"]
    new_query = urlencode(query, doseq=True)
    return urlunparse(parsed._replace(query=new_query))


def _sanitize_filename(name: str) -> str:
    """Keep filenames filesystem-safe while remaining human friendly."""
    sanitized = re.sub(r"[^A-Za-z0-9._-]", "_", name or "")
    sanitized = re.sub(r"_+", "_", sanitized)
    sanitized = re.sub(r"_+(?=\.)", "", sanitized)
    sanitized = sanitized.strip("._")
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
        # Force English UI responses so titles/descriptions aren't localized.
        "http_headers": {
            "Accept-Language": "en-US,en;q=0.9",
        },
        "extractor_args": {
            "youtube": {
                "lang": ["en"],
                "player_client": ["web"],
            }
        },
    }


def _format_response(info: Dict[str, Any]) -> Dict[str, Any]:
    """Extract only the fields the UI needs to render a preview."""

    def _summarize_format(fmt: Dict[str, Any]) -> Dict[str, Any]:
        summary = {
            "format_id": fmt.get("format_id"),
            "ext": fmt.get("ext"),
            "height": fmt.get("height"),
            "filesize": fmt.get("filesize"),
            "filesize_approx": fmt.get("filesize_approx"),
            "format_note": fmt.get("format_note"),
            "fps": fmt.get("fps"),
            "acodec": fmt.get("acodec"),
            "vcodec": fmt.get("vcodec"),
        }
        return summary

    filtered_formats: List[Dict[str, Any]] = []
    for fmt in info.get("formats", []):
        ext = (fmt.get("ext") or "").lower()
        if ext == "flv":
            continue

        vcodec = (fmt.get("vcodec") or "").lower()
        acodec = (fmt.get("acodec") or "").lower()
        has_video = vcodec and vcodec != "none"
        has_audio_only = (not has_video) and acodec and acodec != "none"
        if not has_video and not has_audio_only:
            continue

        filtered_formats.append(_summarize_format(fmt))

    return {
        "title": info.get("title"),
        "uploader": info.get("uploader"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "description": info.get("description"),
        "formats": filtered_formats,
        "default_download_dir": str(DOWNLOAD_DIR),
    }


def _extract_metadata(url: str) -> Dict[str, Any]:
    """Query yt-dlp for metadata with a fallback format if needed."""
    base_opts = {**_base_ydl_opts(), "skip_download": True}
    try:
        with YoutubeDL(base_opts) as ydl:
            return ydl.extract_info(url, download=False)
    except DownloadError as err:
        if "Requested format is not available" not in str(err):
            raise
        fallback_opts = {**base_opts, "format": "best"}
        with YoutubeDL(fallback_opts) as ydl:
            return ydl.extract_info(url, download=False)


def _resolve_download_dir(custom_dir: Optional[str]) -> Path:
    """Return a writable directory, defaulting to the project downloads folder."""
    raw_value = (custom_dir or "").strip()
    if not raw_value:
        resolved = DOWNLOAD_DIR
    else:
        candidate = Path(raw_value).expanduser()
        resolved = candidate.resolve() if candidate.is_absolute() else (BASE_DIR / candidate).resolve()

    if resolved.exists() and not resolved.is_dir():
        raise DownloaderError("Download path must be a directory.")

    try:
        resolved.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise DownloaderError(f"Unable to use save location: {exc}") from exc

    return resolved


@app.route("/")
@app.route("/index")
@app.route("/index.html")
@app.route("/templates/index.html")
def index() -> str:
    """Serve the primary UI regardless of legacy template paths."""
    return render_template(
        "index.html",
        default_download_dir=str(DOWNLOAD_DIR),
        base_dir=str(BASE_DIR),
    )


@app.route("/info", methods=["POST"])
def get_info():
    payload = request.get_json(silent=True) or {}
    try:
        url = _ensure_english_locale(_validate_url(payload.get("url")))
        info = _extract_metadata(url)
    except DownloaderError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # pragma: no cover - network/lib errors
        return jsonify({"error": f"Failed to fetch metadata: {exc}"}), 500

    return jsonify(_format_response(info))


@app.route("/download", methods=["POST"])
def download_video():
    payload = request.get_json(silent=True) or {}
    try:
        url = _ensure_english_locale(_validate_url(payload.get("url")))
        download_type = (payload.get("download_type") or "video").lower()
        if download_type not in {"audio", "video"}:
            download_type = "video"
        format_id = payload.get("format_id")
        download_dir = _resolve_download_dir(payload.get("save_dir"))

        preferred_name = payload.get("preferred_name")
        if preferred_name:
            filename_base = _sanitize_filename(preferred_name)
        else:
            metadata = _extract_metadata(url)
            filename_base = _sanitize_filename(metadata.get("title") or "download")

        if "." in filename_base:
            filename_base = filename_base.rsplit(".", 1)[0] or filename_base
        ydl_opts = _base_ydl_opts()
        ydl_opts["paths"] = {"home": str(download_dir)}
        ydl_opts["outtmpl"] = f"{filename_base}.%(ext)s"
        ydl_opts["outtmpl_na_placeholder"] = "download"

        if download_type == "audio":
            ydl_opts["format"] = "bestaudio/best"
            ydl_opts["postprocessors"] = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }
            ]
        elif format_id:
            ydl_opts["format"] = format_id
        else:
            ydl_opts["format"] = "bv*+ba/bestvideo+bestaudio/best"

        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            output_path = info.get("_filename")
            if not output_path and info.get("requested_downloads"):
                output_path = info["requested_downloads"][-1].get("filepath")
            file_path = Path(output_path or ydl.prepare_filename(info))
    except DownloaderError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # pragma: no cover - network/lib errors
        return jsonify({"error": f"Download failed: {exc}"}), 500

    if not file_path.exists():
        return jsonify({"error": "Downloaded file not found."}), 500

    safe_stem = _sanitize_filename(file_path.stem)
    download_name = f"{safe_stem}{file_path.suffix}" if file_path.suffix else safe_stem

    response = send_file(file_path, as_attachment=True, download_name=download_name)
    response.headers["X-Download-Path"] = str(file_path)
    response.headers["X-Download-Dir"] = str(download_dir)
    return response


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
