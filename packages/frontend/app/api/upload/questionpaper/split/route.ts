import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PDFDocument } from 'pdf-lib';

// AI Pipeline server URL
const AI_PIPELINE_URL = process.env.AI_PIPELINE_URL || "http://localhost:5000";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const rangesStr = formData.get("ranges") as string;

    if (!file || !rangesStr) {
      return NextResponse.json(
        { success: false, error: "Missing file or ranges" },
        { status: 400 }
      );
    }

    const ranges: Array<{start: number, end: number}> = JSON.parse(rangesStr);
    console.log(`Splitting ${file.name} into ${ranges.length} parts`);

    // Read the PDF file
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const totalPages = pdfDoc.getPageCount();

    console.log(`Total pages: ${totalPages}`);

    const jobs: any[] = [];
    const errors: string[] = [];

    // Split PDF into parts based on ranges
    for (let i = 0; i < ranges.length; i++) {
      try {
        const range = ranges[i];
        const partName = `${file.name.replace('.pdf', '')}-part${i + 1}.pdf`;

        console.log(`Creating ${partName}: pages ${range.start}-${range.end}`);

        // Create new PDF document for this range
        const newPdfDoc = await PDFDocument.create();
        
        // Copy pages from original to new document
        for (let pageNum = range.start - 1; pageNum < range.end && pageNum < totalPages; pageNum++) {
          const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [pageNum]);
          newPdfDoc.addPage(copiedPage);
        }

        // Save the new PDF
        const pdfBytes = await newPdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });

        // Upload this part to AI pipeline
        const partFormData = new FormData();
        partFormData.append('files', blob, partName);

        const response = await fetch(`${AI_PIPELINE_URL}/upload/question-papers`, {
          method: "POST",
          body: partFormData,
        });

        if (response.ok) {
          const result = await response.json();
          jobs.push(...(result.jobs || []));
          console.log(`✓ Uploaded ${partName}`);
        } else {
          errors.push(`${partName}: Upload failed`);
        }

      } catch (error: any) {
        errors.push(`Part ${i + 1}: ${error.message}`);
        console.error(`Error creating part ${i + 1}:`, error);
      }
    }

    return NextResponse.json({
      success: jobs.length > 0,
      message: `Split into ${jobs.length} parts`,
      jobs,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error: any) {
    console.error("Split error:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message || "Failed to split PDF" 
      },
      { status: 500 }
    );
  }
}
