import { NextRequest, NextResponse } from 'next/server';
import {
  getBackup,
  deleteBackup,
  BackupNotFoundError,
  InvalidBackupIdError,
} from '@/backend/src/services/databaseBackupService';
import { requireAdmin } from '@/frontend/lib/requestAuth';

function errorResponse(error: any, fallback: string) {
  if (error instanceof InvalidBackupIdError) {
    return NextResponse.json(
      { success: false, error: 'Invalid backup id' },
      { status: 400 }
    );
  }
  if (error instanceof BackupNotFoundError) {
    return NextResponse.json(
      { success: false, error: 'Backup not found' },
      { status: 404 }
    );
  }
  return NextResponse.json(
    { success: false, error: error?.message || fallback },
    { status: 500 }
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;

    const { id } = await params;
    const backup = await getBackup(id);
    if (!backup) {
      return NextResponse.json(
        { success: false, error: 'Backup not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: backup });
  } catch (error: any) {
    console.error('Error getting backup:', error);
    return errorResponse(error, 'Failed to get backup');
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;

    const { id } = await params;
    const result = await deleteBackup(id);

    // S3 can accept the delete request and still report keys it refused to
    // remove. Reporting that as a success would drop the row while the backup
    // objects are still stored, so the conflict carries the keys that remain.
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.message,
          failedKeys: result.failedKeys,
          deletedObjects: result.deletedObjects,
          failedObjects: result.failedObjects,
          errors: result.errors,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error deleting backup:', error);
    return errorResponse(error, 'Failed to delete backup');
  }
}
