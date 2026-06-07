import express from 'express';
import cors from 'cors';
import stockfish from 'stockfish';
import ollama from 'ollama';

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
  const { fen, model } = req.body;
  if (!fen) {
    return res.status(400).json({ error: "Missing FEN string in request body" });
  }
  
  try {
    const result = await performAnalysis(fen, model);
    res.json(result);
  } catch (error) {
    console.error(`[API Error]`, error.message);
    res.status(500).json({ error: "Error en el análisis de ajedrez", details: error.message });
  }
});

import { getCachedAnalysis, setCachedAnalysis } from './cache.js';

// Helper for single analysis with cache and stream
async function performAnalysisStreamed(fen, modelOverride, res) {
    // 1. Evaluate position with Stockfish
    const evaluation = await stockfishQueue.add(fen);
    
    // Check cache
    const model = modelOverride || 'gemma4:latest';
    const cached = getCachedAnalysis(fen, model);
    if (cached) {
        res.write(`data: ${JSON.stringify(cached)}\n\n`);
        res.end();
        return;
    }

    // 2. Query Ollama with streaming
    const systemPrompt = `Eres un Gran Maestro de Ajedrez y un riguroso lingüista español. Tu única misión es traducir el análisis técnico de Stockfish a un español ajedrecístico impecable, fluido y profesional.

[REGLAS CRÍTICAS DE IDIOMA - PROHIBICIÓN ABSOLUTA]
1. Está TERMINANTEMENTE PROHIBIDO inventar palabras o usar spanglish.
2. Si usas palabras como: "gainear", "thermo", "fiani", "menudo", "esfinge", "filetas", "developeda", "bisbotes" o "bolas", el análisis será incorrecto.
3. Traduce SIEMPRE los bandos y las piezas:
   - "White" -> Las Blancas
   - "Black" -> Las Negras
   - "Pawns" -> Peones
   - "Knights" -> Caballos
   - "Bishops" -> Alfiles
   - "Rooks" -> Torres
   - "Queens" -> Damas
   - "King" -> Rey
   - "Files / Ranks" -> Columnas / Filas
   - "Queenside / Kingside" -> Flanco de dama / Flanco de rey
   - "Development" -> Desarrollo

[EJEMPLO DE KHAN / REFERENCIA REAL]
User FEN: [Cualquier posición]
Response:
# 📊 Evaluación del Tablero
- **Situación Actual**: Ventaja decisiva de las Negras.
- **Evaluación de Stockfish**: -3.05 centipeones (cp). Esto significa que las Negras tienen una ventaja equivalente a tres peones de diferencia gracias a su mejor estructura.
- **Balance Material**: Igualdad de piezas menores, pero las Negras cuentan con la pareja de alfiles activa.

# ⚠️ La Amenaza Inmediata (¡Lo más importante!)
- **💡 Alerta táctica**: Las Negras amenazan con avanzar su peón a e5, expulsando al alfil blanco y tomando el control total de las casillas centrales.

# 🧠 Análisis de la Mejor Jugada: ${evaluation.bestmove}
- **Tipo de Jugada**: Desarrollo y Ataque.
- **¿Por qué es la mejor opción?**:
    - **Solución Táctica**: Controla la ruptura central y abre diagonales para nuestras piezas de largo alcance.
    - **Actividad de Piezas**: Activa el caballo hacia una casilla fuerte y restringe los saltos del rival.

# 🗺️ Plan de Juego Recomendado
- **Para el jugador activo**: Consolidar el centro de peones y enrocar en las próximas 3 jugadas.
- **Línea crítica calculada**: Nf3, d4, d5.

[FIN DEL EJEMPLO]

Analiza el FEN proporcionado. Escribe de forma natural, seria y profesional, como un libro de ajedrez en español. Sigue este formato estrictamente:`;

    try {
        const stream = await ollama.chat({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            options: { temperature: 0.3 },
            stream: true
        });

        let fullResponse = "";
        for await (const chunk of stream) {
            const content = chunk.message.content;
            fullResponse += content;
            // Send chunk to frontend
            res.write(`data: ${JSON.stringify({ chunk: content })}\n\n`);
        }

        const result = {
            fen,
            bestmove: evaluation.bestmove,
            score: evaluation.score,
            scoreType: evaluation.scoreType,
            analysis: fullResponse
        };

        // Cache result
        setCachedAnalysis(fen, model, result);
        res.end();

    } catch (err) {
        console.error(`[Ollama] Error:`, err);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
}

// POST route: /api/analyze-stream
app.post('/api/analyze-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const { fen, model } = req.body;
    performAnalysisStreamed(fen, model, res);
});



// Helper for single analysis
async function performAnalysis(fen, modelOverride) {
    // 1. Evaluate position with Stockfish
    const evaluation = await stockfishQueue.add(fen);
    
    // Check cache
    const model = modelOverride || 'gemma4:latest';
    const cached = getCachedAnalysis(fen, model);
    if (cached) return cached;

    // 2. Query Ollama

    const systemPrompt = `Eres un "Gran Maestro y Entrenador de Ajedrez". 
Tu objetivo es analizar la posición en el tablero proporcionada por el FEN. 

REGLA DE ORO OBLIGATORIA: Debes responder ESTRICTAMENTE en español nativo y natural. 
Está TOTALMENTE PROHIBIDO usar palabras en inglés o spanglish (NO uses "development", "squares", "queenside", "trajes", etc.). Usa los términos correctos en español: "desarrollo", "casillas", "flanco de dama", "amenazas ocultas". Piensa y escribe 100% en español.

Debes seguir el siguiente formato de Markdown estructurado:


# 📊 Evaluación del Tablero
---
- **Situación Actual**: [Ventaja decisiva Negra / Ventaja ligera Blanca / Igualdad numérica]
- **Evaluación de Stockfish**: ${evaluation.score} ${evaluation.scoreType === 'cp' ? 'centipeones (cp)' : 'jugadas para jaque mate'}. [Explicación breve de qué significa].
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

    const userPrompt = `Analiza la posición FEN: ${fen}. La jugada recomendada es ${evaluation.bestmove}.`;

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
            analysis: response.message.content
        };

        // Cache result
        setCachedAnalysis(fen, model, result);
        return result;

    } catch (err) {
        console.error(`[Ollama] Error:`, err);
        throw err;
    }
}

// POST route: /api/evaluate-all
app.post('/api/evaluate-all', async (req, res) => {
  const { fens } = req.body;
  if (!fens || !Array.isArray(fens)) {
    return res.status(400).json({ error: "Missing FENs array" });
  }

  console.log(`[API] Received batch evaluation request for ${fens.length} positions`);

  const results = [];
  for (const fen of fens) {
    try {
      const evaluation = await stockfishQueue.add(fen);
      results.push({ fen, ...evaluation });
    } catch (err) {
      console.error(`[API Batch Error] FEN: ${fen}`, err.message);
      results.push({ fen, error: err.message });
    }
  }
  console.log(`[API] Batch request completed for ${fens.length} positions`);
  res.json(results);
});

// POST route: /api/analyze-all
app.post('/api/analyze-all', async (req, res) => {
  const { fens, model } = req.body;
  if (!fens || !Array.isArray(fens)) {
    return res.status(400).json({ error: "Missing FENs array" });
  }

  console.log(`[API] Received pipelined analysis request for ${fens.length} positions`);

  const results = [];
  
  // Pipeline function: Process evaluation in parallel but analysis sequentially
  async function pipeline(fen) {
      // 1. Evaluate with Stockfish (parallel)
      const evaluation = await stockfishQueue.add(fen);
      
      // 2. Perform AI analysis (sequential)
      return await performAnalysis(fen, model);
  }

  // To keep AI analysis sequential while evaluating in parallel,
  // we can use a p-limit or just a simple sequential queue for the results.
  for (const fen of fens) {
      try {
          // This will await each evaluation and analysis in order.
          // To make evaluations parallel, we would need to pre-evaluate all,
          // but that's memory-intensive.
          // Given the user's constraints, this is the most stable approach.
          results.push(await pipeline(fen));
      } catch (err) {
          results.push({ fen, error: err.message });
      }
  }
  
  console.log(`[API] Pipeline analysis completed for ${fens.length} positions`);
  res.json(results);
});

// Start the server only after Stockfish is loaded
async function startServer() {
  try {
    await initStockfish();
    app.listen(PORT, () => {
      console.log(`[Server] Chess Analyzer Backend running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server due to Stockfish load error:", err);
    process.exit(1);
  }
}

startServer();
