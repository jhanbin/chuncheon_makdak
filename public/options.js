/*
 * 춘천 관광·미식 음악 체험 — 선택지 데이터 (화면과 서버가 함께 사용)
 *
 * 3단계 × 9가지 = 729가지 조합
 *   ① 장소  → 가사 1절(Verse) + 앨범 커버
 *   ② 미식  → 장르·사운드(style) + 가사 브리지(Pre-Chorus)
 *   ③ 순간  → 무드·보컬(style) + 후렴(Chorus) + 곡 제목 수식어
 *
 * 문구를 고칠 때는 이 파일만 수정하면 됩니다.
 * style 값은 수노에 그대로 들어가므로 영어 태그로 적습니다.
 */
(function (root) {
    const OPTIONS = {
        places: [
            {
                id: 'kimyoujeong', name: '김유정문학촌',
                image: 'assets/kimyoujeong_village_1785911963974.jpg',
                lyric: ['점순이가 닭싸움 붙이던 그 봄날처럼', '노란 동백꽃 향기가 알싸하게 번져와']
            },
            {
                id: 'soyanggang', name: '소양강 스카이워크',
                image: 'assets/soyanggang_river_1785911954588.jpg',
                lyric: ['노을 번지는 소양강 유리길 위에서', '발아래 강물이 반짝이며 인사해']
            },
            {
                id: 'nami', name: '남이섬',
                image: 'assets/nami_island_1785911972656.jpg',
                lyric: ['첫눈 내리던 메타세쿼이아 숲길에서', '우리의 계절은 이야기로 남아']
            },
            {
                id: 'gongjicheon', name: '공지천',
                image: 'assets/gongjicheon_1785911982114.jpg',
                lyric: ['공지천 물결 위로 노을이 내려앉으면', '오리배에 실린 웃음이 둥실 떠가']
            },
            {
                id: 'uiamho', name: '의암호 호수길',
                image: 'assets/uiamho_lake_1785994431415.jpg',
                lyric: ['물안개 피어오르는 고요한 의암호', '잊고 있던 작은 꿈이 다시 숨을 쉬어']
            },
            {
                id: 'cheongpyeongsa', name: '청평사',
                image: 'assets/cheongpyeongsa_1789668227903.jpg',
                lyric: ['푸른 바람 스쳐가는 청평사 숲길', '풍경 소리에 무거운 마음 내려놓아']
            },
            {
                id: 'gubongsan', name: '구봉산 카페거리',
                image: 'assets/gubongsan_1789668245178.jpg',
                lyric: ['구봉산 언덕 위 반짝이는 도시 불빛', '따뜻한 창가에서 추억 한 장 넘겨']
            },
            {
                id: 'samaksan', name: '삼악산 케이블카',
                image: 'assets/samaksan_1789668255785.jpg',
                lyric: ['호수 위를 건너는 삼악산 케이블카', '구름 사이로 춘천이 한눈에 담겨']
            },
            {
                id: 'pungmul', name: '풍물시장',
                image: 'assets/pungmul_market_1789668266498.jpg',
                lyric: ['정이 넘치는 풍물시장 골목길', '오가는 웃음소리가 노래처럼 울려']
            }
        ],

        foods: [
            {
                id: 'dakgalbi', name: '철판닭갈비', icon: 'fa-fire-burner', sound: '지글지글 댄스팝',
                style: 'upbeat K-pop dance, punchy drums, sizzling percussion, bright synth',
                lyric: ['지글지글 철판 위에 빨간 닭갈비', '둘러앉은 우리 마음도 뜨겁게 익어가']
            },
            {
                id: 'sutbul', name: '숯불닭갈비', icon: 'fa-fire', sound: '스모키 재즈 블루스',
                style: 'smoky jazz blues, upright bass, brushed drums, saxophone, slow swing',
                lyric: ['숯불 향이 밤공기에 번져가면', '느린 박자로 오늘이 익어가']
            },
            {
                id: 'mulmak', name: '물막국수', icon: 'fa-bowl-food', sound: '청량한 신스팝',
                style: 'refreshing synth-pop, airy pads, crisp beat, summery',
                lyric: ['살얼음 동동 뜬 시원한 막국수', '한 모금에 더위가 싹 씻겨가']
            },
            {
                id: 'bibim', name: '비빔막국수', icon: 'fa-pepper-hot', sound: '매콤한 펑크 & 브라스',
                style: 'funky groove, slap bass, brass section, energetic',
                lyric: ['새콤달콤 매콤하게 비벼낸 하루', '입안 가득 터지는 신나는 리듬']
            },
            {
                id: 'gamja', name: '감자빵', icon: 'fa-bread-slice', sound: '포근한 어쿠스틱 로파이',
                style: 'cozy acoustic lo-fi, soft guitar, warm tape texture, mellow',
                lyric: ['갓 구운 감자빵 호호 불어가며', '포슬포슬 웃음이 입가에 번져']
            },
            {
                id: 'corn', name: '찰옥수수', icon: 'fa-seedling', sound: '통통 튀는 시티팝',
                style: 'city pop, groovy bass, retro 80s keys, bouncy',
                lyric: ['톡톡 터지는 찰옥수수 한 알 한 알', '여름날 추억이 알알이 박혀']
            },
            {
                id: 'jeonbyeong', name: '메밀전병', icon: 'fa-utensils', sound: '소박한 포크',
                style: 'folk, acoustic guitar, harmonica, gentle and homely',
                lyric: ['고소한 메밀전병 돌돌 말아서', '소박한 행복을 한입 베어 물어']
            },
            {
                id: 'coffee', name: '호숫가 커피', icon: 'fa-mug-hot', sound: '느긋한 보사노바',
                style: 'bossa nova, nylon guitar, soft percussion, relaxed cafe',
                lyric: ['호수가 보이는 창가 커피 한 잔', '느긋한 오후가 천천히 흘러가']
            },
            {
                id: 'beer', name: '수제맥주', icon: 'fa-beer-mug-empty', sound: '신나는 인디록',
                style: 'indie rock, jangly electric guitars, driving drums, anthemic',
                lyric: ['시원하게 부딪히는 수제맥주 잔', '청춘이란 이름으로 건배를 외쳐']
            }
        ],

        moments: [
            {
                id: 'date', name: '설레는 데이트', icon: 'fa-heart', adj: '설레는',
                mood: 'romantic, sweet, fluttering, duet vocals',
                chorus: ['너와 걷는 이 길이 참 좋아', '춘천의 오늘을 오래 기억할게']
            },
            {
                id: 'family', name: '가족 나들이', icon: 'fa-people-group', adj: '다정한',
                mood: 'warm, heartfelt, family-friendly, gentle vocals',
                chorus: ['손 꼭 잡은 우리 가족 웃음소리', '이 순간이 가장 큰 선물이야']
            },
            {
                id: 'friends', name: '친구와의 여행', icon: 'fa-user-group', adj: '신나는',
                mood: 'joyful, carefree, sing-along chorus, group vocals',
                chorus: ['우리 함께라면 어디든 좋아', '춘천에서 다시 만나자 약속해']
            },
            {
                id: 'solo', name: '혼자만의 힐링', icon: 'fa-spa', adj: '고요한',
                mood: 'calm, healing, intimate, soft vocals',
                chorus: ['천천히 쉬어가도 괜찮아', '오늘의 나에게 수고했다 말해']
            },
            {
                id: 'mist', name: '새벽 물안개', icon: 'fa-cloud', adj: '몽환적인',
                mood: 'dreamy, ethereal, reverb-heavy, airy vocals',
                chorus: ['물안개 속에 꿈을 걸어두고', '조용히 새 아침을 기다려']
            },
            {
                id: 'sunset', name: '노을 산책', icon: 'fa-sun', adj: '노을빛',
                mood: 'nostalgic, golden hour, warm, mellow vocals',
                chorus: ['붉게 물든 하늘 아래 걸으며', '저무는 오늘이 아쉬워']
            },
            {
                id: 'rain', name: '비 오는 날', icon: 'fa-cloud-rain', adj: '촉촉한',
                mood: 'melancholic, rainy mood, piano, emotional vocals',
                chorus: ['창밖에 비가 내려도 좋아', '빗소리마저 노래가 되니까']
            },
            {
                id: 'festival', name: '축제의 밤', icon: 'fa-star', adj: '반짝이는',
                mood: 'festive, euphoric, big chorus, crowd energy',
                chorus: ['불빛 가득한 축제의 밤에', '모두 함께 이 노래를 불러']
            },
            {
                id: 'memory', name: '그리운 추억', icon: 'fa-camera-retro', adj: '그리운',
                mood: 'sentimental, nostalgic ballad, heartfelt vocals',
                chorus: ['언젠가 다시 이곳에 오면', '오늘의 우리를 떠올려 줘']
            }
        ]
    };

    function find(list, id) {
        return list.find(item => item.id === id) || null;
    }

    /** 선택 3개(id)로 제목·가사·스타일을 만든다. 잘못된 id면 null. */
    function composeSong(placeId, foodId, momentId) {
        const place = find(OPTIONS.places, placeId);
        const food = find(OPTIONS.foods, foodId);
        const moment = find(OPTIONS.moments, momentId);
        if (!place || !food || !moment) return null;

        const title = `${moment.adj} ${place.name}`;
        const lyrics = [
            '[Verse]',
            ...place.lyric,
            '',
            '[Pre-Chorus]',
            ...food.lyric,
            '',
            '[Chorus]',
            ...moment.chorus,
            `춘천, ${place.name}에서`,
            `${moment.adj} 노래를 불러`,
            '',
            '[Outro]',
            `${place.name}, 춘천`
        ].join('\n');
        const style = `${food.style}, ${moment.mood}, Korean lyrics, short song`;

        return { place, food, moment, title, lyrics, style };
    }

    const api = { OPTIONS, composeSong };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ChuncheonMusic = api;
})(typeof window !== 'undefined' ? window : globalThis);
