import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { 
  ChevronRight, 
  Folder, 
  FileText, 
  Edit3, 
  Save, 
  X, 
  Home, 
  Search, 
  Database, 
  Cpu, 
  Hash, 
  Layers, 
  ArrowLeft,
  AlertTriangle,
  Link2,
  Star,
  BookOpen,
  Plus,
  Tag
} from 'lucide-react';
import api from '../../lib/api';
import clsx from 'clsx';

// --- Helper ---
const PriorityBadge = ({ priority, size = 'sm' }) => {
  if (priority === null || priority === undefined) return null;
  
  const colors = priority === 0
    ? 'bg-rose-950/40 text-rose-400 border-rose-800/40'
    : priority <= 2
    ? 'bg-amber-950/30 text-amber-400 border-amber-800/30'
    : priority <= 5
    ? 'bg-sky-950/30 text-sky-400 border-sky-800/30'
    : 'bg-slate-800/30 text-slate-500 border-slate-700/30';
  
  const sizeClass = size === 'lg' 
    ? 'px-2.5 py-1 text-xs gap-1.5' 
    : 'px-1.5 py-0.5 text-[10px] gap-1';
  
  return (
    <span className={clsx("inline-flex items-center rounded border font-mono font-semibold", colors, sizeClass)}>
      <Star size={size === 'lg' ? 12 : 9} />
      {priority}
    </span>
  );
};

// --- Glossary Highlighting ---

function findAllOccurrences(text, keywords) {
  if (!keywords || keywords.length === 0 || !text) return [];

  const matches = [];
  for (const entry of keywords) {
    if (!entry.keyword) continue;
    let idx = text.indexOf(entry.keyword);
    while (idx !== -1) {
      matches.push({
        start: idx,
        end: idx + entry.keyword.length,
        keyword: entry.keyword,
        nodes: entry.nodes,
      });
      idx = text.indexOf(entry.keyword, idx + entry.keyword.length);
    }
  }

  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const result = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      result.push(m);
      lastEnd = m.end;
    }
  }
  return result;
}

const GlossaryPopup = ({ keyword, nodes, position, onClose, onNavigate }) => {
  const popupRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-[100] w-72 bg-[#0E0E18] border border-amber-800/40 rounded-xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
      style={{ 
        left: position.x, 
        ...(position.isAbove 
          ? { bottom: window.innerHeight - position.spanTop + 4, maxHeight: position.spanTop - 16 } 
          : { top: position.y + 4, maxHeight: window.innerHeight - position.y - 16 })
      }}
    >
      <div className="px-3 py-2 border-b border-slate-800/60 flex items-center gap-2 flex-shrink-0">
        <BookOpen size={12} className="text-amber-400" />
        <span className="text-xs font-semibold text-amber-300">{keyword}</span>
        <button onClick={onClose} className="ml-auto text-slate-600 hover:text-slate-400 transition-colors">
          <X size={12} />
        </button>
      </div>
      <div className="p-2 overflow-y-auto custom-scrollbar flex-1">
        {nodes.map((node, i) => {
          const isUnlinked = node.uri?.startsWith('unlinked://');
          return (
          <button
            key={node.uri || i}
            onClick={() => {
              if (isUnlinked) return; // Don't navigate for unlinked nodes
              const match = node.uri?.match(/^([^:]+):\/\/(.*)$/);
              if (match) onNavigate(match[2], match[1]);
              onClose();
            }}
            className={clsx(
              "w-full text-left px-2.5 py-2 rounded-lg transition-colors group relative",
              isUnlinked ? "cursor-default opacity-80 bg-slate-900/40" : "hover:bg-slate-800/60 cursor-pointer"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <code className={clsx(
                "text-[11px] font-mono block truncate flex-1",
                isUnlinked ? "text-slate-500" : "text-indigo-400/80 group-hover:text-indigo-300"
              )}>
                {node.uri}
              </code>
              {isUnlinked && (
                <span className="text-[9px] px-1.5 py-0.5 bg-rose-950/40 text-rose-400 border border-rose-900/50 rounded flex-shrink-0">
                  Orphaned
                </span>
              )}
            </div>
            {node.content_snippet && (
              <p className="text-[10px] text-slate-600 mt-0.5 line-clamp-2 leading-snug">
                {node.content_snippet}
              </p>
            )}
          </button>
        )})}
      </div>
    </div>,
    document.body
  );
};

const GlossaryHighlighter = ({ content, glossary, onNavigate }) => {
  const [popup, setPopup] = useState(null);
  const containerRef = useRef(null);

  // Clear popup when content changes (e.g., when switching nodes)
  useEffect(() => {
    setPopup(null);
  }, [content]);

  const matches = useMemo(
    () => findAllOccurrences(content, glossary),
    [content, glossary]
  );

  const handleKeywordClick = useCallback((e, match) => {
    const spanRect = e.target.getBoundingClientRect();
    
    const popupWidth = 288;
    let x = spanRect.left;
    if (x + popupWidth > window.innerWidth - 16) {
      x = window.innerWidth - popupWidth - 16;
      if (x < 16) x = 16;
    }

    const estimatedHeight = 250;
    let y = spanRect.bottom;
    let isAbove = false;
    
    if (y + estimatedHeight > window.innerHeight - 16 && spanRect.top > estimatedHeight + 16) {
      isAbove = true;
    }

    setPopup({
      keyword: match.keyword,
      nodes: match.nodes,
      position: {
        x: x,
        y: y,
        isAbove: isAbove,
        spanTop: spanRect.top,
      },
    });
  }, []);

  if (matches.length === 0) {
    return <pre className="whitespace-pre-wrap font-serif text-slate-300 leading-7">{content}</pre>;
  }

  const parts = [];
  let lastIdx = 0;
  for (const m of matches) {
    if (m.start > lastIdx) {
      parts.push({ text: content.slice(lastIdx, m.start), isMatch: false });
    }
    parts.push({ text: content.slice(m.start, m.end), isMatch: true, match: m });
    lastIdx = m.end;
  }
  if (lastIdx < content.length) {
    parts.push({ text: content.slice(lastIdx), isMatch: false });
  }

  return (
    <div ref={containerRef} className="relative">
      <pre className="whitespace-pre-wrap font-serif text-slate-300 leading-7">
        {parts.map((part, i) =>
          part.isMatch ? (
            <span
              key={i}
              className="text-amber-300 cursor-pointer underline decoration-dotted decoration-amber-600/50 hover:decoration-amber-400 hover:text-amber-200 transition-colors"
              onClick={(e) => handleKeywordClick(e, part.match)}
            >
              {part.text}
            </span>
          ) : (
            <React.Fragment key={i}>{part.text}</React.Fragment>
          )
        )}
      </pre>
      {popup && (
        <GlossaryPopup
          keyword={popup.keyword}
          nodes={popup.nodes}
          position={popup.position}
          onClose={() => setPopup(null)}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
};

// --- Keyword Management UI ---

const KeywordManager = ({ keywords, nodeUuid, onUpdate }) => {
  const [adding, setAdding] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (adding && inputRef.current) inputRef.current.focus();
  }, [adding]);

  const handleAdd = async () => {
    const kw = newKeyword.trim();
    if (!kw || !nodeUuid) return;
    try {
      await api.post('/browse/glossary', { keyword: kw, node_uuid: nodeUuid });
      setNewKeyword('');
      setAdding(false);
      onUpdate();
    } catch (err) {
      alert('Failed to add keyword: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleRemove = async (kw) => {
    if (!nodeUuid) return;
    try {
      await api.delete('/browse/glossary', { data: { keyword: kw, node_uuid: nodeUuid } });
      onUpdate();
    } catch (err) {
      alert('Failed to remove keyword: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleAdd();
    if (e.key === 'Escape') { setAdding(false); setNewKeyword(''); }
  };

  return (
    <div className="flex items-start gap-2 text-xs text-slate-500">
      <Tag size={13} className="flex-shrink-0 mt-0.5 text-amber-700" />
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-amber-700 font-medium">Glossary:</span>
        {keywords.map(kw => (
          <span
            key={kw}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-950/30 border border-amber-800/30 rounded text-amber-400/80 font-mono text-[11px]"
          >
            {kw}
            <button
              onClick={() => handleRemove(kw)}
              className="text-amber-700 hover:text-amber-400 transition-colors"
            >
              <X size={9} />
            </button>
          </span>
        ))}
        {adding ? (
          <span className="inline-flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={newKeyword}
              onChange={e => setNewKeyword(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => { if (!newKeyword.trim()) setAdding(false); }}
              placeholder="keyword..."
              className="w-28 px-1.5 py-0.5 bg-slate-900 border border-amber-800/40 rounded text-amber-300 text-[11px] font-mono focus:outline-none focus:border-amber-500/50"
            />
            <button onClick={handleAdd} className="text-amber-600 hover:text-amber-400 transition-colors">
              <Save size={11} />
            </button>
          </span>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 border border-dashed border-amber-800/30 rounded text-amber-700 hover:text-amber-400 hover:border-amber-600/40 transition-colors text-[11px]"
          >
            <Plus size={9} /> add
          </button>
        )}
      </div>
    </div>
  );
};

// --- Components ---

// 1. Sidebar Tree Node
const TreeNode = ({ domain, path, name, childrenCount, activeDomain, activePath, onNavigate, level }) => {
  const isAncestor = activeDomain === domain && activePath.startsWith(path + '/');
  const isActive = activeDomain === domain && activePath === path;
  
  const [expanded, setExpanded] = useState(isAncestor || isActive);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const prevActivePath = useRef(activePath);
  const prevActiveDomain = useRef(activeDomain);

  // Before first fetch, trust server count; after fetch, trust actual children length.
  const hasChildren = fetched ? children.length > 0 : (childrenCount === undefined || childrenCount > 0);

  useEffect(() => {
    if (expanded && !fetched && hasChildren) {
      fetchChildren();
    }
  }, [expanded, fetched, hasChildren]);

  useEffect(() => {
    const pathChanged = activePath !== prevActivePath.current || activeDomain !== prevActiveDomain.current;
    if (pathChanged && (isAncestor || isActive) && !expanded) {
      setExpanded(true);
    }
    prevActivePath.current = activePath;
    prevActiveDomain.current = activeDomain;
  }, [activePath, activeDomain, isAncestor, isActive, expanded]);

  const fetchChildren = async () => {
    setLoading(true);
    try {
      const res = await api.get('/browse/node', { params: { domain, path, nav_only: true } });
      setChildren(res.data.children);
      setFetched(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleClick = (e) => {
    e.stopPropagation();
    if (isActive) {
      if (hasChildren) setExpanded(!expanded);
    } else {
      onNavigate(path, domain);
      if (!expanded && hasChildren) setExpanded(true);
    }
  };

  return (
    <div>
      <div 
        className={clsx(
          "flex items-center gap-1.5 py-1.5 pr-2 rounded-lg text-sm transition-all cursor-pointer group",
          isActive ? "bg-indigo-500/10 text-indigo-300" : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-200"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
      >
        <div 
          className="w-5 h-5 flex items-center justify-center flex-shrink-0"
          onClick={(e) => {
             if (hasChildren) {
                 e.stopPropagation();
                 setExpanded(!expanded);
             }
          }}
        >
          {loading ? (
            <div className="w-3 h-3 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
          ) : hasChildren ? (
            <ChevronRight size={14} className={clsx("transition-transform text-slate-500 group-hover:text-slate-300", expanded && "rotate-90")} />
          ) : null}
        </div>
        <FileText size={14} className={clsx("flex-shrink-0", isActive ? "text-indigo-400" : "text-slate-600 group-hover:text-slate-400")} />
        <span className="truncate flex-1 text-[13px]">{name}</span>
      </div>
      
      {expanded && children.length > 0 && (
        <div className="">
          {children.map(child => (
            <TreeNode 
              key={child.path}
              domain={domain}
              path={child.path}
              name={child.name}
              childrenCount={child.approx_children_count}
              activeDomain={activeDomain}
              activePath={activePath}
              onNavigate={onNavigate}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// 2. Sidebar Domain Node
const DomainNode = ({ domain, rootCount, activeDomain, activePath, onNavigate }) => {
  const [expanded, setExpanded] = useState(activeDomain === domain);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  const prevActiveDomain = useRef(activeDomain);
  const prevActivePath = useRef(activePath);

  // Before first fetch, trust server count; after fetch, trust actual children length.
  const hasChildren = fetched ? children.length > 0 : (rootCount === undefined || rootCount > 0);

  useEffect(() => {
    if (expanded && !fetched && hasChildren) {
      fetchChildren();
    }
  }, [expanded, fetched, hasChildren]);

  useEffect(() => {
    const changed = activeDomain !== prevActiveDomain.current || activePath !== prevActivePath.current;
    if (changed && activeDomain === domain && !expanded) {
      setExpanded(true);
    }
    prevActiveDomain.current = activeDomain;
    prevActivePath.current = activePath;
  }, [activeDomain, activePath, domain, expanded]);

  const fetchChildren = async () => {
    setLoading(true);
    try {
      const res = await api.get('/browse/node', { params: { domain, path: '', nav_only: true } });
      setChildren(res.data.children);
      setFetched(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const isActive = activeDomain === domain && activePath === '';

  const handleClick = (e) => {
    e.stopPropagation();
    if (isActive) {
      if (hasChildren) setExpanded(!expanded);
    } else {
      onNavigate('', domain);
      if (!expanded && hasChildren) setExpanded(true);
    }
  };

  return (
    <div className="mb-2">
      <div 
        className={clsx(
          "flex items-center gap-1.5 px-2 py-2 rounded-lg text-sm transition-all cursor-pointer group",
          isActive ? "bg-indigo-500/10 text-indigo-300 shadow-[0_0_10px_rgba(99,102,241,0.1)]" : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-200"
        )}
        onClick={handleClick}
      >
        <div 
          className="w-5 h-5 flex items-center justify-center flex-shrink-0"
          onClick={(e) => {
             if (hasChildren) {
                 e.stopPropagation();
                 setExpanded(!expanded);
             }
          }}
        >
          {loading ? (
            <div className="w-3.5 h-3.5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
          ) : hasChildren ? (
            <ChevronRight size={16} className={clsx("transition-transform text-slate-500 group-hover:text-slate-300", expanded && "rotate-90")} />
          ) : null}
        </div>
        <Database size={16} className={clsx("flex-shrink-0 ml-0.5", isActive ? "text-indigo-400" : "text-slate-500")} />
        <span className="font-medium flex-1 truncate ml-1">
          {domain.charAt(0).toUpperCase() + domain.slice(1)} Memory
        </span>
        {rootCount !== undefined && (
          <span className="text-[10px] bg-slate-800/80 px-1.5 py-0.5 rounded text-slate-500">{rootCount}</span>
        )}
      </div>
      
      {expanded && children.length > 0 && (
        <div className="mt-1">
          {children.map(child => (
            <TreeNode 
              key={child.path}
              domain={domain}
              path={child.path}
              name={child.name}
              childrenCount={child.approx_children_count}
              activeDomain={activeDomain}
              activePath={activePath}
              onNavigate={onNavigate}
              level={1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// 3. Breadcrumb
const Breadcrumb = ({ items, onNavigate }) => (
  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar mask-linear-fade">
    <button 
      onClick={() => onNavigate('')}
      className="p-1.5 rounded-md hover:bg-slate-800/50 text-slate-500 hover:text-indigo-400 transition-colors"
    >
      <Home size={14} />
    </button>
    
    {items.map((crumb, i) => (
      <React.Fragment key={crumb.path}>
        <ChevronRight size={12} className="text-slate-700 flex-shrink-0" />
        <button
          onClick={() => onNavigate(crumb.path)}
          className={clsx(
            "px-2 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap",
            i === items.length - 1
              ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
              : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
          )}
        >
          {crumb.label}
        </button>
      </React.Fragment>
    ))}
  </div>
);

// 3. Node Card (Grid View) - Redesigned
const NodeGridCard = ({ node, currentDomain, onClick }) => {
  const isCrossDomain = node.domain && node.domain !== currentDomain;
  return (
  <button 
    onClick={onClick}
    className={clsx(
      "group relative flex flex-col items-start p-5 bg-[#0A0A12] border rounded-xl transition-all duration-300 hover:shadow-[0_0_20px_rgba(99,102,241,0.1)] hover:-translate-y-1 text-left w-full h-full overflow-hidden",
      isCrossDomain
        ? "border-violet-800/40 hover:border-violet-500/40"
        : "border-slate-800/50 hover:border-indigo-500/30"
    )}
  >
    {/* Hover Gradient */}
    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
    
    {/* Header: Icon + Name + Importance */}
    <div className="flex items-center gap-3 mb-3 w-full">
      <div className="p-2 rounded-lg bg-slate-900 group-hover:bg-indigo-900/20 text-slate-500 group-hover:text-indigo-400 transition-colors flex-shrink-0">
         {node.approx_children_count > 0 ? <Folder size={18} /> : <FileText size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-slate-300 group-hover:text-indigo-200 transition-colors break-words line-clamp-2">
          {node.name || node.path.split('/').pop()}
        </h3>
        {isCrossDomain && (
          <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 text-[10px] font-mono text-violet-400/80 bg-violet-950/40 border border-violet-800/30 rounded">
            <Link2 size={9} />
            {node.domain}://
          </span>
        )}
      </div>
      <PriorityBadge priority={node.priority} />
    </div>
    
    {/* Disclosure (if present) */}
    {node.disclosure && (
      <div className="w-full mb-2">
        <p className="text-[11px] text-amber-500/70 leading-snug line-clamp-2 flex items-start gap-1">
          <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
          <span className="italic">{node.disclosure}</span>
        </p>
      </div>
    )}
    
    {/* Content snippet */}
    <div className="w-full flex-1">
        {node.content_snippet ? (
            <p className="text-xs text-slate-500 leading-relaxed line-clamp-3">
                {node.content_snippet}
            </p>
        ) : (
            <p className="text-xs text-slate-700 italic">No preview available</p>
        )}
    </div>

    {/* Hover arrow - absolute positioned, no layout cost */}
    <ChevronRight size={14} className="absolute bottom-4 right-4 text-indigo-500/50 opacity-0 group-hover:opacity-100 transition-opacity" />
  </button>
  );
};


// --- Main Page ---

export default function MemoryBrowser() {
  const [searchParams, setSearchParams] = useSearchParams();
  const domain = searchParams.get('domain') || 'core';
  const path = searchParams.get('path') || '';
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ node: null, children: [], breadcrumbs: [] });
  const [domains, setDomains] = useState([]);
  
  // Edit State
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editDisclosure, setEditDisclosure] = useState('');
  const [editPriority, setEditPriority] = useState(0);
  const [saving, setSaving] = useState(false);

  // Track current route to prevent race conditions on slow requests
  const currentRouteRef = useRef({ domain, path });
  useEffect(() => {
    currentRouteRef.current = { domain, path };
  }, [domain, path]);

  // Fetch domain list on mount
  useEffect(() => {
    api.get('/browse/domains').then(res => setDomains(res.data)).catch(() => {});
  }, []);

  // Fetch Data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      setEditing(false);
      try {
        const res = await api.get('/browse/node', { params: { domain, path } });
        setData(res.data);
        setEditContent(res.data.node?.content || '');
        setEditDisclosure(res.data.node?.disclosure || '');
        setEditPriority(res.data.node?.priority ?? 0);
      } catch (err) {
        setError(err.response?.data?.detail || err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [domain, path]);

  const navigateTo = (newPath, newDomain) => {
    const params = new URLSearchParams();
    params.set('domain', newDomain || domain);
    if (newPath) params.set('path', newPath);
    setSearchParams(params);
  };

  const startEditing = () => {
    setEditContent(data.node?.content || '');
    setEditDisclosure(data.node?.disclosure || '');
    setEditPriority(data.node?.priority ?? 0);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditContent(data.node?.content || '');
    setEditDisclosure(data.node?.disclosure || '');
    setEditPriority(data.node?.priority ?? 0);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {};
      // Only send changed fields
      if (editContent !== (data.node?.content || '')) {
        payload.content = editContent;
      }
      if (editPriority !== (data.node?.priority ?? 0)) {
        payload.priority = editPriority;
      }
      if (editDisclosure !== (data.node?.disclosure || '')) {
        payload.disclosure = editDisclosure;
      }
      
      if (Object.keys(payload).length === 0) {
        // Nothing changed
        setEditing(false);
        return;
      }
      
      await api.put('/browse/node', payload, { params: { domain, path } });
      const res = await api.get('/browse/node', { params: { domain, path } });
      setData(currentData => {
        // Prevent race condition: only update if we are still viewing the exact same domain and path
        if (currentRouteRef.current.domain === domain && currentRouteRef.current.path === path) {
          return res.data;
        }
        return currentData;
      });
      setEditing(false);
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const isRoot = !path;
  const node = data.node;

  return (
    <div className="flex h-full bg-[#05050A] text-slate-300 font-sans selection:bg-indigo-500/30 selection:text-indigo-200 overflow-hidden">
      
      {/* 1. Sidebar Navigation */}
      <div className="w-64 flex-shrink-0 bg-[#08080E] border-r border-slate-800/30 flex flex-col">
        <div className="p-5 border-b border-slate-800/30">
          <div className="flex items-center gap-2 text-indigo-400 mb-1">
            <Cpu size={18} />
            <h1 className="font-bold tracking-tight text-sm text-slate-100">Memory Core</h1>
          </div>
          <p className="text-[10px] text-slate-600 pl-6 uppercase tracking-wider">Neural Explorer v2.0</p>
        </div>
        
        <div className="p-3 flex-1 overflow-y-auto custom-scrollbar">
             <div className="mb-4">
                 <h3 className="px-3 text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2">Domains</h3>
                 {domains.map(d => (
                   <DomainNode
                     key={d.domain}
                     domain={d.domain}
                     rootCount={d.root_count}
                     activeDomain={domain}
                     activePath={path}
                     onNavigate={navigateTo}
                   />
                 ))}
                 {domains.length === 0 && (
                   <DomainNode
                     domain="core"
                     activeDomain={domain}
                     activePath={path}
                     onNavigate={navigateTo}
                   />
                 )}
             </div>
        </div>

        <div className="mt-auto p-4 border-t border-slate-800/30">
             <div className="bg-slate-900/50 rounded p-3 border border-slate-800/50">
                 <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                    <Hash size={12} />
                    <span>Current Path</span>
                 </div>
                 <code className="block text-[10px] font-mono text-indigo-300/80 break-all leading-tight">
                    {domain}://{path || 'root'}
                 </code>
             </div>
        </div>
      </div>

      {/* 2. Main Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#05050A] relative">
         {/* Top Bar */}
         <div className="h-14 flex-shrink-0 border-b border-slate-800/30 flex items-center justify-between px-6 bg-[#05050A]/80 backdrop-blur-md sticky top-0 z-20">
             <Breadcrumb items={data.breadcrumbs} onNavigate={navigateTo} />
             
             <div className="flex items-center gap-2">
                 <div className="relative group">
                     <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 group-hover:text-slate-400 transition-colors" />
                     <input 
                        type="text" 
                        placeholder="Search nodes..." 
                        disabled
                        className="bg-slate-900/50 border border-slate-800 rounded-full py-1.5 pl-9 pr-4 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50 focus:bg-slate-900 transition-all w-48 cursor-not-allowed opacity-50"
                     />
                 </div>
             </div>
         </div>

         {/* Content Scroll Area */}
         <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {loading ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 text-slate-600">
                    <div className="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
                    <span className="text-xs tracking-widest uppercase">Retrieving Neural Data...</span>
                </div>
            ) : error ? (
                <div className="h-full flex flex-col items-center justify-center text-rose-500 gap-4">
                    <p className="text-lg">Access Denied / Error</p>
                    <p className="text-sm opacity-60">{error}</p>
                    <button onClick={() => navigateTo('')} className="text-xs bg-slate-800 px-4 py-2 rounded hover:text-white transition-colors">Return to Root</button>
                </div>
            ) : (
                <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    
                    {/* Node Header & Content */}
                    {node && (!isRoot || !node.is_virtual || editing) && (
                        <div className="space-y-4">
                             {/* Header */}
                            <div className="flex items-start justify-between gap-4">
                                <div className="space-y-3 min-w-0 flex-1">
                                    {/* Title + Importance */}
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
                                            {node.name || path.split('/').pop()}
                                        </h1>
                                        <PriorityBadge priority={node.priority} size="lg" />
                                    </div>
                                    
                                    {/* Disclosure */}
                                    {node.disclosure && !editing && (
                                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-950/20 border border-amber-900/30 rounded-lg text-amber-500/80 text-xs max-w-full">
                                            <AlertTriangle size={14} className="flex-shrink-0" />
                                            <span className="font-medium mr-1">Disclosure:</span>
                                            <span className="italic truncate">{node.disclosure}</span>
                                        </div>
                                    )}
                                    
                                    {/* Aliases */}
                                    {node.aliases && node.aliases.length > 0 && !editing && (
                                        <div className="flex items-start gap-2 text-xs text-slate-500">
                                            <Link2 size={13} className="flex-shrink-0 mt-0.5 text-slate-600" />
                                            <div className="flex flex-wrap gap-1.5">
                                                <span className="text-slate-600 font-medium">Also reachable via:</span>
                                                {node.aliases.map(alias => (
                                                    <code key={alias} className="px-1.5 py-0.5 bg-slate-800/60 rounded text-indigo-400/70 font-mono text-[11px]">
                                                        {alias}
                                                    </code>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Glossary Keywords */}
                                    {!editing && !node.is_virtual && (
                                        <KeywordManager
                                          keywords={node.glossary_keywords || []}
                                          nodeUuid={node.node_uuid}
                                          onUpdate={() => {
                                            // Re-fetch node to update the keyword list shown in the manager
                                            api.get('/browse/node', { params: { domain, path } })
                                              .then(res => {
                                                setData(currentData => {
                                                  // Prevent race condition: only update if we are still viewing the exact same domain and path
                                                  if (currentRouteRef.current.domain === domain && currentRouteRef.current.path === path) {
                                                    return res.data;
                                                  }
                                                  return currentData;
                                                });
                                              });
                                          }}
                                        />
                                    )}
                                </div>
                                
                                {/* Edit / Save buttons */}
                                <div className="flex gap-2 flex-shrink-0">
                                    {editing ? (
                                        <>
                                            <button onClick={cancelEditing} className="p-2 hover:bg-slate-800 rounded text-slate-400 transition-colors"><X size={18} /></button>
                                            <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium transition-colors shadow-lg shadow-indigo-900/20">
                                                <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
                                            </button>
                                        </>
                                    ) : (
                                        <button onClick={startEditing} className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-sm font-medium transition-colors border border-slate-700 hover:border-slate-600">
                                            <Edit3 size={16} /> Edit
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Metadata Editor (shown in edit mode) */}
                            {editing && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-slate-900/50 border border-slate-800/50 rounded-xl">
                                    {/* Priority */}
                                    <div className="space-y-1.5">
                                        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                                            <Star size={12} />
                                            Priority
                                            <span className="text-slate-600 font-normal">(lower = higher priority)</span>
                                        </label>
                                        <input 
                                            type="number"
                                            min="0"
                                            value={editPriority}
                                            onChange={e => setEditPriority(parseInt(e.target.value) || 0)}
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-indigo-500/50 transition-colors"
                                        />
                                    </div>
                                    {/* Disclosure */}
                                    <div className="space-y-1.5">
                                        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
                                            <AlertTriangle size={12} />
                                            Disclosure
                                            <span className="text-slate-600 font-normal">(when to recall)</span>
                                        </label>
                                        <input 
                                            type="text"
                                            value={editDisclosure}
                                            onChange={e => setEditDisclosure(e.target.value)}
                                            placeholder="e.g. When I need to remember..."
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50 transition-colors"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Content Editor / Viewer */}
                            <div className={clsx(
                                "relative rounded-xl border overflow-hidden transition-all duration-300",
                                editing ? "bg-slate-900 border-indigo-500/50 shadow-[0_0_30px_rgba(99,102,241,0.1)]" : "bg-[#0A0A12]/50 border-slate-800/50"
                            )}>
                                {editing ? (
                                    <textarea 
                                        value={editContent}
                                        onChange={e => setEditContent(e.target.value)}
                                        className="w-full h-96 p-6 bg-transparent text-slate-200 font-mono text-sm leading-relaxed focus:outline-none resize-y"
                                        spellCheck={false}
                                    />
                                ) : (
                                    <div className="p-6 md:p-8 prose prose-invert prose-sm max-w-none">
                                        <GlossaryHighlighter
                                          key={node.node_uuid}
                                          content={node.content || ''}
                                          glossary={node.glossary_matches || []}
                                          onNavigate={navigateTo}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Children Grid */}
                    {data.children && data.children.length > 0 && (
                        <div className="space-y-4 pt-4">
                            <div className="flex items-center gap-3 text-slate-500">
                                <h2 className="text-xs font-bold uppercase tracking-widest">
                                    {isRoot ? "Memory Clusters" : "Sub-Nodes"}
                                </h2>
                                <div className="h-px flex-1 bg-slate-800/50"></div>
                                <span className="text-xs bg-slate-800/50 px-2 py-0.5 rounded-full">{data.children.length}</span>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {data.children.map(child => (
                                    <NodeGridCard 
                                        key={`${child.domain || domain}:${child.path}`} 
                                        node={child}
                                        currentDomain={domain}
                                        onClick={() => navigateTo(child.path, child.domain)} 
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                    
                    {/* Empty State for Children */}
                    {!loading && !data.children?.length && !node && (
                        <div className="flex flex-col items-center justify-center py-20 text-slate-600 gap-4">
                            <Folder size={48} className="opacity-20" />
                            <p className="text-sm">Empty Sector</p>
                        </div>
                    )}
                </div>
            )}
         </div>
      </div>
    </div>
  );
}
