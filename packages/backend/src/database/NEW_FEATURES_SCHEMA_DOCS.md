# New Feature Database Schemas

This document describes the database schemas for the new AI-powered exam analysis features.

## Overview

The new features include:
1. **Enhanced Subject Management** - Detailed subject information with syllabus, learning outcomes, and assessments
2. **Syllabus Management** - Store and manage course syllabi with AI extraction
3. **Past Papers Repository** - Historical exam papers with Bloom's taxonomy classification
4. **AI Exam Analysis** - Upload and analyze exam papers with AI-powered insights

## Database Collections

### 1. subjects

Enhanced subject management with detailed curriculum information.

**Schema:** `subjectZod.ts`

**Key Fields:**
- `name` (string): Subject name (e.g., "Data Structures & Algorithms")
- `code` (string): Unique subject code (format: XX###, e.g., "CS201")
- `branch` (string): Academic branch (e.g., "Computer Science")
- `year` (enum): Academic year - FY, SY, TY, LY
- `semester` (string): Semester (e.g., "Semester 3")
- `credits` (number): Credit hours
- `type` (enum): Core, Elective, Lab, Project
- `description` (string): Detailed course description
- `instructor` (string): Faculty name
- `enrolledStudents` (number): Current enrollment count
- `prerequisites` (array<string>): Required prerequisite subjects
- `learningOutcomes` (array): Expected learning outcomes with Bloom levels
- `syllabus` (array): Week-by-week topic breakdown
- `assessments` (array): Assessment structure with weightages
- `textbooks` (array): Recommended textbooks with editions
- `mode` (enum): Online, Offline, Hybrid
- `isActive` (boolean): Active status
- `tags` (array<string>): Searchable tags

**Indexes:**
- Unique: `code`
- Composite: `branch + year + semester`
- Single: `isActive`, `tags`

**Use Cases:**
- Display subject catalog with filters
- Show detailed subject information
- Track enrollment and prerequisites
- Link to exams and syllabi

---

### 2. syllabi

Store and manage course syllabi with AI-powered text extraction.

**Schema:** `syllabusZod.ts`

**Key Fields:**
- `title` (string): Syllabus title (e.g., "Physics (2025 Curriculum)")
- `subjectCode` (string): Reference to subject
- `subjectName` (string): Subject name
- `academicYear` (string): Academic year (e.g., "2025-2026")
- `semester` (string): Semester
- `curriculumVersion` (string): Version identifier
- `effectiveFrom` (date): Start date
- `effectiveTo` (date): End date (optional)
- `modules` (array): Structured curriculum modules
  - `moduleNumber` (number)
  - `title` (string)
  - `topics` (array): Detailed topics with subtopics
- `originalFile` (object): Uploaded file metadata
  - `fileName`, `fileUrl`, `fileType`, `fileSize`
- `extractedText` (string): Full text extracted by OCR/AI
- `extractedTopics` (array<string>): AI-identified topics
- `processingStatus` (enum): pending, processing, completed, failed
- `createdBy` (string): User ID
- `isActive` (boolean): Active status
- `usage` (object): Usage statistics

**Indexes:**
- Composite: `subjectCode + academicYear`
- Single: `isActive`, `effectiveFrom`, `createdBy`

**Use Cases:**
- Upload syllabus documents (PDF/DOCX)
- AI extraction of topics and structure
- Align exam questions with syllabus
- Version control for curriculum updates
- Reuse syllabi across analyses

---

### 3. pastpapers

Historical exam papers with AI classification and analysis.

**Schema:** `pastPaperZod.ts`

**Key Fields:**
- `subjectCode` (string): Subject reference
- `subjectName` (string): Subject name
- `branch` (string): Academic branch
- `year` (enum): FY, SY, TY, LY
- `semester` (string): Semester
- `examType` (enum): main, kt, resit, supplementary
- `examYear` (number): Year conducted (e.g., 2024)
- `examMonth` (string): Month (e.g., "May", "December")
- `totalMarks` (number): Maximum marks
- `duration` (number): Exam duration in minutes
- `questions` (array): All questions with analysis
  - `questionNumber` (string): e.g., "1(a)", "Q2"
  - `questionText` (string): Full question text
  - `marks` (number): Question marks
  - `questionType` (enum): MCQ, Short, Long, Numerical, Diagram
  - `bloomLevel` (enum): Bloom's taxonomy level
  - `bloomJustification` (string): AI reasoning
  - `topicsCovered` (array<string>): Mapped topics
  - `difficulty` (enum): Easy, Medium, Hard
- `totalQuestions` (number): Total number of questions
- `originalFile` (object): File metadata
- `extractedText` (string): OCR-extracted text
- `processingStatus` (enum): Processing state
- `bloomDistribution` (object): Percentage breakdown
  - Recall, Understand, Apply, Analyze, Evaluate, Create
- `uploadedBy` (string): User ID
- `isVerified` (boolean): Admin verification
- `isPublic` (boolean): Public visibility
- `viewCount` (number): View counter

**Indexes:**
- Composite: `subjectCode + examYear + examType`
- Composite: `branch + year + semester`
- Composite: `isPublic + isVerified`
- Single: `uploadedBy`, `tags`

**Use Cases:**
- Store historical exam papers
- Build question bank
- Compare current exam with past patterns
- Identify frequently asked questions
- Track difficulty trends over years

---

### 4. examanalyses

AI-powered analysis results for uploaded exam papers.

**Schema:** `examAnalysisZod.ts`

**Key Fields:**
- `subjectCode` (string): Subject reference (optional)
- `subjectName` (string): Subject name
- `year` (string): Year (e.g., "2025")
- `semester` (string): Semester
- `examType` (enum): main, kt
- `originalFile` (object): Uploaded exam file
  - `fileName`, `fileUrl`, `fileType`, `fileSize`
- `status` (enum): pending, processing, completed, failed, published
- `analysisOptions` (object): Analysis settings
  - `alignWithSyllabus` (boolean)
  - `syllabusId` (string): Reference to syllabus
  - `comparePastPapers` (boolean)
  - `pastPaperIds` (array<string>): References
- `extractedText` (string): OCR output
- `totalQuestions` (number): Question count
- `totalMarks` (number): Total marks
- `questions` (array): Analyzed questions
  - `questionNumber`, `questionText`, `marks`
  - `bloomLevel` (enum): AI classification
  - `bloomJustification` (string): AI reasoning
  - `confidence` (number): AI confidence (0-1)
  - `syllabusTopics` (array<string>): Aligned topics
  - `isSyllabusAligned` (boolean)
  - `similarQuestionIds` (array<string>): Past paper matches
  - `appearanceFrequency` (object): Historical data
- `bloomDistribution` (object): Percentage breakdown
- `syllabusCoverage` (object): Syllabus alignment insights
  - `coveragePercentage` (number): 0-100
  - `status`, `detail`, `tone`
  - `coveredTopics`, `missingTopics`
- `pastPaperComparison` (object): Comparison insights
  - `status`, `detail`, `deviation`, `trends`, `tone`
- `overallAssessment` (string): AI summary
- `recommendations` (array<string>): AI suggestions
- `strengths` (array<string>): Identified strengths
- `improvements` (array<string>): Areas for improvement
- `userNotes` (string): User annotations
- `analyzedBy` (string): User ID
- `analyzedAt` (date): Analysis timestamp
- `isPublished` (boolean): Published status
- `isPublic` (boolean): Public visibility
- `sharedWith` (array<string>): Shared user IDs

**Indexes:**
- Composite: `analyzedBy + analyzedAt` (descending)
- Composite: `subjectCode + year`
- Single: `status`, `isPublished`, `isPublic`, `tags`

**Use Cases:**
- Upload exam papers for AI analysis
- Classify questions by Bloom's taxonomy
- Compare with syllabus coverage
- Compare with past paper patterns
- Generate detailed analysis reports
- Publish and share reports
- Track analysis history

---

## Bloom's Taxonomy Levels

All question classifications use these standardized levels:

1. **Recall** - Remember and retrieve information
2. **Understand** - Explain ideas or concepts
3. **Apply** - Use information in new situations
4. **Analyze** - Draw connections and break down information
5. **Evaluate** - Justify decisions or judge value
6. **Create** - Produce new or original work

---

## Data Flow

### Exam Analysis Workflow

```
1. User uploads exam file (PDF/DOCX/Image)
   ↓
2. Create ExamAnalysis document (status: pending)
   ↓
3. OCR/Text extraction (status: processing)
   ↓
4. AI question extraction and parsing
   ↓
5. AI Bloom's taxonomy classification
   ↓
6. If alignWithSyllabus:
   - Fetch Syllabus by ID
   - Map questions to syllabus topics
   - Calculate coverage percentage
   ↓
7. If comparePastPapers:
   - Fetch relevant PastPaper documents
   - Compare Bloom distributions
   - Find similar questions
   - Calculate deviation trends
   ↓
8. Generate insights and recommendations
   ↓
9. Save results (status: completed)
   ↓
10. Display analysis report
```

### Syllabus Upload Workflow

```
1. User uploads syllabus file
   ↓
2. Create Syllabus document (processingStatus: pending)
   ↓
3. OCR/Text extraction (processingStatus: processing)
   ↓
4. AI topic extraction
   ↓
5. AI module structuring
   ↓
6. Save extracted data (processingStatus: completed)
   ↓
7. Syllabus available for exam analysis
```

---

## API Endpoints (Recommended)

### Subjects
- `GET /api/subjects` - List all subjects with filters
- `GET /api/subjects/:id` - Get subject details
- `POST /api/subjects` - Create subject (admin)
- `PUT /api/subjects/:id` - Update subject (admin)
- `DELETE /api/subjects/:id` - Soft delete (admin)
- `GET /api/subjects/stats` - Get statistics

### Syllabi
- `GET /api/syllabi` - List syllabi
- `GET /api/syllabi/:id` - Get syllabus details
- `POST /api/syllabi/upload` - Upload and process syllabus
- `GET /api/syllabi/by-subject/:subjectCode` - Get by subject
- `DELETE /api/syllabi/:id` - Delete syllabus

### Past Papers
- `GET /api/past-papers` - List with filters
- `GET /api/past-papers/:id` - Get details
- `POST /api/past-papers/upload` - Upload past paper
- `GET /api/past-papers/by-subject/:subjectCode` - Get by subject
- `PUT /api/past-papers/:id/verify` - Verify paper (admin)

### Exam Analysis
- `GET /api/exam-analysis` - List user's analyses
- `GET /api/exam-analysis/:id` - Get analysis report
- `POST /api/exam-analysis/upload` - Upload for analysis
- `GET /api/exam-analysis/:id/status` - Check processing status
- `PUT /api/exam-analysis/:id/publish` - Publish report
- `DELETE /api/exam-analysis/:id` - Delete analysis

---

## Repository Classes

Each schema has a corresponding repository class:

- `SubjectRepository` - Subject CRUD operations
- `SyllabusRepository` - Syllabus management
- `PastPaperRepository` - Past paper operations
- `ExamAnalysisRepository` - Analysis operations

All repositories follow the same pattern with methods like:
- `create()`, `getById()`, `getAll()`, `update()`, `delete()`
- Custom queries and aggregations
- Type-safe operations with Zod validation

---

## Integration with Existing System

### Links to Existing Collections

1. **Users** - `createdBy`, `analyzedBy`, `uploadedBy` fields reference User._id
2. **Subjects** - `subjectCode` links to existing subjects or new Subject collection
3. **ExamSubmissions** - Can link ExamAnalysis._id for reference

### Migration Strategy

1. Existing subject data can coexist (old schema renamed to `OldSubject`)
2. New features use new schemas
3. Gradually migrate subject data to enhanced schema
4. API routes handle both old and new formats during transition

---

## File Storage

All uploaded files (PDFs, DOCX, images) should be stored in cloud storage (S3, Azure Blob, etc.):

- `originalFile.fileUrl` - Cloud storage URL
- Store file metadata in database
- Use signed URLs for secure access
- Implement cleanup for deleted documents

---

## AI Services Required

### 1. OCR Service
- Extract text from PDFs, DOCX, images
- Handle multi-page documents
- Maintain formatting and structure

### 2. Question Parser Service
- Identify question boundaries
- Extract question numbers and marks
- Parse MCQ options

### 3. Bloom's Classifier Service
- Classify questions by cognitive level
- Generate justifications
- Provide confidence scores

### 4. Topic Matcher Service
- Match questions to syllabus topics
- Calculate coverage percentages
- Identify missing topics

### 5. Comparison Service
- Compare Bloom distributions
- Calculate statistical deviations
- Identify trends and patterns

---

## Next Steps

1. ✅ Create Zod schemas
2. ✅ Create Mongoose models
3. ✅ Create repository classes
4. Create API routes
5. Implement file upload handling
6. Integrate AI services
7. Build frontend components
8. Test complete workflow

---

## Notes

- All schemas use Zod for runtime validation
- Mongoose schemas generated via `@zodyac/zod-mongoose`
- Proper indexing for query performance
- Timestamps automatically added
- Soft deletes with `isActive` flag
- Public/private visibility controls
- Usage tracking for analytics
