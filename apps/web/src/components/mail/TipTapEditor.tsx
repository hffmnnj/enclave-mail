import { Button, Separator, cn } from '@enclave/ui';
import {
  Attachment01Icon,
  LeftToRightBlockQuoteIcon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  Link01Icon,
  TextBoldIcon,
  TextItalicIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import type { Editor } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Toolbar button
// ---------------------------------------------------------------------------

interface ToolbarButtonProps {
  icon: IconSvgElement;
  label: string;
  isActive?: boolean | undefined;
  disabled?: boolean | undefined;
  onClick: () => void;
}

const ToolbarButton = ({ icon, label, isActive, disabled, onClick }: ToolbarButtonProps) => (
  <Button
    variant="ghost"
    size="icon"
    className={cn('h-6 w-6', isActive && 'bg-surface-raised text-primary')}
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    aria-pressed={isActive}
    type="button"
  >
    <HugeiconsIcon icon={icon} size={13} strokeWidth={1.5} />
  </Button>
);

// ---------------------------------------------------------------------------
// Formatting toolbar
// ---------------------------------------------------------------------------

interface ToolbarProps {
  editor: Editor | null;
  onAttach?: (() => void) | undefined;
}

const Toolbar = ({ editor, onAttach }: ToolbarProps) => {
  if (!editor) return null;

  const handleLink = React.useCallback(() => {
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    const url = window.prompt('Enter URL:');
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  }, [editor]);

  return (
    <div className="flex items-center gap-0.5 border-b border-border bg-surface/50 px-2 py-1">
      <ToolbarButton
        icon={TextBoldIcon as IconSvgElement}
        label="Bold"
        isActive={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolbarButton
        icon={TextItalicIcon as IconSvgElement}
        label="Italic"
        isActive={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />

      <Separator orientation="vertical" className="mx-1 h-4" />

      <ToolbarButton
        icon={LeftToRightListBulletIcon as IconSvgElement}
        label="Bullet list"
        isActive={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        icon={LeftToRightListNumberIcon as IconSvgElement}
        label="Numbered list"
        isActive={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        icon={LeftToRightBlockQuoteIcon as IconSvgElement}
        label="Blockquote"
        isActive={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />

      <Separator orientation="vertical" className="mx-1 h-4" />

      <ToolbarButton
        icon={Link01Icon as IconSvgElement}
        label="Link"
        isActive={editor.isActive('link')}
        onClick={handleLink}
      />

      <Separator orientation="vertical" className="mx-1 h-4" />

      <ToolbarButton
        icon={Attachment01Icon as IconSvgElement}
        label="Attach file"
        onClick={() => onAttach?.()}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// TipTap editor wrapper
// ---------------------------------------------------------------------------

interface TipTapEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string | undefined;
  autoFocus?: boolean | undefined;
  onAttach?: (() => void) | undefined;
}

const TipTapEditor = ({
  content,
  onChange,
  placeholder,
  autoFocus,
  onAttach,
}: TipTapEditorProps) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Write your message...',
      }),
    ],
    content: content || '',
    autofocus: autoFocus ? 'end' : false,
    editable: true,
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
  });

  return (
    <div className="flex flex-col rounded-sm border border-border">
      <Toolbar editor={editor} onAttach={onAttach} />
      <EditorContent
        editor={editor}
        className={cn(
          'prose-invert min-h-[250px] px-3 py-2',
          // TipTap editor styling
          '[&_.tiptap]:outline-none',
          '[&_.tiptap]:min-h-[250px]',
          '[&_.tiptap]:text-ui-sm',
          '[&_.tiptap]:text-text-primary',
          '[&_.tiptap]:leading-relaxed',
          // Paragraph spacing
          '[&_.tiptap_p]:my-1',
          '[&_.tiptap_p:first-child]:mt-0',
          // Headings
          '[&_.tiptap_h1]:text-ui-lg [&_.tiptap_h1]:font-semibold [&_.tiptap_h1]:mt-4 [&_.tiptap_h1]:mb-2',
          '[&_.tiptap_h2]:text-ui-md [&_.tiptap_h2]:font-semibold [&_.tiptap_h2]:mt-3 [&_.tiptap_h2]:mb-1.5',
          '[&_.tiptap_h3]:text-ui-base [&_.tiptap_h3]:font-semibold [&_.tiptap_h3]:mt-2 [&_.tiptap_h3]:mb-1',
          // Lists
          '[&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-5 [&_.tiptap_ul]:my-1',
          '[&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-5 [&_.tiptap_ol]:my-1',
          '[&_.tiptap_li]:my-0.5',
          // Blockquote
          '[&_.tiptap_blockquote]:border-l-2 [&_.tiptap_blockquote]:border-border [&_.tiptap_blockquote]:pl-3 [&_.tiptap_blockquote]:my-2 [&_.tiptap_blockquote]:text-text-secondary',
          // Code
          '[&_.tiptap_code]:rounded-sm [&_.tiptap_code]:bg-surface [&_.tiptap_code]:px-1 [&_.tiptap_code]:py-0.5 [&_.tiptap_code]:font-mono [&_.tiptap_code]:text-ui-xs',
          '[&_.tiptap_pre]:rounded-sm [&_.tiptap_pre]:bg-surface [&_.tiptap_pre]:p-3 [&_.tiptap_pre]:my-2 [&_.tiptap_pre]:font-mono [&_.tiptap_pre]:text-ui-xs [&_.tiptap_pre]:overflow-x-auto',
          // Links
          '[&_.tiptap_a]:text-primary [&_.tiptap_a]:underline',
          // Placeholder
          '[&_.tiptap_.is-editor-empty:first-child::before]:text-text-secondary/40',
          '[&_.tiptap_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
          '[&_.tiptap_.is-editor-empty:first-child::before]:float-left',
          '[&_.tiptap_.is-editor-empty:first-child::before]:h-0',
          '[&_.tiptap_.is-editor-empty:first-child::before]:pointer-events-none',
        )}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { TipTapEditor };
export type { TipTapEditorProps };
