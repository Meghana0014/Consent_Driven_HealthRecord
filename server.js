const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const QRCode = require('qrcode');
const { analyzePrescriptionConflicts } = require('./public/js/conflict');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Load patients database
const patientsFilePath = path.join(__dirname, 'data', 'patients.json');
let patients = [];
try {
  patients = JSON.parse(fs.readFileSync(patientsFilePath, 'utf8'));
  console.log(`[ABDM Server] Loaded ${patients.length} patient records.`);
} catch (err) {
  console.error('[ABDM Server] Error loading patients.json:', err);
}

// In-Memory state for dynamic tokens, active sessions, and audit ledger
const dynamicTokens = new Map(); // tokenString -> { token, patientId, createdAt, expiresAt }
const activeSessions = new Map(); // sessionId -> { sessionId, patientId, doctorInfo, startedAt, accessLevel, status, wsClients }
const patientAuditLedger = new Map(); // patientId -> Array of audit events

// Seed initial mock audit ledger for demonstration
patients.forEach(p => {
  patientAuditLedger.set(p.id, [
    {
      id: 'AUD-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      doctorName: 'Dr. Ramesh Patil (MBBS, DNB)',
      facility: 'PHC Kalyan East OPD #2',
      accessLevel: 'FULL_MEDICAL_RECORD',
      timestamp: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
      durationSeconds: 195,
      status: 'COMPLETED',
      notes: 'Routine hypertension and diabetes monthly review. Prescription renewed.'
    },
    {
      id: 'AUD-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      doctorName: 'Dr. Sneha Kulkarni (MD)',
      facility: 'Thane District Hospital OPD',
      accessLevel: 'FULL_MEDICAL_RECORD',
      timestamp: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
      durationSeconds: 130,
      status: 'COMPLETED',
      notes: 'Lab review and diagnostic blood panel review.'
    }
  ]);
});

// Periodic token cleanup
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of dynamicTokens.entries()) {
    if (now > data.expiresAt) {
      dynamicTokens.delete(token);
    }
  }
}, 5000);

// Helper to get local network IP
function getLocalIpAddress() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        // Prefer Wi-Fi or local LAN (192.168.x.x or 10.x.x.x)
        if (alias.address.startsWith('192.168.') && !alias.address.startsWith('192.168.56.')) {
          return alias.address;
        }
      }
    }
  }
  return 'localhost';
}

// Network info and mobile QR link generation
app.get('/api/network-info', async (req, res) => {
  const localIp = getLocalIpAddress();
  const port = PORT;
  const patientUrl = `http://${localIp}:${port}/patient.html`;
  const doctorUrl = `http://${localIp}:${port}/doctor.html`;
  const demoUrl = `http://${localIp}:${port}/demo.html`;

  try {
    const patientQr = await QRCode.toDataURL(patientUrl, { margin: 1, width: 180 });
    const doctorQr = await QRCode.toDataURL(doctorUrl, { margin: 1, width: 180 });

    res.json({
      success: true,
      localIp,
      port,
      urls: { patientUrl, doctorUrl, demoUrl },
      qrs: { patientQr, doctorQr }
    });
  } catch (e) {
    res.json({
      success: true,
      localIp,
      port,
      urls: { patientUrl, doctorUrl, demoUrl }
    });
  }
});

// Helper to generate a dynamic 30-second token
function generateDynamicToken(patientId) {
  const now = Date.now();
  const token = 'ABDM-' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000);
  const expiresAt = now + 30 * 1000; // 30 seconds expiry

  const tokenObj = {
    token,
    patientId,
    createdAt: now,
    expiresAt,
    ttlSeconds: 30
  };

  dynamicTokens.set(token, tokenObj);
  return tokenObj;
}

// Generate emergency "Break-Glass" limited payload
function getBreakGlassData(patient) {
  return {
    isBreakGlass: true,
    id: patient.id,
    abhaId: patient.abhaId,
    abhaAddress: patient.abhaAddress,
    name: patient.name,
    age: patient.age,
    gender: patient.gender,
    bloodGroup: patient.bloodGroup,
    photo: patient.photo,
    phone: patient.phone,
    registeredFacility: patient.registeredFacility,
    emergencyContacts: patient.emergencyContacts,
    criticalAllergies: patient.criticalAllergies,
    // Sensitive records are explicitly excluded
    activeConditions: "LOCKED - Break-Glass Emergency Mode restricts full medical history",
    activeMedications: "LOCKED - Break-Glass Emergency Mode",
    recentDiagnostics: [],
    pastSurgeries: [],
    immunizations: []
  };
}

// ---------------- REST API ROUTES ----------------

// Get all patient profiles
app.get('/api/patients', (req, res) => {
  const summaries = patients.map(p => ({
    id: p.id,
    abhaId: p.abhaId,
    abhaAddress: p.abhaAddress,
    name: p.name,
    age: p.age,
    gender: p.gender,
    bloodGroup: p.bloodGroup,
    photo: p.photo,
    facility: p.registeredFacility,
    allergyCount: (p.criticalAllergies || []).length
  }));
  res.json({ success: true, patients: summaries });
});

// Get single patient profile
app.get('/api/patients/:id', (req, res) => {
  const patient = patients.find(p => p.id === req.params.id || p.abhaId === req.params.id);
  if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });
  res.json({ success: true, patient });
});

// Generate dynamic 30s QR token
app.post('/api/token/generate', async (req, res) => {
  const { patientId } = req.body;
  const patient = patients.find(p => p.id === patientId || p.abhaId === patientId);
  if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });

  const tokenObj = generateDynamicToken(patient.id);

  // Encode structured payload into QR code
  const qrPayload = JSON.stringify({
    schema: 'ABDM-HEALTH-TOKEN-V1',
    token: tokenObj.token,
    patientId: patient.id,
    abhaId: patient.abhaId,
    name: patient.name,
    expiresAt: tokenObj.expiresAt
  });

  try {
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    res.json({
      success: true,
      token: tokenObj.token,
      expiresAt: tokenObj.expiresAt,
      ttlSeconds: 30,
      qrDataUrl,
      rawPayload: qrPayload
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'QR generation failed', error: err.message });
  }
});

// Doctor scans token and establishes live session
app.post('/api/token/scan', (req, res) => {
  const { token, rawPayload, doctorName = 'Dr. Ananya Mehta (MD, General Medicine)', facility = 'District Hospital Thane - Emergency OPD' } = req.body;
  
  let targetToken = token;
  if (!targetToken && rawPayload) {
    try {
      const parsed = JSON.parse(rawPayload);
      targetToken = parsed.token;
    } catch (e) {
      targetToken = rawPayload;
    }
  }

  const tokenData = dynamicTokens.get(targetToken);
  if (!tokenData) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or Expired QR Token. Patient dynamic tokens rotate every 30 seconds for security.'
    });
  }

  if (Date.now() > tokenData.expiresAt) {
    dynamicTokens.delete(targetToken);
    return res.status(400).json({
      success: false,
      message: 'Token Expired. The 30-second security window has elapsed. Please scan the newly generated QR code.'
    });
  }

  const patient = patients.find(p => p.id === tokenData.patientId);
  if (!patient) {
    return res.status(404).json({ success: false, message: 'Patient not found' });
  }

  // Create new active session
  const sessionId = 'SES-' + Math.random().toString(36).substring(2, 9).toUpperCase();
  const sessionObj = {
    sessionId,
    patientId: patient.id,
    doctorName,
    facility,
    startedAt: Date.now(),
    status: 'ACTIVE',
    accessLevel: 'FULL_MEDICAL_RECORD'
  };

  activeSessions.set(sessionId, sessionObj);

  // Add to patient's audit ledger
  const auditEntry = {
    id: 'AUD-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
    sessionId,
    doctorName,
    facility,
    accessLevel: 'FULL_MEDICAL_RECORD',
    timestamp: new Date().toISOString(),
    durationSeconds: 0,
    status: 'ACTIVE',
    notes: 'Live session initialized via dynamic QR point-of-care scan.'
  };

  const ledger = patientAuditLedger.get(patient.id) || [];
  ledger.unshift(auditEntry);
  patientAuditLedger.set(patient.id, ledger);

  // Broadcast to Patient App via WebSocket
  broadcastToPatient(patient.id, {
    type: 'DOCTOR_CONNECTED',
    sessionId,
    doctorName,
    facility,
    accessLevel: 'FULL_MEDICAL_RECORD',
    timestamp: new Date().toISOString()
  });

  // Consume one-time token immediately for high security
  dynamicTokens.delete(targetToken);

  res.json({
    success: true,
    sessionId,
    patient,
    doctor: { name: doctorName, facility },
    accessLevel: 'FULL_MEDICAL_RECORD',
    timestamp: new Date().toISOString()
  });
});

// Patient or Doctor revokes access immediately
app.post('/api/session/revoke', (req, res) => {
  const { sessionId, patientId, reason = 'Revoked by Patient in Real Time via Consent Center' } = req.body;

  let session = null;
  if (sessionId) {
    session = activeSessions.get(sessionId);
  } else if (patientId) {
    // Find active session for patient
    for (const [id, s] of activeSessions.entries()) {
      if (s.patientId === patientId && s.status === 'ACTIVE') {
        session = s;
        break;
      }
    }
  }

  if (!session) {
    return res.status(404).json({ success: false, message: 'No active session found to revoke.' });
  }

  const durationSeconds = Math.round((Date.now() - session.startedAt) / 1000);
  session.status = 'REVOKED';
  session.revokedAt = Date.now();
  session.durationSeconds = durationSeconds;

  // Update audit ledger
  const ledger = patientAuditLedger.get(session.patientId) || [];
  const entry = ledger.find(e => e.sessionId === session.sessionId);
  if (entry) {
    entry.status = 'REVOKED';
    entry.durationSeconds = durationSeconds;
    entry.notes = `Session Terminated: ${reason} (Duration: ${durationSeconds}s)`;
  }

  // Real-time instant broadcast over WebSocket: LOCK OUT DOCTOR TERMINAL IMMEDIATELY!
  broadcastToDoctor(session.sessionId, {
    type: 'SESSION_REVOKED',
    sessionId: session.sessionId,
    reason,
    timestamp: new Date().toISOString()
  });

  // Also notify patient
  broadcastToPatient(session.patientId, {
    type: 'SESSION_REVOKED_CONFIRMED',
    sessionId: session.sessionId,
    durationSeconds,
    timestamp: new Date().toISOString()
  });

  res.json({
    success: true,
    message: 'Access successfully revoked in real time.',
    sessionId: session.sessionId,
    durationSeconds
  });
});

// Toggle Break-Glass emergency triage mode
app.post('/api/session/break-glass', (req, res) => {
  const { sessionId, patientId, enabled } = req.body;

  let session = null;
  if (sessionId) {
    session = activeSessions.get(sessionId);
  } else if (patientId) {
    for (const [id, s] of activeSessions.entries()) {
      if (s.patientId === patientId && s.status === 'ACTIVE') {
        session = s;
        break;
      }
    }
  }

  const pId = session ? session.patientId : patientId;
  const patient = patients.find(p => p.id === pId);
  if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });

  const newAccessLevel = enabled ? 'BREAK_GLASS_TRIAGE' : 'FULL_MEDICAL_RECORD';

  if (session) {
    session.accessLevel = newAccessLevel;
    
    // Update audit entry
    const ledger = patientAuditLedger.get(session.patientId) || [];
    const entry = ledger.find(e => e.sessionId === session.sessionId);
    if (entry) {
      entry.accessLevel = newAccessLevel;
    }

    // Broadcast to Doctor terminal
    const payloadData = enabled ? getBreakGlassData(patient) : patient;
    broadcastToDoctor(session.sessionId, {
      type: 'BREAK_GLASS_UPDATE',
      enabled: Boolean(enabled),
      accessLevel: newAccessLevel,
      patient: payloadData,
      timestamp: new Date().toISOString()
    });
  }

  // Broadcast to patient
  broadcastToPatient(pId, {
    type: 'BREAK_GLASS_STATUS',
    enabled: Boolean(enabled)
  });

  res.json({
    success: true,
    enabled: Boolean(enabled),
    accessLevel: newAccessLevel
  });
});

// Get Audit Trail Ledger
app.get('/api/audit-ledger/:patientId', (req, res) => {
  const ledger = patientAuditLedger.get(req.params.patientId) || [];
  res.json({ success: true, ledger });
});

// Real-time conflict checking endpoint
app.post('/api/check-conflicts', (req, res) => {
  const { text, patientId } = req.body;
  const patient = patients.find(p => p.id === patientId);
  if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });

  const analysis = analyzePrescriptionConflicts(text, patient);
  res.json({ success: true, ...analysis });
});

// ---------------- WEBSOCKET LOGIC ----------------

// Map of WebSocket connections
// ws -> { role: 'PATIENT' | 'DOCTOR', patientId, sessionId }
const socketMetadata = new Map();

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (messageStr) => {
    try {
      const data = JSON.parse(messageStr);

      switch (data.type) {
        case 'REGISTER_PATIENT': {
          socketMetadata.set(ws, {
            role: 'PATIENT',
            patientId: data.patientId
          });
          ws.send(JSON.stringify({ type: 'REGISTERED', role: 'PATIENT', patientId: data.patientId }));
          break;
        }

        case 'REGISTER_DOCTOR': {
          socketMetadata.set(ws, {
            role: 'DOCTOR',
            sessionId: data.sessionId,
            patientId: data.patientId
          });
          ws.send(JSON.stringify({ type: 'REGISTERED', role: 'DOCTOR', sessionId: data.sessionId }));
          break;
        }

        case 'PING': {
          ws.send(JSON.stringify({ type: 'PONG', clientTime: data.clientTime, serverTime: Date.now() }));
          break;
        }

        case 'REVOKE_REQUEST': {
          // Direct WS revocation
          const meta = socketMetadata.get(ws);
          const pId = data.patientId || (meta ? meta.patientId : null);
          const sId = data.sessionId;

          let targetSession = null;
          if (sId) {
            targetSession = activeSessions.get(sId);
          } else if (pId) {
            for (const [id, s] of activeSessions.entries()) {
              if (s.patientId === pId && s.status === 'ACTIVE') {
                targetSession = s;
                break;
              }
            }
          }

          if (targetSession) {
            const duration = Math.round((Date.now() - targetSession.startedAt) / 1000);
            targetSession.status = 'REVOKED';
            targetSession.revokedAt = Date.now();
            targetSession.durationSeconds = duration;

            // Update ledger
            const ledger = patientAuditLedger.get(targetSession.patientId) || [];
            const entry = ledger.find(e => e.sessionId === targetSession.sessionId);
            if (entry) {
              entry.status = 'REVOKED';
              entry.durationSeconds = duration;
            }

            // Broadcast to Doctor immediately
            broadcastToDoctor(targetSession.sessionId, {
              type: 'SESSION_REVOKED',
              sessionId: targetSession.sessionId,
              reason: 'Revoked by Patient in Real Time via Consent Center',
              timestamp: new Date().toISOString()
            });

            // Confirm to Patient
            ws.send(JSON.stringify({
              type: 'SESSION_REVOKED_CONFIRMED',
              sessionId: targetSession.sessionId,
              durationSeconds: duration
            }));
          }
          break;
        }

        case 'SIMULATE_SCAN': {
          // One-click demo scan from either terminal or demo frame
          const patient = patients.find(p => p.id === data.patientId) || patients[0];
          const tokenObj = generateDynamicToken(patient.id);

          const sessionId = 'SES-' + Math.random().toString(36).substring(2, 9).toUpperCase();
          const sessionObj = {
            sessionId,
            patientId: patient.id,
            doctorName: data.doctorName || 'Dr. Ananya Mehta (MD, General Medicine)',
            facility: data.facility || 'District Hospital Thane - Emergency OPD',
            startedAt: Date.now(),
            status: 'ACTIVE',
            accessLevel: 'FULL_MEDICAL_RECORD'
          };

          activeSessions.set(sessionId, sessionObj);

          // Add to ledger
          const auditEntry = {
            id: 'AUD-' + Math.random().toString(36).substring(2, 8).toUpperCase(),
            sessionId,
            doctorName: sessionObj.doctorName,
            facility: sessionObj.facility,
            accessLevel: 'FULL_MEDICAL_RECORD',
            timestamp: new Date().toISOString(),
            durationSeconds: 0,
            status: 'ACTIVE',
            notes: 'Interactive Demo instant scan trigger.'
          };

          const ledger = patientAuditLedger.get(patient.id) || [];
          ledger.unshift(auditEntry);
          patientAuditLedger.set(patient.id, ledger);

          // Notify Patient
          broadcastToPatient(patient.id, {
            type: 'DOCTOR_CONNECTED',
            sessionId,
            doctorName: sessionObj.doctorName,
            facility: sessionObj.facility,
            accessLevel: 'FULL_MEDICAL_RECORD',
            timestamp: new Date().toISOString()
          });

          // Notify Doctor
          broadcastToDoctor(sessionId, {
            type: 'CONSENT_GRANTED',
            sessionId,
            patient,
            doctor: { name: sessionObj.doctorName, facility: sessionObj.facility },
            accessLevel: 'FULL_MEDICAL_RECORD'
          });

          // Also reply to caller
          ws.send(JSON.stringify({
            type: 'SIMULATION_SUCCESS',
            sessionId,
            patientId: patient.id
          }));
          break;
        }
      }
    } catch (e) {
      console.error('[WebSocket] Message handling error:', e);
    }
  });

  ws.on('close', () => {
    socketMetadata.delete(ws);
  });
});

function broadcastToPatient(patientId, payload) {
  const messageStr = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      const meta = socketMetadata.get(client);
      if (meta && meta.role === 'PATIENT' && (meta.patientId === patientId || !meta.patientId)) {
        client.send(messageStr);
      }
      // Also send to demo view if subscribed
      if (meta && meta.role === 'DEMO') {
        client.send(messageStr);
      }
    }
  });
}

function broadcastToDoctor(sessionId, payload) {
  const messageStr = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      const meta = socketMetadata.get(client);
      if (meta && meta.role === 'DOCTOR' && (!sessionId || meta.sessionId === sessionId || !meta.sessionId)) {
        client.send(messageStr);
      }
      if (meta && meta.role === 'DEMO') {
        client.send(messageStr);
      }
    }
  });
}

// Global broadcast
function broadcastAll(payload) {
  const messageStr = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
}

// Start HTTP + WS server
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🏥 Health Record ABDM Platform running at:`);
  console.log(`👉 Demo Hub & Live 2-Screen: http://localhost:${PORT}`);
  console.log(`👉 Patient Consent Center:    http://localhost:${PORT}/patient.html`);
  console.log(`👉 Doctor Point-of-Care:     http://localhost:${PORT}/doctor.html`);
  console.log(`👉 Split Screen Demo:        http://localhost:${PORT}/demo.html`);
  console.log(`=======================================================`);
});
