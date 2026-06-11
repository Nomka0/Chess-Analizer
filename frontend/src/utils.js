import { Chess } from 'chess.js';

/**
 * Advanced chess text parser.
 * This function processes the AI-generated analysis text to:
 * 1. Identify variation blocks and add metadata (sequence of moves, starting position).
 * 2. Make chess moves inside variation blocks clickable, and bold those outside.
 */
/**
 * Advanced chess text parser.
 */
export function formatAIAnalysisText(text, activeHistoryIndex = -1) {
    if (!text) return text;

    // 1. Target variation div wrappers and make moves inside them clickable
    let processed = text.replace(/(.{0,50})<div class="variation">(.*?)<\/div>/gs, (match, prefix, content) => {
        let startIndex = -1;
        const moveNumberRegex = /(\d+)\s*(\.{1,3})/g;
        
        let m;
        let lastMatch = null;
        const junctionIndex = prefix.length;
        moveNumberRegex.lastIndex = 0;
        while ((m = moveNumberRegex.exec(prefix + content)) !== null) {
            if (m.index <= junctionIndex + 10) {
                lastMatch = m;
                if (m.index >= junctionIndex) break;
            }
        }

        if (lastMatch) {
            const num = parseInt(lastMatch[1]);
            const dots = lastMatch[2];
            if (dots.length >= 2) startIndex = (num * 2) - 1;
            else startIndex = (num - 1) * 2;
        }

        const moveOnlyRegex = /([NBRQK♘♗♖♕♔♞♝♜♛♚]?\s*[a-hA-H]?x?[a-hA-H][1-8](?:\+|=?[NBRQK♘♗♖♕♔♞♝♜♛♚])?|O-O(?:-O)?)/g;
        
        const moves = [];
        let moveM;
        moveOnlyRegex.lastIndex = 0;
        while ((moveM = moveOnlyRegex.exec(content)) !== null) {
            if (moveM[0]) {
                const cleanMove = moveM[0].replace(/\s+/g, '');
                if (/[a-h][1-8]/i.test(cleanMove) || cleanMove.startsWith('O-O')) {
                    moves.push(cleanMove);
                }
            }
        }
        
        moveOnlyRegex.lastIndex = 0;
        const parsedContent = content.replace(moveOnlyRegex, (moveMatch) => {
            const dataMove = moveMatch.replace(/\s+/g, '');
            if (/[a-h][1-8]/i.test(dataMove) || dataMove.startsWith('O-O')) {
                return `<span class="clickable-move cursor-pointer hover:text-violet-400 transition-colors" data-move="${dataMove}">${moveMatch}</span>`;
            }
            return moveMatch;
        });
        
        return `${prefix}<div class="variation variation-wrapper" data-variation="${moves.join(',')}" data-start-index="${startIndex}">${parsedContent}</div>`;
    });

    // 2. Wrap moves OUTSIDE of variation blocks to ALSO be clickable single-moves!
    const globalMoveRegex = /(<div.*?<\/div>|<span.*?<\/span>|<.*?>)|([NBRQK♘♗♖♕♔♞♝♜♛♚]?\s*[a-hA-H]?x?[a-hA-H][1-8](?:\+|=?[NBRQK♘♗♖♕♔♞♝♜♛♚])?|O-O(?:-O)?)/gi;
    
    return processed.replace(globalMoveRegex, (match, tag, move) => {
        if (tag) return tag; // Return existing tag as-is (e.g. inside our variation div)
        
        const cleanMove = move.trim().replace(/\s+/g, '');
        // We create a standalone clickable move. We use an underline to make it obvious to the user.
        return `<span class="clickable-move font-semibold text-white cursor-pointer hover:text-violet-400 underline decoration-violet-500/30 underline-offset-2" data-move="${cleanMove}" data-variation="${cleanMove}" data-start-index="${activeHistoryIndex}">${move}</span>`;
    });
}

/**
 * Applies a PGN variation to a base FEN and returns the resulting FEN.
 */
export function applyPgnToFen(baseFen, pgnVariation) {
    const game = new Chess(baseFen);
    const moves = pgnVariation.split(/\s+/).filter(m => m.length > 0);
    
    for (const move of moves) {
        const cleanMove = move.replace(/^\d+\.\s*/, '');
        if (cleanMove === '...' || cleanMove.includes('.')) continue;
        
        try {
            game.move(cleanMove);
        } catch (e) {
            console.warn(`Invalid move ${cleanMove} in variation: ${e.message}`);
            break;
        }
    }
    return game.fen();
}

/**
 * Clean conversion for chess symbols and formatting.
 */
export function cleanChessSymbolsOnly(text) {
    if (!text) return "";
    
    let clean = text.replace(/[♘♗♖♕♔♞♝♜♛♚]/g, match => {
        const map = { '♘': 'N', '♗': 'B', '♖': 'R', '♕': 'Q', '♔': 'K', '♞': 'N', '♝': 'B', '♜': 'R', '♛': 'Q', '♚': 'K' };
        return map[match] || match;
    });

    clean = clean.replace(/([NBRQK])\s+([a-hA-H][1-8])/gi, '$1$2');

    return clean.replace(/([a-hA-H])([1-8])/g, (match, file, rank) => {
        return file.toLowerCase() + rank;
    });
}
