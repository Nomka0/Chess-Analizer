import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import ImportModal from './components/ImportModal';
import Header from './components/Header';
import AnalysisView from './components/AnalysisView';
import MatchProgress from './components/MatchProgress';
import { ArrowUpDown, ChevronLeft, ChevronRight, SkipBack, SkipForward } from 'lucide-react';

const markdownComponents = {
  h1: ({...props}) => <h1 className="text-lg font-black text-violet-400 mt-4 mb-2 border-b border-slate-800 pb-1 uppercase tracking-wider" {...props} />,
  h2: ({...props}) => <h2 className="text-base font-bold text-violet-300 mt-3 mb-1.5" {...props} />,
  h3: ({...props}) => <h3 className="text-sm font-black text-indigo-400 mt-4 mb-2 uppercase tracking-tight flex items-center gap-2" {...props} />,
  h4: ({...props}) => <h4 className="text-[11px] font-bold text-slate-400 mt-3 mb-1 uppercase tracking-widest" {...props} />,
  p: ({...props}) => <p className="text-slate-300 text-xs leading-relaxed mb-3 font-sans" {...props} />,
  strong: ({...props}) => <strong className="font-semibold text-white" {...props} />,
  ul: ({...props}) => <ul className="list-disc list-inside space-y-1.5 mb-4 text-slate-400 text-xs ml-1" {...props} />,
  li: ({...props}) => <li className="marker:text-violet-500" {...props} />,
  blockquote: ({...props}) => <blockquote className="border-l-2 border-violet-500/50 pl-4 py-1 my-4 bg-violet-500/5 italic text-slate-300 rounded-r shadow-sm" {...props} />,
};

const translations = {
  en: {
    title: "Chess Analyzer Pro",
    defaultModel: "Default Model",
    analyzeFull: "Analyze Full Match",
    analyzing: "Analyzing...",
    importFen: "Import FEN",
    importPgn: "Import PGN",
    copyFen: "Copy FEN",
    pasted: "Copied!",
    loadData: "Load Data",
    pastePgn: "Paste PGN here to start...",
    matchProgress: "Match Progress",
    movesCount: "Count",
    analysis: "Analysis",
    noAnalysis: "Sin análisis para esta posición.",
    suggested: "Suggested",
    intelligenceReady: "Intelligence Ready",
    loadMatch: "Load match to analyze",
    best: "best",
    excellent: "excellent",
    good: "good",
    inaccuracy: "inaccuracy",
    mistake: "mistake",
    blunder: "blunder",
    fenPlaceholder: "Paste your FEN here...",
    pgnPlaceholder: "Paste your PGN here..."
  },
  es: {
    title: "Chess Analyzer Pro",
    defaultModel: "Modelo por defecto",
    analyzeFull: "Analizar Partida",
    analyzing: "Analizando...",
    importFen: "Importar FEN",
    importPgn: "Importar PGN",
    copyFen: "Copiar FEN",
    pasted: "¡Copiado!",
    loadData: "Cargar Datos",
    pastePgn: "Pega el PGN aquí...",
    matchProgress: "Progreso",
    movesCount: "Total",
    analysis: "Análisis",
    noAnalysis: "Sin análisis para esta posición.",
    suggested: "Sugerido",
    intelligenceReady: "IA Lista",
    loadMatch: "Carga una partida para analizar",
    best: "mejor",
    excellent: "excelente",
    good: "bueno",
    inaccuracy: "imprecisión",
    mistake: "error",
    blunder: "grave",
    fenPlaceholder: "Pega tu FEN aquí...",
    pgnPlaceholder: "Pega tu PGN aquí..."
  }
};

function App() {
  // CORE STATE
  const [game, setGame] = useState(new Chess());
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [boardOrientation, setBoardOrientation] = useState('white');
  const [playerNames, setPlayerNames] = useState({ 
    white: 'White', black: 'Black', 
    whiteElo: '', blackElo: '',
    whiteAvatar: null, blackAvatar: null 
  });
  const [language, setLanguage] = useState('es'); 
  
  // Accuracy state
  const [accuracy, setAccuracy] = useState({ white: 0, black: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [batchAnalysisResults, setBatchAnalysisResults] = useState({});
  const [models, setModels] = useState([]);

  // CAPS System Helper Functions
  const centipawnsToWinProb = (cp) => 1 / (1 + Math.pow(10, -cp / 400));
  
  const getClassification = (impact, cpLoss, moveNumber, san) => {
      // 1. Safeguard for e4/d4 on move 1
      if (moveNumber === 1 && (san === 'e4' || san === 'd4')) {
          return 'excellent';
      }

      // 2. Safeguard for small centipawn loss (less than 30cp)
      // A difference of less than 0.3 (30 centipawns) should ALWAYS be categorized as "excellent" or "good"
      if (cpLoss < 30) {
          return impact < 1.5 ? 'best' : 'excellent';
      }

      // 3. General categorization based on impact (win probability loss)
      if (impact < 1.5) return 'best';
      if (impact < 4.0) return 'excellent';
      if (impact < 8.0) return 'good';
      if (impact < 15.0) return 'inaccuracy';
      if (impact < 25.0) return 'mistake';
      return 'blunder';
  };

  const [selectedModel, setSelectedModel] = useState('');
  const [copied, setCopied] = useState(false);
  const [showImportModal, setShowImportModal] = useState(null); 
  const [tempInput, setFenInput] = useState('');
  
  // RESIZING STATES
  const [sidebarWidth, setSidebarWidth] = useState(950);
  const [moveListWidth, setMoveListWidth] = useState(200);
  const isResizingH = useRef(false);
  const isResizingV = useRef(false);

  const boardRef = useRef(null);
  const cg = useRef(null);
  const historyContainerRef = useRef(null);
  const sidebarRef = useRef(null);
  
  const t = translations[language];
  const currentFen = game.fen();
  
  const currentAnalysis = useMemo(() => {
      return batchAnalysisResults[currentFen] || null;
  }, [currentFen, batchAnalysisResults]);

  const evalScore = currentAnalysis?.score || 0;
  
  const whiteScoreStr = (evalScore / 100).toFixed(1);
  const blackScoreStr = (-evalScore / 100).toFixed(1);
  
  // Barra de evaluación usando el modelo matemático sigmoide (Igual a Chess.com)
  const winPercent = useMemo(() => {
    return Math.max(5, Math.min(95, centipawnsToWinProb(evalScore) * 100));
  }, [evalScore]);

  // INITIALIZATION
  useEffect(() => {
    fetch('http://localhost:3000/api/models')
      .then(res => res.json())
      .then(data => {
        setModels(data);
        if (data.includes('phi4-mini:latest')) setSelectedModel('phi4-mini:latest');
        else if (data.length > 0) setSelectedModel(data[0]);
      })
      .catch(console.error);
  }, []);

  const fetchAvatar = useCallback(async (username) => {
    try {
      const response = await fetch(`https://api.chess.com/pub/player/${username}`);
      if (!response.ok) return null;
      const data = await response.json();
      return data.avatar || null;
    } catch (error) {
      console.error('Error fetching avatar:', error);
      return null;
    }
  }, []);

  const handleImportPgn = useCallback(async (pgnString) => {
    try {
      if (pgnString.includes('1.') || pgnString.includes('[')) {
        const whiteName = pgnString.match(/\[White "(.*)"\]/)?.[1] || 'White';
        const blackName = pgnString.match(/\[Black "(.*)"\]/)?.[1] || 'Black';
        const whiteElo = pgnString.match(/\[WhiteElo "(.*)"\]/)?.[1] || '';
        const blackElo = pgnString.match(/\[BlackElo "(.*)"\]/)?.[1] || '';
        
        const [whiteAvatar, blackAvatar] = await Promise.all([
          fetchAvatar(whiteName),
          fetchAvatar(blackName)
        ]);
        
        setPlayerNames({ white: whiteName, black: blackName, whiteElo, blackElo, whiteAvatar, blackAvatar });
        
        const moveString = pgnString.replace(/\[.*\]/g, '').replace(/\d+\./g, '').replace(/\*/g, '').replace(/0-1|1-0|1\/2-1\/2/g, '').trim();
        const moves = moveString.split(/\s+/);
        const tempGame = new Chess();
        const newHistory = [];
        for (const move of moves) {
          if (!move) continue;
          const result = tempGame.move(move);
          if (!result) throw new Error(`Invalid move: ${move}`);
          newHistory.push(result);
        }
        setHistory(newHistory);
        setHistoryIndex(-1);
        setGame(new Chess());
      } else {
        let fen = pgnString.trim();
        if (fen.split(' ').length === 1) fen += ' w KQkq - 0 1';
        setGame(new Chess(fen));
        setHistory([]);
        setHistoryIndex(-1);
      }
      setBatchAnalysisResults({});
      setAccuracy({ white: 0, black: 0 });
      setShowImportModal(null);
      setFenInput('');
    } catch (e) { alert("Import Error: " + e.message); }
  }, []);

  // KEYBOARD/PASTE
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') navigateHistory(-1);
      if (e.key === 'ArrowRight') navigateHistory(1);
    };
    const handlePaste = (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      const pastedText = e.clipboardData ? e.clipboardData.getData('text') : '';
      if (pastedText) handleImportPgn(pastedText);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
    };
  }, [historyIndex, history, handleImportPgn]);

  const stopResizing = useCallback(() => {
    isResizingH.current = false;
    isResizingV.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'default';
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (isResizingH.current) {
        const newWidth = window.innerWidth - e.clientX;
        if (newWidth > 400 && newWidth < 1000) setSidebarWidth(newWidth);
    }
    if (isResizingV.current) {
        const sidebarRect = sidebarRef.current?.getBoundingClientRect();
        if (sidebarRect) {
            const newWidth = e.clientX - sidebarRect.left;
            if (newWidth > 120 && newWidth < 400) setMoveListWidth(newWidth);
        }
    }
  }, []);

  const startResizingH = useCallback(() => {
    isResizingH.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'col-resize';
  }, [handleMouseMove, stopResizing]);

  const startResizingV = useCallback(() => {
    isResizingV.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'col-resize';
  }, [handleMouseMove, stopResizing]);

  useEffect(() => {
    if (boardRef.current) {
      if (!cg.current) {
        cg.current = Chessground(boardRef.current, {
          fen: currentFen,
          orientation: boardOrientation,
          movable: { free: false },
          events: { move: (from, to) => onDrop(from, to) }
        });
      } else {
        cg.current.set({ fen: currentFen, orientation: boardOrientation });
      }
    }
    return () => { if (cg.current) cg.current.destroy(); cg.current = null; };
  }, [currentFen, boardOrientation]);

  function onDrop(from, to) {
    const gameCopy = new Chess(game.fen());
    const move = gameCopy.move({ from, to, promotion: 'q' });
    if (move) {
      setGame(gameCopy);
      setHistory(gameCopy.history({ verbose: true }));
      setHistoryIndex(gameCopy.history().length - 1);
    }
  }

  function navigateHistory(direction) {
    const newIndex = direction === -Infinity
      ? -1
      : direction === Infinity
        ? history.length - 1
        : Math.max(-1, Math.min(historyIndex + direction, history.length - 1));

    const tempGame = new Chess();
    for (let i = 0; i <= newIndex; i++) tempGame.move(history[i]);
    setGame(tempGame);
    setHistoryIndex(newIndex);
  }

  function handleFlip() {
    setBoardOrientation(prev => prev === 'white' ? 'black' : 'white');
  }

  function handleCopyFen() {
    navigator.clipboard.writeText(currentFen);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleImport() {
    if (!tempInput.trim()) return;
    handleImportPgn(tempInput);
    setBatchAnalysisResults({});
    setShowImportModal(null);
    setFenInput('');
  }

  async function handleAnalyzeAllPgn() {
    setIsLoading(true);
    const tempGame = new Chess();
    const positions = [{ fen: tempGame.fen() }];
    for (const move of history) {
        tempGame.move(move);
        positions.push({ fen: tempGame.fen(), san: move.san });
    }

    // 1. Obtener evaluaciones rápidas para todos los estados de la partida
    const allEvals = {};
    const CHUNK_SIZE = 10;
    for (let i = 0; i < positions.length; i += CHUNK_SIZE) {
        const chunk = positions.slice(i, i + CHUNK_SIZE);
        try {
            const evals = await (await fetch('http://localhost:3000/api/evaluate-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fens: chunk.map(p => p.fen) })
            })).json();
            evals.forEach((ev, idx) => {
                allEvals[chunk[idx].fen] = ev.score;
            });
        } catch (e) { console.error(e); }
    }

    const currentResults = {};
    let wPerf = 0, bPerf = 0, wMoves = 0, bMoves = 0;

    // Colocar la posición inicial por defecto en el mapa
    currentResults[positions[0].fen] = { score: allEvals[positions[0].fen] || 0, classification: 'best', analysis: '', bestmove: '' };
    setBatchAnalysisResults({ ...currentResults });

    // Preparar payloads para el streaming
    const streamPayload = positions.slice(1).map((pos, idx) => {
        const prevPos = positions[idx];
        const prevGame = new Chess(prevPos.fen);
        const movingPlayer = prevGame.turn();

        const bestScore = movingPlayer === 'b' ? -(allEvals[prevPos.fen] || 0) : (allEvals[prevPos.fen] || 0);
        const bestProb = centipawnsToWinProb(bestScore);
        let actualScore = allEvals[pos.fen] || 0;
        if (movingPlayer === 'b') actualScore = -actualScore;

        const actualProb = centipawnsToWinProb(actualScore);
        const impact = Math.max(0, bestProb - actualProb) * 100;
        const cpLoss = Math.max(0, bestScore - actualScore);
        const moveNumber = Math.ceil((idx + 1) / 2);
        const classification = getClassification(impact, cpLoss, moveNumber, pos.san);

        return {
            fen: prevPos.fen,
            userMove: pos.san,
            classification,
            index: idx + 1, // Store the original position index
            impact,
            movingPlayer
        };
    });

    const queryParams = new URLSearchParams({
        fens: JSON.stringify(streamPayload),
        model: selectedModel,
        language,
        moveTime: 200
    });

    const eventSource = new EventSource(`http://localhost:3000/api/analyze-stream?${queryParams.toString()}`);

    eventSource.onmessage = (event) => {
        if (event.data === '[DONE]') {
            eventSource.close();
            setIsLoading(false);
            return;
        }

        try {
            const data = JSON.parse(event.data);
            const { index, result, error } = data;
            
            if (error) {
                console.error(`Error at move ${index}:`, error);
                return;
            }

            const pos = positions[index];
            const payload = streamPayload[index - 1];

            // UI Score (Perspectiva de las blancas para la barra)
            const currentGame = new Chess(pos.fen);
            const uiScore = currentGame.turn() === 'b' ? -(allEvals[pos.fen] || 0) : (allEvals[pos.fen] || 0);

            currentResults[pos.fen] = {
                score: uiScore,
                classification: payload.classification,
                analysis: result.analysis,
                bestmove: result.bestmove
            };

            // Acumular métricas CAPS
            if (payload.movingPlayer === 'w') {
                wPerf += (100 - payload.impact);
                wMoves++;
            } else {
                bPerf += (100 - payload.impact);
                bMoves++;
            }

            setBatchAnalysisResults({ ...currentResults });
            setAccuracy({ 
                white: wMoves ? (wPerf / wMoves).toFixed(1) : "0.0", 
                black: bMoves ? (bPerf / bMoves).toFixed(1) : "0.0" 
            });
        } catch (e) {
            console.error('Error parsing SSE message:', e);
        }
    };

    eventSource.onerror = (err) => {
        console.error('SSE Error:', err);
        eventSource.close();
        setIsLoading(false);
    };
  }

  return (
    <div className="h-screen bg-[#0b0f19] text-white flex flex-col font-sans overflow-hidden">
      
      <Header 
        t={t}
        setShowImportModal={setShowImportModal}
        handleCopyFen={handleCopyFen}
        copied={copied}
        language={language}
        setLanguage={setLanguage}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        models={models}
        handleAnalyzeAllPgn={handleAnalyzeAllPgn}
        isLoading={isLoading}
      />
      
      {showImportModal && (
        <ImportModal 
          showImportModal={showImportModal}
          setShowImportModal={setShowImportModal}
          t={t}
          tempInput={tempInput}
          setFenInput={setFenInput}
          handleImport={handleImport}
        />
      )}

      <main className="flex-grow relative h-0">
        <div className="absolute inset-0 flex overflow-hidden">
          
          {/* BARRA DE EVALUACIÓN */}
          <div className={`w-10 flex flex-col border-r border-slate-800 z-10 justify-end relative ${boardOrientation === 'white' ? 'bg-slate-900' : 'bg-white'}`}>
              <div
                  className={`w-full transition-all duration-500 ${boardOrientation === 'white' ? 'bg-white' : 'bg-slate-900'}`}
                  style={{ height: `${winPercent}%` }}
              />
              <div className="absolute inset-0 flex flex-col justify-between py-2 text-[10px] font-black pointer-events-none">
                  <div className="text-center mix-blend-difference text-white">
                      {boardOrientation === 'white' ? blackScoreStr : (evalScore > 0 ? `+${whiteScoreStr}` : whiteScoreStr)}
                  </div>
                  <div className="text-center mix-blend-difference text-white">
                      {boardOrientation === 'white' ? (evalScore > 0 ? `+${whiteScoreStr}` : whiteScoreStr) : blackScoreStr}
                  </div>
              </div>
          </div>
          
          {/* CONTENEDOR DEL TABLERO */}
          <div className="flex-grow flex flex-col items-center justify-center bg-[#0d1117] p-2 sm:p-4 overflow-hidden text-center max-h-full">
            
            {/* Jugador Superior */}
            <div className="mb-2 font-bold text-xs sm:text-sm text-slate-300 w-full max-w-[min(70vh, 70vw)] text-left flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 truncate">
                <div className="w-6 h-6 sm:w-8 sm:h-8 bg-slate-700 rounded-lg flex items-center justify-center text-xs overflow-hidden shrink-0">
                  {boardOrientation === 'white' ? (playerNames.blackAvatar ? <img src={playerNames.blackAvatar} alt="avatar" /> : '?') : (playerNames.whiteAvatar ? <img src={playerNames.whiteAvatar} alt="avatar" /> : '?')}
                </div>
                <span className="truncate">
                  {boardOrientation === 'white' ? playerNames.black : playerNames.white}
                  {boardOrientation === 'white' ? (playerNames.blackElo ? ` (${playerNames.blackElo})` : '') : (playerNames.whiteElo ? ` (${playerNames.whiteElo})` : '')}
                </span>
              </div>
              {accuracy.white > 0 && (
                <span className="text-[11px] bg-slate-800 px-2 py-0.5 rounded text-violet-400 font-mono shrink-0">
                  Acc: {boardOrientation === 'white' ? accuracy.black : accuracy.white}%
                </span>
              )}
            </div>

            {/* Tablero */}
            <div className="relative group shadow-2xl shadow-black p-2 bg-[#161b22] rounded-lg shrink min-h-0">
              <div ref={boardRef} style={{ width: 'min(70vh, 70vw)', height: 'min(70vh, 70vw)' }} />
            </div>

            {/* Jugador Inferior */}
            <div className="mt-1 font-bold text-xs sm:text-sm text-slate-300 w-full max-w-[min(70vh, 70vw)] text-left flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 truncate">
                <div className="w-6 h-6 sm:w-8 sm:h-8 bg-slate-700 rounded-lg flex items-center justify-center text-xs overflow-hidden shrink-0">
                  {boardOrientation === 'white' ? (playerNames.whiteAvatar ? <img src={playerNames.whiteAvatar} alt="avatar" /> : '?') : (playerNames.blackAvatar ? <img src={playerNames.blackAvatar} alt="avatar" /> : '?')}
                </div>
                <span className="truncate">
                  {boardOrientation === 'white' ? playerNames.white : playerNames.black}
                  {boardOrientation === 'white' ? (playerNames.whiteElo ? ` (${playerNames.whiteElo})` : '') : (playerNames.blackElo ? ` (${playerNames.blackElo})` : '')}
                </span>
              </div>
              {accuracy.white > 0 && (
                <span className="text-[11px] bg-slate-800 px-2 py-0.5 rounded text-emerald-400 font-mono shrink-0">
                  Acc: {boardOrientation === 'white' ? accuracy.white : accuracy.black}%
                </span>
              )}
            </div>

            {/* Controles de Navegación (Manteniendo espacios compactos de diseño) */}
            <div className="mt-1.5 flex gap-2 sm:gap-3 items-center shrink-0">
              <button onClick={() => navigateHistory(-Infinity)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><SkipBack className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={() => navigateHistory(-1)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={handleFlip} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><ArrowUpDown className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={() => navigateHistory(1)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={() => navigateHistory(Infinity)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><SkipForward className="w-4 h-4 sm:w-5 sm:h-5" /></button>
            </div>

          </div>

          {/* BARRA DE REDIMENSIONADO PRINCIPAL */}
          <div onMouseDown={startResizingH} className="w-1.5 hover:bg-violet-600/50 bg-slate-800 transition-colors cursor-col-resize z-10" />

          {/* SIDEBAR */}
          <div ref={sidebarRef} style={{ width: `${sidebarWidth}px` }} className="bg-[#161b22] border-l border-slate-800 flex flex-row shrink-0 h-full overflow-hidden">
              <AnalysisView 
                currentAnalysis={currentAnalysis}
                t={t}
                markdownComponents={markdownComponents}
              />
              
              <div onMouseDown={startResizingV} className="w-1.5 hover:bg-violet-600/50 bg-slate-800 transition-colors cursor-col-resize z-10 h-full" />

              <div style={{ width: `${moveListWidth}px` }} className="border-l border-slate-800 flex flex-col shrink-0 h-full">
                  <MatchProgress 
                      t={t}
                      history={history}
                      batchAnalysisResults={batchAnalysisResults}
                      historyIndex={historyIndex}
                      navigateHistory={navigateHistory}
                      historyContainerRef={historyContainerRef}
                  />
              </div>
          </div>

        </div>
      </main>
    </div>
  );
}

export default App;
