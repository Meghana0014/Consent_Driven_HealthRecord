// Doctor Point-of-Care Terminal Logic

let currentSession = null;
let currentPatientData = null;
let ws = null;
let html5QrScanner = null;
let conflictDebounceTimer = null;
let sessionDurationTicker = null;
let sessionElapsedSecs = 0;
let isLockedOut = false;

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  initDoctorWebSocket();
  setupDoctorEventListeners();
  initHtml5Scanner();
});

// WebSocket Connection
function initDoctorWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[Doctor WS] Connected.');
    updateDoctorWsBadge(true);
    ws.send(JSON.stringify({
      type: 'REGISTER_DOCTOR',
      sessionId: currentSession ? currentSession.sessionId : null
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleDoctorWsMessage(msg);
    } catch (e) {
      console.error('[Doctor WS] Message parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('[Doctor WS] Disconnected. Reconnecting...');
    updateDoctorWsBadge(false);
    setTimeout(initDoctorWebSocket, 2000);
  };
}

function updateDoctorWsBadge(connected) {
  const badge = document.getElementById('doctorWsBadge');
  if (badge) {
    badge.className = connected 
      ? 'flex items-center gap-1.5 bg-emerald-50 border border-emerald-300 text-emerald-800 px-2.5 py-1 rounded-full text-xs font-semibold'
      : 'flex items-center gap-1.5 bg-red-50 border border-red-300 text-red-800 px-2.5 py-1 rounded-full text-xs font-semibold';
    badge.innerHTML = `<span class="w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}"></span> ${connected ? 'ABDM Real-Time Active' : 'Offline'}`;
  }
}

function handleDoctorWsMessage(msg) {
  console.log('[Doctor WS] Received:', msg);

  switch (msg.type) {
    case 'SESSION_REVOKED':
      // The SHOWSTOPPER: Immediate Lockout!
      executeRealtimeLockout(msg.reason);
      break;

    case 'BREAK_GLASS_UPDATE':
      handleBreakGlassUpdate(msg);
      break;

    case 'CONSENT_GRANTED':
      loadPatientRecord(msg.patient, { sessionId: msg.sessionId });
      break;
  }
}

// THE WINNING FEATURE: Instant Doctor Lockout Execution
function executeRealtimeLockout(reason = 'Access Revoked by Patient in Real Time') {
  isLockedOut = true;

  // 1. Play Security Alarm Buzzer
  if (window.healthAudio) {
    window.healthAudio.playRevokeAlarm();
  }

  // 2. Stop timers
  if (sessionDurationTicker) clearInterval(sessionDurationTicker);

  // 3. Purge Clinical Data from Terminal State
  currentPatientData = null;
  currentSession = null;

  // 4. Reveal Lockout Modal with heavy backdrop blur
  const modal = document.getElementById('securityLockoutModal');
  const reasonEl = document.getElementById('lockoutReasonText');
  const timeEl = document.getElementById('lockoutTimestamp');

  if (reasonEl) reasonEl.textContent = reason;
  if (timeEl) timeEl.textContent = new Date().toLocaleTimeString();

  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  // 5. Purge and hide clinical content underneath
  const patientView = document.getElementById('patientClinicalView');
  if (patientView) {
    patientView.classList.add('hidden');
  }
}

function closeLockoutModalAndReset() {
  const modal = document.getElementById('securityLockoutModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  isLockedOut = false;
  
  // Return to scanner view
  const scanView = document.getElementById('scannerSection');
  const clinicalView = document.getElementById('patientClinicalView');
  if (scanView) scanView.classList.remove('hidden');
  if (clinicalView) clinicalView.classList.add('hidden');

  // Restart camera if needed
  startCameraScanner();
}

// Camera Scanner Initialization
function initHtml5Scanner() {
  // Check if Html5QrcodeScanner exists
  if (typeof Html5Qrcode !== 'undefined') {
    startCameraScanner();
  } else {
    console.log('Html5Qrcode not yet loaded; demo trigger ready.');
  }
}

function startCameraScanner() {
  const readerEl = document.getElementById('qrReaderContainer');
  if (!readerEl) return;

  try {
    if (!html5QrScanner && typeof Html5Qrcode !== 'undefined') {
      html5QrScanner = new Html5Qrcode("qrReaderContainer");
      html5QrScanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 240, height: 240 }
        },
        (decodedText) => {
          console.log('[QR Scanned]:', decodedText);
          onQrCodeDetected(decodedText);
        },
        (errorMessage) => {
          // ignore scan frame errors
        }
      ).catch(err => {
        console.warn('Camera stream could not be started (permissions or no camera):', err);
        showCameraFallbackBanner();
      });
    }
  } catch (e) {
    console.warn('Scanner init failed, demo scan button active:', e);
    showCameraFallbackBanner();
  }
}

function showCameraFallbackBanner() {
  const fallback = document.getElementById('cameraFallbackBanner');
  if (fallback) fallback.classList.remove('hidden');
}

// When QR Code is scanned (either via camera or simulation button)
async function onQrCodeDetected(qrText) {
  if (html5QrScanner) {
    try {
      await html5QrScanner.stop();
    } catch (e) {}
  }

  const doctorName = document.getElementById('doctorNameInput') ? document.getElementById('doctorNameInput').value : 'Dr. Ananya Mehta (MD, General Medicine)';
  const facility = document.getElementById('doctorFacilityInput') ? document.getElementById('doctorFacilityInput').value : 'District Hospital Thane - Emergency OPD';

  // Sub-second feedback
  if (window.healthAudio) window.healthAudio.playScanSuccess();

  showLoadingIndicator(true);

  try {
    const res = await fetch('/api/token/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: qrText,
        rawPayload: qrText,
        doctorName,
        facility
      })
    });

    const data = await res.json();
    showLoadingIndicator(false);

    if (data.success) {
      loadPatientRecord(data.patient, {
        sessionId: data.sessionId,
        accessLevel: data.accessLevel
      });

      // Register session with WebSocket
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'REGISTER_DOCTOR',
          sessionId: data.sessionId,
          patientId: data.patient.id
        }));
      }
    } else {
      alert(`⚠️ Scan Error: ${data.message}`);
      startCameraScanner();
    }
  } catch (err) {
    showLoadingIndicator(false);
    console.error('Scan request error:', err);
    alert('Network error communicating with ABDM Gateway.');
  }
}

// 1-Click Instant Demo Scan (Perfect for Hackathon Presentation!)
async function triggerDemoScan(patientId = null) {
  if (window.healthAudio) window.healthAudio.playScanSuccess();
  showLoadingIndicator(true);

  try {
    // Fetch patient list to find the desired patient
    const pRes = await fetch('/api/patients');
    const pData = await pRes.json();
    const targetPatient = (patientId && pData.patients)
      ? pData.patients.find(p => p.id === patientId)
      : (pData.patients ? pData.patients[0] : null);

    const chosenId = targetPatient ? targetPatient.id : 'ABHA-9148-2139-2011';

    // Generate dynamic token
    const tokenRes = await fetch('/api/token/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: chosenId })
    });
    const tokenData = await tokenRes.json();

    if (tokenData.success) {
      await onQrCodeDetected(tokenData.token);
    }
  } catch (e) {
    showLoadingIndicator(false);
    console.error('Demo scan error:', e);
  }
}

function showLoadingIndicator(show) {
  const loader = document.getElementById('scanLoadingOverlay');
  if (loader) {
    if (show) loader.classList.remove('hidden');
    else loader.classList.add('hidden');
  }
}

// Load and Render Patient Clinical Record (<1s Point-of-Care Access)
function loadPatientRecord(patient, session) {
  currentPatientData = patient;
  currentSession = session;
  isLockedOut = false;

  // Switch views
  const scanView = document.getElementById('scannerSection');
  const clinicalView = document.getElementById('patientClinicalView');
  if (scanView) scanView.classList.add('hidden');
  if (clinicalView) clinicalView.classList.remove('hidden');

  // Start session duration ticker
  sessionElapsedSecs = 0;
  if (sessionDurationTicker) clearInterval(sessionDurationTicker);
  sessionDurationTicker = setInterval(() => {
    sessionElapsedSecs++;
    const mins = String(Math.floor(sessionElapsedSecs / 60)).padStart(2, '0');
    const secs = String(sessionElapsedSecs % 60).padStart(2, '0');
    const timerEl = document.getElementById('docSessionTimer');
    if (timerEl) timerEl.textContent = `${mins}:${secs}`;
  }, 1000);

  // Render Patient Identification
  document.getElementById('docPatientName').textContent = patient.name;
  document.getElementById('docAbhaId').textContent = patient.abhaId;
  document.getElementById('docPatientMeta').textContent = `${patient.gender}, ${patient.age} yrs • Registered: ${patient.registeredFacility}`;
  document.getElementById('docBloodGroupBadge').textContent = patient.bloodGroup;
  document.getElementById('docPatientPhoto').src = patient.photo;

  // Render HIGH-PRIORITY ALLERGY BANNER
  renderAllergyBanner(patient.criticalAllergies || []);

  // Render Treatment History & Duplication Avoidance
  renderActiveMedications(patient.activeMedications || []);
  renderRecentDiagnostics(patient.recentDiagnostics || []);
  renderActiveConditions(patient.activeConditions || []);
  renderEmergencyContacts(patient.emergencyContacts || []);

  // Reset prescription notes field and conflict warning
  const notesField = document.getElementById('doctorClinicalNotes');
  if (notesField) notesField.value = '';
  clearConflictAlert();

  if (window.lucide) window.lucide.createIcons();
}

// High Priority Allergy Banner
function renderAllergyBanner(allergies) {
  const banner = document.getElementById('highPriorityAllergyBanner');
  const listEl = document.getElementById('allergyBannerList');
  if (!banner || !listEl) return;

  if (allergies.length === 0) {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');
  listEl.innerHTML = allergies.map(a => `
    <div class="bg-red-700/80 border border-red-400 p-2.5 rounded-xl text-white flex items-start gap-2.5">
      <i data-lucide="alert-octagon" class="w-5 h-5 text-white shrink-0 mt-0.5 animate-bounce"></i>
      <div class="flex-1">
        <div class="flex items-center justify-between">
          <span class="font-extrabold text-sm uppercase tracking-wider">${a.allergen}</span>
          <span class="bg-white text-red-800 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider">${a.severity}</span>
        </div>
        <div class="text-xs text-red-100 mt-0.5">Reaction: <strong>${a.reaction}</strong></div>
        <div class="text-[11px] text-red-200 mt-1 font-mono">Contraindicated: ${(a.conflictsWith || []).join(', ')}</div>
      </div>
    </div>
  `).join('');
}

// Active Medications & Duplication Guard
function renderActiveMedications(medications) {
  const container = document.getElementById('docActiveMedicationsList');
  if (!container) return;

  if (typeof medications === 'string') {
    container.innerHTML = `<div class="p-3 bg-amber-50 text-amber-800 text-xs rounded-xl font-bold border border-amber-300">${medications}</div>`;
    return;
  }

  if (medications.length === 0) {
    container.innerHTML = `<div class="text-xs text-slate-500 italic p-2">No active medications recorded.</div>`;
    return;
  }

  container.innerHTML = medications.map(m => `
    <div class="p-3 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between">
      <div class="space-y-0.5">
        <div class="font-bold text-slate-900 text-sm flex items-center gap-1.5">
          <i data-lucide="pill" class="w-4 h-4 text-teal-600"></i>
          ${m.drug}
        </div>
        <div class="text-xs text-slate-600">${m.dosage}</div>
        <div class="text-[11px] text-slate-400">Prescriber: ${m.prescribedBy}</div>
      </div>
      <div class="text-right">
        <span class="inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold bg-teal-50 text-teal-700 border border-teal-200">
          ${m.remainingDays} days left
        </span>
        <div class="text-[10px] text-slate-400 mt-1">${m.purpose || ''}</div>
      </div>
    </div>
  `).join('');
}

// Diagnostic Lab Results with Duplication Avoidance Warnings
function renderRecentDiagnostics(diagnostics) {
  const container = document.getElementById('docRecentDiagnosticsList');
  if (!container) return;

  if (diagnostics.length === 0) {
    container.innerHTML = `<div class="text-xs text-slate-500 italic p-2">No recent diagnostic lab tests.</div>`;
    return;
  }

  container.innerHTML = diagnostics.map(d => `
    <div class="p-3 bg-white border ${d.isRecent ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200'} rounded-xl shadow-xs space-y-1.5">
      <div class="flex items-center justify-between">
        <div class="font-bold text-slate-800 text-sm flex items-center gap-1.5">
          <i data-lucide="activity" class="w-4 h-4 text-teal-600"></i>
          ${d.testName}
        </div>
        <span class="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded">${d.date}</span>
      </div>
      <div class="text-xs text-slate-700"><strong>Result:</strong> ${d.result}</div>
      <div class="text-[11px] text-slate-500 flex items-center gap-1">
        <i data-lucide="building" class="w-3.5 h-3.5 text-slate-400"></i> ${d.facility}
      </div>
      ${d.duplicationWarning ? `
        <div class="mt-2 p-2 rounded-lg bg-amber-100/90 border border-amber-300 text-amber-900 text-xs font-semibold flex items-center gap-1.5">
          <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-700 shrink-0"></i>
          <span>${d.duplicationWarning}</span>
        </div>
      ` : ''}
    </div>
  `).join('');
}

// Active Conditions
function renderActiveConditions(conditions) {
  const container = document.getElementById('docConditionsList');
  if (!container) return;

  if (typeof conditions === 'string') {
    container.innerHTML = `<div class="p-3 bg-amber-50 text-amber-800 text-xs rounded-xl font-bold border border-amber-300">${conditions}</div>`;
    return;
  }

  if (conditions.length === 0) {
    container.innerHTML = `<div class="text-xs text-slate-500 italic p-2">No chronic conditions listed.</div>`;
    return;
  }

  container.innerHTML = conditions.map(c => `
    <div class="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs flex items-center justify-between">
      <div>
        <div class="font-bold text-slate-800">${c.condition}</div>
        <div class="text-slate-500 text-[11px]">Diagnosed: ${c.diagnosedDate} • ${c.phcNotes || ''}</div>
      </div>
      <span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-semibold rounded text-[11px]">${c.status}</span>
    </div>
  `).join('');
}

// Emergency Contacts
function renderEmergencyContacts(contacts) {
  const container = document.getElementById('docEmergencyContacts');
  if (!container) return;

  container.innerHTML = (contacts || []).map(ec => `
    <div class="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs flex items-center justify-between">
      <div>
        <div class="font-bold text-rose-950">${ec.name} (${ec.relation})</div>
        <div class="text-rose-700 font-mono text-xs">${ec.phone}</div>
      </div>
      <a href="tel:${ec.phone}" class="px-2.5 py-1 bg-rose-600 text-white font-bold rounded-md hover:bg-rose-700 flex items-center gap-1 text-xs">
        <i data-lucide="phone" class="w-3 h-3"></i> Call
      </a>
    </div>
  `).join('');
}

// Real-Time Prescribing Conflict Checker
function handlePrescribingInput(typedText) {
  if (!currentPatientData) return;

  clearTimeout(conflictDebounceTimer);
  conflictDebounceTimer = setTimeout(() => {
    const analysis = analyzePrescriptionConflicts(typedText, currentPatientData);
    displayConflictResults(analysis);
  }, 100);
}

function displayConflictResults(analysis) {
  const alertContainer = document.getElementById('prescribingConflictAlert');
  if (!alertContainer) return;

  const hasConflicts = analysis.conflicts && analysis.conflicts.length > 0;
  const hasDuplicates = analysis.duplicates && analysis.duplicates.length > 0;

  if (!hasConflicts && !hasDuplicates) {
    clearConflictAlert();
    return;
  }

  // Play conflict alert chime if newly detected
  if (window.healthAudio) window.healthAudio.playConflictWarning();

  alertContainer.classList.remove('hidden');
  alertContainer.classList.add('animate-conflict-alert');

  let html = '';

  if (hasConflicts) {
    html += analysis.conflicts.map(c => `
      <div class="p-3 bg-red-600 text-white rounded-xl shadow-lg border border-red-700 flex items-start gap-3">
        <i data-lucide="shield-alert" class="w-6 h-6 text-white shrink-0 mt-0.5 animate-ping"></i>
        <div class="space-y-1">
          <div class="font-extrabold text-sm uppercase tracking-wide flex items-center gap-2">
            <span>⛔ FATAL CONFLICT: ${c.detectedDrug}</span>
            <span class="bg-black/30 px-2 py-0.5 rounded text-[10px]">${c.severity}</span>
          </div>
          <p class="text-xs text-red-100">
            Patient has documented severe allergy to <strong>${c.allergen}</strong>. Reaction: <em>${c.patientReaction}</em>.
          </p>
          <div class="text-xs bg-white text-red-900 font-bold p-2 rounded-lg mt-1 flex items-center gap-1 shadow-sm">
            <i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-600 shrink-0"></i>
            <span>Safe ABDM PHC Alternative: <u>${c.alternative}</u></span>
          </div>
        </div>
      </div>
    `).join('');
  }

  if (hasDuplicates) {
    html += analysis.duplicates.map(d => `
      <div class="p-3 bg-amber-500 text-slate-950 rounded-xl shadow-md border border-amber-600 flex items-start gap-2.5">
        <i data-lucide="alert-triangle" class="w-5 h-5 text-slate-900 shrink-0 mt-0.5"></i>
        <div class="text-xs">
          <div class="font-extrabold text-xs uppercase">⚠️ DUPLICATION AVOIDANCE: ${d.drug}</div>
          <div class="mt-0.5">${d.reason}</div>
        </div>
      </div>
    `).join('');
  }

  alertContainer.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
}

function clearConflictAlert() {
  const alertContainer = document.getElementById('prescribingConflictAlert');
  if (alertContainer) {
    alertContainer.classList.add('hidden');
    alertContainer.innerHTML = '';
  }
}

// Emergency Break-Glass Handling
function handleBreakGlassUpdate(data) {
  const triageBadge = document.getElementById('breakGlassStatusBadge');
  const sensitiveSection = document.getElementById('docSensitiveRecordsSection');

  if (data.enabled) {
    if (window.healthAudio) window.healthAudio.playBreakGlassAlert();
    if (triageBadge) triageBadge.classList.remove('hidden');
    if (sensitiveSection) {
      sensitiveSection.classList.add('hidden');
    }
    // Reload restricted data
    if (data.patient) {
      loadPatientRecord(data.patient, currentSession || {});
    }
  } else {
    if (triageBadge) triageBadge.classList.add('hidden');
    if (sensitiveSection) {
      sensitiveSection.classList.remove('hidden');
    }
    if (data.patient) {
      loadPatientRecord(data.patient, currentSession || {});
    }
  }
}

// Setup Event Listeners
function setupDoctorEventListeners() {
  // Clinical notes keystroke listening
  const notesField = document.getElementById('doctorClinicalNotes');
  if (notesField) {
    notesField.addEventListener('input', (e) => {
      handlePrescribingInput(e.target.value);
    });
  }

  // Quick conflict test buttons for live judge demo
  const testPenicillinBtn = document.getElementById('testTypePenicillin');
  if (testPenicillinBtn) {
    testPenicillinBtn.addEventListener('click', () => {
      if (notesField) {
        notesField.value = 'Rx: Amoxicillin 500mg TDS for 5 days';
        handlePrescribingInput(notesField.value);
      }
    });
  }

  const testNsaidBtn = document.getElementById('testTypeNsaid');
  if (testNsaidBtn) {
    testNsaidBtn.addEventListener('click', () => {
      if (notesField) {
        notesField.value = 'Rx: Brufen (Ibuprofen 400mg) for fever and pain';
        handlePrescribingInput(notesField.value);
      }
    });
  }

  const testDuplicateBtn = document.getElementById('testTypeDuplicate');
  if (testDuplicateBtn) {
    testDuplicateBtn.addEventListener('click', () => {
      if (notesField) {
        notesField.value = 'Rx: Metformin 500mg twice daily';
        handlePrescribingInput(notesField.value);
      }
    });
  }

  // Reset Lockout button
  const resetBtn = document.getElementById('lockoutAcknowledgeBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', closeLockoutModalAndReset);
  }

  // Manual Instant Scan Trigger
  const demoScanBtn = document.getElementById('doctorDemoScanBtn');
  if (demoScanBtn) {
    demoScanBtn.addEventListener('click', () => {
      triggerDemoScan();
    });
  }
}

// Explicit window exports for cross-frame pitch demo control
window.triggerDemoScan = triggerDemoScan;
window.handlePrescribingInput = handlePrescribingInput;
window.executeRealtimeLockout = executeRealtimeLockout;
window.loadPatientRecord = loadPatientRecord;

