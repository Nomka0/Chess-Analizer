import { X } from 'lucide-react';

const ImportModal = ({ showImportModal, setShowImportModal, t, tempInput, setFenInput, handleImport }) => {
  return (
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
  );
};

export default ImportModal;
