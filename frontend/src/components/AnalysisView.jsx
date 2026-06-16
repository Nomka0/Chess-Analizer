import { useRef, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { Sparkles } from 'lucide-react';
import { formatAIAnalysisText } from '../utils'; // <-- Asegúrate de que la ruta sea correcta

const AnalysisView = ({ currentAnalysis, t, markdownComponents, onVariationMoveClick, activeHistoryIndex, isAltBoardActive, onAnalyzeMove, isLoading }) => {
  const containerRef = useRef(null);
  // Track the specific variation that was clicked (by its unique data-variation + data-start-index)
  const [activeVariationKey, setActiveVariationKey] = useState(null);

  // Parseamos el texto solo cuando cambia el análisis o el índice actual
  const parsedAnalysisText = useMemo(() => {
    if (!currentAnalysis?.analysis) return '';
    return formatAIAnalysisText(currentAnalysis.analysis, activeHistoryIndex);
  }, [currentAnalysis?.analysis, activeHistoryIndex]);

  // Effect to highlight the active move ONLY in the clicked variation
  useEffect(() => {
    if (!isAltBoardActive || !containerRef.current || !activeVariationKey) return;

    // Remove existing highlights from all variations
    const highlighted = containerRef.current.querySelectorAll('.active-variation-move');
    highlighted.forEach(el => el.classList.remove('active-variation-move', 'ring-2', 'ring-violet-500', 'bg-violet-500/20', 'rounded', 'px-1'));

    // Find ONLY the variation wrapper that was clicked
    const wrapper = containerRef.current.querySelector(`.variation-wrapper[data-variation-key="${activeVariationKey}"]`);
    if (!wrapper) return;

    const startIndex = parseInt(wrapper.getAttribute('data-start-index') || '-1');
    if (startIndex === -1) return;

    const moves = Array.from(wrapper.querySelectorAll('.clickable-move'));
    moves.forEach((moveNode, index) => {
        // If this move in the variation matches our active history index
        if (startIndex + index === activeHistoryIndex) {
            moveNode.classList.add('active-variation-move', 'ring-2', 'ring-violet-500', 'bg-violet-500/20', 'rounded', 'px-1');
            
            // Scroll into view if needed
            moveNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
  }, [activeHistoryIndex, isAltBoardActive, currentAnalysis, activeVariationKey]);

  const handleTextClick = (e) => {
    const moveNode = e.target.closest('.clickable-move');
    if (moveNode) {
        e.preventDefault();
        const moveSan = moveNode.getAttribute('data-move');
        const variationWrapper = moveNode.closest('.variation-wrapper');

        const variationSequence = variationWrapper 
            ? variationWrapper.getAttribute('data-variation') 
            : moveNode.getAttribute('data-variation');

        const startIndex = variationWrapper 
            ? variationWrapper.getAttribute('data-start-index') 
            : moveNode.getAttribute('data-start-index');

        // Get unique variation key to scope highlighting to this specific variation
        const variationKey = variationWrapper 
            ? variationWrapper.getAttribute('data-variation-key') 
            : moveNode.getAttribute('data-variation-key');

        const moveIndex = variationWrapper
            ? Array.from(variationWrapper.querySelectorAll('.clickable-move')).indexOf(moveNode)
            : 0;

        // Set the active variation key to scope highlighting
        if (variationKey) {
            setActiveVariationKey(variationKey);
        }

        if (onVariationMoveClick) {
            onVariationMoveClick(moveSan, variationSequence, moveIndex, parseInt(startIndex));
        }
    }
  };

  return (
    <div className="flex-grow flex flex-col overflow-hidden bg-[#0d1117]/30 h-full">
      <div
        ref={containerRef}
        className="flex-grow overflow-y-auto p-5 space-y-6 custom-scrollbar h-full"
        onClick={handleTextClick}
      >
        {currentAnalysis ? (
          <div className="animate-fade-in pb-12">
            <div className="flex items-center justify-between mb-6 border-b border-slate-800/50 pb-4">
              <span className={`px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-tighter shadow-sm ${
                  {
                      best: 'bg-cyan-500 text-white',
                      excellent: 'bg-emerald-500 text-white',
                      good: 'bg-green-500 text-white',
                      inaccuracy: 'bg-yellow-500 text-black',
                      mistake: 'bg-orange-500 text-white',
                      blunder: 'bg-red-600 text-white'
                  }[currentAnalysis.classification || 'good']
              }`}>
                  {t[currentAnalysis.classification || 'good']}
              </span>
              <div className="flex flex-col items-end">
                  <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest">{t.suggested}</span>
                  <span className="text-lg font-black font-mono text-violet-400 leading-none mt-1" dangerouslySetInnerHTML={{ __html: currentAnalysis.bestmove }} />
              </div>
            </div>
            <div className="prose-slate prose-invert max-w-none">
              <ReactMarkdown components={markdownComponents} rehypePlugins={[rehypeRaw]}>
                    {parsedAnalysisText}
                </ReactMarkdown>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <Sparkles className={`w-12 h-10 mb-4 ${isLoading ? 'text-violet-500 animate-pulse' : 'text-indigo-400 opacity-20'}`} />
              <p className="text-[10px] font-black uppercase tracking-[0.2em] leading-relaxed opacity-20 mb-6">
                {isLoading ? t.analyzing : t.intelligenceReady} <br/> {t.loadMatch}
              </p>
              
              {activeHistoryIndex >= 0 && !isLoading && (
                <button 
                  onClick={() => onAnalyzeMove(activeHistoryIndex)}
                  className="bg-violet-600 hover:bg-violet-500 text-white px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-violet-900/20 active:scale-95"
                >
                  {t.startAnalysis}
                </button>
              )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalysisView;
