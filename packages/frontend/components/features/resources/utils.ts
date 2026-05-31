export function getDifficultyColor(difficulty: string): string {
  switch (difficulty) {
    case "Easy": return "bg-green-500"
    case "Medium": return "bg-yellow-500"
    case "Hard": return "bg-red-500"
    default: return "bg-gray-500"
  }
}
