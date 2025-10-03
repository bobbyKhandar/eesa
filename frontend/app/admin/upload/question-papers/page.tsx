"use client"
import { useRef } from "react"

export default function Page() {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const files = fileInputRef.current?.files
    if (files && files.length > 0) {
      const formData = new FormData()
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i])
      }
      const res = await fetch("/api/upload/questionpaper/massupload", {
        method: "POST",
        body: formData,
      })
      if (res.ok) {
        alert("Files uploaded successfully!")
      } else {
        alert("Upload failed.")
      }
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <form
        className="bg-white dark:bg-gray-900 p-8 rounded shadow-md flex flex-col items-center"
        onSubmit={handleSubmit}
      >
        <h2 className="text-xl font-bold mb-4">Upload Question Papers in .pdfs/.zip format</h2>
        <input
          type="file"
          multiple
          ref={fileInputRef}
          className="mb-4"
          accept=".pdf,.doc,.docx,.txt,.json,.zip"
        />
        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Upload
        </button>
      </form>
    </div>
  )
}