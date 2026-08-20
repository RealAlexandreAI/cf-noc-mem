import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';

export default function ConfirmModal({
  title = 'Confirm',
  message = 'Are you sure?',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}) {
  const isDanger = variant === 'danger';

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel?.()}>
      <DialogContent className="max-w-md">
        <div className="flex items-start gap-4 mb-4">
          {isDanger && (
            <div className="w-10 h-10 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={20} className="text-destructive" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="mt-1">{message}</DialogDescription>
          </div>
        </div>
        <DialogFooter className="pt-2 border-t border-border">
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={isDanger ? 'destructive' : 'default'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
