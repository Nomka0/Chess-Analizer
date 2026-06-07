const MatchProgress = ({ t, history, batchAnalysisResults, historyIndex, navigateHistory, historyContainerRef }) => {
  return (
    <div className="flex flex-col p-4 overflow-hidden shrink-0 h-full">
        <div className="flex justify-between items-center mb-3">
            <h2 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">{t.matchProgress}</h2>
        </div>
        <div ref={historyContainerRef} className="flex-grow overflow-y-auto pr-1 custom-scrollbar">
            <div className="grid grid-cols-1 gap-1.5 font-mono text-[11px]">
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
                        <div key={i} onClick={() => navigateHistory(i - historyIndex)} className={`px-2 py-1.5 border rounded cursor-pointer transition-all ${i === historyIndex ? 'ring-2 ring-violet-500 border-violet-500 bg-violet-500/5 scale-[1.01] z-10 shadow-lg shadow-violet-900/20' : 'hover:border-slate-500'} ${classColor}`}>
                            <span className="opacity-30 mr-1 text-[9px]">{Math.floor(i/2)+1}{i % 2 === 0 ? '.' : '...'}</span>
                            <span className="font-black text-xs uppercase">{m.san}</span>
                            {result && <span className="float-right text-[8px] opacity-60 mt-0.5">{t[classification]}</span>}
                        </div>
                    );
                })}
            </div>
        </div>
    </div>
  );
};

export default MatchProgress;
