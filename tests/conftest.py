import pytest

import server


@pytest.fixture(autouse=True)
def app_paths(tmp_path, monkeypatch):
    base_dir = tmp_path / "localtools"
    download_dir = base_dir / "downloads"
    download_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(server, "BASE_DIR", base_dir)
    monkeypatch.setattr(server, "DOWNLOAD_DIR", download_dir)
    return {"base_dir": base_dir, "download_dir": download_dir}


@pytest.fixture()
def app():
    server.app.config.update(TESTING=True)
    return server.app


@pytest.fixture()
def client(app):
    with app.test_client() as test_client:
        yield test_client
