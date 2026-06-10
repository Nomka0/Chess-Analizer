/**
 * Advanced chess text parser.
 */
export function formatAIAnalysisText(text) {
    if (!text) return "";

    // Normalize piece representation to letters
    const normalize = (move) => {
        return move.replace(/[♞♝♜♛♚]/g, (match) => {
            const map = { '♞': 'N', '♝': 'B', '♜': 'R', '♛': 'Q', '♚': 'K' };
            return map[match] || match;
        });
    };

    // 2. Strict Unified Tokenization Regex
    const chessMoveRegex = /(?:\d+\.?\s*(?:\.\.\.)?\s*)?([NBRQK♞♝♜♛♚]\s?[a-h]?x?[a-h][1-8](?:\+|=?[NBRQK])?|[a-h]x?[a-h]?[1-8](?:\+)?|O-O(?:-O)?)/g;

    return text.replace(chessMoveRegex, (match, move) => {
        const normalizedMove = normalize(move.replace(/\s+/g, ''));
        const dataMove = move.replace(/\s+/g, '');
        
        return match.replace(move, `<span class="clickable-move" data-move="${dataMove}">${normalizedMove}</span>`);
    });
}

// FUNCTION 2: CLEAN CONVERSION (For safe plain-text strings only)
export function cleanChessSymbolsOnly(text) {
    if (!text) return "";
    return text.replace(/[♘♗♖♕♔♞♝♜♛♚]/g, match => {
        const map = { '♘': 'N', '♗': 'B', '♖': 'R', '♕': 'Q', '♔': 'K', '♞': 'N', '♝': 'B', '♜': 'R', '♛': 'Q', '♚': 'K' };
        return map[match] || match;
    });
}
