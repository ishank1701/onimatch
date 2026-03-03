/* ============================================
   ONIMATCH V3 — Fully Static, Multi-API
   AniList + Jikan + Kitsu (No AI / No Server)
   ============================================ */

const ANILIST_URL = "https://graphql.anilist.co";
const JIKAN_URL = "https://api.jikan.moe/v4";
const KITSU_URL = "https://kitsu.io/api/edge";

// ============================================
// JIKAN (MyAnimeList) HELPERS
// ============================================
async function searchAnimeJikan(query) {
    try {
        const res = await fetch(`${JIKAN_URL}/anime?q=${encodeURIComponent(query)}&limit=5&sfw=true`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.data || []).map(a => ({
            title: a.title_english || a.title,
            coverImage: a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || null,
            malId: a.mal_id,
            episodes: a.episodes,
            score: a.score,
            genres: (a.genres || []).map(g => g.name)
        }));
    } catch { return []; }
}

// ============================================
// KITSU HELPERS
// ============================================
async function searchAnimeKitsu(query) {
    try {
        const res = await fetch(`${KITSU_URL}/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=5`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.data || []).map(a => ({
            title: a.attributes.titles?.en || a.attributes.canonicalTitle,
            coverImage: a.attributes.posterImage?.large || a.attributes.posterImage?.original || null,
            kitsuId: a.id,
            episodes: a.attributes.episodeCount,
            score: a.attributes.averageRating ? (parseFloat(a.attributes.averageRating) / 10).toFixed(1) : null
        }));
    } catch { return []; }
}

// Multi-API cover image fallback
async function fetchCoverFallback(anime) {
    if (anime.coverImage) return;
    // Try Jikan
    try {
        const jResults = await searchAnimeJikan(anime.title);
        if (jResults.length > 0 && jResults[0].coverImage) {
            anime.coverImage = jResults[0].coverImage;
            return;
        }
    } catch { }
    // Try Kitsu
    try {
        const kResults = await searchAnimeKitsu(anime.title);
        if (kResults.length > 0 && kResults[0].coverImage) {
            anime.coverImage = kResults[0].coverImage;
            return;
        }
    } catch { }
}

// ============================================
// ANILIST GRAPHQL HELPERS
// ============================================
async function anilistQuery(query, variables = {}) {
    const res = await fetch(ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query, variables })
    });
    if (!res.ok) throw new Error(`AniList API error ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0]?.message || "AniList query failed");
    return json.data;
}

async function searchAnimeAniList(searchQuery) {
    const query = `
        query ($search: String) {
            Page(perPage: 6) {
                media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
                    id
                    title { romaji english }
                    coverImage { large extraLarge }
                    format
                    seasonYear
                    averageScore
                    episodes
                    genres
                    description(asHtml: false)
                }
            }
        }
    `;
    const data = await anilistQuery(query, { search: searchQuery });
    return data.Page.media;
}

async function fetchSimilarAniList(animeId) {
    const query = `
        query ($id: Int) {
            Media(id: $id, type: ANIME) {
                recommendations(sort: RATING_DESC, perPage: 50) {
                    nodes {
                        rating
                        mediaRecommendation {
                            id
                            title { romaji english }
                            coverImage { large extraLarge }
                            format
                            seasonYear
                            averageScore
                            episodes
                            genres
                            description(asHtml: false)
                            meanScore
                        }
                    }
                }
            }
        }
    `;
    const data = await anilistQuery(query, { id: animeId });
    return data.Media.recommendations.nodes
        .filter(n => n.mediaRecommendation)
        .map(n => {
            const m = n.mediaRecommendation;
            const cleanDesc = m.description ? m.description.replace(/<[^>]*>/g, '').substring(0, 150) : '';
            return {
                title: m.title.english || m.title.romaji,
                synopsis: cleanDesc || "No description available.",
                episodes: m.episodes ? `${m.episodes} eps` : m.format || "?",
                rating: m.averageScore ? (m.averageScore / 10).toFixed(1) : "N/A",
                genres: m.genres || [],
                why: `Recommended by ${n.rating > 0 ? n.rating : 'the'} AniList ${n.rating > 0 ? 'users' : 'community'}`,
                coverImage: m.coverImage?.extraLarge || m.coverImage?.large || null,
                anilistId: m.id
            };
        });
}

async function fetchAnimeDetailsAniList(title) {
    const query = `
        query ($search: String) {
            Media(search: $search, type: ANIME) {
                id
                title { romaji english native }
                description(asHtml: false)
                coverImage { extraLarge large }
                bannerImage
                trailer { id site thumbnail }
                episodes
                duration
                format
                status
                seasonYear
                season
                averageScore
                meanScore
                popularity
                genres
                studios(isMain: true) { nodes { name } }
                source
                startDate { year month day }
                endDate { year month day }
            }
        }
    `;
    const data = await anilistQuery(query, { search: title });
    return data.Media;
}

async function fetchCoverImagesAniList(animeList) {
    const promises = animeList.map(async (anime, i) => {
        if (anime.coverImage) return; // Already has cover
        try {
            await new Promise(r => setTimeout(r, i * 200)); // Gentle stagger
            const results = await searchAnimeAniList(anime.title);
            if (results.length > 0) {
                anime.coverImage = results[0].coverImage?.extraLarge || results[0].coverImage?.large || null;
            }
        } catch (e) { /* silent */ }
    });
    await Promise.all(promises);
}

// ============================================
// QUIZ DATA
// ============================================
const QUIZ_STEPS = [
    {
        question: "What's your current mood?",
        key: "mood",
        multi: true,
        choices: [
            { label: "Heartbroken & Emotional", desc: "Need something to cry over", examples: "Your Lie in April, Clannad, Anohana" },
            { label: "Hyped & Energetic", desc: "Ready for adrenaline-pumping action", examples: "My Hero Academia, Demon Slayer, Jujutsu Kaisen" },
            { label: "Cozy & Relaxed", desc: "Want something warm and comforting", examples: "Yuru Camp, Barakamon, March Comes in Like a Lion" },
            { label: "Existential & Thoughtful", desc: "In the mood for deep, mind-bending stories", examples: "Serial Experiments Lain, Evangelion, Monster" },
            { label: "Want to Laugh", desc: "Just here for comedy and good vibes", examples: "Gintama, KonoSuba, Grand Blue" },
            { label: "Feeling Adventurous", desc: "Ready to explore new worlds", examples: "One Piece, Made in Abyss, Frieren" },
            { label: "Spicy & Frisky 🔥", desc: "In the mood for something steamy & bold", examples: "High School DxD, Prison School, Food Wars" },
            { label: "Dark & Vengeful 🗡️", desc: "Craving revenge arcs and anti-heroes", examples: "Vinland Saga, Berserk, Redo of Healer" }
        ]
    },
    {
        question: "Pick your genres",
        key: "genre",
        multi: true,
        choices: [
            { label: "Action / Shonen", desc: "Epic battles, rivalries, and power-ups" },
            { label: "Romance", desc: "Love stories, heartfelt connections" },
            { label: "Horror / Thriller", desc: "Chills, suspense, and dark twists" },
            { label: "Fantasy / Isekai", desc: "Magic worlds, reincarnation, epic quests" },
            { label: "Sci-Fi / Mecha", desc: "Futuristic tech, space, giant robots" },
            { label: "Slice of Life", desc: "Everyday stories with heart and beauty" },
            { label: "Psychological", desc: "Mind games, complex characters" },
            { label: "Sports", desc: "Competition, teamwork, pushing limits" },
            { label: "Supernatural", desc: "Ghosts, demons, otherworldly powers" },
            { label: "Mystery / Detective", desc: "Whodunnits, puzzles, investigations" },
            { label: "Historical / Military", desc: "Wars, samurai, historical drama" },
            { label: "Comedy", desc: "Pure laughs and absurd situations" },
            { label: "Adult / Ecchi", desc: "Mature content, fan service, 18+ themes" },
            { label: "Music", desc: "Bands, idols, the power of song" },
            { label: "Harem / Reverse Harem", desc: "One protagonist, many love interests" },
            { label: "Seinen / Josei", desc: "Mature storytelling for older audiences" }
        ]
    },
    {
        question: "How much time do you want to invest?",
        key: "episodes",
        multi: false,
        choices: [
            { label: "Movie or OVA", desc: "A single sitting — under 3 hours" },
            { label: "Short Series", desc: "Under 13 episodes — quick binge" },
            { label: "One Season (12-26 eps)", desc: "A solid weekend watch" },
            { label: "Two Seasons (26-52 eps)", desc: "A week-long journey" },
            { label: "Long Series (50-100+ eps)", desc: "A month-long adventure" },
            { label: "Ongoing Epic", desc: "I want to live in this world forever" }
        ]
    },
    {
        question: "What theme resonates with you?",
        key: "theme",
        multi: true,
        choices: [
            { label: "Redemption & Second Chances", desc: "Characters finding their way back" },
            { label: "Revenge & Justice", desc: "Payback and righting wrongs" },
            { label: "Friendship & Bonds", desc: "The power of connection and nakama" },
            { label: "Dark & Gritty", desc: "No sugarcoating — raw and brutal" },
            { label: "Growth & Self-Discovery", desc: "Coming-of-age and finding yourself" },
            { label: "Mystery & Plot Twists", desc: "Mind-blowing reveals" },
            { label: "Love & Relationships", desc: "Romance at the core" },
            { label: "Survival & Strategy", desc: "Outsmart opponents to stay alive" }
        ]
    },
    {
        question: "What's your anime experience level?",
        key: "experience",
        multi: false,
        choices: [
            { label: "Complete Beginner", desc: "Just starting my anime journey" },
            { label: "Casual Watcher", desc: "Seen the popular ones, want more" },
            { label: "Seasoned Fan", desc: "Deep into anime culture" },
            { label: "I've Seen Everything", desc: "Challenge me with something obscure" }
        ]
    }
];

// ============================================
// STATE
// ============================================
let currentStep = 0;
let selections = [];          // Array of arrays for multi-select
let loadingInterval = null;
let allRecommendations = [];
let currentPage = 1;
const PER_PAGE = 10;
let activeTab = "quiz";       // "quiz" or "similar"
let selectedAnime = null;     // For similar search
let searchDebounce = null;
let currentMode = "quiz";     // Track which mode generated results

// ============================================
// DOM REFS
// ============================================
const quizContainer = document.getElementById("quiz-container");
const quizStep = document.getElementById("quiz-step");
const progressWrapper = document.getElementById("progress-wrapper");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");
const progressPct = document.getElementById("progress-pct");
const loadingContainer = document.getElementById("loading-container");
const resultsContainer = document.getElementById("results-container");
const resultsGrid = document.getElementById("results-grid");
const resultsCount = document.getElementById("results-count");
const paginationEl = document.getElementById("pagination");
const errorContainer = document.getElementById("error-container");
const errorText = document.getElementById("error-text");
const btnTryAgain = document.getElementById("btn-try-again");
const btnRetry = document.getElementById("btn-retry");
const runner = document.getElementById("runner");
const loadingProgressFill = document.getElementById("loading-progress-fill");
const btnBack = document.getElementById("btn-back");
const btnNext = document.getElementById("btn-next");

// Tabs
const tabQuiz = document.getElementById("tab-quiz");
const tabSimilar = document.getElementById("tab-similar");
const sectionQuiz = document.getElementById("section-quiz");
const sectionSimilar = document.getElementById("section-similar");

// Search
const searchInput = document.getElementById("anime-search-input");
const autocompleteDropdown = document.getElementById("autocomplete-dropdown");
const btnFindSimilar = document.getElementById("btn-find-similar");

// Robot
const robot = document.getElementById("robot");
const pupilLeft = document.getElementById("pupil-left");
const pupilRight = document.getElementById("pupil-right");
const speechText = document.getElementById("speech-text");

// ============================================
// TAB SWITCHING & NAVIGATION
// ============================================
const homeSection = document.getElementById("home-section");

function goHome() {
    // Show home section
    homeSection.style.display = '';
    document.getElementById('features-section').style.display = '';
    document.querySelector('.site-footer').style.display = '';
    // Hide quiz/similar/results/loading/error
    document.getElementById('tab-bar').classList.add('hidden');
    sectionQuiz.classList.remove('active');
    sectionSimilar.classList.remove('active');
    loadingContainer.classList.add('hidden');
    resultsContainer.classList.add('hidden');
    errorContainer.classList.add('hidden');
    document.body.style.overflow = '';
    // Reset quiz
    currentStep = 0;
    selections = Array(QUIZ_STEPS.length).fill(null);
    renderStep(0);
    clearSelectedAnime();
    setRobotExpression('idle');
    speechText.textContent = "Hey! Ready to find your next anime? 🏴\u200d☠️";
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchTab(tab) {
    activeTab = tab;
    // Hide home, show tab bar
    homeSection.style.display = 'none';
    document.getElementById('features-section').style.display = 'none';
    document.querySelector('.site-footer').style.display = 'none';
    document.getElementById('tab-bar').classList.remove('hidden');
    // Toggle tab buttons
    tabQuiz.classList.toggle("active", tab === "quiz");
    tabSimilar.classList.toggle("active", tab === "similar");
    // Toggle sections
    sectionQuiz.classList.toggle("active", tab === "quiz");
    sectionSimilar.classList.toggle("active", tab === "similar");
    // Hide shared panels
    loadingContainer.classList.add("hidden");
    resultsContainer.classList.add("hidden");
    errorContainer.classList.add("hidden");
    // Re-render quiz step when switching to quiz
    if (tab === "quiz") {
        renderStep(currentStep);
        setRobotExpression("idle");
        speechText.textContent = "Let's find your match! 🎯";
    } else {
        setRobotExpression("happy");
        speechText.textContent = "Type an anime you love! 🔍";
    }
}

tabQuiz.addEventListener("click", () => switchTab("quiz"));
tabSimilar.addEventListener("click", () => switchTab("similar"));

// Home button + logo click → go home
document.getElementById("btn-home").addEventListener("click", goHome);
document.querySelector(".hero-logo").addEventListener("click", goHome);
document.querySelector(".hero-logo").style.cursor = "pointer";

// CTA buttons
document.getElementById("btn-cta-quiz").addEventListener("click", () => switchTab("quiz"));
document.getElementById("btn-cta-similar").addEventListener("click", () => switchTab("similar"));

// ============================================
// HOMEPAGE DATA LOADING
// ============================================
const STUDIOS = [
    { name: "Studio Ghibli", id: 21 },
    { name: "MAPPA", id: 569 },
    { name: "ufotable", id: 43 },
    { name: "Wit Studio", id: 858 },
    { name: "Bones", id: 4 },
    { name: "Madhouse", id: 11 },
    { name: "Kyoto Animation", id: 2 },
    { name: "A-1 Pictures", id: 6 },
    { name: "Toei Animation", id: 18 },
    { name: "Sunrise", id: 14 }
];

function renderHomeCard(anime) {
    const title = anime.title?.english || anime.title?.romaji || '';
    const cover = anime.coverImage?.extraLarge || anime.coverImage?.large || '';
    const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : '';
    const eps = anime.episodes ? `${anime.episodes} ep` : anime.format || '';
    return `<div class="home-card" onclick="openAnimeDetail(null, '${escapeHTML(title).replace(/'/g, "\\'")}', ${anime.id})">
        <img src="${cover}" alt="${escapeHTML(title)}" loading="lazy">
        <div class="home-card-info">
            <div class="home-card-title">${escapeHTML(title)}</div>
            <div class="home-card-meta">${score ? '⭐ ' + score : ''} ${eps ? '• ' + eps : ''}</div>
        </div>
    </div>`;
}

async function loadHomeSection() {
    // Top Anime
    try {
        const topQuery = `query {
            Page(perPage: 25) {
                media(type: ANIME, sort: SCORE_DESC, isAdult: false) {
                    id title { romaji english } coverImage { large extraLarge }
                    averageScore episodes format
                }
            }
        }`;
        const topData = await anilistQuery(topQuery);
        const topEl = document.getElementById('home-top-anime');
        if (topData.Page?.media) {
            topEl.innerHTML = topData.Page.media.map(renderHomeCard).join('');
        }
    } catch (e) { console.warn("Failed to load top anime:", e); }

    // Currently Airing
    try {
        const airingQuery = `query {
            Page(perPage: 25) {
                media(type: ANIME, status: RELEASING, sort: POPULARITY_DESC, isAdult: false) {
                    id title { romaji english } coverImage { large extraLarge }
                    averageScore episodes format
                }
            }
        }`;
        const airingData = await anilistQuery(airingQuery);
        const airingEl = document.getElementById('home-airing');
        if (airingData.Page?.media) {
            airingEl.innerHTML = airingData.Page.media.map(renderHomeCard).join('');
        }
    } catch (e) { console.warn("Failed to load airing:", e); }

    // Top Upcoming
    try {
        const upcomingQuery = `query {
            Page(perPage: 25) {
                media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC, isAdult: false) {
                    id title { romaji english } coverImage { large extraLarge }
                    averageScore episodes format
                }
            }
        }`;
        const upcomingData = await anilistQuery(upcomingQuery);
        const upcomingEl = document.getElementById('home-upcoming');
        if (upcomingData.Page?.media) {
            upcomingEl.innerHTML = upcomingData.Page.media.map(renderHomeCard).join('');
        }
    } catch (e) { console.warn("Failed to load upcoming:", e); }

    // Studio Collections
    const studioGrid = document.getElementById('studio-grid');
    studioGrid.innerHTML = STUDIOS.map(s => `
        <div class="studio-card" onclick="loadStudioAnime(${s.id}, '${s.name}')">
            <span class="studio-name">${s.name}</span>
            <span class="studio-arrow">→</span>
        </div>
    `).join('');
}

async function loadStudioAnime(studioId, studioName) {
    const studioGrid = document.getElementById('studio-grid');
    // Show loading
    studioGrid.innerHTML = `<div class="studio-loading">Loading ${studioName} anime...</div>`;
    try {
        const query = `query ($studioId: Int) {
            Studio(id: $studioId) {
                media(sort: FAVOURITES_DESC, isMain: true) {
                    nodes {
                        id title { romaji english } coverImage { large extraLarge }
                        averageScore episodes format
                    }
                }
            }
        }`;
        const data = await anilistQuery(query, { studioId });
        const animes = data.Studio?.media?.nodes || [];
        const top = animes.slice(0, 25);
        studioGrid.innerHTML = `
            <button class="studio-back-btn" onclick="resetStudioGrid()">← Back to Studios</button>
            <h4 class="studio-selected-name">${studioName}</h4>
            <div class="home-scroll">${top.map(renderHomeCard).join('')}</div>
        `;
    } catch (e) {
        studioGrid.innerHTML = `<p style="color:var(--text-muted)">Failed to load. <button onclick="resetStudioGrid()">Back</button></p>`;
    }
}

function resetStudioGrid() {
    const studioGrid = document.getElementById('studio-grid');
    studioGrid.innerHTML = STUDIOS.map(s => `
        <div class="studio-card" onclick="loadStudioAnime(${s.id}, '${s.name}')">
            <span class="studio-name">${s.name}</span>
            <span class="studio-arrow">→</span>
        </div>
    `).join('');
}

// Load homepage on start
loadHomeSection();

// ============================================
// ROBOT - Eye Tracking & Expressions
// ============================================
document.addEventListener("mousemove", (e) => {
    if (!pupilLeft || !pupilRight) return;
    const eyeLeft = document.getElementById("eye-left");
    const eyeRight = document.getElementById("eye-right");
    if (!eyeLeft || !eyeRight) return;

    [{ eye: eyeLeft, pupil: pupilLeft }, { eye: eyeRight, pupil: pupilRight }].forEach(({ eye, pupil }) => {
        const rect = eye.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const angle = Math.atan2(dy, dx);
        const dist = Math.min(Math.sqrt(dx * dx + dy * dy) / 30, 4);
        pupil.style.transform = `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px))`;
    });
});

const ROBOT_EXPRESSIONS = {
    idle: { cls: '', msg: "Hey nakama! Pick your vibe! 🏴‍☠️" },
    excited: { cls: 'excited', msg: "Great picks! 🔥" },
    happy: { cls: 'happy', msg: "Nice choice! 😄" },
    thinking: { cls: 'thinking', msg: "Hmm, processing... 🤔" },
    sad: { cls: 'sad', msg: "Oh no... 😢" },
    searching: { cls: 'thinking', msg: "Scanning anime database... 🔍" },
    party: { cls: 'excited', msg: "Found your matches! 🎉" }
};

function setRobotExpression(expr) {
    if (!robot) return;
    const e = ROBOT_EXPRESSIONS[expr] || ROBOT_EXPRESSIONS.idle;
    robot.className = 'robot';
    if (e.cls) robot.classList.add(e.cls);
    if (speechText) speechText.textContent = e.msg;
}

// ============================================
// QUIZ — Multi-Select
// ============================================
function renderStep(stepIndex) {
    const step = QUIZ_STEPS[stepIndex];
    const pct = Math.round(((stepIndex + 1) / QUIZ_STEPS.length) * 100);
    progressFill.style.width = pct + "%";
    progressLabel.textContent = `Step ${stepIndex + 1} of ${QUIZ_STEPS.length}`;
    progressPct.textContent = pct + "%";

    const hint = step.multi ? '<p class="selection-hint">Select one or more options</p>' : '<p class="selection-hint">Select one option</p>';

    quizStep.innerHTML = `
        <h2 class="question-text">${step.question}</h2>
        ${hint}
        <div class="choices-grid">${step.choices.map((c, i) => `
            <button class="choice-card" data-index="${i}" id="choice-${stepIndex}-${i}">
                <span class="choice-label">${c.label}</span>
                <span class="choice-desc">${c.desc}</span>
                ${c.examples ? `<span class="choice-examples">e.g. ${c.examples}</span>` : ""}
            </button>
        `).join("")}</div>
    `;

    // Restore previous selections
    if (selections[stepIndex]) {
        const prev = selections[stepIndex];
        quizStep.querySelectorAll(".choice-card").forEach(card => {
            const idx = parseInt(card.dataset.index);
            if (Array.isArray(prev) ? prev.includes(idx) : prev === idx) {
                card.classList.add("selected");
            }
        });
    }

    quizStep.style.animation = "none";
    requestAnimationFrame(() => { quizStep.style.animation = ""; });

    // Bind clicks
    quizStep.querySelectorAll(".choice-card").forEach(card => {
        card.addEventListener("click", () => handleChoice(card, stepIndex, step.multi));
    });

    // Update nav buttons
    btnBack.classList.toggle("hidden", stepIndex === 0);
    updateNextButton(stepIndex);
}

function handleChoice(card, stepIndex, isMulti) {
    if (isMulti) {
        card.classList.toggle("selected");
        // Collect all selected indices
        const selectedIndices = [];
        quizStep.querySelectorAll(".choice-card.selected").forEach(c => {
            selectedIndices.push(parseInt(c.dataset.index));
        });
        selections[stepIndex] = selectedIndices;
    } else {
        quizStep.querySelectorAll(".choice-card").forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        selections[stepIndex] = parseInt(card.dataset.index);
    }

    // Robot reacts
    setRobotExpression(Math.random() > 0.5 ? "excited" : "happy");
    setTimeout(() => setRobotExpression("idle"), 2000);

    updateNextButton(stepIndex);
}

function updateNextButton(stepIndex) {
    const sel = selections[stepIndex];
    const hasSelection = Array.isArray(sel) ? sel.length > 0 : sel !== undefined;
    btnNext.disabled = !hasSelection;
    btnNext.textContent = stepIndex === QUIZ_STEPS.length - 1 ? "Get Recommendations →" : "Next →";
}

// Quiz nav
btnBack.addEventListener("click", () => {
    if (currentStep > 0) {
        currentStep--;
        renderStep(currentStep);
    }
});

btnNext.addEventListener("click", () => {
    if (currentStep < QUIZ_STEPS.length - 1) {
        currentStep++;
        renderStep(currentStep);
    } else {
        submitQuiz();
    }
});

// ============================================
// LOADING ANIMATION
// ============================================
function startRunnerAnimation() {
    let progress = 0;
    loadingInterval = setInterval(() => {
        if (progress < 70) progress += 1.5;
        else if (progress < 90) progress += 0.2;
        updateRunnerPosition(progress);
    }, 100);
}
function updateRunnerPosition(pct) {
    const c = Math.min(pct, 100);
    runner.style.left = c + "%";
    loadingProgressFill.style.width = c + "%";
}
function completeRunnerAnimation() {
    clearInterval(loadingInterval);
    let cur = parseFloat(runner.style.left) || 0;
    const finish = setInterval(() => {
        cur += 3; if (cur >= 100) { cur = 100; clearInterval(finish); }
        updateRunnerPosition(cur);
    }, 30);
}
function stopRunnerAnimation() { clearInterval(loadingInterval); }

// ============================================
// QUIZ SUBMIT — AniList Powered (No AI needed!)
// ============================================

// Map quiz choices to AniList filters
const MOOD_TO_TAGS = {
    0: ["Tragedy", "Emotional", "Romance"],
    1: ["Shounen", "Super Power", "Battle Royale"],
    2: ["Iyashikei", "Countryside", "Cute Girls Doing Cute Things"],
    3: ["Philosophy", "Surreal", "Dystopia"],
    4: ["Parody", "Satire", "Slapstick"],
    5: ["Isekai", "Travel", "Cultivation"],
    6: ["Ecchi", "Harem", "Female Harem"],
    7: ["Revenge", "Anti-Hero", "Villainess"]
};

const MOOD_TO_GENRES = {
    0: ["Drama", "Romance"],
    1: ["Action"],
    2: ["Slice of Life"],
    3: ["Psychological", "Sci-Fi"],
    4: ["Comedy"],
    5: ["Adventure", "Fantasy"],
    6: ["Ecchi", "Romance"],
    7: ["Action", "Drama"]
};

const GENRE_MAP = {
    0: ["Action"],
    1: ["Romance"],
    2: ["Horror", "Thriller"],
    3: ["Fantasy"],
    4: ["Sci-Fi", "Mecha"],
    5: ["Slice of Life"],
    6: ["Psychological"],
    7: ["Sports"],
    8: ["Supernatural"],
    9: ["Mystery"],
    10: ["Action", "Drama"],
    11: ["Comedy"],
    12: ["Ecchi"],
    13: ["Music"],
    14: ["Romance", "Comedy"],
    15: ["Drama"]
};

const THEME_TO_TAGS = {
    0: ["Redemption", "Atonement"],
    1: ["Revenge", "Warfare"],
    2: ["Friendship", "Ensemble Cast", "Teams"],
    3: ["Gore", "Seinen", "Violence"],
    4: ["Coming of Age", "Youth"],
    5: ["Conspiracy", "Plot Twist", "Mind Games"],
    6: ["Love Triangle", "Couples", "Romance"],
    7: ["Survival", "Strategy Game", "War"]
};

async function submitQuiz() {
    currentMode = "quiz";
    document.getElementById("tab-bar").style.display = "none";
    sectionQuiz.classList.remove("active");
    loadingContainer.classList.remove("hidden");
    startRunnerAnimation();
    setRobotExpression("searching");

    try {
        const moodSel = selections[0];
        const genreSel = selections[1];
        const epsSel = selections[2];
        const themeSel = selections[3];
        const expSel = selections[4];

        // Build genre filter
        let genres = new Set();
        if (Array.isArray(moodSel)) moodSel.forEach(i => (MOOD_TO_GENRES[i] || []).forEach(g => genres.add(g)));
        if (Array.isArray(genreSel)) genreSel.forEach(i => (GENRE_MAP[i] || []).forEach(g => genres.add(g)));
        genres = [...genres];

        // Build tag filter
        let tags = [];
        if (Array.isArray(moodSel)) moodSel.forEach(i => tags.push(...(MOOD_TO_TAGS[i] || [])));
        if (Array.isArray(themeSel)) themeSel.forEach(i => tags.push(...(THEME_TO_TAGS[i] || [])));

        // Build episode/format filter
        let formatFilter = null, episodesGreater = null, episodesLesser = null;
        switch (epsSel) {
            case 0: formatFilter = "MOVIE"; break;
            case 1: episodesLesser = 13; break;
            case 2: episodesGreater = 11; episodesLesser = 27; break;
            case 3: episodesGreater = 25; episodesLesser = 53; break;
            case 4: episodesGreater = 49; episodesLesser = 150; break;
            case 5: episodesGreater = 100; break;
        }

        // Experience → sort order + minimum score
        let sortOrders, minScore;
        switch (expSel) {
            case 0: sortOrders = ["POPULARITY_DESC", "TRENDING_DESC", "SCORE_DESC"]; minScore = 65; break;
            case 1: sortOrders = ["SCORE_DESC", "TRENDING_DESC", "POPULARITY_DESC"]; minScore = 68; break;
            case 2: sortOrders = ["SCORE_DESC", "FAVOURITES_DESC", "TRENDING_DESC"]; minScore = 70; break;
            case 3: sortOrders = ["FAVOURITES_DESC", "SCORE_DESC", "TRENDING_DESC", "UPDATED_AT_DESC"]; minScore = 72; break;
            default: sortOrders = ["POPULARITY_DESC", "TRENDING_DESC"]; minScore = 65;
        }

        // Execute AniList queries
        const allResults = [];
        const seenIds = new Set();

        for (const sort of sortOrders) {
            const query = `
                query ($genres: [String], $tags: [String], $sort: [MediaSort], $format: MediaFormat,
                       $epsGreater: Int, $epsLesser: Int, $minScore: Int) {
                    Page(perPage: 50) {
                        media(type: ANIME, genre_in: $genres, tag_in: $tags, sort: [$sort],
                              format: $format, episodes_greater: $epsGreater, episodes_lesser: $epsLesser,
                              averageScore_greater: $minScore, isAdult: false) {
                            id
                            title { romaji english }
                            coverImage { large extraLarge }
                            format seasonYear averageScore episodes genres
                            description(asHtml: false)
                        }
                    }
                }
            `;
            const variables = {};
            if (genres.length > 0) variables.genres = genres;
            if (tags.length > 0) variables.tags = tags;
            variables.sort = sort;
            if (formatFilter) variables.format = formatFilter;
            if (episodesGreater !== null) variables.epsGreater = episodesGreater;
            if (episodesLesser !== null) variables.epsLesser = episodesLesser;
            if (minScore) variables.minScore = minScore;

            try {
                const data = await anilistQuery(query, variables);
                if (data.Page?.media) {
                    for (const m of data.Page.media) {
                        if (!seenIds.has(m.id)) {
                            seenIds.add(m.id);
                            const cleanDesc = m.description ? m.description.replace(/<[^>]*>/g, '').substring(0, 150) : '';
                            allResults.push({
                                title: m.title.english || m.title.romaji,
                                synopsis: cleanDesc || "No description available.",
                                episodes: m.episodes ? `${m.episodes} eps` : m.format || "?",
                                rating: m.averageScore ? (m.averageScore / 10).toFixed(1) : "N/A",
                                genres: m.genres || [],
                                why: `Matches your ${genres[0] || 'selected'} taste • ⭐ ${m.averageScore ? m.averageScore + '%' : 'N/A'} on AniList`,
                                coverImage: m.coverImage?.extraLarge || m.coverImage?.large || null,
                                anilistId: m.id
                            });
                        }
                    }
                }
            } catch (e) { console.warn("AniList query failed:", e.message); }
        }

        // Fallback: broader search if not enough results
        if (allResults.length < 10 && genres.length > 0) {
            try {
                const fallbackQuery = `
                    query ($genres: [String]) {
                        Page(perPage: 50) {
                            media(type: ANIME, genre_in: $genres, sort: [POPULARITY_DESC], isAdult: false) {
                                id title { romaji english }
                                coverImage { large extraLarge }
                                format seasonYear averageScore episodes genres
                                description(asHtml: false)
                            }
                        }
                    }
                `;
                const data = await anilistQuery(fallbackQuery, { genres });
                if (data.Page?.media) {
                    for (const m of data.Page.media) {
                        if (!seenIds.has(m.id)) {
                            seenIds.add(m.id);
                            const cleanDesc = m.description ? m.description.replace(/<[^>]*>/g, '').substring(0, 150) : '';
                            allResults.push({
                                title: m.title.english || m.title.romaji,
                                synopsis: cleanDesc || "No description available.",
                                episodes: m.episodes ? `${m.episodes} eps` : m.format || "?",
                                rating: m.averageScore ? (m.averageScore / 10).toFixed(1) : "N/A",
                                genres: m.genres || [],
                                why: `Popular ${genres[0] || ''} anime • ⭐ ${m.averageScore ? m.averageScore + '%' : 'N/A'} on AniList`,
                                coverImage: m.coverImage?.extraLarge || m.coverImage?.large || null,
                                anilistId: m.id
                            });
                        }
                    }
                }
            } catch (e) { console.warn("Fallback query failed:", e.message); }
        }

        if (allResults.length === 0) throw new Error("No anime found matching your preferences. Try different options!");

        allRecommendations = allResults;
        completeRunnerAnimation();
        await new Promise(r => setTimeout(r, 600));
        currentPage = 1;
        showResultsPage(1);
        setRobotExpression("party");
        setTimeout(() => setRobotExpression("idle"), 4000);

    } catch (err) {
        console.error("Quiz Error:", err);
        stopRunnerAnimation();
        setRobotExpression("sad");
        showError(err.message);
    }
}

// ============================================
// SIMILAR ANIME SEARCH
// ============================================
searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    const query = searchInput.value.trim();
    if (query.length < 2) {
        autocompleteDropdown.classList.add("hidden");
        return;
    }
    searchDebounce = setTimeout(() => searchAnimeForAutocomplete(query), 400);
});

// Close dropdown on click outside
document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-input-wrapper")) {
        autocompleteDropdown.classList.add("hidden");
    }
});

async function searchAnimeForAutocomplete(query) {
    try {
        const results = await searchAnimeAniList(query);
        if (!results || results.length === 0) {
            autocompleteDropdown.classList.add("hidden");
            return;
        }
        renderAutocomplete(results);
    } catch (e) { /* silent */ }
}

function renderAutocomplete(results) {
    autocompleteDropdown.innerHTML = results.map(anime => {
        const img = anime.coverImage?.large || '';
        const title = anime.title?.english || anime.title?.romaji || '';
        const year = anime.seasonYear || '';
        const type = anime.format || '';
        const score = anime.averageScore ? `⭐ ${(anime.averageScore / 10).toFixed(1)}` : '';
        const anilistId = anime.id;
        return `<div class="ac-item" data-title="${escapeHTML(title)}" data-img="${img}" data-type="${type}" data-year="${year}" data-score="${score}" data-id="${anilistId}">
            <img src="${img}" alt="" class="ac-img">
            <div class="ac-info">
                <div class="ac-title">${escapeHTML(title)}</div>
                <div class="ac-meta">${type} ${year ? '• ' + year : ''} ${score}</div>
            </div>
        </div>`;
    }).join("");

    autocompleteDropdown.classList.remove("hidden");

    autocompleteDropdown.querySelectorAll(".ac-item").forEach(item => {
        item.addEventListener("click", () => {
            selectAnimeFromSearch({
                title: item.dataset.title,
                img: item.dataset.img,
                type: item.dataset.type,
                year: item.dataset.year,
                score: item.dataset.score,
                anilistId: parseInt(item.dataset.id)
            });
        });
    });
}

function selectAnimeFromSearch(anime) {
    selectedAnime = anime;
    autocompleteDropdown.classList.add("hidden");
    searchInput.value = "";

    // Show selected card
    const wrapper = document.querySelector(".search-input-wrapper");
    const existingCard = document.querySelector(".selected-anime-card");
    if (existingCard) existingCard.remove();

    const card = document.createElement("div");
    card.className = "selected-anime-card";
    card.innerHTML = `
        <img src="${anime.img}" alt="${escapeHTML(anime.title)}">
        <div class="selected-anime-info">
            <div class="selected-anime-name">${escapeHTML(anime.title)}</div>
            <div class="selected-anime-type">${anime.type} ${anime.year ? '• ' + anime.year : ''} ${anime.score}</div>
        </div>
        <button class="btn-clear-anime" id="btn-clear-anime">✕</button>
    `;
    wrapper.parentElement.insertBefore(card, wrapper.nextSibling);

    // Hide search input
    wrapper.style.display = "none";
    btnFindSimilar.disabled = false;

    card.querySelector("#btn-clear-anime").addEventListener("click", clearSelectedAnime);

    setRobotExpression("happy");
    speechText.textContent = `${anime.title}! Great taste! 🎌`;
    setTimeout(() => setRobotExpression("idle"), 3000);
}

function clearSelectedAnime() {
    selectedAnime = null;
    const card = document.querySelector(".selected-anime-card");
    if (card) card.remove();
    document.querySelector(".search-input-wrapper").style.display = "block";
    btnFindSimilar.disabled = true;
}

btnFindSimilar.addEventListener("click", submitSimilar);

async function submitSimilar() {
    if (!selectedAnime) return;
    currentMode = "similar";
    document.getElementById("tab-bar").style.display = "none";
    sectionSimilar.classList.remove("active");
    loadingContainer.classList.remove("hidden");
    startRunnerAnimation();
    setRobotExpression("searching");

    try {
        // Use AniList native recommendations (no AI needed!)
        const recommendations = await fetchSimilarAniList(selectedAnime.anilistId);

        if (!recommendations || recommendations.length === 0) {
            throw new Error("No recommendations found for this anime.");
        }

        allRecommendations = recommendations;

        completeRunnerAnimation();
        await new Promise(r => setTimeout(r, 600));

        currentPage = 1;
        showResultsPage(1);
        setRobotExpression("party");
        setTimeout(() => setRobotExpression("idle"), 4000);

    } catch (err) {
        console.error("AniList Similar Error:", err);
        stopRunnerAnimation();
        setRobotExpression("sad");
        showError(err.message);
    }
}

// ============================================
// COVER IMAGES (handled by AniList helpers above)
// ============================================

// ============================================
// PAGINATION
// ============================================
function showResultsPage(page) {
    loadingContainer.classList.add("hidden");
    resultsContainer.classList.remove("hidden");
    const totalPages = Math.ceil(allRecommendations.length / PER_PAGE);
    currentPage = Math.max(1, Math.min(page, totalPages));
    const start = (currentPage - 1) * PER_PAGE;
    const pageItems = allRecommendations.slice(start, start + PER_PAGE);

    const titleText = currentMode === "similar" ? `Similar to "${selectedAnime?.title}"` : "Your Anime Matches";
    document.querySelector(".results-title").textContent = titleText;
    resultsCount.textContent = `${allRecommendations.length} anime found — Page ${currentPage} of ${totalPages}`;

    renderResults(pageItems, start);
    renderPagination(totalPages);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderPagination(totalPages) {
    if (totalPages <= 1) { paginationEl.innerHTML = ""; return; }
    let html = `<button class="page-btn nav-btn" ${currentPage === 1 ? "disabled" : ""} onclick="showResultsPage(${currentPage - 1})">← Prev</button>`;
    for (let p = 1; p <= totalPages; p++) {
        html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="showResultsPage(${p})">${p}</button>`;
    }
    html += `<button class="page-btn nav-btn" ${currentPage === totalPages ? "disabled" : ""} onclick="showResultsPage(${currentPage + 1})">Next →</button>`;
    paginationEl.innerHTML = html;
}

// ============================================
// RESULTS RENDERING
// ============================================
function renderResults(animeList, startIndex) {
    resultsGrid.innerHTML = animeList.map((anime, i) => {
        const rank = String(startIndex + i + 1).padStart(2, "0");
        const genrePills = (anime.genres || []).map(g => `<span class="genre-pill">${escapeHTML(g)}</span>`).join("");
        let diffClass = "difficulty-casual", diffLabel = anime.difficulty || "Casual";
        if (diffLabel.toLowerCase().includes("beginner")) diffClass = "difficulty-beginner";
        else if (diffLabel.toLowerCase().includes("veteran")) diffClass = "difficulty-veteran";
        const coverImg = anime.coverImage ? `<img src="${anime.coverImage}" alt="${escapeHTML(anime.title)}" class="result-cover" loading="lazy">` : `<div class="result-cover"></div>`;
        const globalIdx = startIndex + i;
        return `<div class="result-card" style="animation-delay:${i * 0.06}s" onclick="openAnimeDetail(${globalIdx})" role="button" tabindex="0">
            <div class="result-card-inner">${coverImg}<div class="result-info">
                <div class="result-rank-title"><span class="result-rank">${rank}</span><h3 class="result-title">${escapeHTML(anime.title)}</h3></div>
                <div class="result-meta">${genrePills}<span class="result-episodes">📺 ${escapeHTML(anime.episodes)}</span><span class="result-rating">⭐ ${anime.rating}/10</span></div>
                <p class="result-synopsis">${escapeHTML(anime.synopsis)}</p>
            </div></div>
            <div class="result-why">💬 ${escapeHTML(anime.why)}</div>
            <div class="result-footer"><span class="result-difficulty ${diffClass}">${escapeHTML(diffLabel)}</span><span class="result-detail-hint">Click for trailer & details →</span></div>
        </div>`;
    }).join("");
}

// ============================================
// ANIME DETAIL MODAL
// ============================================
async function openAnimeDetail(index) {
    const anime = allRecommendations[index];
    if (!anime) return;

    // Create modal if it doesn't exist
    let modal = document.getElementById('anime-detail-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'anime-detail-modal';
        modal.className = 'anime-modal-overlay';
        document.body.appendChild(modal);
    }

    // Show loading state
    modal.innerHTML = `
        <div class="anime-modal">
            <button class="modal-close" onclick="closeAnimeDetail()">✕</button>
            <div class="modal-loading">Loading details<span class="loading-dots"></span></div>
        </div>
    `;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    try {
        // Fetch full details from AniList
        const details = await fetchAnimeDetailsAniList(anime.title);

        const title = details.title?.english || details.title?.romaji || anime.title;
        const desc = details.description ? details.description.replace(/<[^>]*>/g, '') : anime.synopsis;
        const banner = details.bannerImage || details.coverImage?.extraLarge || anime.coverImage || '';
        const score = details.averageScore ? (details.averageScore / 10).toFixed(1) : anime.rating;
        const eps = details.episodes || anime.episodes;
        const format = details.format || '';
        const status = details.status ? details.status.replace(/_/g, ' ') : '';
        const year = details.seasonYear || '';
        const season = details.season ? details.season.charAt(0) + details.season.slice(1).toLowerCase() : '';
        const studio = details.studios?.nodes?.[0]?.name || '';
        const genres = details.genres || anime.genres || [];
        const popularity = details.popularity ? details.popularity.toLocaleString() : '';

        // Build trailer
        let trailerHTML = '';
        if (details.trailer && details.trailer.site === 'youtube') {
            trailerHTML = `
                <div class="modal-trailer">
                    <h3>🎬 Trailer</h3>
                    <div class="trailer-wrapper">
                        <iframe src="https://www.youtube.com/embed/${details.trailer.id}" 
                            frameborder="0" allowfullscreen
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture">
                        </iframe>
                    </div>
                </div>
            `;
        } else if (details.trailer && details.trailer.site === 'dailymotion') {
            trailerHTML = `
                <div class="modal-trailer">
                    <h3>🎬 Trailer</h3>
                    <div class="trailer-wrapper">
                        <iframe src="https://www.dailymotion.com/embed/video/${details.trailer.id}" 
                            frameborder="0" allowfullscreen>
                        </iframe>
                    </div>
                </div>
            `;
        } else {
            // Fallback: YouTube search link
            const ytSearchURL = `https://www.youtube.com/results?search_query=${encodeURIComponent(title + ' anime trailer')}`;
            trailerHTML = `
                <div class="modal-trailer">
                    <h3>🎬 Trailer</h3>
                    <a href="${ytSearchURL}" target="_blank" rel="noopener noreferrer" class="trailer-fallback-link">
                        ▶️ Watch Trailer on YouTube →
                    </a>
                </div>
            `;
        }

        const genrePills = genres.map(g => `<span class="genre-pill">${escapeHTML(g)}</span>`).join('');

        modal.innerHTML = `
            <div class="anime-modal">
                <button class="modal-close" onclick="closeAnimeDetail()">✕</button>
                ${banner ? `<div class="modal-banner"><img src="${banner}" alt="${escapeHTML(title)}"></div>` : ''}
                <div class="modal-content">
                    <h2 class="modal-title">${escapeHTML(title)}</h2>
                    <div class="modal-meta-row">
                        ${score !== 'N/A' ? `<span class="modal-score">⭐ ${score}/10</span>` : ''}
                        ${eps ? `<span class="modal-ep">📺 ${eps} episodes</span>` : ''}
                        ${format ? `<span class="modal-format">${format}</span>` : ''}
                        ${status ? `<span class="modal-status">${status}</span>` : ''}
                    </div>
                    <div class="modal-meta-row">
                        ${year ? `<span>📅 ${season} ${year}</span>` : ''}
                        ${studio ? `<span>🎨 ${studio}</span>` : ''}
                        ${popularity ? `<span>❤️ ${popularity} fans</span>` : ''}
                    </div>
                    <div class="modal-genres">${genrePills}</div>
                    ${trailerHTML}
                    <div class="modal-description">
                        <h3>📖 Description</h3>
                        <p>${escapeHTML(desc)}</p>
                    </div>
                </div>
            </div>
        `;

    } catch (err) {
        console.error('Detail fetch error:', err);
        // Fallback to what we already have
        modal.innerHTML = `
            <div class="anime-modal">
                <button class="modal-close" onclick="closeAnimeDetail()">✕</button>
                <div class="modal-content">
                    <h2 class="modal-title">${escapeHTML(anime.title)}</h2>
                    <div class="modal-meta-row">
                        <span class="modal-score">⭐ ${anime.rating}/10</span>
                        <span class="modal-ep">📺 ${anime.episodes}</span>
                    </div>
                    <div class="modal-genres">${(anime.genres || []).map(g => `<span class="genre-pill">${escapeHTML(g)}</span>`).join('')}</div>
                    <div class="modal-description">
                        <h3>📖 Description</h3>
                        <p>${escapeHTML(anime.synopsis)}</p>
                    </div>
                    <p style="color: var(--muted); margin-top: 1rem;">⚠️ Could not load trailer. Try again later.</p>
                </div>
            </div>
        `;
    }
}

function closeAnimeDetail() {
    const modal = document.getElementById('anime-detail-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Close modal on clicking outside or pressing Escape
document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'anime-detail-modal') {
        closeAnimeDetail();
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAnimeDetail();
});

// ============================================
// ERROR
// ============================================
function showError(msg) {
    loadingContainer.classList.add("hidden");
    errorContainer.classList.remove("hidden");
    let friendly = "We couldn't fetch your recommendations. Let's try again!";
    if (msg?.includes("429")) friendly = "API rate limit reached — wait a minute and try again.";
    else if (msg?.includes("403") || msg?.includes("401")) friendly = "API key issue.";
    else if (msg?.includes("Failed to fetch")) friendly = "Couldn't connect. Check your internet.";
    errorText.textContent = friendly;
}

// ============================================
// RESET
// ============================================
function resetAll() {
    currentStep = 0;
    selections = [];
    allRecommendations = [];
    currentPage = 1;
    selectedAnime = null;
    stopRunnerAnimation();

    resultsContainer.classList.add("hidden");
    errorContainer.classList.add("hidden");
    loadingContainer.classList.add("hidden");

    document.getElementById("tab-bar").style.display = "flex";

    resultsGrid.innerHTML = "";
    paginationEl.innerHTML = "";

    if (runner) runner.style.left = "0%";
    if (loadingProgressFill) loadingProgressFill.style.width = "0%";

    // Reset similar search
    clearSelectedAnime();
    searchInput.value = "";

    switchTab(currentMode);
    renderStep(0);
    setRobotExpression("idle");
}

// ============================================
// UTILITY
// ============================================
function escapeHTML(str) {
    if (!str) return "";
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

// ============================================
// EVENTS
// ============================================
btnTryAgain.addEventListener("click", resetAll);
btnRetry.addEventListener("click", () => {
    errorContainer.classList.add("hidden");
    if (currentMode === "quiz") submitQuiz();
    else submitSimilar();
});

// ============================================
// ROBOT — Draggable (Mouse + Touch)
// ============================================
(function initDraggableRobot() {
    const robotEl = document.getElementById("robot-container");
    if (!robotEl) return;

    let isDragging = false;
    let hasMoved = false;
    let startX, startY, offsetX, offsetY;
    const DRAG_THRESHOLD = 5; // px before counting as a drag

    function onStart(e) {
        const ev = e.touches ? e.touches[0] : e;
        const rect = robotEl.getBoundingClientRect();
        offsetX = ev.clientX - rect.left;
        offsetY = ev.clientY - rect.top;
        startX = ev.clientX;
        startY = ev.clientY;
        isDragging = true;
        hasMoved = false;
        robotEl.style.transition = "none";
        robotEl.style.cursor = "grabbing";
    }

    function onMove(e) {
        if (!isDragging) return;
        const ev = e.touches ? e.touches[0] : e;
        const dx = Math.abs(ev.clientX - startX);
        const dy = Math.abs(ev.clientY - startY);
        if (!hasMoved && dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
        hasMoved = true;
        if (e.cancelable) e.preventDefault();

        // Switch from bottom/right to top/left positioning on first drag
        if (robotEl.style.bottom !== "auto") {
            const rect = robotEl.getBoundingClientRect();
            robotEl.style.left = rect.left + "px";
            robotEl.style.top = rect.top + "px";
            robotEl.style.right = "auto";
            robotEl.style.bottom = "auto";
        }

        let newX = ev.clientX - offsetX;
        let newY = ev.clientY - offsetY;

        // Clamp to viewport
        const w = robotEl.offsetWidth;
        const h = robotEl.offsetHeight;
        newX = Math.max(0, Math.min(newX, window.innerWidth - w));
        newY = Math.max(0, Math.min(newY, window.innerHeight - h));

        robotEl.style.left = newX + "px";
        robotEl.style.top = newY + "px";
    }

    function onEnd() {
        isDragging = false;
        robotEl.style.cursor = "grab";
    }

    // Mouse events
    robotEl.addEventListener("mousedown", onStart);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);

    // Touch events
    robotEl.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);

    // Set initial grab cursor
    robotEl.style.cursor = "grab";
})();

// ============================================
// INIT
// ============================================
renderStep(0);
setRobotExpression("idle");
