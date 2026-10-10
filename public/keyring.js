/*
 * CD 키링 인쇄 — 키오스크 화면(index.html)과 부스 화면(booth.html)이 함께 사용
 *
 * 한 장에 두 조각을 나란히 인쇄합니다.
 *   ① 앞면 커버  41 x 40 mm — 장소 사진 + 곡 제목 + 아티스트 (앨범 커버)
 *   ② 뒷면 속지  49 x 37 mm — 크레딧 + 다시 듣기 QR
 *
 * 크기를 바꿀 때는 style.css 맨 아래 "CD 키링 인쇄" 부분의 mm 값만 고치면 됩니다.
 */
(function (root) {
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function drawQr(el, text) {
        el.innerHTML = '';
        if (typeof QRCode === 'undefined') return;
        // 크게 그린 뒤 CSS로 줄여야 인쇄가 선명함
        new QRCode(el, { text, width: 240, height: 240, colorDark: '#000', colorLight: '#fff', correctLevel: QRCode.CorrectLevel.M });
    }

    /**
     * info: { image, title, nickname, place, food, moment, ticketNo, url }
     * 인쇄 영역을 채운 뒤, 사진이 다 불러와지면 Promise가 끝남
     */
    function render(info) {
        const box = document.getElementById('print-ticket');
        const credit = [info.place, info.food, info.moment].filter(Boolean).join(' · ');
        const kicker = [info.food, info.moment].filter(Boolean).join(' · ');
        const no = info.ticketNo ? `No.${info.ticketNo}` : '';
        box.innerHTML = `
            <div class="print-piece">
                <div class="cd-front-cover">
                    <img class="front-img" src="${esc(info.image)}" alt="">
                    <div class="front-top"><span>CHUNCHEON</span><span>${esc(no)}</span></div>
                    <div class="front-bottom">
                        <span class="front-kicker">${esc(kicker)}</span>
                        <b class="front-title">${esc(info.title)}</b>
                        <span class="front-artist">by ${esc(info.nickname || '익명 관람객')}</span>
                    </div>
                </div>
                <div class="cut-guide-label">✂ 앞면 커버 41 x 40 mm</div>
            </div>
            <div class="print-piece">
                <div class="cd-keychain-insert">
                    <div class="cd-cover-box">
                        <img src="${esc(info.image)}" alt="">
                        <span class="cd-cover-title">${esc(info.title)}</span>
                    </div>
                    <div class="cd-info-box">
                        <div class="cd-title-area">
                            <span class="brand-tag">${esc(info.nickname || 'CHUNCHEON')}</span>
                            <span class="cd-credit">${esc(credit)}</span>
                        </div>
                        <div class="cd-qr-area">
                            <div class="print-qrcode"></div>
                            <span class="qr-label">SCAN TO LISTEN</span>
                        </div>
                    </div>
                </div>
                <div class="cut-guide-label">✂ 뒷면 속지 49 x 37 mm</div>
            </div>`;
        drawQr(box.querySelector('.print-qrcode'), info.url);

        const imgs = [...box.querySelectorAll('img')];
        return Promise.all(imgs.map(img => img.complete ? null :
            new Promise(r => { img.onload = img.onerror = r; })));
    }

    /** 채우고 → 사진 로딩 대기 → 인쇄 창 */
    async function print(info) {
        await render(info);
        await new Promise(r => setTimeout(r, 200));
        window.print();
    }

    root.Keyring = { render, print };
})(window);
