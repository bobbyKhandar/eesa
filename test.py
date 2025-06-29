from pathlib import Path

# Create a long path (300 chars) with parent directories
long_path = Path(rf"\\?\C:\{'a'*250}\{'b'*50}\test.txt")  # Total: 250 + 50 + 8 = 308 chars

try:
    # Create parent directories first
    long_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Then create the file
    long_path.write_text("Hello")
    print(f"✅ Successfully created file at {long_path}")
except Exception as e:
    print(f"❌ Error: {e}")