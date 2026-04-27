import type { ReactNode } from 'react'
import { SegmentGroup } from '@ark-ui/react'

export interface SelectorOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

export interface SelectorProps<T extends string> {
  options: SelectorOption<T>[]
  value: T
  onChange: (value: T) => void
  orientation?: 'horizontal' | 'vertical'
  className?: string
  compact?: boolean
}

export function Selector<T extends string>({
  options,
  value,
  onChange,
  orientation = 'horizontal',
  className,
  compact = false,
}: SelectorProps<T>): JSX.Element {
  return (
    <div className={className ?? 'max-w-sm w-full'}>
      <SegmentGroup.Root
        orientation={orientation}
        value={value}
        onValueChange={(details: { value: string | null }) => {
          if (details.value !== null) onChange(details.value as T)
        }}
        className={compact
          ? "flex gap-0.5 bg-muted relative p-0.5 rounded-md"
          : "flex gap-0.5 bg-muted relative p-1 rounded-lg"
        }
      >
        <SegmentGroup.Indicator className={compact
          ? "bg-card z-10 rounded shadow-sm h-(--height) w-(--width) transition-all duration-200"
          : "bg-card z-10 rounded-md shadow-sm h-(--height) w-(--width) transition-all duration-200"
        } />
        {options.map((option) => (
          <SegmentGroup.Item
            key={option.value}
            value={option.value}
            className={compact
              ? "flex flex-1 items-center justify-center gap-1 select-none cursor-pointer text-xs font-medium px-2.5 py-1 z-20 text-muted-foreground hover:text-foreground data-[state=checked]:text-foreground data-disabled:cursor-not-allowed data-disabled:opacity-40 transition-colors duration-200"
              : "flex flex-1 items-center justify-center gap-1.5 select-none cursor-pointer text-sm font-medium px-4 py-2 z-20 text-muted-foreground hover:text-foreground data-[state=checked]:text-foreground data-disabled:cursor-not-allowed data-disabled:opacity-40 transition-colors duration-200"
            }
          >
            {option.icon}
            <SegmentGroup.ItemText>{option.label}</SegmentGroup.ItemText>
            <SegmentGroup.ItemControl />
            <SegmentGroup.ItemHiddenInput />
          </SegmentGroup.Item>
        ))}
      </SegmentGroup.Root>
    </div>
  )
}
