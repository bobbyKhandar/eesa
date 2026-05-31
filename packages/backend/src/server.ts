import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createExam, getUserExams, getQuestions, getUserIdByEmail, submitExam, getExamSubmission, getUserSubmissionHistory } from './database/db.js';
import { connect as dbConnect, disconnect as dbDisconnect } from './database/connect.js';
import {aiExamHelper} from "./services/geminiAi.js"
// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// Debug endpoint to list all users
app.get('/debug/users', async (req, res) => {
  try {
    await require('./database/db.js').connect();
    const UserModel = require('./database/mongooseSchemas.js').getUserModel();
    const users = await UserModel.find({}, { email: 1, currentAllocatedExams: 1, _id: 0 });
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Create exam endpoint
app.post('/api/exams/create', async (req, res) => {
  try {
    const {
      examTitle,
      examDescription,
      examType,
      examMaxMarks,
      passingPercentage,
      examDegree,
      examUsers,
      clientQuestions
    } = req.body;

    // Validate required fields
    if (!examTitle || !examDescription || !examType || !examMaxMarks || !passingPercentage || !examDegree || !examUsers || !clientQuestions) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    const savedExam = await createExam(
      examTitle,
      examDescription,
      examType,
      examMaxMarks,
      passingPercentage,
      examDegree,
      examUsers,
      clientQuestions
    );

    res.status(201).json({
      success: true,
      exam: savedExam
    });
  } catch (error) {
    console.error('Error creating exam:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create exam'
    });
  }
});

// Get exam sets endpoint
app.post('/api/exams/display', async (req, res) => {
  try {
  const { email, kind } = req.body as { email?: string; kind?: 'allocated' | 'submitted' };
    console.log('Received request for email:', email);

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Missing email'
      });
    }

    const result = await getUserExams(email, kind === 'submitted' ? 'submitted' : 'allocated');
    if ('error' in result) {
      return res.status(404).json({ success: false, error: result.error });
    }
    const exams = result.exams;
    console.log('Retrieved exams:', exams);
    
    if ('error' in exams) {
      return res.status(404).json({
        success: false,
        error: exams.error
      });
    }

    res.status(200).json({
      success: true,
      exams
    });
  } catch (error) {
    console.error('Error getting exams:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get exams'
    });
  }
});

// Get questions for an exam endpoint
app.get('/api/exams/:examId/questions', async (req, res) => {
  try {
    const { examId } = req.params;

    if (!examId) {
      return res.status(400).json({
        success: false,
        error: 'Missing exam ID'
      });
    }

    const questions = await getQuestions(examId);

    res.status(200).json({
      success: true,
      questions
    });
  } catch (error) {
    console.error('Error getting questions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get questions'
    });
  }
});

// Get user ID by email endpoint
app.post('/api/users/get-id', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Missing email'
      });
    }

    const userId = await getUserIdByEmail(email);

    if (!userId) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      userId
    });
  } catch (error) {
    console.error('Error getting user ID:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user ID'
    });
  }
});

// POST /api/exams/submit - Submit exam answers for evaluation
app.post('/api/exams/submit', async (req, res) => {
  try {
    const { examId, studentEmail, answers, timeSpent, autoSubmitted } = req.body;

    if (!examId || !studentEmail || !answers) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: examId, studentEmail, answers'
      });
    }

    console.log('Submitting exam:', {
      examId,
      studentEmail,
      answersCount: Object.keys(answers).length,
      timeSpent,
      autoSubmitted
    });

    const result = await submitExam(
      examId,
      studentEmail,
      answers,
      timeSpent || 0,
      autoSubmitted || false
    );

    if (result.success) {
      res.status(200).json({
        success: true,
        message: 'Exam submitted successfully. Results will be emailed to you shortly.',
        submissionId: result.submissionId
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error submitting exam:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit exam'
    });
  }
});

app.post("/api", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ success: false, error: "Missing 'query' in request body" });
    }
    const result = await aiExamHelper(query);
    res.json({ success: true, result });
  } catch (error) {
    console.error("AI Exam Helper error:", error);
    res.status(500).json({ success: false, error: "AI Exam Helper failed" });
  }
});
// GET /api/exams/:examId/submission/:email - Get exam submission results
app.get('/api/exams/:examId/submission/:email', async (req, res) => {
  try {
    const { examId, email } = req.params;

    const submission = await getExamSubmission(examId, email);

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: 'No submission found'
      });
    }

    res.status(200).json({
      success: true,
      submission
    });
  } catch (error) {
    console.error('Error getting submission:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get submission'
    });
  }
});

// GET /api/users/:email/submissions - Get user's submitted exams history
app.get('/api/users/:email/submissions', async (req, res) => {
  try {
    const { email } = req.params;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Missing email' });
    }
    const submissions = await getUserSubmissionHistory(email);
    return res.status(200).json({ success: true, submissions });
  } catch (error) {
    console.error('Error getting user submission history:', error);
    res.status(500).json({ success: false, error: 'Failed to get submission history' });
  }
});

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler for all unmatched routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Ensure DB is connected at startup (fire-and-forget is fine; routes call connect() defensively as well)
await dbConnect();

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Surface server-level errors (e.g. EADDRINUSE)
server.on('error', (err: any) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Another process may be running the server.`);
  } else {
    console.error('HTTP server error:', err);
  }
});

// Optional: log process lifecycle to understand exits
process.on('beforeExit', (code) => {
  console.warn('Process beforeExit with code:', code);
});
process.on('exit', (code) => {
  console.warn('Process exit with code:', code);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process, just log the error
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
  dbDisconnect().finally(() => process.exit(0));
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
  dbDisconnect().finally(() => process.exit(0));
  });
});

export default app;
