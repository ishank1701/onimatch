/* ============================================
   ONIMATCH V2 — Quiz + Similar Anime + Robot
   ============================================ */

const API_KEY = "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";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const JIKAN_URL = "https://api.jikan.moe/v4";

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
            { label: "Feeling Adventurous", desc: "Ready to explore new worlds", examples: "One Piece, Made in Abyss, Frieren" }
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
            { label: "Comedy", desc: "Pure laughs and absurd situations" }
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
// TAB SWITCHING
// ============================================
function switchTab(tab) {
    activeTab = tab;
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

    // Robot speech
    if (tab === "quiz") {
        setRobotExpression("idle");
        speechText.textContent = "Let's find your match! 🎯";
    } else {
        setRobotExpression("happy");
        speechText.textContent = "Type an anime you love! 🔍";
    }
}

tabQuiz.addEventListener("click", () => switchTab("quiz"));
tabSimilar.addEventListener("click", () => switchTab("similar"));

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
// QUIZ SUBMIT
// ============================================
async function submitQuiz() {
    currentMode = "quiz";
    document.getElementById("tab-bar").style.display = "none";
    sectionQuiz.classList.remove("active");
    loadingContainer.classList.remove("hidden");
    startRunnerAnimation();
    setRobotExpression("searching");

    // Build selections text
    const selTexts = QUIZ_STEPS.map((step, i) => {
        const sel = selections[i];
        if (Array.isArray(sel)) {
            return `${step.key}: ${sel.map(idx => step.choices[idx].label).join(", ")}`;
        } else {
            return `${step.key}: ${step.choices[sel].label}`;
        }
    });

    const userMessage = `User preferences:\n${selTexts.join("\n")}`;

    const systemPrompt = `You are an expert anime recommender. Based on the user's preferences, recommend exactly 30 anime that best match their taste.

Return ONLY a valid JSON array with no markdown or explanation. Each item:
- "title": string (official English or Romaji title)
- "synopsis": string (2-3 sentences)
- "episodes": string (e.g. "24 episodes", "1 Movie", "Ongoing")
- "rating": number (out of 10)
- "genres": array of strings
- "why": string (one sentence — why this matches)
- "difficulty": string ("Beginner-friendly" | "Casual" | "For veterans")

Include variety: well-known titles, hidden gems, classics, newer shows. Order from best match to good match. All 30 must be UNIQUE.`;

    await callAPIAndShowResults(systemPrompt, userMessage);
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
    searchDebounce = setTimeout(() => searchJikanAnime(query), 400);
});

// Close dropdown on click outside
document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-input-wrapper")) {
        autocompleteDropdown.classList.add("hidden");
    }
});

async function searchJikanAnime(query) {
    try {
        const res = await fetch(`${JIKAN_URL}/anime?q=${encodeURIComponent(query)}&limit=6&sfw=true`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.data || data.data.length === 0) {
            autocompleteDropdown.classList.add("hidden");
            return;
        }
        renderAutocomplete(data.data);
    } catch (e) { /* silent */ }
}

function renderAutocomplete(results) {
    autocompleteDropdown.innerHTML = results.map(anime => {
        const img = anime.images?.jpg?.small_image_url || '';
        const title = anime.title || anime.title_english || '';
        const year = anime.year || '';
        const type = anime.type || '';
        const score = anime.score ? `⭐ ${anime.score}` : '';
        return `<div class="ac-item" data-title="${escapeHTML(title)}" data-img="${img}" data-type="${type}" data-year="${year}" data-score="${score}">
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
                score: item.dataset.score
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

    const userMessage = `The user loves the anime "${selectedAnime.title}" (${selectedAnime.type}). Find 30 anime that are similar in theme, style, tone, and appeal.`;

    const systemPrompt = `You are an expert anime recommender. The user has told you an anime they love. Recommend exactly 30 anime that are SIMILAR to it — same vibes, themes, quality, and feel.

Return ONLY a valid JSON array with no markdown or explanation. Each item:
- "title": string (official English or Romaji title)
- "synopsis": string (2-3 sentences)
- "episodes": string (e.g. "24 episodes", "1 Movie", "Ongoing")
- "rating": number (out of 10)
- "genres": array of strings
- "why": string (one sentence — why this is similar)
- "difficulty": string ("Beginner-friendly" | "Casual" | "For veterans")

Do NOT include the anime the user mentioned. Include variety: well-known titles, hidden gems, classics, newer shows. Order from most similar to least similar. All 30 must be UNIQUE.`;

    await callAPIAndShowResults(systemPrompt, userMessage);
}

// ============================================
// SHARED API CALL + RESULTS
// ============================================
async function callAPIAndShowResults(systemPrompt, userMessage) {
    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: "google/gemini-2.0-flash-001",
                max_tokens: 8192,
                temperature: 0.85,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage }
                ]
            })
        });

        if (!response.ok) throw new Error(`API error ${response.status}`);

        const data = await response.json();
        const textContent = data.choices?.[0]?.message?.content;
        if (!textContent) throw new Error("No text in response");

        let recommendations;
        try {
            let jsonStr = textContent.trim().replace(/```json\s*/g, "").replace(/```\s*/g, "");
            const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
            if (jsonMatch) jsonStr = jsonMatch[0];
            recommendations = JSON.parse(jsonStr);
        } catch (e) { throw new Error("Failed to parse recommendations"); }

        if (!Array.isArray(recommendations) || recommendations.length === 0) throw new Error("Invalid format");

        // Fetch covers for first batch
        await fetchCoverImages(recommendations.slice(0, 10));
        allRecommendations = recommendations;

        completeRunnerAnimation();
        await new Promise(r => setTimeout(r, 600));

        currentPage = 1;
        showResultsPage(1);
        setRobotExpression("party");
        setTimeout(() => setRobotExpression("idle"), 4000);

        // Fetch remaining covers in background
        fetchCoverImages(recommendations.slice(10));

    } catch (err) {
        console.error("ONIMATCH Error:", err);
        stopRunnerAnimation();
        setRobotExpression("sad");
        showError(err.message);
    }
}

// ============================================
// JIKAN COVER IMAGES
// ============================================
async function fetchCoverImages(animeList) {
    const promises = animeList.map(async (anime, i) => {
        try {
            await new Promise(r => setTimeout(r, i * 400));
            const res = await fetch(`${JIKAN_URL}/anime?q=${encodeURIComponent(anime.title)}&limit=1`);
            if (res.ok) {
                const data = await res.json();
                if (data.data?.[0]) {
                    anime.coverImage = data.data[0].images?.jpg?.large_image_url || data.data[0].images?.jpg?.image_url || null;
                }
            }
        } catch (e) { /* silent */ }
    });
    await Promise.all(promises);
}

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
        return `<div class="result-card" style="animation-delay:${i * 0.06}s">
            <div class="result-card-inner">${coverImg}<div class="result-info">
                <div class="result-rank-title"><span class="result-rank">${rank}</span><h3 class="result-title">${escapeHTML(anime.title)}</h3></div>
                <div class="result-meta">${genrePills}<span class="result-episodes">📺 ${escapeHTML(anime.episodes)}</span><span class="result-rating">⭐ ${anime.rating}/10</span></div>
                <p class="result-synopsis">${escapeHTML(anime.synopsis)}</p>
            </div></div>
            <div class="result-why">💬 ${escapeHTML(anime.why)}</div>
            <div class="result-footer"><span class="result-difficulty ${diffClass}">${escapeHTML(diffLabel)}</span></div>
        </div>`;
    }).join("");
}

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
// INIT
// ============================================
renderStep(0);
setRobotExpression("idle");
