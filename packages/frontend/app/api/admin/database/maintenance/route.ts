import { NextRequest, NextResponse } from 'next/server';
import {
  InvalidMaintenanceActionError,
  runMaintenanceAction,
} from '@/backend/src/services/databaseMaintenanceService';
import { requireAdmin } from '@/frontend/lib/requestAuth';

/**
 * POST /api/admin/database/maintenance
 * Runs an allowlisted, read-only database maintenance diagnostic.
 *
 * Body: { action: "check-integrity" | "validate-constraints", sampleSize?: number }
 *
 * Safeguards: admin role required, the action must be in the service
 * allowlist (anything else is a 400 before any database work), and the
 * service performs no writes — counts, index listings, and in-memory
 * validation of a bounded document sample only.
 */
export async function POST(request: NextRequest) {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;

    const body = await request.json().catch(() => null);
    const result = await runMaintenanceAction(body?.action, {
      sampleSize: body?.sampleSize,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error running database maintenance:', error);

    if (error instanceof InvalidMaintenanceActionError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: error.message || 'Failed to run maintenance operation' },
      { status: 500 }
    );
  }
}
