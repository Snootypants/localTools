from urllib.parse import parse_qs, urlparse

import pytest

import server


@pytest.mark.parametrize(
    "input_url",
    [
        "https://www.youtube.com/watch?v=test#section",
        "https://music.youtube.com/watch?v=test",
        "https://youtu.be/abc123",
        "https://www.youtube-nocookie.com/embed/xyz",
        "https://sub.youtube.com/watch?v=123",
    ],
)
def test_validate_url_accepts_supported_hosts(input_url):
    sanitized = server._validate_url(input_url)
    assert urlparse(sanitized).fragment == ""


def test_validate_url_rejects_invalid_host():
    with pytest.raises(server.DownloaderError) as exc:
        server._validate_url("https://example.com/watch?v=123")
    assert str(exc.value) == "Only YouTube URLs are supported in this version."


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, "Please provide a URL."),
        ("", "Please provide a URL."),
        ("www.youtube.com/watch?v=1", "URL must start with http:// or https://"),
    ],
)
def test_validate_url_rejects_missing_or_bad_scheme(value, expected):
    with pytest.raises(server.DownloaderError) as exc:
        server._validate_url(value)
    assert str(exc.value) == expected


def test_ensure_english_locale_overrides_existing_params():
    original = "https://www.youtube.com/watch?v=123&hl=es"
    updated = server._ensure_english_locale(original)
    query = parse_qs(urlparse(updated).query)
    assert query["hl"] == ["en"]
    assert query["persist_hl"] == ["1"]
    assert query["v"] == ["123"]


@pytest.mark.parametrize(
    "name,expected",
    [
        ("My cool name!!.mp4", "My_cool_name.mp4"),
        ("My_name_.mp4", "My_name.mp4"),
        ("..", "download"),
        ("__track__", "track"),
        ("", "download"),
    ],
)
def test_sanitize_filename_behaviors(name, expected):
    assert server._sanitize_filename(name) == expected


def test_resolve_download_dir_defaults_to_project_downloads():
    assert server._resolve_download_dir(None) == server.DOWNLOAD_DIR


def test_resolve_download_dir_supports_relative_paths():
    target = server._resolve_download_dir("nested/dir")
    assert target == (server.BASE_DIR / "nested/dir").resolve()
    assert target.is_dir()


def test_resolve_download_dir_supports_absolute_paths(tmp_path):
    absolute = tmp_path / "absolute_dir"
    resolved = server._resolve_download_dir(str(absolute))
    assert resolved == absolute.resolve()


def test_resolve_download_dir_rejects_non_directory(tmp_path):
    file_path = server.BASE_DIR / "file_target"
    file_path.write_text("data")
    with pytest.raises(server.DownloaderError) as exc:
        server._resolve_download_dir(str(file_path))
    assert str(exc.value) == "Download path must be a directory."


def test_resolve_download_dir_wraps_os_error(monkeypatch):
    original_mkdir = server.Path.mkdir

    def fake_mkdir(self, parents=False, exist_ok=False):
        if self.name.endswith("boom"):
            raise OSError("kaboom")
        return original_mkdir(self, parents=parents, exist_ok=exist_ok)

    monkeypatch.setattr(server.Path, "mkdir", fake_mkdir)
    with pytest.raises(server.DownloaderError) as exc:
        server._resolve_download_dir("boom")
    assert str(exc.value).startswith("Unable to use save location: ")


def test_format_response_filters_formats_and_includes_defaults():
    info = {
        "title": "Sample",
        "uploader": "Creator",
        "duration": 123,
        "thumbnail": "thumb",
        "description": "desc",
        "formats": [
            {"format_id": "1", "ext": "mp4", "height": 720, "acodec": "mp4a", "vcodec": "avc1", "filesize": 100},
            {"format_id": "2", "ext": "webm", "height": 480, "acodec": "none", "vcodec": "none"},
            {"format_id": "3", "ext": "flv", "height": 1080, "acodec": "mp3", "vcodec": "h264"},
            {"format_id": "4", "ext": "m4a", "height": None, "acodec": "mp4a", "vcodec": "none", "filesize_approx": 2048},
        ],
    }

    result = server._format_response(info)
    assert result["title"] == "Sample"
    assert result["default_download_dir"] == str(server.DOWNLOAD_DIR)
    format_ids = [fmt["format_id"] for fmt in result["formats"]]
    assert format_ids == ["1", "4"]
    assert result["formats"][0]["filesize"] == 100
    assert result["formats"][1]["filesize_approx"] == 2048
