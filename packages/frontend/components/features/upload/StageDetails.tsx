import { CheckCircle, XCircle, Clock } from "lucide-react"
import { getStatusColor } from "./JobStatusBadge"

function getStageIcon(status: string) {
  if (status === "success") return <CheckCircle className="h-5 w-5 text-green-500" />
  if (status === "failed") return <XCircle className="h-5 w-5 text-red-500" />
  if (status === "in_progress") return <Clock className="h-5 w-5 text-blue-500 animate-spin" />
  return <Clock className="h-5 w-5 text-gray-400" />
}

function getStageBorderColor(status: string) {
  if (status === "success") return "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20"
  if (status === "failed") return "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
  if (status === "in_progress") return "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20"
  return "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
}

function StageResult({ stageName, result }: { stageName: string; result: any }) {
  if (!result) return null

  const metrics: Record<string, Record<string, string>> = {
    ocr: { pages_processed: "Pages Processed", text_blocks: "Text Blocks", confidence: "Average Confidence" },
    parsing: { questions_found: "Questions Found", sections: "Sections" },
    enrichment: { questions_enriched: "Questions Enriched", topics_identified: "Topics Identified" },
    organization: { subjects_identified: "Subjects Identified", questions_organized: "Questions Organized" },
  }

  const stageMetrics = metrics[stageName]
  if (!stageMetrics) return null

  return (
    <div className="mt-3 p-3 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
      <p className="font-medium mb-2">Results:</p>
      {Object.entries(stageMetrics).map(([key, label]) => {
        const val = result[key]
        if (val === undefined) return null
        if (key === "confidence") {
          return <p key={key} className="text-gray-600 dark:text-gray-400">{label}: {(val * 100).toFixed(1)}%</p>
        }
        return <p key={key} className="text-gray-600 dark:text-gray-400">{label}: {val}</p>
      })}
      {stageName === "organization" && result.subjects && Array.isArray(result.subjects) && (
        <div className="mt-2">
          <p className="text-gray-600 dark:text-gray-400 mb-1">Subjects:</p>
          <div className="flex flex-wrap gap-1">
            {result.subjects.map((subject: string, idx: number) => (
              <span key={idx} className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs">
                {subject}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function StageDetails({ stageName, stageData }: { stageName: string; stageData: any }) {
  if (!stageData) return null

  return (
    <div className={`p-4 border rounded-lg ${getStageBorderColor(stageData.status)}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {getStageIcon(stageData.status)}
          <h4 className="font-semibold capitalize">{stageName}</h4>
        </div>
        <span className={`px-2 py-1 text-xs rounded font-medium ${getStatusColor(stageData.status)}`}>
          {stageData.status}
        </span>
      </div>

      {stageData.error && (
        <div className="mb-3 p-2 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded text-sm">
          <p className="font-medium text-red-800 dark:text-red-200">Error:</p>
          <p className="text-red-700 dark:text-red-300">{stageData.error}</p>
        </div>
      )}

      <div className="space-y-2 text-sm">
        {stageData.start_time && (
          <p className="text-gray-600 dark:text-gray-400">
            <span className="font-medium">Started:</span> {new Date(stageData.start_time).toLocaleString()}
          </p>
        )}
        {stageData.end_time && (
          <p className="text-gray-600 dark:text-gray-400">
            <span className="font-medium">Completed:</span> {new Date(stageData.end_time).toLocaleString()}
          </p>
        )}
        {stageData.duration && (
          <p className="text-gray-600 dark:text-gray-400">
            <span className="font-medium">Duration:</span> {stageData.duration}
          </p>
        )}
      </div>

      <StageResult stageName={stageName} result={stageData.result} />
    </div>
  )
}
