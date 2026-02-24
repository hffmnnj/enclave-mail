import { cn } from '@enclave/ui';
import { useDrag } from '@use-gesture/react';
import * as React from 'react';

import { MessageRow } from './MessageRow.js';

import type { MessageListItem } from '../../hooks/use-messages.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Percentage of row width that must be swiped to trigger the action */
const SWIPE_THRESHOLD = 0.4;

/** Maximum swipe distance as percentage of row width */
const MAX_SWIPE = 0.6;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SwipeableMessageRowProps {
  message: MessageListItem;
  decryptedSubject?: string | undefined;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onClick: () => void;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  leftIndicator: React.ReactNode;
  rightIndicator: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SwipeableMessageRow = ({
  message,
  decryptedSubject,
  isSelected,
  onSelect,
  onClick,
  onSwipeLeft,
  onSwipeRight,
  leftIndicator,
  rightIndicator,
}: SwipeableMessageRowProps) => {
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [offsetX, setOffsetX] = React.useState(0);
  const [isDragging, setIsDragging] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);

  const bind = useDrag(
    ({ movement: [mx], down, cancel }) => {
      if (confirmed) {
        cancel();
        return;
      }

      const rowWidth = rowRef.current?.offsetWidth ?? 300;
      const maxPx = rowWidth * MAX_SWIPE;

      if (down) {
        setIsDragging(true);
        // Clamp movement to max swipe distance
        const clamped = Math.max(-maxPx, Math.min(maxPx, mx));
        setOffsetX(clamped);
      } else {
        setIsDragging(false);
        const threshold = rowWidth * SWIPE_THRESHOLD;

        if (mx < -threshold) {
          // Swiped left past threshold → archive
          setConfirmed(true);
          setOffsetX(-rowWidth);
          // Delay action to allow animation
          setTimeout(() => {
            onSwipeLeft();
            setOffsetX(0);
            setConfirmed(false);
          }, 200);
        } else if (mx > threshold) {
          // Swiped right past threshold → delete
          setConfirmed(true);
          setOffsetX(rowWidth);
          setTimeout(() => {
            onSwipeRight();
            setOffsetX(0);
            setConfirmed(false);
          }, 200);
        } else {
          // Snap back
          setOffsetX(0);
        }
      }
    },
    {
      axis: 'x',
      filterTaps: true,
      threshold: 10,
    },
  );

  const rowWidth = rowRef.current?.offsetWidth ?? 300;
  const swipeRatio = Math.abs(offsetX) / rowWidth;
  const isPastThreshold = swipeRatio >= SWIPE_THRESHOLD;

  return (
    <div ref={rowRef} className="relative overflow-hidden">
      {/* Background indicators — shown behind the row during swipe */}
      {offsetX < 0 && (
        <div
          className={cn(
            'absolute inset-y-0 right-0 flex items-center transition-opacity',
            isPastThreshold ? 'opacity-100' : 'opacity-60',
          )}
          style={{ width: Math.abs(offsetX) }}
        >
          {leftIndicator}
        </div>
      )}
      {offsetX > 0 && (
        <div
          className={cn(
            'absolute inset-y-0 left-0 flex items-center transition-opacity',
            isPastThreshold ? 'opacity-100' : 'opacity-60',
          )}
          style={{ width: Math.abs(offsetX) }}
        >
          {rightIndicator}
        </div>
      )}

      {/* Swipeable message row */}
      <div
        {...bind()}
        className={cn(
          'relative bg-background touch-pan-y',
          isDragging ? 'cursor-grabbing' : 'cursor-default',
          confirmed && 'transition-transform duration-200',
        )}
        style={{
          transform: `translateX(${String(offsetX)}px)`,
          transition: isDragging ? 'none' : 'transform 200ms ease',
        }}
      >
        <MessageRow
          message={message}
          decryptedSubject={decryptedSubject}
          isSelected={isSelected}
          onSelect={onSelect}
          onClick={onClick}
        />
      </div>
    </div>
  );
};

export { SwipeableMessageRow };
export type { SwipeableMessageRowProps };
