const { OPTIONS } = window.ChuncheonMusic;
const $ = id => document.getElementById(id);

// 키오스크 모드: 주소 끝에 ?kiosk=1 → 키링 인쇄 버튼 표시, 3분 무조작 시 처음 화면으로
const params = new URLSearchParams(location.search);
const KIOSK = params.has('kiosk');
const HOME_URL = KIOSK ? '/?kiosk=1' : '/';
const DEFAULT_BG = 'assets/gongjicheon_1785911982114.jpg';

let config = { publicBaseUrl: '' };
let sel = { place: null, food: null, moment: null };
let currentSong = null;          // 서버의 곡 정보
let pollTimer = null;
let audioPlayer = null;
let viewingShared = false;       // QR/공유 링크로 들어온 경우

// ───────────────────────── 기기 저장값 (입장 코드 · 기기 ID · 이 기기에서 만든 노래) ─────────────────────────
const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 사생활 보호 모드 등 */ } }
};
let eventCode = params.get('code') || store.get('eventCode', '');
if (params.get('code')) store.set('eventCode', eventCode);
let deviceId = store.get('deviceId', '');
if (!deviceId) {
    deviceId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    store.set('deviceId', deviceId);
}
const mySongIds = () => store.get('mySongs', []);
const isMine = id => mySongIds().includes(id);
function rememberSong(id) {
    if (KIOSK) return;   // 부스 키오스크는 여러 사람이 쓰므로 저장하지 않음
    store.set('mySongs', [id, ...mySongIds().filter(x => x !== id)].slice(0, 30));
}

// ───────────────────────── 초기화 ─────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    document.body.classList.toggle('kiosk', KIOSK);
    renderChoiceGrid('place-grid', OPTIONS.places, 'place', place =>
        `<img src="${place.image}" alt=""><h3>${esc(place.name)}</h3>`, 'place-card');
    renderChoiceGrid('food-grid', OPTIONS.foods, 'food', food =>
        `<i class="fa-solid ${food.icon}"></i><h3>${esc(food.name)}</h3><small>${esc(food.sound)}</small>`, 'emotion-card');
    renderChoiceGrid('moment-grid', OPTIONS.moments, 'moment', m =>
        `<i class="fa-solid ${m.icon}"></i><h3>${esc(m.name)}</h3>`, 'emotion-card');

    try { config = await (await fetch('/api/config')).json(); } catch (e) { /* 기본값 사용 */ }

    // /s/:id (QR 주소) 또는 예전 방식 ?songId= 로 들어온 경우
    const shortMatch = location.pathname.match(/^\/s\/([a-z0-9]+)/i);
    const songId = shortMatch ? shortMatch[1] : params.get('songId');
    if (songId) {
        viewingShared = true;
        await openSong(songId);
    }
    if (KIOSK) setupIdleReset();
});

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const findOpt = (list, id) => list.find(o => o.id === id) || null;
const songUrl = id => `${config.publicBaseUrl || location.origin}/s/${id}`;

// ───────────────────────── 화면 전환 ─────────────────────────
function nextStep(step) {
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    const target = $(step === 0 ? 'step-intro' : `step-${step}`);
    if (target) target.classList.add('active');
    $('app-container').scrollTop = 0;
}

function setBg(image) {
    $('bg-container').style.backgroundImage = `url('/${image || DEFAULT_BG}')`;
}

function startFlow() {
    const pin = $('user-pin').value.trim();
    if (pin && !/^\d{4}$/.test(pin)) {
        $('intro-error').textContent = '연락처 뒤 4자리는 숫자 4개로 입력해주세요.';
        return;
    }
    $('intro-error').textContent = '';
    if (config.requireCode && !eventCode && !KIOSK) {
        $('code-gate').hidden = false;
        return;
    }
    nextStep(1);
}

async function submitCode() {
    const code = $('code-input').value.trim();
    if (!code) return;
    const res = await (await fetch('/api/check-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
    })).json();
    if (!res.ok) {
        $('intro-error').textContent = '참여 코드가 맞지 않아요. 안내판을 다시 확인해주세요.';
        return;
    }
    eventCode = code;
    store.set('eventCode', code);
    $('code-gate').hidden = true;
    startFlow();
}

function renderChoiceGrid(gridId, list, key, template, cardClass) {
    const grid = $(gridId);
    grid.innerHTML = '';
    const stepNo = { place: 1, food: 2, moment: 3 }[key];
    list.forEach(item => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = cardClass;
        card.innerHTML = template(item);
        card.onclick = () => {
            sel[key] = item;
            grid.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
            card.classList.add('selected');
            $(`btn-step-${stepNo}`).disabled = false;
            if (key === 'place') setBg(item.image);
        };
        grid.appendChild(card);
    });
}

function comboChips(placeName, foodName, momentName) {
    const chips = [];
    if (placeName) chips.push(`<span><i class="fa-solid fa-location-dot"></i>${esc(placeName)}</span>`);
    if (foodName) chips.push(`<span><i class="fa-solid fa-utensils"></i>${esc(foodName)}</span>`);
    if (momentName) chips.push(`<span><i class="fa-solid fa-wand-magic-sparkles"></i>${esc(momentName)}</span>`);
    return chips.join('');
}

// 서버 곡 정보 → 화면에 필요한 이름·이미지 (예전 버전 곡도 처리)
function describe(song) {
    const place = findOpt(OPTIONS.places, song.placeId) || OPTIONS.places.find(p => p.name === song.place);
    const food = findOpt(OPTIONS.foods, song.foodId);
    const moment = findOpt(OPTIONS.moments, song.momentId);
    return {
        image: place ? place.image : DEFAULT_BG,
        placeName: place ? place.name : song.place,
        foodName: food ? food.name : '',
        momentName: moment ? moment.name : song.emotion,
        title: song.title || '춘천의 노래'
    };
}

// ───────────────────────── 생성 ─────────────────────────
async function startGeneration() {
    if (!sel.place || !sel.food || !sel.moment) return;
    $('btn-step-3').disabled = true;
    try {
        const res = await fetch('/api/songs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nickname: $('user-nickname').value.trim(),
                pin: $('user-pin').value.trim(),
                placeId: sel.place.id, foodId: sel.food.id, momentId: sel.moment.id,
                code: eventCode, deviceId, kiosk: KIOSK
            })
        });
        const data = await res.json();
        if (data.code === 'EVENT_CODE') {
            eventCode = '';
            store.set('eventCode', '');
            nextStep(0);
            $('code-gate').hidden = false;
            $('intro-error').textContent = data.error;
            return;
        }
        if (!data.success) throw new Error(data.error || '요청 실패');
        rememberSong(data.songId);
        // 휴대폰에서 새로고침하거나 창을 닫았다 열어도 내 노래로 돌아오도록 주소를 바꿔 둠
        if (!KIOSK) history.replaceState({}, '', `/s/${data.songId}`);
        await openSong(data.songId);
    } catch (err) {
        console.error(err);
        alert(err.message || '노래 만들기 요청에 실패했어요. 잠시 후 다시 시도해주세요.');
        $('btn-step-3').disabled = false;
    }
}

/** 곡 ID로 화면 열기: 완성됐으면 플레이어, 아니면 대기 화면에서 자동 확인 */
async function openSong(songId) {
    stopPolling();
    try {
        const res = await fetch(`/api/song/${songId}`);
        const data = await res.json();
        if (!data.success) {
            alert('존재하지 않는 노래입니다.');
            history.replaceState({}, '', HOME_URL);
            return;
        }
        currentSong = data.song;
        const d = describe(currentSong);
        setBg(d.image);

        if (currentSong.status === 'completed') {
            showPlayer();
        } else {
            showWaiting(data.queuePosition);
            pollTimer = setTimeout(() => openSong(songId), 4000);
        }
    } catch (err) {
        console.error('곡 불러오기 실패:', err);
        pollTimer = setTimeout(() => openSong(songId), 6000);   // 네트워크 순간 끊김 대비
    }
}

function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
}

function showWaiting(queuePosition) {
    const d = describe(currentSong);
    const failed = currentSong.status === 'failed';
    $('wait-chips').innerHTML = comboChips(d.placeName, d.foodName, d.momentName);
    $('wait-title').textContent = failed ? '노래를 만들지 못했어요' : `「${d.title}」 만드는 중`;
    $('wait-status').textContent = failed
        ? '일시적인 문제일 수 있어요. 같은 선택으로 다시 시도할 수 있고, 이미 인쇄한 키링 QR도 그대로 쓸 수 있어요.'
        : (currentSong.status === 'queued' && queuePosition > 0
            ? `앞에 ${queuePosition - 1}명이 기다리고 있어요. 곧 시작합니다.`
            : '춘천의 풍경과 맛을 음악으로 엮는 중입니다. 보통 1~3분 걸려요.');
    $('wait-eq').hidden = failed;
    $('wait-actions').hidden = !failed;
    // 부스 키오스크: 바로 인쇄 / 방문객 휴대폰: 교환 번호를 보여주고 부스에서 인쇄
    $('wait-print-card').hidden = failed || !KIOSK;
    const showPickup = !KIOSK && isMine(currentSong.id) && !!currentSong.ticketNo;
    $('wait-pickup-card').hidden = !showPickup;
    $('wait-pickup-no').textContent = `No. ${currentSong.ticketNo}`;
    if (!$('step-4').classList.contains('active')) nextStep(4);
}

async function retryGeneration() {
    if (!currentSong) return;
    await fetch(`/api/song/${currentSong.id}/retry`, { method: 'POST' });
    openSong(currentSong.id);
}

// ───────────────────────── 플레이어 ─────────────────────────
function showPlayer() {
    const song = currentSong;
    const d = describe(song);
    $('album-cover').innerHTML = `<img src="/${d.image}" alt="">`;
    $('song-title').textContent = d.title;
    $('artist-name').textContent = `아티스트: ${song.nickname || '익명 관람객'}`;
    $('player-chips').innerHTML = comboChips(d.placeName, d.foodName, d.momentName);
    $('demo-badge').hidden = !song.demo;
    $('reset-btn').textContent = viewingShared && !isMine(song.id) ? '나도 만들기' : '다시 만들기';
    $('player-print-btn').hidden = !KIOSK;   // 인쇄는 부스 키오스크에서만
    const showPickup = !KIOSK && isMine(song.id) && !!song.ticketNo && !song.printed;
    $('player-pickup-card').hidden = !showPickup;
    $('player-pickup-no').textContent = `No. ${song.ticketNo}`;

    // 수노는 한 번에 2곡을 만들어 줌 → 버전 선택
    const toggle = $('version-toggle');
    if (song.tracks.length > 1) {
        toggle.hidden = false;
        toggle.innerHTML = song.tracks.map((t, i) =>
            `<button type="button" class="${i === song.selectedTrack ? 'active' : ''}" onclick="chooseTrack(${i})">버전 ${'AB'[i] || i + 1}</button>`
        ).join('');
    } else {
        toggle.hidden = true;
    }

    $('lyrics-body').innerHTML = (song.lyrics || '').split('\n').map(line => {
        const tag = line.match(/^\[(.+)\]$/);
        if (tag) return `<p class="lyric-tag">${esc(tag[1])}</p>`;
        return line ? `<p class="lyric-line">${esc(line)}</p>` : '';
    }).join('');

    loadTrack(song.selectedTrack || 0);
    drawQr($('qrcode'), songUrl(song.id), 150);
    nextStep(5);
    setTimeout(() => togglePlay(true), 400);
}

function loadTrack(idx) {
    if (audioPlayer) audioPlayer.pause();
    const track = currentSong.tracks[idx];
    audioPlayer = new Audio(track.audioUrl);
    audioPlayer.addEventListener('timeupdate', updateProgressUI);
    audioPlayer.addEventListener('loadedmetadata', updateProgressUI);
    audioPlayer.addEventListener('ended', () => setPlayingUI(false));
    setPlayingUI(false);
    updateProgressUI();
}

async function chooseTrack(idx) {
    currentSong.selectedTrack = idx;
    document.querySelectorAll('#version-toggle button').forEach((b, i) => b.classList.toggle('active', i === idx));
    loadTrack(idx);
    togglePlay(true);
    // QR로 들어왔을 때 이 버전이 먼저 나오도록 저장
    fetch(`/api/song/${currentSong.id}/select`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ track: idx })
    }).catch(() => {});
}

function setPlayingUI(playing) {
    $('play-btn').innerHTML = `<i class="fa-solid ${playing ? 'fa-pause' : 'fa-play'}"></i>`;
    $('album-cover').classList.toggle('playing', playing);
}

function togglePlay(forcePlay) {
    if (!audioPlayer) return;
    if (audioPlayer.paused || forcePlay === true) {
        audioPlayer.play().then(() => setPlayingUI(true)).catch(() => setPlayingUI(false)); // 자동재생 차단 대비
    } else {
        audioPlayer.pause();
        setPlayingUI(false);
    }
}

function skip(sec) {
    if (!audioPlayer) return;
    audioPlayer.currentTime = Math.max(0, Math.min(audioPlayer.duration || 0, audioPlayer.currentTime + sec));
}

const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function updateProgressUI() {
    if (!audioPlayer) return;
    const total = audioPlayer.duration || currentSong?.tracks?.[currentSong.selectedTrack]?.duration || 0;
    $('current-time').textContent = fmt(audioPlayer.currentTime || 0);
    $('total-time').textContent = fmt(total);
    $('progress-bar').style.width = total ? `${(audioPlayer.currentTime / total) * 100}%` : '0%';
}

function seek(e) {
    if (!audioPlayer || !audioPlayer.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audioPlayer.currentTime = ((e.clientX - rect.left) / rect.width) * audioPlayer.duration;
}

function drawQr(container, text, px) {
    container.innerHTML = '';
    if (typeof QRCode === 'undefined') return;
    // 크게 그린 뒤 CSS로 줄여야 인쇄 시 선명함. 로고가 없으므로 오류정정 M이면 충분하고 칸이 더 굵어짐
    new QRCode(container, { text, width: px, height: px, colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M });
}

// ───────────────────────── 보관함 · 내 앨범 ─────────────────────────
function renderSongList(gridId, list, emptyText) {
    const grid = $(gridId);
    if (!list.length) {
        grid.innerHTML = `<p class="empty">${esc(emptyText)}</p>`;
        return;
    }
    grid.innerHTML = '';
    list.forEach(song => {
        const d = describe(song);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'history-card';
        card.onclick = () => openSong(song.id);
        const statusTag = song.status === 'completed' ? '' :
            `<em class="status ${song.status}">${song.status === 'failed' ? '실패' : '만드는 중'}</em>`;
        card.innerHTML = `
            <img src="/${d.image}" alt="">
            <div class="history-info">
                <h4>${esc(d.title)} ${statusTag}</h4>
                <p>${esc(song.nickname || '익명')} · ${esc([d.placeName, d.foodName, d.momentName].filter(Boolean).join(' · '))}</p>
            </div>
            <i class="fa-solid fa-play"></i>`;
        grid.appendChild(card);
    });
}

async function openHistory() {
    stopPolling();
    nextStep('history');
    $('history-grid').innerHTML = '<p class="empty">불러오는 중…</p>';
    try {
        const data = await (await fetch('/api/songs')).json();
        renderSongList('history-grid', data.songs || [], '아직 만들어진 노래가 없어요.');
    } catch (err) {
        $('history-grid').innerHTML = '<p class="empty">보관함을 불러오지 못했어요.</p>';
    }
}

function openMyAlbum() {
    stopPolling();
    const nick = $('user-nickname').value.trim();
    const pin = $('user-pin').value.trim();
    if (nick) $('lookup-nickname').value = nick;
    if (pin) $('lookup-pin').value = pin;
    $('myalbum-grid').innerHTML = '';
    nextStep('myalbum');
    if (nick && /^\d{4}$/.test(pin)) lookupMyAlbum();
    else showDeviceSongs();
}

// 이 휴대폰에서 만든 노래 (PIN 없이도 보이도록)
async function showDeviceSongs() {
    const ids = mySongIds();
    if (!ids.length) {
        $('myalbum-grid').innerHTML = '<p class="empty">이 기기에서 만든 노래가 아직 없어요.</p>';
        return;
    }
    const results = await Promise.all(ids.map(id =>
        fetch(`/api/song/${id}`).then(r => r.ok ? r.json() : null).catch(() => null)));
    renderSongList('myalbum-grid', results.filter(r => r && r.success).map(r => r.song), '이 기기에서 만든 노래가 아직 없어요.');
}

async function lookupMyAlbum() {
    const nickname = $('lookup-nickname').value.trim();
    const pin = $('lookup-pin').value.trim();
    if (!nickname || !/^\d{4}$/.test(pin)) {
        $('myalbum-grid').innerHTML = '<p class="empty">닉네임과 숫자 4자리를 입력해주세요.</p>';
        return;
    }
    const data = await (await fetch('/api/my-songs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, pin })
    })).json();
    renderSongList('myalbum-grid', data.songs || [], '일치하는 노래가 없어요. 닉네임과 4자리를 확인해주세요.');
}

// ───────────────────────── 저장 · 공유 · 인쇄 ─────────────────────────
function downloadSong() {
    if (!currentSong) return;
    location.href = `/api/download/${currentSong.id}?track=${currentSong.selectedTrack || 0}`;
}

async function shareSong() {
    if (!currentSong) return;
    const url = songUrl(currentSong.id);
    const title = describe(currentSong).title;
    if (navigator.share) {
        try { await navigator.share({ title, text: '춘천에서 만든 나의 노래', url }); return; } catch (e) { /* 취소 */ }
    }
    try {
        await navigator.clipboard.writeText(url);
        alert(`🎵 링크가 복사되었습니다!\n${url}`);
    } catch (err) {
        prompt('아래 링크를 복사하세요', url);
    }
}

// CD 키링 속지 인쇄 (49 x 37 mm) — 노래가 완성되기 전에도 인쇄 가능
function printTicket() {
    if (!currentSong) return alert('출력할 노래 정보가 없습니다.');
    const d = describe(currentSong);
    $('print-cover').src = '/' + d.image;
    $('print-title').textContent = d.title;
    $('print-nickname').textContent = currentSong.nickname || 'CHUNCHEON';
    $('print-credit').textContent = [d.placeName, d.foodName, d.momentName].filter(Boolean).join(' · ');
    drawQr($('print-qrcode'), songUrl(currentSong.id), 240);

    const img = $('print-cover');
    const go = () => setTimeout(() => window.print(), 200);
    if (img.complete) go(); else img.onload = go;
}

// ───────────────────────── 초기화 ─────────────────────────
function resetApp() {
    stopPolling();
    if (audioPlayer) audioPlayer.pause();
    audioPlayer = null;
    currentSong = null;
    viewingShared = false;
    sel = { place: null, food: null, moment: null };
    history.pushState({}, '', HOME_URL);
    document.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    ['btn-step-1', 'btn-step-2', 'btn-step-3'].forEach(id => $(id).disabled = true);
    if (KIOSK) { $('user-nickname').value = ''; $('user-pin').value = ''; }
    setBg(DEFAULT_BG);
    nextStep(0);
}

function setupIdleReset() {
    let last = Date.now();
    ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => last = Date.now()));
    setInterval(() => {
        const onIntro = $('step-intro').classList.contains('active');
        const waiting = currentSong && currentSong.status !== 'completed' && currentSong.status !== 'failed';
        const playing = audioPlayer && !audioPlayer.paused;
        if (!onIntro && !waiting && !playing && Date.now() - last > 3 * 60 * 1000) resetApp();
    }, 10000);
}
