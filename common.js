// 세 화면(index / dashboard / master)이 함께 쓰는 공통 코드
// 필요한 SDK: firebase-app-compat, firebase-database-compat, firebase-auth-compat (먼저 로드할 것)

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
auth.setPersistence(firebase.auth.Auth.Persistence.NONE).catch(() => {});

// 모든 교무실이 공유하는 단일 관리자 계정 (실제 비밀번호는 구글 인증 서버에만 저장됨)
const ADMIN_EMAIL = "master-admin@teacher-calling-system.local";
const ROOM_LIST = ["1학년 교무실", "2학년 교무실", "3학년 교무실", "본교무실"];
const ROOM_STORAGE_KEY = 'sys_saved_room';

// ===================== 문자열 / 날짜 =====================
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pad2(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function formatDateTime(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
// 로그의 time 문자열(여러 형식) 또는 timestamp를 YYYY-MM-DD로 변환
function parseToYYYYMMDD(v) {
    if (!v) return "";
    const str = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
    const m = str.match(/(\d{4})[.\-\/]\s*(\d{1,2})[.\-\/]\s*(\d{1,2})/);
    if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    const d = new Date(/^\d+$/.test(str) ? Number(str) : str);
    return isNaN(d.getTime()) ? "" : ymd(d);
}
function getStudentName(v) { return (v && typeof v === 'object') ? (v.name || '') : (v || ''); }

// ===================== 교무실 선택 =====================
function renderRoomButtons(container, currentRoom) {
    container.innerHTML = "";
    ROOM_LIST.forEach(r => {
        const b = document.createElement('button');
        b.className = 'room-choice-btn';
        b.innerText = (r === currentRoom ? '✅ ' : '') + r;
        b.onclick = () => {
            localStorage.setItem(ROOM_STORAGE_KEY, r);
            const url = new URL(window.location.href);
            url.searchParams.set('room', r);
            window.location.href = url.toString();
        };
        container.appendChild(b);
    });
}
// 선택된 교무실을 돌려준다. 아직 없으면 선택 화면(#roomGate)을 띄우고 '' 반환
function resolveRoom() {
    const fromUrl = new URLSearchParams(window.location.search).get('room');
    const room = fromUrl || localStorage.getItem(ROOM_STORAGE_KEY) || "";
    if (!ROOM_LIST.includes(room)) {
        document.getElementById('roomGate').style.display = 'flex';
        renderRoomButtons(document.getElementById('roomChoiceList'), '');
        return '';
    }
    localStorage.setItem(ROOM_STORAGE_KEY, room);
    return room;
}

// ===================== 운영 상태 (수동 + 자동 운영시간대) =====================
// systemStatus: { mode: 'normal'|'maintenance'|'closed', message, overrideWindow }
// autoShutdownSchedule: { enabled, startHour, startMin, endHour, endMin }  (시작~종료 사이 = 운영 종료 시간대, 자정을 넘겨도 됨)
// 마스터 화면이 꺼져 있어도 각 태블릿이 직접 계산하므로 항상 적용된다.
function getScheduleWindow(sch, now = new Date()) {
    if (!sch || !sch.enabled) return { inWindow: false };
    const s = (sch.startHour ?? 0) * 60 + (sch.startMin ?? 0);
    const e = (sch.endHour ?? 0) * 60 + (sch.endMin ?? 0);
    if (s === e) return { inWindow: false };
    const n = now.getHours() * 60 + now.getMinutes();
    let inWindow, startDay = now;
    if (s < e) {
        inWindow = n >= s && n < e;
    } else {
        inWindow = n >= s || n < e;
        if (n < e) startDay = new Date(now.getTime() - 86400000);
    }
    return { inWindow, windowKey: ymd(startDay), resumeText: `${pad2(sch.endHour ?? 0)}:${pad2(sch.endMin ?? 0)}` };
}
function effectiveStatus(status, sch, now = new Date()) {
    const st = Object.assign({ mode: 'normal', message: '' }, status || {});
    if (st.mode !== 'normal') return { mode: st.mode, message: st.message || '', auto: false };
    const w = getScheduleWindow(sch, now);
    if (w.inWindow && st.overrideWindow !== w.windowKey) {
        const tail = `${w.resumeText}부터 다시 이용할 수 있습니다.`;
        return { mode: 'closed', message: st.message ? `${st.message}\n${tail}` : tail, auto: true };
    }
    return { mode: 'normal', message: '', auto: false };
}
function watchEffectiveStatus(room, onChange) {
    let status = null, sch = null;
    const apply = () => onChange(effectiveStatus(status, sch));
    db.ref(`rooms/${room}/systemStatus`).on('value', s => { status = s.val(); apply(); });
    db.ref(`rooms/${room}/autoShutdownSchedule`).on('value', s => { sch = s.val(); apply(); });
    setInterval(apply, 20000);
}
function showBlockOverlay(st) {
    const overlay = document.getElementById('systemBlockOverlay');
    if (st.mode === 'normal') { overlay.style.display = 'none'; return; }
    const closed = st.mode === 'closed';
    document.getElementById('blockIcon').innerText = closed ? '🌙' : '🔧';
    document.getElementById('blockTitle').innerText = closed ? '운영 시간이 종료되었습니다' : '점검 중입니다';
    document.getElementById('blockMessage').innerText = st.message ||
        (closed ? '오늘 운영이 종료되었습니다. 다음 운영 시간에 다시 이용해주세요.' : '정기 점검 중입니다. 잠시 후 다시 이용해주세요.');
    overlay.style.display = 'flex';
}

// ===================== 소리 설정 (rooms/{room}/settings) =====================
const DEFAULT_SETTINGS = { alertVolume: 60, ttsVolume: 100, ttsRate: 0.9, ttsPitch: 1, soundPreset: 'default', ttsVoice: '' };
function watchRoomSettings(room, onChange) {
    db.ref(`rooms/${room}/settings`).on('value', snap => onChange(Object.assign({}, DEFAULT_SETTINGS, snap.val() || {})));
}

// 알림음: [주파수, 시작(초), 길이(초), 파형, 세기]
const ALERT_PRESETS = {
    default: { label: '기본 벨', desc: '경쾌한 2음', notes: [[1200, 0, 0.6, 'square', 1], [880, 0.22, 0.9, 'square', 1]] },
    chime:   { label: '띵동 차임', desc: '현관 벨 느낌', notes: [[1319, 0, 0.8, 'sine', 1], [1047, 0.45, 1.2, 'sine', 1]] },
    soft:    { label: '부드러운 알림', desc: '조용한 사무실용', notes: [[880, 0, 0.5, 'sine', 0.9], [1100, 0.25, 0.7, 'sine', 0.9]] },
    melody:  { label: '멜로디', desc: '도 · 미 · 솔', notes: [[523, 0, 0.35, 'triangle', 1], [659, 0.28, 0.35, 'triangle', 1], [784, 0.56, 0.7, 'triangle', 1]] },
    bell:    { label: '종소리', desc: '여운이 긴 종', notes: [[880, 0, 1.8, 'sine', 1], [1320, 0, 1.3, 'sine', 0.45], [2200, 0, 0.8, 'sine', 0.25]] },
    digital: { label: '디지털 삑삑', desc: '또렷한 4연속음', notes: [0, 1, 2, 3].map(i => [1000, i * 0.2, 0.12, 'square', 1]) },
    short:   { label: '짧은 알림', desc: '한 번만 삑', notes: [[1300, 0, 0.25, 'square', 1]] },
    urgent:  { label: '긴급 경보', desc: '빠른 반복음', notes: [0, 1, 2, 3, 4].map(i => [1500, i * 0.18, 0.15, 'square', 1]) }
};
// 사각파는 사인파보다 훨씬 크게 들리므로, 음성(TTS)과 균형이 맞도록 전체 이득을 낮춰 둔다.
const ALERT_GAIN = 0.3;

let audioCtx = null;
function getAudioCtx() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    } catch (e) { return null; }
}
// volumePercent: 0~100. 재생 시간(초)을 돌려준다.
function playAlertTone(presetKey, volumePercent) {
    const ctx = getAudioCtx();
    const preset = ALERT_PRESETS[presetKey] || ALERT_PRESETS.default;
    if (!ctx) return 0;
    const master = ctx.createGain();
    master.gain.value = Math.max(0, Math.min(1, volumePercent / 100)) * ALERT_GAIN;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    let end = 0;
    preset.notes.forEach(([freq, start, dur, type, peak]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0 + start);
        gain.gain.setValueAtTime(0.0001, t0 + start);
        gain.gain.linearRampToValueAtTime(peak, t0 + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
        osc.connect(gain);
        gain.connect(master);
        osc.start(t0 + start);
        osc.stop(t0 + start + dur + 0.05);
        end = Math.max(end, start + dur);
    });
    return end;
}

// ===================== 음성 안내 (TTS) =====================
const ttsSupported = 'speechSynthesis' in window;
function getKoVoices() {
    return ttsSupported ? window.speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith('ko')) : [];
}
function pickVoice(name) {
    const ko = getKoVoices();
    return ko.find(v => v.name === name) ||
           ko.find(v => v.name.includes('Google')) ||
           ko.find(v => v.name.includes('Natural')) ||
           ko[0] || null;
}
function speak(text, s, onend) {
    if (!ttsSupported) { if (onend) onend(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(s.ttsVoice);
    if (voice) u.voice = voice;
    u.lang = 'ko-KR';
    u.rate = s.ttsRate;
    u.pitch = s.ttsPitch;
    u.volume = Math.max(0, Math.min(1, s.ttsVolume / 100));
    if (onend) { u.onend = onend; u.onerror = onend; }
    window.speechSynthesis.speak(u);
}
if (ttsSupported) window.speechSynthesis.getVoices(); // 일부 브라우저는 첫 호출 때 목록을 비동기로 채움

// ===================== 태블릿(키오스크) 모드 =====================
// 핀치 줌 차단
function enableKioskMode() {
    document.body.classList.add('kiosk');
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
    document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerup', getAudioCtx); // 첫 터치에 오디오 잠금 해제
}

// ===================== 관리자 PIN 인증 (index / dashboard 공통) =====================
// HTML에는 #pinTitleText, #pinSubtitle, #pinStars 가 있어야 한다.
let adminSetupDone = true;
db.ref('shared/adminSetupDone').on('value', snap => { adminSetupDone = !!snap.val(); });

function createPinAuth({ storagePrefix, onSuccess, onClose, onLocked }) {
    const failKey = storagePrefix + '_fail_count';
    const blockKey = storagePrefix + '_block_until';
    let pin = '', stage = 'login', firstEntry = '';

    const isLocked = () => Date.now() < parseInt(localStorage.getItem(blockKey) || '0');
    const stars = () => document.getElementById('pinStars');
    function renderStars() { stars().innerText = '• '.repeat(pin.length); }
    function clear() { pin = ''; renderStars(); }
    function updateUI() {
        const t = document.getElementById('pinTitleText'), s = document.getElementById('pinSubtitle');
        if (stage === 'setup_new') { t.innerText = '관리자 비밀번호 최초 설정'; s.innerText = '모든 교무실이 함께 사용할 비밀번호예요. 숫자 6자리를 입력하세요.'; }
        else if (stage === 'setup_confirm') { t.innerText = '비밀번호 확인'; s.innerText = '방금 입력한 6자리를 다시 입력해주세요.'; }
        else { t.innerText = '관리자 인증'; s.innerText = '비밀번호 6자리를 입력하세요.'; }
    }
    function setStage(next) { stage = next; firstEntry = ''; updateUI(); clear(); }

    async function complete() {
        const entered = pin;
        if (stage === 'setup_new') { firstEntry = entered; stage = 'setup_confirm'; updateUI(); clear(); return; }
        if (stage === 'setup_confirm') {
            if (entered !== firstEntry) { alert('입력하신 두 비밀번호가 서로 다릅니다. 처음부터 다시 설정해주세요.'); setStage('setup_new'); return; }
            try {
                await auth.createUserWithEmailAndPassword(ADMIN_EMAIL, entered);
                await db.ref('shared/adminSetupDone').set(true);
                onSuccess();
            } catch (err) {
                if (err.code === 'auth/email-already-in-use') { alert('이미 다른 기기에서 비밀번호가 설정되어 있습니다. 로그인 화면으로 전환할게요.'); setStage('login'); }
                else if (err.code === 'auth/operation-not-allowed') { alert('관리자 인증 기능이 꺼져 있어요. 파이어베이스 콘솔 → Authentication → Sign-in method 에서 "이메일/비밀번호"를 켜주세요.'); onClose(); }
                else { alert('설정 중 오류가 발생했습니다: ' + err.message); clear(); }
            }
            return;
        }
        try {
            await auth.signInWithEmailAndPassword(ADMIN_EMAIL, entered);
            localStorage.setItem(failKey, '0');
            localStorage.setItem(blockKey, '0');
            onSuccess();
        } catch (err) {
            if (err.code === 'auth/user-not-found') { alert('아직 비밀번호가 설정되지 않았어요. 최초 설정 화면으로 이동할게요.'); setStage('setup_new'); return; }
            if (err.code === 'auth/operation-not-allowed') { alert('관리자 인증 기능이 꺼져 있어요. 파이어베이스 콘솔에서 "이메일/비밀번호" 로그인을 켜주세요.'); onClose(); return; }
            const failCount = parseInt(localStorage.getItem(failKey) || '0') + 1;
            localStorage.setItem(failKey, failCount);
            if (failCount >= 5) {
                localStorage.setItem(blockKey, Date.now() + 5 * 60 * 1000);
                onClose();
                if (onLocked) onLocked();
            } else {
                alert(`비밀번호가 올바르지 않습니다. (인증 오류 횟수: ${failCount} / 5)`);
                clear();
            }
        }
    }
    return {
        isLocked,
        open() {
            if (isLocked()) { if (onLocked) onLocked(); return false; }
            setStage(adminSetupDone ? 'login' : 'setup_new');
            return true;
        },
        press(num) {
            if (isLocked()) { clear(); return; }
            if (pin.length >= 6) return;
            pin += num;
            renderStars();
            if (pin.length === 6) setTimeout(complete, 150);
        },
        clear
    };
}

// 비밀번호 변경 (index / dashboard / master 공통). 성공하면 true
async function changeAdminPassword(cur, next, confirmNext) {
    if (cur.length !== 6 || isNaN(cur)) { alert('현재 비밀번호 6자리를 정확히 입력하세요.'); return false; }
    if (next.length !== 6 || isNaN(next)) { alert('새 비밀번호는 숫자 6자리여야 합니다.'); return false; }
    if (next !== confirmNext) { alert('새 비밀번호 확인이 일치하지 않습니다.'); return false; }
    try {
        await auth.signInWithEmailAndPassword(ADMIN_EMAIL, cur);
        await auth.currentUser.updatePassword(next);
        alert('비밀번호가 변경되었습니다. (모든 교무실 공통 적용)');
        return true;
    } catch (err) {
        if (['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(err.code)) alert('현재 비밀번호가 일치하지 않습니다.');
        else alert('오류가 발생했습니다: ' + err.message);
        return false;
    }
}

// 호출 로그 한 건이 오늘 것인지 등 통계에 쓰는 공통 계산
function summarizeCalls(calls) {
    const today = ymd(new Date());
    const todayCalls = calls.filter(c => parseToYYYYMMDD(c.time || c.timestamp) === today);
    const count = (key) => {
        const map = {};
        todayCalls.forEach(c => { if (c[key]) map[c[key]] = (map[c[key]] || 0) + 1; });
        let top = '', max = 0;
        for (const k in map) if (map[k] > max) { max = map[k]; top = k; }
        return { top, max };
    };
    return { todayCalls, topTeacher: count('teacher'), topPurpose: count('purpose') };
}

// 서비스 워커 등록 (홈 화면에 앱으로 설치할 수 있게 함. https 또는 localhost에서만 동작)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
