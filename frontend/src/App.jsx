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
  details: ({...props}) => <details className="mb-2 group" {...props} />,
  summary: ({...props}) => <summary className="cursor-pointer text-slate-300 text-xs font-semibold hover:text-violet-400 list-none flex items-center gap-2 before:content-['•'] before:text-violet-500" {...props} />,
  div: ({className, ...props}) => {
    if (className?.includes('variation')) {
      return <div className={`pl-3 py-1.5 text-[11px] font-mono text-slate-400 border-l-2 border-slate-700 ml-1 mt-1 bg-slate-800/30 rounded-r ${className}`} {...props} />;
    }
    return <div className={className} {...props} />;
  }
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
    noAnalysis: "No analysis for this position.",
    suggested: "Suggested",
    intelligenceReady: "Intelligence Ready",
    startAnalysis: "Start Analysis",
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
    pastePgn: "Pega tu PGN aquí...",
    matchProgress: "Progreso",
    movesCount: "Total",
    analysis: "Análisis",
    noAnalysis: "Sin análisis para esta posición.",
    suggested: "Sugerido",
    intelligenceReady: "IA Lista",
    startAnalysis: "Iniciar Análisis",
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
  const gameRef = useRef(new Chess());
  const altGameRef = useRef(new Chess());
  const [game, _setGame] = useState(new Chess());
  const [altGame, _setAltGame] = useState(new Chess());
  const [isAltBoardActive, setIsAltBoardActive] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyIndexRef = useRef(-1);
  useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);

  const [altHistoryIndex, setAltHistoryIndex] = useState(-1);
  const altHistoryIndexRef = useRef(-1);
  useEffect(() => { altHistoryIndexRef.current = altHistoryIndex; }, [altHistoryIndex]);
  
  // Track variation for alt board: { moves: uci[], branchPointIndex: number }
  const [altVariation, setAltVariation] = useState(null);

  const [boardOrientation, setBoardOrientation] = useState('white');
  const [playerNames, setPlayerNames] = useState({ 
    white: 'White', black: 'Black', 
    whiteElo: '', blackElo: '',
    whiteAvatar: null, blackAvatar: null 
  });
  const [language, setLanguage] = useState('en');

  const [userColor, setUserColor] = useState('white');
  const [isLoading, setIsLoading] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [batchAnalysisResults, setBatchAnalysisResults] = useState({});

  const historyRef = useRef([]);
  const resultsRef = useRef({});
  const fullGameHistoryRef = useRef([]);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { resultsRef.current = batchAnalysisResults; }, [batchAnalysisResults]);

  const syncGame = useCallback(() => {
    _setGame(new Chess(gameRef.current.fen()));
    setHistory(gameRef.current.history({ verbose: true }));
  }, []);

  const centipawnsToWinProb = (cp) => 50 + 50 * Math.tanh(cp / 200);

  const getClassification = useCallback((bestScore, actualScore, moveNumber, san) => {
    const bestProb = centipawnsToWinProb(bestScore);
    const actualProb = centipawnsToWinProb(actualScore);
    const impact = Math.max(0, bestProb - actualProb); // percentage (0-100)

    // Match backend classifyMove thresholds exactly:
    // best: impact <= 0%
    // excellent: impact <= 2%
    // good: impact <= 5%
    // inaccuracy: impact <= 10%
    // mistake: impact <= 20%
    // blunder: impact > 20%
    if (moveNumber === 1 && (san === 'e4' || san === 'd4')) return 'excellent';
    if (impact <= 0) return 'best';
    if (impact <= 2.0) return 'excellent';
    if (impact <= 5.0) return 'good';
    if (impact <= 10.0) return 'inaccuracy';
    if (impact <= 20.0) return 'mistake';
    return 'blunder';
  }, []);

  const [selectedModel, setSelectedModel] = useState('');
  const [copied, setCopied] = useState(false);
  const [showImportModal, setShowImportModal] = useState(null); 
  const [tempInput, setFenInput] = useState('');

  const isResizingH = useRef(false);
  const isResizingV = useRef(false);

  const boardRef = useRef(null);
  const cg = useRef(null);
  const historyContainerRef = useRef(null);
  const sidebarRef = useRef(null);
  const [models, setModels] = useState([]);

  useEffect(() => {
    fetch('http://127.0.0.1:3001/api/models')
      .then(async res => {
        const contentType = res.headers.get("content-type");
        if (!res.ok || !contentType || !contentType.includes("application/json")) {
          throw new TypeError("Oops, we didn't get JSON from the server!");
        }
        return res.json();
      })
      .then(data => {
        setModels(data);
        if (data.includes('qwen2.5-coder:32b')) setSelectedModel('qwen2.5-coder:32b');
        else if (data.includes('qwen2.5:14b')) setSelectedModel('qwen2.5:14b');
        else if (data.length > 0) setSelectedModel(data[0]);
      })
      .catch(console.error);
  }, []);

  const navigateHistory = useCallback((target, isRelative = false, isAlt = isAltBoardActive) => {
    if (!isAlt) {
      setAltVariation(null); // Clear variation when navigating main board
    }
    let newIndex;
    const gameInstance = isAlt ? altGameRef.current : gameRef.current;
    const hIdx = isAlt ? altHistoryIndex : historyIndex;
    const setHIdx = isAlt ? setAltHistoryIndex : setHistoryIndex;
    const setGState = isAlt ? _setAltGame : _setGame;

    const totalMoves = gameInstance.history().length;
    
    // If on alt board with variation, constrain navigation to variation range
    if (isAlt && altVariation) {
      const varStart = altVariation.branchPointIndex;
      const varEnd = varStart + altVariation.moves.length - 1;
      
      if (target === -Infinity) newIndex = varStart;
      else if (target === Infinity) newIndex = varEnd;
      else if (isRelative) newIndex = Math.max(varStart, Math.min(hIdx + target, varEnd));
      else newIndex = Math.max(varStart, Math.min(target, varEnd));
    } else {
      if (target === -Infinity) newIndex = -1;
      else if (target === Infinity) newIndex = totalMoves - 1;
      else if (isRelative) newIndex = Math.max(-1, Math.min(hIdx + target, totalMoves - 1));
      else newIndex = target;
    }

    const historyAtTarget = gameInstance.history({ verbose: true }).slice(0, newIndex + 1);
    const tempGame = new Chess();

    const fullH = gameInstance.history({verbose: true});
    const baseFen = fullH.length > 0 ? fullH[0].before : gameInstance.fen();
    tempGame.load(baseFen);

    for (const m of historyAtTarget) tempGame.move(m.san);

    setGState(tempGame);
    setHIdx(newIndex);
  }, [isAltBoardActive, altHistoryIndex, historyIndex, _setGame, _setAltGame, setHistoryIndex, setAltHistoryIndex, altVariation]);

  const [sidebarWidth, setSidebarWidth] = useState(1400);
  const [historyWidth, setHistoryWidth] = useState(220);

  const handleMouseMove = useCallback((e) => {
    if (isResizingH.current) {
        const newWidth = window.innerWidth - e.clientX;
        setSidebarWidth(Math.max(400, Math.min(newWidth, window.innerWidth * 0.6)));
    } else if (isResizingV.current) {
        const newWidth = window.innerWidth - e.clientX;
        setHistoryWidth(Math.max(200, Math.min(newWidth, 450)));
    }
  }, []);

  const stopResizing = useCallback(() => {
    isResizingH.current = false;
    isResizingV.current = false;
    document.body.style.cursor = 'default';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [handleMouseMove, stopResizing]);

  const startResizingH = useCallback(() => {
    isResizingH.current = true;
    document.body.style.cursor = 'col-resize';
  }, []);

  const startResizingV = useCallback(() => {
    isResizingV.current = true;
    document.body.style.cursor = 'col-resize';
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
      const tempGame = new Chess();
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
        for (const move of moves) {
          if (!move) continue;
          if (!tempGame.move(move)) throw new Error(`Invalid move: ${move}`);
        }
        gameRef.current = tempGame;
        fullGameHistoryRef.current = tempGame.history({ verbose: true });
        syncGame();
        navigateHistory(-1); 
      } else {
        let fen = pgnString.trim();
        if (fen.split(' ').length === 1) fen += ' w KQkq - 0 1';
        if (!tempGame.load(fen)) throw new Error("Invalid FEN");
        gameRef.current = tempGame;
        fullGameHistoryRef.current = [];
        syncGame();
        setHistoryIndex(-1);
      }
      setBatchAnalysisResults({});
      setAltVariation(null);
      setIsAltBoardActive(false);
      setAltHistoryIndex(-1);
      setShowImportModal(null);
      setFenInput('');
    } catch (e) { alert("Import Error: " + e.message); }
  }, [fetchAvatar, syncGame, navigateHistory]);

  const handleAnalyzeMove = useCallback(async (index, specificHistory) => {
    const activeHistory = specificHistory || historyRef.current;
    if (index < 0 || index >= activeHistory.length) return;
    
    const move = activeHistory[index];
    const isWhiteMove = index % 2 === 0;
    const moveColor = isWhiteMove ? 'white' : 'black';
    
    if (moveColor !== userColor) return;

    const targetFen = move.after;
    if (resultsRef.current[targetFen] && resultsRef.current[targetFen].analysis) return;

    const prevFen = move.before;
    const userMove = move.san;

    setIsLoading(true);
    try {
        const res = await fetch('http://127.0.0.1:3001/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                fen: prevFen, 
                model: selectedModel, 
                language: language,
                userMove: userMove,
                playerColor: userColor === 'white' ? 'w' : 'b'
            })
        });
        const data = await res.json();
        setBatchAnalysisResults(prev => ({ ...prev, [targetFen]: data }));
    } catch (e) { console.error(e); }
    finally { setIsLoading(false); }
  }, [selectedModel, language, userColor]);

  const currentFen = useMemo(() => (isAltBoardActive ? altGame.fen() : game.fen()), [isAltBoardActive, altGame, game]);

  const activeHistoryIndex = isAltBoardActive ? altHistoryIndex : historyIndex;

  // Always use main game FEN for analysis lookup so analysis stays visible on alt board
  const mainGameFen = game.fen();
  const currentAnalysis = useMemo(() => {
    return batchAnalysisResults[mainGameFen] || null;
  }, [mainGameFen, batchAnalysisResults]);

  const displayWinPercent = useMemo(() => {
    if (!currentAnalysis || currentAnalysis.score === undefined) return 50;
    const score = currentAnalysis.score;
    if (typeof score === 'string' && score.includes('#')) {
      return score.includes('-') ? 0 : 100;
    }
    return Math.round(centipawnsToWinProb(score));
  }, [currentAnalysis]);

  const onDrop = useCallback((from, to) => {
    const tempGame = new Chess();
    const fullH = gameRef.current.history({verbose: true});
    const baseFen = fullH.length > 0 ? fullH[0].before : gameRef.current.fen();
    tempGame.load(baseFen);

    const isAlt = isAltBoardActive;
    const gameInstance = isAlt ? altGameRef.current : gameRef.current;
    const hIdx = isAlt ? altHistoryIndex : historyIndex;

    const currentHistory = gameInstance.history({ verbose: true }).slice(0, hIdx + 1);
    for (const m of currentHistory) tempGame.move(m.san);

    const move = tempGame.move({ from, to, promotion: 'q' });
    if (move) {
      if (isAlt) {
        altGameRef.current = tempGame;
        _setAltGame(new Chess(tempGame.fen()));
        setAltHistoryIndex(tempGame.history().length - 1);
      } else {
        gameRef.current = tempGame;
        syncGame();
        const newIndex = tempGame.history().length - 1;
        setHistoryIndex(newIndex);
        handleAnalyzeMove(newIndex, tempGame.history({ verbose: true }));
      }
    }
  }, [isAltBoardActive, altHistoryIndex, historyIndex, syncGame, handleAnalyzeMove]);

  const onDropRef = useRef(null);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  useEffect(() => {
    if (boardRef.current && !cg.current) {
      cg.current = Chessground(boardRef.current, {
        fen: game.fen(),
        orientation: boardOrientation,
        movable: {
          free: false,
          color: 'both',
          dests: new Map()
        },
        animation: { enabled: true, duration: 250 },
        events: { move: (from, to) => onDropRef.current?.(from, to) }
      });
    }
  }, [game, boardOrientation]);

  useEffect(() => {
    if (cg.current) {
        const shapes = [];
        const fullHistory = fullGameHistoryRef.current;
        let moveIndex = -1;
        for (let i = 0; i < fullHistory.length; i++) {
          if (fullHistory[i].after === currentFen) {
            moveIndex = i;
            break;
          }
        }

        const analysisForCurrentPos = batchAnalysisResults[currentFen];
        if (analysisForCurrentPos && analysisForCurrentPos.uciBestMove) {
          const uci = analysisForCurrentPos.uciBestMove;
          if (uci.length >= 4) {
            const orig = uci.substring(0, 2);
            const dest = uci.substring(2, 4);
            shapes.push({ orig, dest, brush: 'green', modifiers: { lineWidth: 10 } });
          }
        }

        const playedMove = fullHistory[moveIndex];
        if (!isAltBoardActive && moveIndex >= 0 && playedMove && playedMove.from && playedMove.to) {
          shapes.push({ orig: playedMove.from, dest: playedMove.to, brush: 'yellow', modifiers: { lineWidth: 10 } });
        }

        // Show yellow arrow for the current move in the variation on the alt board
        if (isAltBoardActive && altVariation && altVariation.moves.length > 0) {
          // currentVariationIndex = how far into the variation we are on the alt board
          // altHistoryIndex is the absolute index in alt game history
          // branchPointIndex is where the variation starts in alt game history
          const currentVariationIndex = altHistoryIndex - (altVariation.branchPointIndex ?? 0);
          
          // Show only the CURRENT alt move as yellow arrow (not the full remaining variation)
          // The current move in the variation is at currentVariationIndex
          if (currentVariationIndex >= 0 && currentVariationIndex < altVariation.moves.length) {
            const uci = altVariation.moves[currentVariationIndex];
            if (uci.length >= 4) {
              const orig = uci.substring(0, 2);
              const dest = uci.substring(2, 4);
              shapes.push({
                orig,
                dest,
                brush: 'yellow',
                modifiers: { lineWidth: 10 }
              });
            }
          }
        }

        const gameInstance = isAltBoardActive ? altGame : game;
        const dests = new Map();
        const allSquares = [
          'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8',
          'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
          'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
          'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
          'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
          'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
          'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
          'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1'
        ];
        allSquares.forEach(s => {
          const ms = gameInstance.moves({ square: s, verbose: true });
          if (ms.length) dests.set(s, ms.map(m => m.to));
        });

        cg.current.set({
            fen: currentFen,
            orientation: boardOrientation,
            drawable: { shapes },
            movable: { dests, free: false, color: 'both' },
            lastMove: history.length > 0 && activeHistoryIndex >= 0 && !isAltBoardActive
                ? [history[activeHistoryIndex].from, history[activeHistoryIndex].to]
                : undefined
        });
    }
  }, [currentFen, boardOrientation, history, activeHistoryIndex, isAltBoardActive, batchAnalysisResults, game, altGame, altVariation, altHistoryIndex]);

  const accuracy = useMemo(() => {
    const calcAcc = (moves) => {
        const analyzed = moves.filter(m => batchAnalysisResults[m.after]);
        if (analyzed.length === 0) return 0;
        const sum = analyzed.reduce((acc, m) => {
            const res = batchAnalysisResults[m.after];
            if (!res || !res.classification) return acc + 100;
            const values = { best: 100, excellent: 95, good: 80, inaccuracy: 60, mistake: 30, blunder: 0 };
            return acc + (values[res.classification] ?? 100);
        }, 0);
        return Math.round(sum / analyzed.length);
    };
    
    return {
        white: calcAcc(history.filter((_, i) => i % 2 === 0)),
        black: calcAcc(history.filter((_, i) => i % 2 !== 0))
    };
  }, [batchAnalysisResults, history]);

  const whiteScoreStr = useMemo(() => {
    if (!currentAnalysis || currentAnalysis.score === undefined) return "0.0";
    const score = currentAnalysis.score;
    if (typeof score === 'string' && score.includes('#')) return score;
    const val = (score / 100).toFixed(1);
    return val > 0 ? `+${val}` : val;
  }, [currentAnalysis]);

  const blackScoreStr = useMemo(() => {
    if (!currentAnalysis || currentAnalysis.score === undefined) return "0.0";
    const score = currentAnalysis.score;
    if (typeof score === 'string' && score.includes('#')) {
      return score.startsWith('#') ? `-#${score.slice(1)}` : (score.startsWith('-#') ? `#${score.slice(2)}` : score);
    }
    const val = (-score / 100).toFixed(1);
    return val > 0 ? `+${val}` : val;
  }, [currentAnalysis]);

  const calculateEstimatedElo = useCallback((acc) => {
    if (!acc) return 400;
    return Math.round(400 + acc * 22);
  }, []);

  const handleFlip = useCallback(() => {
    setBoardOrientation(prev => prev === 'white' ? 'black' : 'white');
  }, []);

  const handleImport = useCallback(() => {
    handleImportPgn(tempInput);
  }, [handleImportPgn, tempInput]);

  const onVariationMoveClick = useCallback((moveSan, variationSequence, moveIndex, startIndex) => {
    const sequence = variationSequence.split(',');
    
    // Use separate game instances to avoid mutation issues
    const uciGame = new Chess();
    const tempGame = new Chess();
    const mainHistory = gameRef.current.history({ verbose: true });
    const baseHistory = mainHistory.slice(0, startIndex);
    
    const initialFen = fullGameHistoryRef.current.length > 0 ? fullGameHistoryRef.current[0].before : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    
    // Set up both games with base position
    uciGame.load(initialFen);
    tempGame.load(initialFen);
    for (const m of baseHistory) {
      uciGame.move(m.san);
      tempGame.move(m.san);
    }
    
    // Convert variation moves to UCI for arrow rendering (using separate game)
    const variationUciMoves = [];
    for (const m of sequence) {
      try {
        const moved = uciGame.move(m);
        if (moved) variationUciMoves.push(moved.from + moved.to + (moved.promotion || ''));
      } catch (e) {
        console.warn("Could not convert variation move to UCI", m, e);
        break;
      }
    }
    
    // Apply ALL variation moves to alt game so user can navigate full variation
    for (const m of sequence) {
      try {
        tempGame.move(m);
      } catch (e) {
        console.warn("Could not apply variation move", m, e);
        break;
      }
    }
    
    // Branch point is where the variation starts in alt game history
    const branchPointIndex = baseHistory.length;
    
    altGameRef.current = tempGame;
    _setAltGame(new Chess(tempGame.fen()));
    setAltHistoryIndex(startIndex + moveIndex); // Start at clicked move
    setAltVariation({ moves: variationUciMoves, branchPointIndex });
    setIsAltBoardActive(true);
  }, []);

  const handleAnalyzeAllPgn = useCallback(async () => {
    if (isLoading || history.length === 0) return;
    setIsLoading(true);
    setAnalysisProgress(0);

    try {
      // Step 1: Get engine evaluations for ALL positions in the game
      const allFens = [
        fullGameHistoryRef.current.length > 0 ? fullGameHistoryRef.current[0].before : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        ...history.map(m => m.after)
      ];

      const evalRes = await fetch('http://127.0.0.1:3001/api/evaluate-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fens: allFens })
      });
      
      if (!evalRes.ok) throw new Error("Failed to fetch evaluations");
      const engineResults = await evalRes.json();
      
      // Map results by FEN for easy lookup
      const evalMap = {};
      engineResults.forEach(res => {
        evalMap[res.fen] = res;
      });

      // Step 2: Classify each move and filter those that need AI analysis
      const currentResults = {};
      const movesToAI = [];

      history.forEach((move, i) => {
        const prevFen = i === 0 
          ? (fullGameHistoryRef.current.length > 0 ? fullGameHistoryRef.current[0].before : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
          : history[i-1].after;
        
        const targetFen = move.after;
        const prevEval = evalMap[prevFen];
        const currentEval = evalMap[targetFen];

        if (prevEval && currentEval) {
          const isWhiteMove = i % 2 === 0;
          const bestScore = prevEval.score; // Stockfish score for side to move
          // currentEval.score is for the NEXT player, so negate it for moving player's perspective
          const actualScore = -currentEval.score; 
          
          const classification = getClassification(bestScore, actualScore, Math.floor(i/2) + 1, move.san);
          const cpLoss = Math.max(0, bestScore - actualScore);

          currentResults[targetFen] = {
            score: isWhiteMove ? actualScore : -actualScore, // Store relative to white for display
            classification,
            bestmove: prevEval.bestmove,
            uciBestMove: prevEval.bestmove,
            analysis: '...',
            cpLoss
          };

          // Filter: Only AI analyze user moves that are inaccuracy/mistake/blunder
          const moveColor = isWhiteMove ? 'white' : 'black';
          const isBadMove = ['inaccuracy', 'mistake', 'blunder'].includes(classification);
          
          if (moveColor === userColor && isBadMove) {
            movesToAI.push({
              index: i,
              fen: prevFen,
              userMove: move.san,
              classification,
              movingPlayer: moveColor
            });
          }
        }
      });

      setBatchAnalysisResults(currentResults);

      if (movesToAI.length === 0) {
        setIsLoading(false);
        setAnalysisProgress(100);
        return;
      }

      // Step 3: Stream AI analysis for the filtered bad moves
      const fensParam = JSON.stringify(movesToAI);
      const url = `http://127.0.0.1:3001/api/analyze-stream?fens=${encodeURIComponent(fensParam)}&model=${selectedModel}&language=${language}`;

      const eventSource = new EventSource(url);

      eventSource.onmessage = (event) => {
        if (event.data === '[DONE]') {
          eventSource.close();
          setIsLoading(false);
          setAnalysisProgress(100);
          return;
        }

        try {
          const data = JSON.parse(event.data);
          if (data.index !== undefined && data.result) {
            const targetFen = history[data.index].after;
            setBatchAnalysisResults(prev => ({
              ...prev,
              [targetFen]: {
                ...prev[targetFen],
                analysis: data.result.analysis,
                bestmove: data.result.bestmove,
                classification: data.result.classification || prev[targetFen].classification
              }
            }));
            
            const progress = Math.round(((movesToAI.findIndex(m => m.index === data.index) + 1) / movesToAI.length) * 100);
            setAnalysisProgress(progress);
          }
        } catch (e) {
          console.error("Error parsing SSE data", e);
        }
      };

      eventSource.onerror = (err) => {
        console.error("SSE Error", err);
        eventSource.close();
        setIsLoading(false);
      };

    } catch (err) {
      console.error("Analysis failed:", err);
      setIsLoading(false);
    }
  }, [history, isLoading, userColor, selectedModel, language, getClassification]);

  useEffect(() => {
    const handleGlobalClick = (e) => {
      if (!isAltBoardActive) return;
      const isAltBoardClick = e.target.closest('.alt-board-container');
      const isVariationClick = e.target.closest('.variation-wrapper') || e.target.closest('.clickable-move');
      if (!isAltBoardClick && !isVariationClick) {
        setIsAltBoardActive(false);
        setAltVariation(null);
      }
    };
    window.addEventListener('mousedown', handleGlobalClick);
    return () => window.removeEventListener('mousedown', handleGlobalClick);
  }, [isAltBoardActive]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') {
        navigateHistory(-1, true, isAltBoardActive);
      }
      if (e.key === 'ArrowRight') {
        navigateHistory(1, true, isAltBoardActive);
      }
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
  }, [isAltBoardActive, navigateHistory, handleImportPgn]);

  const handleCopyFen = useCallback(() => {
    navigator.clipboard.writeText(currentFen);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [currentFen]);

  const t = translations[language];

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
        userColor={userColor}
        setUserColor={setUserColor}
      />

      {isLoading && (
        <div className="h-1 w-full bg-slate-800 relative z-50">
          <div 
            className="h-full bg-violet-500 transition-all duration-300 ease-out"
            style={{ width: `${analysisProgress}%` }}
          />
        </div>
      )}

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
          <div className="w-10 flex flex-col border-r border-slate-800 z-10 relative h-full overflow-hidden">
              <div 
                  className={`w-full transition-all duration-500 ${boardOrientation === 'white' ? 'bg-slate-900' : 'bg-white'}`}
                  style={{ height: `${100 - displayWinPercent}%` }}
              />
              <div 
                  className={`w-full transition-all duration-500 ${boardOrientation === 'white' ? 'bg-white' : 'bg-slate-900'}`}
                  style={{ height: `${displayWinPercent}%` }}
              />
              <div className="absolute inset-0 flex flex-col justify-between py-2 text-[10px] font-black pointer-events-none">
                  <div className="text-center mix-blend-difference text-white">
                      {boardOrientation === 'white' ? blackScoreStr : whiteScoreStr}
                  </div>
                  <div className="text-center mix-blend-difference text-white">
                      {boardOrientation === 'white' ? whiteScoreStr : blackScoreStr}
                  </div>
              </div>
          </div>

          <div className="flex-grow flex flex-col items-center justify-center bg-[#0d1117] p-2 sm:p-4 overflow-hidden text-center max-h-full min-w-0">
            <div className="mb-2 w-full max-w-[min(75vh, 85vw, 850px)] flex items-center gap-2 shrink-0">
              {boardOrientation === 'white' ? (
                <>
                  <div className="w-6 h-6 sm:w-8 sm:h-8 bg-slate-700 rounded-lg flex items-center justify-center text-xs overflow-hidden shrink-0">
                    {playerNames.blackAvatar ? <img src={playerNames.blackAvatar} alt="avatar" /> : '?'}
                  </div>
                  <span className="truncate font-bold text-xs sm:text-sm text-slate-300">
                    {playerNames.black}
                    {playerNames.blackElo ? ` (${playerNames.blackElo})` : ''}
                  </span>
                </>
              ) : (
                <>
                  <div className="w-6 h-6 sm:w-8 sm:h-8 bg-slate-700 rounded-lg flex items-center justify-center text-xs overflow-hidden shrink-0">
                    {playerNames.whiteAvatar ? <img src={playerNames.whiteAvatar} alt="avatar" /> : '?'}
                  </div>
                  <span className="truncate font-bold text-xs sm:text-sm text-slate-300">
                    {playerNames.white}
                    {playerNames.whiteElo ? ` (${playerNames.whiteElo})` : ''}
                  </span>
                </>
              )}
            </div>

            <div className={`relative group shadow-2xl shadow-black p-2 bg-[#161b22] rounded-lg shrink min-h-0 alt-board-container transition-all duration-300 ${isAltBoardActive ? 'ring-4 ring-violet-500/50' : 'ring-1 ring-slate-800'}`}>
              <div ref={boardRef} style={{ width: 'min(75vh, 85vw, 850px)', height: 'min(75vh, 85vw, 850px)' }} />
            </div>

            <div className="mt-2 w-full max-w-[min(75vh, 85vw, 850px)] flex flex-col items-center gap-2 shrink-0">
              <div className="flex items-center justify-center gap-3">
                <div className="flex flex-col items-center">
                  <span className="text-[10px] text-slate-500 uppercase font-black mb-0.5">White</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] bg-slate-800 px-2 py-0.5 rounded text-violet-400 font-mono shrink-0 whitespace-nowrap">
                      {accuracy.white}%
                    </span>
                    <span className="text-[10px] bg-violet-600/20 px-1.5 py-0.5 rounded text-violet-300 font-bold shrink-0">
                      {calculateEstimatedElo(accuracy.white)}
                    </span>
                  </div>
                </div>

                <div className="h-8 w-px bg-slate-800 self-end mb-1" />

                <div className="flex flex-col items-center">
                  <span className="text-[10px] text-slate-500 uppercase font-black mb-0.5">Black</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] bg-slate-800 px-2 py-0.5 rounded text-emerald-400 font-mono shrink-0 whitespace-nowrap">
                      {accuracy.black}%
                    </span>
                    <span className="text-[10px] bg-emerald-600/20 px-1.5 py-0.5 rounded text-emerald-300 font-bold shrink-0">
                      {calculateEstimatedElo(accuracy.black)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-2 w-full max-w-[min(75vh, 85vw, 850px)] flex items-center gap-2 shrink-0">
              {boardOrientation === 'white' ? (
                <>
                  <div className="w-6 h-6 sm:w-8 sm:h-8 bg-slate-700 rounded-lg flex items-center justify-center text-xs overflow-hidden shrink-0">
                    {playerNames.whiteAvatar ? <img src={playerNames.whiteAvatar} alt="avatar" /> : '?'}
                  </div>
                  <span className="truncate font-bold text-xs sm:text-sm text-slate-300">
                    {playerNames.white}
                    {playerNames.whiteElo ? ` (${playerNames.whiteElo})` : ''}
                  </span>
                </>
              ) : (
                <>
                  <div className="w-6 h-6 sm:w-8 sm:h-8 bg-slate-700 rounded-lg flex items-center justify-center text-xs overflow-hidden shrink-0">
                    {playerNames.blackAvatar ? <img src={playerNames.blackAvatar} alt="avatar" /> : '?'}
                  </div>
                  <span className="truncate font-bold text-xs sm:text-sm text-slate-300">
                    {playerNames.black}
                    {playerNames.blackElo ? ` (${playerNames.blackElo})` : ''}
                  </span>
                </>
              )}
            </div>

            <div className="mt-2 flex gap-2 sm:gap-3 items-center shrink-0">
              <button onClick={() => navigateHistory(-Infinity, false, isAltBoardActive)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><SkipBack className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={() => navigateHistory(-1, true, isAltBoardActive)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={handleFlip} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><ArrowUpDown className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={() => navigateHistory(1, true, isAltBoardActive)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={() => navigateHistory(Infinity, false, isAltBoardActive)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><SkipForward className="w-4 h-4 sm:w-5 sm:h-5" /></button>
            </div>

          </div>

          <div onMouseDown={startResizingH} className="w-1.5 hover:bg-violet-600/50 bg-slate-800 transition-colors cursor-col-resize z-10" />

          <div 
            ref={sidebarRef}
            style={{ width: `${sidebarWidth}px` }}
            className="bg-[#161b22] border-l border-slate-800 flex flex-col h-full overflow-hidden flex-shrink-0"
          >
              <div className="flex flex-row h-full overflow-hidden">
                <div className="flex flex-col flex-grow min-w-0 h-full overflow-hidden">
                  <div className="flex-grow overflow-auto">
                    <AnalysisView 
                      currentAnalysis={currentAnalysis}
                      t={t}
                      markdownComponents={markdownComponents}
                      onVariationMoveClick={onVariationMoveClick}
                      activeHistoryIndex={activeHistoryIndex}
                      isAltBoardActive={isAltBoardActive}
                      onAnalyzeMove={handleAnalyzeMove}
                      isLoading={isLoading}
                    />
                  </div>
                </div>

                <div onMouseDown={startResizingV} className="w-1.5 hover:bg-violet-600/50 bg-slate-800 transition-colors cursor-col-resize z-10 h-full" />

                <div 
                    ref={historyContainerRef}
                    style={{ width: `${historyWidth}px` }}
                    className="flex-shrink-0 border-l border-slate-800 flex flex-col h-full bg-[#0d1117]/20"
                >
                    <MatchProgress
                        t={t}
                        history={history}
                        batchAnalysisResults={batchAnalysisResults}
                        historyIndex={historyIndex}
                        navigateHistory={(target) => navigateHistory(target, false, false)}
                        historyContainerRef={historyContainerRef}
                    />
                </div>
              </div>
          </div>

        </div>
      </main>
    </div>
  );
}

export default App;
