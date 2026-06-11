import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { Ollama } from 'ollama';
const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });
import { performance } from 'perf_hooks';
import { getCachedAnalysis, setCachedAnalysis } from './cache.js';
import { Chess } from 'chess.js';
import { formatChessText } from './utils.js';

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

function uciToSan(fen, uciMoves) {
    const chess = new Chess(fen);
    const sanMoves = [];
    const moves = uciMoves.split(' ');
    
    const unicodeMapping = {
        'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔'
    };

    let turn = chess.turn();
    let moveNumber = Math.floor(chess.moveNumber());
    
    for (const uci of moves) {
        try {
            const from = uci.substring(0, 2);
            const to = uci.substring(2, 4);
            const promotion = uci.substring(4) || 'q';
            const move = chess.move({ from, to, promotion });
            if (move) {
                let movePrefix = "";
                if (turn === 'w') {
                    movePrefix = `${moveNumber}. `;
                } else {
                    movePrefix = `${moveNumber}... `;
                    moveNumber++;
                }
                
                // Use transparent icons for internal processing and Ollama prompt
                let san = move.san;
                const firstChar = san[0];
                if (unicodeMapping[firstChar]) {
                    san = unicodeMapping[firstChar] + san.substring(1);
                }

                sanMoves.push(`${movePrefix}${san}`);
                turn = chess.turn();
            }
        } catch (e) {
            break;
        }
    }
    return sanMoves.join(' ');
}

function getSystemPrompt(language) {
    const isEn = language === 'en';
    
    return `You are an expert chess analyst. 
Your task is to analyze a chess move and output ONLY a valid JSON object. No markdown wrappers, no HTML.

Context provided to you:
- ${isEn ? 'User Move' : 'Jugada del usuario'}: The move played.
- ${isEn ? 'Classification' : 'Clasificación'}: Blunder, mistake, or inaccuracy.
- ${isEn ? 'Evaluation' : 'Evaluación'}: Centipawn loss (CP).

Respond STRICTLY with a JSON object matching this structure:
{
  "generalExplanation": "${isEn ? "1 brief sentence explaining the tactical consequence." : "1 oración breve explicando la consecuencia de este movimiento."}",
  "cons": {
    "exists": true,
    "title": "${isEn ? "Short title (e.g. 'Loss of material')" : "Título corto (ej. 'Pérdida de material')"}",
    "explanation": "${isEn ? "Detailed explanation of why this move is bad." : "Explicación detallada de por qué es una desventaja."}"
  },
  "pros": {
    "exists": true/false, // IMPORTANT: Set to false if it's a blunder. Set to true ONLY if the move has genuine redeeming qualities (like center control).
    "title": "${isEn ? "Short title (e.g. 'Center control')" : "Título corto (ej. 'Desarrollo de piezas')"}",
    "explanation": "${isEn ? "Explanation of the positive aspect." : "Explicación del aspecto positivo de esta jugada."}"
  },
  "alternative": {
    "explanation": "${isEn ? "Elaborate explanation (2-3 sentences) on why the correct alternative is superior, focusing on center, development, or tactics." : "Explicación detallada (2-3 oraciones) de por qué la alternativa correcta es muy superior."}"
  }
}`;
}

/**
 * Sanitizes LLM output to ensure variations don't end with incomplete moves or trailing move numbers.
 */
function sanitizeLLMOutput(text) {
    if (!text) return text;
    
    // Remove incomplete moves at the end of variation blocks
    // Matches trailing move numbers like "7. " or "7... " or "7. ♘ "
    return text.replace(/<div class="variation">(.*?)<\/div>/gs, (match, content) => {
        let cleaned = content.trim();
        
        // Remove trailing move numbers (e.g., "10. " or "10... ")
        cleaned = cleaned.replace(/\s*\d+(\.{1,3})\s*$/g, '');
        
        // Remove trailing piece symbols without a square (e.g., "10. ♘")
        cleaned = cleaned.replace(/\s*\d+(\.{1,3})\s*[♘♗♖♕♔♞♝♜♛♚]\s*$/g, '');
        
        // General cleanup: remove trailing dots or symbols if they don't look like a move
        cleaned = cleaned.replace(/[\.♘♗♖♕♔♞♝♜♛♚]\s*$/g, '');

        return `<div class="variation">${cleaned}</div>`;
    });
}

async function performAnalysis(fen, modelOverride, language = 'es', moveTimeMs = 200, userMove, classification) {
    const fenId = getFenId(fen);
    
    // 1. Cache Resolution Profiling
    const startCache = performance.now();
    const model = modelOverride || 'qwen2.5:14b';
    const cached = getCachedAnalysis(fen, model, language);
    if (cached) {
        const cacheDuration = (performance.now() - startCache).toFixed(1);
        console.log(`[Perf: Cache] [${fenId}] Resolved from cache in ${cacheDuration}ms`);
        if (cached.score !== undefined && cached.bestScore === undefined) {
            cached.bestScore = cached.score;
        }
        return cached;
    }

    // 2. Stockfish Profiling
    // Evaluation 1: Position BEFORE user move (to find the true Best Move)
    const evaluation = await pool.addRequest(fen, moveTimeMs);
    const bestScore = evaluation.score;
    const sanBestMove = uciToSan(fen, evaluation.bestmove);
    const sanPv = evaluation.pv ? uciToSan(fen, evaluation.pv) : 'N/A';

    // Evaluation 2: Position AFTER user move (to find Actual Score and CP Loss)
    const chess = new Chess(fen);
    const moveNumber = Math.floor(chess.moveNumber());
    const prefix = chess.turn() === 'w' ? `${moveNumber}. ` : `${moveNumber}... `;

    // Prepare userMove with transparent icons for Ollama prompt
    let sanUserMove = 'N/A';
    if (userMove) {
        const unicodeMapping = { 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔' };
        let san = userMove;
        if (unicodeMapping[san[0]]) {
            san = unicodeMapping[san[0]] + san.substring(1);
        }
        sanUserMove = `${prefix}${san}`;
    }
    
    let actualScore = bestScore;
    let sanRefutationLine = 'N/A'; // <-- NUEVA VARIABLE

    try {
        const tempChess = new Chess(fen);
        const m = tempChess.move(userMove);
        if (m) {
            const postMoveEvaluation = await pool.addRequest(tempChess.fen(), moveTimeMs);
            // Flip score for comparison if it's black's turn to keep it relative to white or absolute
            actualScore = postMoveEvaluation.score;
            
            // <-- NUEVA LÓGICA: Traducir la línea que refuta el error
            if (postMoveEvaluation.pv) {
                sanRefutationLine = uciToSan(tempChess.fen(), postMoveEvaluation.pv);
                // Le añadimos la jugada del usuario al inicio para que tenga contexto
                sanRefutationLine = `${sanUserMove} ${sanRefutationLine}`; 
            }
        }
    } catch (e) {
        console.error("Error evaluating post-move position:", e);
    }

    const cpLoss = Math.abs(bestScore - actualScore);

    // Bug 2: Correct Spanish classification mapping
    let mappedClassification = classification || "imprecisión";
    if (language === 'es') {
        if (cpLoss >= 300) mappedClassification = "error grave";
        else if (cpLoss >= 100) mappedClassification = "error";
        else mappedClassification = "imprecisión";
    } else {
        if (cpLoss >= 300) mappedClassification = "blunder";
        else if (cpLoss >= 100) mappedClassification = "mistake";
        else mappedClassification = "inaccuracy";
    }
    
    const systemPrompt = getSystemPrompt(language);
    
    const userPrompt = `User Move: ${sanUserMove}
    Classification: ${mappedClassification}
    Evaluation: ${cpLoss}
    Refutation Line (Use for Cons): ${sanRefutationLine}
    Best Move: ${sanBestMove}
    Best Line (Use for Alternative): ${sanPv}`;

    // 3. Ollama Profiling (JSON Mode)
    const startOllama = performance.now();
    let generatedHtml = '';

    try {
        const fullPrompt = `${systemPrompt}\n\n[Context Data]\n${userPrompt}`;

        const response = await ollama.generate({
            model: model,
            prompt: fullPrompt,
            format: 'json', // <--- CRÍTICO: Fuerza a Ollama a devolver un JSON puro
            options: { 
                temperature: 0.2, // Un poco de temperatura para mejorar la redacción
                num_predict: 512, // Reducido: el JSON es mucho más corto que el HTML
                num_ctx: 4096,
                think: false
            }
        });

        // 4. Parsear el JSON y construir el HTML localmente en Node.js
        let analysisData;
        try {
            // Limpieza preventiva por si el LLM pone tags de markdown "```json"
            const rawJson = response.response.replace(/```json/gi, '').replace(/```/g, '').trim();
            analysisData = JSON.parse(rawJson);
        } catch (e) {
            console.error("[Parse Error] Falló al leer el JSON de Ollama:", e);
            throw new Error("El modelo no devolvió un JSON válido.");
        }

        const isEn = language === 'en';
        
        // Ensamblado perfecto del HTML sin tokens basura
        generatedHtml = `**${sanUserMove}** es un/una **${mappedClassification}** (${cpLoss}cp). ${analysisData.generalExplanation}\n\n`;

        if (analysisData.cons && analysisData.cons.exists) {
            generatedHtml += `# ${isEn ? 'Cons' : 'Contras'}:\n`;
            generatedHtml += `- ${analysisData.cons.explanation}\n`; // <-- Nueva explicación detallada
            generatedHtml += `<details>\n<summary>${analysisData.cons.title}</summary>\n`;
            generatedHtml += `<div class="variation">${sanRefutationLine}</div>\n</details>\n\n`;
        }

        if (analysisData.pros && analysisData.pros.exists) {
            generatedHtml += `# ${isEn ? 'Pros' : 'Pros'}:\n`;
            generatedHtml += `- ${analysisData.pros.explanation}\n`; // <-- Nueva explicación detallada
            generatedHtml += `<details>\n<summary>${analysisData.pros.title}</summary>\n`;
            // Para demostrar un Pro de la jugada del usuario, la línea que demuestra la realidad del tablero es la línea de refutación
            generatedHtml += `<div class="variation">${sanRefutationLine}</div>\n</details>\n\n`;
        }

        generatedHtml += `--- \n\n# ${isEn ? 'The correct alternative' : 'La alternativa correcta'}: ${sanBestMove}\n\n`;
        generatedHtml += `${analysisData.alternative.explanation}\n\n`; // <-- Explicación enriquecida
        generatedHtml += `<details>\n<summary>${isEn ? 'See suggested continuation' : 'Ver continuación sugerida'}</summary>\n`;
        generatedHtml += `<div class="variation">${sanPv}</div>\n</details>`;

        // Limpiar jugadas incompletas con tu función existente
        const cleanAnalysis = formatChessText(sanitizeLLMOutput(generatedHtml));

        const ollamaDuration = (performance.now() - startOllama).toFixed(1);
        console.log(`[Perf: Ollama] [${fenId}] Inference Time: ${ollamaDuration}ms (JSON Mode)`);

        const result = {
            fen,
            bestmove: formatChessText(sanBestMove),
            score: actualScore,
            bestScore: bestScore,
            scoreType: evaluation.scoreType,
            analysis: cleanAnalysis,
            language,
            pv: evaluation.pv,
            cpLoss
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
  console.log('--- [API] Petición recibida en /api/models ---');
  try {
    console.log('[API] Consultando a Ollama vía HTTP directo...');
    
    // Llamamos directamente al puerto de Ollama usando la IP fija IPv4
    const response = await fetch('http://127.0.0.1:11434/api/tags');
    
    if (!response.ok) {
      throw new Error(`Ollama respondió con estatus: ${response.status}`);
    }

    const data = await response.json();
    console.log('[API] Ollama respondió con éxito. Modelos detectados:', data.models.length);
    
    // Mapeamos los nombres exactamente igual que antes
    res.json(data.models.map(m => m.name));
  } catch (error) {
    console.error('[API] ❌ Error al buscar modelos:', error.message);
    res.status(500).json({ error: "Failed to fetch models", details: error.message });
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
        res.write(`data: ${JSON.stringify({ index: fenData.index ?? i, result })}\n\n`);
      }
    } catch (err) {
      console.error(`[SSE] Error analyzing FEN at index ${i}:`, err);
      if (!isDisconnected) {
        res.write(`data: ${JSON.stringify({ index: fenData.index ?? i, error: err.message })}\n\n`);
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
