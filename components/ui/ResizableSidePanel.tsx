import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

interface ResizableSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  /** localStorage key for persisting width */
  storageKey: string;
  /** Default width in px */
  defaultWidth?: number;
  /** Min width in px */
  minWidth?: number;
  /** Max width in px */
  maxWidth?: number;
  /** Which side the panel appears on */
  side?: 'left' | 'right';
  /** Additional className for the panel */
  className?: string;
  /** Footer content */
  footer?: React.ReactNode;
}

export function ResizableSidePanel({
  isOpen,
  onClose,
  title,
  children,
  storageKey,
  defaultWidth = 540,
  minWidth = 380,
  maxWidth = 1200,
  side = 'right',
  className,
  footer,
}: ResizableSidePanelProps) {
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(`panel-width-${storageKey}`);
    return stored ? Math.min(Math.max(parseInt(stored, 10), minWidth), maxWidth) : defaultWidth;
  });

  const isResizing = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = side === 'right' 
        ? startX - moveEvent.clientX 
        : moveEvent.clientX - startX;
      const newWidth = Math.min(Math.max(startWidth + delta, minWidth), maxWidth);
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Persist width
      const panelEl = panelRef.current;
      if (panelEl) {
        const currentWidth = panelEl.getBoundingClientRect().width;
        localStorage.setItem(`panel-width-${storageKey}`, String(Math.round(currentWidth)));
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [width, minWidth, maxWidth, side, storageKey]);

  // Save width whenever it changes
  useEffect(() => {
    localStorage.setItem(`panel-width-${storageKey}`, String(Math.round(width)));
  }, [width, storageKey]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 top-14 md:top-16 z-[60] bg-background/50 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            initial={{ x: side === 'right' ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'right' ? '100%' : '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className={cn(
              "fixed top-14 md:top-16 bottom-0 z-[60] flex flex-col bg-background/80 backdrop-blur-[60px] border-border shadow-2xl",
              side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
              className
            )}
            style={{ width: `${width}px`, maxWidth: '95vw' }}
          >
            {/* Resize handle */}
            <div
              className={cn(
                "absolute top-0 bottom-0 w-1.5 cursor-col-resize group z-10",
                "hover:bg-emerald-500/30 active:bg-emerald-500/50 transition-colors",
                side === 'right' ? 'left-0 -ml-0.5' : 'right-0 -mr-0.5'
              )}
              onMouseDown={handleMouseDown}
            >
              <div className={cn(
                "absolute top-1/2 -translate-y-1/2 w-0.5 h-12 rounded-full bg-border group-hover:bg-emerald-400/60 transition-colors",
                side === 'right' ? 'left-0.5' : 'right-0.5'
              )} />
            </div>

            {/* Header */}
            {title && (
              <div className="p-5 bg-muted/50 border-b border-border shrink-0 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">{title}</div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-accent-foreground hover:bg-accent transition-all shrink-0 mt-0.5"
                >
                  <X size={18} />
                </button>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
              {children}
            </div>

            {/* Footer */}
            {footer && (
              <div className="border-t border-border bg-muted/50 shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
