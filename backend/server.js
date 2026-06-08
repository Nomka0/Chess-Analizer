import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import ollama from 'ollama';
import { performance } from 'perf_hooks';
import { getCachedAnalysis, setCachedAnalysis } from './cache.js';
import { Chess } from 'chess.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const ENGINE_COUNT = 6;

// Helper for FEN identifier
const getFenId = (fen) => fen.substring(0, 15);

class StockfishWorker {
  constructor(id) {
    this.id = id;
    this.engine = null;
    this.isBusy = false;
    this.currentResolve = null;
    this.currentReject = null;
    this.bestMove = null;
    this.score = null;
    this.scoreType = 'cp';
    this.initPromise = this.init();
  }

  async init() {
    return new Promise((resolve, reject) => {
      try {
        this.engine = spawn('stockfish');
        
        this.engine.stdout.on('data', (data) => {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            this.handleEngineLine(line.trim());
          }
        });

        this.engine.on('error', (err) => {
          console.error(`[Stockfish ${this.id}] Error:`, err);
          if (this.currentReject) this.currentReject(err);
        });

        this.engine.stdin.write('uci\n');
        this.engine.stdin.write('setoption name Threads value 2\n');
        this.engine.stdin.write('setoption name Hash value 256\n');
        this.engine.stdin.write('isready\n');

        const readyListener = (data) => {
          if (data.toString().includes('readyok')) {
            console.log(`[Stockfish ${this.id}] Ready.`);
            this.engine.stdout.removeListener('data', readyListener);
            resolve();
          }
        };
        this.engine.stdout.on('data', readyListener);
      } catch (err) {
        reject(err);
      }
    });
  }

  handleEngineLine(line) {
    if (!line) return;
    // console.log(`[SF ${this.id}] ${line}`); // Optional verbose logging

    if (line.includes('score')) {
      const parts = line.split(' ');
      const scoreIdx = parts.indexOf('score');
      if (scoreIdx !== -1 && scoreIdx + 2 < parts.length) {
        this.scoreType = parts[scoreIdx + 1];
        const val = parseInt(parts[scoreIdx + 2]);
        if (!isNaN(val)) this.score = val;
      }
    }

    if (line.startsWith('bestmove')) {
      this.bestMove = line.split(' ')[1];
      if (this.currentResolve) {
        const result = { bestmove: this.bestMove, score: this.score, scoreType: this.scoreType };
        this.currentResolve(result);
        this.cleanup();
      }
    }
  }

  cleanup() {
    this.currentResolve = null;
    this.currentReject = null;
    this.bestMove = null;
    this.score = null;
    this.scoreType = 'cp';
  }

  async evaluate(fen, moveTimeMs = 200) {
    this.isBusy = true;
    const startExec = performance.now();
    const fenId = getFenId(fen);

    return new Promise((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;
      
      this.engine.stdin.write(`position fen ${fen}\n`);
      this.engine.stdin.write(`go movetime ${moveTimeMs}\n`);

      setTimeout(() => {
        if (this.currentResolve === resolve) {
          this.isBusy = false;
          this.cleanup();
          reject(new Error(`Stockfish ${this.id} evaluation timed out (${moveTimeMs + 1000}ms)`));
        }
      }, moveTimeMs + 1000);
    }).finally(() => {
      this.isBusy = false;
      const duration = (performance.now() - startExec).toFixed(1);
      console.log(`[Perf: Stockfish] [${fenId}] Execution on worker ${this.id}: ${duration}ms`);
    });
  }
}

class StockfishPool {
  constructor(count) {
    this.workers = Array.from({ length: count }, (_, i) => new StockfishWorker(i));
    this.queue = [];
  }

  async waitForAllReady() {
    await Promise.all(this.workers.map(w => w.initPromise));
    console.log(`[Pool] All ${ENGINE_COUNT} workers initialized.`);
  }

  async addRequest(fen, moveTimeMs) {
    const startQueue = performance.now();
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, moveTimeMs, resolve, reject, startQueue });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.queue.length === 0) return;

    const idleWorker = this.workers.find(w => !w.isBusy);
    if (!idleWorker) return;

    const { fen, moveTimeMs, resolve, reject, startQueue } = this.queue.shift();
    
    const waitTime = (performance.now() - startQueue).toFixed(1);
    console.log(`[Perf: Stockfish] [${getFenId(fen)}] Queue Wait Time: ${waitTime}ms`);

    try {
      const result = await idleWorker.evaluate(fen, moveTimeMs);
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.processQueue();
    }
  }
}

const pool = new StockfishPool(ENGINE_COUNT);

function getSystemPrompt(sanBestMove, language, userMove, classification) {
    return `Actúa como un Gran Maestro de ajedrez. Tu objetivo es dar un feedback cortísimo, preciso y sin inventar nada.

REGLAS DE ORO (ANTI-ALUCINACIONES):
1. SI LA JUGADA ES SOLO UNA LETRA Y UN NÚMERO (ej. e4, d4, c5), ES UN PEÓN. NUNCA digas que es una torre, alfil o caballo.
2. NUNCA inventes que hay piezas desarrolladas si es el inicio de la partida.
3. Si la categoría es "Excelente" o "Buena jugada", solo di por qué es sólida (controla el centro, desarrolla, etc.) y NO critiques la jugada.
4. NUNCA menciones casillas específicas a menos que estés 100% seguro. Habla de conceptos generales: "control del centro", "desarrollo", "seguridad del rey".

### 🎯 Análisis de tu Movimiento
> **Tu Jugada:** ${userMove || '[Movimiento]'} | **Categoría:** ${classification || '[Categoría]'}

[1 párrafo corto y directo. Si es buena, felicita. Si es mala, explica el error sin inventar piezas].

---

### 🌟 Sugerencia de Stockfish
> **Mejor Jugada:** **${sanBestMove}**

[1 párrafo explicando el concepto general de esta jugada. Ejemplo: "Gana espacio en el centro" o "Desarrolla una pieza menor"].`;
}

async function performAnalysis(fen, modelOverride, language = 'es', moveTimeMs = 200, userMove, classification) {
    const fenId = getFenId(fen);
    
    // 1. Cache Resolution Profiling
    const startCache = performance.now();
    const model = modelOverride || 'phi4-mini:latest';
    const cached = getCachedAnalysis(fen, model, language);
    if (cached) {
        const cacheDuration = (performance.now() - startCache).toFixed(1);
        console.log(`[Perf: Cache] [${fenId}] Resolved from cache in ${cacheDuration}ms`);
        // Ensure bestScore is present for frontend compatibility
        if (cached.score !== undefined && cached.bestScore === undefined) {
            cached.bestScore = cached.score;
        }
        return cached;
    }

    // 2. Stockfish Profiling (Managed inside Pool/Worker)
    const evaluation = await pool.addRequest(fen, moveTimeMs);

    // UCI to SAN conversion
    const chess = new Chess(fen);
    let sanBestMove = evaluation.bestmove;
    try {
        // UCI moves are typically like 'e2e4' or 'e7e8q'
        const from = evaluation.bestmove.substring(0, 2);
        const to = evaluation.bestmove.substring(2, 4);
        const promotion = evaluation.bestmove.substring(4) || 'q';
        
        const moveObj = chess.move({ from, to, promotion });
        if (moveObj) {
            sanBestMove = moveObj.san;
            // Undo the move so chess object is back to original FEN
            chess.undo();
        }
    } catch (e) {
        console.error("Error converting UCI to SAN:", e);
    }

    // Safeguard for categorization (Task 1)
    let finalClassification = classification;
    const moveNumber = Math.floor(chess.moveNumber());
    if (moveNumber === 1 && (userMove === 'e4' || userMove === 'd4')) {
        if (finalClassification === 'inaccuracy') finalClassification = 'excellent';
    }

    const systemPrompt = getSystemPrompt(sanBestMove, language, userMove, finalClassification);
    
    const scoreStr = evaluation.scoreType === 'cp' 
        ? `${evaluation.score} centipeones` 
        : `Mate en ${evaluation.score}`;

    const userPrompt = `FEN: ${fen}\nUser Move: ${userMove || 'N/A'}\nClassification: ${finalClassification || 'N/A'}\nEvaluation: ${scoreStr}\nBest Move: ${sanBestMove}`;

    // 3. Ollama Profiling
    const startOllama = performance.now();
    try {
        const response = await ollama.chat({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            options: { 
                temperature: 0.2,
                num_predict: 350,
                num_ctx: 2048
            }
        });

        const generatedContent = response.message.content;
        console.log(`[Ollama Debug] Generated text length: ${generatedContent.length} characters.`);

        const ollamaDuration = (performance.now() - startOllama).toFixed(1);
        console.log(`[Perf: Ollama] [${fenId}] Inference Time: ${ollamaDuration}ms`);

        const result = {
            fen,
            bestmove: sanBestMove,
            score: evaluation.score,
            bestScore: evaluation.score, // Added for frontend compatibility
            scoreType: evaluation.scoreType,
            analysis: generatedContent,
            language
        };

        setCachedAnalysis(fen, model, result, language);
        return result;
    } catch (err) {
        console.error(`[Ollama] Error:`, err);
        throw err;
    }
}

// API ENDPOINTS
app.get('/api/models', async (req, res) => {
  try {
    const list = await ollama.list();
    res.json(list.models.map(m => m.name));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch models" });
  }
});

app.post('/api/analyze', async (req, res) => {
  const startApi = performance.now();
  const { fen, model, language, moveTime, userMove, classification } = req.body;
  if (!fen) return res.status(400).json({ error: "Missing FEN" });
  const fenId = getFenId(fen);
  
  try {
    const result = await performAnalysis(fen, model, language || 'es', moveTime, userMove, classification);
    const apiDuration = (performance.now() - startApi).toFixed(1);
    console.log(`[Perf: API] [${fenId}] End-to-End Time: ${apiDuration}ms`);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/evaluate-all', async (req, res) => {
  const startApi = performance.now();
  const { fens, moveTime } = req.body;
  if (!fens || !Array.isArray(fens)) return res.status(400).json({ error: "Missing FENs" });

  const results = await Promise.all(fens.map(async (fen) => {
    try {
      const evaluation = await pool.addRequest(fen, moveTime);
      return { fen, ...evaluation };
    } catch (err) {
      return { fen, error: err.message };
    }
  }));

  const apiDuration = (performance.now() - startApi).toFixed(1);
  console.log(`[Perf: API] [Evaluate-All] End-to-End Time: ${apiDuration}ms for ${fens.length} FENs`);
  res.json(results);
});

app.post('/api/analyze-all', async (req, res) => {
  const startApi = performance.now();
  const { fens, model, language, moveTime } = req.body;
  if (!fens || !Array.isArray(fens)) return res.status(400).json({ error: "Missing FENs" });

  const results = [];
  for (const fen of fens) {
      try {
          const res = await performAnalysis(fen, model, language || 'es', moveTime);
          results.push(res);
      } catch (err) {
          results.push({ fen, error: err.message });
      }
  }

  const apiDuration = (performance.now() - startApi).toFixed(1);
  console.log(`[Perf: API] [Analyze-All] End-to-End Time: ${apiDuration}ms for ${fens.length} FENs`);
  res.json(results);
});

async function startServer() {
  try {
    await pool.waitForAllReady();
    app.listen(PORT, () => {
      console.log(`[Server] Chess Analyzer Backend running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
