// ---------------------------------------------------------------------------
// OVERLAY UI
// ---------------------------------------------------------------------------
// Everything needed to present the model live without having to click small
// 3D targets: focus buttons that fly the camera, a demo trigger per building,
// a manual flood slider, a time-of-day scrub, and a render-quality switch.
// Pure DOM — no three.js in this file.
// ---------------------------------------------------------------------------

const BUILDING_META = [
  { key: 'earthquake', name: 'Earthquake-Resistant', color: '#e2794f', trigger: 'Simulate Earthquake' },
  { key: 'flood', name: 'Flood-Resilient', color: '#49a8dc', trigger: 'Simulate Flood' },
  { key: 'acidRain', name: 'Acid-Rain-Resistant', color: '#5be49b', trigger: 'Simulate Acid Rain' },
  { key: 'farm', name: 'Vertical Farm Tower', color: '#d8b03c', trigger: 'Trigger Growth' },
];

export function buildUI(container, handlers) {
  const { onFocus, onTrigger, onReset, onFloodSlider, onTimeChange, onQualityChange } = handlers;
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'panel-header';
  header.innerHTML = `
    <p class="overlay-title">Eco Friendly Survival</p>
    <p class="overlay-subtitle">Disaster-resilient city concept &middot; click a building in the scene or use the controls below</p>
  `;
  container.appendChild(header);

  // --- building cards -----------------------------------------------------
  const refs = {};
  BUILDING_META.forEach((meta) => {
    const card = document.createElement('div');
    card.className = 'building-card';
    card.dataset.key = meta.key;

    const head = document.createElement('div');
    head.className = 'building-card-header';
    head.innerHTML = `<span class="building-dot" style="background:${meta.color}"></span>
                      <span class="building-name">${meta.name}</span>`;
    card.appendChild(head);

    const row = document.createElement('div');
    row.className = 'btn-row';

    const focusBtn = document.createElement('button');
    focusBtn.textContent = 'Focus';
    focusBtn.addEventListener('click', () => onFocus(meta.key));

    const trigBtn = document.createElement('button');
    trigBtn.className = 'primary';
    trigBtn.textContent = meta.trigger;
    trigBtn.addEventListener('click', () => onTrigger(meta.key));

    row.append(focusBtn, trigBtn);
    card.appendChild(row);

    if (meta.key === 'flood') {
      const wrap = document.createElement('div');
      wrap.className = 'slider-row';
      wrap.innerHTML = '<label>Manual water level</label>';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = '0';
      slider.addEventListener('input', () => onFloodSlider(Number(slider.value) / 100));
      wrap.appendChild(slider);
      card.appendChild(wrap);
      refs.floodSlider = slider;
    }

    container.appendChild(card);
    refs[meta.key] = { card, trigBtn };
  });

  // --- global controls ----------------------------------------------------
  const globals = document.createElement('div');
  globals.className = 'globals';

  const resetBtn = document.createElement('button');
  resetBtn.id = 'reset-view';
  resetBtn.textContent = 'Reset View';
  resetBtn.addEventListener('click', onReset);
  globals.appendChild(resetBtn);

  // time of day
  const timeWrap = document.createElement('div');
  timeWrap.className = 'slider-row';
  const timeLabel = document.createElement('label');
  timeLabel.textContent = 'Time of day — 10:30';
  const timeSlider = document.createElement('input');
  timeSlider.type = 'range';
  timeSlider.min = '0';
  timeSlider.max = '240';
  timeSlider.value = '105';
  timeSlider.addEventListener('input', () => {
    const hour = Number(timeSlider.value) / 10;
    const h = Math.floor(hour);
    const m = Math.round((hour - h) * 60);
    timeLabel.textContent = `Time of day — ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    onTimeChange(hour);
  });
  timeWrap.append(timeLabel, timeSlider);
  globals.appendChild(timeWrap);

  // quality
  const qualityWrap = document.createElement('div');
  qualityWrap.className = 'quality-row';
  qualityWrap.innerHTML = '<label>Render quality</label>';
  const qualityBtns = document.createElement('div');
  qualityBtns.className = 'btn-row';
  ['low', 'medium', 'high'].forEach((q) => {
    const btn = document.createElement('button');
    btn.textContent = q[0].toUpperCase() + q.slice(1);
    btn.dataset.quality = q;
    btn.addEventListener('click', () => {
      qualityBtns.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onQualityChange(q);
    });
    qualityBtns.appendChild(btn);
  });
  qualityWrap.appendChild(qualityBtns);
  globals.appendChild(qualityWrap);

  container.appendChild(globals);

  return {
    setQualityActive(q) {
      qualityBtns.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', b.dataset.quality === q);
      });
    },
    syncFloodSlider(value01) {
      if (refs.floodSlider && document.activeElement !== refs.floodSlider) {
        refs.floodSlider.value = String(Math.round(value01 * 100));
      }
    },
    setActiveBuilding(key) {
      BUILDING_META.forEach((m) => {
        refs[m.key].card.classList.toggle('active', m.key === key);
      });
    },
    setTriggerLabel(key, text) {
      if (refs[key]) refs[key].trigBtn.textContent = text;
    },
  };
}

/** Transient status message at the bottom of the viewport. */
export function showToast(text) {
  const toast = document.getElementById('info-toast');
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add('visible');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove('visible'), 2600);
}

/** Loading screen progress reporting. */
export function setLoadingProgress(text, fraction) {
  const bar = document.getElementById('loading-bar');
  const msg = document.getElementById('loading-msg');
  if (msg) msg.textContent = text;
  if (bar) bar.style.width = `${Math.round(fraction * 100)}%`;
}

export function hideLoading() {
  const el = document.getElementById('loading');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 600);
}
