import { api } from './api.js';
import { parseQueueInput, formatPhone, normalizePhone } from './phone.js';
import { placeCall, hangUp, sendDigits, toggleMute, ensureDevice, onIncomingCall, answerIncoming, rejectIncoming } from './device.js';
import { connectTranscript } from './transcript.js';

const els = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  ringToggle: document.getElementById('ringToggle'),
  tabs: document.querySelectorAll('.tab'),
  panels: document.querySelectorAll('.panel'),

  queueInput: document.getElementById('queueInput'),
  addToQueueBtn: document.getElementById('addToQueueBtn'),
  loadCrmBtn: document.getElementById('loadCrmBtn'),
  queueList: document.getElementById('queueList'),
  progressLabel: document.getElementById('progressLabel'),
  targetLabel: document.getElementById('targetLabel'),
  progressFill: document.getElementById('progressFill'),
  upNext: document.getElementById('upNext'),
  upNextNumber: document.getElementById('upNextNumber'),
  callNextBtn: document.getElementById('callNextBtn'),
  skipBtn: document.getElementById('skipBtn'),
  clearBtn: document.getElementById('clearBtn'),

  keypadDisplay: document.getElementById('keypadDisplay'),
  keypadCallBtn: document.getElementById('keypadCallBtn'),

  recentsList: document.getElementById('recentsList'),
  inboxList: document.getElementById('inboxList'),
  recToggle: document.getElementById('recToggle'),

  callOverlay: document.getElementById('callOverlay'),
  callNumber: document.getElementById('callNumber'),
  callLeadName: document.getElementById('callLeadName'),
  callTimer: document.getElementById('callTimer'),
  callState: document.getElementById('callState'),
  transcriptPanel: document.getElementById('transcriptPanel'),
  hangupBtn: document.getElementById('hangupBtn'),
  inCallActions: document.getElementById('inCallActions'),
  inCallKeypad: document.getElementById('inCallKeypad'),
  keypadToggleBtn: document.getElementById('keypadToggleBtn'),
  sentDigits: document.getElementById('sentDigits'),
  muteBtn: document.getElementById('muteBtn'),
  autoDialToggle: document.getElementById('autoDialToggle'),
  autoDialCountdown: document.getElementById('autoDialCountdown'),
  pauseBtn: document.getElementById('pauseBtn'),
  incomingOverlay: document.getElementById('incomingOverlay'),
  incomingNumber: document.getElementById('incomingNumber'),
  incomingLeadName: document.getElementById('incomingLeadName'),
  answerBtn: document.getElementById('answerBtn'),
  rejectBtn: document.getElementById('rejectBtn'),
};

const micEls = {
  banner: document.getElementById('micBanner'),
  fixBtn: document.getElementById('micFixBtn'),
};

const state = {
  queue: [], // { number, label, normalized, status: pending|skipped|calling|done }
  sessionId: null,
  dialCount: 0,
  call: null, // { number, leadId, callSid, ws, startedAt, timerId, finalLines: [] }
  incoming: null, // the ringing inbound Twilio Call, before it's answered
  ringAudio: null,
  autoDial: false, // when true, the next queued lead is dialed automatically
  paused: false, // user paused the auto-dial chain (stops advancing, not the live call)
  autoAdvanceTimer: null, // countdown interval id between auto-dialed calls
};

// Breather between an ended call and the next auto-dialed one — long enough to
// jot a note / disposition, short enough to stay hands-free.
const AUTO_DIAL_GAP_SECONDS = 4;

// ---------- status pill ----------

function setStatus(mode, text) {
  els.statusDot.className = `dot ${mode === 'ready' ? 'ready' : mode === 'busy' ? 'busy' : 'error'}`;
  els.statusText.textContent = text;
}

// ---------- tabs ----------

function initTabs() {
  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      els.tabs.forEach((t) => t.classList.remove('active'));
      els.panels.forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab === 'recents') loadRecents();
      if (tab.dataset.tab === 'inbox') loadInbox();
    });
  });
}

// ---------- ring tone (local only, no asset file needed) ----------

function startRingTone() {
  if (!els.ringToggle.checked) return;
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 440;
  gain.gain.value = 0.05;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  state.ringAudio = { ctx, osc };
}

function stopRingTone() {
  if (!state.ringAudio) return;
  try {
    state.ringAudio.osc.stop();
    state.ringAudio.ctx.close();
  } catch {
    /* already stopped */
  }
  state.ringAudio = null;
}

// ---------- auto-dial queue ----------

els.queueInput.addEventListener('input', () => {
  const count = parseQueueInput(els.queueInput.value).length;
  els.addToQueueBtn.textContent = `Add ${count} to queue`;
  els.addToQueueBtn.disabled = count === 0;
});

async function addEntriesToQueue(entries) {
  if (entries.length === 0) return;

  let dncSet = new Set();
  try {
    const usNumbers = entries.filter((e) => e.normalized).map((e) => e.number);
    if (usNumbers.length) {
      const { dnc } = await api.checkDnc(usNumbers);
      dncSet = new Set(dnc);
    }
  } catch {
    /* if the DNC check fails, fall through and queue everything as pending */
  }

  for (const entry of entries) {
    const isDnc = entry.normalized && dncSet.has(entry.normalized);
    state.queue.push({ ...entry, status: isDnc ? 'skipped' : 'pending' });
  }
  renderQueue();
}

els.addToQueueBtn.addEventListener('click', async () => {
  await addEntriesToQueue(parseQueueInput(els.queueInput.value));
  els.queueInput.value = '';
  els.addToQueueBtn.textContent = 'Add 0 to queue';
  els.addToQueueBtn.disabled = true;
});

// ---------- "Load from CRM" (batch sent from the CRM's Today's Queue) ----------

let crmBatch = null;

async function refreshCrmBatch() {
  try {
    const batch = await api.getDialerQueue();
    const { lastCrmBatchId } = await chrome.storage.local.get('lastCrmBatchId');
    if (batch && batch.id !== lastCrmBatchId && batch.entries.length > 0) {
      crmBatch = batch;
      els.loadCrmBtn.textContent = `Load ${batch.entries.length} leads from CRM`;
      els.loadCrmBtn.classList.remove('hidden');
    } else {
      crmBatch = null;
      els.loadCrmBtn.classList.add('hidden');
    }
  } catch {
    /* server unreachable — button just stays hidden */
  }
}

els.loadCrmBtn.addEventListener('click', async () => {
  if (!crmBatch) return;
  const entries = crmBatch.entries.map((e) => ({
    number: e.number,
    label: e.label,
    normalized: normalizePhone(e.number),
  }));
  await chrome.storage.local.set({ lastCrmBatchId: crmBatch.id });
  crmBatch = null;
  els.loadCrmBtn.classList.add('hidden');
  await addEntriesToQueue(entries);
});

function nextPendingIndex() {
  return state.queue.findIndex((q) => q.status === 'pending');
}

function renderQueue() {
  els.queueList.innerHTML = '';
  state.queue.forEach((item, i) => {
    const li = document.createElement('li');
    if (item.status === 'calling') li.classList.add('current');
    li.innerHTML = `
      <span class="q-index">${i + 1}.</span>
      <span class="q-number">${item.number}${item.label ? `<span class="q-label">${escapeHtml(item.label)}</span>` : ''}</span>
      <span class="queue-status ${item.status}">${item.status}</span>
    `;
    els.queueList.appendChild(li);
  });

  const total = state.queue.length;
  const done = state.queue.filter((q) => q.status === 'done').length;
  els.progressLabel.textContent = `Progress: ${done}/${total}`;
  els.progressFill.style.width = total ? `${(done / total) * 100}%` : '0%';

  const nextIdx = nextPendingIndex();
  const hasNext = nextIdx !== -1;
  els.upNext.classList.toggle('hidden', !hasNext);
  if (hasNext) els.upNextNumber.textContent = state.queue[nextIdx].number;

  els.callNextBtn.disabled = !hasNext || !!state.call;
  els.skipBtn.disabled = !hasNext || !!state.call;
  els.clearBtn.disabled = total === 0 || !!state.call;

  updateAutoDialUi();
}

els.skipBtn.addEventListener('click', () => {
  const idx = nextPendingIndex();
  if (idx === -1) return;
  state.queue[idx].status = 'skipped';
  renderQueue();
});

els.clearBtn.addEventListener('click', () => {
  state.queue = [];
  cancelAutoAdvance();
  renderQueue();
});

async function callNext() {
  const idx = nextPendingIndex();
  if (idx === -1) return;
  cancelAutoAdvance();
  await ensureSession();
  state.queue[idx].status = 'calling';
  renderQueue();
  startCall(state.queue[idx].number, { queueIndex: idx, label: state.queue[idx].label });
}

els.callNextBtn.addEventListener('click', callNext);

// ---------- auto-dial: advance through the queue hands-free ----------

function cancelAutoAdvance() {
  if (state.autoAdvanceTimer) {
    clearInterval(state.autoAdvanceTimer);
    state.autoAdvanceTimer = null;
  }
  els.autoDialCountdown.classList.add('hidden');
  els.autoDialCountdown.classList.remove('paused');
}

// Start the countdown to the next call. No-op unless auto-dial is on, not
// paused, nothing is on the line, and a lead is actually waiting — so it's
// safe to call after every event that might change those conditions.
function scheduleAutoAdvance() {
  cancelAutoAdvance();
  if (!state.autoDial || state.paused || state.call || nextPendingIndex() === -1) {
    updateAutoDialUi();
    return;
  }
  let remaining = AUTO_DIAL_GAP_SECONDS;
  els.autoDialCountdown.classList.remove('hidden', 'paused');
  els.autoDialCountdown.textContent = `Next call in ${remaining}s…`;
  state.autoAdvanceTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      cancelAutoAdvance();
      callNext();
      return;
    }
    els.autoDialCountdown.textContent = `Next call in ${remaining}s…`;
  }, 1000);
  updateAutoDialUi();
}

function updateAutoDialUi() {
  const hasWork = state.call || nextPendingIndex() !== -1;
  els.pauseBtn.classList.toggle('hidden', !state.autoDial || !hasWork);
  els.pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
  if (state.paused) {
    els.autoDialCountdown.classList.remove('hidden');
    els.autoDialCountdown.classList.add('paused');
    els.autoDialCountdown.textContent = 'Paused';
  } else if (!state.autoAdvanceTimer) {
    // Not paused and no countdown running (e.g. resumed while a call is still
    // live) — clear any lingering "Paused"/countdown text.
    els.autoDialCountdown.classList.add('hidden');
    els.autoDialCountdown.classList.remove('paused');
  }
}

els.autoDialToggle.addEventListener('change', () => {
  state.autoDial = els.autoDialToggle.checked;
  state.paused = false;
  if (state.autoDial) {
    // Kick off the chain immediately if we're idle with leads waiting; if a
    // call is already live, the chain starts when it ends.
    if (!state.call) scheduleAutoAdvance();
  } else {
    cancelAutoAdvance();
  }
  updateAutoDialUi();
});

els.pauseBtn.addEventListener('click', () => {
  state.paused = !state.paused;
  if (state.paused) {
    cancelAutoAdvance(); // halt the chain; a live call keeps going untouched
  } else if (!state.call) {
    scheduleAutoAdvance(); // resume from wherever the queue now stands
  }
  updateAutoDialUi();
});

async function ensureSession() {
  if (state.sessionId) return;
  try {
    const session = await api.startSession(state.queue.length);
    state.sessionId = session.id;
  } catch {
    /* session tracking is best-effort; dialing still works without it */
  }
}

async function bumpSessionDialCount() {
  state.dialCount += 1;
  if (!state.sessionId) return;
  try {
    await api.updateSession(state.sessionId, state.dialCount);
  } catch {
    /* best-effort */
  }
  refreshTargetProgress();
}

const DAILY_CALL_GOAL = 200;

async function refreshTargetProgress() {
  try {
    const { count } = await api.getTodayCallCount();
    els.targetLabel.textContent = `Today: ${count}/${DAILY_CALL_GOAL}`;
  } catch {
    els.targetLabel.textContent = '';
    return;
  }
  // Longer-term CRM target rides along in the tooltip.
  try {
    const target = await api.getCurrentTarget();
    if (target) {
      els.targetLabel.title = `${target.label}: ${target.progressCount}/${target.target_count} (${target.start_date} → ${target.end_date}, ${target.daysLeft} days left)`;
    }
  } catch {
    /* tooltip is optional */
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- keypad ----------

document.querySelectorAll('.key').forEach((btn) => {
  btn.addEventListener('click', () => {
    els.keypadDisplay.value += btn.dataset.digit;
  });
});

els.keypadCallBtn.addEventListener('click', () => {
  const raw = els.keypadDisplay.value.trim();
  if (!raw) return;
  const number = formatPhone(raw) || raw;
  startCall(number, {});
});

// ---------- recents ----------

async function loadRecents() {
  els.recentsList.innerHTML = '<li class="r-meta">Loading…</li>';
  try {
    const calls = await api.listRecentCalls(20);
    if (calls.length === 0) {
      els.recentsList.innerHTML = '<li class="r-meta">No calls yet.</li>';
      return;
    }
    els.recentsList.innerHTML = '';
    calls.forEach((call) => {
      const li = document.createElement('li');
      const name = call.lead ? (call.lead.business_name || call.lead.contact_name) : '';
      const when = new Date(call.started_at.replace(' ', 'T') + 'Z').toLocaleString();
      const duration = call.duration_sec != null ? `${call.duration_sec}s` : '—';
      li.innerHTML = `
        <div class="r-top"><span>${call.to_number}</span><span>${duration}</span></div>
        <div class="r-meta">${name ? escapeHtml(name) + ' · ' : ''}${call.status} · ${when}</div>
      `;
      els.recentsList.appendChild(li);
    });
  } catch {
    els.recentsList.innerHTML = '<li class="r-meta">Could not reach the CRM server.</li>';
  }
}

// ---------- inbox (voicemails + inbound SMS) ----------

async function loadInbox() {
  els.inboxList.innerHTML = '<li class="r-meta">Loading…</li>';
  try {
    const items = await api.getInbox();
    if (items.length === 0) {
      els.inboxList.innerHTML = '<li class="r-meta">No voicemails or messages yet.</li>';
      return;
    }
    els.inboxList.innerHTML = '';
    items.forEach((item) => {
      const li = document.createElement('li');
      const name = item.business_name || item.contact_name || '';
      const when = new Date(item.created_at.replace(' ', 'T') + 'Z').toLocaleString();
      if (item.type === 'voicemail') {
        li.innerHTML = `
          <div class="r-top"><span>📞 ${escapeHtml(item.from_number)}</span><span>${item.duration_sec != null ? `${item.duration_sec}s` : ''}</span></div>
          <div class="r-meta">${name ? escapeHtml(name) + ' · ' : ''}Voicemail · ${when}</div>
          ${item.transcript ? `<div class="inbox-body">${escapeHtml(item.transcript)}</div>` : '<div class="inbox-body r-meta">Transcribing…</div>'}
          <audio controls preload="none" src="http://localhost:4001/api/inbox/voicemail/${item.id}/audio"></audio>
        `;
      } else {
        li.innerHTML = `
          <div class="r-top"><span>💬 ${escapeHtml(item.from_number)}</span></div>
          <div class="r-meta">${name ? escapeHtml(name) + ' · ' : ''}Text message · ${when}</div>
          <div class="inbox-body">${escapeHtml(item.body || '')}</div>
        `;
      }
      els.inboxList.appendChild(li);
    });
  } catch {
    els.inboxList.innerHTML = '<li class="r-meta">Could not reach the CRM server.</li>';
  }
}

// ---------- active call ----------

function formatTimer(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// The side panel can't reliably show Chrome's mic prompt, so permission is
// granted once via a full-tab page (permission.html); the panel inherits it.
async function micGranted() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state === 'granted';
  } catch {
    return true; // can't query — let the call attempt surface any real issue
  }
}

function openMicPermissionPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
}

async function refreshMicBanner() {
  micEls.banner.classList.toggle('hidden', await micGranted());
}

micEls.fixBtn.addEventListener('click', openMicPermissionPage);

async function startCall(number, { queueIndex, label } = {}) {
  if (!(await micGranted())) {
    if (queueIndex != null) {
      state.queue[queueIndex].status = 'pending';
      renderQueue();
    }
    refreshMicBanner();
    openMicPermissionPage();
    return;
  }
  state.call = { number, queueIndex, callSid: null, ws: null, startedAt: null, timerId: null, finalLines: [] };

  els.callOverlay.classList.remove('hidden');
  els.callNumber.textContent = number;
  els.callLeadName.textContent = label || '';
  els.callTimer.textContent = '00:00';
  els.callState.textContent = 'Calling…';
  els.transcriptPanel.innerHTML = '<div class="empty">Transcript will appear here once connected…</div>';
  els.inCallActions.classList.remove('hidden');
  els.inCallKeypad.classList.add('hidden');
  els.sentDigits.textContent = '';
  els.muteBtn.textContent = 'Mute';
  els.muteBtn.classList.remove('muted');

  setStatus('busy', 'On call');
  startRingTone();

  if (!label) {
    api.getLeadByPhone(number).then((lead) => {
      if (lead && state.call) {
        els.callLeadName.textContent = lead.business_name || lead.contact_name || '';
      }
    }).catch(() => {});
  }

  try {
    await placeCall(number, {
      onCallSid: (sid) => {
        if (!state.call) return;
        state.call.callSid = sid;
        state.call.ws = connectTranscript(sid, onTranscriptLine);
      },
      onStatusChange: (status, err) => onCallStatusChange(status, err),
    });
  } catch (err) {
    onCallStatusChange('error', err);
  }
}

function makeLineEl(text, speaker, extraClass = '') {
  const line = document.createElement('div');
  line.className = `line ${speaker === 'Prospect' ? 'prospect' : 'you'} ${extraClass}`.trim();
  line.dataset.speaker = speaker;
  if (speaker) {
    const tag = document.createElement('span');
    tag.className = 'spk';
    tag.textContent = speaker;
    line.appendChild(tag);
  }
  line.appendChild(document.createTextNode(text));
  return line;
}

// Both speakers transcribe concurrently, so each keeps its own interim line
// (marked with data-speaker) that gets replaced by the final version.
function onTranscriptLine(text, isFinal, speaker) {
  if (!state.call) return;
  if (!text) return;
  if (isFinal) state.call.finalLines.push(speaker ? `${speaker}: ${text}` : text);

  const placeholder = els.transcriptPanel.querySelector('.empty');
  if (placeholder) placeholder.remove();

  const interimEl = els.transcriptPanel.querySelector(`.line.interim[data-speaker="${speaker}"]`);
  if (!isFinal) {
    const fresh = makeLineEl(text, speaker, 'interim');
    if (interimEl) interimEl.replaceWith(fresh);
    else els.transcriptPanel.appendChild(fresh);
  } else {
    if (interimEl) interimEl.remove();
    els.transcriptPanel.appendChild(makeLineEl(text, speaker));
  }
  els.transcriptPanel.scrollTop = els.transcriptPanel.scrollHeight;
}

function onCallStatusChange(status, err) {
  if (!state.call) return;

  if (status === 'ringing') {
    els.callState.textContent = 'Ringing…';
  } else if (status === 'in-progress') {
    stopRingTone();
    els.callState.textContent = 'Connected';
    state.call.startedAt = Date.now();
    state.call.timerId = setInterval(() => {
      const secs = (Date.now() - state.call.startedAt) / 1000;
      els.callTimer.textContent = formatTimer(secs);
    }, 500);
  } else if (status === 'ended') {
    endCallUi();
  } else if (status === 'error') {
    stopRingTone();
    els.callState.textContent = `Call error${err?.message ? `: ${err.message}` : ''}`;
    endCallUi();
  }
}

// Call over: the transcript is already persisted server-side (CRM DB, lead
// notes, and the transcripts/ folder), so there's nothing to click — close
// the overlay and be immediately ready for the next dial.
function endCallUi() {
  if (!state.call || state.call.ended) return;
  state.call.ended = true;
  stopRingTone();
  if (state.call.timerId) clearInterval(state.call.timerId);
  if (state.call.ws) state.call.ws.close();

  // Inbound calls aren't queue dials — skip the queue/session bookkeeping.
  if (!state.call.inbound) {
    if (state.call.queueIndex != null) {
      state.queue[state.call.queueIndex].status = 'done';
    }
    bumpSessionDialCount();
  }

  els.callOverlay.classList.add('hidden');
  state.call = null;
  setStatus('ready', 'Ready');
  renderQueue();
  // Chain into the next lead if auto-dial is on and not paused.
  scheduleAutoAdvance();
}

els.hangupBtn.addEventListener('click', () => hangUp());

// ---------- incoming calls ----------

onIncomingCall((call) => {
  // Already on a call → let it ring through to voicemail rather than
  // clobbering the live conversation.
  if (state.call) {
    rejectIncoming(call);
    return;
  }
  // An inbound call takes priority over an auto-dial countdown.
  cancelAutoAdvance();

  state.incoming = call;
  const number = formatPhone(call.parameters?.From || '') || call.parameters?.From || 'Unknown number';
  els.incomingNumber.textContent = number;
  els.incomingLeadName.textContent = '';
  els.incomingOverlay.classList.remove('hidden');
  setStatus('busy', 'Incoming call');
  startRingTone();

  // Resolve who's calling, if they're a known lead.
  api.getLeadByPhone(number).then((lead) => {
    if (lead && state.incoming === call) {
      els.incomingLeadName.textContent = lead.business_name || lead.contact_name || '';
    }
  }).catch(() => {});

  // Caller gave up (or Twilio timed out to voicemail) before we answered.
  call.on('cancel', () => { if (state.incoming === call) dismissIncoming(); });
  call.on('disconnect', () => { if (state.incoming === call) dismissIncoming(); });
});

function dismissIncoming() {
  state.incoming = null;
  els.incomingOverlay.classList.add('hidden');
  stopRingTone();
  setStatus('ready', 'Ready');
  scheduleAutoAdvance(); // resume auto-dial if it was running
}

els.answerBtn.addEventListener('click', () => {
  const call = state.incoming;
  if (!call) return;
  state.incoming = null;
  els.incomingOverlay.classList.add('hidden');
  stopRingTone();

  const number = els.incomingNumber.textContent;
  const label = els.incomingLeadName.textContent;
  state.call = { number, inbound: true, callSid: null, ws: null, startedAt: null, timerId: null, finalLines: [] };

  els.callOverlay.classList.remove('hidden');
  els.callNumber.textContent = number;
  els.callLeadName.textContent = label || '';
  els.callTimer.textContent = '00:00';
  els.callState.textContent = 'Connecting…';
  els.transcriptPanel.innerHTML = '<div class="empty">Live transcript isn\'t available for inbound calls.</div>';
  els.inCallActions.classList.remove('hidden');
  els.inCallKeypad.classList.add('hidden');
  els.sentDigits.textContent = '';
  els.muteBtn.textContent = 'Mute';
  els.muteBtn.classList.remove('muted');
  setStatus('busy', 'On call');

  answerIncoming(call, {
    onStatusChange: (status, err) => onCallStatusChange(status, err),
  });
});

els.rejectBtn.addEventListener('click', () => {
  if (!state.incoming) return;
  rejectIncoming(state.incoming);
  dismissIncoming();
});

// ---------- in-call DTMF keypad (for IVR phone trees) ----------

function sendCallDigit(digit) {
  if (!state.call) return;
  sendDigits(digit);
  els.sentDigits.textContent += digit;
}

els.keypadToggleBtn.addEventListener('click', () => {
  els.inCallKeypad.classList.toggle('hidden');
});

els.muteBtn.addEventListener('click', () => {
  const muted = toggleMute();
  els.muteBtn.textContent = muted ? 'Unmute' : 'Mute';
  els.muteBtn.classList.toggle('muted', muted);
});

document.querySelectorAll('.call-key').forEach((btn) => {
  btn.addEventListener('click', () => sendCallDigit(btn.dataset.digit));
});

// Physical keyboard works too while on a call: 0-9, * and # go straight to
// the line, no need to reach for the mouse mid-IVR.
document.addEventListener('keydown', (evt) => {
  if (!state.call || els.callOverlay.classList.contains('hidden')) return;
  if (evt.target.matches('input, textarea')) return;
  if (/^[0-9*#]$/.test(evt.key)) {
    sendCallDigit(evt.key);
    evt.preventDefault();
  }
});

// ---------- boot ----------

chrome.storage.local.get(['ringEnabled'], (result) => {
  if (result.ringEnabled === false) els.ringToggle.checked = false;
});
els.ringToggle.addEventListener('change', () => {
  chrome.storage.local.set({ ringEnabled: els.ringToggle.checked });
});

// Recording toggle lives server-side (it drives Twilio's <Dial record>), so
// reflect the server's current value on open and push changes back.
api.getRecording().then(({ enabled }) => { els.recToggle.checked = enabled; }).catch(() => {});
els.recToggle.addEventListener('change', () => {
  api.setRecording(els.recToggle.checked).catch(() => {
    els.recToggle.checked = !els.recToggle.checked; // revert on failure
  });
});

initTabs();
renderQueue();
refreshTargetProgress();
refreshMicBanner();
refreshCrmBatch();
// Poll for a freshly sent CRM batch so the button appears without reopening
// the panel; local call, so 10s is cheap.
setInterval(refreshCrmBatch, 10000);
// Hide the banner live the moment permission is granted from permission.html.
navigator.permissions?.query({ name: 'microphone' })
  .then((status) => { status.onchange = refreshMicBanner; })
  .catch(() => {});

api.getCurrentTarget().then(() => setStatus('ready', 'Ready')).catch(() => setStatus('error', 'Server unreachable'));

// Register the Twilio device up front so the browser is reachable for inbound
// calls without needing to place an outbound one first. Best-effort — if the
// token/server isn't available, outbound dialing still lazily registers later.
ensureDevice().catch((err) => console.error('Device registration failed:', err.message));
