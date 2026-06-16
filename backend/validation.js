import { Chess } from 'chess.js';

/**
 * Post-generation validation of AI analysis against actual board position
 * Catches hallucinations like "Queen on a5 attacks e2" when it actually attacks d2
 */

/**
 * Validates an AI analysis string against the board position
 * @param {string} analysis - The AI-generated analysis text
 * @param {string} fen - FEN of the position
 * @param {string} perspective - 'white' or 'black' (player being analyzed)
 * @returns {Object} { valid: boolean, corrections: Array, warnings: Array, validatedAnalysis: string }
 */
export function validateAnalysisAgainstBoard(analysis, fen, perspective) {
  if (!analysis || !fen) {
    return { valid: true, corrections: [], warnings: [], validatedAnalysis: analysis };
  }

  const chess = new Chess(fen);
  const board = chess.board();
  const perspectiveColor = perspective === 'white' ? 'w' : 'b';

  const corrections = [];
  const warnings = [];
  let validatedAnalysis = analysis;

  // Extract and verify tactical claims from the analysis
  const claims = extractTacticalClaims(analysis);

  for (const claim of claims) {
    const verification = verifyClaimAgainstBoard(claim.text, board, perspectiveColor, claim.context);
    if (verification.verified === false) {
      // Hallucination detected - add correction
      const correction = `⚠️ CORRECTION: "${claim.text}" is FALSE. ${verification.explanation}`;
      corrections.push(correction);
      warnings.push(correction);

      // Replace the false claim with corrected version in the analysis
      validatedAnalysis = validatedAnalysis.replace(claim.text, `${claim.text} [CORRECTED: ${verification.explanation}]`);
    } else if (verification.verified === null) {
      // Unverified claim - add warning
      warnings.push(`⚠️ UNVERIFIED: "${claim.text}" - ${verification.explanation}`);
    }
    // verified === true: claim is correct, no action needed
  }

  return {
    valid: corrections.length === 0,
    corrections,
    warnings,
    validatedAnalysis
  };
}

/**
 * Extracts tactical claims from analysis text that can be verified
 * @param {string} text - Analysis text
 * @returns {Array} Array of { text, context } objects
 */
function extractTacticalClaims(text) {
  const claims = [];

  // Pattern 1: "Piece [adj] on/en X attacks Y" (English + Spanish)
  // Matches: "Queen on a5 attacks...", "Reina negra en a5 ataca...", "Reina en a5 ataca..."
  const attackRegex = /(Queen|Rook|Bishop|Knight|Pawn|King|Reina|Torre|Alfil|Caballo|Pe[oó]n|Rey)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?\s+(?:on|en)\s+([a-h][1-8])\s+(?:attacks?|ataca|atacan)\s+(?:(?:the|el|la|los|las)\s+)?(?:pawn|knight|bishop|rook|queen|king|pe[oó]n|caballo|alfil|torre|reina|rey)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?(?:\s+(?:on|en)\s+)?([a-h][1-8])/gi;
  let match;
  while ((match = attackRegex.exec(text)) !== null) {
    claims.push({
      text: match[0],
      context: 'attack',
      piece: match[1].toLowerCase(),
      from: match[2],
      to: match[3]
    });
  }

  // Pattern 2: "Piece [adj] on/en X attacks the [piece] [adj] on/en Y"
  const attackPieceRegex = /(Queen|Rook|Bishop|Knight|Pawn|King|Reina|Torre|Alfil|Caballo|Pe[oó]n|Rey)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?\s+(?:on|en)\s+([a-h][1-8])\s+(?:attacks?|ataca|atacan)\s+(?:the|el|la|los|las)\s+(pawn|knight|bishop|rook|queen|king|pe[oó]n|caballo|alfil|torre|reina|rey)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?\s+(?:on|en)\s+([a-h][1-8])/gi;
  while ((match = attackPieceRegex.exec(text)) !== null) {
    claims.push({
      text: match[0],
      context: 'attack_piece',
      piece: match[1].toLowerCase(),
      from: match[2],
      targetPiece: match[3].toLowerCase(),
      to: match[4]
    });
  }

  // Pattern 3: "Move X gives check" or "X checks" / "X da jaque" / "X jaquea"
  const checkRegex = /(?:Move\s+)?([NBRQK]?[a-h]?x?[a-h][1-8][+#]?|[a-h][1-8][a-h][1-8][qrnb]?|O-O[-O]?)\s+(?:gives?\s+)?check|da\s+jaque|jaquea/gi;
  while ((match = checkRegex.exec(text)) !== null) {
    claims.push({
      text: match[0],
      context: 'check',
      move: match[1]
    });
  }

  // Pattern 4: "Piece [adj] on/en X defends/protects Y" / "Pieza [adj] en X defiende/protege Y"
  const defendRegex = /(Queen|Rook|Bishop|Knight|Pawn|King|Reina|Torre|Alfil|Caballo|Pe[oó]n|Rey)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?\s+(?:on|en)\s+([a-h][1-8])\s+(?:defends?|protects?|defiende|defienden|protege|protegen)\s+(?:(?:pawn|knight|bishop|rook|queen|king|pe[oó]n|caballo|alfil|torre|reina|rey)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?\s+(?:on|en)\s+)?([a-h][1-8])/gi;
  while ((match = defendRegex.exec(text)) !== null) {
    claims.push({
      text: match[0],
      context: 'defend',
      piece: match[1].toLowerCase(),
      from: match[2],
      to: match[3]
    });
  }

  // Pattern 5: "Piece [adj] on/en X pins piece [adj] on/en Y" / "Pieza [adj] en X clava pieza [adj] en Y"
  const pinRegex = /(Queen|Rook|Bishop|Reina|Torre|Alfil)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?\s+(?:on|en)\s+([a-h][1-8])\s+(?:pins?|clava|clavan)\s+(?:(?:the|el|la|los|las)\s+)?(?:pawn|knight|bishop|rook|queen|king|pe[oó]n|caballo|alfil|torre|reina|rey)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?(?:\s+(?:on|en)\s+)?([a-h][1-8])/gi;
  while ((match = pinRegex.exec(text)) !== null) {
    claims.push({
      text: match[0],
      context: 'pin',
      piece: match[1].toLowerCase(),
      from: match[2],
      to: match[3]
    });
  }

  // Pattern 6: "X controls Y-file/rank" / "X controla archivo/fila Y"
  const controlRegex = /(Queen|Rook|Bishop|Reina|Torre|Alfil)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?\s+(?:on|en)\s+([a-h][1-8])\s+(?:controls?|controla|controlan)\s+(?:[a-h]-file|[1-8]-rank|archivo\s+[a-h]|fila\s+[1-8])/gi;
  while ((match = controlRegex.exec(text)) !== null) {
    claims.push({
      text: match[0],
      context: 'control',
      piece: match[1].toLowerCase(),
      from: match[2],
      detail: match[3]
    });
  }

  // Pattern 7: "attacks the pawn on X" / "ataca el peón en X" (without specifying attacking piece square)
  const vagueAttackRegex = /(?:attacks?|ataca|atacan)\s+(?:the|el|la|los|las)\s+(?:pawn|pe[oó]n|peones)\s+(?:on|en)\s+([a-h][1-8])/gi;
  while ((match = vagueAttackRegex.exec(text)) !== null) {
    claims.push({
      text: match[0],
      context: 'vague_attack',
      target: match[1]
    });
  }

  return claims;
}

/**
 * Verifies a single claim against the board
 * @param {string} claimText - The claim text
 * @param {Array} board - 8x8 board array
 * @param {string} perspectiveColor - 'w' or 'b'
 * @param {string} context - Claim context type
 * @returns {Object} { verified: boolean|null, explanation: string }
 */
function verifyClaimAgainstBoard(claimText, board, perspectiveColor, context) {
  const claimLower = claimText.toLowerCase();

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

  // Helper: can piece attack square
  const canPieceAttackSquare = (piece, fromSquare, toSquare) => {
    const from = squareToCoords(fromSquare);
    const to = squareToCoords(toSquare);
    const df = to.file - from.file;
    const dr = to.rank - from.rank;
    const af = Math.abs(df);
    const ar = Math.abs(dr);
    const type = piece.type;

    switch (type) {
      case 'p':
        const dir = piece.color === 'w' ? 1 : -1;
        return dr === dir && af === 1;
      case 'n':
        return (af === 1 && ar === 2) || (af === 2 && ar === 1);
      case 'b':
        if (af !== ar) return false;
        return isPathClear(board, from, to, df, dr);
      case 'r':
        if (af !== 0 && dr !== 0) return false;
        return isPathClear(board, from, to, df, dr);
      case 'q':
        if (af !== ar && af !== 0 && dr !== 0) return false;
        return isPathClear(board, from, to, df, dr);
      case 'k':
        return af <= 1 && ar <= 1;
    }
    return false;
  };

  // Helper: is path clear
  const isPathClear = (board, from, to, df, dr) => {
    const stepF = df === 0 ? 0 : df > 0 ? 1 : -1;
    const stepR = dr === 0 ? 0 : dr > 0 ? 1 : -1;
    let f = from.file + stepF;
    let r = from.rank + stepR;
    while (f !== to.file || r !== to.rank) {
      if (board[r][f]) return false;
      f += stepF;
      r += stepR;
    }
    return true;
  };

  // Helper: normalize piece name to type
  const pieceTypeMap = { 
    queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p', king: 'k',
    reina: 'q', torre: 'r', alfil: 'b', caballo: 'n', 'peón': 'p', peon: 'p', rey: 'k'
  };

  // Handle different contexts
  switch (context) {
    case 'attack':
    case 'attack_piece': {
      // Extract piece, from, to from claim
      const squareMatch = claimLower.match(/(?:queen|rook|bishop|knight|pawn|king|reina|torre|alfil|caballo|pe[oó]n|rey)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?\s+(?:on|en)\s+([a-h][1-8])\s+(?:attacks?|ataca|atacan)\s+(?:(?:the|el|la|los|las)\s+)?(?:pawn|knight|bishop|rook|queen|king|pe[oó]n|caballo|alfil|torre|reina|rey)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?(?:\s+(?:on|en)\s+)?([a-h][1-8])/);
      if (!squareMatch) {
        return { verified: null, explanation: 'Could not extract squares from attack claim' };
      }
      const [, fromSquare, toSquare] = squareMatch;

      const pieceNameMatch = claimLower.match(/(queen|rook|bishop|knight|pawn|king|reina|torre|alfil|caballo|pe[oó]n|rey)/);
      const pieceName = pieceNameMatch ? pieceNameMatch[1] : '';
      const expectedType = pieceTypeMap[pieceName];
      const piece = getPieceAt(fromSquare);

      if (!piece) {
        return { verified: false, explanation: `No piece on ${fromSquare}` };
      }
      if (piece.type !== expectedType) {
        return { verified: false, explanation: `Piece on ${fromSquare} is ${piece.type}, not ${pieceName}` };
      }
      if (piece.color !== perspectiveColor) {
        return { verified: false, explanation: `Piece on ${fromSquare} belongs to opponent` };
      }

      const attacks = canPieceAttackSquare(piece, fromSquare, toSquare);
      const targetPiece = getPieceAt(toSquare);
      const targetDesc = targetPiece ? `${targetPiece.color === 'w' ? 'White' : 'Black'} ${targetPiece.type} on ${toSquare}` : `square ${toSquare}`;

      if (attacks) {
        return { verified: true, explanation: `${pieceName} on ${fromSquare} DOES attack ${targetDesc}` };
      } else {
        return { verified: false, explanation: `${pieceName} on ${fromSquare} does NOT attack ${targetDesc} (this is a hallucination)` };
      }
    }

    case 'vague_attack': {
      // "attacks the pawn on e2" / "ataca el peón en e2" - find what actually attacks that square
      const targetMatch = claimLower.match(/(?:attacks?|ataca|atacan)\s+(?:the|el|la|los|las)\s+(?:pawn|pe[oó]n|peones)\s+(?:on|en)\s+([a-h][1-8])/);
      if (!targetMatch) return { verified: null, explanation: 'Could not parse vague attack' };
      const targetSquare = targetMatch[1];
      const targetPiece = getPieceAt(targetSquare);
      if (!targetPiece || targetPiece.type !== 'p') {
        return { verified: false, explanation: `No pawn on ${targetSquare}` };
      }
      // Find attackers
      const attackers = [];
      for (let rank = 0; rank < 8; rank++) {
        for (let file = 0; file < 8; file++) {
          const piece = board[rank][file];
          if (piece && piece.color === perspectiveColor) {
            const fromSquare = `${String.fromCharCode(97 + file)}${8 - rank}`;
            if (canPieceAttackSquare(piece, fromSquare, targetSquare)) {
              attackers.push({ piece: piece.type, square: fromSquare });
            }
          }
        }
      }
      if (attackers.length === 0) {
        return { verified: false, explanation: `No ${perspectiveColor === 'w' ? 'White' : 'Black'} piece attacks pawn on ${targetSquare}` };
      }
      return { verified: true, explanation: `Pawn on ${targetSquare} is attacked by: ${attackers.map(a => `${a.piece} on ${a.square}`).join(', ')}` };
    }

    case 'check': {
      const checkMatch = claimLower.match(/(?:move\s+)?([a-h][1-8][a-h][1-8][qrnb]?|[nbrqk]?[a-h]?x?[a-h][1-8][+#]?|o-o[-o]?)\s+(?:gives?\s+)?check|da\s+jaque|jaquea/);
      if (!checkMatch) return { verified: null, explanation: 'Could not parse check claim' };
      const moveStr = checkMatch[1];
      try {
        const tempChess = new Chess(boardToFen(board));
        let moveObj;
        try {
          moveObj = tempChess.move(moveStr, { sloppy: true });
        } catch (e) {
          if (moveStr.length >= 4) {
            moveObj = tempChess.move({ from: moveStr.substring(0,2), to: moveStr.substring(2,4), promotion: moveStr[4] || 'q' });
          }
        }
        if (moveObj && tempChess.isCheck()) {
          return { verified: true, explanation: `Move ${moveStr} DOES give check` };
        } else {
          return { verified: false, explanation: `Move ${moveStr} does NOT give check` };
        }
      } catch (e) {
        return { verified: false, explanation: `Could not verify check: ${e.message}` };
      }
    }

    case 'defend': {
      const defendMatch = claimLower.match(/(queen|rook|bishop|knight|pawn|king|reina|torre|alfil|caballo|pe[oó]n|rey)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?\s+(?:on|en)\s+([a-h][1-8])\s+(?:defends?|protects?|defiende|defienden|protege|protegen)\s+(?:(?:the|el|la|los|las)\s+)?(?:pawn|knight|bishop|rook|queen|king|pe[oó]n|caballo|alfil|torre|reina|rey)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?(?:\s+(?:on|en)\s+)?([a-h][1-8])/);
      if (!defendMatch) return { verified: null, explanation: 'Could not parse defend claim' };
      const [, pieceName, fromSquare, toSquare] = defendMatch;
      const expectedType = pieceTypeMap[pieceName];
      const piece = getPieceAt(fromSquare);

      if (!piece) return { verified: false, explanation: `No piece on ${fromSquare}` };
      if (piece.type !== expectedType) return { verified: false, explanation: `Piece on ${fromSquare} is ${piece.type}, not ${pieceName}` };
      if (piece.color !== perspectiveColor) return { verified: false, explanation: `Piece on ${fromSquare} belongs to opponent` };

      const targetPiece = getPieceAt(toSquare);
      if (!targetPiece || targetPiece.color !== perspectiveColor) {
        return { verified: false, explanation: `No friendly piece on ${toSquare} to defend` };
      }

      const defends = canPieceAttackSquare(piece, fromSquare, toSquare);
      if (defends) {
        return { verified: true, explanation: `${pieceName} on ${fromSquare} DOES defend ${targetPiece.type} on ${toSquare}` };
      } else {
        return { verified: false, explanation: `${pieceName} on ${fromSquare} does NOT defend ${targetPiece.type} on ${toSquare}` };
      }
    }

    case 'pin': {
      const pinMatch = claimLower.match(/(queen|rook|bishop|reina|torre|alfil)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?\s+(?:on|en)\s+([a-h][1-8])\s+(?:pins?|clava|clavan)\s+(?:(?:the|el|la|los|las)\s+)?(?:pawn|knight|bishop|rook|queen|king|pe[oó]n|caballo|alfil|torre|reina|rey)(?:\s+(?:white|black|negra|blanco|blanca|negro|\w+))?(?:\s+(?:on|en)\s+)?([a-h][1-8])/);
      if (!pinMatch) return { verified: null, explanation: 'Could not parse pin claim' };
      const [, pieceName, fromSquare, targetSquare] = pinMatch;

      const pinPieceTypeMap = { 
        queen: 'q', rook: 'r', bishop: 'b',
        reina: 'q', torre: 'r', alfil: 'b'
      };
      const expectedType = pinPieceTypeMap[pieceName];
      const piece = getPieceAt(fromSquare);

      if (!piece || piece.type !== expectedType || piece.color !== perspectiveColor) {
        return { verified: false, explanation: `Invalid pinning piece on ${fromSquare}` };
      }

      const targetPiece = getPieceAt(targetSquare);
      if (!targetPiece || targetPiece.color === perspectiveColor) {
        return { verified: false, explanation: `No enemy piece on ${targetSquare} to pin` };
      }

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
      if (!kingSquare) return { verified: false, explanation: 'Enemy king not found' };

      const attacker = squareToCoords(fromSquare);
      const target = squareToCoords(targetSquare);
      const king = squareToCoords(kingSquare);

      const df1 = target.file - attacker.file;
      const dr1 = target.rank - attacker.rank;
      const df2 = king.file - target.file;
      const dr2 = king.rank - target.rank;

      const aligned = (df1 === 0 && df2 === 0) || (dr1 === 0 && dr2 === 0) || (Math.abs(df1) === Math.abs(dr1) && Math.abs(df2) === Math.abs(dr2));
      const sameDirection = Math.sign(df1) === Math.sign(df2) && Math.sign(dr1) === Math.sign(dr2);

      if (aligned && sameDirection && isPathClear(board, attacker, target, df1, dr1)) {
        return { verified: true, explanation: `${pieceName} on ${fromSquare} pins ${targetPiece.type} on ${targetSquare} to king on ${kingSquare}` };
      }
      return { verified: false, explanation: `${pieceName} on ${fromSquare} does NOT pin ${targetPiece.type} on ${targetSquare}` };
    }

    default:
      return { verified: null, explanation: `Claim type "${context}" not recognized for verification` };
  }
}

/**
 * Convert board array back to FEN (simplified)
 */
function boardToFen(board) {
  let fen = '';
  for (let rank = 0; rank < 8; rank++) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = board[rank][file];
      if (piece) {
        if (empty > 0) { fen += empty; empty = 0; }
        const symbol = piece.color === 'w' ? piece.type.toUpperCase() : piece.type.toLowerCase();
        fen += symbol;
      } else {
        empty++;
      }
    }
    if (empty > 0) fen += empty;
    if (rank < 7) fen += '/';
  }
  // Add minimal FEN parts (we only need position for verification)
  fen += ' w - - 0 1';
  return fen;
}

/**
 * Validate that a move mentioned in analysis is actually legal in the position
 * @param {string} move - Move in SAN or UCI
 * @param {string} fen - Position FEN
 * @returns {Object} { legal: boolean, explanation: string }
 */
export function validateMoveInPosition(move, fen) {
  try {
    const chess = new Chess(fen);
    const moveObj = chess.move(move, { sloppy: true });
    if (moveObj) {
      chess.undo();
      return { legal: true, explanation: `Move ${move} is legal`, san: moveObj.san };
    }
    return { legal: false, explanation: `Move ${move} is NOT legal in this position` };
  } catch (e) {
    return { legal: false, explanation: `Invalid move ${move}: ${e.message}` };
  }
}

/**
 * Validate that a variation (move sequence) is legal
 * @param {string} variation - Space-separated moves
 * @param {string} fen - Starting FEN
 * @returns {Object} { valid: boolean, errors: Array, finalFen: string }
 */
export function validateVariation(variation, fen) {
  const chess = new Chess(fen);
  const moves = variation.trim().split(/\s+/).filter(m => m && !m.match(/^\d+\.?\.?$/));
  const errors = [];

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    try {
      const moveObj = chess.move(move, { sloppy: true });
      if (!moveObj) {
        errors.push(`Move ${i + 1} (${move}): Illegal in current position`);
        break;
      }
    } catch (e) {
      errors.push(`Move ${i + 1} (${move}): ${e.message}`);
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    finalFen: chess.fen()
  };
}