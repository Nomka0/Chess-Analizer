import fs from 'fs';
const CACHE_FILE = './analysis_cache.json';
const ENGINE_CACHE_FILE = './engine_cache.json';

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

function saveAnalysisCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(analysisCache, null, 2));
}

function saveEngineCache() {
    fs.writeFileSync(ENGINE_CACHE_FILE, JSON.stringify(engineCache, null, 2));
}

// Full AI analysis cache
export function getCachedAnalysis(fen, model, language = 'es') {
    return analysisCache[`${language}:${model}:${fen}`] || null;
}

export function setCachedAnalysis(fen, model, analysis, language = 'es') {
    analysisCache[`${language}:${model}:${fen}`] = analysis;
    saveAnalysisCache();
}

// Raw engine evaluation cache
export function getCachedEngine(fen) {
    return engineCache[fen] || null;
}

export function setCachedEngine(fen, evaluation) {
    engineCache[fen] = evaluation;
    saveEngineCache();
}
