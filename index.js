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
const yesDir = path.join(__dirname, "yes");
const noDir = path.join(__dirname, "no");

// Prompt files
const requirementsFile = path.join(__dirname, "requirements.txt");
const promptStructureFile = path.join(__dirname, "promptStructure.txt");

// Merge requirements into the prompt
const requirements = fs.readFileSync(requirementsFile, "utf8");
const promptStructure = fs.readFileSync(promptStructureFile, "utf8");
const systemPrompt = promptStructure.replace(
  "$REQUIREMENTS_PLACEHOLDER$",
  requirements
);

// Ensure output folders exist
if (!fs.existsSync(yesDir)) fs.mkdirSync(yesDir);
if (!fs.existsSync(noDir)) fs.mkdirSync(noDir);

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
    const { name, ext } = path.parse(file);

    let textContent;
    try {
      textContent = await readFileAsText(filePath);
    } catch (err) {
      console.error(`Skipping ${file} - ${err.message}`);
      continue;
    }

    // Ask GPT for rating, decision, reason
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

    // Expect:
    // lines[0] = rating (1-10)
    // lines[1] = "ALL_MET" or "NOT_MET"
    // lines[2] = reason
    const rating = lines[0] || "0";
    const decision = lines[1] || "NOT_MET";
    const reason = lines[2] || "No reason provided.";

    // If the mandatory requirements are all met, ChatGPT should say "ALL_MET".
    if (decision === "ALL_MET") {
      // Move file to "yes" folder
      fs.renameSync(filePath, path.join(yesDir, file));

      // Create a separate .txt file with rating appended (e.g., name_rating.txt)
      const ratingFileName = `${rating}_${name}.txt`;
      const ratingFilePath = path.join(yesDir, ratingFileName);
      const ratingFileContent = `Rating: ${rating}\nReason: ${reason}`;

      fs.writeFileSync(ratingFilePath, ratingFileContent, "utf8");
    } else {
      // Move file to "no" folder
      fs.renameSync(filePath, path.join(noDir, file));

      // Create a .txt file with reason for rejection
      const rejectFileName = `${name}.txt`;
      const rejectFilePath = path.join(noDir, rejectFileName);
      const rejectFileContent = `Rating: ${rating}\nReason: ${reason}`;

      fs.writeFileSync(rejectFilePath, rejectFileContent, "utf8");
    }
  }
})();
