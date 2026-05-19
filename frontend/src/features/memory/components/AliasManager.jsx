import React, { useState, useRef, useEffect } from 'react';
import { Link2, X, Save, Plus, Loader2 } from 'lucide-react';
import { deleteNode, addAlias } from '../../../lib/api';

const AliasManager = ({ aliases, currentDomain, currentPath, onUpdate }) => {
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [newDisclosure, setNewDisclosure] = useState('');
  const [newPriority, setNewPriority] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);
  const pathInputRef = useRef(null);

  useEffect(() => {
    if (adding && pathInputRef.current) pathInputRef.current.focus();
  }, [adding]);

  const parseAlias = (aliasUri) => {
    const idx = aliasUri.indexOf('://');
    if (idx === -1) return { domain: currentDomain, path: aliasUri };
    return { domain: aliasUri.substring(0, idx), path: aliasUri.substring(idx + 3) };
  };

  const handleRemove = async (aliasUri) => {
    setRemoving(aliasUri);
    setError('');
    try {
      const { domain, path } = parseAlias(aliasUri);
      await deleteNode(domain, path);
      onUpdate();
    } catch (err) {
      setError('Failed to remove alias: ' + (err.response?.data?.detail || err.message));
    } finally {
      setRemoving(null);
    }
  };

  const handleAdd = async () => {
    const pt = newPath.trim();
    if (!pt || !newDisclosure.trim()) return;
    setSaving(true);
    setError('');
    try {
      await addAlias({
        new_path: pt,
        target_path: currentPath,
        disclosure: newDisclosure.trim(),
        new_domain: currentDomain,
        target_domain: currentDomain,
        priority: newPriority,
      });
      setNewPath('');
      setNewDisclosure('');
      setNewPriority(0);
      setAdding(false);
      onUpdate();
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAdd();
    if (e.key === 'Escape') { setAdding(false); setNewPath(''); setNewDisclosure(''); setError(''); }
  };

  const cancelAdd = () => {
    setAdding(false);
    setNewPath('');
    setNewDisclosure('');
    setNewPriority(0);
    setError('');
  };

  return (
    <div className="flex items-start gap-2 text-xs text-slate-500">
      <Link2 size={13} className="flex-shrink-0 mt-0.5 text-slate-600" />
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-slate-600 font-medium">Also reachable via:</span>
        {aliases.map(alias => (
          <span
            key={alias}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-800/60 border border-slate-700/50 rounded text-indigo-400/70 font-mono text-[11px]"
          >
            {alias}
            <button
              onClick={() => handleRemove(alias)}
              disabled={removing === alias}
              className="text-slate-600 hover:text-rose-400 transition-colors disabled:opacity-50"
              title="Remove this alias"
            >
              {removing === alias ? (
                <Loader2 size={9} className="animate-spin" />
              ) : (
                <X size={9} />
              )}
            </button>
          </span>
        ))}
        {adding ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500">{currentDomain}://</span>
            <input
              ref={pathInputRef}
              type="text"
              value={newPath}
              onChange={e => setNewPath(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="new/path"
              className="w-28 px-1.5 py-0.5 bg-slate-900 border border-indigo-800/40 rounded text-indigo-300 text-[11px] font-mono focus:outline-none focus:border-indigo-500/50"
            />
            <input
              type="text"
              value={newDisclosure}
              onChange={e => setNewDisclosure(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="disclosure..."
              className="w-32 px-1.5 py-0.5 bg-slate-900 border border-indigo-800/40 rounded text-indigo-300 text-[11px] focus:outline-none focus:border-indigo-500/50"
            />
            <input
              type="number" min="0"
              value={newPriority}
              onChange={e => setNewPriority(parseInt(e.target.value) || 0)}
              onKeyDown={handleKeyDown}
              className="w-14 px-1.5 py-0.5 bg-slate-900 border border-indigo-800/40 rounded text-indigo-300 text-[11px] font-mono focus:outline-none focus:border-indigo-500/50"
              title="priority"
            />
            <button
              onClick={handleAdd}
              disabled={saving || !newPath.trim() || !newDisclosure.trim()}
              className="text-indigo-500 hover:text-indigo-300 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
            </button>
            <button onClick={cancelAdd} className="text-slate-600 hover:text-slate-400 transition-colors">
              <X size={11} />
            </button>
          </span>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 border border-dashed border-slate-700 rounded text-slate-600 hover:text-indigo-400 hover:border-indigo-500/40 transition-colors text-[11px]"
          >
            <Plus size={9} /> add alias
          </button>
        )}
      </div>
      {error && <span className="text-rose-400 w-full text-[11px]">{error}</span>}
    </div>
  );
};

export default AliasManager;
