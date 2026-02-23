import { cn } from '@enclave/ui';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Email validation
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidEmail = (email: string): boolean => EMAIL_REGEX.test(email.trim());

// ---------------------------------------------------------------------------
// Chip component
// ---------------------------------------------------------------------------

interface ChipProps {
  email: string;
  onRemove: () => void;
}

const Chip = ({ email, onRemove }: ChipProps) => (
  <span className="inline-flex items-center gap-1 rounded-sm bg-surface px-1.5 py-0.5 text-ui-xs font-mono text-text-primary transition-colors">
    <span className="max-w-[200px] truncate">{email}</span>
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex shrink-0 items-center justify-center rounded-sm p-0.5 text-text-secondary transition-colors hover:bg-border hover:text-text-primary"
      aria-label={`Remove ${email}`}
    >
      <HugeiconsIcon icon={Cancel01Icon as IconSvgElement} size={10} strokeWidth={2} />
    </button>
  </span>
);

// ---------------------------------------------------------------------------
// RecipientInput component
// ---------------------------------------------------------------------------

interface RecipientInputProps {
  value: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string | undefined;
  label: string;
}

const RecipientInput = ({ value, onChange, placeholder, label }: RecipientInputProps) => {
  const [inputValue, setInputValue] = React.useState('');
  const [isInvalid, setIsInvalid] = React.useState(false);
  const [isShaking, setIsShaking] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const addEmail = React.useCallback(
    (raw: string) => {
      const email = raw.trim().replace(/,$/, '').trim();
      if (!email) return;

      if (!isValidEmail(email)) {
        setIsInvalid(true);
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 400);
        return;
      }

      // Prevent duplicates
      if (value.includes(email)) {
        setInputValue('');
        setIsInvalid(false);
        return;
      }

      onChange([...value, email]);
      setInputValue('');
      setIsInvalid(false);
    },
    [value, onChange],
  );

  const removeEmail = React.useCallback(
    (index: number) => {
      const next = [...value];
      next.splice(index, 1);
      onChange(next);
    },
    [value, onChange],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
        if (inputValue.trim()) {
          e.preventDefault();
          addEmail(inputValue);
        }
      }

      // Backspace on empty input removes last chip
      if (e.key === 'Backspace' && !inputValue && value.length > 0) {
        removeEmail(value.length - 1);
      }
    },
    [inputValue, addEmail, removeEmail, value.length],
  );

  const handleBlur = React.useCallback(() => {
    if (inputValue.trim()) {
      addEmail(inputValue);
    }
  }, [inputValue, addEmail]);

  const handleChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (val.trim()) {
      setIsInvalid(false);
    }
  }, []);

  const focusInput = React.useCallback(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <fieldset className="flex items-start gap-1.5 border-0 p-0 m-0 min-w-0">
      <legend className="sr-only">{label} recipients</legend>
      <label
        htmlFor={`recipient-${label}`}
        className="shrink-0 pt-1.5 text-ui-xs text-text-secondary"
      >
        {label}:
      </label>
      <div
        className={cn(
          'flex min-h-[28px] flex-1 flex-wrap items-center gap-1 rounded-sm border bg-background px-1.5 py-0.5 transition-colors focus-within:border-primary',
          isInvalid ? 'border-danger' : 'border-border',
          isShaking && 'animate-shake',
        )}
        onClick={focusInput}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') focusInput();
        }}
        role="presentation"
      >
        {value.map((email, i) => (
          <Chip key={`${email}-${String(i)}`} email={email} onRemove={() => removeEmail(i)} />
        ))}
        <input
          ref={inputRef}
          id={`recipient-${label}`}
          type="email"
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={
            value.length === 0 ? (placeholder ?? `Add ${label.toLowerCase()} recipients`) : ''
          }
          className="min-w-[120px] flex-1 border-0 bg-transparent px-0.5 py-0.5 font-mono text-ui-xs text-text-primary outline-none placeholder:text-text-secondary/40"
          aria-label={`${label} recipients`}
          autoComplete="email"
        />
      </div>
    </fieldset>
  );
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { RecipientInput };
export type { RecipientInputProps };
