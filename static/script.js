// LocalTools front-end controller for metadata fetch and download actions.
const appConfig = window.APP_CONFIG || {};
const els = {
  url: document.getElementById('videoUrl'),
  fetchBtn: document.getElementById('fetchBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  downloadBtnIcon: document.querySelector('#downloadBtn .icon'),
  downloadBtnLabel: document.querySelector('#downloadBtn .label'),
  downloadName: document.getElementById('preferredName'),
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
  selectedType: document.getElementById('selectedType'),
  description: document.getElementById('description'),
  progressWrapper: document.getElementById('progressWrapper'),
  progressTrack: document.getElementById('progressTrack'),
  progressBar: document.getElementById('progressBar'),
  progressLabel: document.getElementById('progressLabel'),
  saveDirInput: document.getElementById('saveDirInput'),
  saveDirDisplay: document.getElementById('saveDirDisplay'),
  saveDirReset: document.getElementById('saveDirReset')
};

const state = {
  formats: [],
  groupedFormats: new Map(),
  formatSizes: new Map(),
  defaultSaveDir: appConfig.defaultSaveDir || '',
  baseDir: appConfig.baseDir || '',
  saveDir: appConfig.defaultSaveDir || '',
  fetchInFlight: false
};

let metadataController = null;
let downloadController = null;
let downloadReady = false;
let downloadState = 'idle';

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

const resetPreview = () => {
  state.formats = [];
  state.groupedFormats = new Map();
  state.formatSizes = new Map();
  els.infoPanel.hidden = true;
  if (els.thumbnail) {
    els.thumbnail.src = '';
    els.thumbnail.setAttribute('hidden', 'hidden');
  }
  if (els.title) els.title.textContent = '—';
  if (els.uploader) els.uploader.textContent = '';
  if (els.duration) els.duration.textContent = '';
  if (els.description) els.description.textContent = '';
  els.resolutionSelect.innerHTML = '';
  els.formatSelect.innerHTML = '';
  els.resolutionSelect.disabled = true;
  els.formatSelect.disabled = true;
  els.formatCount.textContent = '0';
  setDownloadReady(false);
  hideProgress();
};

const setFetchInFlight = (inFlight) => {
  state.fetchInFlight = inFlight;
  if (els.fetchBtn) {
    els.fetchBtn.classList.toggle('is-loading', inFlight);
  }
  updateFetchButtonState();
};

const updateFetchButtonState = () => {
  if (!els.fetchBtn || !els.url) return;
  const hasUrl = Boolean(els.url.value.trim());
  els.fetchBtn.disabled = state.fetchInFlight || !hasUrl;
};

const showProgress = () => {
  if (els.progressWrapper) {
    els.progressWrapper.hidden = false;
  }
};

const hideProgress = () => {
  if (els.progressWrapper) {
    els.progressWrapper.hidden = true;
  }
  setProgressIndeterminate(false);
  setProgressValue(0);
};

const setProgressIndeterminate = (active) => {
  if (!els.progressTrack) return;
  els.progressTrack.classList.toggle('indeterminate', active);
  if (active && els.progressLabel) {
    els.progressLabel.textContent = '…';
  }
};

const setProgressValue = (fraction) => {
  if (!els.progressBar || !els.progressLabel) return;
  const safe = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const percent = Math.round(safe * 100);
  els.progressBar.style.width = `${percent}%`;
  els.progressLabel.textContent = `${percent}%`;
};

const formatFileSize = (sizeInfo) => {
  if (!sizeInfo || !Number.isFinite(Number(sizeInfo.bytes))) return '';
  let bytes = Number(sizeInfo.bytes);
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  while (bytes >= 1024 && unitIndex < units.length - 1) {
    bytes /= 1024;
    unitIndex += 1;
  }
  const prefix = sizeInfo.approximate ? '≈ ' : '';
  const value = bytes >= 10 || unitIndex === 0 ? bytes.toFixed(0) : bytes.toFixed(1);
  return `${prefix}${value} ${units[unitIndex]}`;
};

const setDownloadState = (stateValue) => {
  downloadState = stateValue;
  const label = els.downloadBtnLabel;
  const icon = els.downloadBtnIcon;
  if (!label || !icon || !els.downloadBtn) return;

  els.downloadBtn.classList.toggle('is-stop', stateValue === 'running');
  els.downloadBtn.classList.toggle('is-finished', stateValue === 'finished');

  if (stateValue === 'running') {
    label.textContent = 'Stop';
    icon.textContent = '✕';
    els.downloadBtn.disabled = false;
  } else if (stateValue === 'finished') {
    label.textContent = 'Finished';
    icon.textContent = '✓';
    els.downloadBtn.disabled = true;
  } else {
    label.textContent = 'Download';
    icon.textContent = '⬇︎';
    els.downloadBtn.disabled = !downloadReady;
    els.downloadBtn.classList.remove('is-finished');
  }
};

const setDownloadReady = (ready) => {
  downloadReady = ready;
  if (downloadState === 'idle' && els.downloadBtn) {
    els.downloadBtn.disabled = !downloadReady;
  }
};

const normalizeSaveDir = (value) => (value || '').trim();

const resolveSaveDirText = (value) => {
  const trimmed = normalizeSaveDir(value);
  if (!trimmed) return state.defaultSaveDir || '';
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('~') ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    return trimmed;
  }
  if (state.baseDir) {
    const base = state.baseDir.replace(/\/$/, '');
    const relative = trimmed.replace(/^\/+/, '');
    return `${base}/${relative}`;
  }
  return trimmed;
};

const updateSaveDirDisplay = (value) => {
  state.saveDir = normalizeSaveDir(value) || state.defaultSaveDir || '';
  if (els.saveDirDisplay) {
    els.saveDirDisplay.textContent = resolveSaveDirText(state.saveDir);
  }
};

// Fill the dropdown with server supplied formats; disable it when empty.
const groupFormatsByResolution = (formats) => {
  const grouped = new Map();
  state.formatSizes = new Map();
  formats.forEach((fmt) => {
    const key = Number.isFinite(fmt.height) ? Number(fmt.height) : 'audio';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(fmt);

    if (fmt.format_id) {
      let sizeRecord = null;
      if (Number.isFinite(Number(fmt.filesize))) {
        sizeRecord = { bytes: Number(fmt.filesize), approximate: false };
      } else if (Number.isFinite(Number(fmt.filesize_approx))) {
        sizeRecord = { bytes: Number(fmt.filesize_approx), approximate: true };
      }
      if (sizeRecord) {
        state.formatSizes.set(fmt.format_id, sizeRecord);
      }
    }
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
    const detailParts = [];
    if (fmt.ext) detailParts.push(fmt.ext.toUpperCase());
    if (fmt.format_note) detailParts.push(fmt.format_note);
    if (fmt.fps) detailParts.push(`${fmt.fps}fps`);
    const sizeInfo = state.formatSizes.get(fmt.format_id);
    const sizeLabel = formatFileSize(sizeInfo);
    if (sizeLabel) detailParts.push(sizeLabel);

    const option = document.createElement('option');
    option.value = fmt.format_id;
    option.textContent = detailParts.join(' • ') || fmt.format_id;
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

const getSelectedFormatId = () => {
  if (els.formatSelect.disabled || !els.formatSelect.value) return null;
  return els.formatSelect.value;
};

const getExpectedSize = () => {
  const formatId = getSelectedFormatId();
  if (!formatId) return null;
  const sizeInfo = state.formatSizes.get(formatId);
  if (!sizeInfo) return null;
  return Number.isFinite(Number(sizeInfo.bytes)) ? Number(sizeInfo.bytes) : null;
};

const fetchInfo = async () => {
  if (!els.url) return;
  const urlValue = els.url.value.trim();
  if (!urlValue) {
    setStatus('Please enter a URL first.', 'error');
    return;
  }

  resetPreview();
  metadataController?.abort();
  metadataController = new AbortController();
  setFetchInFlight(true);
  setDownloadState('idle');
  setStatus('Fetching metadata… hang tight.');

  try {
    const res = await fetch('/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlValue }),
      signal: metadataController.signal
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch info');

    els.title.textContent = data.title || 'Untitled';
    els.uploader.textContent = data.uploader ? data.uploader : 'Unknown uploader';
    const formattedDuration = data.duration ? formatDuration(data.duration) : '00:00';
    els.duration.textContent = formattedDuration;
    if (data.description) {
      els.description.textContent = data.description;
    } else {
      els.description.textContent = 'No description provided.';
    }
    if (data.thumbnail) {
      els.thumbnail.src = data.thumbnail;
      els.thumbnail.removeAttribute('hidden');
    }
    els.infoPanel.hidden = false;

    state.formats = data.formats || [];
    state.groupedFormats = groupFormatsByResolution(state.formats);
    populateResolutionOptions();
    syncQualityControls();
    setDownloadReady(true);
    setStatus(
      `Metadata ready. Files will save to ${resolveSaveDirText(state.saveDir)}.`,
      'success'
    );
  } catch (err) {
    if (err.name === 'AbortError') {
      setStatus('Request cancelled.', 'info');
    } else {
      setStatus(err.message, 'error');
      resetPreview();
    }
  } finally {
    setFetchInFlight(false);
    metadataController = null;
  }
};

const parseFilename = (contentDisposition) => {
  if (!contentDisposition) return null;
  const match = contentDisposition.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : null;
};

const downloadVideo = async () => {
  if (!els.url) return;
  const urlValue = els.url.value.trim();
  if (!urlValue) {
    setStatus('Please enter a URL first.', 'error');
    return;
  }
  if (!downloadReady) {
    setStatus('Fetch video info before downloading.', 'error');
    return;
  }

  downloadController = new AbortController();
  setDownloadState('running');
  showProgress();
  const expectedSize = getExpectedSize();
  setProgressIndeterminate(!expectedSize);
  setProgressValue(0);
  setStatus('Downloading… this may take a moment.');

  try {
    const payload = {
      url: urlValue,
      format_id: getSelectedFormatId(),
      download_type: els.downloadType.value,
      save_dir: state.saveDir,
      preferred_name: els.downloadName?.value || undefined
    };

    const res = await fetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: downloadController.signal
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Download failed');
    }

    let contentLength = Number(res.headers.get('Content-Length'));
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      contentLength = expectedSize || null;
    }

    if (contentLength) {
      setProgressIndeterminate(false);
    } else {
      setProgressIndeterminate(true);
    }

    let blob;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength) {
          setProgressValue(received / contentLength);
        }
      }

      blob = new Blob(chunks, {
        type: res.headers.get('Content-Type') || 'application/octet-stream'
      });
    } else {
      blob = await res.blob();
    }

    setProgressIndeterminate(false);
    setProgressValue(1);

    const filename = parseFilename(res.headers.get('Content-Disposition')) || 'download';
    const objectUrl = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);

    const resolvedPath = res.headers.get('X-Download-Path');
    const resolvedDir = res.headers.get('X-Download-Dir');
    if (resolvedDir && els.saveDirDisplay) {
      els.saveDirDisplay.textContent = resolvedDir;
    }

    setStatus(
      `Download complete. Saved to ${resolvedPath || resolvedDir || resolveSaveDirText(state.saveDir)}.`,
      'success'
    );
    setDownloadState('finished');
    setTimeout(() => {
      hideProgress();
      if (downloadState === 'finished') {
        setDownloadState('idle');
      }
    }, 1800);
  } catch (err) {
    if (err.name === 'AbortError') {
      setStatus('Download cancelled.', 'info');
    } else {
      setStatus(err.message, 'error');
    }
    hideProgress();
    setDownloadState('idle');
  } finally {
    downloadController = null;
  }
};

if (els.fetchBtn) {
  els.fetchBtn.addEventListener('click', fetchInfo);
}
if (els.downloadBtn) {
  els.downloadBtn.addEventListener('click', () => {
    if (downloadState === 'running') {
      downloadController?.abort();
    } else if (downloadReady) {
      downloadVideo();
    }
  });
}
if (els.url) {
  els.url.addEventListener('keyup', (event) => {
    if (event.key === 'Enter') fetchInfo();
  });
  els.url.addEventListener('input', updateFetchButtonState);
  updateFetchButtonState();
}
if (els.resolutionSelect) {
  els.resolutionSelect.addEventListener('change', (event) => {
    populateFormatOptions(event.target.value);
  });
}
if (els.downloadType) {
  els.downloadType.addEventListener('change', () => {
    syncQualityControls();
  });
}

if (els.saveDirInput) {
  els.saveDirInput.addEventListener('input', (event) => {
    updateSaveDirDisplay(event.target.value);
  });
  updateSaveDirDisplay(els.saveDirInput.value);
}

if (els.saveDirReset) {
  els.saveDirReset.addEventListener('click', () => {
    if (els.saveDirInput) {
      els.saveDirInput.value = state.defaultSaveDir || '';
      updateSaveDirDisplay(els.saveDirInput.value);
    }
  });
}
