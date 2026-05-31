/**
 * User Repository - User Operations
 * Handles all database operations related to users
 */

import { Types } from "mongoose";
import { connect } from "../connect.js";
import { getUserModel } from "../mongooseSchemas.js";
import { userZodSchema } from "../schemas/userSchemaZod.js";
import type { User } from "../schemas/userSchemaZod.js";

export class UserRepository {
  private model: ReturnType<typeof getUserModel>;

  constructor() {
    this.model = getUserModel();
  }

  /**
   * Create a new user
   */
  async create(data: User): Promise<{ success: boolean; userId?: string; error?: string }> {
    try {
      await connect();

      // Validate with Zod
      const validation = userZodSchema.safeParse(data);
      if (!validation.success) {
        const errorMessages = validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: `Validation failed: ${errorMessages}` };
      }

      // Check if user already exists
      const existingUser = await this.model.findOne({ email: data.email });
      if (existingUser) {
        return { success: false, error: 'User with this email already exists' };
      }

      const userData: any = { ...validation.data };
      if (!userData._id) {
        userData._id = new Types.ObjectId().toString();
      }
      const savedUsers = await this.model.insertMany([userData]);
      const savedUser = savedUsers[0];

      console.log('User created:', savedUser._id || userData._id);
      return { success: true, userId: (savedUser._id || userData._id).toString() };
    } catch (error) {
      console.error('Error creating user:', error);
      return { success: false, error: 'Failed to create user' };
    }
  }

  /**
   * Get user by ID
   */
  async getById(userId: string): Promise<User | null> {
    try {
      await connect();
      const user = await this.model.findById(userId).lean();
      return user as User | null;
    } catch (error) {
      console.error('Error getting user by ID:', error);
      return null;
    }
  }

  /**
   * Get user by email
   */
  async getByEmail(email: string): Promise<User | null> {
    try {
      await connect();
      const user = await this.model.findOne({ email }).lean();
      return user as User | null;
    } catch (error) {
      console.error('Error getting user by email:', error);
      return null;
    }
  }

  /**
   * Get users by role
   */
  async getByRole(role: 'student' | 'teacher' | 'admin', limit: number = 100): Promise<User[]> {
    try {
      await connect();
      const users = await this.model.find({ role }).limit(limit).lean();
      return users as User[];
    } catch (error) {
      console.error('Error getting users by role:', error);
      return [];
    }
  }

  /**
   * Get all students (convenience method)
   */
  async getStudents(limit: number = 100): Promise<User[]> {
    return this.getByRole('student', limit);
  }

  /**
   * Get all teachers (convenience method)
   */
  async getTeachers(limit: number = 100): Promise<User[]> {
    return this.getByRole('teacher', limit);
  }

  /**
   * Update user
   */
  async update(
    userId: string, 
    updates: Partial<Omit<User, '_id' | 'createdAt'>>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      // Validate updates with Zod (partial)
      const validation = userZodSchema.partial().safeParse(updates);
      if (!validation.success) {
        const errorMessages = validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        return { success: false, error: `Validation failed: ${errorMessages}` };
      }

      const result = await this.model.updateOne(
        { _id: userId },
        { $set: validation.data }
      );

      if (result.matchedCount === 0) {
        return { success: false, error: 'User not found' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error updating user:', error);
      return { success: false, error: 'Failed to update user' };
    }
  }

  /**
   * Update last login time
   */
  async updateLastLogin(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      await this.model.updateOne(
        { _id: userId },
        { $set: { lastLogin: new Date() } }
      );

      return { success: true };
    } catch (error) {
      console.error('Error updating last login:', error);
      return { success: false, error: 'Failed to update last login' };
    }
  }

  /**
   * Assign exam to user (add to currentAllocatedExams)
   */
  async assignExam(userId: string, examId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      const result = await this.model.updateOne(
        { _id: userId },
        { $addToSet: { currentAllocatedExams: examId } }
      );

      if (result.matchedCount === 0) {
        return { success: false, error: 'User not found' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error assigning exam to user:', error);
      return { success: false, error: 'Failed to assign exam' };
    }
  }

  /**
   * Assign exam to multiple users
   */
  async assignExamToMany(
    userIds: string[], 
    examId: string
  ): Promise<{ success: boolean; assignedCount?: number; error?: string }> {
    try {
      await connect();

      const result = await this.model.updateMany(
        { _id: { $in: userIds } },
        { $addToSet: { currentAllocatedExams: examId } }
      );

      return { success: true, assignedCount: result.modifiedCount };
    } catch (error) {
      console.error('Error assigning exam to users:', error);
      return { success: false, error: 'Failed to assign exam to users' };
    }
  }

  /**
   * Remove exam from user's allocated exams
   */
  async unassignExam(userId: string, examId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      await this.model.updateOne(
        { _id: userId },
        { $pull: { currentAllocatedExams: examId } }
      );

      return { success: true };
    } catch (error) {
      console.error('Error unassigning exam from user:', error);
      return { success: false, error: 'Failed to unassign exam' };
    }
  }

  /**
   * Add submission to user's history
   */
  async addSubmissionToHistory(
    userId: string, 
    submissionId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      await this.model.updateOne(
        { _id: userId },
        { $addToSet: { submissionHistory: submissionId } }
      );

      return { success: true };
    } catch (error) {
      console.error('Error adding submission to history:', error);
      return { success: false, error: 'Failed to add submission to history' };
    }
  }

  /**
   * Get user's allocated exams
   */
  async getAllocatedExams(userId: string): Promise<string[]> {
    try {
      await connect();
      // userId is a Clerk ID (string), not an ObjectId
      const user = await this.model.findById(userId).select('currentAllocatedExams').lean();
      return user?.currentAllocatedExams || [];
    } catch (error) {
      console.error('Error getting allocated exams:', error);
      return [];
    }
  }

  /**
   * Get user's submission history
   */
  async getSubmissionHistory(userId: string): Promise<string[]> {
    try {
      await connect();
      const user = await this.model.findById(userId).select('submissionHistory').lean();
      return user?.submissionHistory || [];
    } catch (error) {
      console.error('Error getting submission history:', error);
      return [];
    }
  }

  /**
   * Search users by name or email
   */
  async search(query: string, limit: number = 50): Promise<User[]> {
    try {
      await connect();
      const users = await this.model.find({
        $or: [
          { email: { $regex: query, $options: 'i' } },
          { name: { $regex: query, $options: 'i' } }
        ]
      })
      .limit(limit)
      .lean();

      return users as User[];
    } catch (error) {
      console.error('Error searching users:', error);
      return [];
    }
  }

  /**
   * Delete user
   */
  async delete(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await connect();

      const result = await this.model.deleteOne({ _id: userId });

      if (result.deletedCount === 0) {
        return { success: false, error: 'User not found' };
      }

      return { success: true };
    } catch (error) {
      console.error('Error deleting user:', error);
      return { success: false, error: 'Failed to delete user' };
    }
  }

  /**
   * Get user count by role
   */
  async getCountByRole(): Promise<{ student: number; teacher: number; admin: number }> {
    try {
      await connect();
      
      const [studentCount, teacherCount, adminCount] = await Promise.all([
        this.model.countDocuments({ role: 'student' }),
        this.model.countDocuments({ role: 'teacher' }),
        this.model.countDocuments({ role: 'admin' })
      ]);

      return {
        student: studentCount,
        teacher: teacherCount,
        admin: adminCount
      };
    } catch (error) {
      console.error('Error getting user count by role:', error);
      return { student: 0, teacher: 0, admin: 0 };
    }
  }
}
