// CrayonInput — styled text input matching the hand-drawn theme.
// Includes optional label, error message, and helper text.

"use client";

import React from "react";

interface CrayonInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  /** Force uppercase input (useful for room code field) */
  uppercase?: boolean;
}

export default function CrayonInput({
  label,
  error,
  helperText,
  uppercase = false,
  id,
  className = "",
  onChange,
  ...rest
}: CrayonInputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (uppercase) {
      // Mutate target value so the parent receives the uppercased string
      e.target.value = e.target.value.toUpperCase();
    }
    onChange?.(e);
  }

  return (
    <div className="flex w-full flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className="text-base font-bold leading-none"
          style={{ color: "var(--color-ink)" }}
        >
          {label}
        </label>
      )}

      <input
        {...rest}
        id={inputId}
        onChange={handleChange}
        className={[
          "w-full rounded-crayon border-[2.5px] bg-white px-4 py-3",
          "font-crayon text-base leading-none outline-none",
          "placeholder:opacity-60",
          "transition-shadow duration-150",
          "focus:shadow-[0_0_0_3px_var(--color-blue)]",
          error
            ? "border-[var(--color-red)] shadow-[2px_2px_0px_var(--color-red)]"
            : "border-[var(--color-border)] shadow-[2px_2px_0px_var(--color-border)]",
          "min-h-[44px]", // touch-friendly
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ color: "var(--color-ink)" }}
        aria-invalid={!!error}
        aria-describedby={
          error
            ? `${inputId}-error`
            : helperText
            ? `${inputId}-helper`
            : undefined
        }
      />

      {error && (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="text-sm font-bold"
          style={{ color: "var(--color-red)" }}
        >
          ⚠ {error}
        </p>
      )}

      {!error && helperText && (
        <p
          id={`${inputId}-helper`}
          className="text-sm"
          style={{ color: "var(--color-muted)" }}
        >
          {helperText}
        </p>
      )}
    </div>
  );
}
