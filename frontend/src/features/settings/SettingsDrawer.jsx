import React, { useState, useEffect } from 'react';
import { Globe, X, Settings as SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n, { detectLocale } from '../../i18n';
import Section from './Section';
import LocaleSection from './LocaleSection';

// Trimmed for the CF Worker build: no server config, no database settings,
// no api_token editing, no presets — everything is provisioned by wrangler.
// Settings drawer = locale (i18n) + endpoint info only.
export default function SettingsDrawer() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [locale, setLocale] = useState(null);

  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener('open-settings', handleOpen);
    return () => window.removeEventListener('open-settings', handleOpen);
  }, []);

  useEffect(() => {
    setLocale(i18n.resolvedLanguage || null);
  }, [isOpen]);

  const handleSave = async (updates) => {
    if (updates.locale === null) {
      await detectLocale();
    } else {
      await i18n.changeLanguage(updates.locale);
    }
    setLocale(updates.locale);
    return updates;
  };

  if (!isOpen) return null;

  const endpoint = window.location.origin;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 animate-in fade-in duration-200"
        onClick={() => setIsOpen(false)}
      />
      <div className="fixed inset-y-0 right-0 w-[420px] bg-slate-950 border-l border-slate-800 shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
        <div className="border-b border-slate-800/80 bg-slate-900/40 px-6 pt-6 backdrop-blur-md flex-shrink-0">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-100">{t('app.settings.title')}</h1>
              <p className="text-sm text-slate-400 mt-1">
                {t('app.settings.subtitle')}
              </p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <Section icon={Globe} title={t('app.settings.section_locale')}>
              <LocaleSection settings={{ locale }} onSave={handleSave} />
            </Section>

            <Section icon={SettingsIcon} title={t('app.settings.section_about')} defaultOpen={false}>
              <div className="space-y-3 pt-2 text-sm text-slate-400">
                <p className="text-xs leading-relaxed">
                  cf-noc-mem — stateless MCP memory server on Cloudflare Workers + D1.
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-slate-600 w-20 flex-shrink-0">MCP</span>
                    <code className="text-xs font-mono text-indigo-300/80 break-all">{endpoint}/mcp</code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-slate-600 w-20 flex-shrink-0">Panel</span>
                    <code className="text-xs font-mono text-indigo-300/80 break-all">{endpoint}/admin/</code>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Auth: Bearer token for /mcp; Cloudflare Access or Bearer for /admin.
                  Database, token and server settings are provisioned via wrangler —
                  not editable here.
                </p>
              </div>
            </Section>
          </div>
        </div>
      </div>
    </>
  );
}
