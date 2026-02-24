// Toast — lightweight in-app notification.
// Slides up from the bottom, auto-dismisses after `duration` ms.
// Used for "Link copied!" and form errors that need inline surfacing.

"use client";

import React, { useEffect, useState } from "react";
import type { Toast as ToastType } from "@/lib/types";

interface ToastProps {
  toast: ToastType;
  onDismiss: (id: string) => void;
  duration?: number; // ms; default 2800
}

const bgMap: Record<ToastType["type"], string> = {
  success: "var(--color-teal)",
  error:   "var(--color-red)",
  info:    "var(--color-blue)",
};

export function ToastItem({ toast, onDismiss, duration = 2800 }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const hideTimer = setTimeout(() => setVisible(false), duration - 300);
    const removeTimer = setTimeout(() => onDismiss(toast.id), duration);
    return () => {
      clearTimeout(hideTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, duration, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "flex items-center gap-3 rounded-crayon border-[2.5px] px-4 py-3",
        "font-crayon text-base font-bold text-white shadow-crayon",
        "transition-opacity duration-300",
        visible ? "opacity-100 toast-enter" : "opacity-0",
      ].join(" ")}
      style={{
        background: bgMap[toast.type],
        borderColor: "var(--color-border)",
        boxShadow: "3px 3px 0px var(--color-border)",
      }}
    >
      {toast.type === "success" && <span aria-hidden="true">✓</span>}
      {toast.type === "error" && <span aria-hidden="true">✗</span>}
      {toast.type === "info" && <span aria-hidden="true">ℹ</span>}
      <span>{toast.message}</span>
    </div>
  );
}

/** Container rendered once per page; stacks toasts above the bottom edge. */
interface ToastContainerProps {
  toasts: ToastType[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-0 right-0 z-[100] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

/** Hook to manage toast list state — import in page components. */
export function useToast() {
  const [toasts, setToasts] = useState<ToastType[]>([]);

  function addToast(message: string, type: ToastType["type"] = "info") {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
  }

  function dismissToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return { toasts, addToast, dismissToast };
}
