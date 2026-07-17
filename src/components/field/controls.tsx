"use client";

/** Big touch-friendly choice buttons for field forms. All targets ≥ 44px. */

export function ChoiceGroup({
  label,
  options,
  value,
  onChange,
  badValues = [],
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  /** Options that should read as a problem (red when chosen). */
  badValues?: readonly string[];
}) {
  return (
    <div>
      <p className="text-xs font-bold text-navy">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = value === option;
          const bad = badValues.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={`min-h-11 rounded-lg px-3.5 py-2.5 text-xs font-bold capitalize transition-colors ${
                active
                  ? bad
                    ? "bg-red-600 text-white"
                    : "bg-kplc text-white"
                  : "border border-line bg-white text-ink-soft hover:border-navy/30"
              }`}
            >
              {option.toLowerCase()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PassFailToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (passed: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`min-h-14 rounded-xl border-2 p-3 text-left transition-all ${
          value ? "border-emerald-500 bg-emerald-50" : "border-line bg-white"
        }`}
      >
        <span className={`block text-sm font-bold ${value ? "text-emerald-800" : "text-navy"}`}>
          Passed
        </span>
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`min-h-14 rounded-xl border-2 p-3 text-left transition-all ${
          !value ? "border-red-500 bg-red-50" : "border-line bg-white"
        }`}
      >
        <span className={`block text-sm font-bold ${!value ? "text-red-800" : "text-navy"}`}>
          Failed
        </span>
      </button>
    </div>
  );
}

/** The identity strip at the top of every field action form. */
export function FieldFormHeader({
  gNumber,
  serialNumber,
  detail,
}: {
  gNumber: string | null;
  serialNumber: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-kplc/15 bg-kplc/5 px-4 py-3">
      <p className="font-mono text-lg font-bold text-navy">{gNumber ?? serialNumber}</p>
      <p className="text-xs text-ink-soft">{detail}</p>
    </div>
  );
}
