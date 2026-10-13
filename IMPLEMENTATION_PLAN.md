# Implementation Plan: Voice Input & Export Functions

## Overview
Implement two new features in the chatbot application:
1. Voice Input using Web Speech API
2. Export Functions (Markdown, TXT, PDF)

## Files to Modify

### 1. `public/index.html`
- Add CDN script for html2pdf.js library
- Add voice button HTML element after attachmentButton
- Add download menu dropdown for export functions

### 2. `public/app.js`

#### State Updates:
- Add `isRecording` (boolean) to state object
- Add `recognition` reference for speech recognition instance

#### Element References:
- Add to elements object:
  - `voiceButton`: Microphone button
  - `voiceIndicator`: Recording indicator dot
  - `downloadMenu`: Dropdown container
  - `exportButton`: Export trigger button
  - `exportMarkdownBtn`, `exportTxtBtn`, `exportPdfBtn`: Menu items

#### Voice Input Functions:
- `startRecording()`: Initialize/start speech recognition
- `stopRecording()`: Stop recording and process transcript
- `initSpeechRecognition()`: Setup SpeechRecognition/WebKitSpeechRecognition
- `showRecordingIndicator(bool)`: Visual feedback toggle

#### Export Functions:
- `downloadMarkdown()`: Generate .md file with timestamps, roles, content
- `downloadTxt()`: Generate plain .txt file
- `downloadPdf()`: Generate PDF using html2pdf library
- Helper function to format messages for export

#### Event Handlers:
- Voice button click handler
- Download menu item handlers
- Recording state management

### 3. `public/styles.css`

#### New Styles:
- `.voice-button`: Microphone button styling
- `.voice-button.recording`: Red color when active
- `.voice-indicator`: Pulsing red dot animation
- `.download-menu`: Dropdown menu styling
- `.export-btn`: Individual export button styles
- Keyframe animations for recording indicator

## Implementation Steps

1. **Setup Phase:**
   - Add html2pdf.js CDN to index.html
   - Update state object in app.js
   - Add new element references

2. **Voice Input Implementation:**
   - Add voice button HTML
   - Implement speech recognition logic
   - Add recording state management
   - Handle language support (id-ID first, en-US fallback)
   - Add visual indicators

3. **Export Functions Implementation:**
   - Create downloadMarkdown() function
   - Create downloadTxt() function
   - Create downloadPdf() function
   - Add download menu UI
   - Handle image placeholders in exports

4. **Styling:**
   - Add CSS for all new elements
   - Create pulsing animation for recording indicator
   - Ensure dark mode compatibility

5. **Integration:**
   - Connect event listeners
   - Test error handling
   - Verify toast notifications work

## Testing Checklist
- [ ] Voice button appears correctly
- [ ] Recording starts/stops properly
- [ ] Speech transcription works (indonesian/en English)
- [ ] Text inserted into messageInput
- [ ] Recording indicator shows animation
- [ ] Markdown export generates correct file
- [ ] TXT export works
- [ ] PDF export works with html2pdf
- [ ] Images show "[Image attached]" placeholder
- [ ] Error handling with toast notifications
- [ ] All features work in light/dark themes
