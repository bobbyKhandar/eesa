import { useState } from "react"
import { Button } from "@/frontend/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/frontend/components/ui/alert-dialog"
import { AlertCircle, Trash2, RefreshCw } from "lucide-react"

interface ConfirmTruncateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void>
  isTruncating: boolean
}

function FirstConfirm({ open, onOpenChange, onFirstConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; onFirstConfirm: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Are you absolutely sure?
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>This action will permanently delete ALL data from the database, including:</p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>All users and accounts</li>
              <li>All exams and submissions</li>
              <li>All resources and subjects</li>
              <li>All questions and question papers</li>
              <li>All analytics and reports</li>
              <li>All exam analyses and analysis reports</li>
              <li>All past papers and syllabi</li>
              <li>All unique questions and deduplication data</li>
              <li>All job metadata and upload sessions</li>
            </ul>
            <p className="font-semibold text-destructive mt-3">
              This action CANNOT be undone. Make sure you have a recent backup.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={onFirstConfirm}>Continue</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function SecondConfirm({ open, onOpenChange, onConfirm, isTruncating }: ConfirmTruncateDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Final Confirmation
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p className="text-base font-semibold">
              You are about to PERMANENTLY DELETE all data from the database.
            </p>
            <div className="rounded-lg bg-destructive/20 p-3 border border-destructive">
              <p className="text-sm font-mono text-destructive">
                ⚠️ This will erase everything. No recovery possible.
              </p>
            </div>
            <p className="text-sm">
              Click "Delete Everything" to proceed with database truncation.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isTruncating}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={onConfirm} disabled={isTruncating}>
            {isTruncating ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Truncating...</>
            ) : (
              <><Trash2 className="h-4 w-4 mr-2" /> Delete Everything</>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function useTruncateDialogs(onTruncate: () => Promise<void>) {
  const [showFirst, setShowFirst] = useState(false)
  const [showSecond, setShowSecond] = useState(false)
  const [isTruncating, setIsTruncating] = useState(false)

  const handleFirstConfirm = () => {
    setShowFirst(false)
    setShowSecond(true)
  }

  const handleConfirm = async () => {
    setIsTruncating(true)
    await onTruncate()
    setIsTruncating(false)
    setShowSecond(false)
  }

  const dialogs = (
    <>
      <FirstConfirm open={showFirst} onOpenChange={setShowFirst} onFirstConfirm={handleFirstConfirm} />
      <SecondConfirm open={showSecond} onOpenChange={setShowSecond} onConfirm={handleConfirm} isTruncating={isTruncating} />
    </>
  )

  return { showFirst, setShowFirst, dialogs, isTruncating }
}
