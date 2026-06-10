/**
 * Advanced chess text parser.
 */
export function formatAIAnalysisText(text) {
    if (!text) return "";

    const mapping = {
        'N': '♞', 'B': '♝', 'R': '♜', 'Q': '♛', 'K': '♚',
        '♘': '♞', '♗': '♝', '♖': '♜', '♕': '♛', '♔': '♚',
        '♞': '♞', '♝': '♝', '♜': '♜', '♛': '♛', '♚': '♚'
    };

    // Standardize all transparent icons to solid unicode pieces
    let formattedText = text.replace(/[♘♗♖♕♔]/g, match => mapping[match] || match);

    // 2. Strict Unified Tokenization Regex
    // This regex looks for:
    // (Optional Turn Number) (Optional Piece) (Optional Space) (SquareCoords)
    const chessMoveRegex = /(?:\d+\.?\s*(?:\.\.\.)?\s*)?([NBRQK♞♝♜♛♚]\s?[a-h]?x?[a-h][1-8](?:\+|=?[NBRQK])?|[a-h]x?[a-h]?[1-8](?:\+)?)/g;

    formattedText = formattedText.replace(chessMoveRegex, (match, move) => {
        // If it's a move number + move, we want to keep the number plain and wrap only the move.
        const pieceMatch = move.match(/[NBRQK♞♝♜♛♚]/);
        
        // Remove spaces for the data-move attribute
        const dataMove = move.replace(/\s+/g, '');
        
        if (pieceMatch) {
            const pieceIcon = pieceMatch[0];
            const restOfMove = move.replace(pieceIcon, '').replace(/\s+/g, '');
            const solidSymbol = mapping[pieceIcon] || pieceIcon;
            
            const wrappedMove = `<span class="clickable-move" data-move="${dataMove}"><span class="chess-piece-icon">${solidSymbol}</span>${restOfMove}</span>`;
            
            // Re-insert move number if it existed
            return match.replace(move, wrappedMove);
        }
        
        // Pawn move
        const wrappedMove = `<span class="clickable-move" data-move="${dataMove}">${move.replace(/\s+/g, '')}</span>`;
        return match.replace(move, wrappedMove);
    });

    return formattedText;
}

// FUNCTION 2: CLEAN CONVERSION (For safe plain-text strings only)
export function cleanChessSymbolsOnly(text) {
    if (!text) return "";
    const mapping = { '♘': '♞', '♗': '♝', '♖': '♜', '♕': '♛', '♔': '♚' };
    return text.replace(/[♘♗♖♕♔]/g, match => mapping[match] || match);
}
