require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const { composeSong } = require('./public/options.js');

// ───────────────────────── 설정 ─────────────────────────
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SUNO_API_KEY || '';
const APIFRAME_BASE_URL = (process.env.APIFRAME_BASE_URL || 'https://api.apiframe.ai').replace(/\/$/, '');
const SUNO_MODEL_VERSION = process.env.SUNO_MODEL_VERSION || 'V5';
const DEMO_MODE = process.env.DEMO_MODE === '1';
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 3);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const GENERATION_TIMEOUT_MS = Number(process.env.GENERATION_TIMEOUT_MS || 10 * 60 * 1000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
// QR에 들어갈 공개 주소. Render는 RENDER_EXTERNAL_URL을 자동으로 넣어 줌
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '';
const PIN_SALT = process.env.PIN_SALT || 'chuncheon-music';
// 온라인 공개 시 남용 방지
const EVENT_CODE = (process.env.EVENT_CODE || '').trim().toUpperCase();   // 입장 QR에 들어가는 코드. 비우면 코드 없이 누구나 참여
const LIMIT_PER_DEVICE = Number(process.env.LIMIT_PER_DEVICE || 3);      // 기기당 하루 생성 수
const LIMIT_PER_IP_HOUR = Number(process.env.LIMIT_PER_IP_HOUR || 30);   // 같은 IP(행사장 와이파이 등) 시간당
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 500);              // 하루 전체 생성 수 (크레딧 보호)
// Render 등에서는 영구 디스크 경로(예: /var/data)를 지정해야 재배포 후에도 곡이 남습니다.
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DB_FILE = path.join(DATA_DIR, 'songs.json');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');

fs.mkdirSync(AUDIO_DIR, { recursive: true });

if (!API_KEY && !DEMO_MODE) {
    console.warn('⚠️  SUNO_API_KEY가 없습니다. 노래 생성 요청은 실패 처리됩니다. (시연용이면 DEMO_MODE=1)');
}

// ───────────────────────── 저장소 (JSON 파일) ─────────────────────────
let songs = {};
if (fs.existsSync(DB_FILE)) {
    songs = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} else {
    // 예전 버전(루트의 songs.json)에서 옮겨오기
    const legacy = path.join(__dirname, 'songs.json');
    if (fs.existsSync(legacy)) {
        songs = JSON.parse(fs.readFileSync(legacy, 'utf8'));
        console.log(`기존 songs.json에서 ${Object.keys(songs).length}곡을 가져왔습니다.`);
    }
}

function persist() {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(songs, null, 2));
    fs.renameSync(tmp, DB_FILE);
}

function updateSong(id, patch) {
    songs[id] = { ...songs[id], ...patch };
    persist();
    return songs[id];
}

function newSongId() {
    let id;
    do { id = crypto.randomBytes(4).toString('hex'); } while (songs[id]);
    return id;
}

function hashPin(nickname, pin) {
    return crypto.createHash('sha256').update(`${PIN_SALT}:${nickname}:${pin}`).digest('hex');
}

/** 외부에 보여줄 필드만 추린다 (PIN 해시, 작업 ID 등 제외) */
function publicSong(song) {
    return {
        id: song.id,
        nickname: song.nickname,
        placeId: song.placeId,
        foodId: song.foodId,
        momentId: song.momentId,
        // 예전 버전 곡 호환
        place: song.place, emotion: song.emotion,
        title: song.title,
        lyrics: song.lyrics,
        status: song.status,
        tracks: (song.tracks || []).map(t => ({ audioUrl: t.audioUrl, duration: t.duration })),
        selectedTrack: song.selectedTrack || 0,
        demo: !!song.demo,
        ticketNo: song.ticketNo || null,
        printed: !!song.printedAt,
        createdAt: song.createdAt,
        completedAt: song.completedAt
    };
}

// 예전 버전 곡(audioUrl 단일 필드)을 새 구조로 맞춤
for (const song of Object.values(songs)) {
    if (!song.status) {
        song.status = 'completed';
        song.tracks = song.audioUrl ? [{ audioUrl: song.audioUrl, duration: song.duration || 60 }] : [];
        song.title = song.title || `${(song.emotion || '').split(' ')[0]} ${song.place || ''}의 노래`.trim();
        song.legacy = true;
    }
}

// ───────────────────────── 생성 큐 ─────────────────────────
const queue = [];
let active = 0;

function enqueue(id) {
    if (!queue.includes(id)) queue.push(id);
    pump();
}

function pump() {
    while (active < MAX_CONCURRENT && queue.length) {
        const id = queue.shift();
        active++;
        runJob(id)
            .catch(err => {
                console.error(`[${id}] 생성 실패:`, err.message);
                updateSong(id, { status: 'failed', error: err.message });
            })
            .finally(() => { active--; pump(); });
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const apiHeaders = () => ({ 'X-API-Key': API_KEY, 'Content-Type': 'application/json' });

async function runJob(id) {
    const song = songs[id];
    if (DEMO_MODE) return runDemoJob(id);
    if (!API_KEY) throw new Error('SUNO_API_KEY가 설정되지 않았습니다.');

    let jobId = song.jobId;
    if (!jobId) {
        const res = await axios.post(`${APIFRAME_BASE_URL}/v2/music/generate`, {
            model: 'suno',
            prompt: song.lyrics,
            sunoParams: {
                custom_mode: true,           // prompt = 가사 그대로 사용
                title: song.title,
                style: song.style,
                model_version: SUNO_MODEL_VERSION
            }
        }, { headers: apiHeaders(), timeout: 20000 });
        jobId = res.data.id || res.data.jobId || res.data.job_id;
        if (!jobId) throw new Error('작업 ID를 받지 못했습니다: ' + JSON.stringify(res.data).slice(0, 200));
        updateSong(id, { status: 'generating', jobId, jobStartedAt: new Date().toISOString() });
        console.log(`[${id}] 생성 요청 완료 (job ${jobId})`);
    }

    const started = Date.parse(songs[id].jobStartedAt || songs[id].createdAt);
    while (true) {
        if (Date.now() - started > GENERATION_TIMEOUT_MS) throw new Error('생성 시간이 초과되었습니다.');
        await sleep(POLL_INTERVAL_MS);

        let data;
        try {
            const res = await axios.get(`${APIFRAME_BASE_URL}/v2/jobs/${jobId}`, { headers: apiHeaders(), timeout: 15000 });
            data = res.data;
        } catch (err) {
            console.warn(`[${id}] 상태 조회 일시 오류, 재시도:`, err.message);
            continue;
        }

        const status = String(data.status || '').toUpperCase();
        if (['FAILED', 'ERROR', 'CANCELLED'].includes(status)) {
            throw new Error(`생성 실패 (${status}): ${JSON.stringify(data.error || data.message || '').slice(0, 200)}`);
        }
        const tracks = extractTracks(data);
        if ((status === 'COMPLETED' || status === 'SUCCESS' || status === '') && tracks.length) {
            await finalize(id, tracks);
            return;
        }
        if (status === 'COMPLETED' && !tracks.length) throw new Error('완료되었지만 음원 주소가 없습니다.');
    }
}

/** 응답 형태가 조금 달라도 트랙 목록을 찾아낸다 */
function extractTracks(data) {
    const candidates = [data.tracks, data.result?.tracks, data.output?.tracks, data.result, data.data];
    for (const c of candidates) {
        const list = Array.isArray(c) ? c : null;
        if (list) {
            const tracks = list
                .map(t => ({ remoteUrl: t.audioUrl || t.audio_url || t.url, duration: t.duration }))
                .filter(t => t.remoteUrl);
            if (tracks.length) return tracks;
        }
    }
    const single = data.result?.audioUrl || data.result?.audio_url || data.audioUrl;
    return single ? [{ remoteUrl: single, duration: data.result?.duration }] : [];
}

/** 음원을 서버 디스크로 복사해 두고 완료 처리 (CDN 주소가 만료돼도 QR이 계속 작동하도록) */
async function finalize(id, tracks) {
    const saved = [];
    for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        const file = `${id}-${i}.mp3`;
        let audioUrl = t.remoteUrl;
        try {
            const res = await axios.get(t.remoteUrl, { responseType: 'arraybuffer', timeout: 60000 });
            fs.writeFileSync(path.join(AUDIO_DIR, file), Buffer.from(res.data));
            audioUrl = `/media/${file}`;
        } catch (err) {
            console.warn(`[${id}] 음원 보관 실패, 원격 주소 사용:`, err.message);
        }
        saved.push({ audioUrl, remoteUrl: t.remoteUrl, duration: Math.round(t.duration || 0) || null });
    }
    updateSong(id, { status: 'completed', tracks: saved, completedAt: new Date().toISOString(), error: null });
    console.log(`[${id}] 완료 — 트랙 ${saved.length}개`);
}

// 시연용: 몇 초 뒤 짧은 신호음 곡으로 완료 처리 (실제 음원 아님이 화면에 표시됨)
async function runDemoJob(id) {
    updateSong(id, { status: 'generating', jobStartedAt: new Date().toISOString() });
    await sleep(Number(process.env.DEMO_DELAY_MS || 8000));
    const file = `${id}-0.wav`;
    fs.writeFileSync(path.join(AUDIO_DIR, file), makeDemoWav(songs[id]));
    updateSong(id, {
        status: 'completed', demo: true, completedAt: new Date().toISOString(),
        tracks: [{ audioUrl: `/media/${file}`, duration: 12 }]
    });
}

function makeDemoWav(song) {
    const rate = 22050, seconds = 12, n = rate * seconds;
    const seed = [...(song.placeId + song.foodId + song.momentId)].reduce((a, c) => a + c.charCodeAt(0), 0);
    const scale = [261.6, 293.7, 329.6, 392.0, 440.0, 523.3];
    const buf = Buffer.alloc(44 + n * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
    const noteLen = rate / 2;
    for (let i = 0; i < n; i++) {
        const note = Math.floor(i / noteLen);
        const f = scale[(seed * (note + 1) * 7) % scale.length];
        const env = Math.min(1, (i % noteLen) / 400) * Math.exp(-3 * (i % noteLen) / noteLen);
        buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * f * i / rate) * env * 9000), 44 + i * 2);
    }
    return buf;
}

// 서버 재시작 시 끝나지 않은 작업 이어서 처리
for (const song of Object.values(songs)) {
    if (song.status === 'queued' || song.status === 'generating') enqueue(song.id);
}

// ───────────────────────── 웹 서버 ─────────────────────────
const app = express();
app.set('trust proxy', 1);   // Render 등 프록시 뒤에서 방문객 실제 IP 사용
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));   // songs.json·서버 코드는 외부에 노출되지 않음
app.use('/media', express.static(AUDIO_DIR, { maxAge: '30d' }));

const clean = (v, max) => String(v || '').trim().slice(0, max);
const kstDay = iso => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);

// 생성 제한 확인용 기록 (메모리) — 서버 재시작 시 초기화되지만 일일 총량은 저장된 곡으로 계산
const ipLog = new Map();      // ip → [timestamps]

function checkLimits(req, deviceId, isKiosk) {
    const today = kstDay(new Date().toISOString());
    const todays = Object.values(songs).filter(s => s.createdAt && kstDay(s.createdAt) === today && !s.legacy);
    if (todays.length >= DAILY_LIMIT) return '오늘 준비한 노래가 모두 소진되었어요. 내일 다시 찾아주세요!';

    if (!isKiosk && deviceId) {
        const mine = todays.filter(s => s.deviceId === deviceId).length;
        if (mine >= LIMIT_PER_DEVICE) return `노래는 한 사람당 하루 ${LIMIT_PER_DEVICE}곡까지 만들 수 있어요.`;
    }
    const now = Date.now();
    const hits = (ipLog.get(req.ip) || []).filter(t => now - t < 3600e3);
    if (hits.length >= LIMIT_PER_IP_HOUR) return '지금 요청이 많아요. 잠시 후 다시 시도해주세요.';
    hits.push(now);
    ipLog.set(req.ip, hits);
    return null;
}

function nextTicketNo() {
    const max = Object.values(songs).reduce((m, s) => Math.max(m, s.ticketNo || 0), 0);
    return max + 1;
}

// 0. 화면 설정 — QR에 넣을 공개 주소 (키오스크를 localhost로 돌려도 QR은 공개 주소를 가리키도록)
app.get('/api/config', (req, res) => {
    res.json({
        publicBaseUrl: (PUBLIC_BASE_URL || '').replace(/\/$/, ''),
        demo: DEMO_MODE,
        requireCode: !!EVENT_CODE,
        limitPerDevice: LIMIT_PER_DEVICE
    });
});

// 입장 코드 확인 (화면에서 미리 안내하기 위함)
app.post('/api/check-code', (req, res) => {
    res.json({ ok: !EVENT_CODE || clean(req.body?.code, 32).toUpperCase() === EVENT_CODE });
});

// 1. 노래 만들기 — ID를 즉시 발급하고 생성은 백그라운드로 진행
app.post('/api/songs', (req, res) => {
    const { placeId, foodId, momentId } = req.body || {};
    const composed = composeSong(placeId, foodId, momentId);
    if (!composed) return res.status(400).json({ success: false, error: '선택값이 올바르지 않습니다.' });

    if (EVENT_CODE && clean(req.body.code, 32).toUpperCase() !== EVENT_CODE) {
        return res.status(403).json({ success: false, code: 'EVENT_CODE', error: '행사장에 있는 QR 코드를 스캔해서 들어와 주세요.' });
    }
    const deviceId = clean(req.body.deviceId, 64) || null;
    const limitError = checkLimits(req, deviceId, !!req.body.kiosk);
    if (limitError) return res.status(429).json({ success: false, code: 'LIMIT', error: limitError });

    const nickname = clean(req.body.nickname, 10) || '익명 관람객';
    const pin = clean(req.body.pin, 4);
    if (pin && !/^\d{4}$/.test(pin)) return res.status(400).json({ success: false, error: '연락처 뒤 4자리는 숫자 4개로 입력해주세요.' });

    const id = newSongId();
    songs[id] = {
        id, nickname,
        ticketNo: nextTicketNo(),
        deviceId, source: req.body.kiosk ? 'kiosk' : 'mobile',
        pinHash: pin ? hashPin(nickname, pin) : null,
        placeId, foodId, momentId,
        place: composed.place.name, food: composed.food.name, moment: composed.moment.name,
        title: composed.title, lyrics: composed.lyrics, style: composed.style,
        status: 'queued', tracks: [], selectedTrack: 0,
        createdAt: new Date().toISOString()
    };
    persist();
    enqueue(id);
    console.log(`[${id}] 접수: ${nickname} / ${composed.place.name} · ${composed.food.name} · ${composed.moment.name}`);
    res.json({ success: true, songId: id, queuePosition: queue.indexOf(id) + 1 });
});

// 2. 노래 조회 (QR·공유 링크·대기 화면 폴링)
app.get('/api/song/:id', (req, res) => {
    const song = songs[req.params.id];
    if (!song) return res.status(404).json({ success: false, error: 'Song not found' });
    res.json({ success: true, song: publicSong(song), queuePosition: queue.indexOf(song.id) + 1 });
});

// 3. 두 버전 중 대표곡 선택 (수노는 요청 1번에 2곡 생성)
app.post('/api/song/:id/select', (req, res) => {
    const song = songs[req.params.id];
    const idx = Number(req.body?.track);
    if (!song || !song.tracks?.[idx]) return res.status(400).json({ success: false });
    updateSong(song.id, { selectedTrack: idx });
    res.json({ success: true });
});

// 4. 실패한 곡 다시 생성 (같은 ID 유지 → 이미 인쇄한 QR도 그대로 사용)
app.post('/api/song/:id/retry', (req, res) => {
    const song = songs[req.params.id];
    if (!song || song.status !== 'failed') return res.status(400).json({ success: false });
    updateSong(song.id, { status: 'queued', jobId: null, jobStartedAt: null, error: null });
    enqueue(song.id);
    res.json({ success: true });
});

// 5. 전체 보관함 (완료된 곡만, 최신순)
app.get('/api/songs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 60, 200);
    const list = Object.values(songs)
        .filter(s => s.status === 'completed')
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, limit)
        .map(publicSong);
    res.json({ success: true, songs: list });
});

// 6. 내 앨범 (닉네임 + 연락처 뒤 4자리)
app.post('/api/my-songs', (req, res) => {
    const nickname = clean(req.body?.nickname, 10);
    const pin = clean(req.body?.pin, 4);
    if (!nickname || !/^\d{4}$/.test(pin)) return res.status(400).json({ success: false, error: '닉네임과 4자리 숫자를 입력해주세요.' });
    const h = hashPin(nickname, pin);
    const list = Object.values(songs)
        .filter(s => s.pinHash === h)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map(publicSong);
    res.json({ success: true, songs: list });
});

// 7. 음원 다운로드
app.get('/api/download/:id', async (req, res) => {
    const song = songs[req.params.id];
    const idx = req.query.track !== undefined ? Number(req.query.track) : (song?.selectedTrack || 0);
    const track = song?.tracks?.[idx];
    if (!track) return res.status(404).send('Song not found');

    const ext = track.audioUrl.endsWith('.wav') ? 'wav' : 'mp3';
    const filename = encodeURIComponent(`${song.title || song.id}.${ext}`);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);

    if (track.audioUrl.startsWith('/media/')) {
        return res.sendFile(path.join(AUDIO_DIR, path.basename(track.audioUrl)));
    }
    try {
        const upstream = await axios.get(track.audioUrl, { responseType: 'stream' });
        res.setHeader('Content-Type', 'audio/mpeg');
        upstream.data.pipe(res);
    } catch (err) {
        console.error('다운로드 프록시 오류:', err.message);
        res.status(502).send('Failed to download audio file');
    }
});

// 8. 운영자: 통계 · CSV (ADMIN_TOKEN 필요)
function requireAdmin(req, res, next) {
    const token = req.get('X-Admin-Token') || req.query.token;
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) return res.status(401).json({ success: false, error: 'unauthorized' });
    next();
}

app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const all = Object.values(songs).filter(s => !s.legacy);
    const count = key => all.reduce((m, s) => (m[s[key]] = (m[s[key]] || 0) + 1, m), {});
    const byDay = all.reduce((m, s) => {
        const day = new Date(Date.parse(s.createdAt) + 9 * 3600e3).toISOString().slice(0, 10); // KST
        m[day] = (m[day] || 0) + 1; return m;
    }, {});
    const combos = all.reduce((m, s) => { const k = `${s.place} · ${s.food} · ${s.moment}`; m[k] = (m[k] || 0) + 1; return m; }, {});
    const durations = all.filter(s => s.completedAt && s.jobStartedAt)
        .map(s => (Date.parse(s.completedAt) - Date.parse(s.jobStartedAt)) / 1000);
    res.json({
        success: true,
        total: all.length,
        status: count('status'),
        uniqueParticipants: new Set(all.map(s => s.pinHash || s.deviceId).filter(Boolean)).size,
        sources: count('source'),
        printed: all.filter(s => s.printedAt).length,
        places: count('place'), foods: count('food'), moments: count('moment'),
        byDay,
        topCombos: Object.entries(combos).sort((a, b) => b[1] - a[1]).slice(0, 10),
        avgGenerationSec: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
        queueLength: queue.length, active,
        recent: all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 30)
            .map(s => ({ id: s.id, nickname: s.nickname, title: s.title, place: s.place, food: s.food, moment: s.moment, status: s.status, error: s.error, createdAt: s.createdAt }))
    });
});

app.get('/api/admin/export.csv', requireAdmin, (req, res) => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['교환번호', 'id', '생성시각', '닉네임', '장소', '미식', '순간', '제목', '상태', '생성소요(초)', '참여방식', '키링인쇄', 'URL']];
    const base = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    for (const s of Object.values(songs).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
        const secs = s.completedAt && s.jobStartedAt ? Math.round((Date.parse(s.completedAt) - Date.parse(s.jobStartedAt)) / 1000) : '';
        rows.push([s.ticketNo || '', s.id, s.createdAt, s.nickname, s.place, s.food || '', s.moment || s.emotion || '', s.title, s.status, secs, s.source || '', s.printedAt ? 'Y' : '', `${base}/s/${s.id}`]);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="songs-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + rows.map(r => r.map(esc).join(',')).join('\n'));
});

// 9. 부스 스태프: 키링 교환 목록 · 인쇄 표시 · 포스터용 입장 주소 (ADMIN_TOKEN 필요)
app.get('/api/booth/songs', requireAdmin, (req, res) => {
    const list = Object.values(songs)
        .filter(s => !s.legacy)
        .sort((a, b) => (b.ticketNo || 0) - (a.ticketNo || 0))
        .slice(0, Math.min(Number(req.query.limit) || 80, 300))
        .map(s => ({ ...publicSong(s), printedAt: s.printedAt || null, source: s.source || null }));
    res.json({ success: true, songs: list });
});

app.post('/api/booth/:id/printed', requireAdmin, (req, res) => {
    const song = songs[req.params.id];
    if (!song) return res.status(404).json({ success: false });
    updateSong(song.id, { printedAt: new Date().toISOString(), printCount: (song.printCount || 0) + 1 });
    res.json({ success: true });
});

app.get('/api/booth/entry', requireAdmin, (req, res) => {
    const base = (PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    res.json({ success: true, entryUrl: EVENT_CODE ? `${base}/?code=${encodeURIComponent(EVENT_CODE)}` : `${base}/` });
});

// 10. QR용 짧은 주소: /s/:id → 앱이 열리고 해당 곡을 보여줌
app.get('/s/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/booth', (req, res) => res.sendFile(path.join(__dirname, 'public', 'booth.html')));

app.listen(PORT, () => {
    console.log('========================================');
    console.log('🎧 춘천 관광·미식 음악 체험 서버가 켜졌습니다!');
    console.log(`👉 http://localhost:${PORT}`);
    console.log(`   데이터 폴더: ${DATA_DIR}${DEMO_MODE ? '  (DEMO_MODE)' : ''}`);
    console.log('========================================');
});
