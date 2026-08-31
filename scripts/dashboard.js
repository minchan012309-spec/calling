const firebaseConfig = {
  apiKey: "AIzaSyDoWX2pA7BXPVmr6Zelnkq3OjZC96Z1uE4",
  authDomain: "calling-a708e.firebaseapp.com",
  databaseURL: "https://calling-a708e-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "calling-a708e",
  storageBucket: "calling-a708e.firebasestorage.app",
  messagingSenderId: "418677588330",
  appId: "1:418677588330:web:458f37a7a137795e22a513"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.NONE).catch(()=>{});
const ADMIN_EMAIL = "master-admin@teacher-calling-system.local";
const SHEET_LOG_URL = "";

const ROOM_LIST = ["1학년 교무실", "2학년 교무실", "3학년 교무실", "본교무실"];
const ROOM_STORAGE_KEY = 'sys_saved_room';
const urlParams = new URLSearchParams(window.location.search);
let ROOM = urlParams.get('room') || localStorage.getItem(ROOM_STORAGE_KEY) || localStorage.getItem('sys_saved_room_dashboard') || "";

function renderRoomButtons(container) {
    container.innerHTML = "";
    ROOM_LIST.forEach(r => {
        const b = document.createElement('button');
        b.className = 'room-choice-btn';
        b.style.marginBottom = '10px';
        b.innerText = (r === ROOM ? '✅ ' : '') + r;
        b.onclick = () => {
            localStorage.setItem(ROOM_STORAGE_KEY, r);
            localStorage.setItem('sys_saved_room_dashboard', r);
            const url = new URL(window.location.href);
            url.searchParams.set('room', r);
            window.location.href = url.toString();
        };
        container.appendChild(b);
    });
}

if (!ROOM_LIST.includes(ROOM)) {
    document.getElementById('roomGate').style.display = 'flex';
    renderRoomButtons(document.getElementById('roomChoiceList'));
    throw new Error("ROOM_NOT_SELECTED");
}
localStorage.setItem(ROOM_STORAGE_KEY, ROOM);
localStorage.setItem('sys_saved_room_dashboard', ROOM);
document.title = `호출 대시보드 - ${ROOM}`;
document.getElementById('startRoomTag').innerText = "📍 " + ROOM;
document.getElementById('headerRoomTag').innerText = "[" + ROOM + "]";
document.getElementById('settingsRoomTag').innerText = "· " + ROOM;

let lastTime = 0, historyList = [];
let koVoice = null, autoCloseTimer = null, toastTimer = null;
let currentCall = null;
let inputtedPin = "";
let adminSetupDone = true;
let pinStage = 'login';
let pinFirstEntry = '';
let roomSettings = { alertVolume: 100, ttsVolume: 100, ttsRate: 0.9, soundPreset: 'default' };
const PRESETS = [
    { key: 'default', label: '기본 벨 (경쾌한 2음)' },
    { key: 'soft', label: '차분한 알림 (부드러운 사인파)' },
    { key: 'urgent', label: '긴급 경보 (빠른 반복음)' },
    { key: 'short', label: '짧은 알림 (단타)' }
];

db.ref('shared/adminSetupDone').on('value', snap => { adminSetupDone = !!snap.val(); });

db.ref(`rooms/${ROOM}/systemStatus`).on('value', snap => {
    const status = snap.val() || { mode: 'normal', message: '' };
    handleSystemStatus(status);
});

db.ref(`rooms/${ROOM}/settings`).on('value', snap => {
    roomSettings = Object.assign({ alertVolume: 100, ttsVolume: 100, ttsRate: 0.9, soundPreset: 'default' }, snap.val() || {});
});

(function startHeartbeat() {
    const beat = () => db.ref(`rooms/${ROOM}/heartbeat/dashboard`).set(Date.now()).catch(()=>{});
    beat();
    setInterval(beat, 20000);
})();

(function initForceReload() {
    let baseReloadVal = null;
    db.ref(`rooms/${ROOM}/commands/dashboardReload`).on('value', snap => {
        const val = snap.val();
        if (val === null) return;
        if (baseReloadVal === null) { baseReloadVal = val; return; }
        if (val !== baseReloadVal) { location.reload(); }
    });
})();

function updateClock() { document.getElementById('clock').innerText = new Date().toLocaleTimeString(); }
setInterval(updateClock, 1000);
updateClock();

function getBestKoVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    koVoice = voices.find(v => v.lang.includes('ko') && v.name.includes('Google')) ||
              voices.find(v => v.lang.includes('ko') && v.name.includes('Natural')) ||
              voices.find(v => v.lang.includes('ko'));
}
if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = getBestKoVoice;
    getBestKoVoice();
}

function handleSystemStatus(status) {
    const card = document.getElementById('card');
    const empty = document.getElementById('empty');
    const stats = document.querySelector('.stats-bar');
    const historyListBox = document.getElementById('historyList');

    if (status.mode === 'closed' || status.mode === 'maintenance') {
        card.style.display = 'none';
        historyListBox.style.display = 'none';
        stats.style.display = 'none';

        empty.style.display = 'flex';
        empty.style.flexDirection = 'column';
        empty.style.gap = '20px';
        empty.style.position = 'fixed';
        empty.style.top = '0';
        empty.style.left = '0';
        empty.style.width = '100%';
        empty.style.height = '100%';
        empty.style.zIndex = '9999';
        empty.style.background = 'linear-gradient(135deg, #1e293b 0%, #334155 50%, #1e293b 100%)';
        empty.style.color = 'white';
        empty.style.margin = '0';
        empty.style.padding = '0';
        empty.style.fontSize = 'initial';

        empty.innerHTML = `
            <style>
                #empty::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: radial-gradient(circle at 30% 50%, rgba(59, 130, 246, 0.15) 0%, transparent 50%),
                                radial-gradient(circle at 70% 50%, rgba(14, 165, 233, 0.1) 0%, transparent 50%);
                    z-index: 0;
                }
                #empty > * { position: relative; z-index: 1; }
                .block-icon { font-size: 5.5rem; animation: float 3s ease-in-out infinite; }
                @keyframes float {
                    0%, 100% { transform: translateY(0px); }
                    50% { transform: translateY(-15px); }
                }
            </style>
            <div class="block-icon">${status.mode === 'closed' ? '🌙' : '🔧'}</div>
            <div style="font-size:2.4rem; color:white; font-weight:900; letter-spacing:-0.5px;">
                ${status.mode === 'closed' ? '운영 시간이 종료되었습니다' : '점검 중입니다'}
            </div>
            <div style="font-size:1.15rem; color:#e2e8f0; font-weight:500; line-height:1.8; max-width:600px;">
                ${status.message || (status.mode === 'closed' ? '오늘 운영이 종료되었습니다. 다음 운영 시간에 다시 이용해주세요.' : '정기 점검 중입니다. 잠시 후 다시 이용해주세요.')}
            </div>
        `;
    } else {
        empty.style.position = 'initial';
        empty.style.background = 'initial';
        empty.style.width = 'initial';
        empty.style.height = 'initial';
        empty.style.top = 'initial';
        empty.style.left = 'initial';
        empty.style.zIndex = 'initial';
        empty.style.margin = 'initial';
        empty.style.padding = 'initial';
        empty.innerHTML = '대기 중...';
        empty.style.flexDirection = 'row';
        empty.style.fontSize = '2rem';
        empty.style.color = '#cbd5e0';
        card.style.display = 'flex';
        historyListBox.style.display = 'block';
        stats.style.display = 'grid';
    }
}

async function initSystem() {
    document.getElementById('startLayer').style.display = 'none';
    getBestKoVoice();

    const initialSilent = new Audio('https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg');
    initialSilent.volume = 0;
    initialSilent.play().catch(()=>{});

    try {
        const snap = await db.ref(`rooms/${ROOM}/latestCall`).once('value');
        const d = snap.val();
        lastTime = (d && d.timestamp) ? Number(d.timestamp) : Date.now();
    } catch(e) { lastTime = Date.now(); }

    let isNotifying = false;

    db.ref(`rooms/${ROOM}/latestCall`).on('value', snap => {
        const d = snap.val();
        if (d && d.timestamp && Number(d.timestamp) > lastTime && !isNotifying) {
            isNotifying = true;
            lastTime = Number(d.timestamp);
            notify(d);
            refreshStats();
            setTimeout(() => { isNotifying = false; }, 4000);
        }
    });

    refreshStats();
    setInterval(refreshStats, 30000);
}

function parseToYYYYMMDD(str) {
    if(!str) return "";
    str = String(str).trim();
    if(/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
    let m = str.match(/(\d{4})[\.\-\/]\s*(\d{1,2})[\.\-\/]\s*(\d{1,2})/);
    if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    let d = new Date(str);
    if(!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return "";
}

async function refreshStats() {
    try {
        const snap = await db.ref(`rooms/${ROOM}/calls`).once('value');
        const val = snap.val() || {};
        const all = Object.values(val);
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const todayLogs = all.filter(l => parseToYYYYMMDD(l.time || l.timestamp) === todayStr);

        document.getElementById('statTodayCount').innerText = `${todayLogs.length}건`;

        const teacherMap = {};
        todayLogs.forEach(l => { if(l.teacher) teacherMap[l.teacher] = (teacherMap[l.teacher]||0)+1; });
        let topTeacher = "-", maxC = 0;
        for(let t in teacherMap) if(teacherMap[t] > maxC) { maxC = teacherMap[t]; topTeacher = t; }
        document.getElementById('statTopTeacher').innerText = topTeacher !== "-" ? `${topTeacher} 쌤 (${maxC}건)` : "-";

        const resolved = todayLogs.filter(l => l.resolvedAt && l.timestamp);
        if (resolved.length > 0) {
            const avgMs = resolved.reduce((sum, l) => sum + (l.resolvedAt - l.timestamp), 0) / resolved.length;
            const avgSec = Math.round(avgMs / 1000);
            document.getElementById('statAvgWait').innerText = avgSec < 60 ? `${avgSec}초` : `${Math.floor(avgSec/60)}분 ${avgSec%60}초`;
        } else {
            document.getElementById('statAvgWait').innerText = "-";
        }
    } catch(e) { console.log(e); }
}

function showToast(message) {
    clearTimeout(toastTimer);
    const toast = document.getElementById('toast');
    document.getElementById('toastMessage').innerText = message;
    toast.classList.add('show');
    toastTimer = setTimeout(() => { toast.classList.remove('show'); }, 2500);
}

function playPresetTone(preset, volScale) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        const now = ctx.currentTime;
        const tone = (freq, start, dur, type, peak) => {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.type = type; osc.frequency.setValueAtTime(freq, start);
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(peak * volScale, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(start); osc.stop(start + dur);
        };
        if (preset === 'soft') {
            tone(880, now, 0.5, 'sine', 0.8);
            tone(1100, now + 0.25, 0.6, 'sine', 0.8);
        } else if (preset === 'urgent') {
            for (let i = 0; i < 5; i++) tone(1500, now + i * 0.18, 0.15, 'square', 1.0);
        } else if (preset === 'short') {
            tone(1300, now, 0.25, 'square', 1.0);
        } else {
            tone(1200, now, 0.6, 'square', 1.2);
            tone(880, now + 0.22, 0.9, 'square', 1.2);
        }
    } catch (e) { console.log(e); }
}

function getEuroParticle(word) {
    if (!word) return '으로';
    const lastChar = word[word.length - 1];
    const code = lastChar.charCodeAt(0) - 0xAC00;
    if (code < 0 || code > 11171) return '으로';
    const jong = code % 28;
    if (jong === 0 || jong === 8) return '로';
    return '으로';
}

function notify(d) {
    if(!d || !d.name || !d.teacher) return;

    clearTimeout(autoCloseTimer);
    currentCall = d;

    document.getElementById('empty').style.display = 'none';
    const card = document.getElementById('card');

    document.getElementById('tName').innerText = d.teacher + " 선생님";
    document.getElementById('sInfo').innerText = d.id + " " + d.name;
    document.getElementById('sPurp').innerText = d.purpose;

    card.style.display = "flex";
    card.classList.remove('pop-in');
    void card.offsetWidth;
    card.classList.add('pop-in');

    const alertVol = Math.max(0, Math.min(1, (roomSettings.alertVolume ?? 100) / 100));
    playPresetTone(roomSettings.soundPreset || 'default', alertVol);

    setTimeout(() => {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const particle = getEuroParticle(d.purpose);
            const uttr = new SpeechSynthesisUtterance(`${d.teacher} 선생님, ${d.name} 학생이 ${d.purpose}${particle} 호출했습니다.`);
            if(koVoice) uttr.voice = koVoice;
            uttr.lang = 'ko-KR';
            uttr.rate = roomSettings.ttsRate ?? 0.9;
            uttr.volume = Math.max(0, Math.min(1, (roomSettings.ttsVolume ?? 100) / 100));
            window.speechSynthesis.speak(uttr);
        }
    }, 650);

    historyList.unshift(d);
    if(historyList.length > 3) historyList.pop();
    document.getElementById('historyList').innerHTML = historyList.map(h => `<div class="history-item"><span>${h.id} ${h.name}</span><span>${h.purpose}</span></div>`).join('');

    autoCloseTimer = setTimeout(() => {
        closeCard();
        resolveCall(d, "출력 완료");
    }, 30000);
}

document.getElementById('absentBtn').addEventListener('click', () => {
    if (!currentCall) { alert('현재 대기중인 호출이 없습니다.'); return; }
    clearTimeout(autoCloseTimer);
    const d = currentCall;
    sendAbsentSignal(d);
    resolveCall(d, "부재중 처리");
    showToast(`${d.teacher} 선생님 부재중 신호를 전송했습니다.`);
    closeCard();
});

function closeCard() {
    const card = document.getElementById('card');
    card.style.display = "none";
    document.getElementById('empty').style.display = 'flex';
}

function resolveCall(d, statusText) {
    if (d.key) {
        db.ref(`rooms/${ROOM}/calls/${d.key}`).update({ status: statusText, resolvedAt: Date.now() }).catch(err => console.log(err));
    }
    postToSheet({ action: 'update', room: ROOM, key: d.key, status: statusText });
    refreshStats();
}

function sendAbsentSignal(d) {
    db.ref(`rooms/${ROOM}/absentSignal`).set({ teacher: d.teacher, timestamp: Date.now() }).catch(err => console.log(err));
}

function postToSheet(payload) {
    if (!SHEET_LOG_URL) return;
    fetch(SHEET_LOG_URL, {
        method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    }).catch(err => console.log("시트 연동 오류:", err));
}

function openAdmin() {
    clearPin();
    pinStage = adminSetupDone ? 'login' : 'setup_new';
    pinFirstEntry = '';
    updatePinPadUI();
    document.getElementById('adminModal').style.display = 'flex';
}
function closeAdminPin() { document.getElementById('adminModal').style.display = 'none'; clearPin(); }
function updatePinPadUI() {
    const title = document.getElementById('pinTitleText');
    const subtitle = document.getElementById('pinSubtitle');
    if (pinStage === 'setup_new') {
        title.innerText = '관리자 비밀번호 최초 설정';
        subtitle.innerText = '모든 교무실이 함께 사용할 비밀번호예요. 숫자 6자리를 입력하세요.';
    } else if (pinStage === 'setup_confirm') {
        title.innerText = '비밀번호 확인';
        subtitle.innerText = '방금 입력한 6자리를 다시 입력해주세요.';
    } else {
        title.innerText = '관리자 인증';
        subtitle.innerText = '비밀번호 6자리를 입력하세요.';
    }
}
function pressPin(num) {
    if(inputtedPin.length >= 6) return;
    inputtedPin += num;
    document.getElementById('pinStars').innerText = '• '.repeat(inputtedPin.length);
    if(inputtedPin.length === 6) setTimeout(() => handlePinComplete(), 150);
}
function clearPin() { inputtedPin = ""; document.getElementById('pinStars').innerText = ""; }

function setupPasswordKeyboardSupport() {
    document.addEventListener('keydown', (e) => {
        if (document.getElementById('adminModal').style.display !== 'flex') return;
        if (/^[0-9]$/.test(e.key)) {
            e.preventDefault(); pressPin(e.key);
        } else if (e.key === 'Backspace') {
            e.preventDefault(); clearPin();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (inputtedPin.length === 6) handlePinComplete();
        }
    });
}
setupPasswordKeyboardSupport();

async function handlePinComplete() {
    const pin = inputtedPin;
    try {
        await auth.signInWithEmailAndPassword(ADMIN_EMAIL, pin);
        localStorage.setItem('sys_admin_fail_count', '0');
        localStorage.setItem('sys_admin_block_until', '0');
        enterSettingsPanel();
    } catch (err) {
        if (err.code === 'auth/user-not-found') {
            alert('아직 비밀번호가 설정되지 않았어요. 최초 설정 화면으로 이동할게요.');
            pinStage = 'setup_new';
            updatePinPadUI();
            clearPin();
            return;
        }
        let failCount = parseInt(localStorage.getItem('sys_admin_fail_count') || '0') + 1;
        localStorage.setItem('sys_admin_fail_count', failCount);
        if (failCount >= 5) {
            alert('관리자 인증 실패 제한에 도달했습니다. 잠시 후 다시 시도해주세요.');
            clearPin();
            closeAdminPin();
        } else {
            alert(`비밀번호가 올바르지 않습니다. (인증 오류 횟수: ${failCount} / 5)`);
            clearPin();
        }
    }
}

function enterSettingsPanel() {
    document.getElementById('adminModal').style.display = 'none';
    document.getElementById('settingsPanel').style.display = 'flex';
    renderPresetRow();
}
function closeSettingsPanel() { document.getElementById('settingsPanel').style.display = 'none'; }

let selectedPreset = 'default';
function renderPresetRow() {
    const row = document.getElementById('presetRow');
    row.innerHTML = PRESETS.map(p => `
        <div class="preset-choice ${selectedPreset === p.key ? 'selected' : ''}" onclick="selectedPreset='${p.key}'; roomSettings.soundPreset='${p.key}'; renderPresetRow();">
            ${p.label}
        </div>
    `).join('');
}

document.getElementById('alertVolSlider').addEventListener('input', function() {
    document.getElementById('alertVolLabel').innerText = this.value + '%';
});
document.getElementById('ttsVolSlider').addEventListener('input', function() {
    document.getElementById('ttsVolLabel').innerText = this.value + '%';
});

function updateTTSVolume(value) {
    roomSettings.ttsVolume = Number(value);
    document.getElementById('ttsVolLabel').innerText = value + '%';
}
function updateTTSRate(value) {
    roomSettings.ttsRate = Number(value);
    document.getElementById('ttsRateLabel').innerText = value + 'x';
}

function saveSoundSettings() {
    db.ref(`rooms/${ROOM}/settings`).update({
        alertVolume: Number(document.getElementById('alertVolSlider').value),
        ttsVolume: Number(document.getElementById('ttsVolSlider').value),
        ttsRate: Number(document.getElementById('ttsRateSlider').value),
        soundPreset: selectedPreset
    }).catch(()=>{});
    closeSettingsPanel();
}

async function executeChangePassword() {
    const cur = document.getElementById('currentAdminPw').value;
    const nPw = document.getElementById('newAdminPw').value;
    const cPw = document.getElementById('confirmAdminPw').value;

    if(cur.length !== 6 || isNaN(cur)) { alert('현재 비밀번호 6자리를 정확히 입력하세요.'); return; }
    if(nPw.length !== 6 || isNaN(nPw)) { alert('새 비밀번호는 숫자 6자리여야 합니다.'); return; }
    if(nPw !== cPw) { alert('새 비밀번호 확인 재입력 값이 맞지 않습니다.'); return; }

    try {
        await auth.signInWithEmailAndPassword(ADMIN_EMAIL, cur);
        await auth.currentUser.updatePassword(nPw);
        alert('비밀번호가 변경되었습니다.');
        document.getElementById('currentAdminPw').value = '';
        document.getElementById('newAdminPw').value = '';
        document.getElementById('confirmAdminPw').value = '';
        closeSettingsPanel();
    } catch (err) {
        alert('비밀번호 변경 실패: ' + err.message);
    }
}

renderPresetRow();
initSystem();
