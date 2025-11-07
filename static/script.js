// LocalTools front-end controller for metadata fetch and download actions.
const els = {
  url: document.getElementById('videoUrl'),
  fetchBtn: document.getElementById('fetchBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  formatSelect: document.getElementById('formatSelect'),
  resolutionSelect: document.getElementById('resolutionSelect'),
  downloadType: document.getElementById('downloadType'),
  status: document.getElementById('status'),
  infoPanel: document.getElementById('infoPanel'),
  title: document.getElementById('title'),
  uploader: document.getElementById('uploader'),
  duration: document.getElementById('duration'),
  thumbnail: document.getElementById('thumbnail'),
  formatCount: document.getElementById('formatCount'),
  selectedType: document.getElementById('selectedType')
};

const state = {
  formats: [],
  groupedFormats: new Map()
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

const setStatus = (message, type = 'info') => {
  els.status.textContent = message;
  if (type === 'error') {
    els.status.style.color = 'var(--error)';
  } else if (type === 'success') {
    els.status.style.color = 'var(--success)';
  } else {
    els.status.style.color = 'var(--muted)';
  }
};

// Fill the dropdown with server supplied formats; disable it when empty.
const groupFormatsByResolution = (formats) => {
  const grouped = new Map();
  formats.forEach((fmt) => {
    const key = Number.isFinite(fmt.height) ? Number(fmt.height) : 'audio';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(fmt);
  });
  return grouped;
};

const populateFormatOptions = (resolutionValue) => {
  const key = resolutionValue === 'audio' ? 'audio' : Number(resolutionValue);
  const targetFormats = state.groupedFormats.get(key) || [];
  els.formatSelect.innerHTML = '';

  if (!targetFormats.length) {
    const opt = document.createElement('option');
    opt.textContent = 'No compatible formats available';
    els.formatSelect.appendChild(opt);
    els.formatSelect.disabled = true;
    els.formatCount.textContent = '0';
    return;
  }

  targetFormats.forEach((fmt) => {
    const detailParts = [fmt.ext, fmt.format_note, fmt.fps ? `${fmt.fps}fps` : null]
      .filter(Boolean)
      .join(' • ');
    const option = document.createElement('option');
    option.value = fmt.format_id;
    option.textContent = detailParts || fmt.format_id;
    els.formatSelect.appendChild(option);
  });
  els.formatSelect.disabled = false;
  els.formatSelect.value = targetFormats[0].format_id;
  els.formatCount.textContent = targetFormats.length;
};

const populateResolutionOptions = () => {
  els.resolutionSelect.innerHTML = '';
  const numericResolutions = [...state.groupedFormats.keys()]
    .filter((key) => key !== 'audio')
    .sort((a, b) => Number(b) - Number(a));

  numericResolutions.forEach((height) => {
    const option = document.createElement('option');
    option.value = String(height);
    option.textContent = `${height}p`;
    els.resolutionSelect.appendChild(option);
  });

  if (state.groupedFormats.has('audio')) {
    const audioOption = document.createElement('option');
    audioOption.value = 'audio';
    audioOption.textContent = 'Audio only';
    els.resolutionSelect.appendChild(audioOption);
  }

  if (!numericResolutions.length && !state.groupedFormats.has('audio')) {
    els.resolutionSelect.disabled = true;
    els.formatSelect.disabled = true;
    els.formatCount.textContent = '0';
    return;
  }

  const defaultValue = numericResolutions[0] ?? 'audio';
  els.resolutionSelect.value = String(defaultValue);
  els.resolutionSelect.disabled = false;
  populateFormatOptions(String(defaultValue));
};

const syncQualityControls = () => {
  const isAudio = els.downloadType.value === 'audio';
  els.selectedType.textContent = isAudio ? 'Audio' : 'Video';
  els.resolutionSelect.disabled = isAudio || !els.resolutionSelect.options.length;
  els.formatSelect.disabled = isAudio || !els.formatSelect.options.length;
  if (!isAudio && !els.resolutionSelect.disabled) {
    populateFormatOptions(els.resolutionSelect.value);
  }
};

const fetchInfo = async () => {
  setStatus('Fetching metadata… hang tight.');
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
    els.uploader.textContent = data.uploader ? data.uploader : 'Unknown uploader';
    const formattedDuration = data.duration ? formatDuration(data.duration) : '00:00';
    els.duration.textContent = formattedDuration;
    if (data.thumbnail) {
      els.thumbnail.src = data.thumbnail;
      els.thumbnail.removeAttribute('hidden');
    }
    els.infoPanel.hidden = false;

    state.formats = data.formats || [];
    state.groupedFormats = groupFormatsByResolution(state.formats);
    populateResolutionOptions();
    syncQualityControls();
    els.downloadBtn.disabled = false;
    setStatus('Metadata ready. Choose a format and hit download.', 'success');
  } catch (err) {
    setStatus(err.message, 'error');
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

    setStatus('Download complete.', 'success');
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    els.downloadBtn.disabled = false;
  }
};

els.fetchBtn.addEventListener('click', fetchInfo);
els.downloadBtn.addEventListener('click', downloadVideo);
els.url.addEventListener('keyup', (event) => {
  if (event.key === 'Enter') fetchInfo();
});
els.resolutionSelect.addEventListener('change', (event) => {
  populateFormatOptions(event.target.value);
});
els.downloadType.addEventListener('change', () => {
  syncQualityControls();
});
