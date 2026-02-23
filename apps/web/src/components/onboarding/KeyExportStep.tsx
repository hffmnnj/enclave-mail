import { Button, cn } from '@enclave/ui';
import { Download04Icon, Tick01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Key file download helper
// ---------------------------------------------------------------------------

const downloadKeyFile = (keyExportBundle: string): void => {
  const blob = new Blob([keyExportBundle], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'enclave-keys.json';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

// ---------------------------------------------------------------------------
// KeyExportStep
// ---------------------------------------------------------------------------

interface KeyExportStepProps {
  keyExportBundle: string;
  onNext: () => void;
}

const KeyExportStep = ({ keyExportBundle, onNext }: KeyExportStepProps) => {
  const [hasDownloaded, setHasDownloaded] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);

  const canProceed = hasDownloaded && confirmed;

  const handleDownload = () => {
    downloadKeyFile(keyExportBundle);
    setHasDownloaded(true);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Title */}
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          icon={Download04Icon as IconSvgElement}
          size={20}
          strokeWidth={1.5}
          className="text-primary"
        />
        <h2 className="text-ui-md font-semibold text-text-primary">Save Your Key Backup</h2>
      </div>

      {/* Warning */}
      <div className="rounded-sm border border-amber/30 bg-amber/10 p-3">
        <p className="text-ui-xs text-amber leading-relaxed">
          <span className="font-semibold">
            You MUST download your key backup file before proceeding.
          </span>
          <br />
          Without this file, you cannot recover your account if you forget your passphrase.
        </p>
      </div>

      {/* Download button */}
      <Button type="button" size="lg" className="w-full" onClick={handleDownload}>
        <HugeiconsIcon icon={Download04Icon as IconSvgElement} size={16} strokeWidth={1.5} />
        Download Key Backup
      </Button>

      {/* Download confirmation */}
      {hasDownloaded && (
        <div className="flex items-center gap-1.5 text-success">
          <HugeiconsIcon icon={Tick01Icon as IconSvgElement} size={16} strokeWidth={1.5} />
          <span className="text-ui-xs">Key file downloaded</span>
        </div>
      )}

      {/* Checkbox — disabled until download */}
      <label
        className={cn(
          'flex items-start gap-2 cursor-pointer select-none',
          !hasDownloaded && 'opacity-50 cursor-not-allowed',
        )}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          disabled={!hasDownloaded}
          className="mt-0.5 h-4 w-4 rounded-sm border border-border bg-surface accent-primary"
          aria-describedby="key-export-checkbox-label"
        />
        <span
          id="key-export-checkbox-label"
          className="text-ui-xs text-text-secondary leading-relaxed"
        >
          I have saved my key backup file in a safe place
        </span>
      </label>

      {/* Continue */}
      <Button type="button" size="lg" disabled={!canProceed} onClick={onNext} className="w-full">
        Continue
      </Button>
    </div>
  );
};

export { KeyExportStep };
export type { KeyExportStepProps };
