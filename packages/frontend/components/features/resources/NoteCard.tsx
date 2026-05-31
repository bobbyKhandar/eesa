import { Button } from "@/frontend/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "@/frontend/components/ui/card"
import { Badge } from "@/frontend/components/ui/badge"
import { Star, User, Calendar, FileText, Download, Eye, ThumbsUp } from "lucide-react"

export interface Note {
  id: number
  title: string
  description: string
  uploadedBy: string
  uploadDate: string
  fileType: string
  fileSize: string
  downloadCount: number
  rating: number
  tags: string[]
  verified?: boolean
  likes?: number
}

interface NoteCardProps {
  note: Note
  showLike?: boolean
}

export function NoteCard({ note, showLike }: NoteCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">{note.title}</CardTitle>
              {note.verified && <Badge className="bg-green-500">Verified</Badge>}
            </div>
            <CardDescription className="mt-1">{note.description}</CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-medium">{note.rating}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-1">
            <User className="h-4 w-4" />
            <span>{note.uploadedBy}</span>
          </div>
          <div className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            <span>{new Date(note.uploadDate).toLocaleDateString()}</span>
          </div>
          <div className="flex items-center gap-1">
            <FileText className="h-4 w-4" />
            <span>{note.fileType} &bull; {note.fileSize}</span>
          </div>
          <div className="flex items-center gap-1">
            <Download className="h-4 w-4" />
            <span>{note.downloadCount} downloads</span>
          </div>
          {showLike && note.likes !== undefined && (
            <div className="flex items-center gap-1">
              <ThumbsUp className="h-4 w-4" />
              <span>{note.likes} likes</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {note.tags.map((tag, index) => (
            <Badge key={index} variant="outline" className="text-xs">{tag}</Badge>
          ))}
        </div>
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button size="sm" className="gap-1">
          <Download className="h-4 w-4" /> Download
        </Button>
        <Button variant="outline" size="sm" className="gap-1 bg-transparent">
          <Eye className="h-4 w-4" /> Preview
        </Button>
        {showLike && (
          <Button variant="outline" size="sm" className="gap-1 bg-transparent">
            <ThumbsUp className="h-4 w-4" /> Like
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}
