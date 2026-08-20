import React from 'react';
import * as DrawerModule from '@base-ui/react/drawer';
import { cn } from '../../lib/utils';

// @base-ui/react/drawer is a CJS module: exports.Drawer = namespace object.
const D = DrawerModule.Drawer ?? DrawerModule.default?.Drawer ?? DrawerModule;

const Drawer = D.Root;
const DrawerTrigger = D.Trigger;
const DrawerClose = D.Close;

const DrawerContent = React.forwardRef(({ className, side = 'right', children, ...props }, ref) => (
  <D.Portal>
    <D.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
    <D.Popup
      ref={ref}
      className={cn(
        'fixed inset-y-0 z-50 flex flex-col border-l bg-card shadow-2xl duration-300 data-[open]:animate-in data-[open]:slide-in-from-right data-[closed]:animate-out data-[closed]:slide-out-to-right',
        side === 'right' ? 'right-0' : 'left-0',
        className
      )}
      {...props}
    >
      {children}
    </D.Popup>
  </D.Portal>
));
DrawerContent.displayName = 'DrawerContent';

export { Drawer, DrawerTrigger, DrawerClose, DrawerContent };
