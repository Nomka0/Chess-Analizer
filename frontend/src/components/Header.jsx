import { Award, Plus, Upload, Check, Copy, Languages, Activity, Sparkles } from 'lucide-react';

const Header = ({ t, setShowImportModal, handleCopyFen, copied, language, setLanguage, selectedModel, setSelectedModel, models, handleAnalyzeAllPgn, isLoading, userColor, setUserColor }) => {
  return (
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
          <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800 shadow-inner">
            <button 
                onClick={() => setUserColor('white')} 
                className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter transition-all duration-200 flex items-center gap-1.5 ${
                    userColor === 'white' 
                    ? 'bg-white text-slate-950 shadow-md transform scale-105' 
                    : 'text-slate-500 hover:text-slate-300'
                }`}
            >
                <div className={`w-2 h-2 rounded-full border border-slate-400 ${userColor === 'white' ? 'bg-slate-100' : 'bg-slate-400 opacity-50'}`} />
                {language === 'en' ? 'White' : 'Blancas'}
            </button>
            <button 
                onClick={() => setUserColor('black')} 
                className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter transition-all duration-200 flex items-center gap-1.5 ${
                    userColor === 'black' 
                    ? 'bg-slate-700 text-white shadow-md transform scale-105' 
                    : 'text-slate-500 hover:text-slate-300'
                }`}
            >
                <div className={`w-2 h-2 rounded-full border border-slate-400 ${userColor === 'black' ? 'bg-slate-900' : 'bg-slate-900 opacity-50'}`} />
                {language === 'en' ? 'Black' : 'Negras'}
            </button>
          </div>

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
  );
};

export default Header;
