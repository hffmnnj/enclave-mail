import { Button, cn } from '@enclave/ui';
import { Copy01Icon, Tick01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Port data
// ---------------------------------------------------------------------------

interface PortInfo {
  port: number;
  protocol: string;
  purpose: string;
}

const REQUIRED_PORTS: PortInfo[] = [
  { port: 25, protocol: 'SMTP', purpose: 'Inbound mail from other servers' },
  { port: 587, protocol: 'SMTP Submission', purpose: 'Outbound mail from clients' },
  { port: 993, protocol: 'IMAPS', purpose: 'Secure IMAP for email clients' },
];

// ---------------------------------------------------------------------------
// Firewall tool commands
// ---------------------------------------------------------------------------

type FirewallTool = 'ufw' | 'iptables' | 'firewalld';

const FIREWALL_TOOLS: { id: FirewallTool; label: string }[] = [
  { id: 'ufw', label: 'ufw' },
  { id: 'iptables', label: 'iptables' },
  { id: 'firewalld', label: 'firewalld' },
];

const FIREWALL_COMMANDS: Record<FirewallTool, string> = {
  ufw: `sudo ufw allow 25/tcp
sudo ufw allow 587/tcp
sudo ufw allow 993/tcp
sudo ufw reload`,
  iptables: `sudo iptables -A INPUT -p tcp --dport 25 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 587 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 993 -j ACCEPT`,
  firewalld: `sudo firewall-cmd --permanent --add-port=25/tcp
sudo firewall-cmd --permanent --add-port=587/tcp
sudo firewall-cmd --permanent --add-port=993/tcp
sudo firewall-cmd --reload`,
};

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable — fail silently
    }
  };

  return (
    <button
      type="button"
      className="flex items-center gap-1 text-ui-xs text-text-secondary hover:text-text-primary transition-fast"
      onClick={() => void handleCopy()}
      aria-label={copied ? 'Copied' : 'Copy commands'}
    >
      <HugeiconsIcon
        icon={(copied ? Tick01Icon : Copy01Icon) as IconSvgElement}
        size={14}
        strokeWidth={1.5}
      />
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
};

// ---------------------------------------------------------------------------
// FirewallStep
// ---------------------------------------------------------------------------

interface FirewallStepProps {
  onNext: () => void;
}

const FirewallStep = ({ onNext }: FirewallStepProps) => {
  const [checkedPorts, setCheckedPorts] = React.useState<Record<number, boolean>>({});
  const [selectedTool, setSelectedTool] = React.useState<FirewallTool>('ufw');

  const togglePort = (port: number) => {
    setCheckedPorts((prev) => ({ ...prev, [port]: !prev[port] }));
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h2 className="text-ui-lg font-medium text-text-primary">Open Firewall Ports</h2>
        <p className="text-ui-sm text-text-secondary">
          Your mail server needs these ports open to send and receive email. Open them on your VPS
          firewall, then check them off below.
        </p>
      </div>

      {/* Port checklist */}
      <div className="flex flex-col gap-2">
        {REQUIRED_PORTS.map(({ port, protocol, purpose }) => (
          <label
            key={port}
            className="flex items-start gap-2.5 cursor-pointer select-none rounded-sm border border-border bg-background p-3 hover:border-text-secondary/30 transition-fast"
          >
            <input
              type="checkbox"
              checked={checkedPorts[port] === true}
              onChange={() => togglePort(port)}
              className="mt-0.5 h-4 w-4 rounded-sm border border-border bg-surface accent-primary shrink-0"
              aria-label={`Port ${String(port)} — ${protocol}`}
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-ui-sm text-text-primary font-medium">
                Port {port} <span className="text-text-secondary font-normal">— {protocol}</span>
              </span>
              <span className="text-ui-xs text-text-secondary">{purpose}</span>
            </div>
          </label>
        ))}
      </div>

      {/* Firewall tool selector */}
      <div className="flex flex-col gap-2">
        <span className="text-ui-xs text-text-secondary">Firewall tool</span>
        <div className="flex gap-1">
          {FIREWALL_TOOLS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={cn(
                'rounded-sm border px-3 py-1.5 text-ui-xs font-mono transition-fast',
                selectedTool === id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-surface text-text-secondary hover:text-text-primary hover:border-text-secondary/30',
              )}
              onClick={() => setSelectedTool(id)}
              aria-pressed={selectedTool === id}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Command block */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-ui-xs text-text-secondary">Commands</span>
          <CopyButton text={FIREWALL_COMMANDS[selectedTool]} />
        </div>
        <pre className="bg-background border border-border rounded-sm p-3 font-mono text-ui-xs text-text-primary overflow-x-auto whitespace-pre">
          {FIREWALL_COMMANDS[selectedTool]}
        </pre>
      </div>

      {/* Continue */}
      <Button type="button" size="lg" onClick={onNext} className="w-full">
        Continue
      </Button>
    </div>
  );
};

export { FirewallStep };
export type { FirewallStepProps };
