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
const ENGINE_COUNT = 5;

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
    this.pv = '';
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

    if (line.startsWith('info') && line.includes('score')) {
      const parts = line.split(' ');
      
      const scoreIdx = parts.indexOf('score');
      if (scoreIdx !== -1 && scoreIdx + 2 < parts.length) {
        this.scoreType = parts[scoreIdx + 1];
        const val = parseInt(parts[scoreIdx + 2]);
        if (!isNaN(val)) this.score = val;
      }

      const pvIdx = parts.indexOf('pv');
      if (pvIdx !== -1) {
        this.pv = parts.slice(pvIdx + 1).join(' ');
      }
    }

    if (line.startsWith('bestmove')) {
      this.bestMove = line.split(' ')[1];
      if (this.currentResolve) {
        const result = { 
          bestmove: this.bestMove, 
          score: this.score, 
          scoreType: this.scoreType,
          pv: this.pv
        };
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
    this.pv = '';
  }

  async evaluate(fen, moveTimeMs = 200) {
    this.isBusy = true;
    const startExec = performance.now();
    const fenId = getFenId(fen);

    return new Promise((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;
      
      this.engine.stdin.write(`position fen ${fen}\n`);
      this.engine.stdin.write(`go depth 16\n`);

      setTimeout(() => {
        if (this.currentResolve === resolve) {
          this.isBusy = false;
          this.cleanup();
          reject(new Error(`Stockfish ${this.id} evaluation timed out`));
        }
      }, 3000);
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
    return `Actúa como un locutor de ajedrez. Tu único trabajo es traducir los datos matemáticos de Stockfish a un lenguaje natural y empático.

REGLAS DE ORO (ANTI-ALUCINACIONES):
1. ERES CIEGO AL TABLERO: No intentes adivinar ataques, jaques mates, ni clavadas que no estén explicadas explícitamente en la 'Línea esperada (PV)'.
2. PROHIBIDO USAR CLICHÉS: Si la partida ya está avanzada (FEN complejo), NUNCA hables de "desarrollo de piezas" o "control del centro en la apertura".
3. NO INVENTES JUGADAS: Solo puedes mencionar las jugadas exactas que se te proporcionen en los datos. Si no sabes por qué una jugada es mala, simplemente di: "El motor detecta que esta jugada pierde una ventaja crítica" y pasa a la alternativa.

### 🎯 Análisis de tu Movimiento
> **Tu Jugada:** ${userMove || '[Movimiento]'} | **Categoría:** ${classification || '[Categoría]'}
[1 párrafo. Si es buena, felicita la precisión. Si es mala o imprecisión, di que pierde la ventaja según el análisis de la computadora, sin inventar el por qué táctico].

---
### 🌟 La Alternativa de Stockfish
> **Mejor Jugada:** **${sanBestMove}**

#### 🔍 La Estrategia
[Explica brevemente qué pasaría según la 'Línea esperada (PV)'. Ejemplo: "La computadora sugiere esta jugada porque la secuencia esperada lleva a un intercambio favorable de material..."].`;
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

    const userPrompt = `FEN: ${fen}\nUser Move: ${userMove || 'N/A'}\nClassification: ${finalClassification || 'N/A'}\nEvaluation: ${scoreStr}\nBest Move: ${sanBestMove}\nLínea esperada (PV): ${evaluation.pv || 'N/A'}`;

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
            language,
            pv: evaluation.pv
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

app.get('/api/analyze-stream', async (req, res) => {
  const { fens: fensRaw, model, language, moveTime } = req.query;
  if (!fensRaw) return res.status(400).json({ error: "Missing FENs" });

  let fens;
  try {
    fens = JSON.parse(fensRaw);
    if (!Array.isArray(fens)) throw new Error("FENs must be an array");
  } catch (e) {
    return res.status(400).json({ error: "Invalid FENs format" });
  }

  // SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let isDisconnected = false;
  req.on('close', () => {
    isDisconnected = true;
    console.log('[SSE] Client disconnected, stopping analysis loop.');
  });

  console.log(`[SSE] Starting stream for ${fens.length} FENs`);

  for (let i = 0; i < fens.length; i++) {
    if (isDisconnected) break;

    const fenData = fens[i];
    // Supports both array of strings or array of objects {fen, userMove, classification}
    const fen = typeof fenData === 'string' ? fenData : fenData.fen;
    const userMove = typeof fenData === 'object' ? fenData.userMove : undefined;
    const classification = typeof fenData === 'object' ? fenData.classification : undefined;

    try {
      const result = await performAnalysis(
        fen, 
        model, 
        language || 'es', 
        parseInt(moveTime) || 200,
        userMove,
        classification
      );
      
      if (!isDisconnected) {
        res.write(`data: ${JSON.stringify({ index: i, result })}\n\n`);
      }
    } catch (err) {
      console.error(`[SSE] Error analyzing FEN at index ${i}:`, err);
      if (!isDisconnected) {
        res.write(`data: ${JSON.stringify({ index: i, error: err.message })}\n\n`);
      }
    }
  }

  if (!isDisconnected) {
    res.write('data: [DONE]\n\n');
    res.end();
  }
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
