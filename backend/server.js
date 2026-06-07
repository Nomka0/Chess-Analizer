import express from 'express';
import cors from 'cors';
import stockfish from 'stockfish';
import ollama from 'ollama';
import { getCachedAnalysis, setCachedAnalysis } from './cache.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

// Global Stockfish engine state
let engine;
let currentResolve = null;
let currentReject = null;
let bestMove = null;
let score = null;
let scoreType = 'cp';
let uciOutputs = [];

// Initialize Stockfish engine once during server start
async function initStockfish() {
  return new Promise(async (resolve, reject) => {
    try {
      console.log("[Stockfish] Loading WASM chess engine...");
      engine = await stockfish();
      
      // Hijack process.stdout to parse UCI output
      const originalWrite = process.stdout.write;
      process.stdout.write = (chunk, encoding, callback) => {
        const str = chunk.toString();
        const lines = str.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            handleEngineLine(trimmed);
          }
        }
        return originalWrite.call(process.stdout, chunk, encoding, callback);
      };
      
      console.log("[Stockfish] Engine loaded and stdout redirected.");
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function handleEngineLine(line) {
  // Save all lines for debugging/info if needed
  uciOutputs.push(line);

  // Parse info lines for score
  if (line.includes('score')) {
    const parts = line.split(' ');
    const scoreIdx = parts.indexOf('score');
    if (scoreIdx !== -1 && scoreIdx + 2 < parts.length) {
      const type = parts[scoreIdx + 1]; // 'cp' or 'mate'
      const val = parts[scoreIdx + 2];
      if (!isNaN(parseInt(val))) {
        score = parseInt(val);
        scoreType = type;
      }
    }
  }

  // Parse bestmove
  if (line.startsWith('bestmove')) {
    const parts = line.split(' ');
    bestMove = parts[1];

    if (currentResolve) {
      const resolveFn = currentResolve;
      currentResolve = null;
      currentReject = null;
      resolveFn({
        bestmove: bestMove,
        score: score,
        scoreType: scoreType
      });
    }
  }
}

// Single-instance Stockfish evaluation runner
async function evaluatePosition(fen) {
  return new Promise((resolve, reject) => {
    if (!engine) {
      return reject(new Error("Stockfish engine is not initialized"));
    }

    bestMove = null;
    score = null;
    scoreType = 'cp';
    uciOutputs = [];
    currentResolve = resolve;
    currentReject = reject;

    // Send position and analysis depth to Stockfish
    engine.sendCommand(`position fen ${fen}`);
    engine.sendCommand("go depth 3");

    // Timeout safety
    setTimeout(() => {
      if (currentResolve === resolve) {
        currentResolve = null;
        currentReject = null;
        reject(new Error("Stockfish evaluation timed out (15s)"));
      }
    }, 15000);
  });
}

// Simple request queue to prevent concurrent engine access
class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  async add(fen) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fen, resolve, reject });
      this.processNext();
    });
  }

  async processNext() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const { fen, resolve, reject } = this.queue.shift();
    try {
      const result = await evaluatePosition(fen);
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.processing = false;
      this.processNext();
    }
  }
}

const stockfishQueue = new RequestQueue();

function getSystemPrompt(evaluation, language) {
    const isEn = language === 'en';
    if (isEn) {
        return `You are a "Chess Grandmaster and Coach".
Your goal is to analyze the chess position provided by the FEN.
You MUST respond STRICTLY in English and follow this structured Markdown format:

# 📊 Board Evaluation
---
- **Current Situation**: [Brief description of the advantage]
- **Stockfish Evaluation**: ${evaluation.score} ${evaluation.scoreType === 'cp' ? 'centipawns (cp)' : 'moves to checkmate'}. [Brief explanation of what this means].
- **Material Balance**: [Description of the balance]

# ⚠️ Immediate Threat
---
*What does the opponent want to do in their next move if we do nothing?*
- **💡 Tactical Alert**: [Detailed explanation]

# 🧠 Best Move Analysis: ${evaluation.bestmove}
---
- **Move Type**: [Defensive / Attack / Development / Prophylactic]
- **Why is it the best option?**:
    - **Tactical Solution**: [Detailed explanation]
    - **Piece Activity**: [Detailed explanation]

# 🗺️ Recommended Game Plan
---
- **For the active player**: [What to look for in the next 3 moves]
- **Calculated Critical Line**: [Short sequence of moves]`;
    } else {
        return `Eres un "Gran Maestro y Entrenador de Ajedrez". 
Tu objetivo es analizar la posición en el tablero proporcionada por el FEN. 
Debes responder ESTRICTAMENTE en español y seguir el siguiente formato de Markdown estructurado:

# 📊 Evaluación del Tablero
---
- **Situación Actual**: [Descripción breve de la ventaja]
- **Evaluación de Stockfish**: ${evaluation.score} ${evaluation.scoreType === 'cp' ? 'centipeones (cp)' : 'jugadas para mate'}. [Explicación breve de qué significa].
- **Balance Material**: [Descripción del balance]

# ⚠️ La Amenaza Inmediata
---
*¿Qué quiere hacer el rival en su siguiente jugada si no hacemos nada?*
- **💡 Alerta táctica**: [Explicación detallada]

# 🧠 Análisis de la Mejor Jugada: ${evaluation.bestmove}
---
- **Tipo de Jugada**: [Defensiva / Ataque / Desarrollo / Profiláctica]
- **¿Por qué es la mejor opción?**:
    - **Solución Táctica**: [Explicación detallada]
    - **Actividad de Piezas**: [Explicación detallada]

# 🗺️ Plan de Juego Recomendado
---
- **Para el jugador activo**: [Qué buscar en las próximas 3 jugadas]
- **Línea crítica calculada**: [Secuencia corta de jugadas]`;
    }
}

async function performAnalysis(fen, modelOverride, language = 'es') {
    const evaluation = await stockfishQueue.add(fen);
    const model = modelOverride || 'phi4-mini:latest';
    
    const cached = getCachedAnalysis(fen, model, language);
    if (cached) return cached;

    const systemPrompt = getSystemPrompt(evaluation, language);
    const userPrompt = language === 'en' 
        ? `Analyze FEN: ${fen}. Best move is ${evaluation.bestmove}.` 
        : `Analiza la posición FEN: ${fen}. La jugada recomendada es ${evaluation.bestmove}.`;

    try {
        const response = await ollama.chat({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            options: { temperature: 0.3 }
        });

        const result = {
            fen,
            bestmove: evaluation.bestmove,
            score: evaluation.score,
            scoreType: evaluation.scoreType,
            analysis: response.message.content,
            language
        };

        setCachedAnalysis(fen, model, result, language);
        return result;
    } catch (err) {
        console.error(`[Ollama] Error:`, err);
        throw err;
    }
}

// GET route: /api/models
app.get('/api/models', async (req, res) => {
  try {
    const list = await ollama.list();
    res.json(list.models.map(m => m.name));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch models" });
  }
});

// POST route: /api/analyze
app.post('/api/analyze', async (req, res) => {
  const { fen, model, language } = req.body;
  if (!fen) return res.status(400).json({ error: "Missing FEN" });
  
  try {
    const result = await performAnalysis(fen, model, language || 'es');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST route: /api/evaluate-all
app.post('/api/evaluate-all', async (req, res) => {
  const { fens } = req.body;
  if (!fens || !Array.isArray(fens)) return res.status(400).json({ error: "Missing FENs" });

  const results = [];
  for (const fen of fens) {
    try {
      const evaluation = await stockfishQueue.add(fen);
      results.push({ fen, ...evaluation });
    } catch (err) {
      results.push({ fen, error: err.message });
    }
  }
  res.json(results);
});

// POST route: /api/analyze-all
app.post('/api/analyze-all', async (req, res) => {
  const { fens, model, language } = req.body;
  if (!fens || !Array.isArray(fens)) return res.status(400).json({ error: "Missing FENs" });

  const results = [];
  for (const fen of fens) {
      try {
          const res = await performAnalysis(fen, model, language || 'es');
          results.push(res);
      } catch (err) {
          results.push({ fen, error: err.message });
      }
  }
  res.json(results);
});

async function startServer() {
  try {
    await initStockfish();
    app.listen(PORT, () => {
      console.log(`[Server] Chess Analyzer Backend running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
