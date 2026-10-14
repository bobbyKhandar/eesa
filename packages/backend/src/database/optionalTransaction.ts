import mongoose, { type ClientSession } from "mongoose";
import { isTransactionsUnsupportedError } from "./examWriteRollback.js";

export interface TransactionSession {
  withTransaction(work: () => Promise<unknown>): Promise<unknown>;
  endSession(): Promise<void> | void;
}

/**
 * Run `work` in a multi-document transaction when the server accepts one.
 * A standalone MongoDB rejects transactions; that returns `{ supported: false }`
 * and commits nothing, so the caller can write and delete tracked ids itself.
 * Any other failure aborts the transaction and is rethrown.
 */
export async function runOptionalTransaction<TSession extends TransactionSession, T>(
  work: (session: TSession) => Promise<T>,
  startSession: () => Promise<TSession>,
): Promise<{ supported: true; value: T } | { supported: false }> {
  let session: TSession | undefined;
  try {
    session = await startSession();
    let value!: T;
    await session.withTransaction(async () => {
      value = await work(session as TSession);
    });
    return { supported: true, value };
  } catch (error) {
    if (isTransactionsUnsupportedError(error)) return { supported: false };
    throw error;
  } finally {
    if (session) await session.endSession();
  }
}

export function runOptionalMongoTransaction<T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<{ supported: true; value: T } | { supported: false }> {
  return runOptionalTransaction(work, () => mongoose.startSession() as Promise<ClientSession & TransactionSession>);
}
