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
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error creating backup:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create backup' },
      { status: 500 }
    );
  }
}
