# Braille Runner ⠃⠗

**Live: [braillerunner.netlify.app](https://braillerunner.netlify.app/)**

Take a photo of braille and read it in 11 languages, as text, as braille, and out loud.

Built in 30 minutes at the Sarvam AI Buildathon (1 November 2026).

## What it does

1. **Reads the dots.** Take a webcam photo, upload an image, or paste one anywhere on the page (Ctrl/⌘+V). The browser finds the raised or inked dots and fits them into braille cells. You can also paste Unicode braille text such as `⠓⠑⠇⠇⠕`.
2. **Works out the language.** The same cells mean different things in English braille and Bharati braille, so it decodes them both ways. Sarvam-105B picks the reading that makes sense, and Sarvam Text-LID confirms the language.
3. **Translates.** Sarvam Translate turns the text into English plus 10 Indian languages: Hindi, Bengali, Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Punjabi and Odia.
4. **Writes it back in braille.** Each translation is drawn as braille cells: English Grade 1 for English, and Bharati braille for the Indian scripts.
5. **Reads it aloud.** Sarvam Bulbul speaks each translation in its own language.

If the photo has printed text instead of dots, Sarvam Vision reads that instead.

## Who it's for

- **Teachers in rural schools.** A blind student's homework often goes unmarked because nobody nearby reads braille. With one phone photo, the teacher can read it in Marathi, Odia or Kannada and mark it the same day.
- **Inclusive city schools.** Subject teachers, parents and classmates can read a braille answer sheet without waiting for a resource teacher.
- **Families.** A student who writes English braille can share a note with a grandparent who reads only Bengali.
- **Anyone without money for braille tools.** Transcription software, embossers and trained transcribers are expensive. This only needs a phone and a browser, and it's free.
- **Archives.** Handwritten braille notebooks, letters and poems often exist as a single copy, and the dots flatten each time someone reads them. A photo turns them into searchable text.

## What makes it different

- **Braille in, Indian languages out.** Most braille tools go from print to braille, and only in English. This one goes the other way, from a photo of braille into 11 languages.
- **Reads Bharati braille.** Hindi, Tamil, Bengali and other Indian scripts share one set of Bharati cells. Braille Runner reads them all and works out which language was meant.
- **Tells English and Indian braille apart.** The same dots can be English or an Indian language. The app weighs both readings and shows how likely each language is.
- **Every result in three forms.** You get text, braille and speech in each language.
- **Nothing to install.** No app, no account, no special hardware.

## Tips

- Photograph the page straight on, in even light, with dark dots on light paper (or light dots on a dark screen).
- Embossed paper with no ink works only if the lighting casts clear shadows.
- English is read as Grade 1 (uncontracted) braille.

## Braille standards used

- English: Grade 1 braille alphabet (Braille Works).
- Indian languages: *Standard Bharati Braille Codes with Unicode Mapped Chart* (NIEPVD, 2025).
