"""Quick script to remove emoji characters from test file"""
import re

# Read the file
with open('test_real_integration.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace specific emojis with ASCII
replacements = {
    '📋': '[CONFIG]',
    '⚠️': '[WARNING]',
    '⚠': '[WARNING]',
    '🔍': '[CHECK]',
    '✅': '[PASS]',
    '✓': '[+]',
    '⏳': '[WAIT]',
    '❌': '[FAIL]',
    '✗': '[-]',
    '📝': '[NOTE]',
    '🔧': '[CONFIG]'
}

for emoji, replacement in replacements.items():
    content = content.replace(emoji, replacement)

# Write back
with open('test_real_integration.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed all emojis in test_real_integration.py")
