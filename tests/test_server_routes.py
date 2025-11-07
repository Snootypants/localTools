from pathlib import Path

import server


def test_info_route_returns_metadata(client, monkeypatch):
    captured = {}

    def fake_extract(url):
        captured["url"] = url
        return {
            "title": "Demo",
            "uploader": "Creator",
            "duration": 42,
            "thumbnail": "thumb",
            "description": "desc",
            "formats": [
                {"format_id": "1", "ext": "mp4", "height": 720, "acodec": "mp4a", "vcodec": "avc1"},
                {"format_id": "2", "ext": "webm", "height": None, "acodec": "opus", "vcodec": "none"},
                {"format_id": "3", "ext": "flv", "height": 480, "acodec": "mp3", "vcodec": "h264"},
            ],
        }

    monkeypatch.setattr(server, "_extract_metadata", fake_extract)
    resp = client.post("/info", json={"url": "https://www.youtube.com/watch?v=xyz"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["title"] == "Demo"
    assert len(data["formats"]) == 2
    assert data["default_download_dir"] == str(server.DOWNLOAD_DIR)
    assert "hl=en&persist_hl=1" in captured["url"]


def test_info_route_invalid_url_returns_error(client):
    resp = client.post("/info", json={"url": "https://example.com/video"})
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "Only YouTube URLs are supported in this version."


def test_download_audio_flow_uses_mp3_postprocessor(client, monkeypatch, app_paths):
    captured_instances = []

    class DummyYDL:
        def __init__(self, opts):
            self.opts = opts
            captured_instances.append(self)
            self.output_path = Path(opts["paths"]["home"]) / "My_name.mp3"

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def extract_info(self, url, download):
            self.output_path.parent.mkdir(parents=True, exist_ok=True)
            self.output_path.write_bytes(b"audio data")
            return {"_filename": str(self.output_path), "requested_downloads": [{"filepath": str(self.output_path)}], "title": "Song"}

        def prepare_filename(self, info):
            return str(self.output_path)

    monkeypatch.setattr(server, "YoutubeDL", DummyYDL)

    payload = {
        "url": "https://youtu.be/abc123",
        "download_type": "audio",
        "preferred_name": "My name_.mp3",
        "save_dir": "custom"
    }

    resp = client.post("/download", json=payload)
    assert resp.status_code == 200
    instance = captured_instances[0]
    assert instance.opts["format"] == "bestaudio/best"
    assert instance.opts["postprocessors"][0]["key"] == "FFmpegExtractAudio"
    assert instance.opts["outtmpl"] == "My_name.%(ext)s"
    expected_dir = (app_paths["base_dir"] / "custom").resolve()
    assert resp.headers["X-Download-Dir"] == str(expected_dir)
    assert "My_name.mp3" in resp.headers["Content-Disposition"]


def test_download_route_returns_downloader_error(client, monkeypatch):
    def fake_resolve(_):
        raise server.DownloaderError("Unable to use save location: nope")

    monkeypatch.setattr(server, "_resolve_download_dir", fake_resolve)
    resp = client.post("/download", json={"url": "https://youtu.be/abc123"})
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "Unable to use save location: nope"
