import boto3
import json
from pathlib import Path

def analyze_research_paper(pdf_file_path):
    """
    Analyze a PDF research paper using AWS Bedrock with Gemma model.
    
    Args:
        pdf_file_path: Path to the PDF file
    
    Returns:
        dict: Response containing the research paper type
    """
    # Initialize Bedrock client
    bedrock_runtime = boto3.client(
        service_name='bedrock-runtime',
        region_name='ap-south-1'  # Use the same region as in enrich_questions_job_based.py
    )

    # Read PDF file (as bytes)
    pdf_path = Path(pdf_file_path)
    if not pdf_path.exists():
        return {
            'status': 'error',
            'pdf_file': str(pdf_file_path),
            'error': 'File does not exist.'
        }
    with open(pdf_file_path, 'rb') as f:
        pdf_content = f.read()

    # For LLMs, we need to extract text from PDF. Here, we just use a placeholder.
    # In production, use a PDF text extraction library like PyPDF2 or pdfplumber.
    text = None
    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(pdf_file_path)
        text = "\n".join(page.extract_text() or '' for page in reader.pages)
    except Exception:
        pass

    # If text extraction fails, send base64-encoded PDF bytes
    import base64
    if not text or text.strip() == "":
        pdf_b64 = base64.b64encode(pdf_content).decode('utf-8')
        text = None

    # Prepare the prompt (restrict to academic and legal/compliance)
    # Increase the input size for both extracted text and base64 PDF content
    MAX_INPUT_CHARS = 16000
    if text:
        prompt = (
            "You are an expert academic reviewer. "
            "Carefully analyze the provided document and determine its primary type. "
            "Classify ONLY as one of the following types: "
            "'academic' (if it is a research paper from ACM, Springer, IEEE, or similar academic publishers), "
            "or 'legal_compliance' (if it is a legal, compliance, or regulatory document). "
            "If academic, also try to identify the publisher (ACM, Springer, IEEE, or Other). "
            "Base your decision on the document's actual content, writing style, and academic or legal cues. "
            "Do NOT reference PDF structure, metadata, or technical encoding details in your explanation. "
            "Your explanation should be concise and based on the content, not on file format or PDF internals. "
            "\n\n"
            "Respond in the following JSON format: {"
            "  'paper_type': 'academic' or 'legal_compliance',"
            "  'publisher': 'ACM'|'Springer'|'IEEE'|'Other'|null,"
            "  'explanation': <brief explanation>"
            "} "
            "\n\n"
            f"Document text:\n{text[:MAX_INPUT_CHARS]}"
        )
    else:
        prompt = (
            "You are an expert academic reviewer. "
            "The following is a base64-encoded PDF file. "
            "Carefully analyze the document and determine its primary type. "
            "Classify ONLY as one of the following types: "
            "'academic' (if it is a research paper from ACM, Springer, IEEE, or similar academic publishers), "
            "or 'legal_compliance' (if it is a legal, compliance, or regulatory document). "
            "If academic, also try to identify the publisher (ACM, Springer, IEEE, or Other). "
            "Base your decision on the document's actual content, writing style, and academic or legal cues. "
            "Do NOT reference PDF structure, metadata, or technical encoding details in your explanation. "
            "Your explanation should be concise and based on the content, not on file format or PDF internals. "
            "\n\n"
            "Respond in the following JSON format: {"
            "  'paper_type': 'academic' or 'legal_compliance',"
            "  'publisher': 'ACM'|'Springer'|'IEEE'|'Other'|null,"
            "  'explanation': <brief explanation>"
            "} "
            "\n\n"
            "Base64 PDF content:\n" + pdf_b64[:MAX_INPUT_CHARS] + "... (truncated)"
        )

    # Prepare request body for Gemma model (Bedrock Claude-style API)
    request_body = {
        "modelId": "google.gemma-3-27b-it",  # Use the same model as enrich_questions_job_based.py
        "messages": [{
            "role": "user",
            "content": [{"text": prompt}]
        }],
        "inferenceConfig": {
            "maxTokens": 10000,  # Increased token length for longer responses
            "temperature": 0.7,
            "topP": 0.9
        }
    }

    try:
        # Invoke Bedrock model
        response = bedrock_runtime.converse(**request_body)
        content = response['output']['message']['content']
        llm_response = ""
        for item in content:
            if isinstance(item, dict) and 'text' in item:
                llm_response += item['text']
        # Try to extract JSON from response
        llm_response = llm_response.replace('```json', '').replace('```', '').strip()
        json_start = llm_response.find('{')
        json_end = llm_response.rfind('}')
        if json_start != -1 and json_end != -1:
            llm_response = llm_response[json_start:json_end+1]
        try:
            analysis = json.loads(llm_response)
        except Exception:
            analysis = {'raw_response': llm_response}
        return {
            'status': 'success',
            'pdf_file': str(pdf_file_path),
            'analysis': analysis
        }
    except Exception as e:
        return {
            'status': 'error',
            'pdf_file': str(pdf_file_path),
            'error': str(e)
        }

# Example usage
if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python analyze_research_paper.py <path_to_pdf>")
        sys.exit(1)
    pdf_path = sys.argv[1]
    result = analyze_research_paper(pdf_path)
    print(json.dumps(result, indent=2, ensure_ascii=False))
