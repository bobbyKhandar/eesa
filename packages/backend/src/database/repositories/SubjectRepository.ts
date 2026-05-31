import { getSubjectModel } from "../newFeatureModels.js";
import type { SubjectDocument, Subject } from "../schemas/subjectZod.js";

export class SubjectRepository {
  private model = getSubjectModel();

  /**
   * Create a new subject
   */
  async create(subjectData: SubjectDocument) {
    try {
      const subject = await this.model.create(subjectData);
      return {
        success: true,
        subject: this.toPlainObject(subject),
        subjectId: subject._id.toString(),
      };
    } catch (error: any) {
      console.error("Error creating subject:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get subject by ID
   */
  async getById(subjectId: string) {
    try {
      const subject = await this.model.findById(subjectId);
      if (!subject) {
        return null;
      }
      return this.toPlainObject(subject);
    } catch (error) {
      console.error("Error fetching subject:", error);
      return null;
    }
  }

  /**
   * Get subject by code
   */
  async getByCode(code: string) {
    try {
      const subject = await this.model.findOne({ code });
      if (!subject) {
        return null;
      }
      return this.toPlainObject(subject);
    } catch (error) {
      console.error("Error fetching subject by code:", error);
      return null;
    }
  }

  /**
   * Get all subjects with filters
   */
  async getAll(filters: {
    branch?: string;
    year?: string;
    semester?: string;
    type?: string;
    isActive?: boolean;
    search?: string;
  } = {}) {
    try {
      const query: any = {};

      if (filters.branch) query.branch = filters.branch;
      if (filters.year) query.year = filters.year;
      if (filters.semester) query.semester = filters.semester;
      if (filters.type) query.type = filters.type;
      if (filters.isActive !== undefined) query.isActive = filters.isActive;

      // Search across name, code, instructor
      if (filters.search) {
        query.$or = [
          { name: { $regex: filters.search, $options: "i" } },
          { code: { $regex: filters.search, $options: "i" } },
          { instructor: { $regex: filters.search, $options: "i" } },
        ];
      }

      const subjects = await this.model.find(query).sort({ code: 1 });
      return subjects.map(s => this.toPlainObject(s));
    } catch (error) {
      console.error("Error fetching subjects:", error);
      return [];
    }
  }

  /**
   * Get subjects by branch and year
   */
  async getByBranchAndYear(branch: string, year: string) {
    try {
      const subjects = await this.model.find({ branch, year, isActive: true }).sort({ semester: 1, code: 1 });
      return subjects.map(s => this.toPlainObject(s));
    } catch (error) {
      console.error("Error fetching subjects by branch and year:", error);
      return [];
    }
  }

  /**
   * Update subject
   */
  async update(subjectId: string, updateData: Partial<SubjectDocument>) {
    try {
      const subject = await this.model.findByIdAndUpdate(
        subjectId,
        { $set: updateData },
        { new: true, runValidators: true }
      );

      if (!subject) {
        return { success: false, error: "Subject not found" };
      }

      return {
        success: true,
        subject: this.toPlainObject(subject),
      };
    } catch (error: any) {
      console.error("Error updating subject:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update enrollment count
   */
  async updateEnrollment(subjectId: string, enrolledStudents: number) {
    try {
      const subject = await this.model.findByIdAndUpdate(
        subjectId,
        { $set: { enrolledStudents } },
        { new: true }
      );

      if (!subject) {
        return { success: false, error: "Subject not found" };
      }

      return { success: true };
    } catch (error: any) {
      console.error("Error updating enrollment:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add prerequisite
   */
  async addPrerequisite(subjectId: string, prerequisite: string) {
    try {
      const subject = await this.model.findByIdAndUpdate(
        subjectId,
        { $addToSet: { prerequisites: prerequisite } },
        { new: true }
      );

      if (!subject) {
        return { success: false, error: "Subject not found" };
      }

      return { success: true };
    } catch (error: any) {
      console.error("Error adding prerequisite:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete subject (soft delete by setting isActive to false)
   */
  async delete(subjectId: string) {
    try {
      const subject = await this.model.findByIdAndUpdate(
        subjectId,
        { $set: { isActive: false } },
        { new: true }
      );

      if (!subject) {
        return { success: false, error: "Subject not found" };
      }

      return { success: true };
    } catch (error: any) {
      console.error("Error deleting subject:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get statistics
   */
  async getStatistics() {
    try {
      const totalSubjects = await this.model.countDocuments({ isActive: true });
      const coreSubjects = await this.model.countDocuments({ type: "Core", isActive: true });
      const electiveSubjects = await this.model.countDocuments({ type: "Elective", isActive: true });
      
      const enrollmentStats = await this.model.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: null, totalEnrolled: { $sum: "$enrolledStudents" } } }
      ]);

      return {
        totalSubjects,
        coreSubjects,
        electiveSubjects,
        totalEnrolled: enrollmentStats[0]?.totalEnrolled || 0,
      };
    } catch (error) {
      console.error("Error fetching statistics:", error);
      return {
        totalSubjects: 0,
        coreSubjects: 0,
        electiveSubjects: 0,
        totalEnrolled: 0,
      };
    }
  }

  /**
   * Convert Mongoose document to plain object
   */
  private toPlainObject(doc: any): Subject {
    return {
      _id: doc._id.toString(),
      name: doc.name,
      code: doc.code,
      branch: doc.branch,
      year: doc.year,
      semester: doc.semester,
      credits: doc.credits,
      type: doc.type,
      description: doc.description,
      duration: doc.duration,
      instructor: doc.instructor,
      enrolledStudents: doc.enrolledStudents,
      maxCapacity: doc.maxCapacity,
      prerequisites: doc.prerequisites,
      learningOutcomes: doc.learningOutcomes,
      syllabus: doc.syllabus,
      assessments: doc.assessments,
      textbooks: doc.textbooks,
      language: doc.language,
      mode: doc.mode,
      createdBy: doc.createdBy,
      isActive: doc.isActive,
      tags: doc.tags,
    };
  }
}
