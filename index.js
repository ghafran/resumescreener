const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Folders
const docsDir = path.join(__dirname, "resumes");
const goodDir = path.join(__dirname, "good");
const badDir = path.join(__dirname, "bad");

// Prompt files
const requirementsFile = path.join(__dirname, "requirements.txt");
const promptStructureFile = path.join(__dirname, "promptStructure.txt");

// Merge requirements into prompt
const requirements = fs.readFileSync(requirementsFile, "utf8");
const promptStructure = fs.readFileSync(promptStructureFile, "utf8");
const systemPrompt = promptStructure.replace(
  "$REQUIREMENTS_PLACEHOLDER$",
  requirements
);

// Ensure output folders exist
if (!fs.existsSync(goodDir)) fs.mkdirSync(goodDir);
if (!fs.existsSync(badDir)) fs.mkdirSync(badDir);

// Reads a file (txt, docx, pdf) and returns plain text
async function readFileAsText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".txt") {
    return fs.readFileSync(filePath, "utf8");
  } else if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } else if (ext === ".pdf") {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);
    return pdfData.text;
  } else {
    throw new Error(`Unsupported file format: ${ext}`);
  }
}

(async function main() {
  const files = fs.readdirSync(docsDir);

  for (const file of files) {
    const filePath = path.join(docsDir, file);
    const { name, ext } = path.parse(file); // name=filename, ext=original extension

    let textContent;
    try {
      textContent = await readFileAsText(filePath);
    } catch (err) {
      console.error(`Skipping ${file} - ${err.message}`);
      continue;
    }

    // Ask ChatGPT for (rating, decision, reason)
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // or "gpt-3.5-turbo"
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: textContent },
      ],
      max_tokens: 100,
    });

    const fullAnswer = response.choices[0].message.content.trim();
    const lines = fullAnswer.split(/\r?\n/).map((line) => line.trim());

    // lines[0] = rating, lines[1] = ALL_MET/NOT_MET, lines[2] = reason
    const rating = lines[0] || "";
    const decision = lines[1] || "";
    const reason = lines[2] || "No reason provided.";

    // Move file based on decision
    if (decision === "ALL_MET") {
      // 1) Move the original resume to "good"
      fs.renameSync(filePath, path.join(goodDir, file));

      // 2) Create a .txt file with the same base name plus _rating before .txt
      //    e.g. "JohnDoe_9.txt"
      const reasonFileName = `${name}_${rating}.txt`;
      const reasonFilePath = path.join(goodDir, reasonFileName);

      // 3) Write reason + rating to this file
      const reasonFileContent = `Rating: ${rating}\nReason: ${reason}`;
      fs.writeFileSync(reasonFilePath, reasonFileContent, "utf8");
    } else {
      // For NOT_MET, move file to "bad"
      fs.renameSync(filePath, path.join(badDir, file));

      // Optionally create a separate text file for rejections
      // (in case you still want the reason for rejection)
      const rejectFileName = `${name}.txt`;
      const rejectFilePath = path.join(badDir, rejectFileName);
      const rejectFileContent = `Reason: ${reason}\nRating: ${rating}`;
      fs.writeFileSync(rejectFilePath, rejectFileContent, "utf8");
    }
  }
})();
