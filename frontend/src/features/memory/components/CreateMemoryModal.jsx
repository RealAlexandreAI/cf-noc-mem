import React, { useState, useRef, useEffect } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { createMemory } from '../../../lib/api';
import { useLocale } from '../../../i18n/useLocale';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';

export default function CreateMemoryModal({ onClose, onCreated, parentPath, currentDomain }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState(0);
  const [disclosure, setDisclosure] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { t } = useLocale();
  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [content]);

  const handleCreate = async () => {
    if (!content.trim() || !disclosure.trim()) return;
    setSaving(true);
    setError('');
    try {
      const result = await createMemory({
        parent_path: parentPath,
        content: content.trim(),
        priority,
        disclosure: disclosure.trim(),
        title: title.trim() || undefined,
        domain: currentDomain,
      });
      onCreated(result.uri);
      // Reset form
      setTitle('');
      setContent('');
      setPriority(0);
      setDisclosure('');
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving) return;
    setTitle('');
    setContent('');
    setPriority(0);
    setDisclosure('');
    setError('');
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-4xl w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto custom-scrollbar">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-primary/15 text-primary">
              <Plus size={20} />
            </div>
            <div>
              <DialogTitle>{t('memory.create.title')}</DialogTitle>
              <DialogDescription className="mt-0.5">{t('memory.create.subtitle')}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
            {error}
          </div>
        )}

        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Parent path (readonly) */}
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">{t('memory.create.parent_path')}</label>
              <div className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-primary/70 font-mono select-all">
                {currentDomain}://{parentPath || 'root'}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className="flex items-baseline justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('memory.create.title_label')} <span className="text-muted-foreground/60 font-normal">{t('memory.create.optional')}</span>
                </span>
                <span className="text-[10px] text-muted-foreground/60">{t('memory.create.title_hint')}</span>
              </label>
              <Input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={t('memory.create.title_placeholder')}
                className="font-mono"
              />
            </div>

            {/* Priority */}
            <div className="space-y-1.5">
              <label className="flex items-baseline justify-between">
                <span className="text-xs font-medium text-muted-foreground">{t('memory.create.priority_label')}</span>
                <span className="text-[10px] text-muted-foreground/60">{t('memory.create.priority_hint')}</span>
              </label>
              <Input
                type="number"
                min="0"
                value={priority}
                onChange={e => setPriority(parseInt(e.target.value) || 0)}
                className="font-mono"
              />
            </div>
          </div>

          {/* Disclosure */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('memory.create.disclosure_label')} <span className="text-destructive">*</span>
            </label>
            <Input
              type="text"
              value={disclosure}
              onChange={e => setDisclosure(e.target.value)}
              placeholder={t('memory.create.disclosure_placeholder')}
            />
          </div>

          {/* Content */}
          <div className="space-y-1.5 flex flex-col">
            <label className="text-xs font-medium text-muted-foreground">
              {t('memory.create.content_label')} <span className="text-destructive">*</span>
            </label>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={t('memory.create.content_placeholder')}
              className="w-full min-h-[120px] bg-muted border border-input rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors resize-none overflow-hidden"
              spellCheck={false}
            />
          </div>
        </div>

        <DialogFooter className="mt-6 pt-4 border-t border-border">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={saving}
          >
            {t('memory.create.cancel')}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={saving || !content.trim() || !disclosure.trim()}
            className="flex items-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {t('memory.create.creating')}
              </>
            ) : (
              <>
                <Plus size={16} />
                {t('memory.create.button')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
