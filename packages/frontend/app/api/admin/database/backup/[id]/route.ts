import { NextRequest, NextResponse } from 'next/server';
import { getBackup, deleteBackup } from '@/backend/src/services/databaseBackupService';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to get backup' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await deleteBackup(id);
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error deleting backup:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete backup' },
      { status: 500 }
    );
  }
}
