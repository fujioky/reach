'use client';

// app/_components/ui/PendingSubmitButton.tsx
// A form's submit button that shows it was pressed: while the form's action
// runs it is disabled and says what is happening, so a slow server round trip
// does not look like a click that missed.

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export function PendingSubmitButton({
  children,
  pendingLabel,
  className = '',
}: {
  children: ReactNode;
  pendingLabel: ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} inline-flex items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-80`}
    >
      {pending && (
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      )}
      {pending ? pendingLabel : children}
    </button>
  );
}
