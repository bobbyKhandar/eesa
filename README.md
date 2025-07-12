# MiniProject

Welcome to the Exam evaluator repository!

## Overview

This project is designed to demonstrate key concepts in software engineering, including modular design, code organization, and best practices. It serves as a template for building scalable and maintainable applications.

## Features

- Modular architecture
- Easy-to-follow folder structure
- Example scripts and utilities
- Instructions for setup and usage

## Getting Started

1. **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/miniproject.git
    cd miniproject
    ```

2. **Install dependencies:**
    ```bash
    # Example for Node.js projects
    npm install
    ```

3. **Run the project:**
    ```bash
    # Example for Node.js projects
    npm start
    ```

## Folder Structure

```
miniproject/
├── src/            # Source code
├── tests/          # Test cases
├── docs/           # Documentation
├── README.md       # Project overview
└── package.json    # Project metadata (if applicable)
```

## Contributing

Contributions are welcome! Please open issues or submit pull requests for improvements.

## License

This project is licensed under the MIT License.

---


# Technical Approach & Current Status

This project is an active build, with a primary focus on the backend data processing pipeline.

## Backend: OCR Preprocessing & Skew Correction

The core of this project is a pipeline designed to process real-world university exam papers, which often suffer from poor scan quality and heavy skew (>40°).

**Challenge:** Standard computer vision techniques were unreliable for these challenging documents.  
**Solution:** I implemented a robust skew-correction module. It employs a "best-of-four" algorithmic analysis, running multiple detection methods on each image to determine the optimal orientation before OCR. This has dramatically improved the reliability of text extraction.

**Current State & Next Steps:** The algorithm is fully functional within the main processing script. My immediate next step is to refactor this logic into a standalone, documented module to improve the system's overall modularity and testability.

## Frontend: A Functional Interface

The frontend is built with Next.js and modern toolkits to provide a clean user interface for the backend's features. While the backend has been my main area of development, I designed the frontend to be a practical and effective demonstration of the application's capabilities.

## A Note on AI-Assisted Development

To accelerate development and focus on core architectural problems, this project was built with the assistance of AI-powered tools like GitHub Copilot and ChatGPT. Here’s a transparent breakdown of their role:

- **AI Was Used For:** Boilerplate code generation (e.g., initial React components, basic API route setups), refactoring suggestions for cleaner code, debugging cryptic errors, and helping to write documentation.
- **My Core Contribution:** The architectural design, the core problem-solving logic (including the conception and implementation of the "best-of-four" skew algorithm), and the integration of all system components are my own work. The AI tools served as a modern developer's productivity multiplier, not as a substitute for fundamental engineering.