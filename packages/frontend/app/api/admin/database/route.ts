import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connect } from '@/backend/src/database/connect';
import { getManagedCollections } from '@/backend/src/database/managedCollectionModels';

export async function GET() {
  try {
    await connect();

    // Same registry that backs up/truncates the database, so the counts shown
    // here always match the collections that are actually managed.
    const collections = getManagedCollections();

    const collectionStats: Array<{ name: string; documents: number }> = [];
    let totalDocuments = 0;

    for (const { name, model } of collections) {
      try {
        const count = await model.countDocuments({});
        collectionStats.push({ name, documents: count });
        totalDocuments += count;
      } catch {
        collectionStats.push({ name, documents: 0 });
      }
    }

    let dbStats: Record<string, any> = {};
    try {
      dbStats = await mongoose.connection.db?.stats() || {};
    } catch {
      dbStats = {};
    }

    const connectionStatus = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown';
    const dataSizeFormatted = formatBytes(dbStats.dataSize || 0);

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          totalCollections: collections.length,
          totalDocuments,
          databaseSize: dataSizeFormatted,
          databaseSizeBytes: dbStats.dataSize || 0,
          connectionStatus,
          host: mongoose.connection.host || 'unknown',
          dbName: mongoose.connection.name || 'unknown',
        },
        collections: collectionStats,
      },
    });
  } catch (error: any) {
    console.error('Error fetching database stats:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch database stats' },
      { status: 500 }
    );
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}
