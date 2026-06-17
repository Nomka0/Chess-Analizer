import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { Ollama } from 'ollama';
const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });
import { performance } from 'perf_hooks';
import { getCachedAnalysis, setCachedAnalysis, getCachedEngine, setCachedEngine, flushCache } from './cache.js';
import { Chess } from 'chess.js';
import { formatChessText, getFenId } from './utils.js';
import { validateAnalysisAgainstBoard } from './validation.js';
import dns from 'dns';
import https from 'https';

// Force IPv4 first to avoid AggregateError/fetch failed on systems with broken IPv6
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;
const ENGINE_COUNT = 5;

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
          score: normalizeScore(this.score ?? 0, this.scoreType), 
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

  async evaluate(fen, options = { depth: 22 }) {
    this.isBusy = true;
    this.buffer = ''; // Limpiar el buffer antes de iniciar una lectura nueva
    const startTime = performance.now();

    console.log(`[StockfishWorker ${this.id}] ▶️  Starting eval for [${getFenId(fen)}...] (depth=${options.depth || 22})`);

    return new Promise((resolve, reject) => {
      this.currentResolve = resolve;
      this.currentReject = reject;

      this.engine.stdin.write(`position fen ${fen}\n`);
      
      // Priorizamos profundidad 22 por defecto
      const depth = options.depth || 22;
      this.engine.stdin.write(`go depth ${depth}\n`);

      // Timeout de seguridad MUY generoso (30 segundos) para evitar cortes prematuros
      const timeoutDuration = 30000;

      setTimeout(() => {
        if (this.currentResolve === resolve) {
          const elapsed = (performance.now() - startTime).toFixed(1);
          console.warn(`[StockfishWorker ${this.id}] ⏱️  TIMEOUT after ${elapsed}ms for [${getFenId(fen)}...]`);
          this.cleanup();
          reject(new Error(`Stockfish ${this.id} evaluation timed out`));
        }
      }, timeoutDuration);
    }).then(result => {
      const elapsed = (performance.now() - startTime).toFixed(1);
      console.log(`[StockfishWorker ${this.id}] ✅ Completed [${getFenId(fen)}...] in ${elapsed}ms (score=${result.score}, bestmove=${result.bestmove}, pv=${result.pv?.substring(0,50)})`);
      return result;
    }).catch(err => {
      const elapsed = (performance.now() - startTime).toFixed(1);
      console.error(`[StockfishWorker ${this.id}] ❌ Failed [${getFenId(fen)}...] after ${elapsed}ms: ${err.message}`);
      throw err;
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
    console.log(`[StockfishPool] ✅ All ${ENGINE_COUNT} workers initialized and ready.`);
  }

  async addRequest(fen, options) {
    const startQueue = performance.now();
    const queuePos = this.queue.length + 1;
    const idleCount = this.workers.filter(w => !w.isBusy).length;
    console.log(`[StockfishPool] 📥 Request queued for [${getFenId(fen)}...] (queue pos: ${queuePos}, idle workers: ${idleCount}/${ENGINE_COUNT})`);
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, options, resolve, reject, startQueue });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.queue.length === 0) return;

    const idleWorker = this.workers.find(w => !w.isBusy);
    if (!idleWorker) {
        console.log(`[StockfishPool] ⏳ All workers busy, ${this.queue.length} requests waiting...`);
        return;
    }

    const { fen, options, resolve, reject, startQueue } = this.queue.shift();
    
    const waitTime = (performance.now() - startQueue).toFixed(1);
    console.log(`[StockfishPool] ▶️  Dispatching [${getFenId(fen)}...] to worker ${idleWorker.id} (waited ${waitTime}ms in queue, ${this.queue.length} remaining)`);

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
    const isEn = language.trim() === 'en';
    const colorName = playerColor === 'w' ? (isEn ? 'White' : 'Blancas') : (isEn ? 'Black' : 'Negras');
    const opponentColor = playerColor === 'w' ? (isEn ? 'Black' : 'Negras') : (isEn ? 'White' : 'Blancas');

    return `You are an expert chess analyst.
Your task is to analyze a chess move and output ONLY a valid JSON object. No markdown wrappers, no HTML.

**IMPORTANT: Write ALL explanation fields in ${isEn ? 'ENGLISH' : 'SPANISH'} (español). The entire analysis content must be in ${isEn ? 'English' : 'Spanish'}.**

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
7. **FACTUAL ACCURACY - CRITICAL**: A "POSITION CONTEXT" section will be provided with factual board state (king locations, piece positions, checks, captures, center control). You MUST base your explanations STRICTLY on this factual data. DO NOT hallucinate tactical themes (e.g., "pressure on the king", "weakened king safety", "attacking chances") that are not supported by the provided position context. If the context says "Opponent king on e8 - no direct attack", do NOT claim the move pressures the king.
8. **ANTI-HALLUCINATION RULES (MANDATORY):**
   a. NEVER make tactical claims (attacks, defenses, pins, checks, forks, controls, etc.) that are not directly supported by the Position Context or the engine lines provided.
   b. Common hallucination patterns to NEVER include without explicit support in the context:
      - Queen/rook/bishop attacking specific squares (e.g., "Qa5 attacks e2" - verify from context!)
      - "Attacks the pawn on X" without the context explicitly showing which piece attacks that square
      - "Pressures the king", "weakens king safety", "creates attacking chances" without context support
      - "Controls the X-file", "dominates the center" without context showing piece placement
      - Pin/deflection/fork/skewer/discovered attack claims without context verification
   c. If you are unsure about a tactical detail, OMIT it rather than guess. Say "The refutation line shows..." instead of inventing tactics.
   d. The ONLY sources of truth are: (1) the Position Context factual data, (2) the Refutation Line, (3) the Best Line. Your chess knowledge is SECONDARY.

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

async function getLichessCloudEval(fen) {
    const fenId = getFenId(fen);
    const startTime = performance.now();
    try {
        // Lichess requires a full FEN
        let fullFen = fen;
        try {
            const check = new Chess(fen);
            fullFen = check.fen();
        } catch (e) {
            console.warn(`[Lichess] ⚠️  Invalid FEN for [${fenId}...]: ${e.message}`);
            return null; // Invalid FEN
        }

        const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fullFen)}`;
        console.log(`[Lichess] 📡 Requesting cloud eval for [${fenId}...]`);

        const options = {
            headers: {
                'User-Agent': 'Chess-Analyzer-Pro/1.0',
                'Accept': 'application/json'
            },
            timeout: 5000,
            // Force IPv4 at the socket level to resolve 'socket hang up' / 'fetch failed'
            family: 4
        };

        return new Promise((resolve) => {
            const req = https.get(url, options, (res) => {
                console.log(`[Lichess] 📥 Response status: ${res.statusCode} for [${fenId}...]`);
                if (res.statusCode !== 200) {
                    res.resume(); // Consume response data to free up memory
                    return resolve(null);
                }

                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    const duration = (performance.now() - startTime).toFixed(1);
                    try {
                        const data = JSON.parse(body);
                        if (data.pvs && data.pvs.length > 0) {
                            const bestMove = data.pvs[0].moves.split(' ')[0];
                            const scoreType = data.pvs[0].cp !== undefined ? 'cp' : 'mate';
                            const rawScore = data.pvs[0].cp ?? data.pvs[0].mate;
                            const score = normalizeScore(rawScore, scoreType);

                            console.log(`[Lichess] ✅ Found bestmove: ${bestMove} for [${fenId}...] in ${duration}ms (cp=${data.pvs[0].cp}, mate=${data.pvs[0].mate}, pv=${data.pvs[0].moves?.substring(0,60)})`);
                            resolve({
                                bestmove: bestMove,
                                score: score,
                                scoreType: scoreType,
                                pv: data.pvs[0].moves,
                                source: 'lichess'
                            });
                        } else {
                            console.log(`[Lichess] ⚠️  No PVS found for [${fenId}...] in ${duration}ms`);
                            resolve(null);
                        }
                    } catch (e) {
                        console.error(`[Lichess] ❌ JSON Parse Error for [${fenId}...]: ${e.message}`);
                        resolve(null);
                    }
                });
            });

            req.on('error', (e) => {
                const duration = (performance.now() - startTime).toFixed(1);
                console.error(`[Lichess] ❌ Request error for [${fenId}...] after ${duration}ms: ${e.message}`);
                resolve(null);
            });

            req.on('timeout', () => {
                const duration = (performance.now() - startTime).toFixed(1);
                console.warn(`[Lichess] ⏱️  Request timeout for [${fenId}...] after ${duration}ms`);
                req.destroy();
                resolve(null);
            });
        });

    } catch (e) {
        console.error(`[Lichess] ❌ Unexpected error for [${fenId}...]: ${e.message}`);
        return null;
    }
}

async function getChessApiEval(fen) {
    const fenId = getFenId(fen);
    const startTime = performance.now();
    return new Promise((resolve) => {
        try {
            const body = JSON.stringify({ fen });
            const options = {
                method: 'POST',
                hostname: 'chess-api.com',
                path: '/v1',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': body.length,
                    'User-Agent': 'Chess-Analyzer-Pro/1.0'
                },
                timeout: 3000,
                family: 4
            };

            console.log(`[ChessApi] 📡 Requesting eval for [${fenId}...]`);
            const req = https.request(options, (res) => {
                let bodyRes = '';
                res.on('data', (chunk) => { bodyRes += chunk; });
                res.on('end', () => {
                    const duration = (performance.now() - startTime).toFixed(1);
                    console.log(`[ChessApi] 📥 Response status: ${res.statusCode} for [${fenId}...] in ${duration}ms`);
                    if (res.statusCode === 200) {
                        try {
                            const data = JSON.parse(bodyRes);
                            if (data.move) {
                                // parseInt returns NaN on failure; `NaN ?? 0` is still NaN
                                // (nullish coalescing ignores NaN), which would poison the
                                // score downstream. Coerce explicitly.
                                const parsed = parseInt(data.centipawns);
                                const score = Number.isNaN(parsed) ? 0 : parsed;
                                console.log(`[ChessApi] ✅ Found bestmove: ${data.move} for [${fenId}...] (cp=${score})`);
                                return resolve({
                                    bestmove: data.move,
                                    score,
                                    scoreType: 'cp',
                                    source: 'chess-api'
                                });
                            }
                            console.log(`[ChessApi] ⚠️  No move in response for [${fenId}...]`);
                        } catch (e) {
                            console.error(`[ChessApi] ❌ JSON Parse Error for [${fenId}...]: ${e.message}`);
                        }
                    } else {
                        console.warn(`[ChessApi] ⚠️  Non-200 status ${res.statusCode} for [${fenId}...]`);
                    }
                    resolve(null);
                });
            });

            req.on('error', (e) => {
                const duration = (performance.now() - startTime).toFixed(1);
                console.warn(`[ChessApi] ⏭️  Skipped for [${fenId}...] after ${duration}ms: ${e.message}`);
                resolve(null);
            });

            req.on('timeout', () => {
                const duration = (performance.now() - startTime).toFixed(1);
                console.warn(`[ChessApi] ⏱️  Timeout for [${fenId}...] after ${duration}ms`);
                req.destroy();
                resolve(null);
            });

            req.write(body);
            req.end();
        } catch (e) {
            console.error(`[ChessApi] ❌ Unexpected error for [${fenId}...]: ${e.message}`);
            resolve(null);
        }
    });
}

// Resolves with the first promise that produces a truthy result. Rejects only
// when every promise has settled without a truthy value, so callers can fall
// back to the local engine. This lets us race remote sources concurrently
// instead of awaiting them one after another.
function raceExternalSources(promises) {
    return new Promise((resolve, reject) => {
        let pending = promises.length;
        let settled = false;
        for (const p of promises) {
            Promise.resolve(p).then(val => {
                if (settled) return;
                if (val) {
                    settled = true;
                    resolve(val);
                } else if (--pending === 0) {
                    reject(new Error('All external sources returned empty'));
                }
            }).catch(() => {
                if (settled) return;
                if (--pending === 0) {
                    reject(new Error('All external sources failed'));
                }
            });
        }
    });
}

async function getEngineEvaluation(fen, options) {
    const fenId = getFenId(fen);
    const startTime = performance.now();

    // Level 1: Local JSON Cache
    const cached = getCachedEngine(fen);
    if (cached) {
        console.log(`[Engine] ✅ Cache HIT for [${fenId}...] (score=${cached.score}, bestmove=${cached.bestmove}, source=${cached.source})`);
        return { ...cached, source: 'cache' };
    }
    console.log(`[Engine] 🔍 Cache MISS for [${fenId}...] - querying external sources`);

    // Level 2: Race remote sources concurrently. The fastest successful one
    // wins; we only fall through to local Stockfish if none return a result.
    console.log(`[Engine] 🌐 Racing Lichess Cloud + Chess-API for [${fenId}...]`);
    const external = await raceExternalSources([
        getLichessCloudEval(fen),
        getChessApiEval(fen),
    ]).catch(err => {
        console.log(`[Engine] ❌ All external sources missed for [${fenId}...]: ${err.message}`);
        return null;
    });

    if (external) {
        console.log(`[Engine] ✅ External HIT for [${fenId}...] (source=${external.source}, score=${external.score}, bestmove=${external.bestmove}) in ${(performance.now() - startTime).toFixed(1)}ms`);
        setCachedEngine(fen, external);
        return external;
    }

    // Level 3: Local Stockfish
    console.log(`[Engine] ♟️  Stockfish local analysis for [${fenId}...] (depth=${options?.depth || 22})`);
    const local = await pool.addRequest(fen, options);
    const duration = (performance.now() - startTime).toFixed(1);
    console.log(`[Engine] ✅ Stockfish completed for [${fenId}...] in ${duration}ms (score=${local.score}, bestmove=${local.bestmove}, pv=${local.pv?.substring(0,50)})`);
    const result = { ...local, source: 'stockfish' };
    setCachedEngine(fen, result);
    return result;
}

// Win probability from centipawns (standard tanh formula)
// WP = 0.5 + 0.5 * tanh(cp / 200)
function centipawnsToWinProb(cp) {
    return 0.5 + 0.5 * Math.tanh(cp / 200);
}

function normalizeScore(score, scoreType) {
    if (scoreType === 'mate') {
        return score > 0 ? 10000 - score : -10000 - score;
    }
    return score;
}

/**
 * Build factual position context to prevent AI hallucination
 * Extracts king squares, piece positions, checks, captures, center control from the FEN
 */
function buildPositionContext(fen, userMove, evaluation) {
    const chess = new Chess(fen);
    const turn = chess.turn(); // 'w' or 'b' - side to move in current position
    const moveNumber = chess.moveNumber();
    
    // Get piece positions
    const board = chess.board();
    const piecePositions = { white: [], black: [], bySquare: {} };
    let whiteKingSquare = null;
    let blackKingSquare = null;
    
    for (let rank = 0; rank < 8; rank++) {
        for (let file = 0; file < 8; file++) {
            const piece = board[rank][file];
            if (piece) {
                const square = `${String.fromCharCode(97 + file)}${8 - rank}`;
                const pieceInfo = `${piece.color === 'w' ? piece.type.toUpperCase() : piece.type.toLowerCase()}${square}`;
                const pieceSymbol = piece.color === 'w' ? piece.type.toUpperCase() : piece.type.toLowerCase();
                if (piece.type === 'k') {
                    if (piece.color === 'w') whiteKingSquare = square;
                    else blackKingSquare = square;
                }
                if (piece.color === 'w') piecePositions.white.push(pieceInfo);
                else piecePositions.black.push(pieceInfo);
                piecePositions.bySquare[square] = { symbol: pieceSymbol, color: piece.color, type: piece.type };
            }
        }
    }
    
    // Get legal moves for context
    const legalMoves = chess.moves({ verbose: true });
    const legalMoveCount = legalMoves.length;
    const isInCheck = chess.isCheck();
    const isInCheckmate = chess.isCheckmate();
    const isStalemate = chess.isStalemate();
    
    // Analyze the user move if provided
    let userMoveAnalysis = '';
    if (userMove && userMove !== 'N/A') {
        try {
            const tempChess = new Chess(fen);
            const moveObj = tempChess.move(userMove);
            if (moveObj) {
                const givesCheck = tempChess.isCheck();
                const captured = moveObj.captured ? ` captures ${moveObj.captured.toUpperCase()}` : '';
                const promotion = moveObj.promotion ? ` promotes to ${moveObj.promotion.toUpperCase()}` : '';
                const isCapture = moveObj.flags.includes('c');
                const isEnPassant = moveObj.flags.includes('e');
                const isCastle = moveObj.flags.includes('k') || moveObj.flags.includes('q');
                
                userMoveAnalysis = `User move ${userMove}: from ${moveObj.from} to ${moveObj.to}${captured}${promotion}. `;
                userMoveAnalysis += givesCheck ? 'GIVES CHECK. ' : 'Does not give check. ';
                userMoveAnalysis += isCapture ? 'Is a capture. ' : '';
                userMoveAnalysis += isEnPassant ? 'En passant. ' : '';
                userMoveAnalysis += isCastle ? 'Castling. ' : '';
                
                // Check if move attacks opponent king
                const opponentKingSquare = turn === 'w' ? blackKingSquare : whiteKingSquare;
                if (opponentKingSquare && (moveObj.to === opponentKingSquare || givesCheck)) {
                    userMoveAnalysis += `Directly attacks/checks opponent king on ${opponentKingSquare}. `;
                } else if (opponentKingSquare) {
                    userMoveAnalysis += `Opponent king on ${opponentKingSquare} - no direct attack. `;
                }
            }
        } catch (e) {
            userMoveAnalysis = `User move ${userMove}: could not analyze. `;
        }
    }
    
    // Best move analysis
    let bestMoveAnalysis = '';
    if (evaluation?.bestmove) {
        try {
            const tempChess = new Chess(fen);
            const bestMoveObj = tempChess.move(evaluation.bestmove);
            if (bestMoveObj) {
                const givesCheck = tempChess.isCheck();
                bestMoveAnalysis = `Engine best move ${evaluation.bestmove}: from ${bestMoveObj.from} to ${bestMoveObj.to}. `;
                bestMoveAnalysis += givesCheck ? 'GIVES CHECK. ' : 'Does not give check. ';
            }
        } catch (e) {
            bestMoveAnalysis = `Engine best move ${evaluation.bestmove}: could not analyze. `;
        }
    }
    
    // Build context string
    const playerColor = turn === 'w' ? 'White' : 'Black';
    
    let context = `Position: ${playerColor} to move (move ${moveNumber})
FEN: ${fen}
Side to move: ${playerColor} (${turn === 'w' ? 'w' : 'b'})
In check: ${isInCheck ? 'YES' : 'NO'}
${isInCheckmate ? 'CHECKMATE' : ''}
${isStalemate ? 'STALEMATE' : ''}
Legal moves: ${legalMoveCount}
White king: ${whiteKingSquare}
Black king: ${blackKingSquare}

Key pieces on board:
White: ${piecePositions.white.join(', ') || 'none'}
Black: ${piecePositions.black.join(', ') || 'none'}

${userMoveAnalysis}
${bestMoveAnalysis}

Center control (d4,d5,e4,e5): `;
    
    // Check center pawns
    const centerSquares = ['d4', 'd5', 'e4', 'e5'];
    const centerOccupation = centerSquares.map(sq => {
        const piece = piecePositions.bySquare?.[sq];
        if (piece) return `${piece.symbol}${sq}`;
        return `${sq}: empty`;
    }).join(', ');
    context += `${centerOccupation}.\n`;
    
    return context;
}

// Classification based on Win Probability Loss Delta (percentage points)
// Best: Exactly 0% loss
// Excellent: > 0% and <= 2% loss
// Good: > 2% and <= 5% loss
// Inaccuracy: > 5% and <= 10% loss
// Mistake: > 10% and <= 20% loss
// Blunder: > 20% and <= 100% loss
function classifyMove(bestScore, actualScore, moveNumber = null, san = null) {
    const bestProb = centipawnsToWinProb(bestScore);
    const actualProb = centipawnsToWinProb(actualScore);
    const impact = Math.max(0, bestProb - actualProb) * 100; // Win probability loss in percentage points

    // Match frontend: first move e4/d4 is excellent
    if (moveNumber === 1 && (san === 'e4' || san === 'd4')) {
        return 'excellent';
    }

    // Classification based on Win Probability Loss Delta (percentage points)
    if (impact <= 0) return 'best';
    if (impact <= 2.0) return 'excellent';
    if (impact <= 5.0) return 'good';
    if (impact <= 10.0) return 'inaccuracy';
    if (impact <= 20.0) return 'mistake';
    return 'blunder';
}

async function performAnalysis(fen, modelOverride, language = 'es', moveTimeMs = 200, userMove, classification) {
    const startTotal = performance.now();
    console.log(`\n\n===== [AI Analysis] START =====`);
    console.log(`[AI Analysis] Input params: language="${language}", userMove="${userMove}", model="${modelOverride || 'default'}", moveTimeMs=${moveTimeMs}`);
    console.log(`[AI Analysis] Language type: ${typeof language}, value: "${language}"`);
    console.log(`[AI Analysis] language === 'en': ${language.trim() === 'en'}`);
    console.log(`[AI Analysis] language.trim(): "${language.trim ? language.trim() : language}"`);
    console.log(`[AI Analysis] isEn will be: ${language.trim() === 'en'}`);
    process.stdout.flush?.();
    const fenId = getFenId(fen);
    // 1. Definimos primero la variable del modelo (¡Esto arregla el ReferenceError!)
    const model = modelOverride || 'qwen2.5:14b';
    
    // 2. Ahora sí, el chequeo del Cache tiene acceso a la variable 'model'
    // Skip cache when userMove is provided (since userMove varies per analysis of same position)
    if (!userMove) {
        const cached = getCachedAnalysis(fen, model, language);
        if (cached) {
            console.log(`[AI Analysis] ✅ Cache HIT for [${fenId}...] - returning cached analysis`);
            return cached;
        }
    }
    console.log(`[AI Analysis] 🔍 Cache MISS for [${fenId}...] - proceeding with fresh analysis`);

    // Preparar tablero post-move para calcular la refutación en paralelo
    const chess = new Chess(fen);
    const moveNumber = Math.floor(chess.moveNumber());
    const prefix = chess.turn() === 'w' ? `${moveNumber}. ` : `${moveNumber}... `;

    // CONFIGURACIÓN DE MOTOR: Forzamos profundidad 22 para máxima precisión
    let stockfishOptions = { depth: 22 }; 
    console.log(`[AI Analysis] ♟️  Requesting Stockfish eval (depth=22) for [${fenId}...]`);
    
    let tempChessFen = null;
    try {
        const tempChess = new Chess(fen);
        if (userMove) {
            const m = tempChess.move(userMove);
            if (m) tempChessFen = tempChess.fen();
        }
    } catch(e) {
        console.error(`[AI Analysis] ❌ Invalid user move for FEN setup: ${e.message}`);
    }

    // Lanzamos ambas peticiones al Pool pasando el objeto stockfishOptions
    const stockfishPromises = [
        getEngineEvaluation(fen, stockfishOptions)
    ];
    
    if (tempChessFen) {
        stockfishPromises.push(getEngineEvaluation(tempChessFen, stockfishOptions));
    }

    // Esperamos las respuestas de Stockfish en paralelo
    console.log(`[AI Analysis] ⏳ Waiting for engine results for [${fenId}...] (${stockfishPromises.length} positions)`);
    const stockfishResults = await Promise.all(stockfishPromises);
    console.log(`[AI Analysis] ✅ Engine results received for [${fenId}...]`);
    
    const evaluation = stockfishResults[0];
    const postMoveEvaluation = stockfishResults[1] || null; // Manejo por si no hubo jugada del usuario

    const bestScore = normalizeScore(evaluation.score, evaluation.scoreType);
    const sanBestMove = uciToSan(fen, evaluation.bestmove);
    const sanPv = evaluation.pv ? uciToSan(fen, evaluation.pv) : 'N/A';
    
    let sanUserMove = 'N/A';
    let uciUserMove = null;
    if (userMove) {
        const unicodeMapping = { 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔' };
        let san = userMove;
        if (unicodeMapping[san[0]]) san = unicodeMapping[san[0]] + san.substring(1);
        sanUserMove = `${prefix}${san}`;
        
        // Convert userMove SAN to UCI for frontend arrow rendering
        try {
            const move = chess.move(userMove);
            if (move) {
                uciUserMove = move.from + move.to + (move.promotion || '');
                chess.undo(); // Undo to restore original position
            }
        } catch (e) {
            console.warn(`Could not convert userMove ${userMove} to UCI:`, e.message);
        }
    }

    let actualScore = bestScore;
    let sanRefutationLine = 'N/A';

    if (postMoveEvaluation) {
        // Perspective of moving player: negate opponent's best score in resulting position
        actualScore = -normalizeScore(postMoveEvaluation.score, postMoveEvaluation.scoreType); 
        if (postMoveEvaluation.pv) {
            sanRefutationLine = uciToSan(tempChessFen, postMoveEvaluation.pv);
            // Le añadimos la jugada del usuario al inicio para que tenga contexto
            sanRefutationLine = `${sanUserMove} ${sanRefutationLine}`; 
        }
    }

    const cpLoss = Math.max(0, bestScore - actualScore);

    // ¡NUEVA LÓGICA DE CLASIFICACIÓN! - Use impact-based classification (aligns with frontend)
    // IGNORE the passed 'classification' parameter as it may be buggy (from frontend)
    const mappedClassification = classifyMove(bestScore, actualScore, moveNumber, userMove);
    
    // Classification display name (localized)
    const classificationNames = {
        en: { best: 'best', excellent: 'excellent', good: 'good', inaccuracy: 'inaccuracy', mistake: 'mistake', blunder: 'blunder' },
        es: { best: 'mejor', excellent: 'excelente', good: 'bueno', inaccuracy: 'imprecisión', mistake: 'error', blunder: 'grave' }
    };
    const langKey = language.trim() === 'en' ? 'en' : 'es';
    const localizedClassification = classificationNames[langKey][mappedClassification] || mappedClassification;

    console.log(`[AI Analysis] 📊 Evaluation: bestScore=${bestScore} actualScore=${actualScore} cpLoss=${cpLoss} classification=${mappedClassification} bestMove=${sanBestMove}`);

    // chess.turn() devuelve 'w' o 'b' del FEN original (antes del movimiento del usuario)
    const playerColorCode = chess.turn(); 
    const systemPrompt = getSystemPrompt(language, playerColorCode);

    // Build factual position context to prevent hallucination
    const positionContext = buildPositionContext(fen, userMove, evaluation);
    console.log(`[AI Analysis] 📋 Position context built for [${fenId}...]`);

    const userPrompt = `User Move: ${sanUserMove}
Classification: ${mappedClassification} (${localizedClassification})
Evaluation: ${cpLoss}
Refutation Line (Use for Cons): ${sanRefutationLine}
Best Move: ${sanBestMove}
Best Line (Use for Alternative): ${sanPv}

--- POSITION CONTEXT (FACTUAL - DO NOT HALLUCINATE) ---
${positionContext}`;

    // 3. Ollama Profiling (JSON Mode)
    const startOllama = performance.now();
    console.log(`[AI Analysis] 🤖 Calling Ollama (${model}) for [${fenId}...]...`);
    let generatedHtml = '';

    try {
    const fullPrompt = `${systemPrompt}\n\n[Context Data]\n${userPrompt}`;
        
    const response = await ollama.generate({
        model: model,
        prompt: fullPrompt,
        format: 'json', // <--- CRÍTICO: Fuerza a Ollama a devolver un JSON puro
        options: { 
            temperature: 0.0,
            num_predict: 512,
            num_ctx: 4096,
        }
    });

    // 4. Parsear el JSON y construir el HTML localmente en Node.js
    let analysisData;
    try {
        // Limpieza preventiva por si el LLM pone tags de markdown "```json"
        let rawJson = response.response.replace(/```json/gi, '').replace(/```/g, '').trim();
        // DEBUG: Log raw JSON to see what LLM actually outputs
        console.log(`[AI Analysis] 🔍 Raw JSON sample: ${rawJson.substring(0, 500)}`);
        // Fix: LLM may output literal \u2022 instead of actual bullet chars - decode them
        rawJson = rawJson.replace(/\\u2022/g, '•').replace(/u2022/g, '•');
        analysisData = JSON.parse(rawJson);
        console.log(`[AI Analysis] ✅ Ollama JSON parsed successfully for [${fenId}...]`);
        
        // DEBUG: Check if bullet escapes remain in parsed data
        const checkForEscapes = (obj, path = '') => {
            if (typeof obj === 'string' && obj.includes('\\u2022')) {
                console.log(`[AI Analysis] ⚠️ Found \\u2022 in parsed data at ${path}: ${obj.substring(0, 100)}`);
            }
            if (obj && typeof obj === 'object') {
                for (const [key, value] of Object.entries(obj)) {
                    checkForEscapes(value, `${path}.${key}`);
                }
            }
        };
        checkForEscapes(analysisData, 'analysisData');
        
        // Also clean bullet escape sequences from all string fields in analysisData
        const cleanBulletEscapes = (obj) => {
            if (typeof obj === 'string') {
                return obj.replace(/\\u2022/g, '•').replace(/u2022/g, '•').replace(/\\u00a0/g, ' ').replace(/\\u00e0/g, 'à').replace(/\\u00e9/g, 'é').replace(/\\u00ed/g, 'í').replace(/\\u00f3/g, 'ó').replace(/\\u00fa/g, 'ú').replace(/\\u00f1/g, 'ñ');
            }
            if (Array.isArray(obj)) {
                return obj.map(cleanBulletEscapes);
            }
            if (obj && typeof obj === 'object') {
                const cleaned = {};
                for (const [key, value] of Object.entries(obj)) {
                    cleaned[key] = cleanBulletEscapes(value);
                }
                return cleaned;
            }
            return obj;
        };
        analysisData = cleanBulletEscapes(analysisData);
    } catch (e) {
        console.error(`[AI Analysis] ❌ Parse Error - Failed to read Ollama JSON for [${fenId}...]:`, e);
        throw new Error("El modelo no devolvió un JSON válido.");
    }

        const isEn = language.trim() === 'en';
        
        // Use correct article based on classification first letter sound
        const getArticle = (classification, isEnglish) => {
            if (!isEnglish) return 'es un/una';
            const firstChar = classification.charAt(0).toLowerCase();
            const vowels = 'aeiou';
            return vowels.includes(firstChar) ? 'an' : 'a';
        };
        const article = getArticle(mappedClassification, isEn);
        
        // Ensamblado perfecto del HTML sin tokens basura
        generatedHtml = `**${sanUserMove}** ${isEn ? `is ${article}` : 'es un/una'} **${localizedClassification}** (${cpLoss}cp). ${analysisData.generalExplanation}\n`;

        if (analysisData.cons && analysisData.cons.exists) {
            generatedHtml += `\n# ${isEn ? 'Cons' : 'Contras'}:\n`;
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

        // Post-generation validation against board to catch hallucinations
        const playerColorName = chess.turn() === 'w' ? 'white' : 'black';
        const validation = validateAnalysisAgainstBoard(cleanAnalysis, fen, playerColorName);
        if (!validation.valid) {
            console.warn(`[AI Analysis] ⚠️ Hallucination detection for [${fenId}...]: ${validation.corrections.length} corrections`);
            validation.warnings.forEach(w => console.warn(`[AI Validation] ${w}`));
            // Use the corrected analysis
            if (validation.validatedAnalysis !== cleanAnalysis) {
                console.log(`[AI Analysis] 🔧 Applied corrections to analysis`);
            }
        }
        const finalAnalysis = validation.validatedAnalysis;

        // FINAL safety net: clean any remaining unicode escape sequences from the complete HTML
        const finalCleanAnalysis = finalAnalysis
            .replace(/\\u2022/g, '•').replace(/u2022/g, '•')
            .replace(/\\u00a0/g, ' ')
            .replace(/\\u00e0/g, 'à')
            .replace(/\\u00e9/g, 'é')
            .replace(/\\u00ed/g, 'í')
            .replace(/\\u00f3/g, 'ó')
            .replace(/\\u00fa/g, 'ú')
            .replace(/\\u00f1/g, 'ñ');

        // DEBUG: Check if any u2022 remains
        if (finalCleanAnalysis.includes('\\u2022')) {
            console.log(`[AI Analysis] ⚠️ FINAL CLEAN: u2022 still present in final HTML!`);
        }

        const ollamaDuration = (performance.now() - startOllama).toFixed(1);
        const totalDuration = (performance.now() - startTotal).toFixed(1);
        console.log(`[AI Analysis] ✅ Completed for [${fenId}...] in ${totalDuration}ms (Ollama: ${ollamaDuration}ms, Stockfish: ${totalDuration - ollamaDuration}ms)`);
        console.log(`[AI Analysis] 📝 Generated analysis length: ${finalCleanAnalysis.length} chars`);

        const result = {
            fen,
            uciBestMove: evaluation.bestmove,
            bestmove: formatChessText(sanBestMove),
            score: actualScore,
            bestScore: bestScore,
            scoreType: evaluation.scoreType,
            analysis: finalCleanAnalysis,
            language,
            pv: evaluation.pv,
            cpLoss,
            classification: mappedClassification,
            userMove: uciUserMove || userMove // Pass UCI for arrow rendering
        };
        
        // Only cache results without userMove (generic analysis)
        if (!userMove) {
            setCachedAnalysis(fen, model, result, language);
        }
        return result;

    } catch (err) {
        const totalDuration = (performance.now() - startTotal).toFixed(1);
        console.error(`[AI Analysis] ❌ Failed for [${fenId}...] after ${totalDuration}ms: ${err.message}`);
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

  console.log(`\n\n===== [API /analyze] Request =====`);
  console.log(`[API] language="${language}", userMove="${userMove}", model="${model}"`);
  
  try {
    const result = await performAnalysis(fen, model, language || 'es', moveTime, userMove, classification);
    const apiDuration = (performance.now() - startApi).toFixed(1);
    console.log(`[Perf: API] [${fenId}] End-to-End Time: ${apiDuration}ms`);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SSE endpoint for batch AI analysis - streams results as they complete
app.get('/api/analyze-stream', async (req, res) => {
  const startApi = performance.now();
  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send a message to the client
  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const sendError = (index, error) => {
    sendEvent({ index, error: error.message, result: null });
  };

  const sendDone = () => {
    res.write('data: [DONE]\n\n');
  };

  try {
    const { fens, model, language, moveTime } = req.query;
    
    if (!fens) {
      sendEvent({ error: "Missing 'fens' parameter" });
      sendDone();
      console.log('[SSE Stream] ❌ Missing fens parameter');
      return res.end();
    }

    const moves = JSON.parse(fens);
    const modelOverride = model || 'qwen2.5:14b';
    const lang = language || 'es';
    const timeMs = parseInt(moveTime) || 200;
    const streamStart = performance.now();

    console.log(`[SSE Stream] 🚀 Starting batch analysis: ${moves.length} moves, Model=${modelOverride}, Lang=${lang}`);
    moves.forEach((m, i) => {
        console.log(`[SSE Stream] 📋 Move ${i+1}: index=${m.index} fen=${getFenId(m.fen)} move=${m.userMove} class=${m.classification} player=${m.movingPlayer}`);
    });

    // Process moves sequentially to avoid overwhelming the system
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      const index = move.index; // 1-based index from frontend
      
      try {
        // Check if client is still connected
        if (res.destroyed) {
            console.log(`[SSE Stream] ⚠️  Client disconnected, stopping at move ${index}`);
            break;
        }

        console.log(`[SSE Stream] ⏳ Processing move ${index}/${moves.length} [${getFenId(move.fen)}...]`);
        const moveStart = performance.now();

        const result = await performAnalysis(
          move.fen, 
          modelOverride, 
          lang, 
          timeMs, 
          move.userMove,
          move.classification
        );

        const moveDuration = (performance.now() - moveStart).toFixed(1);
        console.log(`[SSE Stream] ✅ Move ${index} completed in ${moveDuration}ms`);

        sendEvent({ 
          index, 
          result: { 
            analysis: result.analysis, 
            bestmove: result.bestmove,
            userMove: result.userMove
          }, 
          error: null 
        });

      } catch (err) {
        console.error(`[SSE Stream] ❌ Error analyzing move ${index} [${getFenId(move.fen)}...]: ${err.message}`);
        sendError(index, err);
      }
    }

    const totalDuration = (performance.now() - streamStart).toFixed(1);
    console.log(`[SSE Stream] ✅ Batch completed: ${moves.length} moves in ${totalDuration}ms`);
    
    sendDone();
    const apiDuration = (performance.now() - startApi).toFixed(1);
    console.log(`[Perf: SSE] Batch of ${moves.length} moves completed in ${apiDuration}ms`);
    
    res.end();

  } catch (error) {
    console.error('[SSE Stream] ❌ Fatal error:', error);
    sendEvent({ error: error.message });
    sendDone();
    res.end();
  }
});

app.post('/api/evaluate-all', async (req, res) => {
  const startApi = performance.now();
  const { fens } = req.body;
  if (!fens || !Array.isArray(fens)) {
    return res.status(400).json({ error: "Missing or invalid 'fens' array" });
  }

  try {
    // Process in parallel with controlled concurrency
    const CONCURRENCY = 3;
    const results = [];
    
    for (let i = 0; i < fens.length; i += CONCURRENCY) {
      const chunk = fens.slice(i, i + CONCURRENCY);
      const chunkPromises = chunk.map(async (fen) => {
        const fenId = getFenId(fen);
        try {
          const evalResult = await getEngineEvaluation(fen, { depth: 22 });
          return {
            fen,
            score: evalResult.score,
            bestmove: evalResult.bestmove,
            uciBestMove: evalResult.bestmove,
            scoreType: evalResult.scoreType,
            pv: evalResult.pv,
            source: evalResult.source
          };
        } catch (err) {
          console.error(`[Evaluate-All] Error for [${fenId}...]:`, err.message);
          return {
            fen,
            score: 0,
            bestmove: '',
            uciBestMove: '',
            scoreType: 'cp',
            pv: '',
            source: 'error',
            error: err.message
          };
        }
      });
      
      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    const apiDuration = (performance.now() - startApi).toFixed(1);
    console.log(`[Perf: Evaluate-All] Batch of ${fens.length} FENs completed in ${apiDuration}ms`);
    
    res.json(results);
  } catch (error) {
    console.error('[Evaluate-All] Fatal error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running on port ${PORT}`);
  pool.waitForAllReady().catch(console.error);
});

// Graceful shutdown: flush any pending debounced cache writes and tear down
// the worker pool so we don't orphan stockfish children on exit.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Shutdown] ${signal} received, flushing cache...`);
  try {
    await flushCache();
    console.log('[Shutdown] ✅ Cache flushed.');
  } catch (e) {
    console.error('[Shutdown] ❌ Flush failed:', e.message);
  }
  for (const worker of pool.workers) {
    try { worker.engine?.kill('SIGTERM'); } catch {}
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
