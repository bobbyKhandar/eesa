/**
 * Runs before the repository modules load. `connect()` throws when
 * `mongodb_url` is missing, and otherwise calls `mongoose.connect`. The
 * behavioral tests stub the model and must not open a real socket.
 */
process.env.mongodb_url ??= "mongodb://127.0.0.1:27017/eesa-read-failure-test";

import mongoose from "mongoose";

// "connecting" makes connect() return before it opens a socket or splits
// subject collections. The tests stub the model and never need a live database.
mongoose.connection.readyState = 2;

const originalConnect = mongoose.connect.bind(mongoose);
mongoose.connect = (async () => mongoose.connection) as typeof mongoose.connect;

export function restoreMongooseConnect(): void {
  mongoose.connect = originalConnect;
  mongoose.connection.readyState = 0;
}
