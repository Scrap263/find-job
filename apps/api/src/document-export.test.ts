import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDocxExport,
  createPdfExport,
  safeExportFileName,
  type DocumentExportInput
} from "./document-export.js";

const input: DocumentExportInput = {
  candidateName: "Тестовый кандидат",
  jobTitle: "Product Analyst",
  company: "Example",
  location: "Europe",
  resumeSummary: "SQL analyst\n\nПодтверждённый опыт:\n• Built dashboards",
  coverLetter: "Здравствуйте!\n\nГотов обсудить вакансию."
};

describe("document exports", () => {
  it("creates a valid DOCX zip container", async () => {
    const result = await createDocxExport(input);

    assert.equal(result.subarray(0, 2).toString(), "PK");
    assert.ok(result.length > 5_000);
  });

  it("creates a valid PDF with embedded Unicode fonts", async () => {
    const result = await createPdfExport(input);

    assert.equal(result.subarray(0, 4).toString(), "%PDF");
    assert.ok(result.length > 5_000);
  });

  it("creates a safe download name", () => {
    assert.equal(
      safeExportFileName(input),
      "Тестовый-кандидат-Example-Product-Analyst"
    );
  });
});
