import { Input } from "@/frontend/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/frontend/components/ui/select"
import { Search } from "lucide-react"

interface SearchFilterBarProps {
  searchQuery: string
  filterType: string
  searchPlaceholder: string
  scopeMessage: string
  onSearchChange: (v: string) => void
  onFilterChange: (v: string) => void
}

export function SearchFilterBar({
  searchQuery,
  filterType,
  searchPlaceholder,
  scopeMessage,
  onSearchChange,
  onFilterChange,
}: SearchFilterBarProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500 dark:text-gray-400" />
          <Input
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            aria-describedby="resource-search-scope"
            className="pl-8"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <Select value={filterType} onValueChange={onFilterChange}>
          <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filter resources by type">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="pyqs">Previous Papers</SelectItem>
            <SelectItem value="faculty">Faculty Notes</SelectItem>
            <SelectItem value="student">Student Notes</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p id="resource-search-scope" className="text-sm text-gray-500 dark:text-gray-400">
        {scopeMessage}
      </p>
    </div>
  )
}
