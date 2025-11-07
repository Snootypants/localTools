// LocalTools front-end controller for metadata fetch and download actions.
const els = {
  url: document.getElementById('videoUrl'),
  fetchBtn: document.getElementById('fetchBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  formatSelect: document.getElementById('formatSelect'),
  downloadType: document.getElementById('downloadType'),
  status: document.getElementById('status'),
  infoPanel: document.getElementById('infoPanel'),
  title: document.getElementById('title'),
  uploader: document.getElementById('uploader'),
  duration: document.getElementById('duration'),
  thumbnail: document.getElementById('thumbnail')
};

// Convert seconds to hh:mm:ss (dropping leading hours when unnecessary).
const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return '';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return [hrs, mins, secs]
    .map((val) => String(val).padStart(2, '0'))
    .join(':')
    .replace(/^00:/, '');
};

const setStatus = (message, isError = false) => {
  els.status.textContent = message;
  els.status.style.color = isError ? '#ff8787' : 'var(--muted)';
};

// Fill the dropdown with server supplied formats; disable it when empty.
const populateFormats = (formats) => {
  els.formatSelect.innerHTML = '';
  if (!formats.length) {
    const opt = document.createElement('option');
    opt.textContent = 'No compatible formats available';
    els.formatSelect.appendChild(opt);
    els.formatSelect.disabled = true;
    return;
  }

  formats.forEach((fmt) => {
    const option = document.createElement('option');
    const labelParts = [fmt.height ? `${fmt.height}p` : null, fmt.ext, fmt.format_note]
      .filter(Boolean)
      .join(' · ');
    option.value = fmt.format_id;
    option.textContent = labelParts || fmt.format_id;
    els.formatSelect.appendChild(option);
  });
  els.formatSelect.disabled = false;
};

const fetchInfo = async () => {
  setStatus('Fetching metadata…');
  els.fetchBtn.disabled = true;
  els.downloadBtn.disabled = true;

  try {
    const res = await fetch('/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: els.url.value })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch info');

    els.title.textContent = data.title || 'Untitled';
    els.uploader.textContent = data.uploader ? `by ${data.uploader}` : '';
    els.duration.textContent = data.duration ? formatDuration(data.duration) : '';
    if (data.thumbnail) {
      els.thumbnail.src = data.thumbnail;
      els.thumbnail.removeAttribute('hidden');
    }
    els.infoPanel.hidden = false;

    populateFormats(data.formats || []);
    els.downloadBtn.disabled = false;
    setStatus('Metadata ready. Choose a format to download.');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    els.fetchBtn.disabled = false;
  }
};

const parseFilename = (contentDisposition) => {
  if (!contentDisposition) return null;
  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : null;
};

const downloadVideo = async () => {
  setStatus('Downloading… this may take a moment.');
  els.downloadBtn.disabled = true;

  try {
    const payload = {
      url: els.url.value,
      format_id: els.formatSelect.disabled ? null : els.formatSelect.value,
      download_type: els.downloadType.value
    };

    const res = await fetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Download failed');
    }

    const blob = await res.blob();
    const filename = parseFilename(res.headers.get('Content-Disposition')) || 'download';
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    setStatus('Download complete.');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    els.downloadBtn.disabled = false;
  }
};

els.fetchBtn.addEventListener('click', fetchInfo);
els.downloadBtn.addEventListener('click', downloadVideo);
els.url.addEventListener('keyup', (event) => {
  if (event.key === 'Enter') fetchInfo();
});
