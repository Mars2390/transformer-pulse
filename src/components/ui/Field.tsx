"use client";

/** Form primitives. One place to change how every input in the app looks. */

// Re-exported so existing client imports keep working unchanged.
import { inputClass } from "./input-class";
export { inputClass };

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className = "",
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-xs font-bold text-navy">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-soft">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 sm:p-6">
      <h2 className="text-sm font-bold text-navy">{title}</h2>
      {description && (
        <p className="mt-1 text-xs text-ink-soft">{description}</p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
    >
      {message}
    </p>
  );
}

/**
 * A numeric input that shows its unit and turns amber when the value breaches a
 * standard. The warning is advisory, never blocking: a real failing reading MUST
 * be recordable, or people write down a passing number to make the form submit —
 * which is exactly the dishonesty this system exists to end.
 */
export function Measurement({
  name,
  label,
  unit,
  limit,
  required,
  error,
  value,
  onChange,
  step = "0.01",
}: {
  name: string;
  label: string;
  unit: string;
  /** e.g. { min: 100 } or { maxAbs: 0.5 } */
  limit?: { min?: number; maxAbs?: number };
  required?: boolean;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  step?: string;
}) {
  const numeric = value === "" ? null : Number(value);
  const breached =
    numeric != null &&
    Number.isFinite(numeric) &&
    ((limit?.min != null && numeric < limit.min) ||
      (limit?.maxAbs != null && Math.abs(numeric) > limit.maxAbs));

  const limitText =
    limit?.min != null
      ? `min ${limit.min} ${unit}`
      : limit?.maxAbs != null
        ? `max ±${limit.maxAbs}${unit}`
        : undefined;

  return (
    <Field
      label={label}
      htmlFor={name}
      required={required}
      error={error}
      hint={limitText}
    >
      <div className="relative">
        <input
          id={name}
          name={name}
          type="number"
          step={step}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} pr-16 ${
            breached ? "border-amber-400 bg-amber-50/60 focus:border-amber-500 focus:ring-amber-500/10" : ""
          }`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-soft">
          {unit}
        </span>
      </div>
      {breached && (
        <p className="mt-1 text-xs font-semibold text-amber-700">
          Outside the standard — record it anyway if that is the reading.
        </p>
      )}
    </Field>
  );
}
