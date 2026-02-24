import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Separator,
  cn,
} from '@enclave/ui';
import {
  Add01Icon,
  Cancel01Icon,
  Delete01Icon,
  Folder01Icon,
  FolderManagementIcon,
  LockIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import * as React from 'react';

import {
  isSystemMailbox,
  useCreateMailbox,
  useDeleteMailbox,
  useMailboxes,
} from '../../hooks/use-mailboxes.js';

import type { Mailbox } from '../../hooks/use-mailboxes.js';

// ---------------------------------------------------------------------------
// Folder row — individual mailbox in the management list
// ---------------------------------------------------------------------------

interface FolderRowProps {
  mailbox: Mailbox;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

const FolderRow = ({ mailbox, onDelete, isDeleting }: FolderRowProps) => {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const isSystem = isSystemMailbox(mailbox.type);

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-sm px-3 py-2 text-ui-sm',
        isDeleting && 'opacity-50',
      )}
    >
      <HugeiconsIcon
        icon={(isSystem ? LockIcon : Folder01Icon) as IconSvgElement}
        size={16}
        strokeWidth={1.5}
        className={cn('shrink-0', isSystem ? 'text-text-secondary' : 'text-primary')}
      />
      <span className="flex-1 truncate text-text-primary">{mailbox.name}</span>
      <span className="text-ui-xs text-text-secondary">
        {mailbox.messageCount} {mailbox.messageCount === 1 ? 'msg' : 'msgs'}
      </span>

      {!isSystem && confirmDelete && (
        <div className="flex items-center gap-1">
          <span className="text-ui-xs text-danger">Delete?</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-danger hover:bg-danger/10"
            onClick={() => {
              onDelete(mailbox.id);
              setConfirmDelete(false);
            }}
            disabled={isDeleting}
            aria-label={`Confirm delete ${mailbox.name}`}
          >
            <HugeiconsIcon icon={Delete01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-text-secondary hover:bg-surface-raised"
            onClick={() => setConfirmDelete(false)}
            aria-label="Cancel delete"
          >
            <HugeiconsIcon icon={Cancel01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
          </Button>
        </div>
      )}

      {!isSystem && !confirmDelete && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-text-secondary hover:text-danger hover:bg-danger/10"
          onClick={() => setConfirmDelete(true)}
          disabled={isDeleting}
          aria-label={`Delete ${mailbox.name}`}
        >
          <HugeiconsIcon icon={Delete01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
        </Button>
      )}

      {isSystem && (
        <span className="text-ui-xs text-text-secondary" title="System folder — cannot be deleted">
          System
        </span>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Create folder form
// ---------------------------------------------------------------------------

interface CreateFolderFormProps {
  existingNames: string[];
}

const CreateFolderForm = ({ existingNames }: CreateFolderFormProps) => {
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const createMutation = useCreateMailbox();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      setError('Folder name cannot be empty');
      return;
    }

    if (existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      setError('A folder with this name already exists');
      return;
    }

    setError(null);
    createMutation.mutate(trimmed, {
      onSuccess: () => {
        setName('');
        setError(null);
      },
      onError: (err) => {
        setError(err instanceof Error ? err.message : 'Failed to create folder');
      },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          placeholder="New folder name…"
          className="h-8 flex-1 text-ui-sm"
          maxLength={255}
          aria-label="New folder name"
          aria-invalid={error ? true : undefined}
        />
        <Button
          type="submit"
          size="sm"
          className="h-8 gap-1"
          disabled={createMutation.isPending || !name.trim()}
        >
          <HugeiconsIcon icon={Add01Icon as IconSvgElement} size={14} strokeWidth={1.5} />
          Create
        </Button>
      </div>
      {error && (
        <p className="text-ui-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {createMutation.isPending && (
        <p className="text-ui-xs text-text-secondary">Creating folder…</p>
      )}
    </form>
  );
};

// ---------------------------------------------------------------------------
// FolderManager dialog — main component
// ---------------------------------------------------------------------------

interface FolderManagerProps {
  trigger?: React.ReactNode;
}

const FolderManagerInner = ({ trigger }: FolderManagerProps) => {
  const { data: mailboxes, isLoading, error: fetchError } = useMailboxes();
  const deleteMutation = useDeleteMailbox();
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const systemMailboxes = React.useMemo(
    () => (mailboxes ?? []).filter((m) => isSystemMailbox(m.type)),
    [mailboxes],
  );

  const customMailboxes = React.useMemo(
    () => (mailboxes ?? []).filter((m) => !isSystemMailbox(m.type)),
    [mailboxes],
  );

  const existingNames = React.useMemo(() => (mailboxes ?? []).map((m) => m.name), [mailboxes]);

  const handleDelete = (id: string) => {
    setDeleteError(null);
    deleteMutation.mutate(id, {
      onError: (err) => {
        setDeleteError(err instanceof Error ? err.message : 'Failed to delete folder');
      },
    });
  };

  const defaultTrigger = (
    <button
      type="button"
      className="flex h-7 w-full items-center gap-2 rounded-sm px-3 text-ui-xs text-text-secondary transition-fast hover:bg-surface-raised hover:text-text-primary"
    >
      <HugeiconsIcon
        icon={FolderManagementIcon as IconSvgElement}
        size={14}
        strokeWidth={1.5}
        className="shrink-0"
      />
      <span>Manage Folders</span>
    </button>
  );

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger ?? defaultTrigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Folders</DialogTitle>
          <DialogDescription>
            Create custom folders to organize your mail. System folders cannot be deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 p-4">
          {/* Error states */}
          {fetchError && (
            <p className="text-ui-sm text-danger" role="alert">
              Failed to load folders:{' '}
              {fetchError instanceof Error ? fetchError.message : 'Unknown error'}
            </p>
          )}
          {deleteError && (
            <p className="text-ui-sm text-danger" role="alert">
              {deleteError}
            </p>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={`skel-${String(i)}`}
                  className="h-8 animate-pulse rounded-sm bg-surface-raised"
                />
              ))}
            </div>
          )}

          {/* System folders */}
          {!isLoading && systemMailboxes.length > 0 && (
            <div>
              <h3 className="mb-1 px-3 text-ui-xs font-medium uppercase tracking-wider text-text-secondary">
                System Folders
              </h3>
              <div className="flex flex-col gap-0.5">
                {systemMailboxes.map((m) => (
                  <FolderRow key={m.id} mailbox={m} onDelete={handleDelete} isDeleting={false} />
                ))}
              </div>
            </div>
          )}

          {!isLoading && systemMailboxes.length > 0 && <Separator />}

          {/* Custom folders */}
          {!isLoading && (
            <div>
              <h3 className="mb-1 px-3 text-ui-xs font-medium uppercase tracking-wider text-text-secondary">
                Custom Folders
              </h3>
              {customMailboxes.length === 0 ? (
                <p className="px-3 py-2 text-ui-sm text-text-secondary">
                  No custom folders yet. Create one below.
                </p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {customMailboxes.map((m) => (
                    <FolderRow
                      key={m.id}
                      mailbox={m}
                      onDelete={handleDelete}
                      isDeleting={deleteMutation.isPending && deleteMutation.variables === m.id}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {!isLoading && <Separator />}

          {/* Create new folder */}
          {!isLoading && <CreateFolderForm existingNames={existingNames} />}
        </div>

        <div className="flex justify-end border-t border-border p-4">
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Done
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const FolderManager = ({ trigger }: FolderManagerProps) => {
  return <FolderManagerInner trigger={trigger} />;
};

export { FolderManager };
export type { FolderManagerProps };
