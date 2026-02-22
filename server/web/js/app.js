let BASE = localStorage.getItem('cctimec_server') || location.origin;
let ws = null;
let state = null;
let fsMode = null;

function detectServer() {
  const loc = location.hostname;
  if (loc === 'localhost' || loc === '127.0.0.1') return location.origin;
  return localStorage.getItem('cctimec_server') || location.origin;
}

function api(path, opts = {}) {
  return fetch(`${BASE}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(r => r.json());
}

function connectWS() {
  const wsUrl = BASE.replace(/^http/, 'ws') + '/';
  ws = new WebSocket(wsUrl);
  ws.onmessage = (e) => {
    state = JSON.parse(e.data);
    updateUI();
  };
  ws.onclose = () => setTimeout(connectWS, 3000);
  ws.onerror = () => ws.close();
}

function updateUI() {
  if (!state) return;
  const t = state.time;
  const isSleeping = t.status === 'sleeping';

  document.getElementById('sleeping-view').classList.toggle('hidden', !isSleeping);
  document.getElementById('awake-view').classList.toggle('hidden', isSleeping);

  if (isSleeping) {
    document.getElementById('preview-wake').textContent = t.displayTime || '--:--';
  } else {
    document.getElementById('display-time').textContent = t.displayTime || '--:--';
    document.getElementById('real-time').textContent = `\u771f\u5b9e\u65f6\u95f4 ${t.realTime || '--:--'}`;
    document.getElementById('speed-badge').textContent = `\u6d41\u901f \u00d7${(t.speed || 0).toFixed(2)}`;
    const sb = document.getElementById('status-badge');
    sb.textContent = statusText(t.status);
    sb.className = `status-badge status-${t.status}`;
  }

  if (state.entertainment) {
    const ent = state.entertainment;
    document.getElementById('ent-info').textContent =
      `${Math.round(ent.totalMinutes)}\u5206\u949f / ${ent.targetMinutes}\u5206\u949f`;
    const pct = Math.min(ent.ratio * 100, 100);
    const bar = document.getElementById('ent-progress');
    bar.style.width = pct + '%';
    bar.className = `progress-fill ${ent.warning ? 'red' : 'green'}`;
    if (ent.warning && !isSleeping) showEntWarning(ent);
  }

  if (state.pomodoro) {
    const p = state.pomodoro;
    document.getElementById('pomo-idle').classList.toggle('hidden', p.active);
    document.getElementById('pomo-active').classList.toggle('hidden', !p.active);
    if (p.active) {
      const mins = Math.floor(p.remaining);
      const secs = Math.floor((p.remaining - mins) * 60);
      document.getElementById('pomo-remaining').textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
      document.getElementById('pomo-remaining').className = `pomo-time ${p.isBreak ? 'break' : 'work'}`;
      document.getElementById('pomo-info').textContent = `\u7b2c${p.cycleNum}\u8f6e ${p.isBreak ? '\u4f11\u606f\u4e2d' : '\u5b66\u4e60\u4e2d'}${p.overtime ? ' (\u52a0\u65f6)' : ''}`;
      document.getElementById('pomo-speed').textContent = `\u6d41\u901f \u00d7${(p.speed || 1).toFixed(2)}`;
      const prog = Math.min((p.elapsed / p.target) * 100, 100);
      document.getElementById('pomo-progress').style.width = prog + '%';
    }
  }

  if (fsMode === 'clock') {
    document.getElementById('fs-time').textContent = state.time.displayTime || '--:--';
    document.getElementById('fs-label').textContent = `\u771f\u5b9e ${state.time.realTime || '--:--'} | \u00d7${(state.time.speed||0).toFixed(2)}`;
  } else if (fsMode === 'pomo' && state.pomodoro?.active) {
    const p = state.pomodoro;
    const mins = Math.floor(p.remaining);
    const secs = Math.floor((p.remaining - mins) * 60);
    document.getElementById('fs-time').textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    document.getElementById('fs-time').className = `pomo-time ${p.isBreak ? 'break' : 'work'}`;
    document.getElementById('fs-label').textContent = `\u7b2c${p.cycleNum}\u8f6e ${p.isBreak ? '\u4f11\u606f' : '\u5b66\u4e60'} | \u00d7${(p.speed||1).toFixed(2)}`;
  }
}

function statusText(s) {
  return { sleeping: '\u7761\u7720\u4e2d', idle: '\u7a7a\u95f2', entertainment: '\u5a31\u4e50\u4e2d', studying: '\u5b66\u4e60\u4e2d' }[s] || s;
}

let warningDismissed = false;
function showEntWarning(ent) {
  if (warningDismissed) return;
  const overlay = document.getElementById('warning-overlay');
  overlay.classList.remove('hidden');
  document.getElementById('warning-text').textContent =
    ent.exceeded ? `\u5df2\u8d85\u51fa\u76ee\u6807! ${Math.round(ent.totalMinutes)}/${ent.targetMinutes}\u5206\u949f` :
    `\u5373\u5c06\u8fbe\u5230\u76ee\u6807: ${Math.round(ent.totalMinutes)}/${ent.targetMinutes}\u5206\u949f`;
}
function dismissWarning() {
  document.getElementById('warning-overlay').classList.add('hidden');
  warningDismissed = true;
  setTimeout(() => warningDismissed = false, 300000);
}

function doWake() { api('/wake', { method: 'POST' }); }
function doSleep() { if (confirm('\u786e\u5b9a\u8981\u7761\u89c9\u4e86\u5417\uff1f')) api('/sleep', { method: 'POST' }); }
function setActivity(a) { api('/activity', { method: 'POST', body: { activity: a } }); }
function startPomo() {
  const target = parseInt(document.getElementById('pomo-target').value) || 240;
  api('/pomodoro/start', { method: 'POST', body: { targetMinutes: target } });
}
function stopPomo() { if (confirm('\u7ed3\u675f\u5b66\u4e60\uff1f')) api('/pomodoro/stop', { method: 'POST' }); }

function toggleFullscreen() {
  const el = document.getElementById('fullscreen-view');
  if (fsMode === 'clock') { el.classList.add('hidden'); fsMode = null; return; }
  el.classList.remove('hidden'); fsMode = 'clock';
}
function toggleFullscreenPomo() {
  const el = document.getElementById('fullscreen-view');
  if (fsMode === 'pomo') { el.classList.add('hidden'); fsMode = null; return; }
  el.classList.remove('hidden'); fsMode = 'pomo';
}

document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('page-' + btn.dataset.page).classList.add('active');
    if (btn.dataset.page === 'records') loadRecords();
    if (btn.dataset.page === 'summaries') loadSummaries('daily');
    if (btn.dataset.page === 'settings') loadSettings();
  });
});

async function loadRecords() {
  const records = await api('/records?limit=30');
  const list = document.getElementById('record-list');
  list.innerHTML = records.map(r => `
    <div class="record-item" onclick="showRecord('${r.date}')">
      <span class="record-date">${r.date}</span>
      <span class="record-stats">\u5b66\u4e60${Math.round(r.study_minutes||0)}\u5206 \u5a31\u4e50${Math.round(r.entertainment_minutes||0)}\u5206 \u756a\u8304\u00d7${r.pomodoro_count||0}</span>
    </div>
  `).join('') || '<div style="color:var(--dim);text-align:center">\u6682\u65e0\u8bb0\u5f55</div>';
}

async function showRecord(date) {
  const r = await api(`/records/${date}`);
  const detail = document.getElementById('record-detail');
  detail.classList.remove('hidden');
  document.getElementById('record-detail-date').textContent = date;
  const mToT = m => { if(!m&&m!==0) return '--:--'; m=((m%1440)+1440)%1440; return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(Math.floor(m%60)).padStart(2,'0')}`; };
  document.getElementById('record-detail-content').innerHTML = `
    <div class="settings-grid">
      <div class="setting-item"><label>\u771f\u5b9e\u8d77\u5e8a</label><div>${mToT(r.actual_wake)}</div></div>
      <div class="setting-item"><label>\u771f\u5b9e\u7761\u89c9</label><div>${mToT(r.actual_sleep)}</div></div>
      <div class="setting-item"><label>\u8868\u663e\u8d77\u5e8a</label><div>${mToT(r.display_wake)}</div></div>
      <div class="setting-item"><label>\u8868\u663e\u7761\u89c9</label><div>${mToT(r.display_sleep)}</div></div>
      <div class="setting-item"><label>\u5b66\u4e60\u65f6\u957f</label><div>${Math.round(r.study_minutes||0)}\u5206\u949f</div></div>
      <div class="setting-item"><label>\u5a31\u4e50\u65f6\u957f</label><div>${Math.round(r.entertainment_minutes||0)}\u5206\u949f</div></div>
      <div class="setting-item"><label>\u5a31\u4e50\u500d\u901f</label><div>\u00d7${(r.entertainment_x||0).toFixed(2)}</div></div>
      <div class="setting-item"><label>\u756a\u8304\u949f</label><div>${r.pomodoro_count||0}\u6b21</div></div>
    </div>`;
}

async function loadSummaries(type) {
  const list = await api(`/summaries?type=${type}&limit=20`);
  document.getElementById('summaries-list').innerHTML = list.map(s => `
    <div class="card summary-card">
      <div class="type">${s.type}</div>
      <div class="period">${s.period}</div>
      <div class="content">${s.content}</div>
    </div>
  `).join('') || '<div style="color:var(--dim);text-align:center">\u6682\u65e0\u603b\u7ed3</div>';
}

async function generateSummary() {
  const res = await api('/summaries/generate', { method: 'POST', body: { type: 'daily' } });
  alert(res.content || '\u751f\u6210\u5931\u8d25');
  loadSummaries('daily');
}

const settingsDef = {
  time: [
    { key: 'target_wake_time', label: '\u76ee\u6807\u8d77\u5e8a(\u5206\u949f)', type: 'number' },
    { key: 'target_sleep_time', label: '\u76ee\u6807\u7761\u89c9(\u5206\u949f)', type: 'number' },
    { key: 'target_study_minutes', label: '\u76ee\u6807\u5b66\u4e60(\u5206\u949f)', type: 'number' },
    { key: 'target_entertainment_minutes', label: '\u76ee\u6807\u5a31\u4e50(\u5206\u949f)', type: 'number' }
  ],
  algo: [
    { key: 'wake_approach_rate', label: '\u8d77\u5e8a\u9760\u62e2\u7387', type: 'number', step: '0.05' },
    { key: 'sleep_approach_rate', label: '\u7761\u89c9\u9760\u62e2\u7387', type: 'number', step: '0.05' },
    { key: 'pomodoro_work_minutes', label: '\u756a\u8304\u5de5\u4f5c(\u5206\u949f)', type: 'number' },
    { key: 'pomodoro_break_minutes', label: '\u756a\u8304\u4f11\u606f(\u5206\u949f)', type: 'number' },
    { key: 'study_speed_start', label: '\u5b66\u4e60\u8d77\u59cb\u6d41\u901f', type: 'number', step: '0.1' },
    { key: 'study_speed_end', label: '\u5b66\u4e60\u7ed3\u675f\u6d41\u901f', type: 'number', step: '0.05' },
    { key: 'idle_speed', label: '\u7a7a\u95f2\u6d41\u901f', type: 'number', step: '0.05' },
    { key: 'entertainment_warning_threshold', label: '\u5a31\u4e50\u8b66\u544a\u9608\u503c', type: 'number', step: '0.05' }
  ],
  display: [
    { key: 'overlay_size', label: '\u60ac\u6d6e\u7a97\u5b57\u53f7', type: 'number' },
    { key: 'overlay_bg_color', label: '\u60ac\u6d6e\u7a97\u80cc\u666f\u8272', type: 'color' },
    { key: 'overlay_text_color', label: '\u60ac\u6d6e\u7a97\u5b57\u8272', type: 'color' },
    { key: 'fullscreen_orientation', label: '\u5168\u5c4f\u65b9\u5411', type: 'select', options: ['landscape','portrait'] }
  ]
};

async function loadSettings() {
  const s = await api('/settings');
  for (const [group, items] of Object.entries(settingsDef)) {
    const container = document.getElementById(`settings-${group}`);
    container.innerHTML = items.map(item => {
      const val = s[item.key] ?? '';
      if (item.type === 'select') {
        return `<div class="setting-item"><label>${item.label}</label><select data-key="${item.key}">${item.options.map(o=>`<option value="${o}" ${val===o?'selected':''}>${o}</option>`).join('')}</select></div>`;
      }
      return `<div class="setting-item"><label>${item.label}</label><input type="${item.type}" data-key="${item.key}" value="${val}" ${item.step?`step="${item.step}"`:''} /></div>`;
    }).join('');
  }
  loadApps();
  document.getElementById('server-addr').value = BASE;
}

async function saveSettings() {
  const body = {};
  document.querySelectorAll('[data-key]').forEach(el => {
    const v = el.type === 'number' ? parseFloat(el.value) : el.value;
    if (el.dataset.key && v !== '' && !isNaN(v)) body[el.dataset.key] = v;
    else if (el.type !== 'number') body[el.dataset.key] = el.value;
  });
  await api('/settings', { method: 'POST', body });
  alert('\u5df2\u4fdd\u5b58');
}

async function loadApps() {
  const apps = await api('/entertainment-apps');
  document.getElementById('app-list').innerHTML = apps.map(a => `
    <div class="app-item"><span>${a.app_name} (${a.package_name})</span><button class="del-btn" onclick="delApp(${a.id})">&times;</button></div>
  `).join('');
}
async function addApp() {
  const pkg = document.getElementById('new-app-pkg').value.trim();
  const name = document.getElementById('new-app-name').value.trim();
  if (!pkg) return;
  await api('/entertainment-apps', { method: 'POST', body: { packageName: pkg, appName: name || pkg } });
  document.getElementById('new-app-pkg').value = '';
  document.getElementById('new-app-name').value = '';
  loadApps();
}
async function delApp(id) {
  await api(`/entertainment-apps/${id}`, { method: 'DELETE' });
  loadApps();
}

function reconnect() {
  const addr = document.getElementById('server-addr').value.trim();
  if (addr) { BASE = addr; localStorage.setItem('cctimec_server', addr); }
  if (ws) ws.close();
  connectWS();
}

BASE = detectServer();
connectWS();
