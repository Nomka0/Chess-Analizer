import fs from 'fs';
const CACHE_FILE = './analysis_cache.json';

// Initialize cache
let cache = {};
if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
}

function saveCache() {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

export function getCachedAnalysis(fen, model) {
    return cache[`${model}:${fen}`] || null;
}

export function setCachedAnalysis(fen, model, analysis) {
    cache[`${model}:${fen}`] = analysis;
    saveCache();
}
