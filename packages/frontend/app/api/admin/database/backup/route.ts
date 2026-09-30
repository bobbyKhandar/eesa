import { NextRequest, NextResponse } from 'next/server';
import { createBackup, listBackups } from '@/backend/src/services/databaseBackupService';

export async function GET() {
  try {
    const backups = await listBackups();
    return NextResponse.json({ success: true, data: backups });
  } catch (error: any) {
    console.error('Error listing backups:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to list backups' },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const result = await createBackup();
    // A backup that could not read every collection is uploaded but flagged:
    // restoring it would clear those collections without re-inserting anything.
    return NextResponse.json({
      success: true,
      data: result,
      warning: result.status === 'failed' ? result.error : undefined,
    });
  } catch (error: any) {
    console.error('Error creating backup:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create backup' },
      { status: 500 }
    );
  }
}
