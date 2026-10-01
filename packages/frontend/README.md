# AI Exam Evaluator

An intelligent exam creation and evaluation platform powered by AI.

## Features

- **Exam Creation**: Create exams for personal use or teacher assignments
- **AI Evaluation**: Automated grading using advanced AI models
- **Resources Management**: Organized by branch, semester, and subject
- **Past Year Questions**: Comprehensive PYQ database with Bloom's taxonomy
- **Community Resources**: Student and faculty resource sharing

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository or extract the ZIP file
2. Install dependencies:

\`\`\`bash
npm install
\`\`\`

3. Copy the environment file and configure your API keys:

\`\`\`bash
cp .env.example .env.local
\`\`\`

4. Add your API keys to `.env.local`:
   - `OPENAI_API_KEY` - Required for AI evaluation features
   - Other API keys are optional based on your needs

5. Run the development server:

\`\`\`bash
npm run dev
\`\`\`

6. Open [http://localhost:3000](http://localhost:3000) in your browser

### Build for Production

\`\`\`bash
npm run build
npm start
\`\`\`

## Project Structure

\`\`\`
├── app/                    # Next.js App Router pages
│   ├── dashboard/         # Dashboard pages
│   ├── exams/            # Exam management
│   ├── resources/        # Resources section
│   ├── take-exam/        # Exam taking interface
│   ├── results/          # Results pages
│   └── api/              # API routes
├── components/           # Reusable components
│   └── ui/              # UI components
├── lib/                 # Utility functions
└── public/              # Static assets
\`\`\`

## Technologies Used

- **Next.js 15** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **shadcn/ui** - UI components
- **AI SDK** - AI integration
- **Lucide React** - Icons

## Environment Variables

See `.env.example` for all available environment variables. Only `OPENAI_API_KEY` is required for basic functionality.

## License

This project is licensed under the MIT License.
