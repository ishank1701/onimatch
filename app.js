/* ============================================
   ONIMATCH V3 ? Fully Static, Multi-API
   AniList + Jikan + Kitsu (No AI / No Server)
   ============================================ */

const ANILIST_URL = "https://graphql.anilist.co";
const JIKAN_URL = "https://api.jikan.moe/v4";
const KITSU_URL = "https://kitsu.io/api/edge";
// FILLER_API_BASE removed - using Jikan directly

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
                    idMal
                    title { romaji english native }
                    synonyms
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
                idMal
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

async function fetchAnimeDetailsByIdAniList(id) {
    const query = `
        query ($id: Int) {
            Media(id: $id, type: ANIME) {
                id
                idMal
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
    const data = await anilistQuery(query, { id });
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
            { label: "Spicy & Frisky", desc: "In the mood for something steamy & bold", examples: "High School DxD, Prison School, Food Wars" },
            { label: "Dark & Vengeful", desc: "Craving revenge arcs and anti-heroes", examples: "Vinland Saga, Berserk, Redo of Healer" }
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
let activeTab = "quiz";       // "quiz" | "similar" | "filler"
let selectedAnime = null;     // For similar search
let selectedFillerAnime = null;
let searchDebounce = null;
let fillerSearchDebounce = null;
let currentMode = "quiz";     // Track which mode generated results

if (!history.state) {
    history.replaceState({ layer: 'home' }, "");
}

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
const tabFiller = document.getElementById("tab-filler");
const sectionQuiz = document.getElementById("section-quiz");
const sectionSimilar = document.getElementById("section-similar");
const sectionFiller = document.getElementById("section-filler");

// Search
const searchInput = document.getElementById("anime-search-input");
const autocompleteDropdown = document.getElementById("autocomplete-dropdown");
const btnFindSimilar = document.getElementById("btn-find-similar");
const fillerSearchInput = document.getElementById("filler-search-input");
const fillerAutocompleteDropdown = document.getElementById("filler-autocomplete-dropdown");
const btnFindFiller = document.getElementById("btn-find-filler");
const fillerResultsPanel = document.getElementById("filler-results-panel");
const fillerResultsContent = document.getElementById("filler-results-content");

// Robot
const robot = document.getElementById("robot");
const pupilLeft = document.getElementById("pupil-left");
const pupilRight = document.getElementById("pupil-right");
const speechText = document.getElementById("speech-text");

// ============================================
// TAB SWITCHING & NAVIGATION
// ============================================
const homeSection = document.getElementById("home-section");

function clearFillerUI() {
    selectedFillerAnime = null;
    if (fillerSearchInput) fillerSearchInput.value = "";
    if (fillerAutocompleteDropdown) fillerAutocompleteDropdown.classList.add("hidden");
    if (btnFindFiller) btnFindFiller.disabled = true;
    if (fillerResultsPanel) fillerResultsPanel.classList.add("hidden");
    if (fillerResultsContent) fillerResultsContent.innerHTML = "";
}

function goHome(fromPopState = false) {
    if (document.querySelector('.studio-page')) {
        exitStudioPage(true);
    }
    // Show home section
    homeSection.style.display = '';
    document.getElementById('features-section').style.display = '';
    document.querySelector('.site-footer').style.display = '';
    // Hide quiz/similar/results/loading/error
    const tabBarEl = document.getElementById('tab-bar');
    tabBarEl.classList.add('hidden');
    tabBarEl.style.display = '';
    sectionQuiz.classList.remove('active');
    sectionSimilar.classList.remove('active');
    if (sectionFiller) sectionFiller.classList.remove('active');
    loadingContainer.classList.add('hidden');
    resultsContainer.classList.add('hidden');
    errorContainer.classList.add('hidden');
    document.body.style.overflow = '';
    // Reset quiz
    currentStep = 0;
    selections = Array(QUIZ_STEPS.length).fill(null);
    renderStep(0);
    clearSelectedAnime();
    clearFillerUI();
    setRobotExpression('idle');
    speechText.textContent = "Hey! Ready to find your next anime?";
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (fromPopState !== true) {
        history.pushState({ layer: 'home' }, "");
    }
}

function switchTab(tab, fromPopState = false) {
    activeTab = tab;
    // Hide home, show tab bar
    homeSection.style.display = 'none';
    document.getElementById('features-section').style.display = 'none';
    document.querySelector('.site-footer').style.display = 'none';
    const tabBarShow = document.getElementById('tab-bar');
    tabBarShow.classList.remove('hidden');
    tabBarShow.style.display = '';
    // Toggle tab buttons
    tabQuiz.classList.toggle("active", tab === "quiz");
    tabSimilar.classList.toggle("active", tab === "similar");
    if (tabFiller) tabFiller.classList.toggle("active", tab === "filler");
    // Toggle sections
    sectionQuiz.classList.toggle("active", tab === "quiz");
    sectionSimilar.classList.toggle("active", tab === "similar");
    if (sectionFiller) sectionFiller.classList.toggle("active", tab === "filler");
    // Hide shared panels
    loadingContainer.classList.add("hidden");
    resultsContainer.classList.add("hidden");
    errorContainer.classList.add("hidden");
    // Re-render quiz step when switching to quiz
    if (tab === "quiz") {
        renderStep(currentStep);
        setRobotExpression("idle");
        speechText.textContent = "Let's find your match!";
    } else if (tab === "similar") {
        setRobotExpression("happy");
        speechText.textContent = "Type an anime you love!";
    } else if (tab === "filler") {
        setRobotExpression("happy");
        speechText.textContent = "Skip the fluff — see which episodes are filler.";
    }

    updateTabIndicator(tab);

    if (fromPopState !== true) {
        history.pushState({ layer: 'tab', tab: tab }, "");
    }
}

function updateTabIndicator(tab) {
    const indicator = document.getElementById('tab-indicator');
    const map = { quiz: tabQuiz, similar: tabSimilar, filler: tabFiller };
    const activeBtn = map[tab];
    if (indicator && activeBtn) {
        indicator.style.width = `${activeBtn.offsetWidth}px`;
        indicator.style.left = `${activeBtn.offsetLeft}px`;
    }
}

// Ensure indicator is correct on resize
window.addEventListener('resize', () => {
    if (activeTab) updateTabIndicator(activeTab);
});

tabQuiz.addEventListener("click", () => switchTab("quiz"));
tabSimilar.addEventListener("click", () => switchTab("similar"));
if (tabFiller) tabFiller.addEventListener("click", () => switchTab("filler"));

// Home button + logo click ? go home
document.getElementById("btn-home").addEventListener("click", goHome);
document.querySelector(".hero-logo").addEventListener("click", goHome);
document.querySelector(".hero-logo").style.cursor = "pointer";

// CTA buttons
document.getElementById("btn-cta-quiz").addEventListener("click", () => switchTab("quiz"));
document.getElementById("btn-cta-similar").addEventListener("click", () => switchTab("similar"));
const btnCtaFiller = document.getElementById("btn-cta-filler");
if (btnCtaFiller) btnCtaFiller.addEventListener("click", () => switchTab("filler"));

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
            <div class="home-card-meta">${score ? score : ''} ${eps ? eps : ''}</div>
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
            <span class="studio-arrow">&rarr;</span>
        </div>
    `).join('');
}

async function loadStudioAnime(studioId, studioName, fromPopState = false) {
    if (fromPopState !== true) {
        history.pushState({ layer: 'studio', id: studioId, name: studioName }, "");
    }

    // Hide other homepage sections, show studio full page
    const homeSection = document.getElementById('home-section');
    homeSection.innerHTML = `
        <div class="studio-page">
            <button class="studio-back-btn" onclick="exitStudioPage()">&larr; Back to Home</button>
            <h2 class="studio-page-title">${studioName}</h2>
            <p class="studio-page-desc">All anime produced by ${studioName}</p>
            <div class="studio-page-loading">Loading all anime<span class="loading-dots"></span></div>
            <div class="studio-anime-grid" id="studio-anime-grid"></div>
        </div>
    `;
    document.getElementById('features-section').style.display = 'none';
    document.querySelector('.site-footer').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
        // Fetch ALL anime from this studio (paginated)
        let page = 1;
        let allAnime = [];
        let hasMore = true;

        while (hasMore && page <= 5) {
            const query = `query ($studioId: Int, $page: Int) {
                Studio(id: $studioId) {
                    media(sort: FAVOURITES_DESC, isMain: true, page: $page, perPage: 50) {
                        nodes {
                            id title { romaji english } coverImage { large extraLarge }
                            averageScore episodes format status seasonYear
                        }
                        pageInfo { hasNextPage }
                    }
                }
            }`;
            const data = await anilistQuery(query, { studioId, page });
            const media = data.Studio?.media;
            if (media?.nodes) allAnime.push(...media.nodes);
            hasMore = media?.pageInfo?.hasNextPage || false;
            page++;
        }

        const grid = document.getElementById('studio-anime-grid');
        const loadingEl = homeSection.querySelector('.studio-page-loading');
        if (loadingEl) loadingEl.remove();

        if (allAnime.length === 0) {
            grid.innerHTML = '<p style="color:var(--text-muted);text-align:center">No anime found for this studio.</p>';
            return;
        }

        // Update count
        const descEl = homeSection.querySelector('.studio-page-desc');
        if (descEl) descEl.textContent = `${allAnime.length} anime by ${studioName}`;

        grid.innerHTML = allAnime.map(a => {
            const title = a.title?.english || a.title?.romaji || '';
            const cover = a.coverImage?.extraLarge || a.coverImage?.large || '';
            const score = a.averageScore ? (a.averageScore / 10).toFixed(1) : '';
            const eps = a.episodes ? `${a.episodes} ep` : a.format || '';
            const year = a.seasonYear || '';
            return `<div class="studio-anime-card" onclick="openAnimeDetail(null, '${escapeHTML(title).replace(/'/g, "\\'")}', ${a.id})">
                <img src="${cover}" alt="${escapeHTML(title)}" loading="lazy">
                <div class="studio-anime-info">
                    <div class="studio-anime-title">${escapeHTML(title)}</div>
                    <div class="studio-anime-meta">
                        ${score ? score : ''} ${eps ? eps : ''} ${year ? year : ''}
                    </div>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        const grid = document.getElementById('studio-anime-grid');
        if (grid) grid.innerHTML = `<p style="color:var(--text-muted)">Failed to load. <button onclick="exitStudioPage()">Back</button></p>`;
    }
}

// Store original home HTML for restoration
let originalHomeHTML = '';
// Capture right away (script runs after DOM is parsed)
setTimeout(() => {
    originalHomeHTML = document.getElementById('home-section')?.innerHTML || '';
}, 100);

function exitStudioPage(fromPopState = false) {
    const homeSection = document.getElementById('home-section');
    // Rebuild original home HTML structure
    homeSection.innerHTML = `
        <div class="home-cta">
            <h2 class="home-cta-title">Find Your Perfect Anime</h2>
            <p class="home-cta-desc">Take our quiz or search for an anime you love</p>
            <div class="home-cta-buttons">
                <button class="btn-cta-quiz" id="btn-cta-quiz">Take the Quiz</button>
                <button class="btn-cta-similar" id="btn-cta-similar">Find Similar</button>
                <button class="btn-cta-filler" id="btn-cta-filler">Filler guide</button>
            </div>
        </div>
        <div class="home-row">
            <h3 class="home-row-title">Top Anime of All Time</h3>
            <div class="home-scroll" id="home-top-anime"></div>
        </div>
        <div class="home-row">
            <h3 class="home-row-title">Currently Airing</h3>
            <div class="home-scroll" id="home-airing"></div>
        </div>
        <div class="home-row">
            <h3 class="home-row-title">Top Upcoming</h3>
            <div class="home-scroll" id="home-upcoming"></div>
        </div>
        <div class="home-row">
            <h3 class="home-row-title">Studio Collections</h3>
            <div class="studio-grid" id="studio-grid"></div>
        </div>
    `;
    // Re-bind CTA buttons
    document.getElementById('btn-cta-quiz').addEventListener('click', () => switchTab('quiz'));
    document.getElementById('btn-cta-similar').addEventListener('click', () => switchTab('similar'));
    const ef = document.getElementById('btn-cta-filler');
    if (ef) ef.addEventListener('click', () => switchTab('filler'));
    // Show footer & features
    document.getElementById('features-section').style.display = '';
    document.querySelector('.site-footer').style.display = '';
    // Reload data
    loadHomeSection();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (fromPopState !== true) {
        history.back();
    }
}

function resetStudioGrid() {
    const studioGrid = document.getElementById('studio-grid');
    studioGrid.innerHTML = STUDIOS.map(s => `
        <div class="studio-card" onclick="loadStudioAnime(${s.id}, '${s.name}')">
            <span class="studio-name">${s.name}</span>
            <span class="studio-arrow">&rarr;</span>
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
    idle: { cls: '', msg: "Hey nakama! Pick your vibe!" },
    excited: { cls: 'excited', msg: "Great picks!" },
    happy: { cls: 'happy', msg: "Nice choice!" },
    thinking: { cls: 'thinking', msg: "Hmm, processing..." },
    sad: { cls: 'sad', msg: "Oh no..." },
    searching: { cls: 'thinking', msg: "Scanning anime database..." },
    party: { cls: 'excited', msg: "Found your matches!" }
};

function setRobotExpression(expr) {
    if (!robot) return;
    const e = ROBOT_EXPRESSIONS[expr] || ROBOT_EXPRESSIONS.idle;
    robot.className = 'robot';
    if (e.cls) robot.classList.add(e.cls);
    if (speechText) speechText.textContent = e.msg;
}

// ============================================
// QUIZ ? Multi-Select
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
    btnNext.textContent = stepIndex === QUIZ_STEPS.length - 1 ? "Get Recommendations" : "Next";
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
    clearInterval(loadingInterval);
    let progress = 0;
    loadingInterval = setInterval(() => {
        if (progress < 75) progress += 0.8;
        else if (progress < 95) progress += 0.1;
        updateRunnerPosition(progress);
    }, 50); // Faster, smoother updates
}
function updateRunnerPosition(pct) {
    const c = Math.min(pct, 100);
    const runner = document.getElementById('runner');
    const loadingProgressFill = document.querySelector('.loading-progress-fill');
    if (runner) runner.style.left = c + "%";
    if (loadingProgressFill) loadingProgressFill.style.width = c + "%";
}
function completeRunnerAnimation() {
    clearInterval(loadingInterval);
    let cur = parseFloat(document.getElementById('runner')?.style.left) || 0;
    const finish = setInterval(() => {
        cur += 4;
        if (cur >= 100) { 
            cur = 100; 
            clearInterval(finish); 
            // Reset after a short delay so it's ready for next time
            setTimeout(() => updateRunnerPosition(0), 1000);
        }
        updateRunnerPosition(cur);
    }, 20);
}
function stopRunnerAnimation() { 
    clearInterval(loadingInterval);
}

// ============================================
// QUIZ SUBMIT ? AniList Powered (No AI needed!)
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

async function fetchQuizResults() {
    const moodSel = selections[0];
    const genreSel = selections[1];
    const epsSel = selections[2];
    const themeSel = selections[3];
    const expSel = selections[4];

    // Build genre filter
    let genres = new Set();
    const moodArr = Array.isArray(moodSel) ? moodSel : (moodSel !== undefined ? [moodSel] : []);
    const genreArr = Array.isArray(genreSel) ? genreSel : (genreSel !== undefined ? [genreSel] : []);
    moodArr.forEach(i => (MOOD_TO_GENRES[i] || []).forEach(g => genres.add(g)));
    genreArr.forEach(i => (GENRE_MAP[i] || []).forEach(g => genres.add(g)));
    genres = [...genres];

    // Build tag filter
    let tags = [];
    const moodTagArr = Array.isArray(moodSel) ? moodSel : (moodSel !== undefined ? [moodSel] : []);
    const themeArr = Array.isArray(themeSel) ? themeSel : (themeSel !== undefined ? [themeSel] : []);
    moodTagArr.forEach(i => tags.push(...(MOOD_TO_TAGS[i] || [])));
    themeArr.forEach(i => tags.push(...(THEME_TO_TAGS[i] || [])));

    // Build episode/format filter
    let formatInFilter = null, episodesGreater = null, episodesLesser = null;
    const epsVal = Array.isArray(epsSel) ? epsSel[0] : epsSel;
    switch (epsVal) {
        case 0: formatInFilter = ["MOVIE", "OVA", "SPECIAL"]; break;
        case 1: formatInFilter = ["TV", "TV_SHORT", "ONA"]; episodesLesser = 13; break;
        case 2: formatInFilter = ["TV", "TV_SHORT", "ONA"]; episodesGreater = 11; episodesLesser = 27; break;
        case 3: formatInFilter = ["TV", "TV_SHORT", "ONA"]; episodesGreater = 25; episodesLesser = 53; break;
        case 4: formatInFilter = ["TV", "TV_SHORT", "ONA"]; episodesGreater = 49; episodesLesser = 150; break;
        case 5: formatInFilter = ["TV", "TV_SHORT", "ONA"]; episodesGreater = 100; break;
    }

    // Experience ? sort order + minimum score
    const expVal = Array.isArray(expSel) ? expSel[0] : expSel;
    let sortOrders, minScore;
    switch (expVal) {
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
        let queryArgs = `$sort: [MediaSort], $minScore: Int`;
        let mediaArgs = `type: ANIME, sort: [$sort], averageScore_greater: $minScore, isAdult: false`;

        if (formatInFilter !== null) {
            queryArgs += `, $formatIn: [MediaFormat]`;
            mediaArgs += `, format_in: $formatIn`;
        }

        if (episodesGreater !== null) {
            queryArgs += `, $epsGreater: Int`;
            mediaArgs += `, episodes_greater: $epsGreater`;
        }
        if (episodesLesser !== null) {
            queryArgs += `, $epsLesser: Int`;
            mediaArgs += `, episodes_lesser: $epsLesser`;
        }

        if (genres.length > 0) {
            queryArgs += `, $genres: [String]`;
            mediaArgs += `, genre_in: $genres`;
        }
        if (tags.length > 0) {
            queryArgs += `, $tags: [String]`;
            mediaArgs += `, tag_in: $tags`;
        }

        const query = `
            query (${queryArgs}) {
                Page(perPage: 50) {
                    media(${mediaArgs}) {
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
        if (formatInFilter) variables.formatIn = formatInFilter;
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
                            why: `Matches your ${genres[0] || 'selected'} taste — ${m.averageScore ? m.averageScore + '%' : 'N/A'} on AniList`,
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
            let fbQueryArgs = `$genres: [String]`;
            let fbMediaArgs = `type: ANIME, genre_in: $genres, sort: [POPULARITY_DESC], isAdult: false`;

            if (formatInFilter !== null) {
                fbQueryArgs += `, $formatIn: [MediaFormat]`;
                fbMediaArgs += `, format_in: $formatIn`;
            }
            if (episodesGreater !== null) {
                fbQueryArgs += `, $epsGreater: Int`;
                fbMediaArgs += `, episodes_greater: $epsGreater`;
            }
            if (episodesLesser !== null) {
                fbQueryArgs += `, $epsLesser: Int`;
                fbMediaArgs += `, episodes_lesser: $epsLesser`;
            }

            const fallbackQuery = `
                query (${fbQueryArgs}) {
                    Page(perPage: 50) {
                        media(${fbMediaArgs}) {
                            id title { romaji english }
                            coverImage { large extraLarge }
                            format seasonYear averageScore episodes genres
                            description(asHtml: false)
                        }
                    }
                }
            `;
            const fbVariables = { genres };
            if (formatInFilter) fbVariables.formatIn = formatInFilter;
            if (episodesGreater !== null) fbVariables.epsGreater = episodesGreater;
            if (episodesLesser !== null) fbVariables.epsLesser = episodesLesser;

            const data = await anilistQuery(fallbackQuery, fbVariables);
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
                            why: `Popular ${genres[0] || ''} anime — ${m.averageScore ? m.averageScore + '%' : 'N/A'} on AniList`,
                            coverImage: m.coverImage?.extraLarge || m.coverImage?.large || null,
                            anilistId: m.id
                        });
                    }
                }
            }
        } catch (e) { console.warn("Fallback query failed:", e.message); }
    }

    if (allResults.length === 0) throw new Error("No anime found matching your preferences. Try different options!");

    // Shuffle the results to provide a unique recommendation feed every time
    for (let i = allResults.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allResults[i], allResults[j]] = [allResults[j], allResults[i]];
    }

    return allResults;
}

async function submitQuiz() {
    currentMode = "quiz";
    document.getElementById("tab-bar").style.display = "none";
    sectionQuiz.classList.remove("active");
    loadingContainer.classList.remove("hidden");
    startRunnerAnimation();
    setRobotExpression("searching");

    try {
        allRecommendations = await fetchQuizResults();
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

// Close dropdown on click outside (similar vs filler wrappers)
document.addEventListener("click", (e) => {
    if (!e.target.closest("#section-similar .search-input-wrapper")) {
        autocompleteDropdown.classList.add("hidden");
    }
    if (!e.target.closest("#section-filler .search-input-wrapper") && fillerAutocompleteDropdown) {
        fillerAutocompleteDropdown.classList.add("hidden");
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
        const score = anime.averageScore ? `${(anime.averageScore / 10).toFixed(1)}` : '';
        const anilistId = anime.id;
        return `<div class="ac-item" data-title="${escapeHTML(title)}" data-img="${img}" data-type="${type}" data-year="${year}" data-score="${score}" data-id="${anilistId}">
            <img src="${img}" alt="" class="ac-img">
            <div class="ac-info">
                <div class="ac-title">${escapeHTML(title)}</div>
                <div class="ac-meta">${type} ${year ? year : ''} ${score}</div>
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
            <div class="selected-anime-type">${anime.type} ${anime.year ? anime.year : ''} ${anime.score}</div>
        </div>
        <button class="btn-clear-anime" id="btn-clear-anime">&times;</button>
    `;
    wrapper.parentElement.insertBefore(card, wrapper.nextSibling);

    // Hide search input
    wrapper.style.display = "none";
    btnFindSimilar.disabled = false;

    card.querySelector("#btn-clear-anime").addEventListener("click", clearSelectedAnime);

    setRobotExpression("happy");
    speechText.textContent = `${anime.title}! Great taste!`;
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
// FILLER GUIDE (Anime Filler List via /api/filler)
// ============================================

function formatEpisodeRanges(sortedNums) {
    if (!sortedNums || !sortedNums.length) return "";
    const uniq = [...new Set(sortedNums)].sort((a, b) => a - b);
    const parts = [];
    let i = 0;
    while (i < uniq.length) {
        const start = uniq[i];
        let end = start;
        while (i + 1 < uniq.length && uniq[i + 1] === end + 1) {
            end++;
            i++;
        }
        i++;
        parts.push(start === end ? String(start) : `${start}-${end}`);
    }
    return parts.join(", ");
}

function parseFillerEpisodes(val, type) {
    if (!val) return [];
    const eps = [];
    if (Array.isArray(val)) {
        val.forEach((n) => {
            const num = Number(n);
            if (Number.isFinite(num)) eps.push({ n: num, t: type });
        });
    } else if (typeof val === "string") {
        val.split(", ").forEach((p) => {
            const part = p.trim();
            if (!part) return;
            if (part.includes("-")) {
                const [s, e] = part.split("-").map(Number);
                if (Number.isFinite(s) && Number.isFinite(e)) {
                    for (let k = s; k <= e; k++) eps.push({ n: k, t: type });
                }
            } else {
                const n = Number(part);
                if (Number.isFinite(n)) eps.push({ n, t: type });
            }
        });
    }
    return eps;
}

function renderFillerResults(data, pickedTitle) {
    if (!fillerResultsContent) return;
    const canon = parseFillerEpisodes(data.manga_canon_episodes || data.cannonEpisodes, "canon");
    const mixed = parseFillerEpisodes(data.mixed_canon_filler_episodes || data.animecanonsEp, "mixed");
    const filler = parseFillerEpisodes(data.filler_episodes || data.fillerEpisodes, "filler");
    const all = [...canon, ...mixed, ...filler].sort((a, b) => a.n - b.n);
    const total = data.total_episodes || all.length;
    const canonPct = total > 0 ? Math.round((canon.length / total) * 100) : 0;
    const fillerPct = total > 0 ? Math.round((filler.length / total) * 100) : 0;
    const mixedPct = total > 0 ? Math.round((mixed.length / total) * 100) : 0;
    const srcTitle = data.title || pickedTitle;
    const fillerRanges = formatEpisodeRanges(filler.map((e) => e.n));
    const sourceUrl = data.source || "https://www.animefillerlist.com";

    fillerResultsContent.innerHTML = `
        <div class="filler-results-header">
            <h3 class="filler-results-title">${escapeHTML(srcTitle)}</h3>
            <p class="filler-source-line"><a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener">Source: MyAnimeList (Jikan)</a></p>
        </div>
        <div class="filler-stats-row">
            <div class="filler-stat filler-stat-canon"><span class="filler-stat-pct">${canonPct}%</span><span class="filler-stat-label">Canon</span><span class="filler-stat-n">${canon.length} eps</span></div>
            <div class="filler-stat filler-stat-filler"><span class="filler-stat-pct">${fillerPct}%</span><span class="filler-stat-label">Filler</span><span class="filler-stat-n">${filler.length} eps</span></div>
            <div class="filler-stat filler-stat-mixed"><span class="filler-stat-pct">${mixedPct}%</span><span class="filler-stat-label">Recap</span><span class="filler-stat-n">${mixed.length} eps</span></div>
        </div>
        <p class="filler-total-meta">${total} episodes in guide &mdash; searched as "${escapeHTML(pickedTitle)}"</p>
        ${filler.length ? `<div class="filler-ranges-box"><strong>Filler-only numbers</strong><p class="filler-ranges-text">${escapeHTML(fillerRanges)}</p></div>` : ""}
        <div class="filler-ep-grid">
            ${all.map((ep) => `<span class="filler-ep filler-ep-${ep.t}" title="${ep.t}"><span class="filler-ep-num">${ep.n}</span><small>${ep.t}</small></span>`).join("")}
        </div>
    `;
    if (fillerResultsPanel) {
        fillerResultsPanel.classList.remove("hidden");
        fillerResultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

async function fetchFullJikanEpisodes(malId) {
    let allEpisodes = [];
    let page = 1;
    let maxPages = 20; // Enough for 2000 episodes
    
    while (page <= maxPages) {
        try {
            const res = await fetch(`${JIKAN_URL}/anime/${malId}/episodes?page=${page}`);
            if (!res.ok) {
                if (res.status === 429) {
                    await new Promise(r => setTimeout(r, 1000)); // Rate limited
                    continue;
                }
                break;
            }
            const data = await res.json();
            const pageData = data.data || [];
            
            if (pageData.length === 0) break; // End of guide
            
            allEpisodes = allEpisodes.concat(pageData);
            
            // Jikan search for episodes pagination is often unreliable. 
            // We continue until we get an empty array.
            page++;
            await new Promise(r => setTimeout(r, 400)); // Polite delay
        } catch (e) {
            console.error("Jikan fetch error:", e);
            break;
        }
    }
    return allEpisodes;
}

async function fetchFillerBreakdown(displayTitle) {
    const title = (displayTitle || "").trim();
    if (!title || !fillerResultsContent) return;

    loadingContainer.classList.remove("hidden");
    startRunnerAnimation();
    setRobotExpression("searching");
    if (fillerResultsPanel) fillerResultsPanel.classList.add("hidden");

    try {
        // We need the MAL ID for Jikan episodes
        let malId = selectedFillerAnime ? selectedFillerAnime.idMal : null;

        if (!malId) {
            // Fallback: search Jikan by title if idMal is missing
            const jResults = await fetch(`${JIKAN_URL}/anime?q=${encodeURIComponent(title)}&limit=1`);
            const jData = await jResults.json();
            malId = jData.data?.[0]?.mal_id;
        }

        if (!malId) throw new Error("Could not find this series on MyAnimeList for filler data.");

        const episodes = await fetchFullJikanEpisodes(malId);
        
        if (!episodes || !episodes.length) {
            throw new Error("No episode data found for this anime.");
        }

        const canon = episodes.filter(e => !e.filler && !e.recap).map(e => e.mal_id);
        const filler = episodes.filter(e => e.filler === true).map(e => e.mal_id);
        const mixed = episodes.filter(e => e.recap === true).map(e => e.mal_id); // Recaps as "mixed" or just highlight them

        const data = {
            title: title,
            manga_canon_episodes: canon,
            filler_episodes: filler,
            mixed_canon_filler_episodes: mixed,
            total_episodes: episodes.length,
            source: `https://myanimelist.net/anime/${malId}/episode`
        };

        renderFillerResults(data, title);
        setRobotExpression("party");
        speechText.textContent = "Episode guide loaded from Jikan!";
        setTimeout(() => setRobotExpression("idle"), 2500);

    } catch (err) {
        console.error(err);
        setRobotExpression("sad");
        speechText.textContent = "Something went wrong with the lookup.";
        fillerResultsContent.innerHTML = `<p class="filler-error">${escapeHTML(err.message || "Unknown error")}</p>`;
        if (fillerResultsPanel) fillerResultsPanel.classList.remove("hidden");
    } finally {
        stopRunnerAnimation();
        loadingContainer.classList.add("hidden");
        if (runner) runner.style.left = "0%";
        if (loadingProgressFill) loadingProgressFill.style.width = "0%";
    }
}

function renderFillerAutocomplete(results) {
    if (!fillerAutocompleteDropdown) return;
    fillerAutocompleteDropdown.innerHTML = results
        .map((anime) => {
            const img = anime.coverImage?.large || "";
            const t = anime.title?.english || anime.title?.romaji || "";
            return `<div class="ac-item">
                <img src="${img}" alt="" class="ac-img">
                <div class="ac-info">
                    <div class="ac-title">${escapeHTML(t)}</div>
                    <div class="ac-meta">${anime.format || ""} ${anime.seasonYear ? anime.seasonYear : ""}</div>
                </div>
            </div>`;
        })
        .join("");

    fillerAutocompleteDropdown.classList.remove("hidden");
    fillerAutocompleteDropdown.querySelectorAll(".ac-item").forEach((item, idx) => {
        item.addEventListener("click", () => {
            const anime = results[idx];
            const t = anime.title?.english || anime.title?.romaji || "";
            selectedFillerAnime = { 
                id: anime.id, 
                idMal: anime.idMal,
                title: t,
                romaji: anime.title?.romaji || "",
                synonyms: anime.synonyms || []
            };
            if (fillerSearchInput) fillerSearchInput.value = t;
            fillerAutocompleteDropdown.classList.add("hidden");
            if (btnFindFiller) {
                btnFindFiller.disabled = false;
                btnFindFiller.classList.add("ready-pulse"); // Visual cue to click
            }
            // fetchFillerBreakdown(t); // MOVED to button click only
        });
    });
}

async function searchFillerAutocomplete(query) {
    try {
        const results = await searchAnimeAniList(query);
        if (!results || !results.length) {
            if (fillerAutocompleteDropdown) fillerAutocompleteDropdown.classList.add("hidden");
            return;
        }
        renderFillerAutocomplete(results);
    } catch (e) { /* silent */ }
}

if (fillerSearchInput) {
    fillerSearchInput.addEventListener("input", () => {
        if (btnFindFiller) btnFindFiller.disabled = fillerSearchInput.value.trim().length === 0;
        clearTimeout(fillerSearchDebounce);
        const q = fillerSearchInput.value.trim();
        if (q.length < 2) {
            if (fillerAutocompleteDropdown) fillerAutocompleteDropdown.classList.add("hidden");
            return;
        }
        fillerSearchDebounce = setTimeout(() => searchFillerAutocomplete(q), 400);
    });
}

if (btnFindFiller) {
    btnFindFiller.addEventListener("click", () => {
        const t = fillerSearchInput ? fillerSearchInput.value.trim() : "";
        if (t) {
            if (btnFindFiller) btnFindFiller.disabled = false;
            fetchFillerBreakdown(t);
        }
    });
}

// ============================================
// PAGINATION + SIDEBAR
// ============================================

// Sidebar step icons
const SIDEBAR_ICONS = ['', '', '', '', ''];

function generateSidebarHTML() {
    let html = `<h3 class="sidebar-title">Your Filters</h3>`;
    QUIZ_STEPS.forEach((step, stepIdx) => {
        const sel = selections[stepIdx];
        html += `<div class="sidebar-section">
            <div class="sidebar-section-title">${SIDEBAR_ICONS[stepIdx]} ${step.key.toUpperCase()}</div>
            <div class="sidebar-pills">`;
        step.choices.forEach((choice, choiceIdx) => {
            const isActive = step.multi
                ? (Array.isArray(sel) && sel.includes(choiceIdx))
                : sel === choiceIdx;
            html += `<button class="sidebar-pill ${isActive ? 'active' : ''}"
                data-step="${stepIdx}" data-choice="${choiceIdx}" data-multi="${step.multi}"
                onclick="toggleSidebarPill(this)">${choice.label}</button>`;
        });
        html += `</div></div>`;
    });
    html += `<div class="sidebar-actions">
        <button class="btn-refresh-results" onclick="refreshFromSidebar()">Update Results</button>
        <button class="btn-feeling-lucky" onclick="feelingLucky()">Feeling Lucky</button>
    </div>`;
    return html;
}

function toggleSidebarPill(el) {
    const stepIdx = parseInt(el.dataset.step);
    const choiceIdx = parseInt(el.dataset.choice);
    const isMulti = el.dataset.multi === 'true';

    if (isMulti) {
        let sel = Array.isArray(selections[stepIdx]) ? [...selections[stepIdx]] : [];
        if (sel.includes(choiceIdx)) {
            sel = sel.filter(i => i !== choiceIdx);
        } else {
            sel.push(choiceIdx);
        }
        selections[stepIdx] = sel;
    } else {
        selections[stepIdx] = choiceIdx;
    }

    // Update all sidebars (desktop + bottom sheet)
    updateAllSidebars();
}

function updateAllSidebars() {
    const sidebarHTML = generateSidebarHTML();
    const desktopSidebar = document.getElementById('results-sidebar');
    const mobileSheet = document.getElementById('sidebar-bottom-sheet');
    if (desktopSidebar) desktopSidebar.innerHTML = sidebarHTML;
    if (mobileSheet) mobileSheet.innerHTML = `<div class="sheet-handle"></div>` + sidebarHTML;
}

async function refreshFromSidebar() {
    // Close mobile sheet if open
    closeMobileSheet();
    // Dim the results grid to show loading
    const grid = document.getElementById('results-grid');
    const refreshBtn = document.querySelector('.btn-refresh-results');
    if (grid) grid.style.opacity = '0.35';
    if (refreshBtn) {
        refreshBtn.textContent = 'Updating...';
        refreshBtn.disabled = true;
    }

    try {
        const newResults = await fetchQuizResults();
        allRecommendations = newResults;
        currentPage = 1;
        showResultsPage(1);
        setRobotExpression("party");
        setTimeout(() => setRobotExpression("idle"), 3000);
    } catch (e) {
        console.error("Refresh error:", e);
        // Restore grid opacity if failed
        if (grid) grid.style.opacity = '1';
        if (refreshBtn) {
            refreshBtn.textContent = 'Update Results';
            refreshBtn.disabled = false;
        }
        setRobotExpression("sad");
        setTimeout(() => setRobotExpression("idle"), 2000);
    }
}

function feelingLucky() {
    // Randomize all selections
    QUIZ_STEPS.forEach((step, i) => {
        if (step.multi) {
            // Pick 1-3 random choices
            const count = Math.floor(Math.random() * 3) + 1;
            const indices = [];
            const available = [...Array(step.choices.length).keys()];
            for (let j = 0; j < count && available.length > 0; j++) {
                const pick = Math.floor(Math.random() * available.length);
                indices.push(available.splice(pick, 1)[0]);
            }
            selections[i] = indices;
        } else {
            selections[i] = Math.floor(Math.random() * step.choices.length);
        }
    });
    updateAllSidebars();
    refreshFromSidebar();
}

// Mobile bottom sheet
function openMobileSheet() {
    history.pushState({ layer: 'sheet' }, "");
    const overlay = document.getElementById('sidebar-overlay');
    const sheet = document.getElementById('sidebar-bottom-sheet');
    if (overlay) overlay.classList.add('active');
    if (sheet) {
        sheet.innerHTML = `<div class="sheet-handle"></div>` + generateSidebarHTML();
        sheet.classList.add('active');
    }
    document.body.style.overflow = 'hidden';
}

function closeMobileSheet(fromPopState = false) {
    const overlay = document.getElementById('sidebar-overlay');
    const sheet = document.getElementById('sidebar-bottom-sheet');
    const wasActive = sheet && sheet.classList.contains('active');

    if (overlay) overlay.classList.remove('active');
    if (sheet) sheet.classList.remove('active');
    document.body.style.overflow = '';

    if (wasActive && fromPopState !== true) {
        history.back();
    }
}

function showResultsPage(page) {
    loadingContainer.classList.add("hidden");
    resultsContainer.classList.remove("hidden");
    const totalPages = Math.ceil(allRecommendations.length / PER_PAGE);
    currentPage = Math.max(1, Math.min(page, totalPages));
    const start = (currentPage - 1) * PER_PAGE;
    const pageItems = allRecommendations.slice(start, start + PER_PAGE);

    const titleText = currentMode === "similar" ? `Similar to "${selectedAnime?.title}"` : "Your Anime Matches";

    // Build the two-column layout only for quiz mode
    if (currentMode === "quiz") {
        resultsContainer.innerHTML = `
            <h2 class="results-title">${titleText}</h2>
            <p class="results-subtitle" id="results-count"></p>
            <div class="results-layout">
                <aside class="results-sidebar" id="results-sidebar"></aside>
                <div class="results-main">
                    <div class="results-grid" id="results-grid"></div>
                    <div class="pagination" id="pagination"></div>
                </div>
            </div>
            <button class="sidebar-fab" id="sidebar-fab" onclick="openMobileSheet()">Filters</button>
            <div class="sidebar-overlay" id="sidebar-overlay" onclick="closeMobileSheet()"></div>
            <div class="sidebar-bottom-sheet" id="sidebar-bottom-sheet"></div>
        `;
        // Render sidebar
        document.getElementById('results-sidebar').innerHTML = generateSidebarHTML();
    } else {
        resultsContainer.innerHTML = `
            <h2 class="results-title">${titleText}</h2>
            <p class="results-subtitle" id="results-count"></p>
            <div class="results-grid" id="results-grid"></div>
            <div class="pagination" id="pagination"></div>
        `;
    }

    // Update refs after innerHTML change
    const newGrid = document.getElementById('results-grid');
    const newPagination = document.getElementById('pagination');
    const newCount = document.getElementById('results-count');
    if (newCount) newCount.textContent = `${allRecommendations.length} anime found — Page ${currentPage} of ${totalPages}`;

    renderResults(pageItems, start, newGrid);
    renderPagination(totalPages, newPagination);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderPagination(totalPages, container) {
    const el = container || paginationEl;
    if (totalPages <= 1) { el.innerHTML = ""; return; }
    let html = `<button class="page-btn nav-btn" ${currentPage === 1 ? "disabled" : ""} onclick="showResultsPage(${currentPage - 1})">&larr; Prev</button>`;
    for (let p = 1; p <= totalPages; p++) {
        html += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="showResultsPage(${p})">${p}</button>`;
    }
    html += `<button class="page-btn nav-btn" ${currentPage === totalPages ? "disabled" : ""} onclick="showResultsPage(${currentPage + 1})">Next &rarr;</button>`;
    el.innerHTML = html;
}

// ============================================
// RESULTS RENDERING
// ============================================
function renderResults(animeList, startIndex, gridEl) {
    const grid = gridEl || resultsGrid;
    grid.innerHTML = animeList.map((anime, i) => {
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
                <div class="result-meta">${genrePills}<span class="result-episodes">${escapeHTML(anime.episodes)}</span><span class="result-rating">${anime.rating}/10</span></div>
                <p class="result-synopsis">${escapeHTML(anime.synopsis)}</p>
            </div></div>
            <div class="result-why">${escapeHTML(anime.why)}</div>
            <div class="result-footer"><span class="result-difficulty ${diffClass}">${escapeHTML(diffLabel)}</span><span class="result-detail-hint">Click for trailer & details</span></div>
        </div>`;
    }).join("");
}

// ============================================
// ANIME DETAIL MODAL
// ============================================
async function openAnimeDetail(index, directTitle, directAnilistId, fromPopState = false) {
    if (fromPopState !== true) {
        history.pushState({ layer: 'modal' }, "");
    }

    let anime;
    let fetchById = false;

    if (directAnilistId) {
        // Called from homepage card ? use anilist ID directly
        anime = { title: directTitle || '', anilistId: directAnilistId };
        fetchById = true;
    } else {
        anime = allRecommendations[index];
        if (!anime) return;
    }

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
            <button class="modal-close" onclick="closeAnimeDetail()">&times;</button>
            <div class="modal-loading">Loading details<span class="loading-dots"></span></div>
        </div>
    `;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    try {
        // Fetch full details from AniList
        const details = fetchById
            ? await fetchAnimeDetailsByIdAniList(directAnilistId)
            : await fetchAnimeDetailsAniList(anime.title);

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
                    <h3>Trailer</h3>
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
                    <h3>Trailer</h3>
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
                    <h3>Trailer</h3>
                    <a href="${ytSearchURL}" target="_blank" rel="noopener noreferrer" class="trailer-fallback-link">
                        Watch Trailer on YouTube
                    </a>
                </div>
            `;
        }

        const genrePills = genres.map(g => `<span class="genre-pill">${escapeHTML(g)}</span>`).join('');

        modal.innerHTML = `
            <div class="anime-modal">
                <button class="modal-close" onclick="closeAnimeDetail()">&times;</button>
                ${banner ? `<div class="modal-banner"><img src="${banner}" alt="${escapeHTML(title)}"></div>` : ''}
                <div class="modal-content">
                    <h2 class="modal-title">${escapeHTML(title)}</h2>
                    <div class="modal-meta-row">
                        ${score !== 'N/A' ? `<span class="modal-score">${score}/10</span>` : ''}
                        ${eps ? `<span class="modal-ep">${eps} episodes</span>` : ''}
                        ${format ? `<span class="modal-format">${format}</span>` : ''}
                        ${status ? `<span class="modal-status">${status}</span>` : ''}
                    </div>
                    <div class="modal-meta-row">
                        ${year ? `<span>${season} ${year}</span>` : ''}
                        ${studio ? `<span>${studio}</span>` : ''}
                        ${popularity ? `<span>${popularity} fans</span>` : ''}
                    </div>
                    <div class="modal-genres">${genrePills}</div>
                    ${trailerHTML}
                    <div class="modal-description">
                        <h3>Description</h3>
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
                <button class="modal-close" onclick="closeAnimeDetail()">&times;</button>
                <div class="modal-content">
                    <h2 class="modal-title">${escapeHTML(anime.title)}</h2>
                    <div class="modal-meta-row">
                        <span class="modal-score">${anime.rating}/10</span>
                        <span class="modal-ep">${anime.episodes}</span>
                    </div>
                    <div class="modal-genres">${(anime.genres || []).map(g => `<span class="genre-pill">${escapeHTML(g)}</span>`).join('')}</div>
                    <div class="modal-description">
                        <h3>Description</h3>
                        <p>${escapeHTML(anime.synopsis)}</p>
                    </div>
                    <p style="color: var(--muted); margin-top: 1rem;">Could not load trailer. Try again later.</p>
                </div>
            </div>
        `;
    }
}

function closeAnimeDetail(fromPopState = false) {
    const modal = document.getElementById('anime-detail-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }

    if (fromPopState !== true) {
        history.back();
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
    clearFillerUI();
    searchInput.value = "";

    switchTab(currentMode);
    renderStep(0);
    setRobotExpression("idle");
}

// ============================================
// HISTORY & NAVIGATION HANDLING
// ============================================
window.addEventListener('popstate', (e) => {
    // 1. Close mobile sheet if open
    const mobileSheet = document.getElementById('sidebar-bottom-sheet');
    if (mobileSheet && mobileSheet.classList.contains('active')) {
        closeMobileSheet(true);
        return;
    }

    // 2. Close modal if open
    const modal = document.getElementById('anime-detail-modal');
    if (modal && modal.classList.contains('active')) {
        closeAnimeDetail(true);
        return;
    }

    // 3. Handle base state
    const state = e.state;
    if (state) {
        if (state.layer === 'home') {
            goHome(true);
        } else if (state.layer === 'tab') {
            switchTab(state.tab, true);
        } else if (state.layer === 'studio') {
            // If going forward/back to a studio page
            if (!document.querySelector('.studio-page')) {
                loadStudioAnime(state.id, state.name, true);
            }
        }
    } else {
        // Fallback
        goHome(true);
    }
});



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
if (btnTryAgain) btnTryAgain.addEventListener("click", resetAll);
btnRetry.addEventListener("click", () => {
    errorContainer.classList.add("hidden");
    if (currentMode === "quiz") submitQuiz();
    else submitSimilar();
});

// ============================================
// ROBOT ? Draggable (Mouse + Touch)
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
// STICKY HEADER MORPH
// ============================================
const appHeader = document.querySelector('.app-header');
window.addEventListener('scroll', () => {
    // Using simple threshold for morphing
    if (window.pageYOffset > 20) {
        appHeader.classList.add('scrolled');
    } else {
        appHeader.classList.remove('scrolled');
    }
}, { passive: true });

// ============================================
// INIT
// ============================================
renderStep(0);
setRobotExpression("idle");

// ============================================
// WELCOME BANNER ? Fragmented Assembly
// ============================================
(function initWelcomeBanner() {
    const banner = document.getElementById('welcome-overlay');
    const card = document.querySelector('.welcome-banner-card');
    const closeBtn = document.getElementById('btn-close-banner');
    const confirmBtn = document.getElementById('btn-banner-confirm');
    const mascot = document.getElementById('robot');
    
    // Easter Egg: Double click mascot to reset banner for testing
    if (mascot) {
        mascot.addEventListener('dblclick', () => {
            localStorage.removeItem('onimatch_welcome_closed');
            location.reload();
        });
    }
    
    if (!banner || !card) return;
    
    // Create fragment container
    const fragContainer = document.createElement('div');
    fragContainer.className = 'fragment-container';
    card.appendChild(fragContainer);
    
    const isClosed = localStorage.getItem('onimatch_welcome_closed');
    
    if (!isClosed) {
        setTimeout(startAssembly, 1000);
    } else {
        banner.style.display = 'none';
    }
    
    function createFragments(isClosing = false) {
        fragContainer.innerHTML = '';
        const rows = 8;
        const cols = 12;
        const cardWidth = card.offsetWidth;
        const cardHeight = card.offsetHeight;
        const tileW = cardWidth / cols;
        const tileH = cardHeight / rows;
        
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const tile = document.createElement('div');
                
                // Deterministic Jigsaw Piece Selection based on Grid Position
                let pzClass = 'pz-mid-a';
                if ((r + c) % 2 === 0) pzClass = 'pz-mid-b'; // Checkerboard pattern for interior
                
                // Edge/Corner overwrites
                if (r === 0) pzClass = 'pz-edge-t';
                if (r === rows - 1) pzClass = 'pz-edge-b';
                if (r === 0 && c === 0) pzClass = 'pz-corner-tl';
                
                tile.className = `fragment-tile ${pzClass}`;
                tile.style.width = `${tileW + 2}px`; // Slight overlap for interlocking
                tile.style.height = `${tileH + 2}px`;
                tile.style.top = `${r * tileH}px`;
                tile.style.left = `${c * tileW}px`;
                
                // Random start positions from "all over the place"
                const startX = (Math.random() - 0.5) * 2000;
                const startY = (Math.random() - 0.5) * 2000;
                const startRot = (Math.random() - 0.5) * 720;
                const delay = Math.random() * 0.8;
                
                tile.style.setProperty('--startX', `${startX}px`);
                tile.style.setProperty('--startY', `${startY}px`);
                tile.style.setProperty('--startRot', `${startRot}deg`);
                
                // If closing, set end positions
                if (isClosing) {
                    const endX = (Math.random() - 0.5) * 2000;
                    const endY = (Math.random() - 0.5) * 2000;
                    const endRot = (Math.random() - 0.5) * 720;
                    tile.style.setProperty('--endX', `${endX}px`);
                    tile.style.setProperty('--endY', `${endY}px`);
                    tile.style.setProperty('--endRot', `${endRot}deg`);
                    tile.style.animation = `tile-fly-out 0.8s cubic-bezier(0.19, 1, 0.22, 1) ${delay}s forwards`;
                } else {
                    tile.style.animation = `tile-fly-in 1.2s cubic-bezier(0.19, 1, 0.22, 1) ${delay}s forwards`;
                }
                
                fragContainer.appendChild(tile);
            }
        }
    }
    
    function startAssembly() {
        banner.classList.remove('hidden');
        banner.classList.add('assembling');
        createFragments(false);
        
        // After assembly finishes (max delay 0.8 + duration 1.2 = 2s)
        setTimeout(() => {
            banner.classList.remove('assembling');
            // Fade out tiles
            fragContainer.style.transition = 'opacity 0.5s ease';
            fragContainer.style.opacity = '0';
        }, 2200);
    }
    
    function closeBanner() {
        banner.style.pointerEvents = 'none';
        banner.classList.add('assembling'); // Hide content
        fragContainer.style.opacity = '1';
        createFragments(true);
        localStorage.setItem('onimatch_welcome_closed', 'true');
        
        setTimeout(() => {
            banner.classList.add('hidden');
            banner.style.display = 'none';
        }, 1800);
    }
    
    if (closeBtn) closeBtn.addEventListener('click', closeBanner);
    if (confirmBtn) confirmBtn.addEventListener('click', closeBanner);
})();
