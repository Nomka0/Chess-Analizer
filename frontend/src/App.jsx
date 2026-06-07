import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import ReactMarkdown from 'react-markdown';
import { 
  ArrowUpDown, Copy, Check, Sparkles, Activity, Award, ChevronLeft, ChevronRight, SkipBack, SkipForward, Plus, Upload, X, Languages
} from 'lucide-react';

const markdownComponents = {
  h1: ({...props}) => <h1 className="text-lg font-black text-violet-400 mt-4 mb-2 border-b border-slate-800 pb-1 uppercase tracking-wider" {...props} />,
  h2: ({...props}) => <h2 className="text-base font-bold text-violet-300 mt-3 mb-1.5" {...props} />,
  p: ({...props}) => <p className="text-slate-300 text-xs leading-relaxed mb-2 font-sans" {...props} />,
  strong: ({...props}) => <strong className="font-semibold text-white" {...props} />,
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
    pgnPlaceholder: "Paste your PGN here...",
    serverActive: "Server Active"
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
    matchProgress: "Progreso de la Partida",
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
    pgnPlaceholder: "Pega tu PGN aquí...",
    serverActive: "Servidor Activo"
  }
};

function classifyMove(score, prevScore) {
    if (score === null || prevScore === null) return 'good';
    const diff = score - prevScore;
    if (diff > -30) return 'best';
    if (diff > -80) return 'excellent';
    if (diff > -150) return 'good';
    if (diff > -300) return 'inaccuracy';
    if (diff > -600) return 'mistake';
    return 'blunder';
}

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
  const [language, setLanguage] = useState('es'); // Language toggle state
  
  // UI & API STATE
  const [isLoading, setIsLoading] = useState(false);
  const [batchAnalysisResults, setBatchAnalysisResults] = useState({});
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [copied, setCopied] = useState(false);
  const [showImportModal, setShowImportModal] = useState(null); // 'fen' or 'pgn'
  const [tempInput, setFenInput] = useState('');
  
  const [sidebarWidth, setSidebarWidth] = useState(480);
  const [moveListHeight, setMoveListHeight] = useState(300);
  const isResizingH = useRef(false);
  const isResizingV = useRef(false);

  const boardRef = useRef(null);
  const cg = useRef(null);
  const historyContainerRef = useRef(null);
  const sidebarRef = useRef(null);
  
  const t = translations[language];
  const currentFen = game.fen();
  const currentAnalysis = useMemo(() => batchAnalysisResults[currentFen] || null, [currentFen, batchAnalysisResults]);
  const evalScore = currentAnalysis?.score || 0;
  
  const whiteScoreStr = (evalScore / 100).toFixed(1);
  const blackScoreStr = (-evalScore / 100).toFixed(1);
  const winPercent = Math.max(5, Math.min(95, 50 + ((boardOrientation === 'white' ? evalScore : -evalScore) / 20))); 

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
      console.log('Fetching avatar for:', username);
      const response = await fetch(`https://api.chess.com/pub/player/${username}`);
      if (!response.ok) {
        console.log('Avatar fetch failed for:', username, response.status);
        return null;
      }
      const data = await response.json();
      console.log('Avatar data for:', username, data);
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
        if (newWidth > 300 && newWidth < 800) setSidebarWidth(newWidth);
    }
    if (isResizingV.current) {
        const sidebarRect = sidebarRef.current?.getBoundingClientRect();
        if (sidebarRect) {
            const newHeight = e.clientY - sidebarRect.top;
            if (newHeight > 100 && newHeight < window.innerHeight - 200) setMoveListHeight(newHeight);
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
    document.body.style.cursor = 'row-resize';
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
        positions.push({ fen: tempGame.fen() });
    }

    const CHUNK_SIZE = 10;
    const currentResults = {};
    let lastScore = 0;

    for (let i = 0; i < positions.length; i += CHUNK_SIZE) {
        const chunk = positions.slice(i, i + CHUNK_SIZE);
        try {
            const evals = await (await fetch('http://localhost:3000/api/evaluate-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fens: chunk.map(p => p.fen) })
            })).json();

            for (const ev of evals) {
                const classification = classifyMove(ev.score, lastScore);
                currentResults[ev.fen] = { ...ev, classification };
                
                if (['inaccuracy', 'mistake', 'blunder'].includes(classification) || i === 0) {
                    const aiRes = await (await fetch('http://localhost:3000/api/analyze', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fen: ev.fen, model: selectedModel, language })
                    })).json();
                    currentResults[ev.fen].analysis = aiRes.analysis;
                }
                lastScore = ev.score || 0;
                setBatchAnalysisResults({ ...currentResults });
            }
        } catch (e) { console.error(e); }
    }
    setIsLoading(false);
  }

  return (
    <div className="h-screen bg-[#0b0f19] text-white flex flex-col font-sans overflow-hidden">
      
      {/* HEADER */}
      <header className="flex justify-between items-center px-6 py-3 border-b border-slate-800 bg-[#161b22] z-20 shadow-xl relative">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-violet-400" />
            <h1 className="text-sm font-black tracking-widest uppercase text-slate-200">{t.title}</h1>
          </div>
          
          <div className="flex gap-2">
            <button onClick={() => setShowImportModal('fen')} className="bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition flex items-center gap-2">
                <Plus className="w-3.5 h-3.5" /> FEN
            </button>
            <button onClick={() => setShowImportModal('pgn')} className="bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition flex items-center gap-2">
                <Upload className="w-3.5 h-3.5" /> PGN
            </button>
            <button onClick={handleCopyFen} className="bg-slate-800 hover:bg-slate-700 p-1.5 rounded transition" title={t.copyFen}>
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
            </button>
          </div>
        </div>

        <div className="flex gap-4 items-center">
            <button 
                onClick={() => setLanguage(language === 'en' ? 'es' : 'en')} 
                className="bg-slate-800 hover:bg-slate-700 p-2 rounded transition flex items-center gap-2 text-[10px] font-bold uppercase"
            >
                <Languages className="w-4 h-4" />
                {language.toUpperCase()}
            </button>
            <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:border-violet-500">
                <option value="">{t.defaultModel}</option>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button onClick={handleAnalyzeAllPgn} disabled={isLoading} className="bg-violet-600 hover:bg-violet-500 px-4 py-1.5 rounded text-xs font-bold transition disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-violet-900/20">
                {isLoading ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {isLoading ? t.analyzing.toUpperCase() : t.analyzeFull.toUpperCase()}
            </button>
        </div>
      </header>
      
      {/* IMPORT MODAL */}
      {showImportModal && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-[#161b22] border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl p-6">
                  <div className="flex justify-between items-center mb-4">
                      <h2 className="text-sm font-black uppercase tracking-widest text-violet-400">Import {showImportModal.toUpperCase()}</h2>
                      <button onClick={() => setShowImportModal(null)}><X className="w-5 h-5 text-slate-500" /></button>
                  </div>
                  <textarea 
                    autoFocus
                    className="w-full h-40 bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-300 focus:outline-none focus:border-violet-500 mb-6"
                    placeholder={showImportModal === 'fen' ? t.fenPlaceholder : t.pgnPlaceholder}
                    value={tempInput}
                    onChange={(e) => setFenInput(e.target.value)}
                  />
                  <button onClick={handleImport} className="w-full bg-violet-600 hover:bg-violet-500 py-3 rounded-xl font-bold text-sm transition">
                      {t.loadData}
                  </button>
              </div>
          </div>
      )}

      <main className="flex-grow relative h-0">
        <div className="absolute inset-0 flex overflow-hidden">
        {/* EVAL BAR */}
        <div className={`w-10 flex flex-col border-r border-slate-800 z-10 justify-end ${boardOrientation === 'white' ? 'bg-slate-900' : 'bg-white'}`}>
            <div
                className={`w-full transition-all duration-500 ${boardOrientation === 'white' ? 'bg-white' : 'bg-slate-900'}`}
                style={{ height: `${winPercent}%` }}
            />
            <div className="absolute top-0 w-full py-2 flex flex-col items-center text-[9px] font-black pointer-events-none mix-blend-difference">
                <span className="text-white">
                    {boardOrientation === 'white' ? blackScoreStr : (evalScore > 0 ? `+${whiteScoreStr}` : whiteScoreStr)}
                </span>
            </div>
            <div className="absolute bottom-0 w-full py-2 flex flex-col items-center text-[9px] font-black pointer-events-none mix-blend-difference">
                <span className="text-white">
                    {boardOrientation === 'white' ? (evalScore > 0 ? `+${whiteScoreStr}` : whiteScoreStr) : blackScoreStr}
                </span>
            </div>
        </div>

        <div className="flex-grow flex flex-col items-center justify-center bg-[#0d1117] p-2 sm:p-4 overflow-hidden text-center max-h-full">
          <div className="mb-2 font-bold text-xs sm:text-sm text-slate-300 w-full max-w-[min(50vh, 50vw)] text-left flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 sm:w-8 sm:h-8 bg-slate-700 rounded-lg flex items-center justify-center text-xs overflow-hidden shrink-0">
              {boardOrientation === 'white' ? (playerNames.blackAvatar ? <img src={playerNames.blackAvatar} alt="avatar" /> : '?') : (playerNames.whiteAvatar ? <img src={playerNames.whiteAvatar} alt="avatar" /> : '?')}
            </div>
            <span className="truncate">
              {boardOrientation === 'white' ? playerNames.black : playerNames.white}
              {boardOrientation === 'white' ? (playerNames.blackElo ? ` (${playerNames.blackElo})` : '') : (playerNames.whiteElo ? ` (${playerNames.whiteElo})` : '')}
            </span>
          </div>
          <div className="relative group shadow-2xl shadow-black p-2 bg-[#161b22] rounded-lg shrink min-h-0">
            <div ref={boardRef} style={{ width: 'min(50vh, 50vw)', height: 'min(50vh, 50vw)' }} />
          </div>
          <div className="mt-2 font-bold text-xs sm:text-sm text-slate-300 w-full max-w-[min(50vh, 50vw)] text-left flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 sm:w-8 sm:h-8 bg-slate-700 rounded-lg flex items-center justify-center text-xs overflow-hidden shrink-0">
              {boardOrientation === 'white' ? (playerNames.whiteAvatar ? <img src={playerNames.whiteAvatar} alt="avatar" /> : '?') : (playerNames.blackAvatar ? <img src={playerNames.blackAvatar} alt="avatar" /> : '?')}
            </div>
            <span className="truncate">
              {boardOrientation === 'white' ? playerNames.white : playerNames.black}
              {boardOrientation === 'white' ? (playerNames.whiteElo ? ` (${playerNames.whiteElo})` : '') : (playerNames.blackElo ? ` (${playerNames.blackElo})` : '')}
            </span>
          </div>
          <div className="mt-4 sm:mt-8 flex gap-2 sm:gap-3 items-center shrink-0">
            <button onClick={() => navigateHistory(-Infinity)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><SkipBack className="w-4 h-4 sm:w-5 sm:h-5" /></button>
            <button onClick={() => navigateHistory(-1)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" /></button>
            <button onClick={handleFlip} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><ArrowUpDown className="w-4 h-4 sm:w-5 sm:h-5" /></button>
            <button onClick={() => navigateHistory(1)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" /></button>
            <button onClick={() => navigateHistory(Infinity)} className="bg-slate-800 hover:bg-slate-700 p-2 sm:p-3 rounded-lg transition"><SkipForward className="w-4 h-4 sm:w-5 sm:h-5" /></button>
          </div>
          <div className="mt-2 sm:mt-4 opacity-50 flex items-center gap-2 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest shrink-0">
            <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-emerald-500"></div>
            {t.serverActive}
          </div>
        </div>
        <div onMouseDown={startResizingH} className="w-1.5 hover:bg-violet-600/50 bg-slate-800 transition-colors cursor-col-resize z-10" />

        <div ref={sidebarRef} style={{ width: `${sidebarWidth}px` }} className="bg-[#161b22] border-l border-slate-800 flex flex-col shrink-0">
            <div style={{ height: `${moveListHeight}px` }} className="border-b border-slate-800 flex flex-col p-5 overflow-hidden shrink-0">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">{t.matchProgress}</h2>
                </div>
                <div ref={historyContainerRef} className="flex-grow overflow-y-auto pr-2 custom-scrollbar">

                    <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
                        {history.map((m, i) => {
                            const result = batchAnalysisResults[m.after];
                            const classification = result?.classification || 'good';
                            const classColor = {
                                best: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-400',
                                excellent: 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300',
                                good: 'border-slate-700 bg-slate-800/50 text-slate-400',
                                inaccuracy: 'border-yellow-500/30 bg-yellow-500/5 text-yellow-300',
                                mistake: 'border-orange-500/30 bg-orange-500/5 text-orange-400',
                                blunder: 'border-rose-500/40 bg-rose-500/5 text-rose-400'
                            }[classification];
                            return (
                                <div key={i} onClick={() => navigateHistory(i - historyIndex)} className={`px-3 py-2 border rounded cursor-pointer transition-all ${i === historyIndex ? 'ring-2 ring-violet-500 border-violet-500 bg-violet-500/5 scale-[1.02] z-10 shadow-lg shadow-violet-900/20' : 'hover:border-slate-500'} ${classColor}`}>
                                    <span className="opacity-30 mr-2 text-[9px]">{Math.floor(i/2)+1}{i % 2 === 0 ? '.' : '...'}</span>
                                    <span className="font-black text-xs uppercase">{m.san}</span>
                                    {result && <span className="float-right text-[8px] opacity-50">{t[classification]}</span>}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
            <div onMouseDown={startResizingV} className="h-1.5 hover:bg-violet-600/50 bg-slate-800 transition-colors cursor-row-resize z-10" />
            <div className="flex-grow flex flex-col overflow-hidden bg-[#0d1117]/30">
                <div className="flex-grow overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    {currentAnalysis ? (
                        <div className="animate-fade-in pb-12">
                             <div className="flex items-center justify-between mb-8 border-b border-slate-800/50 pb-5">
                                <span className={`px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-tighter shadow-sm ${
                                    {
                                        best: 'bg-emerald-500 text-white',
                                        excellent: 'bg-emerald-400 text-black',
                                        good: 'bg-slate-700 text-white',
                                        inaccuracy: 'bg-yellow-500 text-black',
                                        mistake: 'bg-orange-500 text-white',
                                        blunder: 'bg-rose-600 text-white'
                                    }[currentAnalysis.classification || 'good']
                                }`}>
                                    {t[currentAnalysis.classification || 'good']}
                                </span>
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest">{t.suggested}</span>
                                    <span className="text-lg font-black font-mono text-violet-400 leading-none mt-1">{currentAnalysis.bestmove}</span>
                                </div>
                            </div>
                            <div className="prose-slate prose-invert max-w-none">
                                <ReactMarkdown components={markdownComponents}>{currentAnalysis.analysis}</ReactMarkdown>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center opacity-20 px-10 grayscale">
                            <Sparkles className="w-16 h-12 mb-6 text-indigo-400" />
                            <p className="text-[11px] font-black uppercase tracking-[0.2em] leading-relaxed">{t.intelligenceReady} <br/> {t.loadMatch}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
        </div>
      </main>
    </div>
  );
}

export default App;
