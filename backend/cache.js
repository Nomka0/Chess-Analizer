import fs from 'fs';
const CACHE_FILE = './analysis_cache.json';
const ENGINE_CACHE_FILE = './engine_cache.json';
const FLUSH_DEBOUNCE_MS = 2000; // coalesce bursts of writes into one flush

// Initialize caches
let analysisCache = {};
if (fs.existsSync(CACHE_FILE)) {
    try {
        analysisCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (e) {
        console.error("Error loading analysis cache:", e);
    }
}

let engineCache = {};
if (fs.existsSync(ENGINE_CACHE_FILE)) {
    try {
        engineCache = JSON.parse(fs.readFileSync(ENGINE_CACHE_FILE, 'utf8'));
    } catch (e) {
        console.error("Error loading engine cache:", e);
    }
}

// Debounced, non-blocking persistence. Instead of fsync'ing the whole file on
// every cache miss, we mark the store dirty and flush at most once per idle
// window. This removes repeated synchronous serialization from the event loop
// during a batch (e.g. a 40-move SSE stream).
let dirtyAnalysis = false;
let dirtyEngine = false;
let flushTimer = null;

function scheduleFlush() {
    if (flushTimer) return; // already scheduled — coalesce subsequent writes
    flushTimer = setTimeout(flushCache, FLUSH_DEBOUNCE_MS);
    flushTimer.unref?.(); // don't keep the process alive solely for a flush
}

export async function flushCache() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    const tasks = [];
    if (dirtyAnalysis) {
        dirtyAnalysis = false;
        tasks.push(fs.promises.writeFile(CACHE_FILE, JSON.stringify(analysisCache, null, 2))
            .catch(e => console.error('Error writing analysis cache:', e)));
    }
    if (dirtyEngine) {
        dirtyEngine = false;
        tasks.push(fs.promises.writeFile(ENGINE_CACHE_FILE, JSON.stringify(engineCache, null, 2))
            .catch(e => console.error('Error writing engine cache:', e)));
    }
    await Promise.all(tasks);
}

// Full AI analysis cache
export function getCachedAnalysis(fen, model, language = 'es') {
    return analysisCache[`${language}:${model}:${fen}`] || null;
}

export function setCachedAnalysis(fen, model, analysis, language = 'es') {
    analysisCache[`${language}:${model}:${fen}`] = analysis;
    dirtyAnalysis = true;
    scheduleFlush();
}

// Raw engine evaluation cache
export function getCachedEngine(fen) {
    return engineCache[fen] || null;
}

export function setCachedEngine(fen, evaluation) {
    engineCache[fen] = evaluation;
    dirtyEngine = true;
    scheduleFlush();
}
