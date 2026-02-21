/* ===================================================
   SteamTrack – app.js (Pro Aggregator Edition)
   APIs:
     1. store.steampowered.com/api/storesearch   – search
     2. store.steampowered.com/api/appdetails    – price, screenshots, trailers, info
     3. steamspy.com/api.php?request=appdetails  – owners, reviews, playtime (ever/median)
     4. steamspy.com/api.php?request=tag         – browse by tag
     5. api.steampowered.com/ISteamUserStats     – live player count
     6. api.cheapshark.com/api/1.0               – historical low, best deals
     7. pcgamingwiki.com/w/api.php               – ultrawide, HDR info
     8. www.protondb.com/api/v1/reports/summaries – Linux/Deck compatibility
=================================================== */

// ──────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────
const CORS_PROXY = 'https://corsproxy.io/?url=';
const STEAMSPY_BASE = 'https://steamspy.com/api.php';
const REFRESH_MS = 60_000;

const STEAM_IMG = id => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
const STEAM_HERO = id => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_hero.jpg`;
const STEAM_LINK = id => `https://store.steampowered.com/app/${id}/`;
const proxied = url => CORS_PROXY + encodeURIComponent(url);

// ──────────────────────────────────────────────
// DOM REFS
// ──────────────────────────────────────────────
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const autocompleteBox = document.getElementById('autocomplete');
const spinner = document.getElementById('loadingSpinner');
const errorMsg = document.getElementById('errorMsg');
const errorText = document.getElementById('errorText');
const emptyState = document.getElementById('emptyState');
const featuredCard = document.getElementById('featuredCard');
const resultsSection = document.getElementById('resultsSection');
const resultsGrid = document.getElementById('resultsGrid');
const trendingSection = document.getElementById('section-trending');
const trendingGrid = document.getElementById('trendingGrid');

// New section for tags
const sectionTag = document.getElementById('section-tag');
const tagGrid = document.getElementById('tagGrid');
const tagResultsTitle = document.getElementById('tagResultsTitle');

const featuredBanner = document.getElementById('featuredBanner');
const featuredPlayers = document.getElementById('featuredPlayers');
const featuredName = document.getElementById('featuredName');
const featuredDevPub = document.getElementById('featuredDevPub');
const featuredDesc = document.getElementById('featuredDesc');
const featuredTags = document.getElementById('featuredTags');
const featuredMedia = document.getElementById('featuredMedia');
const featuredLink = document.getElementById('featuredLink');

const statPlayersVal = document.getElementById('statPlayersVal');
const statCCUVal = document.getElementById('statCCUVal');
const statOwnersVal = document.getElementById('statOwnersVal');
const statPriceVal = document.getElementById('statPriceVal');
const statScoreVal = document.getElementById('statScoreVal');
const statReviewsCountVal = document.getElementById('statReviewsCountVal');
const statAvgForeverVal = document.getElementById('statAvgForeverVal');
const statMedianForeverVal = document.getElementById('statMedianForeverVal');
const statAvg2wVal = document.getElementById('statAvg2wVal');
const statAchievementsVal = document.getElementById('statAchievementsVal');
const statReleaseDateVal = document.getElementById('statReleaseDateVal');
const statStorageVal = document.getElementById('statStorageVal');
const statPlatformsVal = document.getElementById('statPlatformsVal');
const statLanguagesVal = document.getElementById('statLanguagesVal');
const statControllerVal = document.getElementById('statControllerVal');

// PRO STATS
const statHistLowVal = document.getElementById('statHistLowVal');
const statBestDealVal = document.getElementById('statBestDealVal');
const statUltrawideVal = document.getElementById('statUltrawideVal');
const statHDRVal = document.getElementById('statHDRVal');
const statDeckVal = document.getElementById('statDeckVal');

// ──────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────
let allApps = [];
let allAppsLoaded = false;
let debounceTimer = null;
const ITEMS_PER_PAGE = 24;

// State
let liveAppId = null;
let liveInterval = null;
let countdownTimer = null;
let secondsLeft = 0;
let lastTagData = [];
let lastTrendingData = [];
let trendingType = 'top100in2weeks';
let pinnedGames = JSON.parse(localStorage.getItem('steamTrackPins') || '[]');
let USER_REGION = { cc: 'US', lang: 'english' }; // Defaults

// ──────────────────────────────────────────────
// FORMATTERS / HELPERS
// ──────────────────────────────────────────────
function fmt(num) {
    if (num === undefined || num === null || num === '') return '—';
    const n = typeof num === 'string' ? parseInt(num.replace(/,/g, ''), 10) : num;
    if (isNaN(n)) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
}

function formatOwners(str) {
    if (!str) return '—';
    const parts = str.split(' .. ');
    if (parts.length === 2) {
        const lo = parseInt(parts[0].replace(/,/g, ''), 10);
        const hi = parseInt(parts[1].replace(/,/g, ''), 10);
        if (!isNaN(lo) && !isNaN(hi)) return `${fmt(lo)} – ${fmt(hi)}`;
    }
    return str;
}

function fmtMinutes(mins) {
    if (!mins || mins <= 0) return '—';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function toTitleCase(str) {
    return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/** Parses Storage from PC requirements HTML string */
function parseStorage(html) {
    if (!html) return '—';
    // Strip HTML tags and normalize spaces
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    // Look for "Storage: XX GB" or similar with flexible labels
    const regex = /(?:Storage|Available space|Disk space|Hard Drive|HDD|SSD):\s*([\d.]+\s*[GM]T?B)/i;
    const match = text.match(regex);
    if (match) return match[1];

    // Fallback 1: search for GB/MB size after specific keywords
    const keywords = ['storage', 'space', 'drive', 'ssd', 'hdd'];
    for (const kw of keywords) {
        const idx = text.toLowerCase().indexOf(kw);
        if (idx !== -1) {
            const after = text.substring(idx);
            const sizeMatch = after.match(/([\d.]+\s*[GM]B)/i);
            if (sizeMatch) return sizeMatch[1];
        }
    }

    // Fallback 2: first size found in text
    const lastDitch = text.match(/([\d.]+\s*[GM]B)/i);
    return lastDitch ? lastDitch[1] : '—';
}

/** Counts languages from Steam's supported languages string */
function countLanguages(str) {
    if (!str) return '—';
    const clean = str.replace(/<[^>]*>/g, '');
    const list = clean.split(',').map(s => s.trim()).filter(s => s);
    return list.length > 0 ? list.length : '—';
}

function setVisible(el, visible) { if (el) el.classList.toggle('hidden', !visible); }
function showError(msg) { errorText.textContent = msg; setVisible(errorMsg, true); }
function clearError() { setVisible(errorMsg, false); }
function setLoading(on) { setVisible(spinner, on); searchBtn.disabled = on; }

function flashPlayerStat() {
    statPlayersVal.classList.remove('stat-flash');
    void statPlayersVal.offsetWidth;
    statPlayersVal.classList.add('stat-flash');
}

// ──────────────────────────────────────────────
// LIVE REFRESH logic
// ──────────────────────────────────────────────
function stopLiveRefresh() {
    clearInterval(liveInterval);
    clearInterval(countdownTimer);
    liveInterval = countdownTimer = null;
    liveAppId = null;
    secondsLeft = 0;
}

async function refreshPlayerCount() {
    if (!liveAppId) return;
    try {
        const raw = `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${liveAppId}`;
        const json = await fetch(proxied(raw)).then(r => r.json());
        const count = json?.response?.player_count ?? null;
        if (count !== null) {
            const f = fmt(count);
            featuredPlayers.innerHTML = `${f} players online &nbsp;<span id="refreshHint" class="refresh-hint">↻ ${secondsLeft}s</span>`;
            statPlayersVal.textContent = f;
            flashPlayerStat();
        }
    } catch (e) { console.warn('Live refresh failed:', e); }
}

function startLiveRefresh(appId) {
    stopLiveRefresh();
    liveAppId = appId;
    secondsLeft = REFRESH_MS / 1000;

    countdownTimer = setInterval(() => {
        secondsLeft--;
        if (secondsLeft <= 0) secondsLeft = REFRESH_MS / 1000;
        const hint = document.getElementById('refreshHint');
        if (hint) hint.textContent = `↻ ${secondsLeft}s`;
    }, 1000);

    liveInterval = setInterval(() => {
        refreshPlayerCount();
        secondsLeft = REFRESH_MS / 1000;
    }, REFRESH_MS);
}

// ──────────────────────────────────────────────
// API CALLS
// ──────────────────────────────────────────────

async function detectUserRegion() {
    try {
        // Use a lightweight, privacy-friendly geo-API
        const res = await fetch('https://ipapi.co/json/').then(r => r.json());
        if (res && res.country_code) {
            USER_REGION.cc = res.country_code;
            const cc = res.country_code;
            // Map common regions to Steam supported languages
            if (cc === 'UA') USER_REGION.lang = 'ukrainian';
            else if (['DE', 'AT', 'CH'].includes(cc)) USER_REGION.lang = 'german';
            else if (['FR', 'BE', 'LU'].includes(cc)) USER_REGION.lang = 'french';
            else if (['ES', 'MX', 'AR', 'CL', 'CO'].includes(cc)) USER_REGION.lang = 'spanish';
            else if (cc === 'PL') USER_REGION.lang = 'polish';
            else if (cc === 'TR') USER_REGION.lang = 'turkish';
            else if (cc === 'BR') USER_REGION.lang = 'brazilian';
            else if (cc === 'IT') USER_REGION.lang = 'italian';

            console.log(`Privacy-Safe Region Detected: ${USER_REGION.cc} (${USER_REGION.lang})`);
        }
    } catch (e) {
        console.warn('Region detection skipped or failed, using US/English privacy defaults.');
    }
}

async function loadAppList() {
    if (allAppsLoaded) return;
    try {
        const data = await fetch(proxied('https://api.steampowered.com/ISteamApps/GetAppList/v2/')).then(r => r.json());
        allApps = (data?.applist?.apps || []).filter(a => a.name && a.name.trim());
        allAppsLoaded = true;
    } catch (e) { console.warn('App list failed:', e); }
}

async function steamStoreSearch(term) {
    const raw = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=${USER_REGION.lang}&cc=${USER_REGION.cc}&category1=998`;
    const data = await fetch(proxied(raw)).then(r => r.json());
    return (data.items || []).map(item => ({ appid: item.id, name: item.name }));
}

async function steamStoreDetails(appId) {
    try {
        const raw = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=${USER_REGION.lang}&cc=${USER_REGION.cc}`;
        const json = await fetch(proxied(raw)).then(r => r.json());
        const entry = json?.[appId];
        return entry?.success ? entry.data : null;
    } catch (e) { console.warn('Store details failed:', e); return null; }
}

async function steamspyApp(appId) {
    try {
        const raw = `${STEAMSPY_BASE}?request=appdetails&appid=${appId}`;
        return await fetch(proxied(raw)).then(r => r.json());
    } catch (e) { console.warn('SteamSpy failed:', e); return null; }
}

async function getCurrentPlayers(appId) {
    try {
        const raw = `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appId}`;
        const json = await fetch(proxied(raw)).then(r => r.json());
        return json?.response?.player_count ?? null;
    } catch (e) { return null; }
}

async function fetchCheapShark(name) {
    try {
        // Step 1: Find the game ID in CheapShark
        const listUrl = `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(name)}&limit=1`;
        const list = await fetch(proxied(listUrl)).then(r => r.json());
        if (!list || !list.length) return null;

        // Step 2: Get full details including historical low
        const gameID = list[0].gameID;
        const detailUrl = `https://www.cheapshark.com/api/1.0/games?id=${gameID}`;
        return await fetch(proxied(detailUrl)).then(r => r.json());
    } catch (e) { console.warn('CheapShark failed:', e); return null; }
}

async function fetchPCG(appid) {
    try {
        const url = `https://www.pcgamingwiki.com/w/api.php?action=cargoquery&format=json&tables=Video&fields=Ultrawide_support,HDR_support&where=Steam_AppID_exact%3D%22${appid}%22`;
        const res = await fetch(proxied(url)).then(r => r.json());
        return res?.cargoquery?.[0]?.title || null;
    } catch (e) { console.warn('PCG failed:', e); return null; }
}

async function fetchProtonDB(appid) {
    try {
        const url = `https://www.protondb.com/api/v1/reports/summaries/${appid}.json`;
        const res = await fetch(proxied(url)).then(r => r.json());
        return res || null;
    } catch (e) { console.warn('ProtonDB failed:', e); return null; }
}

async function loadByTag(tag) {
    searchInput.value = '';
    setLoading(true);
    setVisible(sectionTag, false);
    setVisible(resultsSection, false);
    setVisible(trendingSection, false);
    setVisible(featuredCard, false);
    setVisible(emptyState, false);
    clearError();
    tagResultsTitle.textContent = `Browsing: ${tag}`;

    // Reset Sorting UI to Popularity
    document.querySelectorAll('#section-tag .sort-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.sort === 'popularity');
    });

    try {
        console.log(`Step 1: Attempting Tag Discovery for "${tag}"...`);
        // Use Steam's suggestion API to find the TagID
        const suggestUrl = `https://store.steampowered.com/search/suggest?term=${encodeURIComponent(tag)}&f=tags`;
        const suggestHtml = await fetch(proxied(suggestUrl)).then(r => r.text());

        // Extract data-ds-tagid="..."
        const tagMatch = suggestHtml.match(/data-ds-tagid="(\d+)"/);
        let apps = [];

        if (tagMatch) {
            const tagId = tagMatch[1];
            console.log(`Step 2: Fetching official results for TagID ${tagId}...`);
            // Increased count to 250 for "Much more like 200+" request
            const resultsUrl = `https://store.steampowered.com/search/results/?query&start=0&count=250&tags=${tagId}&infinite=1`;
            const resultsJson = await fetch(proxied(resultsUrl)).then(r => r.json());
            apps = parseOfficialResults(resultsJson?.results_html || '');
        } else {
            // UNIVERSAL FALLBACK: Search for the keyword if it's not a primary tag
            console.log(`Fallback: Searching keyword "${tag}" as a general category...`);
            const fallbackUrl = `https://store.steampowered.com/search/results/?term=${encodeURIComponent(tag)}&count=250&infinite=1`;
            const resultsJson = await fetch(proxied(fallbackUrl)).then(r => r.json());
            apps = parseOfficialResults(resultsJson?.results_html || '');
        }

        if (!apps.length) {
            showError(`Steam returned no games for "${tag}".`);
            setVisible(emptyState, true);
            return;
        }

        lastTagData = apps.map((a, i) => ({ ...a, rank: i }));
        renderInfiniteGrid(lastTagData, 'tagGrid');
        setVisible(sectionTag, true);
        window.scrollTo({ top: 400, behavior: 'smooth' });
    } catch (e) {
        console.error('Category load failed:', e);
        showError('Steam Store search is currently unreachable.');
    } finally {
        setLoading(false);
    }
}

/**
 * High-Reliability Scraper for Official Steam Store search results.
 * Now extracts AppID, Name, Direct Image URL, Price, and Release Date.
 */
function parseOfficialResults(html) {
    if (!html) return [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const rows = doc.querySelectorAll('a.search_result_row');

    return Array.from(rows).map((row, i) => {
        const appid = row.getAttribute('data-ds-appid');
        const name = row.querySelector('.title')?.textContent?.trim();
        // High-Reliability Image: Take the exact src Steam used in its own search
        const capsule = row.querySelector('.search_capsule img')?.getAttribute('src');
        const released = row.querySelector('.search_released')?.textContent?.trim();
        const price = row.querySelector('.search_price')?.textContent?.trim();

        if (!appid || !name) return null;

        return {
            appid,
            name,
            capsule,
            search_released: released || '—',
            search_price: price || '—',
            rank: i
        };
    }).filter(a => a);
}

// ──────────────────────────────────────────────
// BUILD FEATURED CARD
// ──────────────────────────────────────────────
async function buildFeaturedCard(app) {
    const appId = String(app.appid);
    stopLiveRefresh();

    // Reset UI
    featuredBanner.src = STEAM_IMG(appId); // Initial Header
    // Try High-Res Hero background
    const heroImg = new Image();
    heroImg.onload = () => featuredBanner.src = STEAM_HERO(appId);
    heroImg.src = STEAM_HERO(appId);

    featuredBanner.alt = app.name;
    featuredName.textContent = app.name;
    featuredLink.href = STEAM_LINK(appId);
    featuredDesc.textContent = '';
    featuredDevPub.textContent = '';
    featuredTags.innerHTML = '';
    featuredMedia.innerHTML = '';
    featuredPlayers.textContent = 'Aggregating pro data…';

    const statEls = [
        statPlayersVal, statCCUVal, statOwnersVal, statPriceVal, statScoreVal,
        statReviewsCountVal, statAvgForeverVal, statMedianForeverVal, statAvg2wVal,
        statAchievementsVal, statReleaseDateVal, statStorageVal, statPlatformsVal,
        statLanguagesVal, statControllerVal, statHistLowVal, statBestDealVal,
        statUltrawideVal, statHDRVal, statDeckVal
    ];
    statEls.forEach(el => { if (el) el.textContent = '…'; });

    setVisible(featuredCard, true);

    // ── PARALLEL AGGREGATION ──
    const [storeRes, spyRes, playersRes, csRes, pcgRes, pdbRes] = await Promise.allSettled([
        steamStoreDetails(appId),
        steamspyApp(appId),
        getCurrentPlayers(appId),
        fetchCheapShark(app.name),
        fetchPCG(appId),
        fetchProtonDB(appId)
    ]);

    const store = storeRes.status === 'fulfilled' ? storeRes.value : null;
    const spy = spyRes.status === 'fulfilled' ? spyRes.value : null;
    const players = playersRes.status === 'fulfilled' ? playersRes.value : null;
    const cs = csRes.status === 'fulfilled' ? csRes.value : null;
    const pcg = pcgRes.status === 'fulfilled' ? pcgRes.value : null;
    const pdb = pdbRes.status === 'fulfilled' ? pdbRes.value : null;

    try {
        // ── Description & Dev/Pub ──
        const dText = store?.short_description || spy?.short_description || '';
        featuredDesc.innerHTML = dText.length > 500 ? dText.substring(0, 500) + '...' : dText;

        const dev = spy?.developer || store?.developers?.[0] || '';
        const pub = spy?.publisher || store?.publishers?.[0] || '';
        if (dev || pub) {
            const parts = [];
            if (dev) parts.push(`Dev: ${dev}`);
            if (pub && pub !== dev) parts.push(`Pub: ${pub}`);
            featuredDevPub.textContent = parts.join('   •   ');
        }

        // ── Tags (Interactive) ──
        const genres = (store?.genres || []).map(g => ({ display: toTitleCase((g.description || '').trim()), value: (g.description || '').trim() })).filter(t => t.display);
        const spyTags = spy?.tags ? Object.keys(spy.tags).map(t => ({ display: toTitleCase(String(t).trim()), value: String(t).trim() })).filter(t => t.display) : [];
        const seenTags = new Set();
        const allTags = [...genres, ...spyTags].filter(t => {
            const key = t.display.toLowerCase();
            if (seenTags.has(key)) return false;
            seenTags.add(key);
            return true;
        }).slice(0, 10);
        allTags.forEach(t => {
            const span = document.createElement('span');
            span.className = 'tag';
            span.textContent = t.display;
            span.onclick = (e) => { e.stopPropagation(); loadByTag(t.value); };
            featuredTags.appendChild(span);
        });

        // ── Media Gallery ──
        if (store?.movies) {
            store.movies.slice(0, 1).forEach(m => {
                const vidUrl = m?.webm?.max || m?.mp4?.max || m?.webm?.['480'] || m?.mp4?.['480'];
                if (vidUrl) {
                    const div = document.createElement('div');
                    div.className = 'media-item';
                    div.innerHTML = `<video controls muted loop poster="${m.thumbnail || ''}"><source src="${vidUrl}" type="video/webm"></video>`;
                    featuredMedia.appendChild(div);
                }
            });
        }
        if (store?.screenshots) {
            store.screenshots.slice(0, 8).forEach(s => {
                const div = document.createElement('div');
                div.className = 'media-item';
                div.innerHTML = `<img src="${s.path_thumbnail}" alt="Screenshot" onclick="window.open('${s.path_full}', '_blank')"/>`;
                featuredMedia.appendChild(div);
            });
        }

        // ── STATS POPULATION ──

        // Group 1: Live
        if (players !== null) {
            const f = fmt(players);
            featuredPlayers.innerHTML = `${f} players online &nbsp;<span id="refreshHint" class="refresh-hint">↻ 60s</span>`;
            statPlayersVal.textContent = f;
        } else {
            featuredPlayers.textContent = 'Player count unavailable';
            statPlayersVal.textContent = '—';
        }
        statCCUVal.textContent = spy?.ccu ? fmt(spy.ccu) : '—';
        statOwnersVal.textContent = formatOwners(spy?.owners);

        const pos = parseInt(spy?.positive) || 0, neg = parseInt(spy?.negative) || 0, total = pos + neg;
        if (total > 0) statScoreVal.textContent = `${Math.round((pos / total) * 100)}%`;
        else if (store?.metacritic?.score) statScoreVal.textContent = `${store.metacritic.score}/100`;
        else statScoreVal.textContent = '—';
        statReviewsCountVal.textContent = total > 0 ? fmt(total) : '—';

        // Group 2: Financials
        if (store?.is_free || (spy?.price != null && parseInt(spy.price) === 0)) {
            statPriceVal.textContent = 'Free';
        } else if (store?.price_overview) {
            const disc = store.price_overview.discount_percent;
            statPriceVal.textContent = disc > 0 ? `${store.price_overview.final_formatted} (−${disc}%)` : store.price_overview.final_formatted;
        } else if (spy?.price) {
            statPriceVal.textContent = `$${(parseInt(spy.price) / 100).toFixed(2)}`;
        } else {
            statPriceVal.textContent = '—';
        }

        // Hist Low & Best Deal (CheapShark - explicitly labeled USD)
        if (cs && cs.cheapestPriceEver) {
            statHistLowVal.textContent = `$${parseFloat(cs.cheapestPriceEver.price).toFixed(2)} USD`;
        } else { statHistLowVal.textContent = '—'; }

        if (cs && cs.deals && cs.deals.length > 0) {
            const best = cs.deals[0];
            statBestDealVal.textContent = `$${parseFloat(best.price).toFixed(2)} USD`;
        } else { statBestDealVal.textContent = '—'; }

        let achievCount = '—';
        try {
            if (store?.achievements?.total) achievCount = parseInt(store.achievements.total).toLocaleString();
            else if (spy?.achievements != null && !isNaN(parseInt(spy.achievements))) achievCount = parseInt(spy.achievements).toLocaleString();
        } catch (e) { }
        statAchievementsVal.textContent = achievCount;

        const rd = store?.release_date;
        statReleaseDateVal.textContent = (rd && !rd.coming_soon) ? rd.date : (rd?.coming_soon ? 'Upcoming' : '—');

        // Group 3: Playtime & Metadata
        statAvgForeverVal.textContent = fmtMinutes(spy?.average_forever);
        statMedianForeverVal.textContent = fmtMinutes(spy?.median_forever);
        statAvg2wVal.textContent = fmtMinutes(spy?.average_2weeks);
        statLanguagesVal.textContent = countLanguages(store?.supported_languages);

        const pList = [];
        if (store?.platforms?.windows) pList.push('Win');
        if (store?.platforms?.mac) pList.push('Mac');
        if (store?.platforms?.linux) pList.push('Lin');
        statPlatformsVal.textContent = pList.length > 0 ? pList.join(', ') : '—';

        // Group 4: Technical & Deck
        statStorageVal.textContent = parseStorage(store?.pc_requirements?.minimum || store?.pc_requirements?.recommended);
        statControllerVal.textContent = store?.controller_support ? toTitleCase(String(store.controller_support)) : '—';

        // PCGamingWiki (Technical)
        statUltrawideVal.textContent = pcg?.Ultrawide_support === 'true' ? 'Supported' : (pcg?.Ultrawide_support === 'false' ? 'No' : '—');
        statHDRVal.textContent = pcg?.HDR_support === 'true' ? 'Supported' : (pcg?.HDR_support === 'false' ? 'No' : '—');

        // Deck / Proton Status
        let deckText = '—';
        // Check official Deck status from Steam first
        if (store?.content_descriptors?.notes?.toLowerCase().includes('steam deck')) deckText = 'Compatible';
        // Then ProtonDB rating
        if (pdb && pdb.tier) {
            const tierStr = toTitleCase(pdb.tier);
            deckText = deckText === 'Compatible' ? `Steam Deck (${tierStr})` : tierStr;
        }
        statDeckVal.textContent = deckText;

    } catch (err) {
        console.error('Error populating card:', err);
    }

    startLiveRefresh(appId);
}

// ──────────────────────────────────────────────
// UI BUILDERS & SEARCH
// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// LOCALIZATION & SORTING ENGINE (Absolute Truth)
// ──────────────────────────────────────────────

const UA_MONTHS = {
    'січ': 0, 'лют': 1, 'бер': 2, 'квіт': 3, 'трав': 4, 'черв': 5,
    'лип': 6, 'серп': 7, 'вер': 8, 'жовт': 9, 'лист': 10, 'груд': 11
};

const EN_MONTHS = {
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
};

/** Parses localized Steam date strings (shorthand and full) */
function parseSteamDate(str) {
    if (!str || str === '—' || str.toLowerCase().includes('coming soon') || str.toLowerCase().includes('upcoming')) return 0;

    const s = str.toLowerCase().trim();
    const parts = s.split(/\s+/); // [day, month, year] or [month, day, year]

    let day = 1, month = 0, year = new Date().getFullYear();

    parts.forEach(p => {
        const clean = p.replace(/,/g, '');
        if (!isNaN(parseInt(clean)) && clean.length >= 4) year = parseInt(clean);
        else if (!isNaN(parseInt(clean))) day = parseInt(clean);
        else {
            for (let m in UA_MONTHS) if (clean.includes(m)) month = UA_MONTHS[m];
            for (let m in EN_MONTHS) if (clean.includes(m)) month = EN_MONTHS[m];
        }
    });

    return new Date(year, month, day).getTime();
}

/** Localizes a date for the UI based on browser locale */
function localizeDate(dateStr) {
    const ts = parseSteamDate(dateStr);
    if (!ts) return dateStr;
    const locale = navigator.language.startsWith('uk') ? 'uk-UA' : 'en-US';
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ts));
}

/** Renders a grid with Infinite Scroll */
let currentObserver = null;

function renderInfiniteGrid(data, containerId, reset = true) {
    const grid = document.getElementById(containerId);
    if (!grid) return;

    if (reset) {
        grid.innerHTML = '';
        grid.dataset.page = 0;
        if (currentObserver) currentObserver.disconnect();
    }

    const page = parseInt(grid.dataset.page) || 0;
    const start = page * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const slice = data.slice(start, end);

    slice.forEach((app, i) => grid.appendChild(buildGameCard(app, start + i)));

    if (end < data.length) {
        setupInfiniteScroll(grid, data, containerId);
    }
}

function setupInfiniteScroll(grid, data, containerId) {
    let sentinel = grid.querySelector('.scroll-sentinel');
    if (!sentinel) {
        sentinel = document.createElement('div');
        sentinel.className = 'scroll-sentinel';
        sentinel.style.width = '100%';
        sentinel.style.height = '1px';
        grid.appendChild(sentinel);
    }

    currentObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            grid.dataset.page = (parseInt(grid.dataset.page) || 0) + 1;
            sentinel.remove();
            renderInfiniteGrid(data, containerId, false);
        }
    }, { rootMargin: '400px' });

    currentObserver.observe(sentinel);
}

/** Sorting logic (Normalized & Robust) */
function sortData(data, type) {
    const sorted = [...data];
    if (type === 'name') {
        sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (type === 'date') {
        sorted.sort((a, b) => {
            const ta = parseSteamDate(a.released || a.search_released);
            const tb = parseSteamDate(b.released || b.search_released);
            return tb - ta; // Newest first
        });
    } else if (type === 'popularity') {
        sorted.sort((a, b) => {
            const pa = parseInt(a.players_2weeks) || 0;
            const pb = parseInt(b.players_2weeks) || 0;
            if (pa !== pb) return pb - pa;
            // Fallback to original API rank if players count is identical (or 0)
            return (a.rank || 0) - (b.rank || 0);
        });
    }
    return sorted;
}

function buildGameCard(app, index = 0) {
    const appId = String(app.appid || app.id);
    const card = document.createElement('div');
    card.className = 'game-card';
    card.style.animationDelay = `${index * 0.05}s`;

    // Fallback logic for stats in the card
    let metaText = formatOwners(app.owners);
    let badges = '';
    if (app.players_2weeks != null) {
        badges = `<span class="game-card-players"><span class="dot-green"></span>${fmt(app.players_2weeks)}</span>`;
    } else if (app.search_price && app.search_price !== '—') {
        badges = `<span class="game-card-players" style="background: rgba(0, 229, 255, 0.1); color: #00e5ff;">${app.search_price}</span>`;
    } else if (app.search_released && app.search_released !== '—') {
        badges = `<span class="game-card-players" style="background: rgba(255, 255, 255, 0.1);">${app.search_released}</span>`;
    }

    const imgUrl = app.capsule || STEAM_IMG(appId);
    const isPinned = pinnedGames.some(p => String(p.appid || p.id) === appId);
    const localizedDate = localizeDate(app.search_released);

    card.innerHTML = `
    <div class="pin-action ${isPinned ? 'pinned' : ''}" onclick="event.stopPropagation(); window.togglePinById('${appId}', this, ${index})">${isPinned ? '📌' : '➕'}</div>
    <img src="${imgUrl}" alt="${app.name}" loading="lazy" onerror="this.onerror=null; this.src='https://community.cloudflare.steamstatic.com/public/images/apps/${appId}/header.jpg';"/>
    <div class="game-card-body">
      <div class="game-card-name" title="${app.name}">${app.name}</div>
      <div class="game-card-meta">
        ${badges.replace(app.search_released, localizedDate)}
        <span>${metaText}</span>
      </div>
    </div>
  `;
    card.addEventListener('click', () => { searchInput.value = app.name; runSearch(app.name, appId); window.scrollTo({ top: 0, behavior: 'smooth' }); });

    // Store original data & ID for pinning
    card.dataset.appData = JSON.stringify(app);
    card.dataset.appId = appId;
    return card;
}

function renderAutocomplete(results) {
    autocompleteBox.innerHTML = '';
    if (!results.length) { setVisible(autocompleteBox, false); return; }
    results.forEach(app => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.innerHTML = `<img src="${STEAM_IMG(app.appid)}" onerror="this.style.display='none'"/><span>${app.name}</span>`;
        item.addEventListener('mousedown', e => { e.preventDefault(); searchInput.value = app.name; setVisible(autocompleteBox, false); runSearch(app.name, app.appid); });
        autocompleteBox.appendChild(item);
    });
    setVisible(autocompleteBox, true);
}

async function runSearch(query, knownAppId = null) {
    const q = query.trim(); if (!q) return;
    stopLiveRefresh(); clearError(); setLoading(true); setVisible(emptyState, false); setVisible(featuredCard, false); setVisible(resultsSection, false); setVisible(trendingSection, false); setVisible(sectionTag, false); setVisible(autocompleteBox, false);
    try {
        let rs = knownAppId ? [{ appid: knownAppId, name: q }] : await steamStoreSearch(q);
        if (!rs.length) { showError(`No games found for "${q}".`); setVisible(emptyState, true); return; }
        await buildFeaturedCard(rs[0]);
        const rest = rs.slice(1, 250);
        if (rest.length > 0) {
            const ranked = rest.map((a, i) => ({ ...a, rank: i }));
            renderInfiniteGrid(ranked, 'resultsGrid');
            setVisible(resultsSection, true);
        }
    } catch (e) { showError('Search failed.'); } finally { setLoading(false); }
}

async function loadTrending(type = 'top100in2weeks') {
    trendingType = type;
    stopLiveRefresh();
    setLoading(true);
    setVisible(emptyState, false);
    setVisible(featuredCard, false);
    setVisible(resultsSection, false);
    setVisible(sectionTag, false);
    clearError();

    // Reset Sorting UI to Popularity
    document.querySelectorAll('#section-trending .sort-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.sort === 'popularity');
    });

    const sub = document.getElementById('trendingSub');

    try {
        let apps = [];
        if (type === 'top100in2weeks') {
            const data = await fetch(proxied(`${STEAMSPY_BASE}?request=top100in2weeks`)).then(r => r.json());
            apps = Object.values(data);
            sub.textContent = 'Most played Steam games in last 2 weeks (via SteamSpy)';
        } else if (type === 'topsellers') {
            const resultsUrl = `https://store.steampowered.com/search/results/?query&start=0&count=250&filter=topsellers&infinite=1&cc=${USER_REGION.cc}&l=${USER_REGION.lang}`;
            const json = await fetch(proxied(resultsUrl)).then(r => r.json());
            apps = parseOfficialResults(json.results_html);
            sub.textContent = `Current worldwide top sellers on the Steam Store (${USER_REGION.cc})`;
        } else if (type === 'trending') {
            const resultsUrl = `https://store.steampowered.com/search/results/?query&start=0&count=250&filter=popularnew&infinite=1&cc=${USER_REGION.cc}&l=${USER_REGION.lang}`;
            const json = await fetch(proxied(resultsUrl)).then(r => r.json());
            apps = parseOfficialResults(json.results_html);
            sub.textContent = `New releases trending right now on Steam (${USER_REGION.cc})`;
        }

        lastTrendingData = apps.map((a, i) => ({ ...a, rank: i }));
        renderInfiniteGrid(lastTrendingData, 'trendingGrid');
        setVisible(trendingSection, true);
    } catch (e) { showError('Could not load market data.'); } finally { setLoading(false); }
}

/** Renders a grid with pagination */
function renderPagedGrid(data, containerId, page) {
    const grid = document.getElementById(containerId);
    const pagination = document.getElementById(containerId.replace('Grid', 'Pagination'));
    if (!grid) return;

    grid.innerHTML = '';
    const start = page * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const slice = data.slice(start, end);

    slice.forEach((app, i) => grid.appendChild(buildGameCard(app, i)));
    renderPaginationControls(data, containerId, page, pagination);
}

/** Builds pagination UI */
function renderPaginationControls(data, containerId, currentPage, container) {
    if (!container) return;
    const totalPages = Math.ceil(data.length / ITEMS_PER_PAGE);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    container.innerHTML = '';

    // Prev
    const prev = document.createElement('button');
    prev.className = 'page-btn';
    prev.innerHTML = '←';
    prev.disabled = currentPage === 0;
    prev.onclick = () => { renderPagedGrid(data, containerId, currentPage - 1); window.scrollTo({ top: 400, behavior: 'smooth' }); };
    container.appendChild(prev);

    // Pages
    for (let i = 0; i < totalPages; i++) {
        if (i > 2 && i < totalPages - 3 && Math.abs(i - currentPage) > 1) {
            if (container.lastChild.className !== 'page-dots') {
                const dots = document.createElement('span');
                dots.className = 'page-dots';
                dots.textContent = '...';
                container.appendChild(dots);
            }
            continue;
        }
        const btn = document.createElement('button');
        btn.className = `page-btn ${i === currentPage ? 'active' : ''}`;
        btn.textContent = i + 1;
        btn.onclick = () => { renderPagedGrid(data, containerId, i); window.scrollTo({ top: 400, behavior: 'smooth' }); };
        container.appendChild(btn);
    }

    // Next
    const next = document.createElement('button');
    next.className = 'page-btn';
    next.innerHTML = '→';
    next.disabled = currentPage === totalPages - 1;
    next.onclick = () => { renderPagedGrid(data, containerId, currentPage + 1); window.scrollTo({ top: 400, behavior: 'smooth' }); };
    container.appendChild(next);
}

// Event Listeners for sorting
document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const parent = btn.parentElement;
        parent.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const gridId = parent.dataset.grid;
        const type = btn.dataset.sort;

        if (gridId === 'tagGrid') {
            lastTagData = sortData(lastTagData, type);
            renderInfiniteGrid(lastTagData, 'tagGrid');
        } else {
            lastTrendingData = sortData(lastTrendingData, type);
            renderInfiniteGrid(lastTrendingData, 'trendingGrid');
        }
    });
});

// ──────────────────────────────────────────────
// COMPARISON ENGINE (Liquid Pro)
// ──────────────────────────────────────────────

/** Global Toggle for External & In-Card usage */
window.togglePinById = function (id, btnEl = null, index = 0) {
    const idx = pinnedGames.findIndex(p => String(p.appid || p.id) === id);
    if (idx > -1) {
        pinnedGames.splice(idx, 1);
        if (btnEl) btnEl.classList.remove('pinned');
        if (btnEl) btnEl.innerHTML = '➕';
    } else {
        if (pinnedGames.length >= 5) {
            showError('Comparison list is full (max 5). Remove one to add more.');
            return;
        }
        // Recover app data from card dataset if possible
        // Recover app data from card dataset using explicit ID
        const card = document.querySelector(`.game-card[data-app-id="${id}"]`);
        if (card) {
            pinnedGames.push(JSON.parse(card.dataset.appData));
            if (btnEl) btnEl.classList.add('pinned');
            if (btnEl) btnEl.innerHTML = '📌';
        }
    }
    savePins();
    renderPins();
}

function savePins() {
    localStorage.setItem('steamTrackPins', JSON.stringify(pinnedGames));
}

function renderPins() {
    const tray = document.getElementById('compareTray');
    const grid = document.getElementById('pinGrid');
    const count = document.getElementById('pinCount');
    if (!tray || !grid) return;

    if (pinnedGames.length === 0) {
        tray.classList.add('hidden');
        return;
    }

    tray.classList.remove('hidden');
    count.textContent = pinnedGames.length;
    grid.innerHTML = '';

    pinnedGames.forEach(app => {
        const id = String(app.appid || app.id);
        const card = document.createElement('div');
        card.className = 'pin-card';
        card.innerHTML = `
            <button class="unpin-btn" onclick="event.stopPropagation(); window.togglePinById('${id}')">×</button>
            <img src="${app.capsule || STEAM_IMG(id)}" alt="${app.name}"/>
            <div class="pin-card-name">${app.name}</div>
        `;
        card.onclick = () => { buildFeaturedCard(app); window.scrollTo({ top: 0, behavior: 'smooth' }); };
        grid.appendChild(card);
    });
}

document.getElementById('clearPins')?.addEventListener('click', () => {
    pinnedGames = [];
    savePins();
    renderPins();
    // Reset all pin icons in current grids
    document.querySelectorAll('.pin-action').forEach(b => {
        b.classList.remove('pinned');
        b.innerHTML = '➕';
    });
});

// Init on load
renderPins();

// ──────────────────────────────────────────────
// EVENTS
// ──────────────────────────────────────────────
searchBtn.addEventListener('click', () => runSearch(searchInput.value));
searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(searchInput.value); });
searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer); const q = searchInput.value.trim(); if (!q || q.length < 2) { setVisible(autocompleteBox, false); return; }
    debounceTimer = setTimeout(async () => { await loadAppList(); renderAutocomplete(allApps.filter(a => a.name.toLowerCase().includes(q)).slice(0, 8)); }, 280);
});
document.addEventListener('click', e => { if (!e.target.closest('.search-wrapper')) setVisible(autocompleteBox, false); });
document.querySelectorAll('.quick-btn').forEach(b => b.addEventListener('click', () => { searchInput.value = b.dataset.query; runSearch(b.dataset.query); }));
document.querySelectorAll('.nav-pill').forEach(p => p.addEventListener('click', () => {
    document.querySelectorAll('.nav-pill').forEach(x => x.classList.remove('active')); p.classList.add('active');
    if (p.dataset.section === 'trending') loadTrending(); else { setVisible(trendingSection, false); if (featuredCard.classList.contains('hidden')) setVisible(emptyState, true); }
}));

document.querySelectorAll('.market-tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.market-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    loadTrending(t.dataset.type);
}));

window.addEventListener('DOMContentLoaded', async () => {
    await detectUserRegion();
    loadAppList().catch(() => { });
});
