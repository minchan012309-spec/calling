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

const ROOM_LIST = ["1학년 교무실", "2학년 교무실", "3학년 교무실", "본교무실"];
const ROOM_STORAGE_KEY = 'sys_saved_room';
const urlParams = new URLSearchParams(window.location.search);
let ROOM = urlParams.get('room') || localStorage.getItem(ROOM_STORAGE_KEY) || localStorage.getItem('sys_saved_room_dashboard') || "";

if (!ROOM_LIST.includes(ROOM)) {
    document.getElementById('roomGate').style.display = 'flex';
    const list = document.getElementById('roomChoiceList');
    ROOM_LIST.forEach(r => {
        const b = document.createElement('button');
        b.className = 'room-choice-btn';
        b.innerText = r;
        b.onclick = () => {
            localStorage.setItem(ROOM_STORAGE_KEY, r);
            localStorage.setItem('sys_saved_room_dashboard', r);
            const url = new URL(window.location.href);
            url.searchParams.set('room', r);
            window.location.href = url.toString();
        };
        list.appendChild(b);
    });
    throw new Error("ROOM_NOT_SELECTED");
}
localStorage.setItem(ROOM_STORAGE_KEY, ROOM);
localStorage.setItem('sys_saved_room_dashboard', ROOM);
document.getElementById('roomBadge').innerText = "📍 " + ROOM;
document.getElementById('adminRoomTag').innerText = "· " + ROOM;

let data = { t:'', b:'', n:'', g:'', name:'', p:'', customP:'' };
let isSubmitted = false;
let autoFallbackTimer = null;
let lockoutInterval = null;
let koVoice = null;
let inputtedPin = "";
let isAbsentTriggered = false;
let lastHandledAbsentTs = Date.now();

const PENDING_ABSENT_KEY = 'sys_pending_absent_' + ROOM;
const PENDING_ABSENT_WINDOW_MS = 40000;
let pendingAbsentTeacher = null;
let pendingAbsentTs = 0;
(function loadPendingAbsentCheck() {
    try {
        const raw = localStorage.getItem(PENDING_ABSENT_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved && saved.teacher && (Date.now() - saved.ts) < PENDING_ABSENT_WINDOW_MS) {
            pendingAbsentTeacher = saved.teacher;
            pendingAbsentTs = saved.ts;
        } else {
            localStorage.removeItem(PENDING_ABSENT_KEY);
        }
    } catch(e) { localStorage.removeItem(PENDING_ABSENT_KEY); }
})();
function clearPendingAbsentCheck() {
    pendingAbsentTeacher = null;
    pendingAbsentTs = 0;
    localStorage.removeItem(PENDING_ABSENT_KEY);
}

let blacklistStorage = [];
let studentRegistry = {};
let cooldownMap = {};
let seatLayout = { rows: 2, cols: 3, seats: {} };
let seatMoveSourceKey = null;
let seatEditTargetKey = null;
let roomSettings = { alertVolume: 100, ttsVolume: 100 };
let adminSetupDone = true;
let pinStage = 'login';
let pinFirstEntry = '';

function seedDefaultSeatLayout() {
    const defaults = {
        "1학년 교무실": {
            rows: 3, cols: 4,
            seats: {
                '0_0': { name: '김민수', subtitle: '1-1 담임 · 영어' },
                '0_1': { name: '박지은', subtitle: '1-2 담임 · 수학' },
                '0_2': { name: '최준호', subtitle: '1-3 담임 · 국어' },
                '0_3': { name: '윤서영', subtitle: '1-4 담임 · 과학' },
                '1_0': { name: '정현우', subtitle: '1-5 담임 · 물리' },
                '1_1': { name: '오다희', subtitle: '1-6 담임 · 사회' },
                '1_2': { name: '한성민', subtitle: '1-7 담임 · 정보' },
                '1_3': { name: '송하린', subtitle: '1-8 담임 · 체육' },
                '2_0': { name: '강태민', subtitle: '1-9 담임 · 역사' },
                '2_1': { name: '신예진', subtitle: '1-10 담임 · 미술' },
                '2_2': { name: '이도윤', subtitle: '1-11 담임 · 음악' },
                '2_3': { name: '배수아', subtitle: '1-12 담임 · 도덕' }
            }
        },
        "2학년 교무실": {
            rows: 3, cols: 4,
            seats: {
                '0_0': { name: '방지수', subtitle: '2-6 담임 · 국어' },
                '0_1': { name: '윤희연', subtitle: '2-5 담임 · 수학' },
                '0_3': { name: '김선미', subtitle: '2학년부장 · 화학' },
                '1_0': { name: '진경훈', subtitle: '2-4 담임 · 영어' },
                '1_1': { name: '김현민', subtitle: '2-7 담임 · 역사' },
                '1_2': { name: '유진선', subtitle: '2-8 담임 · 일반사회' },
                '1_3': { name: '최대한', subtitle: '2-2 담임 · 물리' },
                '2_0': { name: '안예슬', subtitle: '2-3 담임 · 지구과학' },
                '2_1': { name: '신주원', subtitle: '2-10 담임 · 도덕윤리' },
                '2_2': { name: '이희진', subtitle: '2-9 담임 · 지리' },
                '2_3': { name: '김지안', subtitle: '2-1 담임 · 국어' }
            }
        },
        "3학년 교무실": {
            rows: 3, cols: 4,
            seats: {
                '0_0': { name: '홍민재', subtitle: '3-1 담임 · 수학' },
                '0_1': { name: '서정아', subtitle: '3-2 담임 · 영어' },
                '0_2': { name: '권태훈', subtitle: '3-3 담임 · 물리' },
                '0_3': { name: '노유진', subtitle: '3-4 담임 · 화학' },
                '1_0': { name: '문성호', subtitle: '3-5 담임 · 지구과학' },
                '1_1': { name: '유진아', subtitle: '3-6 담임 · 기술가정' },
                '1_2': { name: '전승민', subtitle: '3-7 담임 · 사회' },
                '1_3': { name: '이소라', subtitle: '3-8 담임 · 국어' },
                '2_0': { name: '정대경', subtitle: '3-9 담임 · 체육' },
                '2_1': { name: '고미래', subtitle: '3-10 담임 · 미술' },
                '2_2': { name: '황은수', subtitle: '3-11 담임 · 음악' },
                '2_3': { name: '남기훈', subtitle: '3-12 담임 · 진로' }
            }
        },
        "본교무실": {
            rows: 2, cols: 3,
            seats: {
                '0_0': { name: '교감선생님', subtitle: '학생생활' },
                '0_1': { name: '교무위원', subtitle: '교육연구' },
                '0_2': { name: '기획부장', subtitle: '행정' },
                '1_0': { name: '학년부장', subtitle: '학사' },
                '1_1': { name: '진로부장', subtitle: '진로' },
                '1_2': { name: '상담교사', subtitle: '상담' }
            }
        }
    };
    return defaults[ROOM] || { rows: 2, cols: 3, seats: {} };
}

function getAllSeatNames() {
    return Object.values(seatLayout.seats || {}).map(s => s.name).filter(Boolean);
}

function startHeartbeat() {
    const beat = () => db.ref(`rooms/${ROOM}/heartbeat/index`).set(Date.now()).catch(()=>{});
    beat();
    setInterval(beat, 20000);
}

(function initForceReload() {
    let baseReloadVal = null;
    db.ref(`rooms/${ROOM}/commands/indexReload`).on('value', snap => {
        const val = snap.val();
        if (val === null) return;
        if (baseReloadVal === null) { baseReloadVal = val; return; }
        if (val !== baseReloadVal) { location.reload(); }
    });
})();

function initRealtimeSync() {
    db.ref('shared/adminSetupDone').on('value', snap => { adminSetupDone = !!snap.val(); });

    db.ref(`rooms/${ROOM}/systemStatus`).on('value', snap => {
        const v = snap.val() || { mode: 'normal', message: '' };
        const overlay = document.getElementById('systemBlockOverlay');
        if (v.mode === 'maintenance') {
            document.getElementById('blockIcon').innerText = '🔧';
            document.getElementById('blockTitle').innerText = '점검 중입니다';
            document.getElementById('blockMessage').innerText = v.message || '정기 점검 중입니다. 잠시 후 다시 이용해주세요.';
            overlay.style.display = 'flex';
        } else if (v.mode === 'closed') {
            document.getElementById('blockIcon').innerText = '🌙';
            document.getElementById('blockTitle').innerText = '운영 시간이 종료되었습니다';
            document.getElementById('blockMessage').innerText = v.message || '오늘 운영이 종료되었습니다. 다음 운영 시간에 다시 이용해주세요.';
            overlay.style.display = 'flex';
        } else {
            overlay.style.display = 'none';
        }
    });
    db.ref('shared/blacklist').on('value', snap => {
        blacklistStorage = snap.val() || [];
        renderAdminBlacklist();
    });
    db.ref('shared/students').on('value', snap => {
        studentRegistry = snap.val() || {};
        renderStudentRegistryGridList();
    });
    db.ref('shared/cooldown').on('value', snap => {
        cooldownMap = snap.val() || {};
    });
    db.ref(`rooms/${ROOM}/seatLayout`).on('value', snap => {
        const v = snap.val();
        if (v && v.rows && v.cols) {
            seatLayout = v;
            if (!seatLayout.seats) seatLayout.seats = {};
        } else {
            seatLayout = seedDefaultSeatLayout();
            db.ref(`rooms/${ROOM}/seatLayout`).set(seatLayout).catch(()=>{});
        }
        buildTeacherFrontGrid();
        renderSeatEditor();
    });
    db.ref(`rooms/${ROOM}/notice`).on('value', snap => {
        const v = snap.val() || { text: '', size: '0.95rem', color: '#c2410c' };
        updateMainNoticeDisplay(v);
    });
    db.ref(`rooms/${ROOM}/settings`).on('value', snap => {
        roomSettings = Object.assign({ alertVolume: 100, ttsVolume: 100 }, snap.val() || {});
    });
    db.ref(`rooms/${ROOM}/absentSignal`).on('value', snap => {
        const v = snap.val();
        if (v && v.teacher && v.timestamp > lastHandledAbsentTs && !isAbsentTriggered) {
            isAbsentTriggered = true;
            clearPendingAbsentCheck();
            triggerAbsentScreen(v.teacher);
        }
    });
}

function logAdminActivity(actionText) {
    let logs = JSON.parse(localStorage.getItem('sys_admin_activity_log') || '[]');
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    logs.unshift(`${timeStr} ${actionText}`);
    if(logs.length > 100) logs.pop();
    localStorage.setItem('sys_admin_activity_log', JSON.stringify(logs));
}

function updateMainNoticeDisplay(notice) {
    const banner = document.getElementById('mainNoticeBanner');
    if(notice && notice.text && notice.text.trim()) {
        banner.innerText = notice.text;
        banner.style.fontSize = notice.size || '0.95rem';
        banner.style.color = notice.color || '#c2410c';
        banner.style.display = 'block';
    } else {
        banner.style.display = 'none';
    }
}

function updateLockoutTimerVisual() {
    const blockUntil = parseInt(localStorage.getItem('sys_admin_block_until') || '0');
    const now = Date.now();
    if (blockUntil > now) {
        const remainSec = Math.ceil((blockUntil - now) / 1000);
        const mins = String(Math.floor(remainSec / 60)).padStart(2, '0');
        const secs = String(remainSec % 60).padStart(2, '0');
        document.getElementById('lockoutTimer').innerText = `${mins}:${secs}`;
        document.getElementById('lockoutOverlay').style.display = 'flex';
        if (!lockoutInterval) lockoutInterval = setInterval(updateLockoutTimerVisual, 1000);
    } else {
        if (lockoutInterval) { clearInterval(lockoutInterval); lockoutInterval = null; }
        document.getElementById('lockoutOverlay').style.display = 'none';
    }
}

function openAdmin() {
    clearPin();
    const blockUntil = parseInt(localStorage.getItem('sys_admin_block_until') || '0');
    if(Date.now() < blockUntil) { updateLockoutTimerVisual(); return; }

    pinStage = adminSetupDone ? 'login' : 'setup_new';
    pinFirstEntry = '';
    updatePinPadUI();
    document.getElementById('stepPin').style.display = 'block';
    document.getElementById('stepControlDashboard').style.display = 'none';
    document.getElementById('adminModal').style.display = 'flex';
}

function closeAdmin() {
    document.getElementById('adminModal').style.display = 'none';
    clearPin();
    auth.signOut().catch(()=>{});
}

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
    const blockUntil = parseInt(localStorage.getItem('sys_admin_block_until') || '0');
    if(Date.now() < blockUntil) { clearPin(); return; }
    if(inputtedPin.length >= 6) return;
    inputtedPin += num;
    document.getElementById('pinStars').innerText = '• '.repeat(inputtedPin.length);
    if(inputtedPin.length === 6) setTimeout(() => handlePinComplete(), 150);
}

function clearPin() {
    inputtedPin = "";
    const el = document.getElementById('pinStars');
    if (el) el.innerText = "";
}

function setupPasswordKeyboardSupport() {
    const loginGate = document.getElementById('loginGate');
    if (!loginGate) return;
    document.addEventListener('keydown', (e) => {
        if (loginGate.style.display === 'none') return;
        if (/^[0-9]$/.test(e.key)) {
            e.preventDefault();
            pressPin(e.key);
        } else if (e.key === 'Backspace') {
            e.preventDefault();
            clearPin();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (inputtedPin.length === 6) {
                handlePinComplete();
            }
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupPasswordKeyboardSupport);
} else {
    setupPasswordKeyboardSupport();
}

async function handlePinComplete() {
    const pin = inputtedPin;

    if (pinStage === 'setup_new') {
        pinFirstEntry = pin;
        pinStage = 'setup_confirm';
        updatePinPadUI();
        clearPin();
        return;
    }

    if (pinStage === 'setup_confirm') {
        if (pin !== pinFirstEntry) {
            alert('입력하신 두 비밀번호가 서로 다릅니다. 처음부터 다시 설정해주세요.');
            pinStage = 'setup_new'; pinFirstEntry = ''; updatePinPadUI(); clearPin();
            return;
        }
        try {
            await auth.createUserWithEmailAndPassword(ADMIN_EMAIL, pin);
            await db.ref('shared/adminSetupDone').set(true);
            enterAdminDashboard();
        } catch (err) {
            if (err.code === 'auth/email-already-in-use') {
                alert('이미 다른 기기에서 비밀번호가 설정되어 있습니다. 로그인 화면으로 전환할게요.');
                pinStage = 'login'; updatePinPadUI(); clearPin();
            } else if (err.code === 'auth/operation-not-allowed') {
                alert('아직 관리자 인증 기능이 켜져 있지 않아요. 파이어베이스 콘솔 → Authentication → Sign-in method 에서 "이메일/비밀번호"를 켜주세요.');
                closeAdmin();
            } else {
                alert('설정 중 오류가 발생했습니다: ' + err.message);
                clearPin();
            }
        }
        return;
    }

    try {
        await auth.signInWithEmailAndPassword(ADMIN_EMAIL, pin);
        localStorage.setItem('sys_admin_fail_count', '0');
        localStorage.setItem('sys_admin_block_until', '0');
        enterAdminDashboard();
    } catch (err) {
        if (err.code === 'auth/user-not-found') {
            alert('아직 비밀번호가 설정되지 않았어요. 최초 설정 화면으로 이동할게요.');
            pinStage = 'setup_new'; updatePinPadUI(); clearPin();
            return;
        }
        if (err.code === 'auth/operation-not-allowed') {
            alert('아직 관리자 인증 기능이 켜져 있지 않아요. 파이어베이스 콘솔에서 "이메일/비밀번호" 로그인을 켜주세요.');
            closeAdmin();
            return;
        }
        let failCount = parseInt(localStorage.getItem('sys_admin_fail_count') || '0') + 1;
        localStorage.setItem('sys_admin_fail_count', failCount);
        if (failCount >= 5) {
            const lockTime = Date.now() + 5 * 60 * 1000;
            localStorage.setItem('sys_admin_block_until', lockTime);
            logAdminActivity("연속 인증 실패로 인한 관리자 화면 5분 잠금 작동");
            closeAdmin();
            updateLockoutTimerVisual();
        } else {
            alert(`비밀번호가 올바르지 않습니다. (인증 오류 횟수: ${failCount} / 5)`);
            clearPin();
        }
    }
}

function enterAdminDashboard() {
    document.getElementById('stepPin').style.display = 'none';
    document.getElementById('stepControlDashboard').style.display = 'flex';
    calculateTodayStats();
}

function switchToSubSettingPage(pageNumber) {
    document.getElementById('adminModal').style.display = 'none';
    document.getElementById('mainSettingsBtn').style.display = 'none';

    if(pageNumber === 7) { seatMoveSourceKey = null; renderSeatEditor(); }
    if(pageNumber === 8) renderAdminBlacklist();
    if(pageNumber === 9) renderStudentRegistryGridList();
    if(pageNumber === 10) loadFullLogPage();
    if(pageNumber === 12) renderAdminActivityLog();
    if(pageNumber === 13) renderMainNoticeInput();
    if(pageNumber === 14) renderRoomSwitchList();

    go(pageNumber);
}

function backToDashboard() {
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    document.getElementById('page0').classList.add('active');
    document.getElementById('mainSettingsBtn').style.display = 'flex';
    document.getElementById('roomBadge').style.display = 'flex';
    document.getElementById('adminModal').style.display = 'flex';
    document.getElementById('stepPin').style.display = 'none';
    document.getElementById('stepControlDashboard').style.display = 'flex';
    calculateTodayStats();
}

let allFetchedLogs = [];

async function fetchRoomCalls() {
    const snap = await db.ref(`rooms/${ROOM}/calls`).once('value');
    const val = snap.val() || {};
    return Object.values(val).sort((a, b) => (b.timestamp||0) - (a.timestamp||0));
}

async function calculateTodayStats() {
    allFetchedLogs = await fetchRoomCalls();
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayLogs = allFetchedLogs.filter(log => parseToYYYYMMDD(log.time || log.timestamp) === todayStr);
    document.getElementById('statTodayCount').innerText = `${todayLogs.length}건`;

    const teacherMap = {}, purposeMap = {};
    todayLogs.forEach(log => {
        if(log.teacher) teacherMap[log.teacher] = (teacherMap[log.teacher] || 0) + 1;
        if(log.purpose) purposeMap[log.purpose] = (purposeMap[log.purpose] || 0) + 1;
    });

    let topTeacher = "-", maxTCount = 0;
    for(let t in teacherMap) if(teacherMap[t] > maxTCount) { maxTCount = teacherMap[t]; topTeacher = t; }
    document.getElementById('statTopTeacher').innerText = topTeacher !== "-" ? `${topTeacher} 쌤` : "-";

    let topPurpose = "-", maxPCount = 0;
    for(let p in purposeMap) if(purposeMap[p] > maxPCount) { maxPCount = purposeMap[p]; topPurpose = p; }
    if(topPurpose.length > 8) topPurpose = topPurpose.slice(0, 7) + "..";
    document.getElementById('statTopPurpose').innerText = topPurpose;
}

function renderSeatEditor() {
    const grid = document.getElementById('seatEditorGrid');
    if (!grid) return;
    document.getElementById('seatRowsInput').value = seatLayout.rows;
    document.getElementById('seatColsInput').value = seatLayout.cols;
    grid.innerHTML = "";
    grid.style.gridTemplateColumns = `repeat(${seatLayout.cols}, minmax(120px, 1fr))`;

    for (let r = 0; r < seatLayout.rows; r++) {
        for (let c = 0; c < seatLayout.cols; c++) {
            const key = `${r}_${c}`;
            const seat = seatLayout.seats[key];
            const cell = document.createElement('div');
            const filled = !!(seat && seat.name);
            cell.className = 'seat-cell editor' + (filled ? '' : ' empty') + (seatMoveSourceKey === key ? ' selected' : '');

            if (filled) {
                cell.innerHTML = `
                    <div class="seat-name">${seat.name}</div>
                    ${seat.subtitle ? `<div class="seat-sub">${seat.subtitle}</div>` : ''}
                    <div class="seat-btn-row">
                        <button class="settings-del-btn" style="background:#e0f2fe;color:#0369a1;" data-act="edit">수정</button>
                        <button class="settings-del-btn" style="background:#f1f5f9;color:#334155;" data-act="move">이동</button>
                        <button class="settings-del-btn" data-act="delete">삭제</button>
                    </div>`;
                cell.querySelector('[data-act="edit"]').onclick = (e) => { e.stopPropagation(); openSeatEditModal(key); };
                cell.querySelector('[data-act="move"]').onclick = (e) => { e.stopPropagation(); startMoveSeat(key); };
                cell.querySelector('[data-act="delete"]').onclick = (e) => { e.stopPropagation(); deleteSeat(key); };
            } else {
                cell.innerHTML = `<div>+ 추가</div>`;
            }

            cell.addEventListener('click', () => {
                if (seatMoveSourceKey) {
                    if (seatMoveSourceKey !== key) moveSeatTo(key);
                    else { seatMoveSourceKey = null; renderSeatEditor(); }
                    return;
                }
                if (!filled) openSeatEditModal(key);
            });

            grid.appendChild(cell);
        }
    }
    document.getElementById('seatMoveHint').style.display = seatMoveSourceKey ? 'block' : 'none';
}

function applySeatGridSize() {
    const rows = Math.max(1, Math.min(12, parseInt(document.getElementById('seatRowsInput').value) || 1));
    const cols = Math.max(1, Math.min(8, parseInt(document.getElementById('seatColsInput').value) || 1));
    const newSeats = {};
    Object.keys(seatLayout.seats || {}).forEach(key => {
        const [r, c] = key.split('_').map(Number);
        if (r < rows && c < cols) newSeats[key] = seatLayout.seats[key];
    });
    seatLayout = { rows, cols, seats: newSeats };
    db.ref(`rooms/${ROOM}/seatLayout`).set(seatLayout);
    logAdminActivity(`자리 배치 크기 변경 (${rows}x${cols})`);
}

function openSeatEditModal(key) {
    seatEditTargetKey = key;
    const cur = seatLayout.seats[key] || { name: '', subtitle: '' };
    document.getElementById('seatEditModalTitle').innerText = cur.name ? '선생님 자리 수정' : '선생님 자리 추가';
    document.getElementById('seatEditNameInput').value = cur.name || '';
    document.getElementById('seatEditSubtitleInput').value = cur.subtitle || '';
    document.getElementById('seatEditModal').style.display = 'flex';
    setTimeout(() => document.getElementById('seatEditNameInput').focus(), 50);
}
function closeSeatEditModal() {
    document.getElementById('seatEditModal').style.display = 'none';
    seatEditTargetKey = null;
}
function confirmSeatEditModal() {
    const name = document.getElementById('seatEditNameInput').value.trim();
    if (!name) { alert('선생님 성함을 입력해주세요.'); return; }
    const subtitle = document.getElementById('seatEditSubtitleInput').value.trim();
    seatLayout.seats[seatEditTargetKey] = { name, subtitle };
    db.ref(`rooms/${ROOM}/seatLayout`).set(seatLayout);
    logAdminActivity(`자리 편집 (${name})`);
    closeSeatEditModal();
}

function deleteSeat(key) {
    const cur = seatLayout.seats[key];
    if (!cur) return;
    if (!confirm(`[${cur.name}] 자리를 삭제할까요?`)) return;
    delete seatLayout.seats[key];
    db.ref(`rooms/${ROOM}/seatLayout`).set(seatLayout);
    logAdminActivity(`자리 삭제 (${cur.name})`);
}

function startMoveSeat(key) {
    seatMoveSourceKey = key;
    renderSeatEditor();
}

function moveSeatTo(destKey) {
    const src = seatLayout.seats[seatMoveSourceKey];
    if (!src) { seatMoveSourceKey = null; renderSeatEditor(); return; }
    const dest = seatLayout.seats[destKey];
    const newSeats = { ...seatLayout.seats };
    if (dest) newSeats[seatMoveSourceKey] = dest; else delete newSeats[seatMoveSourceKey];
    newSeats[destKey] = src;
    seatLayout.seats = newSeats;
    seatMoveSourceKey = null;
    db.ref(`rooms/${ROOM}/seatLayout`).set(seatLayout);
    logAdminActivity(`자리 이동 (${src.name})`);
}

function renderRoomSwitchList() {
    const box = document.getElementById('roomSwitchList');
    box.innerHTML = "";
    ROOM_LIST.forEach(r => {
        const b = document.createElement('button');
        b.className = 'room-choice-btn';
        b.style.marginBottom = '12px';
        b.innerText = (r === ROOM ? '✅ ' : '') + r;
        b.onclick = () => {
            localStorage.setItem('sys_saved_room', r);
            const url = new URL(window.location.href);
            url.searchParams.set('room', r);
            window.location.href = url.toString();
        };
        box.appendChild(b);
    });
}

function renderAdminBlacklist() {
    const box = document.getElementById('adminBlacklistListBox');
    if (!box) return;
    if(blacklistStorage.length === 0) {
        box.innerHTML = '<div class="settings-list-item">현재 제재중인 호출 차단자가 없습니다.</div>';
        return;
    }
    box.innerHTML = blacklistStorage.map((b, idx) => `
        <div class="settings-list-item">
            <span>[${b.id}] ${b.name} (${b.period})</span>
            <button class="settings-del-btn" style="background:#e0f2fe; color:#0369a1;" onclick="liftBlacklist(${idx})">차단 해제</button>
        </div>
    `).join('');
}

function registerBlacklist() {
    const idInp = document.getElementById('blackStudentId').value.trim();
    const nameInp = document.getElementById('blackStudentName').value.trim();
    const periodText = document.getElementById('blackBlockPeriod').options[document.getElementById('blackBlockPeriod').selectedIndex].text;

    if(idInp.length !== 5 || isNaN(idInp)) { alert("학번 5자리를 정확히 기입해 주세요."); return; }
    if(!nameInp) { alert("학생 성명을 기입해 주세요."); return; }

    blacklistStorage.push({ id: idInp, name: nameInp, period: periodText });
    db.ref('shared/blacklist').set(blacklistStorage);
    logAdminActivity(`블랙리스트 등록 (${idInp} ${nameInp})`);

    document.getElementById('blackStudentId').value = "";
    document.getElementById('blackStudentName').value = "";
    alert(`학번 ${idInp} 학생이 블랙리스트에 제재 등록되었습니다. (전 교무실 공통 적용)`);
}

function liftBlacklist(index) {
    const b = blacklistStorage[index];
    logAdminActivity(`블랙리스트 해제 (${b.id} ${b.name})`);
    alert("해당 학생의 블로킹 제재가 철회 조치되었습니다.");
    blacklistStorage.splice(index, 1);
    db.ref('shared/blacklist').set(blacklistStorage);
}

function getStudentName(v) {
    if (v && typeof v === 'object') return v.name || '';
    return v || '';
}

function renderStudentRegistryGridList() {
    const box = document.getElementById('adminStudentRegistryGridBox');
    if (!box) return;
    box.innerHTML = "";
    const keys = Object.keys(studentRegistry);
    if(keys.length === 0) {
        box.innerHTML = '<div class="settings-list-item">등록된 학생 DB가 비어있습니다.</div>';
        return;
    }
    keys.sort((a, b) => parseInt(a) - parseInt(b));
    let html = "";
    keys.forEach(sid => {
        const sname = getStudentName(studentRegistry[sid]);
        html += `
            <div class="settings-list-item" style="align-items: center; gap: 10px;">
                <div style="display: flex; flex-direction: column; text-align: left;">
                    <span class="db-key-title">👤 학번: ${sid}</span>
                    <span class="db-val-sub">이름: ${sname}</span>
                </div>
                <button class="settings-del-btn" onclick="deleteSingleStudentKey('${sid}')">삭제</button>
            </div>
        `;
    });
    box.innerHTML = html;
}

function addManualStudent() {
    const idInp = document.getElementById('manualStudentId').value.trim();
    const nameInp = document.getElementById('manualStudentName').value.trim();
    if(idInp.length !== 5 || isNaN(idInp)) { alert("학번 5자리를 올바르게 기입하세요."); return; }
    if(!nameInp) { alert("학생 성명을 입력해 주세요."); return; }

    studentRegistry[idInp] = { name: nameInp, createdAt: Date.now() };
    db.ref(`shared/students/${idInp}`).set({ name: nameInp, createdAt: Date.now() });
    logAdminActivity(`학생 수동 등록 (${idInp} ${nameInp})`);

    document.getElementById('manualStudentId').value = "";
    document.getElementById('manualStudentName').value = "";
    alert(`학번 ${idInp} (${nameInp}) 학생이 데이터베이스에 정상 등록되었습니다.`);
}

function deleteSingleStudentKey(sid) {
    if(confirm(`[데이터 파기] 학번 [ ${sid} ] 학생 캐시를 영구 파기할까요?`)) {
        const name = getStudentName(studentRegistry[sid]);
        db.ref(`shared/students/${sid}`).remove();
        logAdminActivity(`학생 단일 캐시 파기 (${sid} ${name})`);
    }
}

function clearAllStudentRegistry() {
    if(confirm("🚨 [경고] 등록된 모든 학생의 자동완성 이름 연동 정보가 전면 삭제됩니다. 진행합니까?")) {
        db.ref('shared/students').set({});
        logAdminActivity("학생 DB 전체 초기화");
        alert("학생 연동 데이터베이스가 완전 초기화되었습니다.");
    }
}

function parseToYYYYMMDD(str) {
    if(!str) return "";
    str = String(str).trim();
    if(/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
    let matches = str.match(/(\d{4})[\.\-\/]\s*(\d{1,2})[\.\-\/]\s*(\d{1,2})/);
    if(matches) return `${matches[1]}-${matches[2].padStart(2,'0')}-${matches[3].padStart(2,'0')}`;
    let d = new Date(str);
    if(!isNaN(d.getTime())) {
        let y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    return "";
}

async function loadFullLogPage() {
    const box = document.getElementById('fullLogListBox');
    box.innerHTML = "<div style='text-align:center; padding:20px; color:#64748b;'>전체 전송 로그 수집 동기화 중...</div>";
    allFetchedLogs = await fetchRoomCalls();
    filterLogs();
}

function filterLogs() {
    const sStart = document.getElementById('searchLogStartDate').value;
    const sEnd = document.getElementById('searchLogEndDate').value;
    const sId = document.getElementById('searchLogId').value.trim();
    const sName = document.getElementById('searchLogName').value.trim().toLowerCase();
    const sTeacher = document.getElementById('searchLogTeacher').value.trim().toLowerCase();

    const filtered = allFetchedLogs.filter(log => {
        const timeStr = log.time || log.timestamp || '';
        const logDateStr = parseToYYYYMMDD(timeStr);
        const dateMatch = (!sStart || logDateStr >= sStart) && (!sEnd || logDateStr <= sEnd);
        const idMatch = !sId || String(log.id || '').includes(sId);
        const nameMatch = !sName || String(log.name || '').toLowerCase().includes(sName);
        const teacherMatch = !sTeacher || String(log.teacher || '').toLowerCase().includes(sTeacher);
        return dateMatch && idMatch && nameMatch && teacherMatch;
    });

    document.getElementById('searchLogResultCount').innerText = `${filtered.length}개의 데이터 찾음`;
    const box = document.getElementById('fullLogListBox');
    if(filtered.length === 0) {
        box.innerHTML = '<div class="settings-list-item" style="justify-content:center; color:#94a3b8;">매칭된 검색 로그가 없습니다.</div>';
        return;
    }
    box.innerHTML = filtered.map(log => {
        const tDisplay = log.time ? String(log.time).slice(5,16) : '실시간 전송';
        return `
            <div class="settings-list-item" style="padding:12px; font-size:0.88rem; gap:10px;">
                <div style="text-align:left; line-height:1.4;">
                    <span style="font-size:0.75rem; background:#e2e8f0; padding:2px 6px; border-radius:4px; color:#475569; font-weight:bold; margin-right:5px;">${tDisplay}</span>
                    <strong>${log.teacher} 쌤</strong> 호출 <span style="color:#94a3b8;">(${log.status || '미출력'})</span><br>
                    <span style="color:#64748b;">학번성명: ${log.id} ${log.name} (${log.purpose || '사유 미지정'})</span>
                </div>
                <button class="settings-del-btn" style="flex-shrink:0;" onclick="instantConnectBlacklist('${log.id}', '${log.name}')">차단</button>
            </div>
        `;
    }).join('');
}

function instantConnectBlacklist(sid, sname) {
    if(confirm(`[블랙리스트 연계]\n학번 ${sid} (${sname}) 학생을 즉시 영구 차단 등록하시겠습니까?`)) {
        blacklistStorage.push({ id: sid, name: sname, period: '영구 차단' });
        db.ref('shared/blacklist').set(blacklistStorage);
        logAdminActivity(`블랙리스트 등록 (${sid} ${sname})`);
        alert(`학번 ${sid} 학생이 호출 제한 제재 목록에 즉시 연동 반영되었습니다.`);
        filterLogs();
    }
}

function downloadLogsCSV() {
    if(allFetchedLogs.length === 0) { alert("다운로드할 로그 아카이브가 비어있습니다."); return; }
    let csvContent = "\uFEFF호출일자/시간,담당선생님,호출학생학번,학생성명,호출목적,상태\n";
    allFetchedLogs.forEach(log => {
        const row = [log.time || log.timestamp || '', log.teacher || '', log.id || '', log.name || '', log.purpose || '', log.status || '']
            .map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
        csvContent += row + "\n";
    });
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `교무실호출_${ROOM}_로그리포트_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    logAdminActivity("전체 로그 CSV 파일 아웃풋 내보내기");
}

function exportSettingsJSON() {
    const backupDataBundle = { seatLayout: seatLayout, sys_blacklist: blacklistStorage, sys_student_registry: studentRegistry, room: ROOM };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupDataBundle, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `FACULTY_CALL_BACKUP_${ROOM}_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    logAdminActivity("시스템 설정 JSON 데이터 백업본 내보내기");
    alert("모든 설정 백업 파일이 성공적으로 다운로드되었습니다.");
}

function importSettingsJSON() {
    const fileInput = document.getElementById('importSettingsFileInput');
    if(!fileInput.files || fileInput.files.length === 0) { alert("복원 처리할 JSON 백업 아카이브 파일을 선택하십시오."); return; }
    if(!confirm("⚠️ 경고: 파이어베이스에 저장된 현재 데이터가 업로드된 백업본으로 덮어쓰기 처리됩니다. 진행할까요?")) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedJson = JSON.parse(e.target.result);
            if(importedJson.seatLayout) db.ref(`rooms/${ROOM}/seatLayout`).set(importedJson.seatLayout);
            if(importedJson.sys_blacklist) db.ref('shared/blacklist').set(importedJson.sys_blacklist);
            if(importedJson.sys_student_registry) db.ref('shared/students').set(importedJson.sys_student_registry);
            logAdminActivity("설정 데이터 전면 복원 완료");
            alert("🎉 전체 환경 및 백업 설정이 실시간으로 동기화 및 전면 복구되었습니다!");
            fileInput.value = "";
            backToDashboard();
        } catch(err) {
            alert("허용되지 않은 JSON 규격이거나 깨진 압축 구조 파일입니다.");
        }
    };
    reader.readAsText(fileInput.files[0]);
}

function renderAdminActivityLog() {
    const box = document.getElementById('adminActivityLogBox');
    const logs = JSON.parse(localStorage.getItem('sys_admin_activity_log') || '[]');
    if(logs.length === 0) {
        box.innerHTML = '<div style="padding:20px; color:#94a3b8; text-align:center;">기록된 감사 추적 내역이 존재하지 않습니다.</div>';
        return;
    }
    box.innerHTML = logs.map(l => `<div style="padding:10px 6px; border-bottom:1px dashed #334155; font-family:monospace !important; font-size:0.88rem; line-height:1.4;"><span style="color:#38bdf8; font-weight:bold; margin-right:6px;">[SYSTEM]</span> ${l}</div>`).join('');
}

function clearAdminActivityLog() {
    if(confirm("모든 보안 제어 추적 로그를 영구 삭제합니까?")) {
        localStorage.setItem('sys_admin_activity_log', '[]');
        renderAdminActivityLog();
    }
}

function renderMainNoticeInput() {
    db.ref(`rooms/${ROOM}/notice`).once('value', snap => {
        const v = snap.val() || { text: '', size: '0.95rem', color: '#c2410c' };
        document.getElementById('mainNoticeInputText').value = v.text || '';
        document.getElementById('mainNoticeSize').value = v.size || '0.95rem';
        document.getElementById('mainNoticeColor').value = v.color || '#c2410c';
        document.getElementById('mainNoticeColorHex').value = v.color || '#c2410c';
    });
}

function saveMainNoticeMessage() {
    const txt = document.getElementById('mainNoticeInputText').value;
    const size = document.getElementById('mainNoticeSize').value;
    const color = document.getElementById('mainNoticeColor').value;
    db.ref(`rooms/${ROOM}/notice`).set({ text: txt, size, color });
    logAdminActivity("공지사항 및 스타일 속성 변경");
    alert("메인 공지사항 설정 스케줄링이 실시간 갱신되었습니다.");
    backToDashboard();
}

function sendTestCall() {
    const testTeacher = data.t || getAllSeatNames()[0] || '테스트교사';
    const dateStr = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    const callRef = db.ref(`rooms/${ROOM}/calls`).push();
    const payload = { key: callRef.key, teacher: testTeacher, id: "21145", name: "테스트", purpose: "시스템 테스트", time: dateStr, timestamp: Date.now(), status: "미출력" };
    callRef.set(payload);
    db.ref(`rooms/${ROOM}/latestCall`).set(payload);
    alert(`[${testTeacher} 선생님]께 테스트 호출 신호(11반 45번 테스트)를 전송했습니다!`);
}

function go(p) {
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    document.getElementById('page'+p).classList.add('active');
    document.getElementById('mainSettingsBtn').style.display = (p === 0) ? 'flex' : 'none';
    document.getElementById('roomBadge').style.display = (p === 0) ? 'flex' : 'none';
    if(p === 4) startCountdown();
}

function buildTeacherFrontGrid() {
    const grid = document.getElementById('teacherGrid');
    if (!grid) return;
    grid.className = 'seat-grid';
    grid.style.gridTemplateColumns = `repeat(${seatLayout.cols}, minmax(120px, 1fr))`;
    grid.innerHTML = "";
    for (let r = 0; r < seatLayout.rows; r++) {
        for (let c = 0; c < seatLayout.cols; c++) {
            const key = `${r}_${c}`;
            const seat = seatLayout.seats[key];
            const cell = document.createElement('div');
            if (seat && seat.name) {
                cell.className = 'seat-cell';
                cell.innerHTML = `<div class="seat-name">${seat.name}</div>${seat.subtitle ? `<div class="seat-sub">${seat.subtitle}</div>` : ''}`;
                cell.onclick = () => selectSeatTeacher(seat.name, cell);
            } else {
                cell.className = 'seat-cell empty';
            }
            grid.appendChild(cell);
        }
    }
}

function selectSeatTeacher(name, cellEl) {
    document.querySelectorAll('#teacherGrid .seat-cell').forEach(b => b.classList.remove('selected'));
    cellEl.classList.add('selected');
    data.t = name;
    document.getElementById('n1').disabled = false;
}

for(let i=1; i<=10; i++) document.getElementById('classGrid').innerHTML += `<div class="btn-opt" onclick="sel('b','${i}')">${i}반</div>`;
for(let i=1; i<=35; i++) document.getElementById('numGrid').innerHTML += `<div class="btn-opt" onclick="sel('n','${i}')">${i}번</div>`;
['질문', '제출', '상담', '기타'].forEach(p => document.getElementById('purposeGrid').innerHTML += `<div class="btn-opt" onclick="sel('p','${p}')">${p}</div>`);

if (ROOM === '본교무실') {
    const gGrid = document.getElementById('gradeGrid');
    gGrid.style.display = 'grid';
    ['1학년', '2학년', '3학년'].forEach((g, idx) => {
        gGrid.innerHTML += `<div class="btn-opt" onclick="sel('g','${idx+1}')">${g}</div>`;
    });
}

function getEffectiveGrade() {
    if (ROOM === '1학년 교무실') return '1';
    if (ROOM === '2학년 교무실') return '2';
    if (ROOM === '3학년 교무실') return '3';
    return data.g || '';
}

function buildStudentId() {
    const g = getEffectiveGrade();
    if (!g || !data.b || !data.n) return null;
    return `${g}${data.b.padStart(2,'0')}${data.n.padStart(2,'0')}`;
}

function sel(k, v) {
    event.target.parentElement.querySelectorAll('.btn-opt').forEach(b => b.classList.remove('selected'));
    event.target.classList.add('selected');
    data[k] = v;
    if(k==='t') document.getElementById('n1').disabled = false;

    if(k==='b' || k==='n' || k==='g') {
        const sid = buildStudentId();
        if (sid && studentRegistry[sid]) {
            const knownName = getStudentName(studentRegistry[sid]);
            document.getElementById('nameInp').value = knownName;
            data.name = knownName;
        } else if (data.b && data.n) {
            document.getElementById('nameInp').value = "";
            data.name = "";
        }
    }

    if(k==='p') {
        const customBox = document.getElementById('customPurpose');
        if(v === '기타') { customBox.style.display = 'block'; }
        else { customBox.style.display = 'none'; customBox.value = ''; data.customP = ''; }
    }
    val2();
}

function val2() {
    data.name = document.getElementById('nameInp').value.trim();
    data.customP = document.getElementById('customPurpose').value.trim();
    let purposeOk = data.p && (data.p !== '기타' || data.customP.length > 0);
    const gradeOk = ROOM !== '본교무실' || !!data.g;
    const ok = gradeOk && data.b && data.n && data.name && purposeOk;
    document.getElementById('n2').disabled = !ok;
}

function val3() {
    const chk = document.getElementById('agreeChk');
    const btn = document.getElementById('longPressBtn');
    const sid = buildStudentId();

    if (!sid) { chk.checked = false; btn.classList.add('disabled'); return; }

    const checkBlack = blacklistStorage.find(b => b.id === sid);
    if(checkBlack) {
        alert(`[호출 차단 알림]\n해당 학번은 현재 허위 호출 제재 조치 중입니다.\n기간 내 시스템 사용이 엄격히 제한됩니다.`);
        chk.checked = false;
        btn.classList.add('disabled');
        cleanReset();
        return;
    }

    if(chk.checked) {
        const lastCallTs = cooldownMap[sid];
        if (lastCallTs && Date.now() - lastCallTs < 600000) {
            const remainMin = Math.ceil((600000 - (Date.now() - lastCallTs)) / 60000);
            alert(`같은 학번으로 너무 자주 호출했어요. 약 ${remainMin}분 뒤 재호출 가능합니다.`);
            chk.checked = false;
            btn.classList.add('disabled');
            return;
        }
        btn.classList.remove('disabled');
    } else {
        btn.classList.add('disabled');
    }
}

function executeSubmit(id) {
    const finalPurpose = data.p === '기타' ? `기타(${data.customP})` : data.p;
    const nowTs = Date.now();
    const dateStr = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

    db.ref(`shared/cooldown/${id}`).set(nowTs);
    db.ref(`shared/students/${id}`).set({ name: data.name, createdAt: nowTs });

    const callRef = db.ref(`rooms/${ROOM}/calls`).push();
    const payload = { key: callRef.key, teacher: data.t, id: id, name: data.name, purpose: finalPurpose, time: dateStr, timestamp: nowTs, status: "미출력" };
    callRef.set(payload);
    db.ref(`rooms/${ROOM}/latestCall`).set(payload);

    lastHandledAbsentTs = nowTs - 1;
    isAbsentTriggered = false;

    try {
        localStorage.setItem(PENDING_ABSENT_KEY, JSON.stringify({ teacher: data.t, ts: nowTs }));
    } catch(e) {}
    pendingAbsentTeacher = data.t;
    pendingAbsentTs = nowTs;

    setTimeout(() => {
        const studentInfo = {
            grade: getEffectiveGrade(),
            classNum: data.b || '?',
            seatNum: data.n || '?',
            name: data.name || '?',
            teacher: data.t || '?',
            purpose: data.p || '?',
            customPurpose: data.customP || ''
        };
        playCallConfirmationTTS(studentInfo);
    }, 500);
}

let pressTimer = null, progress = 0;
const holdBtn = document.getElementById('longPressBtn'), bar = document.getElementById('progressBar');

function startPress(e) {
    if(e) e.preventDefault();
    if(holdBtn.classList.contains('disabled')) return;
    const sid = buildStudentId();
    if (!sid) return;

    if (!isSubmitted) {
        isSubmitted = true;
        try { executeSubmit(sid); } catch (err) { console.log('제출 처리 오류:', err); }
    }

    clearInterval(pressTimer);
    progress = 0;
    bar.style.width = "0%";
    holdBtn.classList.add('active-press');

    pressTimer = setInterval(() => {
        progress += 1;
        bar.style.width = progress + "%";
        if(progress >= 100) {
            clearInterval(pressTimer);
            document.getElementById('holdingOverlay').style.display = 'flex';
            setTimeout(() => { document.getElementById('holdingOverlay').style.display = 'none'; go(4); }, 800);
        }
    }, 50);
}

function endPress() {
    clearInterval(pressTimer);
    holdBtn.classList.remove('active-press');
    if(progress < 100) { progress = 0; bar.style.width = "0%"; }
}

function startCountdown() {
    let sec = 5;
    const txt = document.getElementById('timerCountdown');
    autoFallbackTimer = setInterval(() => {
        sec--;
        txt.innerText = sec + "초";
        if(sec <= 0) { cleanReset(); }
    }, 1000);
}

function cleanReset() {
    if(autoFallbackTimer) clearInterval(autoFallbackTimer);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    location.reload();
}

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

function playCallConfirmationTTS(studentInfo) {
    if (!('speechSynthesis' in window)) return;

    try {
        window.speechSynthesis.cancel();

        const gradeDisplay = studentInfo.grade === '1' ? '1학년' :
                             studentInfo.grade === '2' ? '2학년' :
                             studentInfo.grade === '3' ? '3학년' : '학년';

        const purposeDisplay = studentInfo.purpose === '기타' ? studentInfo.customPurpose : studentInfo.purpose;
        const message = `${gradeDisplay} ${studentInfo.classNum}반 ${studentInfo.seatNum}번 ${studentInfo.name} 학생이 ${studentInfo.teacher} 선생님을 호출했습니다. 호출 사유는 ${purposeDisplay}입니다.`;

        const uttr = new SpeechSynthesisUtterance(message);
        if(koVoice) uttr.voice = koVoice;
        uttr.lang = 'ko-KR';
        uttr.rate = roomSettings.ttsRate ?? 0.9;
        uttr.volume = Math.min(1, ((roomSettings.ttsVolume ?? 100) / 100) * 1.5);

        window.speechSynthesis.speak(uttr);
    } catch(e) {
        console.log('TTS 재생 오류:', e);
    }
}

function playBellSound(bellType, ctx, now, alertVol) {
    const playStrongTone = (freq, startTime, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(1.0 * alertVol, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
    };

    if (bellType === 'bell1') {
        const bellType2 = roomSettings.bellSound || 'bell1';
        playBellSound(bellType2, ctx, now, alertVol);
    } else if (bellType === 'bell2') {
        for (let i = 0; i < 4; i++) {
            const base = i * 0.5;
            playStrongTone(1900, now + base, 0.3);
            playStrongTone(2100, now + base + 0.15, 0.35);
        }
    } else if (bellType === 'bell3') {
        for (let i = 0; i < 2; i++) {
            const base = i * 1.2;
            playStrongTone(800, now + base, 0.5);
            playStrongTone(1200, now + base + 0.25, 0.55);
        }
    } else if (bellType === 'bell4') {
        for (let i = 0; i < 5; i++) {
            const base = i * 0.6;
            playStrongTone(1100 + (i * 100), now + base, 0.25);
        }
    }
}

function triggerAbsentScreen(teacherName) {
    if(autoFallbackTimer) clearInterval(autoFallbackTimer);

    sessionStorage.setItem('absentTeacher', teacherName);
    sessionStorage.setItem('absentActive', 'true');

    const overlay = document.getElementById('absentOverlay');
    document.getElementById('absentMsg').innerHTML = `<span style="font-size:2.8rem; font-weight:900; background:rgba(0,0,0,0.2); padding:4px 15px; border-radius:12px;">${teacherName}</span> 선생님은<br>현재 부재중이십니다.`;
    overlay.style.display = "flex";

    const alertVol = Math.max(0, Math.min(1, (roomSettings.alertVolume ?? 100) / 100));
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        const now = ctx.currentTime;
        playBellSound('bell2', ctx, now, alertVol);
    } catch (e) {}
}

initRealtimeSync();
startHeartbeat();
updateLockoutTimerVisual();

document.getElementById('mainNoticeColor').addEventListener('input', function() {
    document.getElementById('mainNoticeColorHex').value = this.value;
});

holdBtn.addEventListener('mousedown', startPress);
holdBtn.addEventListener('touchstart', startPress);
window.addEventListener('mouseup', endPress);
window.addEventListener('touchend', endPress);

buildTeacherFrontGrid();
