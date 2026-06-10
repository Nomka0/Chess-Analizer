export function formatChessText(text) {
    if (!text) return "";

    const mapping = {
        'N': '♞', 'B': '♝', 'R': '♜', 'Q': '♛', 'K': '♚',
        '♘': '♞', '♗': '♝', '♖': '♜', '♕': '♛', '♔': '♚'
    };

    // 1. Replace any existing transparent pieces with solid ones
    let formattedText = text.replace(/[♘♗♖♕♔]/g, match => mapping[match] || match);

    // 2. Wrap solid pieces and newly matched SAN letters in the HTML span
    formattedText = formattedText.replace(/\b([NBRQK])(?=[a-h]x?[a-h]?[1-8]|[a-h][1-8])/g, (match, piece) => {
        return `<span class="chess-piece-icon">${mapping[piece]}</span>`;
    });

    return formattedText;
}
