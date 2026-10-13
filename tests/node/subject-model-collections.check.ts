import assert from "node:assert/strict";

import { getSubjectModel as getLegacySubjectModel } from "../../packages/backend/src/database/mongooseSchemas.ts";
import { getSubjectModel as getFeatureSubjectModel } from "../../packages/backend/src/database/newFeatureModels.ts";
import { getManagedCollections } from "../../packages/backend/src/database/managedCollectionModels.ts";
import {
  FEATURE_SUBJECT_COLLECTION,
  LEGACY_SUBJECT_COLLECTION,
} from "../../packages/backend/src/database/subjectCollections.ts";

const legacy = getLegacySubjectModel();
const feature = getFeatureSubjectModel();

assert.equal(legacy.collection.collectionName, LEGACY_SUBJECT_COLLECTION);
assert.equal(feature.collection.collectionName, FEATURE_SUBJECT_COLLECTION);
assert.notEqual(legacy.collection.collectionName, feature.collection.collectionName);

const collections = getManagedCollections();
const physicalNames = collections.map(({ model }) => model.collection.collectionName);
assert.equal(new Set(physicalNames).size, physicalNames.length);
assert.ok(physicalNames.includes(LEGACY_SUBJECT_COLLECTION));
assert.ok(physicalNames.includes(FEATURE_SUBJECT_COLLECTION));

const byRegistryName = new Map(collections.map(({ name, model }) => [name, model.collection.collectionName]));
assert.equal(byRegistryName.get("subjects"), "subjects");
assert.equal(byRegistryName.get("Subject"), "featureSubjects");
