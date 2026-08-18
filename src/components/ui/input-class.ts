/**
 * The shared input styling, as a plain string.
 *
 * This lives OUTSIDE Field.tsx on purpose. Field.tsx is a "use client" module,
 * and importing a value from a client module into a SERVER component does not
 * give you the value — it gives you a client-reference proxy. Interpolated into
 * a className that renders as the literal text
 * `function(){throw Error("Attempted to call inputClass() from the server...")}`,
 * so the control silently loses every style it was supposed to have.
 *
 * Three server pages were doing exactly that. Keeping the constant in a
 * directive-free module means both sides can import it and get a string.
 */
export const inputClass =
  "min-h-11 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-navy outline-none transition-colors placeholder:text-ink-soft/45 focus:border-kplc focus:ring-4 focus:ring-kplc/10 disabled:bg-surface-2 disabled:text-ink-soft";
