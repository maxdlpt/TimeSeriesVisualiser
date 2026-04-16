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
}

export function Selector<T extends string>({
  options,
  value,
  onChange,
  orientation = 'horizontal',
  className
}: SelectorProps<T>): JSX.Element {
  return (
    <div className={className ?? 'max-w-sm w-full'}>
      <SegmentGroup.Root
        orientation={orientation}
        value={value}
        onValueChange={(details: { value: string | null }) => {
          if (details.value !== null) onChange(details.value as T)
        }}
        className="flex gap-0.5 bg-gray-100 dark:bg-gray-900 relative p-1 rounded-lg"
      >
        <SegmentGroup.Indicator className="bg-white dark:bg-gray-800 z-10 rounded-md shadow-sm h-(--height) w-(--width) transition-all duration-200" />
        {options.map((option) => (
          <SegmentGroup.Item
            key={option.value}
            value={option.value}
            className="flex flex-1 items-center justify-center gap-1.5 select-none cursor-pointer text-sm font-medium px-4 py-2 z-20 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white data-[state=checked]:text-gray-900 dark:data-[state=checked]:text-white data-disabled:cursor-not-allowed data-disabled:opacity-40 transition-colors duration-200"
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
