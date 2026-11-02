# Braille Bridge

Turn braille writing by blind students (on paper, or dots on a screen) into text in 11 languages, and show each one back in braille.

1. **Read the dots**: snap a webcam photo, upload an image, or paste one (Ctrl/⌘+V). The browser finds the dots and snaps them to braille cells. You can also paste Unicode braille text like `⠓⠑⠇⠇⠕`.
2. **Identify the language**: the cells are decoded two ways, as English Grade 1 braille and as Bharati braille. Sarvam-105B picks the reading that makes sense, and Sarvam Text-LID confirms the language.
3. **Translate**: Sarvam Translate (`sarvam-translate:v1`) turns it into English plus 10 Indian languages.
4. **Back to braille**: each translation is shown in braille (English Grade 1, or Bharati braille for Indian scripts).

If no dot grid is found, the image goes to **Sarvam Vision** (Document AI parse) to read printed text or on-screen braille characters.

## Run

```bash
cp .env.example .env   # add your SARVAM_API_KEY
npm start              # http://localhost:8787
```

No dependencies; needs Node 20+. Try `public/samples/hindi.png` and `public/samples/english.png`.

## Sources

- English: Braille Works alphabet card (Grade 1).
- Indian languages: Standard Bharati Braille Codes with Unicode Mapped Chart (NIEPVD, 2025). Bharati cells are shared across scripts, so other scripts are mapped through Devanagari by Unicode block offset.

## Limits

- Photos should be straight-on, evenly lit, with dark dots on light paper (or light dots on a dark screen). Embossed paper with no ink works only if the lighting shows clear shadows.
- Grade 1 (uncontracted) English only.
