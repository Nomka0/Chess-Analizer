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
import { cleanChessSymbolsOnly } from './utils';

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
    noAnalysis: "Sin análisis para esta posición.",
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
    pastePgn: "Pega el PGN aquí...",
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
  const [previewGame, setPreviewGame] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyIndexRef = useRef(-1);
  useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);
  
  const [altHistoryIndex, setAltHistoryIndex] = useState(-1);
  const altHistoryIndexRef = useRef(-1);
  useEffect(() => { altHistoryIndexRef.current = altHistoryIndex; }, [altHistoryIndex]);
  const [boardOrientation, setBoardOrientation] = useState('white');
  const [playerNames, setPlayerNames] = useState({ 
    white: 'White', black: 'Black', 
    whiteElo: '', blackElo: '',
    whiteAvatar: null, blackAvatar: null 
  });
  const [language, setLanguage] = useState('es'); 
  
  const [accuracy, setAccuracy] = useState({ white: 0, black: 0 });
  const [userColor, setUserColor] = useState('white'); // 'white' or 'black'
  const [isLoading, setIsLoading] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [batchAnalysisResults, setBatchAnalysisResults] = useState({});
  const [models, setModels] = useState([]);

  const historyRef = useRef([]);
  const resultsRef = useRef({});

  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { resultsRef.current = batchAnalysisResults; }, [batchAnalysisResults]);

  const syncGame = useCallback(() => {
    _setGame(new Chess(gameRef.current.fen()));
    setHistory(gameRef.current.history({ verbose: true }));
  }, []);


  const toggleBoard = useCallback(() => {
      setIsAltBoardActive(prev => !prev);
  }, []);

  const centipawnsToWinProb = (cp) => 1 / (1 + Math.pow(10, -cp / 400));
  
  const getClassification = (impact, cpLoss, moveNumber, san) => {
      if (moveNumber === 1 && (san === 'e4' || san === 'd4')) {
          return 'excellent';
      }
      if (cpLoss < 30) {
          return impact < 1.5 ? 'best' : 'excellent';
      }
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
  
  const [sidebarWidth, setSidebarWidth] = useState(950);
  const [moveListWidth, setMoveListWidth] = useState(200);
  const [altVariation, setAltVariation] = useState(null); // { moves: uci[], startFen: string }
  const isResizingH = useRef(false);
  const isResizingV = useRef(false);

  const boardRef = useRef(null);
  const cg = useRef(null);
  const historyContainerRef = useRef(null);
  const sidebarRef = useRef(null);
  
  const t = translations[language];
  const activeGame = isAltBoardActive ? altGame : game;
  const currentFen = previewGame ? previewGame.fen() : activeGame.fen();
  
  // Derive analysis from the main game's state (using the 'game' state variable for reactivity)
  const currentMainFen = game.fen();

  const activeHistoryIndex = isAltBoardActive ? altHistoryIndex : historyIndex;
  
  const currentAnalysis = useMemo(() => {
      return batchAnalysisResults[currentMainFen] || null;
  }, [currentMainFen, batchAnalysisResults]);

  const evalScore = currentAnalysis?.score || 0;
  
  const whiteScoreStr = (evalScore / 100).toFixed(1);
  const blackScoreStr = (-evalScore / 100).toFixed(1);
  
  const winPercent = useMemo(() => {
    return Math.max(5, Math.min(95, centipawnsToWinProb(evalScore) * 100));
  }, [evalScore]);

  useEffect(() => {
    fetch('http://127.0.0.1:3000/api/models')
      .then(async res => {
        const contentType = res.headers.get("content-type");
        if (!res.ok || !contentType || !contentType.includes("application/json")) {
          throw new TypeError("Oops, we didn't get JSON from the server!");
        }
        return res.json();
      })
      .then(data => {
        setModels(data);
        if (data.includes('qwen2.5:14b')) setSelectedModel('qwen2.5:14b');
        else if (data.length > 0) setSelectedModel(data[0]);
      })
      .catch(console.error);
  }, []);

  const navigateHistory = useCallback((target, isRelative = false, isAlt = isAltBoardActive) => {
    setPreviewGame(null);
    if (!isAlt) {
      setAltVariation(null); // Clear variation when navigating main board
    }
    let newIndex;
    const gameInstance = isAlt ? altGameRef.current : gameRef.current;
    const hIdx = isAlt ? altHistoryIndex : historyIndex;
    const setHIdx = isAlt ? setAltHistoryIndex : setHistoryIndex;
    const setGState = isAlt ? _setAltGame : _setGame;

    const totalMoves = gameInstance.history().length;
    if (target === -Infinity) newIndex = -1;
    else if (target === Infinity) newIndex = totalMoves - 1;
    else if (isRelative) newIndex = Math.max(-1, Math.min(hIdx + target, totalMoves - 1));
    else newIndex = target;

    const historyAtTarget = gameInstance.history({ verbose: true }).slice(0, newIndex + 1);
    const tempGame = new Chess();

    // Reset to base position
    const fullH = gameInstance.history({verbose: true});
    const baseFen = fullH.length > 0 ? fullH[0].before : gameInstance.fen();
    tempGame.load(baseFen);

    for (const m of historyAtTarget) tempGame.move(m.san);

    setGState(tempGame);
    setHIdx(newIndex);
  }, [isAltBoardActive, altHistoryIndex, historyIndex]);

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

  const stopResizing = useCallback(function stopResizing() {
    isResizingH.current = false;
    isResizingV.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'default';
  }, [handleMouseMove]);

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
        syncGame();
        navigateHistory(-1); 
      } else {
        let fen = pgnString.trim();
        if (fen.split(' ').length === 1) fen += ' w KQkq - 0 1';
        if (!tempGame.load(fen)) throw new Error("Invalid FEN");
        gameRef.current = tempGame;
        syncGame();
        setHistoryIndex(-1);
      }
      setBatchAnalysisResults({});
      setAccuracy({ white: 0, black: 0 });
      setAltVariation(null); // Clear variation on new game
      setShowImportModal(null);
      setFenInput('');
    } catch (e) { alert("Import Error: " + e.message); }
  }, [fetchAvatar, syncGame, navigateHistory]);
  const handleAnalyzeMove = useCallback(async (index, specificHistory) => {
    const activeHistory = specificHistory || historyRef.current;
    if (index < 0 || index >= activeHistory.length) return;
    
    // Check if it's the user's turn to analyze
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
        const res = await fetch('http://127.0.0.1:3000/api/analyze', {
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

  const onDrop = useCallback((from, to) => {
    setPreviewGame(null);
    const tempGame = new Chess();
    const fullH = gameRef.current.history({verbose: true});
    const baseFen = fullH.length > 0 ? fullH[0].before : gameRef.current.fen();
    tempGame.load(baseFen);
    
    // If we're on the main board, apply moves up to historyIndex
    // If we're on the alt board, we probably shouldn't allow dropping or handle it differently.
    // For now, let's assume we drop on the board that is currently active.
    
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
        fen: currentFen,
        orientation: boardOrientation,
        movable: { free: false },
        animation: { enabled: true, duration: 250 },
        events: { move: (from, to) => onDropRef.current?.(from, to) }
      });
    }
    return () => {
      if (cg.current) {
        cg.current.destroy();
        cg.current = null;
      }
    };
  }, [boardOrientation, currentFen]); // Re-sync if orientation or FEN changes

  useEffect(() => {
    if (cg.current) {
      const shapes = [];
      
      // Determine the user's current selected move if it exists
      const activeGameInstance = isAltBoardActive ? altGameRef.current : gameRef.current;
      const currentHistory = activeGameInstance.history({ verbose: true });
      const activeIndex = isAltBoardActive ? altHistoryIndexRef.current : historyIndexRef.current;
      
      let userMove = null;
      if (activeIndex >= 0 && activeIndex < currentHistory.length) {
        userMove = currentHistory[activeIndex];
      }

      // Stockfish's best move (always green)
      if (currentAnalysis && currentAnalysis.uciBestMove) {
        const uci = currentAnalysis.uciBestMove;
        if (uci.length >= 4) {
          const orig = uci.substring(0, 2);
          const dest = uci.substring(2, 4);
          
          // Add green arrow for Stockfish's suggestion
          shapes.push({
            orig,
            dest,
            brush: 'green',
            modifiers: { lineWidth: 10 }
          });
          
          // Add red arrow for user's move ONLY when it is a blunder or mistake
          const isBadMove = currentAnalysis.classification === 'blunder' || currentAnalysis.classification === 'mistake';
          if (userMove && isBadMove) {
            const userOrig = userMove.from;
            const userDest = userMove.to;
            shapes.push({
              orig: userOrig,
              dest: userDest,
              brush: 'red',
              modifiers: { lineWidth: 10 }
            });
          }
        }
      }

      // If alt board is active, show yellow arrows for alternative sequences
      if (isAltBoardActive) {
        // Priority 1: Show stored variation from user click
        if (altVariation && altVariation.moves.length > 0) {
          // currentVariationIndex = how far into the variation we are on the alt board
          // altHistoryIndex is the absolute index in alt game history
          // branchPointIndex is where the variation starts in alt game history
          const currentVariationIndex = altHistoryIndex - (altVariation.branchPointIndex ?? 0);
          
          // Render remaining variation moves as yellow arrows
          for (let i = Math.max(0, currentVariationIndex); i < altVariation.moves.length - 1; i++) {
            const uci = altVariation.moves[i];
            if (uci.length >= 4) {
              const orig = uci.substring(0, 2);
              const dest = uci.substring(2, 4);
              if (orig.length === 2 && dest.length === 2) {
                shapes.push({
                  orig,
                  dest,
                  brush: 'yellow',
                  modifiers: { lineWidth: 10, opacity: 0.7 }
                });
              }
            }
          }
        } 
        // Priority 2: Fallback to PV from current analysis (first move only)
        else if (currentAnalysis && currentAnalysis.pv) {
          const pvMoves = currentAnalysis.pv.split(' ');
          if (pvMoves.length >= 1) {
            const uci = pvMoves[0];
            if (uci.length >= 4) {
              const orig = uci.substring(0, 2);
              const dest = uci.substring(2, 4);
              if (orig.length === 2 && dest.length === 2) {
                shapes.push({
                  orig,
                  dest,
                  brush: 'yellow',
                  modifiers: { lineWidth: 10 }
                });
              }
            }
          }
        }
      }

      cg.current.set({ 
        fen: currentFen,
        drawable: { shapes },
        animation: { enabled: true, duration: 250 }
      });
    }
  }, [currentFen, currentAnalysis, isAltBoardActive, altHistoryIndex, historyIndex, altVariation]); // Re-run when FEN or Analysis (with UCI) changes

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
    setAnalysisProgress(0);
    
    const fullH = gameRef.current.history({verbose: true});
    const baseFen = fullH.length > 0 ? fullH[0].before : gameRef.current.fen();
    const tempGame = new Chess(baseFen);
    
    const positions = [{ fen: tempGame.fen() }];
    for (const move of history) {
        tempGame.move(move);
        positions.push({ fen: tempGame.fen(), san: move.san });
    }

    const allEvals = {};
    const CHUNK_SIZE = 10;
    const currentResults = {};

    currentResults[positions[0].fen] = { score: 0, classification: 'best', analysis: '', bestmove: '' };

    for (let i = 0; i < positions.length; i += CHUNK_SIZE) {
        const chunk = positions.slice(i, i + CHUNK_SIZE);
        try {
            const evals = await (await fetch('http://127.0.0.1:3000/api/evaluate-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fens: chunk.map(p => p.fen) })
            })).json();
            
            evals.forEach((ev, idx) => {
                const fen = chunk[idx].fen;
                allEvals[fen] = {
                    score: ev.score,
                    bestmove: ev.bestmove,
                    uciBestMove: ev.bestmove
                };
                
                if (i + idx > 0) {
                    const pos = chunk[idx];
                    const prevPos = positions[i + idx - 1];
                    const currentGame = new Chess(pos.fen);
                    const uiScore = currentGame.turn() === 'b' ? -(ev.score || 0) : (ev.score || 0);
                    
                    const suggestedMoveFromPrev = allEvals[prevPos.fen]?.bestmove || '...';
                    const uciBestMoveFromPrev = allEvals[prevPos.fen]?.uciBestMove;

                    currentResults[pos.fen] = {
                        score: uiScore,
                        classification: '...', 
                        analysis: 'Analizando con IA...',
                        bestmove: suggestedMoveFromPrev,
                        uciBestMove: uciBestMoveFromPrev
                    };
                }
            });
            setBatchAnalysisResults({ ...currentResults });
        } catch (e) { console.error(e); }
    }

    let wPerf = 0, bPerf = 0, wMoves = 0, bMoves = 0;

    const streamPayload = positions.slice(1).map((pos, idx) => {
        const prevPos = positions[idx];
        const prevGame = new Chess(prevPos.fen);
        const movingPlayer = prevGame.turn();

        const prevEval = allEvals[prevPos.fen];
        // Scores from the perspective of the moving player
        const bestScore = prevEval?.score || 0;
        const bestProb = centipawnsToWinProb(bestScore);
        let actualScore = allEvals[pos.fen]?.score || 0;
        // After the move, it's opponent's turn, so negate to get moving player's perspective
        actualScore = -actualScore;

        const actualProb = centipawnsToWinProb(actualScore);
        const impact = Math.max(0, bestProb - actualProb) * 100;
        // cpLoss from moving player's perspective: positive when position worsened
        const cpLoss = Math.max(0, bestScore - actualScore);
        const moveNumber = Math.ceil((idx + 1) / 2);
        const classification = getClassification(impact, cpLoss, moveNumber, pos.san);

        currentResults[pos.fen].classification = classification;

        return {
            fen: prevPos.fen,
            userMove: pos.san,
            classification,
            index: idx + 1,
            impact,
            movingPlayer,
            playerColor: userColor === 'white' ? 'w' : 'b'
        };
    });

    setBatchAnalysisResults({ ...currentResults });

    // RESTRICTED: Only analyze bad moves (inaccuracy, mistake, blunder)
    const errorClasses = ['inaccuracy', 'mistake', 'blunder'];
    
    // Filter streamPayload to ONLY include moves from userColor that are BAD moves
    const filteredByColor = streamPayload.filter(m => {
        const moveColor = m.movingPlayer === 'w' ? 'white' : 'black';
        return moveColor === userColor && errorClasses.includes(m.classification);
    });

    // If no bad moves, skip AI analysis entirely
    if (filteredByColor.length === 0) {
        setIsLoading(false);
        setAnalysisProgress(100);
        setAccuracy({ white: 0, black: 0 });
        return;
    }

    const criticalMoves = filteredByColor
        .sort((a, b) => b.impact - a.impact)
        .slice(0, 7);

    const filteredPayload = criticalMoves
        .sort((a, b) => a.index - b.index);

    const queryParams = new URLSearchParams({
        fens: JSON.stringify(filteredPayload),
        model: selectedModel,
        language,
        moveTime: 200
    });

    const eventSource = new EventSource(`http://127.0.0.1:3000/api/analyze-stream?${queryParams.toString()}`);

    eventSource.onmessage = (event) => {
        if (event.data === '[DONE]') {
            eventSource.close();
            setIsLoading(false);
            setAnalysisProgress(100);
            
            setAccuracy({ 
                white: wMoves ? (wPerf / wMoves).toFixed(1) : "0.0", 
                black: bMoves ? (bPerf / bMoves).toFixed(1) : "0.0" 
            });
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

            currentResults[pos.fen] = {
                ...currentResults[pos.fen],
                analysis: result.analysis,
                bestmove: result.bestmove
            };

            if (payload.movingPlayer === 'w') {
                wPerf += (100 - payload.impact);
                wMoves++;
            } else {
                bPerf += (100 - payload.impact);
                bMoves++;
            }

            setBatchAnalysisResults({ ...currentResults });
            setAnalysisProgress(Math.round((index / streamPayload.length) * 100));
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

  const onVariationMoveClick = useCallback((moveSan, variationSequence, moveIndex = -1, startIndex = -1) => {
    // 1. Force Alt Board to be active
    setIsAltBoardActive(true);

    // Get the currently viewed history index from the refs
    const hIndex = historyIndexRef.current;
    
    // 2. Determine the starting point for this variation.
    const currentIndex = startIndex >= 0 ? startIndex : hIndex;
    
    // 3. Create a new alt game instance based on the base position of the main game
    const fullHistory = gameRef.current.history({ verbose: true });
    const mainBaseFen = fullHistory.length > 0 ? fullHistory[0].before : gameRef.current.fen();
    const newAltGame = new Chess(mainBaseFen);

    // 4. Replay moves from the MAIN game UP TO the resolved base index
    const movesBefore = fullHistory.slice(0, currentIndex);
    
    // Ensure the newAltGame is loaded with the base FEN before replaying
    newAltGame.load(mainBaseFen);
    for (const m of movesBefore) {
        newAltGame.move(m.san);
    }

    // 5. Parse the variation sequence and apply ALL moves to the alt game
    // This allows the user to navigate the entire suggested continuation by keyboard.
    const cleanMoveSan = cleanChessSymbolsOnly(moveSan);
    const moves = variationSequence
        ? variationSequence.split(',').map(m => cleanChessSymbolsOnly(m.trim()))
        : [cleanMoveSan];

    const targetMoveIndex = moveIndex >= 0 ? moveIndex : 0;
    
    // Apply ALL moves in the variation so we can navigate them all
    const variationUciMoves = [];
    for (let i = 0; i < moves.length; i++) {
        if (moves[i]) {
            try {
                const moved = newAltGame.move(moves[i]);
                if (moved) variationUciMoves.push(moved.from + moved.to + (moved.promotion || ''));
            } catch {
                break;
            }
        }
    }

    // Store the variation for yellow arrow rendering (from the position where variation starts)
    const variationStartGame = new Chess(mainBaseFen);
    for (const m of movesBefore) {
        variationStartGame.move(m.san);
    }
    // Branch point is the number of moves in main game before the variation starts
    const branchPointIndex = movesBefore.length;
    setAltVariation({
        moves: variationUciMoves,
        startFen: variationStartGame.fen(),
        branchPointIndex
    });

    // 6. Save the FULL game to the ref
    altGameRef.current = newAltGame;

    // 7. Create the specific board state for the CLICKED move
    const clickedMoveGame = new Chess(mainBaseFen);
    for (const m of movesBefore) {
        clickedMoveGame.move(m.san);
    }
    for (let i = 0; i <= targetMoveIndex; i++) {
        if (moves[i]) {
            try {
                clickedMoveGame.move(moves[i]);
            } catch {
                break;
            }
        }
    }

    _setAltGame(clickedMoveGame); // Update state to trigger re-render
    
    // 8. Update alt history index to the clicked position
    const newAltIndex = movesBefore.length + targetMoveIndex; 
    setAltHistoryIndex(newAltIndex);

  }, [gameRef, setAltHistoryIndex, setIsAltBoardActive]);

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
          
          <div className="flex-grow flex flex-col items-center justify-center bg-[#0d1117] p-2 sm:p-4 overflow-hidden text-center max-h-full">
            
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

            <div className={`relative group shadow-2xl shadow-black p-2 bg-[#161b22] rounded-lg shrink min-h-0 alt-board-container transition-all duration-300 ${isAltBoardActive ? 'ring-4 ring-violet-500/50' : 'ring-1 ring-slate-800'}`}>
              <div ref={boardRef} style={{ width: 'min(70vh, 70vw)', height: 'min(70vh, 70vw)' }} />
            </div>

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

            <div className="mt-1.5 flex gap-2 sm:gap-3 items-center shrink-0">
              <button onClick={() => navigateHistory(-Infinity, false, isAltBoardActive)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><SkipBack className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={() => navigateHistory(-1, true, isAltBoardActive)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={handleFlip} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><ArrowUpDown className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={() => navigateHistory(1, true, isAltBoardActive)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              <button onClick={() => navigateHistory(Infinity, false, isAltBoardActive)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><SkipForward className="w-4 h-4 sm:w-5 sm:h-5" /></button>
            </div>

          </div>

          <div onMouseDown={startResizingH} className="w-1.5 hover:bg-violet-600/50 bg-slate-800 transition-colors cursor-col-resize z-10" />

          <div ref={sidebarRef} style={{ width: `${sidebarWidth}px` }} className="bg-[#161b22] border-l border-slate-800 flex flex-row shrink-0 h-full overflow-hidden">
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
              
              <div onMouseDown={startResizingV} className="w-1.5 hover:bg-violet-600/50 bg-slate-800 transition-colors cursor-col-resize z-10 h-full" />

              <div style={{ width: `${moveListWidth}px` }} className="border-l border-slate-800 flex flex-col shrink-0 h-full">
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
      </main>
    </div>
  );
}

export default App;
