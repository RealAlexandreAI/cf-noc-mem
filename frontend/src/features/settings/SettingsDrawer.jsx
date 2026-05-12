import React, { useState, useEffect, useCallback } from 'react';
import {
  Database, Server, List, Tag, Settings, X, RefreshCw
} from 'lucide-react';
import { getSettings, updateSettings, getDatabaseStatus } from '../../lib/api';

import Section from './Section';
import DatabaseSection from './DatabaseSection';
import BootUrisSection from './BootUrisSection';
import DomainsSection from './DomainsSection';
import ServerSection from './ServerSection';
import AdvancedSection from './AdvancedSection';

export default function SettingsDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [dbStatus, setDbStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [configPath, setConfigPath] = useState('');
  const [lockedFields, setLockedFields] = useState([]);
  const [activeTab, setActiveTab] = useState('general');

  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener('open-settings', handleOpen);
    return () => window.removeEventListener('open-settings', handleOpen);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsData, statusData] = await Promise.all([
        getSettings(),
        getDatabaseStatus(),
      ]);
      setSettings(settingsData.settings);
      setConfigPath(settingsData.config_path);
      setLockedFields(settingsData.locked_fields || []);
      setDbStatus(statusData);
    } catch (e) {
      console.error('Failed to load settings:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadAll();
    }
  }, [loadAll, isOpen]);

  const handleSave = async (updates) => {
    const result = await updateSettings(updates);
    await loadAll();
    return result;
  };

  const refreshDbStatus = async () => {
    try {
      setDbStatus(await getDatabaseStatus());
    } catch (e) {
      console.error('Failed to refresh DB status:', e);
    }
  };

  if (!isOpen) return null;

  const tabs = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'database', label: 'Database', icon: Database },
    { id: 'memory', label: 'Memory', icon: List },
  ];

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 animate-in fade-in duration-200"
        onClick={() => setIsOpen(false)}
      />
      <div className="fixed inset-y-0 right-0 w-[600px] bg-slate-950 border-l border-slate-800 shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
        <div className="border-b border-slate-800/80 bg-slate-900/40 px-6 pt-6 backdrop-blur-md flex-shrink-0">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-100">Settings</h1>
              <p className="text-sm text-slate-400 mt-1">
                Manage your Nocturne Memory instance configuration.
              </p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="flex gap-6">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-all ${
                    isActive
                      ? "border-indigo-500 text-indigo-300 drop-shadow-sm"
                      : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700"
                  }`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-8">
          {loading ? (
            <div className="flex items-center justify-center h-full text-slate-500">
              <RefreshCw size={20} className="animate-spin mr-2" /> Loading settings...
            </div>
          ) : (
            <>
              {activeTab === 'general' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <Section icon={Server} title="Server Configuration">
                    <ServerSection
                      settings={settings}
                      configPath={configPath}
                      lockedFields={lockedFields}
                      onSave={handleSave}
                    />
                  </Section>

                  <Section icon={Settings} title="Developer Mode / Advanced" defaultOpen={false}>
                    <AdvancedSection settings={settings} lockedFields={lockedFields} onSave={handleSave} />
                  </Section>
                </div>
              )}

              {activeTab === 'database' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <Section icon={Database} title="Database Connection">
                    <DatabaseSection
                      settings={settings}
                      dbStatus={dbStatus}
                      onRefreshStatus={refreshDbStatus}
                      onSave={handleSave}
                    />
                  </Section>
                </div>
              )}

              {activeTab === 'memory' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <Section icon={List} title="Boot URIs">
                    <BootUrisSection />
                  </Section>

                  <Section icon={Tag} title="Memory Domains">
                    <DomainsSection settings={settings} onSave={handleSave} />
                  </Section>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
