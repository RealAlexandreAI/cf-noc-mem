import React from 'react';
import { ChevronRight, Folder, FileText, Link2, Zap } from 'lucide-react';
import clsx from 'clsx';
import LevelBadge from './LevelBadge';
import { useLocale } from '../../../i18n/useLocale';

const NodeGridCard = ({ node, currentDomain, isInBoot, onBootToggle, onClick }) => {
  const { t } = useLocale();
  const isCrossDomain = node.domain && node.domain !== currentDomain;

  const handleBootClick = (e) => {
    e.stopPropagation();
    onBootToggle?.();
  };

  return (
    <button
      onClick={onClick}
      className={clsx(
        'group relative flex flex-col items-start p-5 bg-card border rounded-xl transition-all duration-300 text-left w-full h-full overflow-hidden',
        'hover:border-primary/40 hover:shadow-[0_8px_30px_rgba(0,0,0,0.35),0_0_0_1px_rgba(99,102,241,0.08)] hover:-translate-y-0.5',
        isInBoot
          ? 'border-amber-600/30'
          : isCrossDomain
            ? 'border-violet-600/30'
            : 'border-border'
      )}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="flex items-center gap-3 mb-3 w-full">
        <div className="p-2 rounded-lg bg-muted text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors flex-shrink-0">
          {node.approx_children_count > 0 ? <Folder size={18} /> : <FileText size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors break-words line-clamp-2">
            {node.name || node.path.split('/').pop()}
          </h3>
          {isCrossDomain && (
            <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 text-[10px] font-mono text-violet-400/80 bg-violet-950/40 border border-violet-800/30 rounded">
              <Link2 size={9} />
              {node.domain}://
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <LevelBadge priority={node.priority} />
          {/* Boot toggle inline */}
          <div
            onClick={handleBootClick}
            title={isInBoot ? t('memory.boot.remove') : t('memory.boot.add')}
            className={clsx(
              'p-1 rounded-md transition-all z-10',
              isInBoot
                ? 'text-amber-400 bg-amber-950/50 border border-amber-700/40 shadow-[0_0_8px_rgba(245,158,11,0.15)]'
                : 'text-muted-foreground/40 hover:text-amber-400/70 hover:bg-muted opacity-0 group-hover:opacity-100 border border-transparent'
            )}
          >
            <Zap size={13} className={isInBoot ? 'fill-amber-400' : ''} />
          </div>
        </div>
      </div>

      {node.disclosure && (
        <div className="w-full mb-2">
          <p className="text-[11px] text-indigo-400/70 leading-snug line-clamp-2 flex items-start gap-1">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-indigo-500/60 flex-shrink-0 mt-0.5">
              {t('memory.edit.disclosure')}
            </span>
            <span>{node.disclosure}</span>
          </p>
        </div>
      )}

      <div className="w-full flex-1">
        {node.content_snippet ? (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
            {node.content_snippet}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/50 italic">{t('memory.card.no_preview')}</p>
        )}
      </div>

      <ChevronRight size={14} className="absolute bottom-4 right-4 text-primary/40 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
};

export default NodeGridCard;
