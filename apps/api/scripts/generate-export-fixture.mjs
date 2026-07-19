import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createDocxExport,
  createPdfExport
} from "../dist/document-export.js";

const outputDirectory = path.resolve(
  process.argv[2] ?? "../../../tmp/export-qa"
);
const fixture = {
  candidateName: "Алексей Смирнов",
  jobTitle: "Senior Product Analyst",
  company: "Finwave",
  location: "Lisbon · Hybrid",
  resumeSummary: [
    "Алексей Смирнов",
    "Product Analyst",
    "",
    "Ключевые подтверждённые навыки: SQL, Amplitude.",
    "",
    "Подтверждённый опыт:",
    "• Настроил продуктовую отчётность для команды роста",
    "• Проводил анализ продуктовых экспериментов"
  ].join("\n"),
  coverLetter: [
    "Здравствуйте, команда Finwave!",
    "",
    "Меня зовут Алексей Смирнов. Я хочу откликнуться на позицию «Senior Product Analyst».",
    "",
    "Для этой роли релевантны мои подтверждённые навыки: SQL, Amplitude.",
    "",
    "Из подтверждённого опыта могу отметить:",
    "• Настроил продуктовую отчётность для команды роста",
    "• Проводил анализ продуктовых экспериментов",
    "",
    "Буду рад обсудить задачи роли и взаимное соответствие ожиданий.",
    "",
    "С уважением,",
    "Алексей Смирнов"
  ].join("\n")
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    path.join(outputDirectory, "application-packet.docx"),
    await createDocxExport(fixture)
  ),
  writeFile(
    path.join(outputDirectory, "application-packet.pdf"),
    await createPdfExport(fixture)
  )
]);

console.log(outputDirectory);
