import { Chess } from 'chess.js';

/**
 * Advanced chess text parser.
 */
export function formatAIAnalysisText(text, activeHistoryIndex = -1) {
    if (!text) return text;

    // REGEX MAESTRA CORREGIDA:
    // Soporta piezas normales, unicodes y el span de íconos que genera el backend
    // Ahora incluye también peones y mayor variedad de símbolos
    const moveRegexStr = "((?:<span[^>]+>[♞♝♜♛♚♟♘♗♖♕♔♙]</span>|[KQRBN♘♗♖♕♔♞♝♜♛♚♟♙])?\\s*[a-h]?[1-8]?x?[a-h][1-8](?:=[KQRBN♘♗♖♕♔♞♝♜♛♚♟♙])?[+#]?|O-O(?:-O)?)";

    // 1. Procesamos SOLO los bloques de variantes para hacerlos interactivos
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

        const moveOnlyRegex = new RegExp(`(?<=^|[\\s.,;([<>])${moveRegexStr}(?=$|[\\s.,;)\\]<>])`, 'gu');
        
        const movesForVarLine = [];
        let moveM;
        moveOnlyRegex.lastIndex = 0;
        while ((moveM = moveOnlyRegex.exec(content)) !== null) {
            if (moveM[0]) {
                // Removemos el espacio internamente para chess.js (N f3 -> Nf3)
                const dataMove = cleanChessSymbolsOnly(moveM[0].replace(/\s+/g, ''));
                if (/[a-h][1-8]/.test(dataMove) || dataMove.startsWith('O-O')) {
                    movesForVarLine.push(dataMove);
                }
            }
        }
        
        moveOnlyRegex.lastIndex = 0;
        const parsedContent = content.replace(moveOnlyRegex, (moveMatch) => {
            // El data-move va limpio (Nf3), pero el moveMatch MANTIENE el ícono y el espacio visual (♘ f3)
            const dataMove = cleanChessSymbolsOnly(moveMatch.replace(/\s+/g, ''));
            if (/[a-h][1-8]/.test(dataMove) || dataMove.startsWith('O-O')) {
                return `<span class="clickable-move cursor-pointer hover:text-violet-400 transition-colors" data-move="${dataMove}">${moveMatch}</span>`;
            }
            return moveMatch;
        });
        
        return `${prefix}<div class="variation variation-wrapper" data-variation="${movesForVarLine.join(',')}" data-start-index="${startIndex}">${parsedContent}</div>`;
    });

    // 2. Los movimientos fuera de las variantes vuelven a ser solo texto en negrita
    const globalMoveRegex = new RegExp(`(<[^>]+>)|(?<=^|[\\s.,;([<>])${moveRegexStr}(?=$|[\\s.,;)\\]<>])`, 'gu');
    
    return processed.replace(globalMoveRegex, (match, tag, move) => {
        if (tag) return tag;
        if (move) return `<strong>${move}</strong>`;
        return match;
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
    
    // 1. Removemos cualquier tag HTML (como el span del ícono)
    let clean = text.replace(/<[^>]*>/g, '');

    // 2. Mapeamos unicodes a letras estándar
    clean = clean.replace(/[♘♗♖♕♔♞♝♜♛♚♟♙]/g, match => {
        const map = { 
            '♘': 'N', '♗': 'B', '♖': 'R', '♕': 'Q', '♔': 'K', 
            '♞': 'N', '♝': 'B', '♜': 'R', '♛': 'Q', '♚': 'K',
            '♟': '',  '♙': ''  // Los peones no llevan letra en SAN estándar
        };
        return map[match] || match;
    });

    // 3. Limpieza final de espacios y minúsculas
    clean = clean.replace(/([NBRQK])\s+([a-hA-H][1-8])/gi, '$1$2');

    return clean.replace(/([a-hA-H])([1-8])/g, (match, file, rank) => {
        return file.toLowerCase() + rank;
    });
}
