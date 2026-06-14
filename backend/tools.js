import { Chess } from 'chess.js';
import { pool } from './pool.js';

/**
 * Tool definitions with JSON schemas for the ReAct agent
 * Each tool has a name, description, and parameter schema
 */

// Tool: Get engine evaluation (Stockfish + cache)
export const getEngineEvaluationSchema = {
  name: 'get_engine_evaluation',
  description: 'Get the best move, score, and principal variation from Stockfish engine for a given FEN position. Uses cache if available, otherwise queries Stockfish.',
  parameters: {
    type: 'object',
    properties: {
      fen: {
        type: 'string',
        description: 'FEN string of the position to evaluate'
      },
      depth: {
        type: 'integer',
        description: 'Search depth for Stockfish (default: 22)',
        default: 22,
        minimum: 1,
        maximum: 30
      }
    },
    required: ['fen']
  }
};

/**
 * Execute the get_engine_evaluation tool
 * @param {Object} params - { fen, depth }
 * @returns {Promise<Object>} Engine evaluation result
 */
export async function getEngineEvaluation(params) {
  const { fen, depth = 22 } = params;
  
  console.log('[Tool: get_engine_evaluation] Called with:', { fen: fen.substring(0,20), depth });
  
  if (!fen || typeof fen !== 'string') {
    throw new Error('Invalid FEN: must be a non-empty string');
  }
  
  // Validate FEN
  try {
    new Chess(fen);
  } catch (e) {
    throw new Error(`Invalid FEN: ${e.message}`);
  }
  
  console.log('[Tool: get_engine_evaluation] Dispatching to Stockfish pool...');
  const result = await pool.addRequest(fen, { depth });
  console.log('[Tool: get_engine_evaluation] Result:', { score: result.score, bestmove: result.bestmove, pv: result.pv?.substring(0,40), source: result.source });
  return result;
}

// Tool: Get piece positions
export const getPiecePositionsSchema = {
  name: 'get_piece_positions',
  description: 'Get the positions of all pieces on the board for a given FEN. Returns piece locations with coordinates.',
  parameters: {
    type: 'object',
    properties: {
      fen: {
        type: 'string',
        description: 'FEN string of the position'
      }
    },
    required: ['fen']
  }
};

/**
 * Execute the get_piece_positions tool
 * @param {Object} params - { fen }
 * @returns {Promise<Object>} Piece positions
 */
export async function getPiecePositions(params) {
  const { fen } = params;
  
  if (!fen || typeof fen !== 'string') {
    throw new Error('Invalid FEN: must be a non-empty string');
  }
  
  const chess = new Chess(fen);
  const board = chess.board();
  const piecePositions = {
    white: [],
    black: [],
    bySquare: {}
  };
  
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const piece = board[rank][file];
      if (piece) {
        const square = `${String.fromCharCode(97 + file)}${8 - rank}`;
        const pieceInfo = {
          type: piece.type, // 'p', 'n', 'b', 'r', 'q', 'k'
          color: piece.color, // 'w' or 'b'
          square,
          symbol: piece.color === 'w' ? piece.type.toUpperCase() : piece.type.toLowerCase()
        };
        
        piecePositions.bySquare[square] = pieceInfo;
        if (piece.color === 'w') {
          piecePositions.white.push(pieceInfo);
        } else {
          piecePositions.black.push(pieceInfo);
        }
      }
    }
  }
  
  return piecePositions;
}

// Tool: Get legal moves
export const getLegalMovesSchema = {
  name: 'get_legal_moves',
  description: 'Get all legal moves for the current position in both SAN and UCI notation.',
  parameters: {
    type: 'object',
    properties: {
      fen: {
        type: 'string',
        description: 'FEN string of the position'
      }
    },
    required: ['fen']
  }
};

/**
 * Execute the get_legal_moves tool
 * @param {Object} params - { fen }
 * @returns {Promise<Object>} Legal moves
 */
export async function getLegalMoves(params) {
  const { fen } = params;
  
  if (!fen || typeof fen !== 'string') {
    throw new Error('Invalid FEN: must be a non-empty string');
  }
  
  const chess = new Chess(fen);
  const verboseMoves = chess.moves({ verbose: true });
  
  return {
    moves: verboseMoves.map(m => ({
      san: m.san,
      uci: m.from + m.to + (m.promotion || ''),
      from: m.from,
      to: m.to,
      promotion: m.promotion,
      captured: m.captured,
      flags: m.flags
    })),
    turn: chess.turn(),
    moveNumber: chess.moveNumber(),
    inCheck: chess.isCheck(),
    gameOver: chess.isGameOver()
  };
}

// Tool: Make a move and get resulting position
export const makeMoveSchema = {
  name: 'make_move',
  description: 'Make a move on the board and return the resulting FEN and position info.',
  parameters: {
    type: 'object',
    properties: {
      fen: {
        type: 'string',
        description: 'Starting FEN string'
      },
      move: {
        type: 'string',
        description: 'Move in SAN notation (e.g., "Nf3") or UCI notation (e.g., "g1f3")'
      }
    },
    required: ['fen', 'move']
  }
};

/**
 * Execute the make_move tool
 * @param {Object} params - { fen, move }
 * @returns {Promise<Object>} Resulting position
 */
export async function makeMove(params) {
  const { fen, move } = params;
  
  if (!fen || typeof fen !== 'string') {
    throw new Error('Invalid FEN');
  }
  
  const chess = new Chess(fen);
  let moveObj;
  
  try {
    // Try SAN first
    moveObj = chess.move(move);
  } catch (e) {
    // Try UCI if SAN fails
    if (move.length >= 4) {
      const from = move.substring(0, 2);
      const to = move.substring(2, 4);
      const promotion = move.length > 4 ? move.substring(4) : undefined;
      try {
        moveObj = chess.move({ from, to, promotion });
      } catch (e2) {
        throw new Error(`Invalid move: ${move}`);
      }
    } else {
      throw new Error(`Invalid move: ${move}`);
    }
  }
  
  return {
    fen: chess.fen(),
    move: moveObj ? {
      san: moveObj.san,
      uci: moveObj.from + moveObj.to + (moveObj.promotion || ''),
      from: moveObj.from,
      to: moveObj.to,
      promotion: moveObj.promotion,
      captured: moveObj.captured,
      flags: moveObj.flags
    } : null,
    turn: chess.turn(),
    moveNumber: chess.moveNumber(),
    inCheck: chess.isCheck(),
    gameOver: chess.isGameOver(),
    result: chess.isCheckmate() ? (chess.turn() === 'w' ? '0-1' : '1-0') : 
            chess.isDraw() ? '1/2-1/2' : '*'
  };
}

// Tool: Get position evaluation (win probability, score)
export const getPositionEvaluationSchema = {
  name: 'get_position_evaluation',
  description: 'Get a comprehensive evaluation of the position including centipawn score, win probability, and classification.',
  parameters: {
    type: 'object',
    properties: {
      fen: {
        type: 'string',
        description: 'FEN string of the position to evaluate'
      },
      depth: {
        type: 'integer',
        description: 'Search depth (default: 22)',
        default: 22
      }
    },
    required: ['fen']
  }
};

/**
 * Execute the get_position_evaluation tool
 * @param {Object} params - { fen, depth }
 * @returns {Promise<Object>} Evaluation result
 */
export async function getPositionEvaluation(params) {
  const { fen, depth = 22 } = params;
  
  const evalResult = await getEngineEvaluation({ fen, depth });
  const chess = new Chess(fen);
  const turn = chess.turn();
  
  // Convert score to perspective of side to move
  const score = turn === 'w' ? evalResult.score : -evalResult.score;
  
  // Win probability
  const winProb = 1 / (1 + Math.pow(10, -score / 400));
  
  // Classification thresholds (matching frontend logic)
  let classification;
  if (score <= 10) {
    classification = 'best';
  } else if (score < 30) {
    classification = 'excellent';
  } else if (score < 80) {
    classification = 'good';
  } else if (score < 150) {
    classification = 'inaccuracy';
  } else if (score < 250) {
    classification = 'mistake';
  } else {
    classification = 'blunder';
  }
  
  return {
    fen,
    score: evalResult.score,
    scoreType: evalResult.scoreType,
    perspectiveScore: score,
    winProbability: winProb,
    classification,
    bestmove: evalResult.bestmove,
    pv: evalResult.pv,
    source: evalResult.source,
    turn
  };
}

/**
 * Registry of all available tools
 * Maps tool name to { schema, execute }
 */
export const TOOLS = {
  get_engine_evaluation: {
    schema: getEngineEvaluationSchema,
    execute: getEngineEvaluation
  },
  get_piece_positions: {
    schema: getPiecePositionsSchema,
    execute: getPiecePositions
  },
  get_legal_moves: {
    schema: getLegalMovesSchema,
    execute: getLegalMoves
  },
  make_move: {
    schema: makeMoveSchema,
    execute: makeMove
  },
  get_position_evaluation: {
    schema: getPositionEvaluationSchema,
    execute: getPositionEvaluation
  }
};

/**
 * Get all tool schemas for the system prompt
 * @returns {Array} Array of tool schemas
 */
export function getAllToolSchemas() {
  return Object.values(TOOLS).map(t => t.schema);
}

/**
 * Execute a tool by name
 * @param {string} toolName 
 * @param {Object} params 
 * @returns {Promise<Object>}
 */
export async function executeTool(toolName, params) {
  const tool = TOOLS[toolName];
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }
  return await tool.execute(params);
}