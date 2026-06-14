import { Ollama } from 'ollama';
import { traceManager } from './observability.js';
import { executeTool, getAllToolSchemas } from './tools.js';
import { centipawnsToWinProb, classifyMove, uciToSan, formatChessText, sanitizeLLMOutput, getSystemPrompt } from './utils.js';
import { Chess } from 'chess.js';
import { setCachedAnalysis } from './cache.js';

const ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

// Default model for ReAct agent
const DEFAULT_MODEL = 'qwen2.5-coder:14b';
const MAX_REACT_STEPS = 10;
const AGENT_TIMEOUT_MS = 120000; // 2 minutes total timeout

console.log('[ReAct Agent] Module loaded, DEFAULT_MODEL:', DEFAULT_MODEL);

/**
 * Build the system prompt for the ReAct agent
 * Optimized for Qwen 2.5 Coder JSON tool calling
 */
export function buildReActSystemPrompt(language, playerColor) {
  const isEn = language === 'en';
  const colorName = playerColor === 'w' ? (isEn ? 'White' : 'Blancas') : (isEn ? 'Black' : 'Negras');
  const opponentColor = playerColor === 'w' ? (isEn ? 'Black' : 'Negras') : (isEn ? 'White' : 'Blancas');
  
  const toolSchemas = getAllToolSchemas();
  const toolDescriptions = toolSchemas.map(t => {
    const params = Object.entries(t.parameters.properties || {})
      .map(([name, schema]) => `    "${name}": ${schema.description || ''} (${schema.type}${schema.required ? ', required' : ''})`)
      .join('\n');
    return `- ${t.name}: ${t.description}\n  Parameters:\n${params}`;
  }).join('\n\n');

  return `You are an expert chess analyst using a ReAct (Reason-Act-Observe) process.
You are analyzing a position for the **${colorName}** pieces. Opponent: **${opponentColor}**.

CRITICAL RULES:
1. You MUST follow the ReAct loop: THOUGHT -> ACTION -> OBSERVATION -> repeat
2. Each response MUST be a SINGLE valid JSON object with the exact structure below
3. You have access to these tools (call ONE per step):

${toolDescriptions}

4. Output format - ALWAYS respond with this JSON structure:
{
  "thought": "Your reasoning about the current state and what to do next",
  "action": {
    "tool": "tool_name",
    "params": { "param1": "value1" },
    "reasoning": "Why you're calling this tool"
  }
}

5. When you have enough information to provide the FINAL analysis, use this format:
{
  "thought": "I have gathered all necessary information. I can now provide the complete analysis.",
  "final": {
    "generalExplanation": "1 brief sentence explaining the tactical consequence based ONLY on the context data.",
    "cons": {
      "exists": true,
      "title": "Short title",
      "explanation": "Detailed explanation of why the User Move is bad, strictly based on the Refutation Line provided."
    },
    "pros": {
      "exists": true,
      "title": "Short title",
      "explanation": "Explanation of the positive aspect."
    },
    "alternative": {
      "explanation": "Explanation of why the EXACT Best Move provided in the context is superior to the User Move."
    }
  }
}

6. IDENTIFY THE TURN CORRECTLY:
   - Moves starting with single dot (e.g., "4. dxe4") are ALWAYS White
   - Moves starting with three dots (e.g., "4... dxe4") are ALWAYS Black
   - Never confuse who made the move

7. Analyze EXCLUSIVELY from the perspective of the ${colorName} pieces.
   - If the move attacks the opponent, it is a "Pro"
   - If it harms the player, it is a "Con"

8. DO NOT INVENT OR SUGGEST YOUR OWN MOVES. You MUST strictly base your entire analysis on the "Best Move", "Best Line", and "Refutation Line" provided in the context.

9. If the context says the "Best Move" is Nf6, your alternative explanation must ONLY be about why Nf6 is good.

Language: ${language}`;
}

/**
 * Build the user prompt with context data
 */
export function buildUserPrompt(context) {
  const { sanUserMove, classification, cpLoss, sanRefutationLine, sanBestMove, sanPv } = context;
  
  return `User Move: ${sanUserMove}
Classification: ${classification}
Evaluation: ${cpLoss}cp
Refutation Line (Use for Cons): ${sanRefutationLine}
Best Move: ${sanBestMove}
Best Line (Use for Alternative): ${sanPv}`;
}

/**
 * Run the ReAct agent loop
 * @param {Object} params - { fen, model, language, moveTimeMs, userMove, classification }
 * @returns {Promise<Object>} Final analysis result with traces
 */
export async function runReActAgent(params) {
  const {
    fen,
    model = DEFAULT_MODEL,
    language = 'es',
    moveTimeMs = 200,
    userMove,
    classification: inputClassification
  } = params;

  console.log('[ReAct Agent] Starting with params:', { fen: fen.substring(0,20), model, language, userMove, moveTimeMs });

  const traceId = traceManager.startTrace({
    fen,
    model,
    language,
    userMove,
    moveTimeMs
  });

  const startTotal = performance.now();
  traceManager.recordThought(`Starting ReAct agent for position ${fen.substring(0, 15)}...`);

  try {
    // Pre-compute engine data that the agent will need
    const chess = new Chess(fen);
    const moveNumber = Math.floor(chess.moveNumber());
    const prefix = chess.turn() === 'w' ? `${moveNumber}. ` : `${moveNumber}... `;
    
    console.log('[ReAct Agent] Created chess board, moveNumber:', moveNumber, 'turn:', chess.turn());
    traceManager.recordThought('Computing initial engine evaluation');
    
    // Get main position evaluation
    console.log('[ReAct Agent] Calling get_engine_evaluation for main position...');
    const mainEval = await executeTool('get_engine_evaluation', { fen, depth: 22 });
    console.log('[ReAct Agent] Main eval result:', { score: mainEval.score, bestmove: mainEval.bestmove, pv: mainEval.pv?.substring(0,40) });
    traceManager.recordAction('get_engine_evaluation', { fen, depth: 22 }, 'Get Stockfish evaluation for current position');
    traceManager.recordObservation('get_engine_evaluation', mainEval);

    // Get post-move evaluation if userMove provided
    let postMoveEval = null;
    let tempChessFen = null;
    let uciUserMove = null;
    let sanUserMove = 'N/A';
    let actualScore = mainEval.score;
    let sanRefutationLine = 'N/A';

    if (userMove) {
      try {
        console.log('[ReAct Agent] Processing userMove:', userMove);
        const tempChess = new Chess(fen);
        const moveObj = tempChess.move(userMove);
        if (moveObj) {
          tempChessFen = tempChess.fen();
          uciUserMove = moveObj.from + moveObj.to + (moveObj.promotion || '');
          
          // Unicode mapping for display
          const unicodeMapping = { 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔' };
          let san = userMove;
          if (unicodeMapping[san[0]]) san = unicodeMapping[san[0]] + san.substring(1);
          sanUserMove = `${prefix}${san}`;
          
          console.log('[ReAct Agent] User move applied, tempFen:', tempChessFen, 'uciUserMove:', uciUserMove);
          traceManager.recordThought('Computing post-move evaluation for refutation line');
          
          console.log('[ReAct Agent] Calling get_engine_evaluation for post-move position...');
          postMoveEval = await executeTool('get_engine_evaluation', { fen: tempChessFen, depth: 22 });
          console.log('[ReAct Agent] Post-move eval result:', { score: postMoveEval.score, bestmove: postMoveEval.bestmove });
          traceManager.recordAction('get_engine_evaluation', { fen: tempChessFen, depth: 22 }, 'Get Stockfish evaluation after user move');
          traceManager.recordObservation('get_engine_evaluation', postMoveEval);
          
          actualScore = -postMoveEval.score;
          if (postMoveEval.pv) {
            sanRefutationLine = uciToSan(tempChessFen, postMoveEval.pv);
            sanRefutationLine = `${sanUserMove} ${sanRefutationLine}`;
            console.log('[ReAct Agent] Refutation line:', sanRefutationLine);
          }
        }
      } catch (e) {
        traceManager.recordError(e, 'userMoveProcessing');
        console.warn('[ReAct Agent] User move processing failed:', e.message);
      }
    } else {
      // No user move - just format the position
      const unicodeMapping = { 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔' };
      sanUserMove = 'N/A (initial position)';
    }

    const bestScore = mainEval.score;
    const sanBestMove = uciToSan(fen, mainEval.bestmove);
    const sanPv = mainEval.pv ? uciToSan(fen, mainEval.pv) : 'N/A';
    
    const cpLoss = Math.max(0, bestScore - actualScore);
    const mappedClassification = classifyMove(bestScore, actualScore, language, moveNumber, userMove);

    console.log('[ReAct Agent] Engine data gathered:', { bestScore, sanBestMove, cpLoss, mappedClassification, sanPv: sanPv.substring(0,50) });
    traceManager.recordThought(`Engine data gathered. Best move: ${sanBestMove}, Score: ${bestScore}, cpLoss: ${cpLoss}, Classification: ${mappedClassification}`);

    // Build context for the agent
    const context = {
      sanUserMove,
      classification: mappedClassification,
      cpLoss,
      sanRefutationLine,
      sanBestMove,
      sanPv
    };

    // Run the ReAct loop with LLM
    const systemPrompt = buildReActSystemPrompt(language, chess.turn());
    const userPrompt = buildUserPrompt(context);
    
    console.log('[ReAct Agent] Starting LLM ReAct loop...');
    traceManager.recordThought('Starting LLM ReAct loop');
    
    let finalAnalysis = null;
    let steps = 0;
    const conversation = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `[Context Data]\n${userPrompt}\n\nBegin your ReAct loop. Start with a THOUGHT and ACTION.` }
    ];

    while (steps < MAX_REACT_STEPS) {
      steps++;
      
      console.log(`[ReAct Agent] Step ${steps}/${MAX_REACT_STEPS}: Requesting LLM decision...`);
      traceManager.recordThought(`ReAct step ${steps}: Requesting LLM decision`);
      
      const response = await ollama.chat({
        model,
        messages: conversation,
        format: 'json',
        options: {
          temperature: 0.0,
          num_predict: 1024,
          num_ctx: 8192
        }
      });

      let parsed;
      try {
        const rawJson = response.message.content.replace(/```json/gi, '').replace(/```/g, '').trim();
        console.log('[ReAct Agent] LLM raw response:', rawJson.substring(0, 200));
        parsed = JSON.parse(rawJson);
      } catch (e) {
        traceManager.recordError(new Error(`LLM returned invalid JSON: ${e.message}`), 'jsonParse');
        console.error('[ReAct Agent] JSON parse error:', e.message);
        // Add error feedback to conversation
        conversation.push({ role: 'assistant', content: response.message.content });
        conversation.push({ 
          role: 'user', 
          content: `ERROR: Your response was not valid JSON. Please respond with a single JSON object containing "thought" and "action" or "final" fields.\nError: ${e.message}` 
        });
        continue;
      }

      // Check for final answer
      if (parsed.final) {
        console.log('[ReAct Agent] LLM provided final analysis!');
        traceManager.recordThought('LLM provided final analysis');
        finalAnalysis = parsed.final;
        break;
      }

      // Validate action
      if (!parsed.thought || !parsed.action || !parsed.action.tool) {
        traceManager.recordError(new Error('Missing thought or action in LLM response'), 'validation');
        console.error('[ReAct Agent] Missing thought or action in response');
        conversation.push({ role: 'assistant', content: JSON.stringify(parsed) });
        conversation.push({ 
          role: 'user', 
          content: 'ERROR: Response must contain "thought" and "action" with "tool" field. Please try again.' 
        });
        continue;
      }

      console.log('[ReAct Agent] LLM thought:', parsed.thought);
      console.log('[ReAct Agent] LLM action:', parsed.action);
      traceManager.recordThought(parsed.thought);
      
      // Execute the tool
      const { tool, params: toolParams, reasoning } = parsed.action;
      traceManager.recordAction(tool, toolParams, reasoning);
      
      let observation;
      try {
        console.log('[ReAct Agent] Executing tool:', tool, 'with params:', toolParams);
        observation = await executeTool(tool, toolParams);
        console.log('[ReAct Agent] Tool observation:', JSON.stringify(observation).substring(0, 300));
        traceManager.recordObservation(tool, observation);
      } catch (err) {
        traceManager.recordObservation(tool, err, true);
        console.error('[ReAct Agent] Tool error:', err.message);
        observation = { error: err.message };
      }

      // Add to conversation
      conversation.push({ 
        role: 'assistant', 
        content: JSON.stringify({
          thought: parsed.thought,
          action: parsed.action
        })
      });
      conversation.push({ 
        role: 'user', 
        content: `OBSERVATION: ${JSON.stringify(observation)}\n\nContinue your ReAct loop. Provide another THOUGHT and ACTION, or provide FINAL analysis if you have enough information.` 
      });
    }

    if (!finalAnalysis) {
      throw new Error(`ReAct agent did not produce final analysis after ${MAX_REACT_STEPS} steps`);
    }

    // Build the final HTML output (same format as existing performAnalysis)
    const isEn = language === 'en';
    let generatedHtml = `**${sanUserMove}** es un/una **${mappedClassification}** (${cpLoss}cp). ${finalAnalysis.generalExplanation}\n\n`;

    if (finalAnalysis.cons && finalAnalysis.cons.exists) {
      generatedHtml += `# ${isEn ? 'Cons' : 'Contras'}:\n`;
      generatedHtml += `- ${finalAnalysis.cons.explanation}\n`;
      generatedHtml += `<details>\n<summary>${finalAnalysis.cons.title}</summary>\n`;
      generatedHtml += `<div class="variation">${sanRefutationLine}</div>\n</details>\n\n`;
    }

    if (finalAnalysis.pros && finalAnalysis.pros.exists) {
      generatedHtml += `# ${isEn ? 'Pros' : 'Pros'}:\n`;
      generatedHtml += `- ${finalAnalysis.pros.explanation}\n`;
      generatedHtml += `<details>\n<summary>${finalAnalysis.pros.title}</summary>\n`;
      generatedHtml += `<div class="variation">${sanRefutationLine}</div>\n</details>\n\n`;
    }

    generatedHtml += `--- \n\n# ${isEn ? 'The correct alternative' : 'La alternativa correcta'}: ${sanBestMove}\n\n`;
    generatedHtml += `${finalAnalysis.alternative.explanation}\n\n`;
    generatedHtml += `<details>\n<summary>${isEn ? 'See suggested continuation' : 'Ver continuación sugerida'}</summary>\n`;
    generatedHtml += `<div class="variation">${sanPv}</div>\n</details>`;

    const cleanAnalysis = formatChessText(sanitizeLLMOutput(generatedHtml));

    const result = {
      fen,
      uciBestMove: mainEval.bestmove,
      bestmove: formatChessText(sanBestMove),
      score: actualScore,
      bestScore: bestScore,
      scoreType: mainEval.scoreType,
      analysis: cleanAnalysis,
      language,
      pv: mainEval.pv,
      cpLoss,
      classification: mappedClassification,
      userMove: uciUserMove || userMove
    };

    // Cache the result (only for generic analysis without userMove)
    if (!userMove) {
      const modelToUse = model || DEFAULT_MODEL;
      setCachedAnalysis(fen, modelToUse, result, language);
      console.log('[ReAct Agent] 💾 Cached analysis result');
    }

    traceManager.completeTrace(result);
    
    const totalDuration = (performance.now() - startTotal).toFixed(1);
    console.log(`[ReAct Agent] ✅ Completed in ${totalDuration}ms (${steps} steps)`);
    
    return result;

  } catch (err) {
    traceManager.recordError(err, 'agentLoop');
    traceManager.completeTrace({ error: err.message });
    console.error('[ReAct Agent] ❌ Failed:', err.message);
    throw err;
  }
}

/**
 * Get the latest trace for debugging
 * @returns {Object|null}
 */
export function getLatestTrace() {
  return traceManager.getCurrentTrace();
}

/**
 * Get trace by ID
 * @param {string} traceId 
 * @returns {Object|null}
 */
export function getTrace(traceId) {
  return traceManager.getTrace(traceId);
}

/**
 * List all traces
 * @returns {Array}
 */
export function listTraces() {
  return traceManager.listTraces();
}