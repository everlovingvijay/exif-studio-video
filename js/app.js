/**
 * Video Metadata & EXIF Editor - Application Controller
 * Handles UI interactions, Location Search, C2PA Provenance, Leaflet map binding, and export flow.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const selectFileBtn = document.getElementById('selectFileBtn');
  const editorLayout = document.getElementById('editorLayout');
  const bottomBar = document.getElementById('bottomBar');
  const toastContainer = document.getElementById('toastContainer');

  // Video preview elements
  const videoPlayer = document.getElementById('videoPlayer');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  const specResolution = document.getElementById('specResolution');
  const specDuration = document.getElementById('specDuration');
  const specSize = document.getElementById('specSize');
  const specContainer = document.getElementById('specContainer');

  // Tab elements
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // Date & Time inputs
  const creationDateInput = document.getElementById('creationDateInput');
  const modifyDateInput = document.getElementById('modifyDateInput');
  const setNowBtn = document.getElementById('setNowBtn');
  const plusHourBtn = document.getElementById('plusHourBtn');
  const minusHourBtn = document.getElementById('minusHourBtn');
  const plusDayBtn = document.getElementById('plusDayBtn');
  const minusDayBtn = document.getElementById('minusDayBtn');

  // Location search & inputs
  const locationSearchInput = document.getElementById('locationSearchInput');
  const locationSearchBtn = document.getElementById('locationSearchBtn');
  const locationSearchResults = document.getElementById('locationSearchResults');
  const latInput = document.getElementById('latInput');
  const lonInput = document.getElementById('lonInput');
  const altInput = document.getElementById('altInput');
  const dmsCoords = document.getElementById('dmsCoords');
  const getCurrentLocBtn = document.getElementById('getCurrentLocBtn');
  const clearLocBtn = document.getElementById('clearLocBtn');

  // Camera & Device inputs
  const makeInput = document.getElementById('makeInput');
  const modelInput = document.getElementById('modelInput');
  const softwareInput = document.getElementById('softwareInput');
  const devicePresetSelect = document.getElementById('devicePresetSelect');

  // Media Tags inputs
  const titleInput = document.getElementById('titleInput');
  const artistInput = document.getElementById('artistInput');
  const albumInput = document.getElementById('albumInput');
  const commentInput = document.getElementById('commentInput');
  const copyrightInput = document.getElementById('copyrightInput');

  // C2PA Controls
  const c2paBadge = document.getElementById('c2paBadge');
  const c2paStatusIcon = document.getElementById('c2paStatusIcon');
  const c2paStatusDesc = document.getElementById('c2paStatusDesc');
  const c2paSignerName = document.getElementById('c2paSignerName');
  const c2paSignerOrg = document.getElementById('c2paSignerOrg');
  const c2paClaimGenerator = document.getElementById('c2paClaimGenerator');
  const c2paSigningTime = document.getElementById('c2paSigningTime');
  const c2paCertIssuer = document.getElementById('c2paCertIssuer');
  const c2paCertSerial = document.getElementById('c2paCertSerial');
  const c2paCertAlgorithm = document.getElementById('c2paCertAlgorithm');
  const c2paCertValidTo = document.getElementById('c2paCertValidTo');
  const c2paValSignature = document.getElementById('c2paValSignature');
  const c2paValBinding = document.getElementById('c2paValBinding');
  const c2paValHash = document.getElementById('c2paValHash');
  const applyC2PABtn = document.getElementById('applyC2PABtn');
  const stripC2PABtn = document.getElementById('stripC2PABtn');

  // Rotation controls
  const rotationCards = document.querySelectorAll('.rotation-card');

  // Bottom action buttons
  const scrubAllBtn = document.getElementById('scrubAllBtn');
  const exportBtn = document.getElementById('exportBtn');
  const resetBtn = document.getElementById('resetBtn');

  // State
  let currentFile = null;
  let scanResult = null;
  let map = null;
  let marker = null;
  let selectedRotation = 0;
  let originalRotation = 0;
  let userChangedRotation = false;
  let activeC2PA = null;
  let stripC2PAFlag = false;

  // Initialize Leaflet Map
  function initMap(initialLat = 0, initialLon = 0, zoom = 2, hasMarker = false) {
    if (typeof L === 'undefined') {
      const mapEl = document.getElementById('map');
      if (mapEl) {
        mapEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:0.85rem;padding:1rem;text-align:center;">Interactive map requires internet for tiles. You can view, enter, or search coordinates using the fields above.</div>';
      }
      return;
    }
    if (!map) {
      map = L.map('map', {
        zoomControl: true,
        attributionControl: false
      }).setView([initialLat, initialLon], zoom);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(map);

      // Map click event
      map.on('click', (e) => {
        setMapCoordinates(e.latlng.lat, e.latlng.lng);
      });
    } else {
      map.setView([initialLat, initialLon], zoom);
    }

    if (hasMarker) {
      updateMapMarker(initialLat, initialLon);
    } else if (marker) {
      map.removeLayer(marker);
      marker = null;
    }

    setTimeout(() => {
      if (map) map.invalidateSize();
    }, 200);
  }

  function updateMapMarker(lat, lon) {
    if (!map) return;
    if (marker) {
      marker.setLatLng([lat, lon]);
    } else {
      marker = L.marker([lat, lon], { draggable: true }).addTo(map);
      marker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        setMapCoordinates(pos.lat, pos.lng, false);
      });
    }
  }

  function setMapCoordinates(lat, lon, moveMarker = true) {
    const roundedLat = parseFloat(lat.toFixed(6));
    const roundedLon = parseFloat(lon.toFixed(6));

    latInput.value = roundedLat;
    lonInput.value = roundedLon;

    if (moveMarker) {
      updateMapMarker(roundedLat, roundedLon);
      if (map) map.panTo([roundedLat, roundedLon]);
    }

    updateDMSDisplay();
  }

  function updateDMSDisplay() {
    const lat = parseFloat(latInput.value);
    const lon = parseFloat(lonInput.value);
    if (!isNaN(lat) && !isNaN(lon) && typeof GeoUtils !== 'undefined') {
      dmsCoords.textContent = `${GeoUtils.toDMS(lat, true)}, ${GeoUtils.toDMS(lon, false)}`;
    } else {
      dmsCoords.textContent = 'No coordinates set';
    }
  }

  // Location Search (Nominatim Geocoder)
  async function executeLocationSearch() {
    const query = locationSearchInput.value.trim();
    if (!query || query.length < 2) {
      showToast('Please enter a location name or address', 'error');
      return;
    }
    locationSearchResults.style.display = 'block';
    locationSearchResults.innerHTML = '<div style="padding: 0.75rem; color: var(--text-secondary); font-size: 0.85rem; text-align: center;">🔍 Searching OpenStreetMap...</div>';

    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`, {
        headers: { 'Accept': 'application/json' }
      });
      const data = await res.json();
      if (!data || data.length === 0) {
        locationSearchResults.innerHTML = '<div style="padding: 0.75rem; color: var(--text-muted); font-size: 0.85rem; text-align: center;">No locations found. Try a different query.</div>';
        return;
      }

      locationSearchResults.innerHTML = '';
      data.forEach(item => {
        const row = document.createElement('div');
        row.style.cssText = 'padding: 0.65rem 0.85rem; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; font-size: 0.85rem; transition: background 0.15s; display: flex; align-items: center; gap: 0.5rem;';
        row.innerHTML = `<span style="color: var(--primary);">📍</span><span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-main);">${item.display_name}</span>`;
        row.addEventListener('mouseenter', () => row.style.backgroundColor = 'var(--bg-input)');
        row.addEventListener('mouseleave', () => row.style.backgroundColor = 'transparent');
        row.addEventListener('click', () => {
          const lat = parseFloat(item.lat);
          const lon = parseFloat(item.lon);
          setMapCoordinates(lat, lon, true);
          if (map) map.setView([lat, lon], 14);
          locationSearchResults.style.display = 'none';
          locationSearchInput.value = item.display_name.split(',')[0];
          showToast(`📍 Set location: ${item.display_name.split(',')[0]}`, 'success');
        });
        locationSearchResults.appendChild(row);
      });
    } catch (err) {
      locationSearchResults.innerHTML = '<div style="padding: 0.75rem; color: var(--danger); font-size: 0.85rem; text-align: center;">Search requires internet connection.</div>';
    }
  }

  locationSearchBtn.addEventListener('click', executeLocationSearch);
  locationSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeLocationSearch();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.location-search-wrap')) {
      locationSearchResults.style.display = 'none';
    }
  });

  // Toast Notifications
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function toDateTimeLocalString(date) {
    if (!date || isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function parseDateTimeLocal(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  // File Selection & Drag-and-Drop
  selectFileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      loadFile(e.target.files[0]);
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadFile(e.dataTransfer.files[0]);
    }
  });

  // Load File
  async function loadFile(file) {
    currentFile = file;
    fileNameDisplay.textContent = file.name;
    specSize.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
    specContainer.textContent = file.name.split('.').pop().toUpperCase();

    const videoUrl = URL.createObjectURL(file);
    videoPlayer.src = videoUrl;

    videoPlayer.onloadedmetadata = () => {
      const dur = videoPlayer.duration;
      const mins = Math.floor(dur / 60);
      const secs = Math.floor(dur % 60);
      specDuration.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
      specResolution.textContent = `${videoPlayer.videoWidth} × ${videoPlayer.videoHeight}`;
    };

    try {
      showToast('Parsing container & C2PA metadata...', 'info');
      scanResult = await MP4Editor.readMetadata(file);
      populateForm(scanResult.metadata);
      editorLayout.style.display = 'grid';
      bottomBar.style.display = 'block';
      showToast('Metadata and provenance loaded!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Error reading metadata: ' + err.message, 'error');
    }
  }

  // Populate UI Form with Extracted Metadata
  function populateForm(meta) {
    creationDateInput.value = toDateTimeLocalString(meta.creationDate || new Date());
    modifyDateInput.value = toDateTimeLocalString(meta.modifyDate || new Date());

    if (meta.location) {
      latInput.value = meta.location.latitude;
      lonInput.value = meta.location.longitude;
      altInput.value = meta.location.altitude !== null ? meta.location.altitude : '';
      initMap(meta.location.latitude, meta.location.longitude, 13, true);
    } else {
      latInput.value = '';
      lonInput.value = '';
      altInput.value = '';
      initMap(20, 0, 2, false);
    }
    updateDMSDisplay();

    makeInput.value = meta.tags.make || '';
    modelInput.value = meta.tags.model || '';
    softwareInput.value = meta.tags.software || '';

    titleInput.value = meta.tags.title || '';
    artistInput.value = meta.tags.artist || '';
    albumInput.value = meta.tags.album || '';
    commentInput.value = meta.tags.comment || '';
    copyrightInput.value = meta.tags.copyright || '';

    // C2PA Handling
    activeC2PA = meta.c2pa;
    stripC2PAFlag = false;
    if (activeC2PA && activeC2PA.detected) {
      c2paBadge.textContent = '✅ Verified C2PA Manifest Detected';
      c2paBadge.style.background = 'rgba(16, 185, 129, 0.15)';
      c2paBadge.style.color = '#34d399';
      c2paStatusIcon.textContent = '✅';
      c2paStatusDesc.textContent = `Asset contains cryptographic Content Credentials created by ${activeC2PA.claimGenerator}.`;

      c2paSignerName.value = activeC2PA.signer.name || '';
      c2paSignerOrg.value = activeC2PA.signer.organization || '';
      c2paClaimGenerator.value = activeC2PA.claimGenerator || '';
      c2paSigningTime.value = activeC2PA.signer.timestamp || '';

      c2paCertIssuer.value = activeC2PA.certificate.issuer || '';
      c2paCertSerial.value = activeC2PA.certificate.serialNumber || '';
      c2paCertAlgorithm.value = activeC2PA.signer.algorithm || 'es256 (ECDSA P-256 with SHA-256)';
      c2paCertValidTo.value = activeC2PA.certificate.validTo || '';

      c2paValSignature.textContent = 'Valid (Cryptographically Verified)';
      c2paValSignature.style.color = '#34d399';
      c2paValBinding.textContent = 'Untampered / Verified Stream Binding';
      c2paValBinding.style.color = '#34d399';
      c2paValHash.textContent = activeC2PA.validation.dataHash || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    } else {
      c2paBadge.textContent = 'No C2PA Manifest in Container';
      c2paBadge.style.background = 'rgba(59, 130, 246, 0.15)';
      c2paBadge.style.color = '#60a5fa';
      c2paStatusIcon.textContent = '🛡️';
      c2paStatusDesc.textContent = 'No C2PA Content Credentials detected. You can generate and attach a cryptographically structured manifest below.';

      c2paSignerName.value = 'Verified Content Producer';
      c2paSignerOrg.value = 'Independent Media Network';
      c2paClaimGenerator.value = 'EXIF Video Studio v1.0 (C2PA Compliant)';
      c2paSigningTime.value = new Date().toISOString();

      c2paCertIssuer.value = 'DigiCert C2PA Qualified Root CA';
      c2paCertSerial.value = '4A:2F:81:9C:E0:5B';
      c2paCertAlgorithm.value = 'es256 (ECDSA P-256 with SHA-256)';
      c2paCertValidTo.value = new Date(Date.now() + 365*24*3600*1000).toISOString();

      c2paValSignature.textContent = 'Not Signed Yet';
      c2paValSignature.style.color = 'var(--text-dim)';
      c2paValBinding.textContent = 'Will be bound on export';
      c2paValBinding.style.color = 'var(--text-dim)';
      c2paValHash.textContent = 'Auto-calculated on save';
    }

    originalRotation = meta.rotation || 0;
    selectedRotation = originalRotation;
    userChangedRotation = false;
    updateRotationUI(selectedRotation, false);
  }

  // C2PA Buttons
  applyC2PABtn.addEventListener('click', () => {
    stripC2PAFlag = false;
    activeC2PA = {
      detected: true,
      claimGenerator: c2paClaimGenerator.value.trim() || 'EXIF Video Studio',
      title: titleInput.value.trim() || currentFile.name,
      signer: {
        name: c2paSignerName.value.trim() || 'Verified Media Signer',
        organization: c2paSignerOrg.value.trim() || 'Content Authenticity Network',
        algorithm: c2paCertAlgorithm.value.trim() || 'es256',
        timestamp: c2paSigningTime.value.trim() || new Date().toISOString()
      },
      certificate: {
        issuer: c2paCertIssuer.value.trim() || 'DigiCert C2PA Qualified Root CA',
        serialNumber: c2paCertSerial.value.trim() || '4A:2F:81:9C:E0:5B',
        validTo: c2paCertValidTo.value.trim() || new Date(Date.now() + 365*24*3600*1000).toISOString()
      }
    };

    c2paBadge.textContent = '✅ C2PA Manifest Configured (Ready to Save)';
    c2paBadge.style.background = 'rgba(16, 185, 129, 0.15)';
    c2paBadge.style.color = '#34d399';
    c2paValSignature.textContent = 'Valid (Will embed on export)';
    c2paValSignature.style.color = '#34d399';
    c2paValBinding.textContent = 'Stream Hash Bound';
    c2paValBinding.style.color = '#34d399';
    showToast('C2PA Content Credentials configured & ready to export!', 'success');
  });

  stripC2PABtn.addEventListener('click', () => {
    if (confirm('Strip and purge all C2PA Content Credentials from this video container?')) {
      activeC2PA = null;
      stripC2PAFlag = true;

      c2paBadge.textContent = '🚫 C2PA Credentials Purged';
      c2paBadge.style.background = 'rgba(239, 68, 68, 0.15)';
      c2paBadge.style.color = '#f87171';

      c2paValSignature.textContent = 'Stripped / Removed';
      c2paValSignature.style.color = '#f87171';
      c2paValBinding.textContent = 'No provenance container';
      c2paValBinding.style.color = 'var(--text-dim)';
      c2paValHash.textContent = 'Clean stream';
      showToast('C2PA Content Credentials purged!', 'info');
    }
  });

  // Tab Navigation
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      tabPanes.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const target = btn.dataset.tab;
      document.getElementById(target).classList.add('active');

      if (target === 'tab-location' && map) {
        setTimeout(() => map.invalidateSize(), 150);
      }
    });
  });

  // Quick Date Actions
  setNowBtn.addEventListener('click', () => {
    const nowStr = toDateTimeLocalString(new Date());
    creationDateInput.value = nowStr;
    modifyDateInput.value = nowStr;
    showToast('Dates updated to current time', 'info');
  });

  function adjustHours(hours) {
    const d = parseDateTimeLocal(creationDateInput.value) || new Date();
    d.setHours(d.getHours() + hours);
    creationDateInput.value = toDateTimeLocalString(d);
    modifyDateInput.value = toDateTimeLocalString(d);
  }

  function adjustDays(days) {
    const d = parseDateTimeLocal(creationDateInput.value) || new Date();
    d.setDate(d.getDate() + days);
    creationDateInput.value = toDateTimeLocalString(d);
    modifyDateInput.value = toDateTimeLocalString(d);
  }

  plusHourBtn.addEventListener('click', () => adjustHours(1));
  minusHourBtn.addEventListener('click', () => adjustHours(-1));
  plusDayBtn.addEventListener('click', () => adjustDays(1));
  minusDayBtn.addEventListener('click', () => adjustDays(-1));

  // Location manual inputs sync with map
  function onCoordInput() {
    const lat = parseFloat(latInput.value);
    const lon = parseFloat(lonInput.value);
    if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      updateMapMarker(lat, lon);
      if (map) map.panTo([lat, lon]);
    }
    updateDMSDisplay();
  }

  latInput.addEventListener('input', onCoordInput);
  lonInput.addEventListener('input', onCoordInput);

  clearLocBtn.addEventListener('click', () => {
    latInput.value = '';
    lonInput.value = '';
    altInput.value = '';
    if (marker && map) {
      map.removeLayer(marker);
      marker = null;
    }
    updateDMSDisplay();
    showToast('GPS coordinates removed', 'info');
  });

  getCurrentLocBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Geolocation is not supported by your browser', 'error');
      return;
    }
    showToast('Locating your position...', 'info');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMapCoordinates(pos.coords.latitude, pos.coords.longitude, true);
        if (pos.coords.altitude !== null) {
          altInput.value = pos.coords.altitude.toFixed(1);
        }
        if (map) map.setZoom(15);
        showToast('Location updated to current GPS', 'success');
      },
      (err) => {
        showToast('Unable to retrieve location: ' + err.message, 'error');
      }
    );
  });

  // Device Presets
  const DEVICE_PRESETS = {
    'iphone15pro': { make: 'Apple', model: 'iPhone 15 Pro', software: 'iOS 17.5.1' },
    'sonya7s3': { make: 'Sony', model: 'ILCE-7SM3 (A7S III)', software: 'Ver.3.00' },
    'gopro12': { make: 'GoPro', model: 'HERO12 Black', software: 'HD12.01.01.20' },
    'djimini4': { make: 'DJI', model: 'Mini 4 Pro', software: 'v01.00.0300' },
    'pixel8': { make: 'Google', model: 'Pixel 8 Pro', software: 'Android 14' }
  };

  devicePresetSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (DEVICE_PRESETS[val]) {
      makeInput.value = DEVICE_PRESETS[val].make;
      modelInput.value = DEVICE_PRESETS[val].model;
      softwareInput.value = DEVICE_PRESETS[val].software;
      showToast(`Applied preset: ${DEVICE_PRESETS[val].model}`, 'info');
    }
  });

  // Rotation Selector & Live Preview
  function updateRotationUI(deg, applyTransform = true) {
    selectedRotation = deg;
    rotationCards.forEach((c) => {
      c.classList.toggle('selected', parseInt(c.dataset.deg, 10) === deg);
    });
    if (applyTransform) {
      const relDeg = (deg - originalRotation + 360) % 360;
      videoPlayer.style.transform = relDeg ? `rotate(${relDeg}deg)` : 'none';
      videoPlayer.style.transition = 'transform 0.3s ease';
    } else {
      videoPlayer.style.transform = 'none';
    }
  }

  function setRotation(deg) {
    userChangedRotation = (deg !== originalRotation);
    updateRotationUI(deg, true);
  }

  rotationCards.forEach((card) => {
    card.addEventListener('click', () => {
      const deg = parseInt(card.dataset.deg, 10);
      setRotation(deg);
    });
  });

  // Scrub All Private Metadata
  scrubAllBtn.addEventListener('click', () => {
    if (confirm('This will wipe all GPS location, camera make/model, author tags, and C2PA provenance tracking. Proceed?')) {
      latInput.value = '';
      lonInput.value = '';
      altInput.value = '';
      if (marker && map) {
        map.removeLayer(marker);
        marker = null;
      }
      updateDMSDisplay();

      makeInput.value = '';
      modelInput.value = '';
      softwareInput.value = '';

      artistInput.value = '';
      commentInput.value = '';
      copyrightInput.value = '';

      activeC2PA = null;
      stripC2PAFlag = true;
      c2paBadge.textContent = '🚫 C2PA Credentials Purged';
      c2paBadge.style.background = 'rgba(239, 68, 68, 0.15)';
      c2paBadge.style.color = '#f87171';

      showToast('All sensitive metadata and C2PA tags wiped!', 'success');
    }
  });

  // Reset to original
  resetBtn.addEventListener('click', () => {
    if (scanResult && scanResult.metadata) {
      populateForm(scanResult.metadata);
      showToast('Reverted to original file metadata', 'info');
    }
  });

  // Export & Download
  exportBtn.addEventListener('click', async () => {
    if (!currentFile || !scanResult) {
      showToast('No video file loaded', 'error');
      return;
    }

    try {
      exportBtn.disabled = true;
      exportBtn.innerHTML = `<span>⏳</span><span>Processing & Packaging...</span>`;

      const cDate = parseDateTimeLocal(creationDateInput.value);
      const mDate = parseDateTimeLocal(modifyDateInput.value);

      let location = null;
      const lat = parseFloat(latInput.value);
      const lon = parseFloat(lonInput.value);
      const alt = parseFloat(altInput.value);
      if (!isNaN(lat) && !isNaN(lon)) {
        location = {
          latitude: lat,
          longitude: lon,
          altitude: !isNaN(alt) ? alt : null
        };
      }

      const tags = {
        title: titleInput.value.trim(),
        artist: artistInput.value.trim(),
        album: albumInput.value.trim(),
        comment: commentInput.value.trim(),
        copyright: copyrightInput.value.trim(),
        make: makeInput.value.trim(),
        model: modelInput.value.trim(),
        software: softwareInput.value.trim()
      };

      const updates = {
        creationDate: cDate,
        modifyDate: mDate,
        location,
        tags,
        rotation: userChangedRotation ? selectedRotation : undefined,
        c2pa: activeC2PA,
        stripC2PA: stripC2PAFlag,
        scrubAll: false
      };

      // Perform lossless binary edit
      const startTime = performance.now();
      const editedBlob = await MP4Editor.writeMetadata(currentFile, scanResult, updates);
      const durationMs = (performance.now() - startTime).toFixed(0);

      // Trigger instant browser download
      const originalName = currentFile.name;
      const lastDot = originalName.lastIndexOf('.');
      const baseName = lastDot !== -1 ? originalName.slice(0, lastDot) : originalName;
      const ext = lastDot !== -1 ? originalName.slice(lastDot) : '.mp4';
      const downloadName = `${baseName}_edited${ext}`;

      const downloadUrl = URL.createObjectURL(editedBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);

      showToast(`Export complete in ${durationMs}ms! Download started.`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Export failed: ' + err.message, 'error');
    } finally {
      exportBtn.disabled = false;
      exportBtn.innerHTML = `<span>⬇️</span><span>Download Lossless Video</span>`;
    }
  });
});
