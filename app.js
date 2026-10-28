const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyMkTuDRTMRfSy6mrP2X_XSYMKSv4mG13dCdITgbe-fWQkLRr2VKHBXybH4aAwc8qX0/exec";

// If nobody scans anything for this long, the PIN is cleared and the PIN screen returns.
const IDLE_LIMIT_MS = 2 * 60 * 1000;

// --- VERSION: current release is below. Keep ALL files on the same number (see README.md) ---
const APP_VERSION = "1.4.0";
let lastScriptV = "";

function cmpVer(a, b) {
    const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
    }
    return 0;
}

function showVersion(scriptV) {
    const el = document.getElementById("version-line");
    if (!el) return;
    if (scriptV) lastScriptV = scriptV;
    let text = "v" + APP_VERSION;
    let tip = "";
    const c = lastScriptV ? cmpVer(APP_VERSION, lastScriptV) : 0;
    if (c < 0) {
        text += " - out of date (latest is v" + lastScriptV + "), press Ctrl+Shift+R";
        tip = "Latest release is v" + lastScriptV + ". Hard refresh; if it stays on this version, the GitHub files need updating (see README).";
    } else if (c > 0) {
        text += " - script needs redeploying (script is v" + lastScriptV + ")";
        tip = "This page is newer than the script. Paste Code.gs into Apps Script and deploy a new version (see README).";
    }
    el.textContent = text;
    el.title = tip;
    el.classList.toggle("mismatch", c !== 0);
}

let userName = "";
let userSites = [];
let wasCheckedIn = false;
let checkedInSiteId = "";
let userRole = "Contractor";
let enteredPin = "";
let currentAction = "Check-In";
let html5QrCode = null;
let busy = false;
let handlingScan = false;
let idleTimer = null;
let pendingScan = null;

// --- Backend helper ---
// text/plain avoids a CORS preflight, which Apps Script can't answer.
async function callBackend(payload) {
    const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    showVersion(data.version);
    return data;
}

// --- Idle timeout / log out ---
function startIdleTimer(ms) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { location.reload(); }, ms || IDLE_LIMIT_MS);
}

function logout() {
    clearTimeout(idleTimer);
    location.reload(); // clears the PIN from memory and stops the camera
}

// --- PIN Pad Logic ---
function pressKey(num) {
    if (busy) return;
    if (enteredPin.length < 8) {
        enteredPin += num;
        updatePinDots();
    }
}

function clearPin() {
    if (busy) return;
    enteredPin = "";
    updatePinDots();
    document.getElementById("pin-error").innerText = "";
}

function updatePinDots() {
    const dots = "●".repeat(enteredPin.length) + "○".repeat(Math.max(0, 4 - enteredPin.length));
    document.getElementById("pin-dots").innerText = dots;
}

async function submitPin() {
    if (busy) return;
    const errorEl = document.getElementById("pin-error");

    if (enteredPin.length < 4) {
        errorEl.innerText = "Please enter your PIN.";
        return;
    }

    busy = true;
    errorEl.innerText = "Checking PIN...";

    try {
        const result = await callBackend({ type: "verify", pin: enteredPin });

        if (result.status !== "SUCCESS") {
            errorEl.innerText = (result.reason === "Invalid or Inactive PIN")
                ? "PIN not recognised. Try again."
                : (result.reason || "Something went wrong. Try again.");
            enteredPin = "";
            updatePinDots();
            return;
        }

        if (result.role === "Admin") {
            sessionStorage.setItem("adminToken", result.token);
            sessionStorage.setItem("adminName", result.name);
            location.href = "admin.html";
            return;
        }

        errorEl.innerText = "";
        userName = result.name;
        userSites = result.sites || [];
        wasCheckedIn = !!result.checkedIn;
        checkedInSiteId = result.checkedInSiteId || "";
        userRole = result.role || "Contractor";

        // "Back to menu" only makes sense for people who have both options
        document.querySelectorAll(".back-btn").forEach((b) => b.classList.toggle("hidden", userRole !== "Contractor/QA"));

        if (userRole === "QA") openQa();
        else if (userRole === "Contractor/QA") openMenu();
        else openAttendance();
    } catch (err) {
        errorEl.innerText = "Could not reach the server. Check your signal and try again.";
    } finally {
        busy = false;
    }
}

// --- Screens ---
function showScreen(name, title, sub) {
    ["pin", "menu", "scanner", "qa"].forEach((x) => {
        document.getElementById(x + "-screen").classList.toggle("hidden", x !== name);
    });
    document.getElementById("app-title").innerText = title;
    document.getElementById("app-subtitle").innerText = sub;
    window.scrollTo(0, 0);
}

function openMenu() {
    showScreen("menu", "Logged in: " + userName, "Please select an option");
    startIdleTimer();
}

function openAttendance() {
    document.getElementById("contractor-greeting").innerText = wasCheckedIn
        ? `Welcome, ${userName}. You're currently checked in.`
        : `Welcome, ${userName}`;
    setAction(wasCheckedIn ? "Check-Out" : "Check-In");
    showScreen("scanner", "Site Attendance", "Scan site QR code");
    startIdleTimer();
    startCameraScanner();
}

function backToMenu() {
    try { if (html5QrCode) html5QrCode.stop().catch(() => {}); } catch (err) {}
    ["status-card", "retry-btn", "confirm-box", "nocheckin-box", "manual-form"].forEach((id) => {
        document.getElementById(id).classList.add("hidden");
    });
    pendingScan = null;
    openMenu();
}

// --- Action Toggle Logic ---
function setAction(action) {
    currentAction = action;
    document.getElementById("btn-in").classList.toggle("active", action === "Check-In");
    document.getElementById("btn-out").classList.toggle("active", action === "Check-Out");
    startIdleTimer();
}

// --- Camera & Scanner Logic ---
async function startCameraScanner() {
    handlingScan = false;

    if (html5QrCode) {
        try { await html5QrCode.clear(); } catch (err) {}
    }
    html5QrCode = new Html5Qrcode("qr-reader");

    html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (scannedSiteId) => {
            // The camera can report the same code several times before it stops: only act once
            if (handlingScan) return;
            handlingScan = true;
            html5QrCode.stop().catch(() => {});
            processScanAttempt(scannedSiteId);
        },
        () => {}
    ).catch(() => {
        showStatus("Camera permissions denied or unavailable.", "error");
        showRetry();
    });
}

function showRetry() {
    document.getElementById("retry-btn").classList.remove("hidden");
}

function retryScan() {
    startIdleTimer();
    document.getElementById("retry-btn").classList.add("hidden");
    document.getElementById("status-card").classList.add("hidden");
    startCameraScanner();
}

// --- Location Capture & Logging ---
function processScanAttempt(siteId) {
    showStatus("Requesting GPS location...", "info");

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                sendLog(siteId, position.coords.latitude, position.coords.longitude);
            },
            () => {
                sendLog(siteId, "Denied", "Denied");
            },
            { enableHighAccuracy: true, timeout: 8000 }
        );
    } else {
        sendLog(siteId, "Not Supported", "Not Supported");
    }
}

async function sendLog(siteId, lat, lng) {
    showStatus("Logging attendance...", "info");

    try {
        const result = await callBackend({
            type: "log",
            pin: enteredPin,
            siteId: siteId,
            action: currentAction,
            latitude: lat,
            longitude: lng
        });

        if (result.status === "SUCCESS") {
            // Success ends the session so the next person starts from the PIN screen
            clearTimeout(idleTimer);
            showStatus(`√ ${currentAction} logged for ${result.name}`, "success");
            setTimeout(() => { location.reload(); }, 3000);
        } else if (result.status === "ALREADY_CHECKED_IN") {
            // Ask before doing anything; nothing has been logged yet
            pendingScan = { siteId: siteId, lat: lat, lng: lng };
            startIdleTimer();
            showStatus("You're already checked in here. Did you mean to check out?", "info");
            document.getElementById("confirm-box").classList.remove("hidden");
        } else if (result.status === "NO_CHECK_IN") {
            // Ask before doing anything; nothing has been logged yet
            pendingScan = { siteId: siteId, lat: lat, lng: lng };
            startIdleTimer();
            showStatus("You're not checked in at this site. Did you mean to check in?", "info");
            document.getElementById("nocheckin-box").classList.remove("hidden");
        } else if (result.reason === "Invalid or Inactive PIN") {
            // PIN was switched off mid-session: retrying can't help
            showStatus(`${currentAction} failed: ${result.reason}.`, "error");
            setTimeout(() => { location.reload(); }, 4000);
        } else {
            // Stay logged in so they can try again
            showStatus(`${currentAction} failed: ${result.reason || "unknown error"}. This attempt has been recorded.`, "error");
            showRetry();
        }
    } catch (err) {
        showStatus("Submission failed. Network issue. Please try again.", "error");
        showRetry();
    }
}

function showStatus(message, type) {
    const card = document.getElementById("status-card");
    const text = document.getElementById("status-text");
    card.classList.remove("hidden", "info", "success", "error");
    card.classList.add(type);
    text.innerText = message;
}

// --- "Did you mean to check out?" ---
function confirmCheckout() {
    document.getElementById("confirm-box").classList.add("hidden");
    if (!pendingScan) return;
    setAction("Check-Out");
    sendLog(pendingScan.siteId, pendingScan.lat, pendingScan.lng);
}

function declineCheckout() {
    document.getElementById("confirm-box").classList.add("hidden");
    pendingScan = null;
    clearTimeout(idleTimer);
    showStatus("OK, nothing has been logged.", "info");
    setTimeout(() => { location.reload(); }, 3000);
}

// --- "Did you mean to check in?" ---
function confirmCheckIn() {
    document.getElementById("nocheckin-box").classList.add("hidden");
    if (!pendingScan) return;
    setAction("Check-In");
    sendLog(pendingScan.siteId, pendingScan.lat, pendingScan.lng);
}

function declineCheckIn() {
    document.getElementById("nocheckin-box").classList.add("hidden");
    pendingScan = null;
    clearTimeout(idleTimer);
    showStatus("OK, nothing has been logged.", "info");
    setTimeout(() => { location.reload(); }, 3000);
}

// --- "I forgot to check in": comment + optional manual arrival time ---
function showManualForm() {
    document.getElementById("nocheckin-box").classList.add("hidden");
    document.getElementById("status-card").classList.add("hidden");
    document.getElementById("manual-error").innerText = "";
    document.getElementById("manual-form").classList.remove("hidden");
    startIdleTimer();
}

function cancelManual() {
    document.getElementById("manual-form").classList.add("hidden");
    pendingScan = null;
    clearTimeout(idleTimer);
    showStatus("OK, nothing has been logged.", "info");
    setTimeout(() => { location.reload(); }, 3000);
}

async function submitManualCheckout() {
    if (busy || !pendingScan) return;

    const errorEl = document.getElementById("manual-error");
    const comment = document.getElementById("manual-comment").value.trim();

    if (!comment) {
        errorEl.innerText = "Please add your check-in time and the reason.";
        return;
    }

    busy = true;
    errorEl.innerText = "Submitting...";

    try {
        const result = await callBackend({
            type: "log",
            pin: enteredPin,
            siteId: pendingScan.siteId,
            action: "Check-Out",
            latitude: pendingScan.lat,
            longitude: pendingScan.lng,
            manual: true,
            comment: comment
        });

        if (result.status === "SUCCESS") {
            clearTimeout(idleTimer);
            document.getElementById("manual-form").classList.add("hidden");
            showStatus(`√ Check-Out logged for ${result.name} (no check-in recorded)`, "success");
            setTimeout(() => { location.reload(); }, 3000);
        } else if (result.reason === "Invalid or Inactive PIN") {
            document.getElementById("manual-form").classList.add("hidden");
            showStatus(`Check-Out failed: ${result.reason}.`, "error");
            setTimeout(() => { location.reload(); }, 4000);
        } else {
            errorEl.innerText = result.reason || "Something went wrong. Please try again.";
        }
    } catch (err) {
        errorEl.innerText = "Network issue. Please try again.";
    } finally {
        busy = false;
    }
}

// Typing a comment counts as activity, so the idle log-out doesn't interrupt it
document.getElementById("manual-comment").addEventListener("input", startIdleTimer);

// --- Quality Assurance inspection ---
// To change the checklist, edit this list (id must be unique, no spaces).
const QA_CHECKS = [
    { id: "frame", title: "Frame Installation Check", desc: "Verify frame plumb, level, and square." },
    { id: "seals", title: "Weather Seals & Gaskets", desc: "Inspect external and internal seals for integrity." },
    { id: "hardware", title: "Hardware Functionality", desc: "Confirm correct operation of all window/door hardware." }
];
const QA_IDLE_MS = 15 * 60 * 1000;   // longer idle limit while filling in a report
const QA_MAX_PHOTOS = 6;
let qaPhotos = [];
let qaResults = {};

const escHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const qaMsg = (t, ok) => {
    const el = document.getElementById("qa-msg");
    el.innerText = t;
    el.style.color = ok ? "#4ade80" : "";
};

function openQa() {
    document.getElementById("qa-project").innerHTML = '<option value="">Select project...</option>' +
        userSites.map((x) => `<option value="${escHtml(x.id)}">${escHtml(x.name)}</option>`).join("");
    document.getElementById("qa-inspector").value = userName;
    document.getElementById("qa-date").value = new Date().toLocaleDateString("en-GB");

    qaResults = {};
    qaPhotos = [];
    document.getElementById("qa-checks").innerHTML = QA_CHECKS.map((c) => `
        <div class="qa-check">
            <div class="qa-check-head">
                <div><strong>${escHtml(c.title)}</strong><small>${escHtml(c.desc)}</small></div>
                <div class="seg" data-id="${c.id}">
                    <button type="button" data-r="PASS">PASS</button><button type="button" data-r="FAIL">FAIL</button><button type="button" data-r="NA">N/A</button>
                </div>
            </div>
            <textarea id="qn-${c.id}" rows="2" maxlength="300" placeholder="Notes/Defects"></textarea>
        </div>`).join("");
    renderThumbs();
    qaMsg("");
    loadQaDraft();
    // If they're checked in, default the project to the site they're checked in at
    const proj = document.getElementById("qa-project");
    if (!proj.value && checkedInSiteId) proj.value = checkedInSiteId;
    showScreen("qa", "Quality Assurance", "Inspection report");
    startIdleTimer(QA_IDLE_MS);
}

function setQaResult(id, result) {
    qaResults[id] = result;
    document.querySelectorAll(`.seg[data-id="${id}"] button`).forEach((b) => b.classList.toggle("on", b.dataset.r === result));
}

function resizeImage(file) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const k = Math.min(1, 1280 / Math.max(img.width, img.height));
            const c = document.createElement("canvas");
            c.width = Math.round(img.width * k);
            c.height = Math.round(img.height * k);
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(img.src);
            resolve(c.toDataURL("image/jpeg", 0.7));
        };
        img.src = URL.createObjectURL(file);
    });
}

function renderThumbs() {
    document.getElementById("qa-thumbs").innerHTML = qaPhotos.map((p, i) =>
        `<div class="thumb"><img src="${p}" alt="Photo ${i + 1}"><button type="button" onclick="removePhoto(${i})">&times;</button></div>`).join("");
}

function removePhoto(i) { qaPhotos.splice(i, 1); renderThumbs(); }

function qaDraftKey() { return "qaDraft:" + userName; }

function saveQaDraft() {
    const draft = { project: document.getElementById("qa-project").value, results: qaResults, notes: {} };
    QA_CHECKS.forEach((c) => { draft.notes[c.id] = document.getElementById("qn-" + c.id).value; });
    try {
        localStorage.setItem(qaDraftKey(), JSON.stringify(draft));
        qaMsg("Draft saved on this device. Photos are not kept in drafts.", true);
    } catch (err) {
        qaMsg("Couldn't save the draft on this device.");
    }
}

function loadQaDraft() {
    try {
        const d = JSON.parse(localStorage.getItem(qaDraftKey()) || "null");
        if (!d) return;
        if (d.project) document.getElementById("qa-project").value = d.project;
        QA_CHECKS.forEach((c) => {
            if (d.results && d.results[c.id]) setQaResult(c.id, d.results[c.id]);
            document.getElementById("qn-" + c.id).value = (d.notes && d.notes[c.id]) || "";
        });
        qaMsg("Draft restored. Add your photos again.", true);
    } catch (err) {}
}

async function submitQa() {
    if (busy) return;
    const siteId = document.getElementById("qa-project").value;
    if (!siteId) return qaMsg("Please choose the project.");

    const checks = [];
    for (const c of QA_CHECKS) {
        const result = qaResults[c.id], notes = document.getElementById("qn-" + c.id).value.trim();
        if (!result) return qaMsg(`Please mark a result for "${c.title}".`);
        if (result === "FAIL" && !notes) return qaMsg(`Please add notes/defects for "${c.title}".`);
        checks.push({ item: c.title, result: result, notes: notes });
    }

    busy = true;
    qaMsg(qaPhotos.length ? "Uploading report and photos..." : "Submitting report...", true);
    try {
        const r = await callBackend({ type: "qa", pin: enteredPin, siteId: siteId, checks: checks, photos: qaPhotos });
        if (r.status === "SUCCESS") {
            try { localStorage.removeItem(qaDraftKey()); } catch (err) {}
            qaMsg("√ Inspection report submitted. Thank you.", true);
            setTimeout(userRole === "Contractor/QA" ? openMenu : () => location.reload(), 2500);
        } else {
            qaMsg(r.reason || "Something went wrong. Please try again.");
        }
    } catch (err) {
        qaMsg("Network issue. Your answers are still here, please try again.");
    } finally {
        busy = false;
    }
}

document.getElementById("qa-checks").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-r]");
    if (b) setQaResult(b.parentElement.dataset.id, b.dataset.r);
});

document.getElementById("qa-file").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files).slice(0, QA_MAX_PHOTOS - qaPhotos.length);
    for (const f of files) qaPhotos.push(await resizeImage(f));
    e.target.value = "";
    renderThumbs();
});

// Typing or tapping in the report counts as activity
["input", "click"].forEach((ev) =>
    document.getElementById("qa-screen").addEventListener(ev, () => startIdleTimer(QA_IDLE_MS)));

// --- Keyboard entry on the PIN screen (handy on desktop) ---
document.addEventListener("keydown", (e) => {
    if (document.getElementById("pin-screen").classList.contains("hidden")) return;
    if (/^\d$/.test(e.key)) pressKey(e.key);
    else if (e.key === "Backspace" && !busy) { enteredPin = enteredPin.slice(0, -1); updatePinDots(); }
    else if (e.key === "Enter") submitPin();
});

// --- Footer year ---
document.getElementById("footer-year").innerText = new Date().getFullYear();

showVersion();
