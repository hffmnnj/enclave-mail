import { Skeleton } from '@enclave/ui';
import { Alert02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import DOMPurify, { type Config } from 'dompurify';

// ---------------------------------------------------------------------------
// DOMPurify configuration — strict allowlist to prevent XSS
// ---------------------------------------------------------------------------

const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'b',
    'i',
    'strong',
    'em',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'span',
    'div',
    'table',
    'tr',
    'td',
    'th',
    'thead',
    'tbody',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'img',
  ],
  ALLOWED_ATTR: ['href', 'class', 'style', 'alt', 'src', 'width', 'height'],
  FORCE_BODY: true,
  FORBID_TAGS: ['script', 'iframe', 'object', 'form', 'input', 'textarea', 'select', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
};

/**
 * Sanitize HTML content using DOMPurify with a strict allowlist.
 * All script, iframe, object, form, and input tags are stripped.
 */
const sanitizeHtml = (html: string): string => {
  if (typeof window === 'undefined') return '';
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

const ContentSkeleton = () => (
  <div className="space-y-3 py-4" aria-busy="true" aria-label="Loading message content">
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-4/5" />
    <Skeleton className="h-4 w-3/5" />
  </div>
);

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

const ContentError = ({ message }: { message: string }) => (
  <div
    className="flex items-start gap-2 rounded-sm border border-secondary/30 bg-secondary/5 px-3 py-2.5"
    role="alert"
  >
    <HugeiconsIcon
      icon={Alert02Icon as IconSvgElement}
      size={16}
      strokeWidth={1.5}
      className="mt-0.5 shrink-0 text-secondary"
    />
    <div>
      <p className="text-ui-sm font-medium text-secondary">Decryption Error</p>
      <p className="mt-0.5 text-ui-xs text-text-secondary">{message}</p>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessageContentProps {
  htmlContent: string;
  isLoading: boolean;
  error?: string | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders sanitized HTML message body with prose styling.
 * DOMPurify is REQUIRED before rendering any HTML content to prevent XSS.
 */
const MessageContent = ({ htmlContent, isLoading, error }: MessageContentProps) => {
  if (isLoading) {
    return <ContentSkeleton />;
  }

  if (error) {
    return <ContentError message={error} />;
  }

  if (!htmlContent) {
    return (
      <p className="py-4 text-ui-sm text-text-secondary italic">No message content available.</p>
    );
  }

  const sanitized = sanitizeHtml(htmlContent);

  return (
    <div
      className="message-body py-4 text-ui-sm leading-relaxed text-text-primary [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary [&_blockquote]:italic [&_code]:rounded-sm [&_code]:bg-surface-raised [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-ui-xs [&_h1]:mb-2 [&_h1]:text-ui-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-ui-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:text-ui-sm [&_h3]:font-semibold [&_hr]:my-3 [&_hr]:border-border [&_li]:ml-4 [&_ol]:list-decimal [&_ol]:space-y-0.5 [&_p]:mb-2 [&_p]:last:mb-0 [&_pre]:overflow-x-auto [&_pre]:rounded-sm [&_pre]:bg-surface-raised [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-ui-xs [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:text-ui-xs [&_th]:border [&_th]:border-border [&_th]:bg-surface [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-ui-xs [&_th]:font-medium [&_ul]:list-disc [&_ul]:space-y-0.5"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { MessageContent };
export type { MessageContentProps };
