import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import ReactMarkdown from 'react-markdown';
import { 
  RotateCcw, ArrowUpDown, Copy, Check, Sparkles, Activity, Award, ChevronLeft, ChevronRight, SkipBack, SkipForward, Plus, Upload, X
} from 'lucide-react';

const markdownComponents = {
  p: ({node, ...props}) => <p className="text-slate-300 text-xs leading-relaxed mb-2 font-sans" {...props} />,
  strong: ({node, ...props}) => <strong className="font-semibold text-white" {...props} />,
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
  const [game, setGame] = useState(new Chess());
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [boardOrientation, setBoardOrientation] = useState('white');
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
  
  const currentFen = game.fen();
  const currentAnalysis = useMemo(() => batchAnalysisResults[currentFen] || null, [currentFen, batchAnalysisResults]);
  
  // Win Ratio Bar calculation
  const rawEval = currentAnalysis?.score || 0;
  const whiteScoreStr = (rawEval / 100).toFixed(1);
  const blackScoreStr = (-rawEval / 100).toFixed(1);
  
  // Advantage for player at the bottom
  const bottomPlayerScore = boardOrientation === 'white' ? rawEval : -rawEval;
  const winPercent = Math.max(5, Math.min(95, 50 + (bottomPlayerScore / 20))); 

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

  const handleImportPgn = useCallback((pgnString) => {
    try {
      if (pgnString.includes('1.') || pgnString.includes('[')) {
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
    let newIndex = historyIndex;
    if (direction === -Infinity) newIndex = -1;
    else if (direction === Infinity) newIndex = history.length - 1;
    else newIndex = Math.max(-1, Math.min(historyIndex + direction, history.length - 1));
    
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
                        body: JSON.stringify({ fen: ev.fen, model: selectedModel })
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
      <header className="flex justify-between items-center px-6 py-3 border-b border-slate-800 bg-[#161b22] z-20 shadow-xl relative">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-violet-400" />
            <h1 className="text-sm font-black tracking-widest uppercase text-slate-200">Chess Analyzer</h1>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowImportModal('fen')} className="bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition flex items-center gap-2">
                <Plus className="w-3.5 h-3.5" /> FEN
            </button>
            <button onClick={() => setShowImportModal('pgn')} className="bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition flex items-center gap-2">
                <Upload className="w-3.5 h-3.5" /> PGN
            </button>
            <button onClick={handleCopyFen} className="bg-slate-800 hover:bg-slate-700 p-1.5 rounded transition" title="Copy FEN">
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
            </button>
          </div>
        </div>

        <div className="flex gap-4 items-center">
            <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs outline-none focus:border-violet-500">
                <option value="">Default Model</option>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button onClick={handleAnalyzeAllPgn} disabled={isLoading} className="bg-violet-600 hover:bg-violet-500 px-4 py-1.5 rounded text-xs font-bold transition disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-violet-900/20">
                {isLoading ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {isLoading ? 'ANALYZING...' : 'RUN FULL ANALYSIS'}
            </button>
        </div>
      </header>
      
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
                    placeholder={`Paste your ${showImportModal.toUpperCase()} here...`}
                    value={tempInput}
                    onChange={(e) => setFenInput(e.target.value)}
                  />
                  <button onClick={handleImport} className="w-full bg-violet-600 hover:bg-violet-500 py-3 rounded-xl font-bold text-sm transition">
                      Load Data
                  </button>
              </div>
          </div>
      )}

      <main className="flex-grow flex overflow-hidden relative">
        {/* EVAL BAR */}
        <div className={`w-10 flex flex-col border-r border-slate-800 relative z-10 justify-end ${boardOrientation === 'white' ? 'bg-slate-900' : 'bg-white'}`}>
            <div 
                className={`w-full transition-all duration-500 ${boardOrientation === 'white' ? 'bg-white' : 'bg-slate-900'}`} 
                style={{ height: `${winPercent}%` }} 
            />
            {/* Top Score Label */}
            <div className="absolute top-0 w-full py-2 flex flex-col items-center text-[9px] font-black pointer-events-none mix-blend-difference">
                <span className="text-white">
                    {boardOrientation === 'white' ? blackScoreStr : (rawEval > 0 ? `+${whiteScoreStr}` : whiteScoreStr)}
                </span>
            </div>
            {/* Bottom Score Label */}
            <div className="absolute bottom-0 w-full py-2 flex flex-col items-center text-[9px] font-black pointer-events-none mix-blend-difference">
                <span className="text-white">
                    {boardOrientation === 'white' ? (rawEval > 0 ? `+${whiteScoreStr}` : whiteScoreStr) : blackScoreStr}
                </span>
            </div>
        </div>

        <div className="flex-grow flex flex-col items-center justify-center bg-[#0d1117] p-8 overflow-hidden">
          <div className="relative group shadow-2xl shadow-black p-2 bg-[#161b22] rounded-lg">
            <div ref={boardRef} style={{ width: 'min(70vh, 70vw)', height: 'min(70vh, 70vw)' }} />
          </div>
          <div className="mt-8 flex gap-3">
            <button onClick={() => navigateHistory(-Infinity)} className="bg-slate-800 hover:bg-slate-700 p-3 rounded-lg transition"><SkipBack className="w-5 h-5" /></button>
            <button onClick={() => navigateHistory(-1)} className="bg-slate-800 hover:bg-slate-700 p-3 rounded-lg transition"><ChevronLeft className="w-5 h-5" /></button>
            <button onClick={handleFlip} className="bg-slate-800 hover:bg-slate-700 p-3 rounded-lg transition"><ArrowUpDown className="w-5 h-5" /></button>
            <button onClick={() => navigateHistory(1)} className="bg-slate-800 hover:bg-slate-700 p-3 rounded-lg transition"><ChevronRight className="w-5 h-5" /></button>
            <button onClick={() => navigateHistory(Infinity)} className="bg-slate-800 hover:bg-slate-700 p-3 rounded-lg transition"><SkipForward className="w-5 h-5" /></button>
          </div>
        </div>

        <div onMouseDown={startResizingH} className="w-1.5 hover:bg-violet-600/50 bg-slate-800 transition-colors cursor-col-resize z-10" />

        <div ref={sidebarRef} style={{ width: `${sidebarWidth}px` }} className="bg-[#161b22] border-l border-slate-800 flex flex-col shrink-0">
            <div style={{ height: `${moveListHeight}px` }} className="border-b border-slate-800 flex flex-col p-5 overflow-hidden shrink-0">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">Match Progress</h2>
                </div>
                <div ref={historyContainerRef} className="flex-grow overflow-y-auto pr-2 custom-scrollbar">
                    <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                        {history.map((m, i) => {
                            const result = batchAnalysisResults[m.after];
                            const classColor = {
                                best: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-400',
                                excellent: 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300',
                                good: 'border-slate-700 bg-slate-800/50 text-slate-400',
                                inaccuracy: 'border-yellow-500/30 bg-yellow-500/5 text-yellow-300',
                                mistake: 'border-orange-500/30 bg-orange-500/5 text-orange-400',
                                blunder: 'border-rose-500/40 bg-rose-500/5 text-rose-400'
                            }[result?.classification || 'good'];
                            return (
                                <div key={i} onClick={() => navigateHistory(i - historyIndex)} className={`px-3 py-2 border rounded cursor-pointer transition-all ${i === historyIndex ? 'ring-2 ring-violet-500 border-violet-500 bg-violet-500/5 scale-[1.02] z-10 shadow-lg shadow-violet-900/20' : 'hover:border-slate-500'} ${classColor}`}>
                                    <span className="opacity-30 mr-2 text-[9px]">{Math.floor(i/2)+1}{i % 2 === 0 ? '.' : '...'}</span>
                                    <span className="font-black text-xs">{m.san}</span>
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
                                    {currentAnalysis.classification || 'GOOD'}
                                </span>
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Recommended</span>
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
                            <p className="text-[11px] font-black uppercase tracking-[0.2em] leading-relaxed">Intelligence Ready <br/> Load match to analyze</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
      </main>
    </div>
  );
}

export default App;
