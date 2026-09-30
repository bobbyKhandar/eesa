import { z } from "../zodGlobal";
import {
  DEFAULT_PROFILE_PIC,
  DEFAULT_USER_BRANCH,
  DEFAULT_USER_ROLE,
  DEFAULT_USER_SETTINGS,
  DEFAULT_USER_STATUS,
  USER_ROLES,
  USER_STATUSES,
  isUserRole,
  isUserStatus,
} from "./userDocumentSpec.js";
/*
 * User Zod Schema definition
 * Transformed to mongoose schema using zod-to-mongoose in mongooseSchemas.ts
 * Represents a user entity with authentication info, role, and exam tracking
 *
 * Every top-level key is listed in USER_DOCUMENT_FIELDS (userDocumentSpec.ts).
 * Zod drops keys the schema does not declare, so an undeclared field is a
 * silently discarded write — see the note in that module for what that broke.
 */

const booleanSetting = z.boolean();

export const userNotificationSettingsZodSchema = z.object({
  examReminders: booleanSetting.default(true),
  gradeUpdates: booleanSetting.default(true),
  resourceUpdates: booleanSetting.default(false),
  systemUpdates: booleanSetting.default(true),
  emailNotifications: booleanSetting.default(true),
  pushNotifications: booleanSetting.default(false),
  weeklyDigest: booleanSetting.default(true),
});

export const userPreferencesZodSchema = z.object({
  theme: z.string().default(DEFAULT_USER_SETTINGS.preferences.theme),
  language: z.string().default(DEFAULT_USER_SETTINGS.preferences.language),
  timezone: z.string().default(DEFAULT_USER_SETTINGS.preferences.timezone),
  dateFormat: z.string().default(DEFAULT_USER_SETTINGS.preferences.dateFormat),
  defaultView: z.string().default(DEFAULT_USER_SETTINGS.preferences.defaultView),
});

export const userPrivacySettingsZodSchema = z.object({
  dataUsageAnalytics: booleanSetting.default(true),
  marketingCommunications: booleanSetting.default(false),
  loginAlerts: booleanSetting.default(true),
});

export const userSettingsZodSchema = z.object({
  notifications: userNotificationSettingsZodSchema.default({}),
  preferences: userPreferencesZodSchema.default({}),
  privacy: userPrivacySettingsZodSchema.default({}),
});

export const userZodSchema = z.object({
  _id: z.string().optional(),
  email: z.string().email(),
  name: z.string().optional(),
  profilePic: z.string().default(DEFAULT_PROFILE_PIC),
  role: z.enum(USER_ROLES).default(DEFAULT_USER_ROLE),

  // Account lifecycle status — the field UserRepository.getCounts() buckets on
  status: z.enum(USER_STATUSES).default(DEFAULT_USER_STATUS),

  // Programme the account belongs to
  branch: z.string().default(DEFAULT_USER_BRANCH),

  // Notification flags, UI preferences and privacy toggles
  settings: userSettingsZodSchema.default(DEFAULT_USER_SETTINGS),

  // Currently allocated/active exams
  currentAllocatedExams: z.array(z.string()).default([]), // Array of Exam IDs

  // Historical exam submissions
  submissionHistory: z.array(z.string()).default([]), // Array of ExamSubmission IDs

  // Authentication metadata
  createdAt: z.date().default(() => new Date()),
  lastLogin: z.date().optional(),
});

export type User = z.infer<typeof userZodSchema>

export type UserRoleValue = User["role"];
export type UserStatusValue = User["status"];
export type UserSettingsValue = User["settings"];

export { isUserRole, isUserStatus };
