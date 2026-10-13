/**
 * Single-exam analysis has no persisted syllabus catalog and does not match
 * questions to syllabus topics. Uploaded files and client syllabus ids are
 * ignored so a report cannot claim alignment that was never computed.
 */

export interface SyllabusOptionInput {
  alignWithSyllabus?: boolean;
  syllabusId?: string | null;
  syllabusFileName?: string | null;
  comparePastPapers: boolean;
  pastPaperIds?: string[];
}

export interface RecordedAnalysisOptions {
  alignWithSyllabus: false;
  comparePastPapers: boolean;
  pastPaperIds: string[];
}

export function syllabusOptionsWithoutAlignment(
  input: SyllabusOptionInput
): RecordedAnalysisOptions {
  return {
    alignWithSyllabus: false,
    comparePastPapers: input.comparePastPapers,
    pastPaperIds: input.pastPaperIds ?? [],
  };
}

export interface ClassifiedQuestionInput {
  questionNumber: string;
  questionText: string;
  marks: number;
  bloomLevel: string;
  bloomJustification: string;
  confidence?: number;
  difficulty?: string;
  keywords?: string[];
  topicsCovered?: string[];
}

export interface StoredAnalyzedQuestion {
  questionNumber: string;
  questionText: string;
  marks: number;
  bloomLevel: string;
  bloomJustification: string;
  confidence?: number;
  difficulty?: string;
  keywords: string[];
  syllabusTopics: [];
  isSyllabusAligned: false;
  similarQuestionIds: [];
}

export function questionsWithoutComputedSyllabusAlignment(
  questions: ClassifiedQuestionInput[]
): StoredAnalyzedQuestion[] {
  return questions.map((question) => ({
    questionNumber: question.questionNumber,
    questionText: question.questionText,
    marks: question.marks,
    bloomLevel: question.bloomLevel,
    bloomJustification: question.bloomJustification,
    confidence: question.confidence,
    difficulty: question.difficulty,
    keywords: question.keywords ?? [],
    syllabusTopics: [],
    isSyllabusAligned: false,
    similarQuestionIds: [],
  }));
}
