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
    this.buffer = ''; // <-- Almacena fragmentos incompletos
    this.initPromise = this.init();
  }

  async init() {
    return new Promise((resolve, reject) => {
      try {
        this.engine = spawn('stockfish');
        
        this.engine.stdout.on('data', (data) => {
          this.buffer += data.toString();
          let newlineIdx;
          // Procesamos línea por línea ÚNICAMENTE cuando encontramos un salto de línea real
          while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.substring(0, newlineIdx);
            this.buffer = this.buffer.substring(newlineIdx + 1);
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
          score: this.score ?? 0, 
          scoreType: this.scoreType,
          pv: this.pv
        };
        const resolveFn = this.currentResolve;
        this.cleanup(); // Limpia los estados ANTES de resolver para evitar fugas de datos
        resolveFn(result);
      }
    }
  }

  cleanup() {
    this.isBusy = false; // <-- CRÍTICO: Liberar el worker para que acepte más tareas
    this.currentResolve = null;
    this.currentReject = null;
    this.bestMove = null;
    this.score = null;
    this.scoreType = 'cp';
    this.pv = '';
  }

  async evaluate(fen, options = { moveTimeMs: 200, depth: null }) {
    this.isBusy = true;
    this.buffer = ''; // Limpiar el buffer antes de iniciar una lectura nueva

    return new Promise((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;

      this.engine.stdin.write(`position fen ${fen}\n`);
      
      // Si se especifica profundidad, usamos depth. Si no, caemos en movetime.
      if (options.depth) {
        this.engine.stdin.write(`go depth ${options.depth}\n`);
      } else {
        this.engine.stdin.write(`go movetime ${options.moveTimeMs}\n`); 
      }

      // Ajustamos el timeout de seguridad dinámicamente
      const timeoutDuration = options.depth ? 8000 : (options.moveTimeMs + 2000);

      setTimeout(() => {
        if (this.currentResolve === resolve) {
          console.warn(`[Stockfish ${this.id}] Timeout de emergencia disparado para FEN: ${fen.substring(0,15)}`);
          this.cleanup();
          reject(new Error(`Stockfish ${this.id} evaluation timed out`));
        }
      }, timeoutDuration); 
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

  async addRequest(fen, options) {
    const startQueue = performance.now();
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, options, resolve, reject, startQueue });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.queue.length === 0) return;

    const idleWorker = this.workers.find(w => !w.isBusy);
    if (!idleWorker) return;

    const { fen, options, resolve, reject, startQueue } = this.queue.shift();
    
    const waitTime = (performance.now() - startQueue).toFixed(1);
    console.log(`[Perf: Stockfish] [${getFenId(fen)}] Queue Wait Time: ${waitTime}ms`);

    try {
      const result = await idleWorker.evaluate(fen, options);
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
    
    for (const uci of moves) {
        try {
            const moveNumber = chess.moveNumber();
            const turn = chess.turn();
            
            const from = uci.substring(0, 2);
            const to = uci.substring(2, 4);
            const promotion = uci.substring(4) || 'q';
            const move = chess.move({ from, to, promotion });

            if (move) {
                if (turn === 'w') {
                    sanMoves.push(`${moveNumber}. ${move.san}`);
                } else {
                    // Si la cadena de movimientos empieza en el turno de las negras
                    if (sanMoves.length === 0) {
                        sanMoves.push(`${moveNumber}... ${move.san}`);
                    } else {
                        sanMoves.push(move.san); // Sin número extra
                    }
                }
            }
        } catch (e) {
            break;
        }
    }
    return sanMoves.join(' ');
}

function getSystemPrompt(language, playerColor) {
    const isEn = language === 'en';
    const colorName = playerColor === 'w' ? (isEn ? 'White' : 'Blancas') : (isEn ? 'Black' : 'Negras');
    const opponentColor = playerColor === 'w' ? (isEn ? 'Black' : 'Negras') : (isEn ? 'White' : 'Blancas');
    
    return `You are an expert chess analyst. 
Your task is to analyze a chess move and output ONLY a valid JSON object. No markdown wrappers, no HTML.

The user is playing with the **${colorName}** pieces. Their opponent is playing with the **${opponentColor}** pieces.

CRITICAL RULES TO AVOID HALLUCINATIONS AND BIAS:
1. IDENTIFY THE TURN CORRECTLY: 
   - Moves starting with a single dot (e.g., "4. dxe4") are ALWAYS made by White.
   - Moves starting with three dots (e.g., "4... dxe4") are ALWAYS made by Black.
   - Never say the enemy captured something if the move was played by the player's own color.
2. For pawn captures (e.g., 'dxe4', 'exd5'), simply say "captures on e4" or "captures a piece". Do not invent what piece was there.
3. Analyze the position EXCLUSIVELY from the perspective of the ${colorName} pieces.
4. If the move attacks the opponent, it is a "Pro". If it harms the player, it is a "Con".
5. DO NOT INVENT OR SUGGEST YOUR OWN MOVES. The mathematical engine has already calculated the absolute truth. You MUST strictly base your entire analysis on the "Best Move", "Best Line", and "Refutation Line" provided in the [Context Data].
6. You are forbidden from suggesting a different alternative. If the [Context Data] says the "Best Move" is Nf6, your alternative explanation must ONLY be about why Nf6 is good.

Respond STRICTLY with a JSON object matching this structure:
{
  "generalExplanation": "${isEn ? "1 brief sentence explaining the tactical consequence based ONLY on the context data." : "1 oración breve explicando la consecuencia táctica basada SOLO en los datos de contexto provistos."}",
  "cons": {
    "exists": true,
    "title": "${isEn ? "Short title" : "Título corto"}",
    "explanation": "${isEn ? "Detailed explanation of why the User Move is bad, strictly based on the Refutation Line provided." : "Explicación detallada de por qué la jugada del usuario es mala, basada estrictamente en la Refutation Line provista."}"
  },
  "pros": {
    "exists": true,
    "title": "${isEn ? "Short title" : "Título corto"}",
    "explanation": "${isEn ? "Explanation of the positive aspect." : "Explicación del aspecto positivo."}"
  },
  "alternative": {
    "explanation": "${isEn ? "Explanation of why the EXACT Best Move provided in the context is superior to the User Move." : "Explicación de por qué el Best Move EXACTO provisto en el contexto es superior a la jugada del usuario."}"
  }
}`;
}
/**
 * Sanitizes LLM output to ensure variations don't end with incomplete moves or trailing move numbers.
 */
function sanitizeLLMOutput(text) {
    if (!text) return text;
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
    console.log(`[API] Analysis Request: FEN=${fen.substring(0,10)}..., Model=${modelOverride}, Lang=${language}, Move=${userMove}, Class=${classification}`);
    const fenId = getFenId(fen);
    
    // 1. Definimos primero la variable del modelo (¡Esto arregla el ReferenceError!)
    const model = modelOverride || 'qwen2.5:14b';
    
    // 2. Ahora sí, el chequeo del Cache tiene acceso a la variable 'model'
    const cached = getCachedAnalysis(fen, model, language);
    if (cached) return cached;

    // Preparar tablero post-move para calcular la refutación en paralelo
    const chess = new Chess(fen);
    const moveNumber = Math.floor(chess.moveNumber());
    const prefix = chess.turn() === 'w' ? `${moveNumber}. ` : `${moveNumber}... `;

    // CONFIGURACIÓN DINÁMICA DE PROFUNDIDAD
    // Si la jugada es <= 10, forzamos profundidad 22 para un análisis de apertura impecable.
    // En adelante, mantenemos el moveTimeMs (ej. 200ms o lo que venga del cliente) para no saturar.
    let stockfishOptions = { moveTimeMs: moveTimeMs || 200, depth: null };
    if (moveNumber <= 10) {
        stockfishOptions = { depth: 22 }; 
        console.log(`[Engine] Apertura detectada (Jugada ${moveNumber}). Forzando profundidad 22.`);
    }
    
    let tempChessFen = null;
    try {
        const tempChess = new Chess(fen);
        if (userMove) {
            const m = tempChess.move(userMove);
            if (m) tempChessFen = tempChess.fen();
        }
    } catch(e) {
        console.error("Invalid user move for FEN setup", e);
    }

    // Lanzamos ambas peticiones al Pool pasando el objeto stockfishOptions
    const stockfishPromises = [
        pool.addRequest(fen, stockfishOptions)
    ];
    
    if (tempChessFen) {
        stockfishPromises.push(pool.addRequest(tempChessFen, stockfishOptions));
    }

    // Esperamos las respuestas de Stockfish en paralelo
    const stockfishResults = await Promise.all(stockfishPromises);
    
    const evaluation = stockfishResults[0];
    const postMoveEvaluation = stockfishResults[1] || null; // Manejo por si no hubo jugada del usuario

    const bestScore = evaluation.score;
    const sanBestMove = uciToSan(fen, evaluation.bestmove);
    const sanPv = evaluation.pv ? uciToSan(fen, evaluation.pv) : 'N/A';

    let sanUserMove = 'N/A';
    if (userMove) {
        const unicodeMapping = { 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔' };
        let san = userMove;
        if (unicodeMapping[san[0]]) san = unicodeMapping[san[0]] + san.substring(1);
        sanUserMove = `${prefix}${san}`;
    }

    let actualScore = bestScore;
    let sanRefutationLine = 'N/A';

    if (postMoveEvaluation) {
        actualScore = -postMoveEvaluation.score; 
        if (postMoveEvaluation.pv) {
            sanRefutationLine = uciToSan(tempChessFen, postMoveEvaluation.pv);
            // Le añadimos la jugada del usuario al inicio para que tenga contexto
            sanRefutationLine = `${sanUserMove} ${sanRefutationLine}`; 
        }
    }

    const cpLoss = Math.max(0, bestScore - actualScore);
    
    // ¡NUEVA LÓGICA DE CLASIFICACIÓN! (Para incluir jugadas buenas)
    let mappedClassification = classification;
    if (!mappedClassification) {
        if (language === 'es') {
            if (cpLoss >= 300) mappedClassification = "error grave";
            else if (cpLoss >= 100) mappedClassification = "error";
            else if (cpLoss >= 50) mappedClassification = "imprecisión";
            else if (cpLoss >= 20) mappedClassification = "buena jugada";
            else mappedClassification = "jugada excelente"; // Si cpLoss es casi 0
        } else {
            if (cpLoss >= 300) mappedClassification = "blunder";
            else if (cpLoss >= 100) mappedClassification = "mistake";
            else if (cpLoss >= 50) mappedClassification = "inaccuracy";
            else if (cpLoss >= 20) mappedClassification = "good move";
            else mappedClassification = "excellent move";
        }
    }
    
    // chess.turn() devuelve 'w' o 'b' del FEN original (antes del movimiento del usuario)
    const playerColorCode = chess.turn(); 
    const systemPrompt = getSystemPrompt(language, playerColorCode);

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
                temperature: 0.0, // Un poco de temperatura para mejorar la redacción
                num_predict: 512, // Reducido: el JSON es mucho más corto que el HTML
                num_ctx: 4096,
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
      const evaluation = await pool.addRequest(fen, { moveTimeMs: moveTime || 200, depth: null });
      // Cache the raw stockfish evaluation
      setCachedAnalysis(fen, 'stockfish', evaluation, 'en'); 
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
