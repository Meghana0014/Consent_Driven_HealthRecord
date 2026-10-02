// Patient App Logic - Consent & Control Center

let currentPatient = null;
let tokenRefreshInterval = null;
let currentTokenData = null;
let countdownTimer = null;
let remainingSeconds = 30;
let ws = null;
let activeDoctorSession = null;
let sessionDurationTimer = null;
let sessionElapsedSeconds = 0;
let isBreakGlassEnabled = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }
  
  await loadPatientProfiles();
  initWebSocket();
  setupEventListeners();
});

// Load patient profiles and select the first one
async function loadPatientProfiles() {
  try {
    const res = await fetch('/api/patients');
    const data = await res.json();
    if (data.success && data.patients.length > 0) {
      renderPatientSelector(data.patients);
      await selectPatient(data.patients[0].id);
    }
  } catch (err) {
    console.error('Failed to load patients:', err);
  }
}

function renderPatientSelector(patientsList) {
  const selector = document.getElementById('patientSelector');
  if (!selector) return;

  selector.innerHTML = patientsList.map(p => `
    <option value="${p.id}">
      ${p.name} (ABHA: ${p.abhaId}) - ${p.bloodGroup}
    </option>
  `).join('');

  selector.addEventListener('change', async (e) => {
    await selectPatient(e.target.value);
  });
}

async function selectPatient(patientId) {
  try {
    const res = await fetch(`/api/patients/${patientId}`);
    const data = await res.json();
    if (data.success) {
      currentPatient = data.patient;
      renderPatientHeader(currentPatient);
      await generateNewToken();
      startTokenCycle();
      await loadAuditLedger(currentPatient.id);

      // Register patient on WebSocket
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'REGISTER_PATIENT',
          patientId: currentPatient.id
        }));
      }
    }
  } catch (err) {
    console.error('Error selecting patient:', err);
  }
}

function renderPatientHeader(patient) {
  const nameEl = document.getElementById('patientName');
  const abhaIdEl = document.getElementById('patientAbhaId');
  const abhaAddressEl = document.getElementById('patientAbhaAddress');
  const photoEl = document.getElementById('patientPhoto');
  const bloodEl = document.getElementById('patientBloodGroup');
  const facilityEl = document.getElementById('patientFacility');
  const allergySummaryEl = document.getElementById('patientAllergySummary');

  if (nameEl) nameEl.textContent = patient.name;
  if (abhaIdEl) abhaIdEl.textContent = patient.abhaId;
  if (abhaAddressEl) abhaAddressEl.textContent = patient.abhaAddress;
  if (photoEl) photoEl.src = patient.photo;
  if (bloodEl) bloodEl.textContent = patient.bloodGroup;
  if (facilityEl) facilityEl.textContent = patient.registeredFacility;

  if (allergySummaryEl) {
    const allergies = patient.criticalAllergies || [];
    allergySummaryEl.innerHTML = allergies.map(a => `
      <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-300">
        <i data-lucide="alert-triangle" class="w-3 h-3 mr-1 inline"></i> ${a.allergen}
      </span>
    `).join(' ');
    if (window.lucide) window.lucide.createIcons();
  }
}

// Dynamic 30-Second Token Generation
async function generateNewToken() {
  if (!currentPatient) return;

  try {
    const res = await fetch('/api/token/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: currentPatient.id })
    });
    const data = await res.json();
    if (data.success) {
      currentTokenData = data;
      renderQRCode(data);
      resetCountdownRing(30);
    }
  } catch (err) {
    console.error('Failed to generate token:', err);
  }
}

function renderQRCode(tokenData) {
  const qrImg = document.getElementById('qrCodeImage');
  const tokenLabel = document.getElementById('tokenDisplay');
  if (qrImg) {
    qrImg.src = tokenData.qrDataUrl;
  }
  if (tokenLabel) {
    tokenLabel.textContent = tokenData.token;
  }
}

function startTokenCycle() {
  if (tokenRefreshInterval) clearInterval(tokenRefreshInterval);
  if (countdownTimer) clearInterval(countdownTimer);

  remainingSeconds = 30;
  updateCountdownUI(remainingSeconds);

  countdownTimer = setInterval(() => {
    remainingSeconds--;
    if (remainingSeconds < 0) {
      remainingSeconds = 30;
    }
    updateCountdownUI(remainingSeconds);
  }, 1000);

  tokenRefreshInterval = setInterval(async () => {
    await generateNewToken();
  }, 30000);
}

function resetCountdownRing(totalSeconds) {
  remainingSeconds = totalSeconds;
  updateCountdownUI(remainingSeconds);
}

function updateCountdownUI(secs) {
  const timerText = document.getElementById('countdownTimerText');
  const progressCircle = document.getElementById('countdownProgressCircle');
  
  if (timerText) {
    timerText.textContent = `${secs}s`;
  }

  if (progressCircle) {
    const circumference = 2 * Math.PI * 40; // r=40
    const offset = circumference - (secs / 30) * circumference;
    progressCircle.style.strokeDashoffset = offset;
    
    if (secs <= 5) {
      progressCircle.style.stroke = '#ef4444'; // red when almost expired
    } else {
      progressCircle.style.stroke = '#0f9f91'; // healthcare teal
    }
  }
}

// WebSocket Setup
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[Patient WS] Connected to realtime engine.');
    updateWsStatus(true);
    if (currentPatient) {
      ws.send(JSON.stringify({
        type: 'REGISTER_PATIENT',
        patientId: currentPatient.id
      }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWsMessage(data);
    } catch (e) {
      console.error('[Patient WS] Parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('[Patient WS] Disconnected. Reconnecting in 2s...');
    updateWsStatus(false);
    setTimeout(initWebSocket, 2000);
  };
}

function updateWsStatus(connected) {
  const dot = document.getElementById('wsStatusDot');
  const label = document.getElementById('wsStatusLabel');
  if (dot) {
    dot.className = connected ? 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse' : 'w-2.5 h-2.5 rounded-full bg-red-500';
  }
  if (label) {
    label.textContent = connected ? 'Real-Time Sync Active' : 'Connecting to ABDM Gateway...';
  }
}

function handleWsMessage(msg) {
  console.log('[Patient WS] Received message:', msg);

  switch (msg.type) {
    case 'DOCTOR_CONNECTED':
      onDoctorConnected(msg);
      break;

    case 'SESSION_REVOKED_CONFIRMED':
      onSessionRevoked(msg);
      break;

    case 'BREAK_GLASS_STATUS':
      onBreakGlassStatus(msg.enabled);
      break;
  }
}

function onDoctorConnected(sessionInfo) {
  activeDoctorSession = sessionInfo;
  sessionElapsedSeconds = 0;

  // Play hospital connection sound
  if (window.healthAudio) window.healthAudio.playScanSuccess();

  // Show active session banner & Revoke button
  const statusContainer = document.getElementById('activeSessionCard');
  const idleStatus = document.getElementById('idleWaitingCard');
  const doctorName = document.getElementById('connectedDoctorName');
  const doctorFacility = document.getElementById('connectedDoctorFacility');
  const accessLevelBadge = document.getElementById('connectedAccessBadge');
  const durationEl = document.getElementById('sessionDurationDisplay');

  if (statusContainer) statusContainer.classList.remove('hidden');
  if (idleStatus) idleStatus.classList.add('hidden');

  if (doctorName) doctorName.textContent = sessionInfo.doctorName;
  if (doctorFacility) doctorFacility.textContent = sessionInfo.facility;
  if (accessLevelBadge) {
    accessLevelBadge.textContent = isBreakGlassEnabled ? 'EMERGENCY BREAK-GLASS' : 'FULL MEDICAL RECORD';
    accessLevelBadge.className = isBreakGlassEnabled 
      ? 'px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300'
      : 'px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300';
  }

  // Start duration ticker
  if (sessionDurationTimer) clearInterval(sessionDurationTimer);
  sessionDurationTimer = setInterval(() => {
    sessionElapsedSeconds++;
    const mins = String(Math.floor(sessionElapsedSeconds / 60)).padStart(2, '0');
    const secs = String(sessionElapsedSeconds % 60).padStart(2, '0');
    if (durationEl) durationEl.textContent = `${mins}:${secs}`;
  }, 1000);

  // Reload audit ledger
  if (currentPatient) {
    loadAuditLedger(currentPatient.id);
  }
}

function onSessionRevoked(info) {
  activeDoctorSession = null;
  if (sessionDurationTimer) clearInterval(sessionDurationTimer);

  const statusContainer = document.getElementById('activeSessionCard');
  const idleStatus = document.getElementById('idleWaitingCard');
  if (statusContainer) statusContainer.classList.add('hidden');
  if (idleStatus) idleStatus.classList.remove('hidden');

  showToastNotification(`Consent Revoked: Doctor access was terminated in real time (Duration: ${info.durationSeconds}s)`);

  if (currentPatient) {
    loadAuditLedger(currentPatient.id);
  }
}

// Revoke access function
async function revokeAccessNow() {
  if (!currentPatient) return;

  // Audio warning tone
  if (window.healthAudio) window.healthAudio.playRevokeAlarm();

  try {
    const res = await fetch('/api/session/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId: currentPatient.id,
        sessionId: activeDoctorSession ? activeDoctorSession.sessionId : null,
        reason: 'Revoked by Patient in Real Time via ABDM Consent Center'
      })
    });
    const data = await res.json();
    if (data.success) {
      onSessionRevoked({ durationSeconds: data.durationSeconds });
    }
  } catch (err) {
    console.error('Revocation error:', err);
  }
}

// Break-Glass emergency mode toggle
async function toggleBreakGlass(enabled) {
  isBreakGlassEnabled = enabled;

  if (enabled && window.healthAudio) {
    window.healthAudio.playBreakGlassAlert();
  }

  const badge = document.getElementById('breakGlassIndicator');
  if (badge) {
    if (enabled) {
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  try {
    await fetch('/api/session/break-glass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId: currentPatient ? currentPatient.id : null,
        sessionId: activeDoctorSession ? activeDoctorSession.sessionId : null,
        enabled
      })
    });
  } catch (e) {
    console.error('Break-glass toggle error:', e);
  }
}

function onBreakGlassStatus(enabled) {
  isBreakGlassEnabled = enabled;
  const toggle = document.getElementById('breakGlassCheckbox');
  if (toggle) toggle.checked = enabled;
}

// Load and render Audit Trail Ledger
async function loadAuditLedger(patientId) {
  try {
    const res = await fetch(`/api/audit-ledger/${patientId}`);
    const data = await res.json();
    if (data.success) {
      renderAuditLedger(data.ledger);
    }
  } catch (err) {
    console.error('Error loading audit ledger:', err);
  }
}

function renderAuditLedger(ledger) {
  const container = document.getElementById('auditLedgerContainer');
  if (!container) return;

  if (!ledger || ledger.length === 0) {
    container.innerHTML = `<div class="p-4 text-center text-sm text-slate-500">No access records found in ABDM ledger.</div>`;
    return;
  }

  container.innerHTML = ledger.map(entry => {
    const dateStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + 
      ', ' + new Date(entry.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });

    let statusBadge = '';
    if (entry.status === 'ACTIVE') {
      statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse">
        ● Live Viewing Now
      </span>`;
    } else if (entry.status === 'REVOKED') {
      statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800 border border-red-300">
        Revoked by Patient (${entry.durationSeconds}s)
      </span>`;
    } else {
      statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-700">
        Completed (${entry.durationSeconds}s)
      </span>`;
    }

    return `
      <div class="p-3 border border-slate-200 rounded-xl bg-white shadow-sm flex flex-col gap-1.5 transition-all hover:border-teal-300">
        <div class="flex items-center justify-between">
          <div class="font-semibold text-slate-800 text-sm flex items-center gap-1.5">
            <i data-lucide="building-2" class="w-4 h-4 text-teal-600"></i>
            ${entry.facility}
          </div>
          ${statusBadge}
        </div>
        <div class="text-xs text-slate-600 flex items-center justify-between">
          <span class="flex items-center gap-1">
            <i data-lucide="user-check" class="w-3.5 h-3.5 text-slate-400"></i>
            ${entry.doctorName}
          </span>
          <span class="text-slate-400 font-mono text-[11px]">${dateStr}</span>
        </div>
        ${entry.status === 'ACTIVE' ? `
          <button onclick="revokeAccessNow()" class="mt-1 text-xs py-1.5 px-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-sm flex items-center justify-center gap-1 transition-all">
            <i data-lucide="shield-alert" class="w-3.5 h-3.5"></i> REVOKE ACCESS IMMEDIATELY
          </button>
        ` : ''}
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

function showToastNotification(message) {
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 max-w-sm w-[90%] bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl z-50 text-xs font-semibold flex items-center gap-2 border border-slate-700 animate-bounce';
  toast.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 text-emerald-400 shrink-0"></i> <span>${message}</span>`;
  document.body.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.4s';
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function setupEventListeners() {
  const revokeBtn = document.getElementById('revokeAccessBtn');
  if (revokeBtn) {
    revokeBtn.addEventListener('click', revokeAccessNow);
  }

  const breakGlassToggle = document.getElementById('breakGlassCheckbox');
  if (breakGlassToggle) {
    breakGlassToggle.addEventListener('change', (e) => {
      toggleBreakGlass(e.target.checked);
    });
  }

  const refreshQrBtn = document.getElementById('refreshQrNowBtn');
  if (refreshQrBtn) {
    refreshQrBtn.addEventListener('click', async () => {
      await generateNewToken();
    });
  }
}

// Explicit window exports for cross-frame pitch demo control
window.revokeAccessNow = revokeAccessNow;
window.toggleBreakGlass = toggleBreakGlass;
window.generateNewToken = generateNewToken;
window.selectPatient = selectPatient;
