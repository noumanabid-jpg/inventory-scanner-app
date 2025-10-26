import React, { useEffect } from 'react';

export function Dialog({ open, onOpenChange, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && open) onOpenChange?.(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);
  if (!open) return null;
  return <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) onOpenChange?.(false); }}>{children}</div>;
}
export function DialogContent({ className = "", ...props }) {
  return <div className={["dialog-content", className].join(" ")} {...props} />;
}
export function DialogHeader({ className = "", ...props }) {
  return <div className={["p-4 border-b border-gray-200", className].join(" ")} {...props} />;
}
export function DialogFooter({ className = "", ...props }) {
  return <div className={["p-4 border-t border-gray-200 flex justify-end gap-2", className].join(" ")} {...props} />;
}
export function DialogTitle({ className = "", ...props }) {
  return <h2 className={["text-xl font-semibold", className].join(" ")} {...props} />;
}
export function DialogDescription({ className = "", ...props }) {
  return <div className={["text-sm text-gray-600", className].join(" ")} {...props} />;
}