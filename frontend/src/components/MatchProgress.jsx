import { formatChessText } from '../utils';

const formatMove = (move, hasAnalysis = false) => {
  if (!move) return '';
  const formattedSan = formatChessText(move.san);
  
  return (
    <span 
      className={`flex items-center gap-1 ${hasAnalysis ? 'analyzed-move' : ''}`} 
      dangerouslySetInnerHTML={{ __html: formattedSan }} 
    />
  );
};

const MatchProgress = ({ t, history, batchAnalysisResults, historyIndex, navigateHistory, historyContainerRef }) => {
  const movePairs = [];
  for (let i = 0; i < history.length; i += 2) {
    movePairs.push([history[i], history[i + 1]]);
  }

  const hasAnalysis = (move) => {
    if (!move || !batchAnalysisResults) return false;
    const result = batchAnalysisResults[move.after];
    return !!result && result.analysis && result.analysis !== 'Analizando con IA...';
  };

  const getMoveColor = (move) => {
    if (!move || !batchAnalysisResults) return 'hover:border-slate-500';
    const result = batchAnalysisResults[move.after];
    const classification = result?.classification || 'good';
    return {
        best: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-400',
        excellent: 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300',
        good: 'border-slate-700 bg-slate-800/50 text-slate-400',
        inaccuracy: 'border-yellow-500/30 bg-yellow-500/5 text-yellow-300',
        mistake: 'border-orange-500/30 bg-orange-500/5 text-orange-400',
        blunder: 'border-rose-500/40 bg-rose-500/5 text-rose-400'
    }[classification];
  };

  return (
    <div className="flex flex-col p-4 overflow-hidden shrink-0 h-full">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">{t.matchProgress}</h2>
      </div>
      <div ref={historyContainerRef} className="flex-grow overflow-y-auto pr-1 custom-scrollbar">
        <table className="w-full text-left border-collapse text-[11px] font-mono">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="py-1 w-8">#</th>
              <th className="py-1">White</th>
              <th className="py-1">Black</th>
            </tr>
          </thead>
          <tbody>
            {movePairs.map((pair, i) => {
              const whiteMove = pair[0];
              const blackMove = pair[1];
              
              return (
                <tr key={i} className="border-b border-slate-800/50">
                  <td className="py-1.5 text-slate-500">{i + 1}.</td>
                  <td 
                    className={`py-1.5 px-2 cursor-pointer border rounded ${whiteMove ? getMoveColor(whiteMove) : ''} ${historyIndex === i * 2 ? 'ring-2 ring-violet-500 ring-inset shadow-[inset_0_0_12px_rgba(139,92,246,0.1)]' : ''}`} 
                    onClick={() => whiteMove && navigateHistory(i * 2)}
                  >
                    {formatMove(whiteMove, hasAnalysis(whiteMove))}
                  </td>
                  <td 
                    className={`py-1.5 px-2 cursor-pointer border rounded ${blackMove ? getMoveColor(blackMove) : ''} ${historyIndex === (i * 2 + 1) ? 'ring-2 ring-violet-500 ring-inset shadow-[inset_0_0_12px_rgba(139,92,246,0.1)]' : ''}`} 
                    onClick={() => blackMove && navigateHistory(i * 2 + 1)}
                  >
                    {formatMove(blackMove, hasAnalysis(blackMove))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MatchProgress;
