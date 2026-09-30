import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connect } from '@/backend/src/database/connect';
import { requireAdmin } from '@/frontend/lib/requestAuth';
import { getManagedCollections } from '@/backend/src/database/managedCollectionModels';
import { summarizeTruncation } from '@/backend/src/database/managedCollections';
import type { TruncationResult } from '@/backend/src/database/managedCollections';

/**
 * POST /api/admin/database/truncate
 * Truncates (deletes all data from) all collections in the database
 *
 * This is a dangerous operation. Callers must be signed in with the admin role.
 */
export async function POST(request: NextRequest) {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;

    console.log('🗑️ Starting database truncation...');

    // Connect to database
    await connect();

    console.log('✓ Connected to database');

    // Track deletion results
    const deletionResults: Record<string, TruncationResult> = {};

    // Every managed collection must be truncated. The registry keeps stats,
    // backup and truncate in sync (the new `Subject` collection used to be
    // skipped here, so truncate reported success while leaving subjects behind).
    const collections = getManagedCollections();

    console.log(`📋 Processing ${collections.length} collections...`);

    // Execute deletions sequentially with logging
    for (const { name, model } of collections) {
      try {
        // Count before deletion
        const countBefore = await model.countDocuments({});
        console.log(`  📊 ${name}: ${countBefore} documents`);

        // Delete all documents
        const result = await model.deleteMany({});
        const deletedCount = result.deletedCount || 0;

        deletionResults[name] = {
          before: countBefore,
          deleted: deletedCount
        };

        if (deletedCount < countBefore) {
          console.warn(`  ⚠ ${name}: only deleted ${deletedCount}/${countBefore} documents`);
        }

        console.log(`  ✓ ${name}: Deleted ${deletedCount} documents`);
      } catch (error) {
        console.error(`  ✗ Error deleting from ${name}:`, error);
        deletionResults[name] = {
          before: 0,
          deleted: 0,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }

    // Calculate totals
    const { totalDeleted, hasErrors } = summarizeTruncation(deletionResults);

    console.log(`✅ Truncation complete: ${totalDeleted} total documents deleted`);

    if (hasErrors) {
      return NextResponse.json(
        {
          error: 'Some collections encountered errors',
          details: deletionResults,
          totalDeleted,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Database truncated successfully - ${totalDeleted} documents deleted`,
      deletedRecords: deletionResults,
      totalDeleted,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Database truncation error:', error);
    return NextResponse.json(
      {
        error: 'Failed to truncate database',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
