import ReactMarkdown from 'react-markdown';
import { Sparkles } from 'lucide-react';

const AnalysisView = ({ currentAnalysis, t, markdownComponents }) => {
  return (
    <div className="flex-grow flex flex-col overflow-hidden bg-[#0d1117]/30 h-full">
      <div className="flex-grow overflow-y-auto p-5 space-y-6 custom-scrollbar h-full">
        {currentAnalysis ? (
          <div className="animate-fade-in pb-12">
            <div className="flex items-center justify-between mb-6 border-b border-slate-800/50 pb-4">
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
          <div className="h-full flex flex-col items-center justify-center text-center opacity-20 px-6 grayscale">
              <Sparkles className="w-12 h-10 mb-4 text-indigo-400" />
              <p className="text-[10px] font-black uppercase tracking-[0.2em] leading-relaxed">{t.intelligenceReady} <br/> {t.loadMatch}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalysisView;
