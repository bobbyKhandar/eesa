import { NextRequest, NextResponse } from 'next/server';
import { restoreBackup } from '@/backend/src/services/databaseBackupService';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await restoreBackup(id);
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error restoring backup:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to restore backup' },
      { status: 500 }
    );
  }
}
