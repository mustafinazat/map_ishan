const DATA_URL = "./data/events.json";
const CAN_USE_REMOTE_TILES = window.location.protocol === "http:" || window.location.protocol === "https:";

const payloadState = {
  data: null,
  promise: null,
};

document.addEventListener("DOMContentLoaded", async () => {
  initNavigation();

  const page = document.body.dataset.page;
  if (!page) {
    return;
  }

  try {
    switch (page) {
      case "home":
        await initHomePage();
        break;
      case "track":
        await initTrackPage();
        break;
      case "heatmap":
        await initHeatmapPage();
        break;
      default:
        break;
    }
  } catch (error) {
    console.error(error);
    const statusNode = document.querySelector("[data-status]");
    if (statusNode) {
      statusNode.textContent = "Не удалось загрузить данные или карту. Проверьте локальный сервер и обновите страницу.";
    }
  }
});

function initNavigation() {
  const header = document.querySelector(".site-nav");
  const toggle = document.getElementById("siteNavToggle");
  const menu = document.getElementById("siteNavMenu");
  if (!header || !toggle || !menu) {
    return;
  }

  const closeMenu = () => {
    header.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => {
    const isOpen = header.classList.toggle("nav-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });

  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("click", (event) => {
    if (!header.contains(event.target) && window.matchMedia("(max-width: 920px)").matches) {
      closeMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (!window.matchMedia("(max-width: 920px)").matches) {
      closeMenu();
    }
  });
}

async function loadPayload() {
  if (payloadState.data) {
    return payloadState.data;
  }

  if (window.__GEO_DATA__) {
    payloadState.data = window.__GEO_DATA__;
    return payloadState.data;
  }

  if (!payloadState.promise) {
    payloadState.promise = fetch(DATA_URL, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load events: HTTP ${response.status}`);
      }

      const payload = await response.json();
      payloadState.data = payload;
      return payload;
    });
  }

  return payloadState.promise;
}

function ensureLeaflet() {
  if (!window.L) {
    throw new Error("Leaflet is unavailable.");
  }
}

function createBaseMap(elementId, options = {}) {
  ensureLeaflet();
  const { offlineLocations = [], ...leafletOptions } = options;

  const map = L.map(elementId, {
    zoomControl: false,
    attributionControl: CAN_USE_REMOTE_TILES,
    preferCanvas: true,
    worldCopyJump: false,
    ...leafletOptions,
  });

  L.control.zoom({ position: leafletOptions.zoomControlPosition || "topright" }).addTo(map);

  if (CAN_USE_REMOTE_TILES) {
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      referrerPolicy: "strict-origin-when-cross-origin",
    }).addTo(map);
  } else {
    map.getContainer().classList.add("map-canvas--offline");
    addOfflineBasemap(map, offlineLocations);
  }

  return map;
}

function ensureMapPane(map, name, zIndex) {
  const pane = map.getPane(name) || map.createPane(name);
  pane.style.zIndex = String(zIndex);
  pane.style.pointerEvents = "none";
  return pane;
}

function haversineDistanceKm(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const arc =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

function pickOfflineLabelLocations(locations, limit = 14) {
  const picked = [];
  const sorted = [...locations].sort((left, right) => {
    const diff = Number(right.visitCount || 0) - Number(left.visitCount || 0);
    if (diff !== 0) {
      return diff;
    }
    return left.name.localeCompare(right.name, "ru");
  });

  sorted.forEach((location) => {
    if (picked.length >= limit) {
      return;
    }

    const tooClose = picked.some((entry) => haversineDistanceKm(entry, location) < 260);
    if (!tooClose) {
      picked.push(location);
    }
  });

  return picked;
}

function addOfflineBasemap(map, locations = []) {
  ensureMapPane(map, "offline-frame-pane", 120);
  ensureMapPane(map, "offline-grid-pane", 140);
  ensureMapPane(map, "offline-label-pane", 160);

  for (let latitude = -80; latitude <= 80; latitude += 10) {
    const isMajor = latitude % 20 === 0;
    L.polyline(
      [
        [latitude, -180],
        [latitude, 180],
      ],
      {
        pane: "offline-grid-pane",
        interactive: false,
        color: isMajor ? "rgba(173, 214, 238, 0.32)" : "rgba(173, 214, 238, 0.14)",
        weight: isMajor ? 1.1 : 0.8,
        dashArray: isMajor ? "8 10" : "4 14",
      },
    ).addTo(map);
  }

  for (let longitude = -180; longitude <= 180; longitude += 10) {
    const isMajor = longitude % 20 === 0;
    L.polyline(
      [
        [-85, longitude],
        [85, longitude],
      ],
      {
        pane: "offline-grid-pane",
        interactive: false,
        color: isMajor ? "rgba(255, 196, 132, 0.26)" : "rgba(255, 196, 132, 0.12)",
        weight: isMajor ? 1.05 : 0.75,
        dashArray: isMajor ? "8 10" : "4 14",
      },
    ).addTo(map);
  }

  if (!locations.length) {
    return;
  }

  const bounds = L.latLngBounds(locations.map((location) => [location.lat, location.lng]));
  if (bounds.isValid()) {
    L.rectangle(bounds.pad(0.18), {
      pane: "offline-frame-pane",
      interactive: false,
      color: "rgba(255, 236, 205, 0.34)",
      weight: 1.2,
      dashArray: "10 14",
      fill: false,
    }).addTo(map);
  }

  pickOfflineLabelLocations(locations).forEach((location, index) => {
    L.marker([location.lat, location.lng], {
      pane: "offline-label-pane",
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: `offline-map-label${index < 5 ? " offline-map-label--strong" : ""}`,
        html: `<span>${escapeHtml(location.name)}</span>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      }),
    }).addTo(map);
  });
}

function fitMapToEvents(map, events, padding = [60, 60]) {
  const bounds = L.latLngBounds(events.map((event) => [event.lat, event.lng]));
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding });
  }
}

function buildLocationsMap(locations) {
  return new Map(locations.map((location) => [location.key, location]));
}

function formatIsoDate(value) {
  if (!value) {
    return "—";
  }

  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) {
    return String(value);
  }

  return `${day}.${month}.${year}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function attachRangeProgress(rangeInput) {
  const update = () => {
    const min = Number(rangeInput.min || 0);
    const max = Number(rangeInput.max || 100);
    const value = Number(rangeInput.value || 0);
    const progress = max === min ? 0 : ((value - min) / (max - min)) * 100;
    rangeInput.style.setProperty("--range-progress", `${progress}%`);
  };

  rangeInput.addEventListener("input", update);
  update();
  return update;
}

function getTopLocations(locations, metric, limit = 6) {
  const metricKey = metric === "duration" ? "totalDays" : "visitCount";
  return [...locations]
    .sort((left, right) => {
      const diff = Number(right[metricKey]) - Number(left[metricKey]);
      if (diff !== 0) {
        return diff;
      }
      return left.name.localeCompare(right.name, "ru");
    })
    .slice(0, limit);
}

function buildHeatPoints(locations, metric) {
  const metricKey = metric === "duration" ? "totalDays" : "visitCount";
  const maxValue = Math.max(...locations.map((location) => Number(location[metricKey]) || 0), 1);

  return locations.map((location) => {
    const raw = Number(location[metricKey]) || 0;
    const ratio = raw / maxValue;
    const intensity = clamp(0.38 + 1.02 * ratio, 0.38, 1.28);
    return [location.lat, location.lng, intensity];
  });
}

function buildNarrative(event, location, previousEvent) {
  const fragments = [];

  if (event.date.isRange) {
    fragments.push(
      `В этой точке отражён период пребывания в локации «${event.name}» с ${formatIsoDate(event.date.start)} по ${formatIsoDate(event.date.end)}.`,
    );
  } else {
    fragments.push(`В хронологии отмечена точка «${event.name}» на дату ${event.date.label}.`);
  }

  if (location) {
    if (location.visitCount > 1) {
      fragments.push(
        `Локация встречается ${location.visitCount} раз и суммарно набирает ${location.totalDays} дней присутствия в исходных данных.`,
      );
    } else {
      fragments.push("Локация появляется в маршруте только один раз.");
    }
  }

  if (previousEvent) {
    fragments.push(`Предыдущая точка маршрута: ${previousEvent.name}.`);
  }

  return fragments.join(" ");
}

function buildHomeDescription(event) {
  const coords = `${event.lat.toFixed(4)}, ${event.lng.toFixed(4)}`;
  if (event.date.isRange) {
    return `Период пребывания: ${formatIsoDate(event.date.start)} - ${formatIsoDate(event.date.end)}.`;
  }

  return ``;
}

function buildEventPopup(event) {
  return `
    <span class="popup-title">${escapeHtml(event.name)}</span>
    <span class="popup-subtitle">${escapeHtml(event.date.label)}</span>
  `;
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized;
  const intValue = Number.parseInt(value, 16);
  return {
    r: (intValue >> 16) & 255,
    g: (intValue >> 8) & 255,
    b: intValue & 255,
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function mixHexColors(startHex, endHex, amount) {
  const start = hexToRgb(startHex);
  const end = hexToRgb(endHex);
  return rgbToHex({
    r: start.r + (end.r - start.r) * amount,
    g: start.g + (end.g - start.g) * amount,
    b: start.b + (end.b - start.b) * amount,
  });
}

function getTrackColor(progress) {
  const stops = [
    { t: 0, color: "#1f63ff" },
    { t: 0.2, color: "#42a6ff" },
    { t: 0.4, color: "#23d5c4" },
    { t: 0.68, color: "#ff9a3c" },
    { t: 0.86, color: "#ff5b35" },
    { t: 1, color: "#ffd34f" },
  ];

  if (progress <= 0) {
    return stops[0].color;
  }
  if (progress >= 1) {
    return stops[stops.length - 1].color;
  }

  for (let index = 1; index < stops.length; index += 1) {
    if (progress <= stops[index].t) {
      const left = stops[index - 1];
      const right = stops[index];
      const localProgress = (progress - left.t) / (right.t - left.t);
      return mixHexColors(left.color, right.color, localProgress);
    }
  }

  return stops[stops.length - 1].color;
}

async function initHomePage() {
  const payload = await loadPayload();
  ensureLeaflet();

  const events = payload.events;
  const dom = {
    slider: document.getElementById("homeSlider"),
    minDate: document.getElementById("homeMinDate"),
    maxDate: document.getElementById("homeMaxDate"),
    eventName: document.getElementById("homeEventName"),
    eventCardDate: document.getElementById("homeCardDate"),
    descriptionText: document.getElementById("homeDescriptionText"),
    prevBtn: document.getElementById("homePrevBtn"),
    playBtn: document.getElementById("homePlayBtn"),
    nextBtn: document.getElementById("homeNextBtn"),
    speedSelect: document.getElementById("homeSpeedSelect"),
  };

  const map = createBaseMap("homeMap", {
    zoomControlPosition: "topright",
    offlineLocations: payload.locations,
  });
  const updateRangeVisual = attachRangeProgress(dom.slider);

  const allCoordinates = events.map((event) => [event.lat, event.lng]);
  const baseTrack = L.polyline(allCoordinates, {
    color: "rgba(214, 232, 246, 0.28)",
    weight: 3,
    opacity: 0.9,
    dashArray: "7 12",
  }).addTo(map);

  const activeTrack = L.polyline([], {
    color: "#86d0ff",
    weight: 6,
    opacity: 1,
    lineJoin: "round",
  }).addTo(map);

  const pointsLayer = L.layerGroup().addTo(map);
  const markers = events.map((event, index) => {
    const marker = L.circleMarker([event.lat, event.lng], {
      radius: 6,
      color: "#f5fbff",
      weight: 1.2,
      fillColor: "#3b617d",
      fillOpacity: 0.82,
    });

    marker.bindPopup(buildEventPopup(event));
    marker.on("click", () => {
      stopPlayback();
      setCurrentIndex(index);
    });
    marker.addTo(pointsLayer);
    return marker;
  });

  const currentMarker = L.circleMarker(allCoordinates[0], {
    radius: 11,
    color: "#ffffff",
    weight: 3,
    fillColor: "#ff8757",
    fillOpacity: 1,
  }).addTo(map);

  fitMapToEvents(map, events, [80, 80]);
  map.setZoom(Math.max(map.getZoom() - 1, 3));

  let currentIndex = 0;
  let isPlaying = false;
  let timerId = null;
  let speed = Number(dom.speedSelect.value || 1000);

  function renderPlayButton() {
    dom.playBtn.innerHTML = `<span aria-hidden="true">${isPlaying ? "&#10074;&#10074;" : "&#9654;"}</span>`;
    dom.playBtn.setAttribute("aria-label", isPlaying ? "Пауза" : "Воспроизвести");
    dom.playBtn.setAttribute("title", isPlaying ? "Пауза" : "Воспроизвести");
  }

  dom.slider.min = "0";
  dom.slider.max = String(Math.max(events.length - 1, 0));
  dom.slider.value = "0";
  dom.minDate.textContent = formatIsoDate(payload.source.minDate);
  dom.maxDate.textContent = formatIsoDate(payload.source.maxDate);

  dom.prevBtn.addEventListener("click", () => setCurrentIndex(currentIndex - 1));
  dom.nextBtn.addEventListener("click", () => setCurrentIndex(currentIndex + 1));
  dom.playBtn.addEventListener("click", () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }

    if (currentIndex >= events.length - 1) {
      setCurrentIndex(0, { animate: false });
    }

    isPlaying = true;
    renderPlayButton();
    scheduleNextTick();
  });

  dom.slider.addEventListener("input", () => {
    stopPlayback();
    setCurrentIndex(Number(dom.slider.value), { animate: false, updateSlider: false });
  });

  dom.speedSelect.addEventListener("change", () => {
    speed = Number(dom.speedSelect.value || 1000);

    if (isPlaying) {
      scheduleNextTick();
    }
  });

  function scheduleNextTick() {
    clearTimeout(timerId);
    timerId = window.setTimeout(() => {
      if (currentIndex >= events.length - 1) {
        stopPlayback();
        return;
      }

      setCurrentIndex(currentIndex + 1);
      scheduleNextTick();
    }, speed);
  }

  function stopPlayback() {
    isPlaying = false;
    renderPlayButton();
    clearTimeout(timerId);
    timerId = null;
  }

  function setCurrentIndex(nextIndex, options = {}) {
    const { animate = true, updateSlider = true } = options;
    currentIndex = clamp(nextIndex, 0, events.length - 1);
    const event = events[currentIndex];

    activeTrack.setLatLngs(events.slice(0, currentIndex + 1).map((item) => [item.lat, item.lng]));
    currentMarker.setLatLng([event.lat, event.lng]);
    currentMarker.bindTooltip(event.name, { direction: "top", offset: [0, -14], opacity: 0.92 });

    markers.forEach((marker, index) => {
      if (index === currentIndex) {
        marker.setStyle({
          radius: 9,
          color: "#ffffff",
          weight: 2.2,
          fillColor: "#ff8757",
          fillOpacity: 1,
        });
      } else if (index < currentIndex) {
        marker.setStyle({
          radius: 6.5,
          color: "#dff6ff",
          weight: 1.2,
          fillColor: "#5cbdf2",
          fillOpacity: 0.95,
        });
      } else {
        marker.setStyle({
          radius: 5,
          color: "#ffffff",
          weight: 1,
          fillColor: "#5c6770",
          fillOpacity: 0.55,
        });
      }
    });

    dom.eventName.textContent = event.name;
    dom.eventCardDate.textContent = event.date.label;
    dom.descriptionText.textContent = buildHomeDescription(event);

    if (updateSlider) {
      dom.slider.value = String(currentIndex);
      updateRangeVisual();
    }

    map.flyTo([event.lat, event.lng], Math.max(map.getZoom(), 4), {
      animate,
      duration: animate ? 1.1 : 0.01,
    });
  }

  renderPlayButton();
  setCurrentIndex(0, { animate: false });
  updateRangeVisual();
}

async function initTrackPage() {
  const payload = await loadPayload();
  ensureLeaflet();

  const events = payload.events;
  const dom = {
    focusName: document.getElementById("trackFocusName"),
    focusDate: document.getElementById("trackFocusDate"),
    fitBtn: document.getElementById("trackFitBtn"),
    startBtn: document.getElementById("trackStartBtn"),
    endBtn: document.getElementById("trackEndBtn"),
    listPrevBtn: document.getElementById("trackListPrevBtn"),
    listNextBtn: document.getElementById("trackListNextBtn"),
    list: document.getElementById("trackList"),
  };

  const map = createBaseMap("trackMap", {
    zoomControlPosition: "topright",
    offlineLocations: payload.locations,
  });
  const routeShadow = L.polyline(events.map((event) => [event.lat, event.lng]), {
    color: "rgba(8, 20, 28, 0.28)",
    weight: 10,
    opacity: 0.82,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(map);

  const segmentLines = [];
  for (let index = 0; index < events.length - 1; index += 1) {
    const progress = events.length <= 1 ? 1 : index / (events.length - 1);
    const segment = L.polyline(
      [
        [events[index].lat, events[index].lng],
        [events[index + 1].lat, events[index + 1].lng],
      ],
      {
        color: getTrackColor(progress),
        weight: 5,
        opacity: 0.98,
        lineCap: "round",
        lineJoin: "round",
      },
    ).addTo(map);
    segmentLines.push(segment);
  }

  const markerLayer = L.layerGroup().addTo(map);
  const markers = events.map((event, index) => {
    const progress = events.length <= 1 ? 1 : index / (events.length - 1);
    const color = getTrackColor(progress);
    const marker = L.circleMarker([event.lat, event.lng], {
      radius: 6,
      color: "#ffffff",
      weight: 1.4,
      fillColor: color,
      fillOpacity: 0.95,
    });

    marker.bindPopup(buildEventPopup(event));
    marker.on("click", () => focusEvent(index));
    marker.addTo(markerLayer);
    return marker;
  });

  const currentMarker = L.circleMarker([events[0].lat, events[0].lng], {
    radius: 11,
    color: "#ffffff",
    weight: 3,
    fillColor: getTrackColor(0),
    fillOpacity: 1,
  }).addTo(map);

  fitMapToEvents(map, events, [80, 80]);
  map.setZoom(Math.max(map.getZoom() - 1, 3));

  dom.fitBtn.addEventListener("click", () => fitMapToEvents(map, events, [80, 80]));
  dom.startBtn.addEventListener("click", () => focusEvent(0));
  dom.endBtn.addEventListener("click", () => focusEvent(events.length - 1));

  const scrollTrackList = (direction) => {
    const offset = Math.max(260, Math.round(dom.list.clientWidth * 0.72));
    dom.list.scrollBy({
      left: direction * offset,
      behavior: "smooth",
    });
  };

  dom.listPrevBtn?.addEventListener("click", () => scrollTrackList(-1));
  dom.listNextBtn?.addEventListener("click", () => scrollTrackList(1));
  dom.list.addEventListener(
    "wheel",
    (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }

      event.preventDefault();
      dom.list.scrollBy({
        left: event.deltaY,
        behavior: "auto",
      });
    },
    { passive: false },
  );

  const listButtons = [];
  let activeTrackIndex = 0;
  events.forEach((event, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const progress = events.length <= 1 ? 1 : index / (events.length - 1);
    const color = getTrackColor(progress);
    button.type = "button";
    button.className = "track-point-button";
    button.innerHTML = `
      <span class="track-point-index">${index + 1}</span>
      <span class="track-point-dot" style="--track-color: ${color}"></span>
      <span class="track-point-copy">
        <strong>${escapeHtml(event.name)}</strong>
        <span>${escapeHtml(event.date.label)}</span>
      </span>
    `;
    button.addEventListener("click", () => focusEvent(index));
    item.appendChild(button);
    dom.list.appendChild(item);
    listButtons.push(button);
  });

  const centerTrackButton = (index, behavior = "smooth") => {
    listButtons[index]?.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior,
    });
  };

  const updateTrackListInsets = (behavior = "auto") => {
    const firstItem = dom.list.querySelector("li");
    if (!firstItem) {
      return;
    }

    const itemWidth = firstItem.getBoundingClientRect().width;
    const viewportWidth = dom.list.clientWidth;
    const inset = Math.max(0, Math.floor((viewportWidth - itemWidth) / 2));
    dom.list.style.setProperty("--track-list-edge-padding", `${inset}px`);
    centerTrackButton(activeTrackIndex, behavior);
  };

  function buildTrackDescription(event) {
    const coords = `${event.lat.toFixed(4)}, ${event.lng.toFixed(4)}`;
    if (event.date.isRange) {
      return ` Период пребывания: ${formatIsoDate(event.date.start)} - ${formatIsoDate(event.date.end)}.`;
    }

    return ``;
  }

  function focusEvent(index) {
    const safeIndex = clamp(index, 0, events.length - 1);
    activeTrackIndex = safeIndex;
    const event = events[safeIndex];
    const progress = events.length <= 1 ? 1 : safeIndex / (events.length - 1);
    const activeColor = getTrackColor(progress);

    markers.forEach((marker, markerIndex) => {
      const markerProgress = events.length <= 1 ? 1 : markerIndex / (events.length - 1);
      marker.setStyle(
        markerIndex === safeIndex
          ? {
              radius: 9,
              color: "#ffffff",
              weight: 2.6,
              fillColor: getTrackColor(markerProgress),
              fillOpacity: 1,
            }
          : {
              radius: 5.5,
              color: "rgba(255, 255, 255, 0.9)",
              weight: 1.1,
              fillColor: getTrackColor(markerProgress),
              fillOpacity: 0.78,
            },
      );
    });

    currentMarker.setLatLng([event.lat, event.lng]);
    currentMarker.setStyle({ fillColor: activeColor });
    currentMarker.bindTooltip(event.name, { direction: "top", offset: [0, -14], opacity: 0.92 });

    listButtons.forEach((button, buttonIndex) => {
      button.classList.toggle("is-active", buttonIndex === safeIndex);
    });

    dom.focusName.textContent = event.name;
    dom.focusDate.textContent = event.date.label;

    map.flyTo([event.lat, event.lng], Math.max(map.getZoom(), 4), {
      animate: true,
      duration: 0.9,
    });

    markers[safeIndex].openPopup();
    centerTrackButton(safeIndex, "smooth");
  }

  window.addEventListener("resize", () => updateTrackListInsets("auto"));
  updateTrackListInsets("auto");
  focusEvent(0);
}

async function initHeatmapPage() {
  const payload = await loadPayload();
  ensureLeaflet();

  if (!window.L.heatLayer) {
    throw new Error("Leaflet heat plugin is unavailable.");
  }

  const locations = payload.locations;
  const locationsByKey = buildLocationsMap(locations);
  const dom = {
    metricTitle: document.getElementById("heatMetricTitle"),
    metricCaption: document.getElementById("heatMetricCaption"),
    focusName: document.getElementById("heatFocusName"),
    focusValue: document.getElementById("heatFocusValue"),
    focusRange: document.getElementById("heatFocusRange"),
    leaders: document.getElementById("heatLeaders"),
  };

  const map = createBaseMap("heatMap", {
    zoomControlPosition: "topright",
    offlineLocations: payload.locations,
  });
  fitMapToEvents(map, locations, [80, 80]);
  map.setZoom(Math.max(map.getZoom() - 1, 3));

  const metric = "visits";
  let heatLayer = null;
  const hitAreaLayer = L.layerGroup().addTo(map);
  let focusedKey = null;

  function rebuildHeatScene() {
    if (heatLayer) {
      map.removeLayer(heatLayer);
    }

    heatLayer = L.heatLayer(buildHeatPoints(locations, metric), {
      radius: 40,
      blur: 24,
      maxZoom: 8,
      max: 1,
      minOpacity: 0.38,
      gradient: {
        0.15: "#fff4c1",
        0.35: "#ffca7a",
        0.55: "#ff925f",
        0.75: "#eb5647",
        1: "#78121f",
      },
    }).addTo(map);

    hitAreaLayer.clearLayers();

    const maxValue = Math.max(...locations.map((location) => Number(location.visitCount) || 0), 1);

    locations.forEach((location) => {
      const radius = 10 + Math.round(18 * ((Number(location.visitCount) || 0) / maxValue));
      const marker = L.circleMarker([location.lat, location.lng], {
        radius,
        stroke: false,
        fillOpacity: 0,
        opacity: 0,
        bubblingMouseEvents: false,
      });

      marker.on("click", () => setFocusedLocation(location.key));
      marker.addTo(hitAreaLayer);
    });

    renderLeaderboard();

    if (!focusedKey || !locationsByKey.has(focusedKey)) {
      focusedKey = getTopLocations(locations, metric, 1)[0]?.key || null;
    }

    if (focusedKey) {
      setFocusedLocation(focusedKey, false);
    }

    dom.metricCaption.textContent = "Чем ярче точка, тем чаще локация встречается в маршруте.";
  }

  function renderLeaderboard() {
    dom.leaders.innerHTML = "";
    const leaders = getTopLocations(locations, metric, 8);

    leaders.forEach((location, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "heat-leader-button";
      button.innerHTML = `
        <span class="heat-leader-rank">${index + 1}</span>
        <span class="heat-leader-copy">
          <strong>${escapeHtml(location.name)}</strong>
          <span>${location.visitCount} виз.</span>
        </span>
      `;
      button.addEventListener("click", () => setFocusedLocation(location.key));
      item.appendChild(button);
      dom.leaders.appendChild(item);
    });
  }

  function setFocusedLocation(key, shouldFly = true) {
    focusedKey = key;
    const location = locationsByKey.get(key);
    if (!location) {
      return;
    }

    dom.focusName.textContent = location.name;
    dom.focusValue.textContent = `${location.visitCount} визитов`;
    dom.focusRange.textContent = `${formatIsoDate(location.firstDate)} - ${formatIsoDate(location.lastDate)}`;

    dom.leaders.querySelectorAll(".heat-leader-button").forEach((button) => {
      const title = button.querySelector("strong")?.textContent;
      button.classList.toggle("is-active", title === location.name);
    });

    if (shouldFly) {
      map.flyTo([location.lat, location.lng], Math.max(map.getZoom(), 4), {
        animate: true,
        duration: 0.9,
      });
    }

  }

  rebuildHeatScene();
}
