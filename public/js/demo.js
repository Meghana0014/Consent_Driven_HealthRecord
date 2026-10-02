// Interactive 2-Screen Side-by-Side Demo Orchestrator

let demoWs = null;
let currentStepIndex = 1;
let latencyMs = 12;

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  initDemoWebSocket();
  setupDemoControls();
  startLatencyMonitor();
});

// WebSocket for Telemetry and Synchronization
function initDemoWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  demoWs = new WebSocket(wsUrl);

  demoWs.onopen = () => {
    console.log('[Demo Hub WS] Connected.');
    updateDemoTelemetry(true);
    demoWs.send(JSON.stringify({
      type: 'REGISTER_DEMO'
    }));
  };

  demoWs.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'PONG') {
        const roundtrip = Date.now() - msg.clientTime;
        latencyMs = Math.round(roundtrip / 2);
        updateLatencyDisplay(latencyMs);
      }
    } catch (err) {}
  };

  demoWs.onclose = () => {
    updateDemoTelemetry(false);
    setTimeout(initDemoWebSocket, 2000);
  };
}

function updateDemoTelemetry(connected) {
  const badge = document.getElementById('demoWsTelemetry');
  if (badge) {
    badge.className = connected 
      ? 'flex items-center gap-2 bg-emerald-950/80 border border-emerald-800 text-emerald-400 px-3 py-1 rounded-full text-xs font-semibold'
      : 'flex items-center gap-2 bg-red-950/80 border border-red-800 text-red-400 px-3 py-1 rounded-full text-xs font-semibold';
    badge.innerHTML = `<span class="w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}"></span> <span>ABDM Realtime: ${connected ? 'Active' : 'Connecting...'}</span>`;
  }
}

function startLatencyMonitor() {
  setInterval(() => {
    if (demoWs && demoWs.readyState === WebSocket.OPEN) {
      demoWs.send(JSON.stringify({
        type: 'PING',
        clientTime: Date.now()
      }));
    }
  }, 3000);
}

function updateLatencyDisplay(ms) {
  const latencyEl = document.getElementById('telemetryLatency');
  if (latencyEl) {
    latencyEl.textContent = `${ms} ms`;
  }
}

// Demo Controls & Step Walkthrough
function setupDemoControls() {
  // Step 2: Simulate Scan button
  const simulateScanBtn = document.getElementById('demoSimulateScanBtn');
  if (simulateScanBtn) {
    simulateScanBtn.addEventListener('click', triggerSimulatedScan);
  }

  // Step 5: Revoke button from master bar
  const masterRevokeBtn = document.getElementById('demoMasterRevokeBtn');
  if (masterRevokeBtn) {
    masterRevokeBtn.addEventListener('click', triggerMasterRevoke);
  }

  // Break Glass toggle
  const masterBreakGlassBtn = document.getElementById('demoMasterBreakGlassBtn');
  if (masterBreakGlassBtn) {
    masterBreakGlassBtn.addEventListener('click', triggerMasterBreakGlass);
  }

  // Quick conflict type trigger
  const conflictTestBtn = document.getElementById('demoConflictTestBtn');
  if (conflictTestBtn) {
    conflictTestBtn.addEventListener('click', triggerConflictTestInDoctorFrame);
  }

  // Step buttons in guided pitch bar
  document.querySelectorAll('.pitch-step-pill').forEach(pill => {
    pill.addEventListener('click', (e) => {
      const step = parseInt(pill.getAttribute('data-step'), 10);
      activatePitchStep(step);
    });
  });
}

// Trigger simulated QR code scan from patient to doctor frame
function triggerSimulatedScan() {
  const doctorIframe = document.getElementById('doctorFrame');
  if (doctorIframe && doctorIframe.contentWindow && doctorIframe.contentWindow.triggerDemoScan) {
    doctorIframe.contentWindow.triggerDemoScan();
    activatePitchStep(3);
  } else {
    // Call server directly via WS
    if (demoWs && demoWs.readyState === WebSocket.OPEN) {
      demoWs.send(JSON.stringify({
        type: 'SIMULATE_SCAN',
        doctorName: 'Dr. Ananya Mehta (MD, General Medicine)',
        facility: 'District Hospital Thane - Emergency OPD'
      }));
      activatePitchStep(3);
    }
  }
}

// Trigger Master Revoke on patient frame
function triggerMasterRevoke() {
  const patientIframe = document.getElementById('patientFrame');
  if (patientIframe && patientIframe.contentWindow && patientIframe.contentWindow.revokeAccessNow) {
    patientIframe.contentWindow.revokeAccessNow();
    activatePitchStep(5);
  } else {
    fetch('/api/session/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Revoked by Patient in Real Time via Master Pitch Control' })
    });
    activatePitchStep(5);
  }
}

// Trigger Break Glass
let isBreakGlassActive = false;
function triggerMasterBreakGlass() {
  isBreakGlassActive = !isBreakGlassActive;
  const patientIframe = document.getElementById('patientFrame');
  if (patientIframe && patientIframe.contentWindow && patientIframe.contentWindow.toggleBreakGlass) {
    patientIframe.contentWindow.toggleBreakGlass(isBreakGlassActive);
  } else {
    fetch('/api/session/break-glass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: isBreakGlassActive })
    });
  }

  const btn = document.getElementById('demoMasterBreakGlassBtn');
  if (btn) {
    if (isBreakGlassActive) {
      btn.classList.add('bg-amber-600', 'text-white');
      btn.classList.remove('bg-slate-800', 'text-amber-400');
    } else {
      btn.classList.remove('bg-amber-600', 'text-white');
      btn.classList.add('bg-slate-800', 'text-amber-400');
    }
  }
}

// Trigger Conflict Typing inside Doctor Iframe
function triggerConflictTestInDoctorFrame() {
  const doctorIframe = document.getElementById('doctorFrame');
  if (doctorIframe && doctorIframe.contentWindow) {
    const docDoc = doctorIframe.contentWindow.document;
    const notes = docDoc.getElementById('doctorClinicalNotes');
    if (notes) {
      notes.value = 'Rx: Amoxicillin 500mg TDS for 5 days';
      if (doctorIframe.contentWindow.handlePrescribingInput) {
        doctorIframe.contentWindow.handlePrescribingInput(notes.value);
      }
      activatePitchStep(4);
    }
  }
}

// Activate Pitch Step Pill
function activatePitchStep(stepNumber) {
  currentStepIndex = stepNumber;
  document.querySelectorAll('.pitch-step-pill').forEach(pill => {
    const s = parseInt(pill.getAttribute('data-step'), 10);
    if (s === stepNumber) {
      pill.classList.remove('bg-slate-800', 'text-slate-400', 'border-slate-700');
      pill.classList.add('bg-teal-600', 'text-white', 'border-teal-400', 'font-extrabold', 'shadow-md');
    } else if (s < stepNumber) {
      pill.classList.remove('bg-slate-800', 'border-slate-700');
      pill.classList.add('bg-emerald-950', 'text-emerald-400', 'border-emerald-800');
    } else {
      pill.className = 'pitch-step-pill px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 text-xs font-semibold hover:border-slate-700 transition-all cursor-pointer';
    }
  });

  const guideText = document.getElementById('stepGuideBanner');
  if (guideText) {
    switch (stepNumber) {
      case 1:
        guideText.innerHTML = `<strong>Step 1: Patient displays dynamic QR:</strong> Notice how the QR code rotates every 30 seconds with an animated timer ring, preventing replay attacks.`;
        break;
      case 2:
        guideText.innerHTML = `<strong>Step 2: Doctor Point-of-Care Scan:</strong> Doctor opens camera or taps <em>"Simulate Scan"</em>. Zero logins or laptops required.`;
        break;
      case 3:
        guideText.innerHTML = `<strong>Step 3: Sub-Second Clinical Access:</strong> Within &lt;1s, Doctor terminal displays the critical allergy banner and duplication warnings for lab tests.`;
        break;
      case 4:
        guideText.innerHTML = `<strong>Step 4: Prescribing Conflict Checker:</strong> Doctor types prescription notes. Keystroke analyzer instantly flags lethal interactions (e.g., Amoxicillin vs Penicillin allergy).`;
        break;
      case 5:
        guideText.innerHTML = `<strong>Step 5: Instant Lockout:</strong> Tap <em>"REVOKE ACCESS NOW"</em> on Screen 1. The doctor screen instantly blurs and locks out in real time.`;
        break;
    }
  }
}
