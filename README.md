# 🏥 ABDM Real-Time Health Platform
### Zero-Friction Point-of-Care EMR with Instant Patient Consent Revocation

A lightweight, mobile-first web platform connecting patients and healthcare providers across **Primary Health Centres (PHCs), private clinics, and district hospitals**. It delivers **total patient sovereignty over health data** via dynamic, self-destructing QR codes and real-time consent revocation, while empowering physicians with **sub-second, zero-friction access** to life-saving clinical history without requiring laptops, software installations, or specialized training.

---

## 🌟Impressive Features of this prototype
In modern healthcare, patient consent is often treated as static and unverifiable. In this platform:
1. **Screen 1 (Patient Mobile View)** displays an auto-refreshing 30-second ABHA QR code.
2. **Screen 2 (Doctor Tablet View)** scans the code and instantly displays critical allergy warnings, active medications, and duplication lab alerts in **< 1 second**.
3. **The Winning Action:** Hand Screen 2 (Doctor View) to a judge. Tap **"REVOKE ACCESS NOW"** on Screen 1.
4. **Instant Lockout:** In **< 50 milliseconds**, the judge's screen instantly blurs with a security barrier and triggers an audible alarm:
   > **"SESSION TERMINATED: Access Revoked by Patient in Real Time."**  
   > *All clinical records and notes are immediately wiped from memory in compliance with ABDM & DPDP privacy directives.*

---

## 🚀 Key Modules Built

### 1. Patient App (Consent & Control Center) — `/patient.html`
* **ABHA & Verified Identity:** Displays verified ABHA ID (`91-4821-3920-1129`), ABHA address (`rajesh.sharma@abdm`), and NHA verification badge.
* **30-Second Dynamic QR Code Engine:** Generates cryptographically unique one-time tokens rotating every 30 seconds with an animated countdown ring to eliminate replay attacks.
* **Live Consent Toggles & Cutoff Button:** Live connection banner showing the active doctor (`Dr. Ananya Mehta - District Hospital OPD`) with a prominent red **"REVOKE ACCESS NOW"** button.
* **Emergency "Break-Glass" Mode:** Dedicated toggle for ER trauma and unconscious triage that exposes strictly life-saving parameters (Blood Group, Fatal Allergies, Emergency Contacts) while keeping all private notes and diagnostic history locked.
* **Immutable Access Ledger & Audit Trail:** Real-time log tracking every facility, doctor, timestamp, session duration, and revocation status aligned with Section 4(3) of India's Digital Personal Data Protection (DPDP) Act.
* **Profile Switcher:** Allows toggling between diverse clinical scenarios (Elderly Diabetic with Penicillin & NSAID allergies, Young Asthmatic with Sulfa drug allergies, etc.).

### 2. Doctor Point-of-Care Terminal — `/doctor.html`
* **Zero-Friction Camera Scanner:** Runs directly inside any mobile, tablet, or desktop web browser (`html5-qrcode` integration) — no apps, dongles, or logins required. Includes a 1-click demo scan button for instant pitch execution.
* **High-Priority Allergy Banner:** Unmissable crimson warning banner with urgent pulsating glow highlighting recorded drug allergies (e.g. *Penicillin Anaphylaxis*, *Aspirin/NSAID Angioedema*).
* **Treatment History & Duplication Avoidance:** Displays active prescriptions with days remaining, plus recent lab tests flagged with clear duplication warnings (e.g. *Serum Creatinine done 2 days ago at PHC Kalyan — Avoid duplicate test ordering*).
* **Real-Time Prescribing Conflict Checker:** Keystroke analyzer scanning doctor's clinical notes as they type. Typing `"Amoxicillin"` or `"Brufen"` triggers an immediate high-severity alert warning of cross-reactivity with the patient's recorded allergies and suggests safe PHC formulary alternatives.
* **Instant Lockout Modal:** Upon patient revocation, applies `backdrop-filter: blur(28px)`, sounds a security alarm, and completely purges the DOM and memory state.

### 3. Real-Time Revocation Engine (`server.js`)
* **WebSocket Bi-Directional Synchronization:** Sub-50ms latency linking patient and doctor sessions.
* **Token Rotation & Garbage Collection:** Auto-expiring tokens with zero-replay vulnerability.
* **Multi-Device Local Discovery:** Exposes local Wi-Fi IP and dynamic QR codes so judges can scan and test the platform directly on their physical mobile phones and iPads.

### 4. Interactive Live 2-Screen Demo Hub — `/demo.html`
* **Side-by-Side Dual View:** Realistic iPhone 16 mockup (Patient) and iPad Pro mockup (Doctor) side-by-side with synchronized state.
* **Interactive 5-Step Pitch Bar:** Presenters can step through the entire flow with 1-click simulation triggers and a live WebSocket latency telemetry meter (`12 ms`).

---

## 💻 Quick Start & Running the Project

### Prerequisites
* **Node.js** (v18+)
* **npm**

### Installation & Launch
```bash
# 1. Clone or navigate to the project directory
cd Health_record

# 2. Install dependencies (Express, ws, qrcode, cors)
npm install

# 3. Start the ABDM Platform Server
npm start
```

### URLs & Access Points
| Interface | URL | Purpose |
| :--- | :--- | :--- |
| **Demo Hub & Multi-Device Launchpad** | `http://localhost:3000/` | Main portal with device QR codes & documentation |
| **Live 2-Screen Pitch Demo** | `http://localhost:3000/demo.html` | Side-by-side Patient + Doctor interactive pitch view |
| **Screen 1: Patient App** | `http://localhost:3000/patient.html` | Standalone mobile consent center |
| **Screen 2: Doctor Terminal** | `http://localhost:3000/doctor.html` | Standalone point-of-care mobile/tablet scanner |

---

## 📱 Testing on Physical Phones & Tablets Over Wi-Fi
Both phones/tablets must be connected to the same Wi-Fi network:
1. Open `http://<your-local-ip>:3000/` on your computer (e.g. `http://192.168.1.8:3000`).
2. Scan the **Patient QR** with Phone 1 to load the Patient Consent Center.
3. Scan the **Doctor QR** with Phone 2 / iPad to load the Point-of-Care Terminal.
4. Point Phone 2's camera at Phone 1's dynamic 30s QR code to scan live!
5. Tap **"REVOKE ACCESS NOW"** on Phone 1 — Phone 2 locks out immediately!

---

## 🧪 Step-by-Step Hackathon Demo Script

1. **Step 1 — Show Patient Control:** Open `http://localhost:3000/demo.html`. Point out the auto-refreshing 30-second QR code ring and verified ABHA credentials.
2. **Step 2 — Point-of-Care Scan:** Click **"1. Simulate Doctor Scan"** (or use the camera scanner). Within **0.2 seconds**, Doctor Terminal loads the patient's record.
3. **Step 3 — Highlight Clinical Value:** Show the bright red **High-Priority Allergy Banner** (`Penicillin - FATAL ANAPHYLAXIS`) and the **Duplication Avoidance** warning on the recent Renal Panel from PHC Kalyan.
4. **Step 4 — Real-Time Conflict Checker:** Click **"2. Type 'Amoxicillin'"** (or type inside Doctor notes). The platform instantly flags:
   > `⛔ FATAL CONFLICT: Amoxicillin — Cross-reactive with Penicillin allergy! High risk of fatal anaphylaxis. Safe Alternative: Azithromycin 500mg.`
5. **Step 5 — The "Aha!" Moment:** Click **"3. Tap 'REVOKE ACCESS NOW'"** on Screen 1. Doctor Screen 2 instantly plays an alarm, blurs into a dark security shield, and displays:
   > `🔒 SESSION TERMINATED: Access Revoked by Patient in Real Time.`
