import { NextRequest, NextResponse } from 'next/server';
import {
  restoreBackup,
  BackupNotFoundError,
  InvalidBackupIdError,
} from '@/backend/src/services/databaseBackupService';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await restoreBackup(id);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.message,
          details: result.errors,
          collectionCounts: result.collectionCounts,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error restoring backup:', error);

    if (error instanceof InvalidBackupIdError) {
      return NextResponse.json(
        { success: false, error: 'Invalid backup id' },
        { status: 400 }
      );
    }
    if (error instanceof BackupNotFoundError) {
      return NextResponse.json(
        { success: false, error: 'Backup data not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: false, error: error.message || 'Failed to restore backup' },
      { status: 500 }
    );
  }
}
