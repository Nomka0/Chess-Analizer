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

// Tool: Verify a tactical claim against the board (anti-hallucination)
export const verifyClaimSchema = {
  name: 'verify_claim',
  description: 'Verify a tactical claim (attack, defense, capture, check, pin, fork, etc.) against the actual board position. Use this BEFORE making any tactical statement in your analysis. Returns whether the claim is true/false with explanation.',
  parameters: {
    type: 'object',
    properties: {
      fen: {
        type: 'string',
        description: 'FEN string of the position to verify against'
      },
      claim: {
        type: 'string',
        description: 'The tactical claim to verify. Examples: "Queen on a5 attacks pawn on e2", "Knight on f3 defends pawn on e5", "Move Qa5 gives check", "Bishop on c4 pins knight on f7", "Rook on e1 controls e-file"'
      },
      perspective: {
        type: 'string',
        description: 'Whose perspective: "white" or "black" (the player whose move it is in the FEN)',
        enum: ['white', 'black']
      }
    },
    required: ['fen', 'claim', 'perspective']
  }
};

/**
 * Execute the verify_claim tool
 * @param {Object} params - { fen, claim, perspective }
 * @returns {Promise<Object>} Verification result
 */
export async function verifyClaim(params) {
  const { fen, claim, perspective } = params;

  if (!fen || typeof fen !== 'string') {
    throw new Error('Invalid FEN: must be a non-empty string');
  }
  if (!claim || typeof claim !== 'string') {
    throw new Error('Invalid claim: must be a non-empty string');
  }
  if (!['white', 'black'].includes(perspective)) {
    throw new Error('Perspective must be "white" or "black"');
  }

  const chess = new Chess(fen);
  const board = chess.board();
  const turn = chess.turn(); // 'w' or 'b'
  const perspectiveColor = perspective === 'white' ? 'w' : 'b';

  // Parse the claim to extract piece, square, target, and action
  const result = verifyTacticalClaim(chess, board, claim, perspectiveColor, turn);

  console.log('[Tool: verify_claim] Claim:', claim, '| Result:', result.verified ? 'TRUE' : 'FALSE', '| Explanation:', result.explanation);
  return result;
}

/**
 * Core verification logic for tactical claims
 * @param {Chess} chess - chess.js instance
 * @param {Array} board - 8x8 board array
 * @param {string} claim - Natural language claim
 * @param {string} perspectiveColor - 'w' or 'b'
 * @param {string} turn - 'w' or 'b' (side to move)
 * @returns {Object} { verified: boolean, explanation: string, details: object }
 */
function verifyTacticalClaim(chess, board, claim, perspectiveColor, turn) {
  const claimLower = claim.toLowerCase();

  // Helper: get piece at square
  const getPieceAt = (square) => {
    const file = square.charCodeAt(0) - 97;
    const rank = 8 - parseInt(square[1]);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return board[rank][file];
  };

  // Helper: square to coordinates
  const squareToCoords = (square) => ({
    file: square.charCodeAt(0) - 97,
    rank: 8 - parseInt(square[1])
  });

  // Helper: check if square is attacked by color
  const isSquareAttacked = (square, byColor) => {
    // Temporarily set turn to byColor to check attacks
    const originalTurn = chess.turn();
    // We can't easily change turn in chess.js, so we check moves from that color's pieces
    // Instead, generate all moves for byColor and see if any lands on square
    const tempChess = new Chess(chess.fen());
    // Hack: we can't easily switch turns, so let's check piece attacks manually
    return isAttackedByColor(board, square, byColor);
  };

  // Helper: check if a square is attacked by pieces of a given color
  const isAttackedByColor = (board, targetSquare, attackerColor) => {
    const target = squareToCoords(targetSquare);
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const piece = board[rank][file];
        if (piece && piece.color === attackerColor) {
          const fromSquare = `${String.fromCharCode(97 + file)}${8 - rank}`;
          // Check if this piece can capture on targetSquare
          if (canPieceAttackSquare(board, piece, fromSquare, targetSquare)) {
            return { attacker: piece, from: fromSquare };
          }
        }
      }
    }
    return null;
  };

  // Helper: can a specific piece on a specific square attack target square
  const canPieceAttackSquare = (board, piece, fromSquare, toSquare) => {
    const from = squareToCoords(fromSquare);
    const to = squareToCoords(toSquare);
    const df = to.file - from.file;
    const dr = to.rank - from.rank;
    const af = Math.abs(df);
    const ar = Math.abs(dr);
    const type = piece.type;

    switch (type) {
      case 'p': // pawn
        const dir = piece.color === 'w' ? 1 : -1;
        return dr === dir && af === 1; // pawn captures diagonally
      case 'n': // knight
        return (af === 1 && ar === 2) || (af === 2 && ar === 1);
      case 'b': // bishop
        if (af !== ar) return false;
        return isPathClear(board, from, to, df, dr);
      case 'r': // rook
        if (af !== 0 && dr !== 0) return false;
        return isPathClear(board, from, to, df, dr);
      case 'q': // queen
        if (af !== ar && af !== 0 && dr !== 0) return false;
        return isPathClear(board, from, to, df, dr);
      case 'k': // king
        return af <= 1 && ar <= 1;
    }
    return false;
  };

  // Helper: is path clear between two squares (exclusive)
  const isPathClear = (board, from, to, df, dr) => {
    const stepF = df === 0 ? 0 : df > 0 ? 1 : -1;
    const stepR = dr === 0 ? 0 : dr > 0 ? 1 : -1;
    let f = from.file + stepF;
    let r = from.rank + stepR;
    while (f !== to.file || r !== to.rank) {
      const sq = `${String.fromCharCode(97 + f)}${8 - r}`;
      if (board[r][f]) return false;
      f += stepF;
      r += stepR;
    }
    return true;
  };

  // Parse common claim patterns
  // Pattern: "Piece on X attacks square Y" or "Piece on X attacks piece on Y"
  const attackMatch = claimLower.match(/(queen|rook|bishop|knight|pawn|king)\s+on\s+([a-h][1-8])\s+attacks?\s+(?:(?:pawn|knight|bishop|rook|queen|king)\s+on\s+)?([a-h][1-8])/);
  if (attackMatch) {
    const [, pieceName, fromSquare, toSquare] = attackMatch;
    const pieceTypeMap = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p', king: 'k' };
    const expectedType = pieceTypeMap[pieceName];
    const piece = getPieceAt(fromSquare);

    if (!piece) {
      return { verified: false, explanation: `No piece on ${fromSquare}`, details: { claim, fromSquare, toSquare } };
    }
    if (piece.type !== expectedType) {
      return { verified: false, explanation: `Piece on ${fromSquare} is ${piece.type}, not ${pieceName}`, details: { claim, fromSquare, toSquare, actualPiece: piece.type } };
    }
    if (piece.color !== perspectiveColor) {
      return { verified: false, explanation: `Piece on ${fromSquare} belongs to opponent, not ${perspective}`, details: { claim, fromSquare, pieceColor: piece.color } };
    }

    const attackResult = canPieceAttackSquare(board, piece, fromSquare, toSquare);
    if (attackResult) {
      const targetPiece = getPieceAt(toSquare);
      const targetDesc = targetPiece ? `${targetPiece.color === 'w' ? 'White' : 'Black'} ${targetPiece.type} on ${toSquare}` : `empty square ${toSquare}`;
      return { verified: true, explanation: `${pieceName} on ${fromSquare} DOES attack ${targetDesc}`, details: { claim, fromSquare, toSquare, target: targetPiece } };
    } else {
      const targetPiece = getPieceAt(toSquare);
      const targetDesc = targetPiece ? `${targetPiece.color === 'w' ? 'White' : 'Black'} ${targetPiece.type} on ${toSquare}` : `square ${toSquare}`;
      return { verified: false, explanation: `${pieceName} on ${fromSquare} does NOT attack ${targetDesc}`, details: { claim, fromSquare, toSquare, target: targetPiece } };
    }
  }

  // Pattern: "Move X gives check" or "X checks"
  const checkMatch = claimLower.match(/(?:move\s+)?([a-h][1-8][a-h][1-8][qrbn]?|[NBRQK]?[a-h]?x?[a-h][1-8][+#]?|O-O[-O]?)\s+(?:gives?\s+)?check/);
  if (checkMatch) {
    const moveStr = checkMatch[1];
    try {
      const tempChess = new Chess(chess.fen());
      let moveObj;
      // Try SAN first
      try {
        moveObj = tempChess.move(moveStr, { sloppy: true });
      } catch (e) {
        // Try UCI
        if (moveStr.length >= 4) {
          moveObj = tempChess.move({ from: moveStr.substring(0,2), to: moveStr.substring(2,4), promotion: moveStr[4] || 'q' });
        }
      }
      if (moveObj && tempChess.isCheck()) {
        return { verified: true, explanation: `Move ${moveStr} DOES give check`, details: { claim, move: moveStr } };
      } else {
        return { verified: false, explanation: `Move ${moveStr} does NOT give check`, details: { claim, move: moveStr } };
      }
    } catch (e) {
      return { verified: false, explanation: `Could not verify check claim: ${e.message}`, details: { claim, move: moveStr } };
    }
  }

  // Pattern: "Piece on X defends/protects square/piece Y"
  const defendMatch = claimLower.match(/(queen|rook|bishop|knight|pawn|king)\s+on\s+([a-h][1-8])\s+(?:defends?|protects?)\s+(?:(?:pawn|knight|bishop|rook|queen|king)\s+on\s+)?([a-h][1-8])/);
  if (defendMatch) {
    const [, pieceName, fromSquare, toSquare] = defendMatch;
    const pieceTypeMap = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p', king: 'k' };
    const expectedType = pieceTypeMap[pieceName];
    const piece = getPieceAt(fromSquare);

    if (!piece) {
      return { verified: false, explanation: `No piece on ${fromSquare}`, details: { claim, fromSquare, toSquare } };
    }
    if (piece.type !== expectedType) {
      return { verified: false, explanation: `Piece on ${fromSquare} is ${piece.type}, not ${pieceName}`, details: { claim, fromSquare, toSquare, actualPiece: piece.type } };
    }
    if (piece.color !== perspectiveColor) {
      return { verified: false, explanation: `Piece on ${fromSquare} belongs to opponent`, details: { claim, fromSquare, pieceColor: piece.color } };
    }

    const targetPiece = getPieceAt(toSquare);
    if (!targetPiece || targetPiece.color !== perspectiveColor) {
      return { verified: false, explanation: `No friendly piece on ${toSquare} to defend`, details: { claim, fromSquare, toSquare, target: targetPiece } };
    }

    // Check if piece on fromSquare attacks toSquare (defends it)
    const attackResult = canPieceAttackSquare(board, piece, fromSquare, toSquare);
    if (attackResult) {
      return { verified: true, explanation: `${pieceName} on ${fromSquare} DOES defend ${piece.type} on ${toSquare}`, details: { claim, fromSquare, toSquare } };
    } else {
      return { verified: false, explanation: `${pieceName} on ${fromSquare} does NOT defend ${targetPiece.type} on ${toSquare}`, details: { claim, fromSquare, toSquare } };
    }
  }

  // Pattern: "Piece on X pins piece on Y"
  // This is complex - simplified check: piece attacks through target to king
  const pinMatch = claimLower.match(/(queen|rook|bishop)\s+on\s+([a-h][1-8])\s+pins?\s+(?:(?:pawn|knight|bishop|rook|queen|king)\s+on\s+)?([a-h][1-8])/);
  if (pinMatch) {
    const [, pieceName, fromSquare, targetSquare] = pinMatch;
    const pieceTypeMap = { queen: 'q', rook: 'r', bishop: 'b' };
    const expectedType = pieceTypeMap[pieceName];
    const piece = getPieceAt(fromSquare);

    if (!piece || piece.type !== expectedType || piece.color !== perspectiveColor) {
      return { verified: false, explanation: `Invalid pinning piece on ${fromSquare}`, details: { claim, fromSquare, targetSquare } };
    }

    const targetPiece = getPieceAt(targetSquare);
    if (!targetPiece || targetPiece.color === perspectiveColor) {
      return { verified: false, explanation: `No enemy piece on ${targetSquare} to pin`, details: { claim, fromSquare, targetSquare } };
    }

    // Check if attacker, target, and enemy king are aligned
    const attacker = squareToCoords(fromSquare);
    const target = squareToCoords(targetSquare);
    // Find enemy king
    let kingSquare = null;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = board[r][f];
        if (p && p.type === 'k' && p.color !== perspectiveColor) {
          kingSquare = `${String.fromCharCode(97 + f)}${8 - r}`;
          break;
        }
      }
    }
    if (!kingSquare) {
      return { verified: false, explanation: `Enemy king not found`, details: { claim } };
    }
    const king = squareToCoords(kingSquare);

    // Check alignment: attacker -> target -> king must be collinear
    const df1 = target.file - attacker.file;
    const dr1 = target.rank - attacker.rank;
    const df2 = king.file - target.file;
    const dr2 = king.rank - target.rank;

    const aligned = (df1 === 0 && df2 === 0) || (dr1 === 0 && dr2 === 0) || (Math.abs(df1) === Math.abs(dr1) && Math.abs(df2) === Math.abs(dr2));
    const sameDirection = (df1 === 0 || dr1 === 0 || Math.abs(df1) === Math.abs(dr1)) &&
                          (df2 === 0 || dr2 === 0 || Math.abs(df2) === Math.abs(dr2)) &&
                          Math.sign(df1) === Math.sign(df2) && Math.sign(dr1) === Math.sign(dr2);

    if (aligned && sameDirection) {
      // Check path clear from attacker to target (exclusive)
      if (isPathClear(board, attacker, target, df1, dr1)) {
        return { verified: true, explanation: `${pieceName} on ${fromSquare} pins ${targetPiece.type} on ${targetSquare} to king on ${kingSquare}`, details: { claim, fromSquare, targetSquare, kingSquare } };
      }
    }
    return { verified: false, explanation: `${pieceName} on ${fromSquare} does NOT pin ${targetPiece.type} on ${targetSquare}`, details: { claim, fromSquare, targetSquare, kingSquare } };
  }

  // Pattern: "Piece on X controls file/rank/diagonal Y" or "controls X-file"
  const controlMatch = claimLower.match(/(queen|rook|bishop)\s+on\s+([a-h][1-8])\s+controls?\s+([a-h])-file|([1-8])-rank|([a-h][1-8])-([a-h][1-8])/);
  if (controlMatch) {
    // Simplified - just check if piece exists and is correct type
    const pieceName = claimLower.match(/(queen|rook|bishop)/)?.[0];
    const fromSquare = claimLower.match(/on\s+([a-h][1-8])/)?.[1];
    if (pieceName && fromSquare) {
      const pieceTypeMap = { queen: 'q', rook: 'r', bishop: 'b' };
      const piece = getPieceAt(fromSquare);
      if (piece && piece.type === pieceTypeMap[pieceName] && piece.color === perspectiveColor) {
        return { verified: true, explanation: `${pieceName} on ${fromSquare} exists and can control lines`, details: { claim, fromSquare } };
      }
    }
    return { verified: false, explanation: `Could not verify control claim`, details: { claim } };
  }

  // Default: claim not recognized
  return {
    verified: null,
    explanation: `Claim type not recognized for automatic verification: "${claim}". Manual verification needed.`,
    details: { claim, recognized: false }
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
  const winProb = 50 + 50 * Math.tanh(score / 200);
 
  // Classification thresholds based on Win Probability Loss Delta
  let classification;
  if (score <= 0) {
    classification = 'best';
  } else if (score <= 200) {  // ~2% loss in WP
    classification = 'excellent';
  } else if (score <= 500) {  // ~5% loss in WP
    classification = 'good';
  } else if (score <= 1000) { // ~10% loss in WP
    classification = 'inaccuracy';
  } else if (score <= 2000) { // ~20% loss in WP
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
  },
  verify_claim: {
    schema: verifyClaimSchema,
    execute: verifyClaim
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