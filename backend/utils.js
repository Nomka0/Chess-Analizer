export function formatChessText(text) {
    if (!text) return "";

    const mapping = {
        'N': '♞', 'B': '♝', 'R': '♜', 'Q': '♛', 'K': '♚', 'P': '♟',
        '♘': '♞', '♗': '♝', '♖': '♜', '♕': '♛', '♔': '♚', '♙': '♟'
    };

    // 1. Primero manejamos los símbolos que YA pueden estar en el texto (unicodes)
    let formattedText = text.replace(/[♘♗♖♕♔♙♞♝♜♛♚♟]/g, match => {
        const solid = mapping[match] || match;
        return `<span class="chess-piece-icon">${solid}</span>`;
    });

    // 2. Luego buscamos letras SAN que necesitan ser convertidas a íconos
    // Solo si van seguidas de una coordenada de ajedrez (e.g. Nf3, Bxe4)
    // Usamos una búsqueda negativa para no re-procesar lo que ya pusimos en spans
    formattedText = formattedText.replace(/(?<!>)\b([NBRQK])(?=[a-h]x?[a-h]?[1-8]|[a-h][1-8])/g, (match, piece) => {
        return `<span class="chess-piece-icon">${mapping[piece]}</span>`;
    });

    return formattedText;
}
